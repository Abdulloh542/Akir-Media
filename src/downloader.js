require('dotenv').config({ override: true });
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { logger, formatBytes } = require('./utils');

const DOWNLOAD_PATH = process.env.DOWNLOAD_PATH || './downloads';
fs.ensureDirSync(DOWNLOAD_PATH);

const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

function buildYtDlpArgs(url, outputTemplate, type, options = {}) {
  const args = [url];

  if (type === 'audio') {
    args.push(
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0'
    );
  } else {
    args.push(
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best',
      '--merge-output-format', 'mp4'
    );
  }

  args.push(
    '-o', outputTemplate,
    '--no-playlist',
    '--retries', '10',
    '--fragment-retries', '10',
    '--concurrent-fragments', '8',
    '--buffer-size', '16K',
    '--http-chunk-size', '10M',
    '--socket-timeout', '30',
    '--no-warnings',
    '--progress',
    '--newline',
    '--no-part',
  );

  // ffmpeg yo'lini ko'rsatish (Windows uchun muhim)
  const ffmpegDir = require('path').dirname(FFMPEG_BIN);
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

async function downloadVideo(url, outputDir, progressCallback) {
  const outputTemplate = path.join(outputDir, '%(title).100s.%(ext)s');
  const args = buildYtDlpArgs(url, outputTemplate, 'video');

  return new Promise((resolve, reject) => {
    logger.debug('yt-dlp video start', { url });
    const proc = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let filePath = null;
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();

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
      if (code !== 0) {
        const errMsg = parseYtDlpError(stderr);
        reject(new Error(errMsg));
        return;
      }

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
      logger.info(`Video downloaded: ${path.basename(filePath)} (${formatBytes(stat.size)})`);
      resolve({ type: 'video', filePath, size: stat.size });
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp o\'rnatilmagan. Iltimos serverga o\'rnating.'));
      } else {
        reject(err);
      }
    });
  });
}

async function downloadAudio(url, outputDir, progressCallback) {
  const outputTemplate = path.join(outputDir, '%(title).100s.%(ext)s');
  const args = buildYtDlpArgs(url, outputTemplate, 'audio');

  return new Promise((resolve, reject) => {
    logger.debug('yt-dlp audio start', { url });
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

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(parseYtDlpError(stderr)));
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
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp o\'rnatilmagan.'));
      } else {
        reject(err);
      }
    });
  });
}

async function downloadImages(url, outputDir, progressCallback) {
  try {
    return await downloadWithGalleryDl(url, outputDir, progressCallback);
  } catch (e) {
    logger.debug('gallery-dl failed, trying yt-dlp:', e.message);
    return await downloadWithYtDlp(url, outputDir, progressCallback);
  }
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
    let hasOutput = false;

    proc.stdout.on('data', () => { hasOutput = true; });

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

  if (stderr.includes('Video unavailable')) return 'Video mavjud emas yoki o\'chirilgan';
  if (stderr.includes('Private video')) return 'Bu private video, yuklab bo\'lmaydi';
  if (stderr.includes('Sign in')) return 'Bu video login talab qiladi';
  if (stderr.includes('age-restricted')) return 'Bu video yosh chekloviga ega';
  if (stderr.includes('copyright')) return 'Bu video mualliflik huquqi bilan himoyalangan';
  if (stderr.includes('geo')) return 'Bu video sizning mamlakatda mavjud emas (geoblok)';
  if (stderr.includes('not found') || stderr.includes('404')) return 'Havola topilmadi (404)';
  if (stderr.includes('rate limit') || stderr.includes('429')) return 'So\'rovlar chegarasi oshdi. Biroz kutib qayta urinib ko\'ring';
  if (stderr.includes('network') || stderr.includes('connection')) return 'Tarmoq xatosi. Qayta urinib ko\'ring';

  const errorLine = stderr.split('\n').find(l => l.includes('ERROR:'));
  if (errorLine) return errorLine.replace('ERROR:', '').trim();

  return 'Yuklab olishda xato. Havola to\'g\'ri ekanligini tekshiring';
}

async function downloadMedia(url, type = 'video', progressCallback = null) {
  const sessionId = uuidv4();
  const outputDir = path.join(DOWNLOAD_PATH, sessionId);
  await fs.ensureDir(outputDir);

  try {
    let result;
    if (type === 'audio') {
      result = await downloadAudio(url, outputDir, progressCallback);
    } else if (type === 'image') {
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

module.exports = { downloadMedia, cleanup };
