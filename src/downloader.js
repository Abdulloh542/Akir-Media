require('dotenv').config({ override: true });
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { logger, formatBytes } = require('./utils');

class NonRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NonRetryableError';
    this.nonRetryable = true;
  }
}

function isNonRetryable(stderr) {
  const s = stderr || '';
  return (
    s.includes('login required') ||
    s.includes('Login required') ||
    s.includes('rate-limit reached') ||
    s.includes('rate limit') ||
    s.includes('Please sign in') ||
    s.includes('Sign in to confirm') ||
    s.includes('Requested content is not available') ||
    s.includes('This content is not available') ||
    s.includes('No video formats found') ||
    s.includes('age-restricted') ||
    s.includes('Private video') ||
    s.includes('Video unavailable') ||
    s.includes('copyright') ||
    s.includes('geo-restricted') ||
    s.includes('not available in your country')
  );
}

const DOWNLOAD_PATH = process.env.DOWNLOAD_PATH || './downloads';
fs.ensureDirSync(DOWNLOAD_PATH);

const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

// Maksimal ruxsat etilgan fayl hajmi (MB) — .env dan o'qiladi
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_SIZE) || 2000;

// Telegram bot API limiti: 50MB
const TELEGRAM_LIMIT_MB = 50;

function buildYtDlpArgs(url, outputTemplate, type, options = {}) {
  const args = [url];

  if (type === 'audio') {
    args.push(
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0'
    );
  } else {
    // Katta videolar uchun 720p gacha cheklov — fayl hajmini kamaytirish
    // Agar sifat muhim bo'lsa va hajm katta bo'lsa ham qabul qilsin
    args.push(
      '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080][ext=mp4]/best[height<=1080]/best',
      '--merge-output-format', 'mp4'
    );
  }

  args.push(
    '-o', outputTemplate,
    '--no-playlist',
    '--retries', '5',
    '--fragment-retries', '5',
    '--concurrent-fragments', '4',
    '--buffer-size', '16K',
    '--http-chunk-size', '10M',
    '--socket-timeout', '60',     // 60 soniya socket timeout (avval 30 edi)
    '--no-warnings',
    '--progress',
    '--newline',
    '--no-part',
  );

  // ffmpeg yo'lini ko'rsatish (Windows uchun muhim)
  const ffmpegDir = path.dirname(FFMPEG_BIN);
  if (fs.existsSync(FFMPEG_BIN)) {
    args.push('--ffmpeg-location', ffmpegDir);
  }

  if (process.env.PROXY_URL) {
    args.push('--proxy', process.env.PROXY_URL);
  }

  if (process.env.COOKIES_FILE && fs.existsSync(process.env.COOKIES_FILE)) {
    args.push('--cookies', process.env.COOKIES_FILE);
  }

  return args;
}

// yt-dlp jarayonini ishga tushirish — timeout bilan
function spawnWithTimeout(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let killed = false;

    const timer = setTimeout(() => {
      if (!killed) {
        killed = true;
        proc.kill('SIGKILL');
        logger.warn(`yt-dlp jarayon timeout (${timeoutMs / 1000}s) — o'ldirildi`);
      }
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ proc, code, killed });
    });

    resolve({ proc, timer, killed: () => killed });
  });
}

