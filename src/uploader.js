require('dotenv').config({ override: true });
const { spawn } = require('child_process');
const fs   = require('fs-extra');
const path = require('path');
const { logger, formatBytes } = require('./utils');

const FFMPEG_BIN  = process.env.FFMPEG_PATH || 'ffmpeg';
const TELEGRAM_LIMIT = 49 * 1024 * 1024; // 49 MB (Telegram cloud API)

// Telegram bot.sendVideo() uchun maksimal kutish vaqti (ms)
// 30 daqiqali video uchun yetarli: 10 daqiqa
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

async function uploadToTelegram(bot, chatId, result) {
  const { type, filePath, files } = result;

  if (type === 'images' && files && files.length > 1) {
    await sendMediaGroup(bot, chatId, files);
  } else if (type === 'images' && files && files.length === 1) {
    await sendSingleMedia(bot, chatId, files[0]);
  } else if (type === 'audio') {
    await sendAudio(bot, chatId, filePath);
  } else {
    await sendVideo(bot, chatId, filePath);
  }
}

async function sendVideo(bot, chatId, filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Video fayl topilmadi');

  let fileToSend = filePath;
  const stat = await fs.stat(filePath);
  logger.info(`sendVideo: ${path.basename(filePath)} ext=${path.extname(filePath)} size=${formatBytes(stat.size)}`);

  if (stat.size > TELEGRAM_LIMIT) {
    logger.info(`Fayl ${formatBytes(stat.size)} — Telegram limiti oshdi, kompressiya boshlandi...`);

    // Videoning davomiyligini aniqlash
    let durationSec = 0;
    try {
      durationSec = await getVideoDuration(filePath);
    } catch (e) {
      logger.warn('Davomiylikni aniqlab bo\'lmadi:', e.message);
    }

    logger.info(`Video davomiyligi: ${Math.round(durationSec)} soniya`);

    // 30 daqiqadan uzun video uchun ogohlantiruv
    if (durationSec > 30 * 60) {
      await bot.sendMessage(chatId,
        `⚠️ Video ${Math.round(durationSec / 60)} daqiqa — Telegram 50MB dan katta fayllarni qabul qilmaydi.\n💡 Audio (MP3) sifatida yuklab oling.`
      );
      return;
    }

    try {
      fileToSend = await compressVideo(filePath, 48, durationSec);
      const newStat = await fs.stat(fileToSend);
      logger.info(`Kompressiya natijasi: ${formatBytes(newStat.size)}`);

      if (newStat.size > TELEGRAM_LIMIT) {
        // Ikkinchi kompressiya: 720p ga tushirish
        logger.info('Birinchi kompressiya yetarli emas, 720p ga o\'tkazilmoqda...');
        try {
          const compressed2 = await compressVideoTo720p(filePath, 46, durationSec);
          const stat2 = await fs.stat(compressed2);
          // Birinchi kompressiyani o'chirish
          await fs.remove(fileToSend).catch(() => {});
          fileToSend = compressed2;
          logger.info(`720p kompressiya: ${formatBytes(stat2.size)}`);

          if (stat2.size > TELEGRAM_LIMIT) {
            await fs.remove(fileToSend).catch(() => {});
            await bot.sendMessage(chatId,
              `⚠️ Video hajmi katta (${formatBytes(stat.size)}) — Telegram 50MB dan o'tmaydi.\n💡 Audio (MP3) sifatida yuklab oling.`
            );
            return;
          }
        } catch (e2) {
          logger.error('720p kompressiya xatosi:', e2.message);
          await fs.remove(fileToSend).catch(() => {});
          await bot.sendMessage(chatId,
            `⚠️ Video hajmi katta (${formatBytes(stat.size)}) — Audio (MP3) sifatida yuklab oling.`
          );
          return;
        }
      }
    } catch (e) {
      logger.error('Kompressiya ishlamadi:', e.message);
      await bot.sendMessage(chatId,
        `⚠️ Video hajmi katta (${formatBytes(stat.size)}) — Audio (MP3) sifatida yuklab oling.`
      );
      return;
    }
  }

  // Telegramga yuklash — timeout bilan
  logger.info(`sendVideo: Telegram API ga yuborilmoqda: ${path.basename(fileToSend)} (${formatBytes((await fs.stat(fileToSend)).size)})`);
  try {
    await sendWithTimeout(
      bot.sendVideo(chatId, fs.createReadStream(fileToSend), {
        supports_streaming: true,
        caption: '✅ @AkirMediaBot',
      }),
      UPLOAD_TIMEOUT_MS,
      'Video yuklash timeout'
    );
  } catch (e) {
    logger.error(`sendVideo Telegram xato: ${e.message || e}`);
    throw e;
  }

  // Kompressiya qilingan faylni o'chirish
  if (fileToSend !== filePath) await fs.remove(fileToSend).catch(() => {});
}

