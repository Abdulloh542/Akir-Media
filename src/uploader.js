require('dotenv').config({ override: true });
const { spawn } = require('child_process');
const fs   = require('fs-extra');
const path = require('path');
const { logger, formatBytes } = require('./utils');

const FFMPEG_BIN  = process.env.FFMPEG_PATH || 'ffmpeg';
const TELEGRAM_LIMIT = 49 * 1024 * 1024; // 49 MB (Telegram cloud API)

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
  logger.info(`Sending video: ${path.basename(filePath)} (${formatBytes(stat.size)})`);

  if (stat.size > TELEGRAM_LIMIT) {
    logger.info(`File too large (${formatBytes(stat.size)}), compressing...`);
    try {
      fileToSend = await compressVideo(filePath, 48);
      const newStat = await fs.stat(fileToSend);
      logger.info(`Compressed to: ${formatBytes(newStat.size)}`);

      if (newStat.size > TELEGRAM_LIMIT) {
        await bot.sendMessage(chatId,
          `⚠️ Video hajmi juda katta (${formatBytes(stat.size)}).\n` +
          `Telegram 50MB dan katta fayllarni qabul qilmaydi.\n\n` +
          `💡 Yechim: YouTube videolarida Audio rejimini tanlang yoki qisqaroq video yuboring.`
        );
        return;
      }
    } catch (e) {
      logger.error('Compression failed:', e.message);
      await bot.sendMessage(chatId,
        `⚠️ Video hajmi ${formatBytes(stat.size)} — Telegram limiti 50MB.\n\n` +
        `💡 Audio rejimida yuklab oling yoki qisqaroq video yuboring.`
      );
      return;
    }
  }

  await bot.sendVideo(chatId, fs.createReadStream(fileToSend), {
    supports_streaming: true,
    caption: '✅ @AkirMediaBot',
  });

  // Kompressiya qilingan faylni o'chirish
  if (fileToSend !== filePath) await fs.remove(fileToSend).catch(() => {});
}

async function sendAudio(bot, chatId, filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Audio fayl topilmadi');
  const stat = await fs.stat(filePath);
  logger.info(`Sending audio: ${path.basename(filePath)} (${formatBytes(stat.size)})`);
  await bot.sendAudio(chatId, fs.createReadStream(filePath), {
    caption: '✅ @AkirMediaBot',
  });
}

async function sendSingleMedia(bot, chatId, filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const ext = path.extname(filePath).toLowerCase();
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) {
    await bot.sendVideo(chatId, fs.createReadStream(filePath), {
      supports_streaming: true,
      caption: '✅ @AkirMediaBot',
    });
  } else {
    await bot.sendPhoto(chatId, fs.createReadStream(filePath), {
      caption: '✅ @AkirMediaBot',
    });
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
    await bot.sendMediaGroup(chatId, media);
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 1000));
  }
}

// FFmpeg bilan hajmini kamaytirish
function compressVideo(inputPath, targetMB) {
  return new Promise((resolve, reject) => {
    const ffprobe = process.env.FFMPEG_PATH
      ? process.env.FFMPEG_PATH.replace('ffmpeg.exe', 'ffprobe.exe').replace('ffmpeg', 'ffprobe')
      : 'ffprobe';

    const probe = spawn(ffprobe, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', inputPath,
    ]);
    let buf = '';
    probe.stdout.on('data', d => buf += d);
    probe.on('error', () => reject(new Error('ffprobe topilmadi')));
    probe.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe xatosi'));
      try {
        const duration = parseFloat(JSON.parse(buf).format.duration);
        if (!duration) return reject(new Error('Davomiylik aniqlanmadi'));

        const targetBitrate = Math.max(200, Math.floor((targetMB * 8 * 1024) / duration) - 128);
        const outPath = inputPath.replace(/(\.[^.]+)$/, '_c.mp4');

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
      } catch (e) { reject(e); }
    });
  });
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

module.exports = { uploadToTelegram };