async function downloadVideo(url, outputDir, progressCallback) {
  const outputTemplate = path.join(outputDir, '%(title).100s.%(ext)s');
  const args = buildYtDlpArgs(url, outputTemplate, 'video');

  // Maksimal vaqt: 90 daqiqa (uzun videolar uchun)
  const PROCESS_TIMEOUT = 90 * 60 * 1000;

  return new Promise((resolve, reject) => {
    logger.debug('yt-dlp video start', { url });
    const proc = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let filePath = null;
    let stderr = '';
    let killed = false;

    // Process timeout
    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
      reject(new Error('Video yuklab olish juda uzoq davom etdi (90 daqiqa). Qisqaroq video yuboring.'));
    }, PROCESS_TIMEOUT);

    proc.stdout.on('data', (data) => {
      const text = data.toString();

      // Progress parsing — turli yt-dlp formatlarini qo'llab-quvvatlash
      const progressMatch = text.match(/(\d+\.?\d*)%\s+of\s+~?\s*([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)/);
      if (progressMatch && progressCallback) {
        progressCallback({
          percent: parseFloat(progressMatch[1]),
          total: progressMatch[2],
          speed: progressMatch[3],
        });
      } else {
        const simpleMatch = text.match(/(\d+\.?\d*)%/);
        if (simpleMatch && progressCallback) {
          progressCallback({ percent: parseFloat(simpleMatch[1]) });
        }
      }

      const destMatch = text.match(/\[download\] Destination: (.+)/);
      if (destMatch) filePath = destMatch[1].trim();

      const mergeMatch = text.match(/\[Merger\] Merging formats into "(.+)"/);
      if (mergeMatch) filePath = mergeMatch[1].trim();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      logger.debug('yt-dlp stderr:', data.toString().trim());
    });

    proc.on('close', async (code) => {
      clearTimeout(timer);

      if (killed) return; // timeout reject allaqachon chaqirilgan

      if (code !== 0) {
        const errMsg = parseYtDlpError(stderr);
        reject(isNonRetryable(stderr) ? new NonRetryableError(errMsg) : new Error(errMsg));
        return;
      }

      // Fayl yo'lini topish
      if (!filePath || !fs.existsSync(filePath)) {
        const files = await fs.readdir(outputDir);
        const videoFile = files.find(f =>
          /\.(mp4|mkv|webm|avi|mov)$/i.test(f) && !f.endsWith('.json')
        );
        if (videoFile) filePath = path.join(outputDir, videoFile);
      }

      if (!filePath || !fs.existsSync(filePath)) {
        reject(new Error('Yuklab olingan fayl topilmadi'));
        return;
      }

      const stat = await fs.stat(filePath);
      const sizeMB = stat.size / (1024 * 1024);
      logger.info(`Video downloaded: ${path.basename(filePath)} (${formatBytes(stat.size)})`);

      resolve({ type: 'video', filePath, size: stat.size, sizeMB });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp o\'rnatilmagan. Iltimos o\'rnating.'));
      } else {
        reject(err);
      }
    });
  });
}

async function downloadAudio(url, outputDir, progressCallback) {
  const outputTemplate = path.join(outputDir, '%(title).100s.%(ext)s');
  const args = buildYtDlpArgs(url, outputTemplate, 'audio');

  const PROCESS_TIMEOUT = 60 * 60 * 1000; // 60 daqiqa

  return new Promise((resolve, reject) => {
    logger.debug('yt-dlp audio start', { url });
    const proc = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let filePath = null;
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
      reject(new Error('Audio yuklab olish juda uzoq davom etdi (60 daqiqa).'));
    }, PROCESS_TIMEOUT);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/(\d+\.?\d*)%/);
      if (match && progressCallback) {
        progressCallback({ percent: parseFloat(match[1]) });
      }
      const destMatch = text.match(/\[download\] Destination: (.+)/);
      if (destMatch) filePath = destMatch[1].trim();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      clearTimeout(timer);
      if (killed) return;

      if (code !== 0) {
        const errMsg = parseYtDlpError(stderr);
        reject(isNonRetryable(stderr) ? new NonRetryableError(errMsg) : new Error(errMsg));
        return;
      }

      if (!filePath || !fs.existsSync(filePath)) {
        const files = await fs.readdir(outputDir);
        const audioFile = files.find(f => /\.(mp3|m4a|ogg|opus|flac|wav)$/i.test(f));
        if (audioFile) filePath = path.join(outputDir, audioFile);
      }

      if (!filePath || !fs.existsSync(filePath)) {
        reject(new Error('Audio fayl topilmadi'));
        return;
      }

      const stat = await fs.stat(filePath);
      logger.info(`Audio downloaded: ${path.basename(filePath)} (${formatBytes(stat.size)})`);
      resolve({ type: 'audio', filePath, size: stat.size });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp o\'rnatilmagan.'));
      } else {
        reject(err);
      }
    });
  });
}