async function sendAudio(bot, chatId, filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Audio fayl topilmadi');
  const stat = await fs.stat(filePath);
  logger.info(`Sending audio: ${path.basename(filePath)} (${formatBytes(stat.size)})`);

  if (stat.size > TELEGRAM_LIMIT) {
    await bot.sendMessage(chatId,
      `⚠️ Audio hajmi katta (${formatBytes(stat.size)}) — Telegram 50MB dan o'tmaydi.`
    );
    return;
  }

  await sendWithTimeout(
    bot.sendAudio(chatId, fs.createReadStream(filePath), {
      caption: '✅ @AkirMediaBot',
    }),
    UPLOAD_TIMEOUT_MS,
    'Audio yuklash timeout'
  );
}

async function sendSingleMedia(bot, chatId, filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const ext = path.extname(filePath).toLowerCase();
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) {
    await sendWithTimeout(
      bot.sendVideo(chatId, fs.createReadStream(filePath), {
        supports_streaming: true,
        caption: '✅ @AkirMediaBot',
      }),
      UPLOAD_TIMEOUT_MS,
      'Video yuklash timeout'
    );
  } else {
    await sendWithTimeout(
      bot.sendPhoto(chatId, fs.createReadStream(filePath), {
        caption: '✅ @AkirMediaBot',
      }),
      UPLOAD_TIMEOUT_MS,
      'Rasm yuklash timeout'
    );
  }
}

async function sendMediaGroup(bot, chatId, files) {
  const valid = files.filter(f => fs.existsSync(f));
  if (!valid.length) throw new Error('Rasmlar topilmadi');

  const chunks = chunkArray(valid, 10);
  for (const chunk of chunks) {
    const media = chunk.map((fp, i) => {
      const ext = path.extname(fp).toLowerCase();
      const isVid = ['.mp4', '.mov', '.webm', '.mkv'].includes(ext);
      return {
        type: isVid ? 'video' : 'photo',
        media: fs.createReadStream(fp),
        ...(i === 0 ? { caption: '✅ @AkirMediaBot' } : {}),
      };
    });
    await sendWithTimeout(
      bot.sendMediaGroup(chatId, media),
      UPLOAD_TIMEOUT_MS,
      'Media group yuklash timeout'
    );
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 1000));
  }
}

// Promise uchun timeout wrapper
function sendWithTimeout(promise, ms, label = 'Timeout') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: ${ms / 1000} soniyadan oshdi. Internet aloqasi yoki server muammosi.`));
    }, ms);

    promise
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

// Videoning davomiyligini ffprobe orqali aniqlash
function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = process.env.FFMPEG_PATH
      ? process.env.FFMPEG_PATH.replace('ffmpeg.exe', 'ffprobe.exe').replace(/ffmpeg$/, 'ffprobe')
      : 'ffprobe';

    const probe = spawn(ffprobe, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
    ]);
    let buf = '';
    probe.stdout.on('data', d => buf += d);
    probe.on('error', () => reject(new Error('ffprobe topilmadi')));
    probe.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe xatosi'));
      try {
        const data = JSON.parse(buf);
        const duration = parseFloat(data.format?.duration || '0');
        resolve(duration);
      } catch (e) {
        reject(new Error('Davomiylikni tahlil qilib bo\'lmadi'));
      }
    });
  });
}

// Standart kompressiya (1080p saqlanadi, bitrate kamaytiriiladi)
function compressVideo(inputPath, targetMB, durationSec) {
  return new Promise((resolve, reject) => {
    if (!durationSec || durationSec <= 0) {
      return reject(new Error('Davomiylik aniqlanmadi'));
    }

    const targetBitrate = Math.max(200, Math.floor((targetMB * 8 * 1024) / durationSec) - 128);
    const outPath = inputPath.replace(/(\.[^.]+)$/, '_c.mp4');

    logger.info(`FFmpeg kompressiya: ${targetBitrate}k video bitrate`);

    const ff = spawn(FFMPEG_BIN, [
      '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'fast',
      '-b:v', `${targetBitrate}k`,
      '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart',
      '-y', outPath,
    ]);
    ff.on('error', reject);
    ff.on('close', c => c === 0 ? resolve(outPath) : reject(new Error('ffmpeg kompressiya xatosi')));
  });
}

// Kuchli kompressiya — 720p ga tushirish
function compressVideoTo720p(inputPath, targetMB, durationSec) {
  return new Promise((resolve, reject) => {
    if (!durationSec || durationSec <= 0) {
      return reject(new Error('Davomiylik aniqlanmadi'));
    }

    const targetBitrate = Math.max(150, Math.floor((targetMB * 8 * 1024) / durationSec) - 96);
    const outPath = inputPath.replace(/(\.[^.]+)$/, '_720p.mp4');

    logger.info(`FFmpeg 720p kompressiya: ${targetBitrate}k video bitrate`);

    const ff = spawn(FFMPEG_BIN, [
      '-i', inputPath,
      '-vf', 'scale=-2:720',         // 720p gacha kamaytirish
      '-c:v', 'libx264', '-preset', 'fast',
      '-b:v', `${targetBitrate}k`,
      '-c:a', 'aac', '-b:a', '64k',
      '-movflags', '+faststart',
      '-y', outPath,
    ]);
    ff.on('error', reject);
    ff.on('close', c => c === 0 ? resolve(outPath) : reject(new Error('720p kompressiya xatosi')));
  });
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

module.exports = { uploadToTelegram };