async function downloadImages(url, outputDir, progressCallback) {
  const isPinterest = /pinterest\.com|pin\.it/i.test(url);
  const isInstagram = /instagram\.com/i.test(url);

  // Pinterest: video → thumbnail (image pins uchun)
  if (isPinterest) {
    try {
      return await downloadPinterestMedia(url, outputDir, progressCallback);
    } catch (e) {
      logger.debug('Pinterest video failed, trying thumbnail:', e.message);
    }
    try {
      return await downloadThumbnailOnly(url, outputDir);
    } catch (thumbErr) {
      logger.debug('Pinterest thumbnail failed:', thumbErr.message);
      throw new NonRetryableError('Pinterest media yuklab bo\'lmadi. Boshqa havola yuboring.');
    }
  }

  // Instagram carousel: yt-dlp bilan avval urinish
  if (isInstagram) {
    try {
      return await downloadInstagramMedia(url, outputDir, progressCallback);
    } catch (e) {
      logger.debug('Instagram yt-dlp failed, trying gallery-dl:', e.message);
    }
    // gallery-dl bilan urinish
    try {
      return await downloadWithGalleryDl(url, outputDir, progressCallback);
    } catch (e2) {
      logger.debug('Instagram gallery-dl failed:', e2.message);
      throw new NonRetryableError('Instagram media yuklab bo\'lmadi. Login talab qilinishi mumkin.');
    }
  }

  // Boshqa platformalar: gallery-dl → yt-dlp → thumbnail
  try {
    return await downloadWithGalleryDl(url, outputDir, progressCallback);
  } catch (galleryErr) {
    logger.debug('gallery-dl failed, trying yt-dlp:', galleryErr.message);
  }

  try {
    return await downloadWithYtDlp(url, outputDir, progressCallback);
  } catch (ytErr) {
    logger.debug('yt-dlp failed, trying thumbnail:', ytErr.message);
  }

  try {
    return await downloadThumbnailOnly(url, outputDir);
  } catch (thumbErr) {
    throw new NonRetryableError('Media yuklab bo\'lmadi.');
  }
}

// Pinterest uchun alohida funksiya: video → rasm
async function downloadPinterestMedia(url, outputDir, progressCallback) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(outputDir, '%(id)s.%(ext)s');
    // Pinterest video/rasm uchun eng mos formatlar
    const args = [
      url,
      '-f', 'bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--write-thumbnail',
      '-o', outputTemplate,
      '--no-playlist',
      '--no-warnings',
      '--newline',
    ];

    const ffmpegDir = path.dirname(FFMPEG_BIN);
    if (fs.existsSync(FFMPEG_BIN)) args.push('--ffmpeg-location', ffmpegDir);
    if (process.env.PROXY_URL) args.push('--proxy', process.env.PROXY_URL);
    if (process.env.COOKIES_FILE && fs.existsSync(process.env.COOKIES_FILE)) {
      args.push('--cookies', process.env.COOKIES_FILE);
    }

    const proc = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let filePath = null;
    let stderr = '';

    const timer = setTimeout(() => { proc.kill('SIGKILL'); }, 10 * 60 * 1000);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const pct = text.match(/(\d+\.?\d*)%/);
      if (pct && progressCallback) progressCallback({ percent: parseFloat(pct[1]) });
      const dest = text.match(/\[download\] Destination: (.+)/);
      if (dest) filePath = dest[1].trim();
      const merge = text.match(/\[Merger\] Merging formats into "(.+)"/);
      if (merge) filePath = merge[1].trim();
    });

    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      clearTimeout(timer);
      // Check files first — thumbnails may have been written even on failure
      const allFiles = await getMediaFiles(outputDir);
      if (allFiles.length > 0) {
        const videoFiles = allFiles.filter(f => /\.(mp4|webm|mov|mkv)$/i.test(f));
        if (videoFiles.length > 0) {
          const stat = await fs.stat(videoFiles[0]);
          return resolve({ type: 'video', filePath: videoFiles[0], size: stat.size });
        }
        return resolve({ type: 'images', files: allFiles, count: allFiles.length });
      }
      reject(new Error(parseYtDlpError(stderr) || 'Pinterest: media topilmadi'));
    });

    proc.on('error', () => reject(new Error('yt-dlp topilmadi')));
  });
}

// Instagram carousel/reel uchun yt-dlp bilan yuklab olish
async function downloadInstagramMedia(url, outputDir, progressCallback) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(outputDir, '%(autonumber)s_%(id)s.%(ext)s');
    const args = [
      url,
      '-f', 'bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--yes-playlist',   // carousel uchun barcha rasmlar/videolarni yuklab olish
    ];

    const ffmpegDir = path.dirname(FFMPEG_BIN);
    if (fs.existsSync(FFMPEG_BIN)) args.push('--ffmpeg-location', ffmpegDir);
    if (process.env.PROXY_URL) args.push('--proxy', process.env.PROXY_URL);
    if (process.env.COOKIES_FILE && fs.existsSync(process.env.COOKIES_FILE)) {
      args.push('--cookies', process.env.COOKIES_FILE);
    }

    const proc = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    const timer = setTimeout(() => { proc.kill('SIGKILL'); }, 15 * 60 * 1000);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const pct = text.match(/(\d+\.?\d*)%/);
      if (pct && progressCallback) progressCallback({ percent: parseFloat(pct[1]) });
    });

    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      clearTimeout(timer);
      const allFiles = await getMediaFiles(outputDir);
      if (allFiles.length === 0) {
        return reject(new Error(parseYtDlpError(stderr) || 'Instagram: media topilmadi'));
      }
      logger.info(`Instagram: ${allFiles.length} fayl`);
      const videoFiles = allFiles.filter(f => /\.(mp4|webm|mov|mkv)$/i.test(f));
      if (videoFiles.length === 1 && allFiles.length === 1) {
        const stat = await fs.stat(videoFiles[0]);
        resolve({ type: 'video', filePath: videoFiles[0], size: stat.size });
      } else if (videoFiles.length > 0 || allFiles.length > 0) {
        resolve({ type: 'images', files: allFiles, count: allFiles.length });
      } else {
        reject(new Error('Instagram: media topilmadi'));
      }
    });

    proc.on('error', () => reject(new Error('yt-dlp topilmadi')));
  });
}

function downloadThumbnailOnly(url, outputDir) {
  return new Promise((resolve, reject) => {
    const args = [
      url,
      '--write-thumbnail',
      '--skip-download',
      '-o', path.join(outputDir, '%(id)s'),
      '--no-playlist',
      '--no-warnings',
    ];
    if (process.env.PROXY_URL) args.push('--proxy', process.env.PROXY_URL);
    if (process.env.COOKIES_FILE && fs.existsSync(process.env.COOKIES_FILE)) {
      args.push('--cookies', process.env.COOKIES_FILE);
    }

    const proc = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.on('close', async () => {
      const files = await getMediaFiles(outputDir);
      if (files.length > 0) {
        logger.info(`Thumbnail extracted: ${files.length} file(s)`);
        resolve({ type: 'images', files, count: files.length });
      } else {
        reject(new Error('Thumbnail topilmadi'));
      }
    });
    proc.on('error', () => reject(new Error('yt-dlp topilmadi')));
  });
}

function downloadWithGalleryDl(url, outputDir, progressCallback) {
  return new Promise((resolve, reject) => {
    const args = [
      url,
      '-d', outputDir,
      '--no-download-archive',
      '-q',
    ];

    if (process.env.COOKIES_FILE && fs.existsSync(process.env.COOKIES_FILE)) {
      args.push('--cookies', process.env.COOKIES_FILE);
    }

    const proc = spawn('gallery-dl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.on('close', async (code) => {
      const allFiles = await getMediaFiles(outputDir);
      if (allFiles.length === 0) {
        reject(new Error('gallery-dl: hech qanday media topilmadi'));
        return;
      }
      logger.info(`gallery-dl: ${allFiles.length} fayl yuklab olindi`);
      resolve({ type: 'images', files: allFiles, count: allFiles.length });
    });

    proc.on('error', () => reject(new Error('gallery-dl topilmadi')));
  });
}

function downloadWithYtDlp(url, outputDir, progressCallback) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(outputDir, '%(id)s.%(ext)s');
    const args = [
      url,
      '--write-thumbnail',
      '-o', outputTemplate,
      '-f', 'best[ext=mp4]/best',
      '--no-playlist',
      '--no-warnings',
      '--newline',
    ];

    if (process.env.PROXY_URL) args.push('--proxy', process.env.PROXY_URL);
    if (process.env.COOKIES_FILE && fs.existsSync(process.env.COOKIES_FILE)) {
      args.push('--cookies', process.env.COOKIES_FILE);
    }

    const proc = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let filePath = null;
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/(\d+\.?\d*)%/);
      if (match && progressCallback) {
        progressCallback({ percent: parseFloat(match[1]) });
      }
      const destMatch = text.match(/\[download\] Destination: (.+)/);
      if (destMatch) filePath = destMatch[1].trim();
    });

    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      if (code !== 0 && !filePath) {
        reject(new Error(parseYtDlpError(stderr)));
        return;
      }

      const allFiles = await getMediaFiles(outputDir);
      if (allFiles.length === 0) {
        reject(new Error('Media fayl topilmadi'));
        return;
      }

      const videoFiles = allFiles.filter(f => /\.(mp4|webm|mov|mkv)$/i.test(f));
      if (videoFiles.length > 0) {
        const stat = await fs.stat(videoFiles[0]);
        resolve({ type: 'video', filePath: videoFiles[0], size: stat.size });
      } else {
        resolve({ type: 'images', files: allFiles, count: allFiles.length });
      }
    });

    proc.on('error', reject);
  });
}

async function getMediaFiles(dir) {
  try {
    const files = await fs.readdir(dir);
    return files
      .filter(f => /\.(jpg|jpeg|png|gif|webp|mp4|mov|webm|mkv)$/i.test(f))
      .map(f => path.join(dir, f))
      .sort();
  } catch {
    return [];
  }
}

function parseYtDlpError(stderr) {
  if (!stderr) return 'Noma\'lum xato yuz berdi';

  if (stderr.includes('No video formats found')) return 'Bu havolada yuklab olinadigan video topilmadi';
  if (stderr.includes('Video unavailable')) return 'Video mavjud emas yoki o\'chirilgan';
  if (stderr.includes('Private video')) return 'Bu private video, yuklab bo\'lmaydi';
  if (stderr.includes('Sign in') || stderr.includes('login required') || stderr.includes('Login required')) return 'Bu kontent login talab qiladi';
  if (stderr.includes('Requested content is not available') || stderr.includes('rate-limit reached')) return 'Bu kontent mavjud emas yoki cheklov o\'rnatilgan';
  if (stderr.includes('age-restricted')) return 'Bu video yosh chekloviga ega';
  if (stderr.includes('copyright')) return 'Bu video mualliflik huquqi bilan himoyalangan';
  if (stderr.includes('geo') || stderr.includes('not available in your country')) return 'Bu kontent sizning mamlakatda mavjud emas';
  if (stderr.includes('not found') || stderr.includes('404')) return 'Havola topilmadi (404)';
  if (stderr.includes('rate limit') || stderr.includes('429')) return 'So\'rovlar chegarasi oshdi. Biroz kutib qayta urinib ko\'ring';
  if (stderr.includes('network') || stderr.includes('connection')) return 'Tarmoq xatosi. Qayta urinib ko\'ring';

  const errorLine = stderr.split('\n').find(l => l.includes('ERROR:'));
  if (errorLine) {
    const msg = errorLine.replace(/ERROR:\s*/, '').trim();
    return msg.replace(/;\s*please report.*$/i, '').trim() || 'Yuklab olishda xato';
  }

  return 'Yuklab olishda xato. Havola to\'g\'ri ekanligini tekshiring';
}

async function downloadMedia(url, type = 'video', progressCallback = null) {
  const sessionId = uuidv4();
  const outputDir = path.join(DOWNLOAD_PATH, sessionId);
  await fs.ensureDir(outputDir);

  try {
    let result;

    // Instagram /p/ URLs are carousel posts — always use gallery-dl first
    const isInstagramPost = /instagram\.com\/(?:[\w.]+\/)?p\/[\w-]+/i.test(url);

    if (type === 'audio') {
      result = await downloadAudio(url, outputDir, progressCallback);
    } else if (type === 'image' || isInstagramPost) {
      result = await downloadImages(url, outputDir, progressCallback);
    } else {
      result = await downloadVideo(url, outputDir, progressCallback);
    }
    return { ...result, sessionId, outputDir };
  } catch (err) {
    await fs.remove(outputDir).catch(() => {});
    throw err;
  }
}

async function cleanup(outputDir) {
  if (!outputDir) return;
  try {
    await fs.remove(outputDir);
    logger.debug('Cleaned up:', outputDir);
  } catch (e) {
    logger.error('Cleanup error:', e.message);
  }
}

module.exports = { downloadMedia, cleanup, NonRetryableError };
