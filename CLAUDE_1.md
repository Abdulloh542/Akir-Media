# AKIR MEDIA BOT — Claude Code Project Guide

## Loyiha haqida

**Bot nomi:** Akir Media Bot  
**Vazifasi:** YouTube, Instagram, TikTok, Facebook, Twitter/X, Pinterest va boshqa barcha ijtimoiy tarmoqlardagi video va rasmlarni **original sifatda**, **hech qanday sifat o'zgartirmasdan**, **tez va xatosiz** yuklab beruvchi Telegram bot.

---

## Texnologiyalar Steki

```
Runtime:       Node.js 20+ (yoki Python 3.11+)
Bot framework: node-telegram-bot-api (Node) yoki python-telegram-bot (Python)
Downloader:    yt-dlp (asosiy) + gallery-dl (rasmlar uchun)
Queue:         Bull (Redis-based) — parallel yuklamalar uchun
Storage:       /tmp/akir_downloads/ — vaqtinchalik saqlash
Proxy:         ixtiyoriy (geoblok bo'lsa)
```

---

## Loyiha Tuzilmasi

```
akir-media-bot/
├── CLAUDE.md               ← shu fayl
├── package.json
├── .env
├── src/
│   ├── bot.js              ← asosiy bot kirish nuqtasi
│   ├── downloader.js       ← yt-dlp + gallery-dl wrapper
│   ├── handler.js          ← xabar handlerlari
│   ├── queue.js            ← yuklab olish navbati
│   ├── platforms.js        ← platforma aniqlash
│   ├── uploader.js         ← Telegramga yuborish
│   └── utils.js            ← yordamchi funksiyalar
├── downloads/              ← vaqtinchalik yuklamalar papkasi
└── logs/
    └── bot.log
```

---

## O'rnatish va Sozlash

### 1. Kerakli dasturlarni o'rnatish

```bash
# Node.js o'rnatish
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# yt-dlp o'rnatish (eng muhim!)
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# ffmpeg o'rnatish (video birlashtirish uchun)
sudo apt-get install -y ffmpeg

# gallery-dl o'rnatish (rasmlar uchun)
pip3 install gallery-dl

# Redis o'rnatish (queue uchun)
sudo apt-get install -y redis-server
sudo systemctl start redis

# Loyiha paketlari
npm install node-telegram-bot-api bull axios dotenv winston fs-extra uuid
```

### 2. .env fayli

```env
BOT_TOKEN=your_telegram_bot_token_here
REDIS_URL=redis://127.0.0.1:6379
DOWNLOAD_PATH=./downloads
MAX_FILE_SIZE=2000          # MB — Telegram limiti 2GB
MAX_CONCURRENT_DOWNLOADS=5  # parallel yuklamalar soni
PROXY_URL=                  # ixtiyoriy: http://user:pass@host:port
ADMIN_ID=your_telegram_id
```

---

## Asosiy Kod

### src/bot.js — Kirish nuqtasi

```javascript
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { handleMessage } = require('./handler');
const { initQueue } = require('./queue');
const logger = require('./utils').logger;

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Queue boshlash
initQueue(bot);

// Xabarlarni qabul qilish
bot.on('message', async (msg) => {
  try {
    await handleMessage(bot, msg);
  } catch (err) {
    logger.error('Message handler error:', err);
    bot.sendMessage(msg.chat.id, '❌ Xato yuz berdi. Iltimos qayta urining.');
  }
});

// Polling xatoliklarini ushlab olish
bot.on('polling_error', (err) => {
  logger.error('Polling error:', err.message);
});

logger.info('🚀 Akir Media Bot ishga tushdi!');
```

---

### src/platforms.js — Platforma aniqlash

```javascript
const PLATFORMS = {
  youtube: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=[\w-]+/,
      /(?:https?:\/\/)?(?:www\.)?youtu\.be\/[\w-]+/,
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/[\w-]+/,
    ],
    name: 'YouTube',
    supportsAudio: true,
    supportsVideo: true,
    noSizeLimit: true, // Uzun videolar uchun
  },
  instagram: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[\w-]+/,
      /(?:https?:\/\/)?(?:www\.)?instagram\.com\/stories\/[\w]+\/\d+/,
    ],
    name: 'Instagram',
    supportsImages: true,
    supportsVideo: true,
  },
  tiktok: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[\w.]+\/video\/\d+/,
      /(?:https?:\/\/)?vm\.tiktok\.com\/[\w]+/,
    ],
    name: 'TikTok',
    supportsVideo: true,
  },
  facebook: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?facebook\.com\/.*\/videos\/\d+/,
      /(?:https?:\/\/)?(?:www\.)?fb\.watch\/[\w]+/,
      /(?:https?:\/\/)?(?:www\.)?facebook\.com\/watch\/?\?v=\d+/,
    ],
    name: 'Facebook',
    supportsVideo: true,
  },
  twitter: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?twitter\.com\/[\w]+\/status\/\d+/,
      /(?:https?:\/\/)?(?:www\.)?x\.com\/[\w]+\/status\/\d+/,
    ],
    name: 'Twitter/X',
    supportsVideo: true,
    supportsImages: true,
  },
  pinterest: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?pinterest\.com\/pin\/\d+/,
      /(?:https?:\/\/)?pin\.it\/[\w]+/,
    ],
    name: 'Pinterest',
    supportsImages: true,
    supportsVideo: true,
  },
  vimeo: {
    patterns: [/(?:https?:\/\/)?(?:www\.)?vimeo\.com\/\d+/],
    name: 'Vimeo',
    supportsVideo: true,
  },
  reddit: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?reddit\.com\/r\/[\w]+\/comments\/[\w]+/,
      /(?:https?:\/\/)?redd\.it\/[\w]+/,
    ],
    name: 'Reddit',
    supportsVideo: true,
    supportsImages: true,
  },
};

function detectPlatform(url) {
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    for (const pattern of platform.patterns) {
      if (pattern.test(url)) {
        return { key, ...platform };
      }
    }
  }
  // Noma'lum platforma — yt-dlp bilan sinab ko'ramiz
  return { key: 'unknown', name: 'Unknown', supportsVideo: true };
}

function extractUrl(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  return matches ? matches[0] : null;
}

module.exports = { detectPlatform, extractUrl, PLATFORMS };
```

---

### src/downloader.js — Yuklab olish engine

```javascript
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const logger = require('./utils').logger;

const DOWNLOAD_PATH = process.env.DOWNLOAD_PATH || './downloads';

// Papkani yaratish
fs.ensureDirSync(DOWNLOAD_PATH);

/**
 * Video sifatini aniqlash — original sifatni saqlash
 * yt-dlp format: bestvideo+bestaudio/best
 */
function getVideoFormat(platform) {
  // Barcha platformalar uchun eng yuqori sifat
  return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best';
}

/**
 * Asosiy video yuklab olish funksiyasi
 * @param {string} url - Video URL
 * @param {string} type - 'video' | 'audio' | 'image'
 * @param {function} progressCallback - Progress callback
 */
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
    // Papkani tozalash
    await fs.remove(outputDir).catch(() => {});
    throw err;
  }
}

/**
 * Video yuklab olish — original sifat, chegarasiz uzunlik
 */
async function downloadVideo(url, outputDir, progressCallback) {
  const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');
  
  const args = [
    url,
    '-f', getVideoFormat(),
    '--merge-output-format', 'mp4',
    '-o', outputTemplate,
    '--no-playlist',
    '--retries', '10',
    '--fragment-retries', '10',
    '--concurrent-fragments', '8',    // 8 parallel fragment yuklab olish
    '--buffer-size', '16K',
    '--http-chunk-size', '10M',
    '--socket-timeout', '30',
    '--no-warnings',
    '--progress',
    '--newline',
    '--write-info-json',              // metadata
  ];

  // Proxy bo'lsa qo'shamiz
  if (process.env.PROXY_URL) {
    args.push('--proxy', process.env.PROXY_URL);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let title = 'video';
    let filePath = null;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      
      // Progress aniqlash
      const progressMatch = text.match(/(\d+\.?\d*)%/);
      if (progressMatch && progressCallback) {
        progressCallback(parseFloat(progressMatch[1]));
      }
      
      // Fayl nomini aniqlash
      const destMatch = text.match(/\[download\] Destination: (.+)/);
      if (destMatch) filePath = destMatch[1].trim();
      
      const mergeMatch = text.match(/\[Merger\] Merging formats into "(.+)"/);
      if (mergeMatch) filePath = mergeMatch[1].trim();
    });

    proc.stderr.on('data', (data) => {
      logger.debug('yt-dlp stderr:', data.toString());
    });

    proc.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}`));
        return;
      }

      // Fayl topish
      if (!filePath || !fs.existsSync(filePath)) {
        const files = await fs.readdir(outputDir);
        const videoFile = files.find(f => 
          f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm')
        );
        if (videoFile) {
          filePath = path.join(outputDir, videoFile);
        }
      }

      if (!filePath) {
        reject(new Error('Yuklab olingan fayl topilmadi'));
        return;
      }

      const stat = await fs.stat(filePath);
      resolve({
        type: 'video',
        filePath,
        size: stat.size,
        title,
      });
    });

    proc.on('error', reject);
  });
}

/**
 * Audio yuklab olish — MP3 format
 */
async function downloadAudio(url, outputDir, progressCallback) {
  const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');
  
  const args = [
    url,
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',           // Eng yuqori sifat
    '-o', outputTemplate,
    '--no-playlist',
    '--retries', '10',
    '--concurrent-fragments', '8',
    '--no-warnings',
    '--newline',
  ];

  if (process.env.PROXY_URL) {
    args.push('--proxy', process.env.PROXY_URL);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let filePath = null;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const progressMatch = text.match(/(\d+\.?\d*)%/);
      if (progressMatch && progressCallback) {
        progressCallback(parseFloat(progressMatch[1]));
      }
      const destMatch = text.match(/\[download\] Destination: (.+)/);
      if (destMatch) filePath = destMatch[1].trim();
    });

    proc.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`Audio yuklab olishda xato: kod ${code}`));
        return;
      }

      if (!filePath || !fs.existsSync(filePath)) {
        const files = await fs.readdir(outputDir);
        const audioFile = files.find(f => f.endsWith('.mp3') || f.endsWith('.m4a'));
        if (audioFile) filePath = path.join(outputDir, audioFile);
      }

      if (!filePath) {
        reject(new Error('Audio fayl topilmadi'));
        return;
      }

      const stat = await fs.stat(filePath);
      resolve({ type: 'audio', filePath, size: stat.size });
    });

    proc.on('error', reject);
  });
}

/**
 * Rasmlarni yuklab olish — gallery-dl + yt-dlp
 */
async function downloadImages(url, outputDir, progressCallback) {
  // Avval gallery-dl bilan sinab ko'ramiz
  try {
    return await downloadWithGalleryDl(url, outputDir, progressCallback);
  } catch (e) {
    logger.debug('gallery-dl failed, trying yt-dlp for images');
    return await downloadWithYtDlp(url, outputDir, progressCallback);
  }
}

async function downloadWithGalleryDl(url, outputDir, progressCallback) {
  const args = [
    url,
    '-d', outputDir,
    '--no-download-archive',
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn('gallery-dl', args);
    const files = [];

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.includes(outputDir)) {
          const filePath = line.trim();
          if (fs.existsSync(filePath)) files.push(filePath);
        }
      });
    });

    proc.on('close', async (code) => {
      // Papkadagi barcha fayllarni topish
      const allFiles = await fs.readdir(outputDir);
      const imageFiles = allFiles
        .filter(f => /\.(jpg|jpeg|png|gif|webp|mp4|mov)$/i.test(f))
        .map(f => path.join(outputDir, f));

      if (imageFiles.length === 0) {
        reject(new Error('Hech qanday rasm topilmadi'));
        return;
      }

      resolve({ type: 'images', files: imageFiles, count: imageFiles.length });
    });

    proc.on('error', reject);
  });
}

async function downloadWithYtDlp(url, outputDir, progressCallback) {
  const outputTemplate = path.join(outputDir, '%(id)s.%(ext)s');
  
  const args = [
    url,
    '--write-thumbnail',
    '--skip-download',
    '-o', outputTemplate,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);

    proc.on('close', async (code) => {
      const allFiles = await fs.readdir(outputDir);
      const mediaFiles = allFiles
        .filter(f => /\.(jpg|jpeg|png|gif|webp|mp4|mov)$/i.test(f))
        .map(f => path.join(outputDir, f));

      if (mediaFiles.length === 0) {
        reject(new Error('Media fayl topilmadi'));
        return;
      }

      const isVideo = mediaFiles.some(f => /\.(mp4|mov|webm)$/i.test(f));
      resolve({
        type: isVideo ? 'video' : 'images',
        files: mediaFiles,
        filePath: mediaFiles[0],
        count: mediaFiles.length,
      });
    });

    proc.on('error', reject);
  });
}

/**
 * Vaqtinchalik fayllarni tozalash
 */
async function cleanup(outputDir) {
  try {
    await fs.remove(outputDir);
  } catch (e) {
    logger.error('Cleanup error:', e);
  }
}

module.exports = { downloadMedia, cleanup };
```

---

### src/handler.js — Xabar handleri

```javascript
const { detectPlatform, extractUrl } = require('./platforms');
const { addToQueue } = require('./queue');
const logger = require('./utils').logger;

const WELCOME_MESSAGE = `
🎬 *Akir Media Bot*ga xush kelibsiz!

📥 Men quyidagi platformalardan media yuklab beraman:

🔴 *YouTube* — har qanday uzunlikdagi video va audio
📸 *Instagram* — post, reel, stories, rasmlar
🎵 *TikTok* — videolar
📘 *Facebook* — videolar
🐦 *Twitter/X* — video va rasmlar
📌 *Pinterest* — rasmlar va videolar
🎞 *Vimeo* — videolar
🟠 *Reddit* — video va rasmlar

*Ishlatish:* Faqat havolani yuboring!
Havola yuborilgach, video yoki audio tanlash tugmasi chiqadi.
`;

async function handleMessage(bot, msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';

  // Start komandasi
  if (text === '/start') {
    return bot.sendMessage(chatId, WELCOME_MESSAGE, {
      parse_mode: 'Markdown',
    });
  }

  // Yordam komandasi
  if (text === '/help') {
    return bot.sendMessage(chatId, WELCOME_MESSAGE, { parse_mode: 'Markdown' });
  }

  // URL aniqlash
  const url = extractUrl(text);
  if (!url) {
    return bot.sendMessage(chatId, 
      '🔗 Iltimos, to\'g\'ri havola yuboring.\n\nMisol: https://youtube.com/watch?v=...'
    );
  }

  // Platforma aniqlash
  const platform = detectPlatform(url);
  
  logger.info(`New request: ${platform.name} | ${url} | User: ${chatId}`);

  // Inline keyboard — video yoki audio tanlash
  const keyboard = {
    inline_keyboard: [],
  };

  // Video tugmasi (barcha platformalar uchun)
  const videoRow = [
    { text: '🎬 Video yuklab olish', callback_data: `dl:video:${url}` },
  ];
  keyboard.inline_keyboard.push(videoRow);

  // Audio tugmasi (YouTube va boshqalar uchun)
  if (platform.supportsAudio || platform.key === 'youtube') {
    keyboard.inline_keyboard.push([
      { text: '🎵 Audio (MP3) yuklab olish', callback_data: `dl:audio:${url}` },
    ]);
  }

  await bot.sendMessage(
    chatId,
    `📎 *${platform.name}* havolasi aniqlandi!\n\nQaysi formatda yuklab olishni xohlaysiz?`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

async function handleCallbackQuery(bot, query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  if (!data.startsWith('dl:')) return;

  const parts = data.split(':');
  const type = parts[1];          // 'video' | 'audio'
  const url = parts.slice(2).join(':'); // URL ni qayta yig'ish

  // Callback tugmasini javoblash
  await bot.answerCallbackQuery(query.id, { text: '⏳ Yuklab olish boshlandi...' });
  
  // Keyboard o'chirish
  await bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    { chat_id: chatId, message_id: messageId }
  );

  // Navbatga qo'shish
  await addToQueue({ chatId, messageId, url, type });
}

module.exports = { handleMessage, handleCallbackQuery };
```

---

### src/queue.js — Parallel yuklab olish navbati

```javascript
const Queue = require('bull');
const { downloadMedia, cleanup } = require('./downloader');
const { uploadToTelegram } = require('./uploader');
const logger = require('./utils').logger;

let downloadQueue;

function initQueue(bot) {
  downloadQueue = new Queue('downloads', process.env.REDIS_URL);

  // Parallel ishlovchilar soni
  const concurrency = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 5;
  
  downloadQueue.process(concurrency, async (job) => {
    return await processDownload(bot, job);
  });

  downloadQueue.on('failed', async (job, err) => {
    logger.error(`Job ${job.id} failed:`, err.message);
    const { chatId } = job.data;
    try {
      await bot.sendMessage(chatId, 
        `❌ Yuklab olishda xato yuz berdi:\n${err.message}\n\nQayta urinib ko'ring.`
      );
    } catch (e) {}
  });

  logger.info(`Queue initialized with ${concurrency} concurrent workers`);
}

async function addToQueue(data) {
  await downloadQueue.add(data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    timeout: 30 * 60 * 1000, // 30 daqiqa maksimal vaqt
  });
}

async function processDownload(bot, job) {
  const { chatId, url, type } = job.data;
  let statusMessage;
  let outputDir;

  try {
    // Status xabari yuborish
    statusMessage = await bot.sendMessage(
      chatId,
      `⏳ *Yuklab olinmoqda...*\n\n0% ▱▱▱▱▱▱▱▱▱▱`,
      { parse_mode: 'Markdown' }
    );

    let lastProgress = 0;
    let lastUpdateTime = 0;

    // Progress callback
    const progressCallback = async (progress) => {
      const now = Date.now();
      // Har 3 sekundda bir yangilaymiz (Telegram rate limit)
      if (now - lastUpdateTime < 3000) return;
      if (Math.abs(progress - lastProgress) < 5) return;
      
      lastProgress = progress;
      lastUpdateTime = now;

      const filled = Math.floor(progress / 10);
      const empty = 10 - filled;
      const bar = '▰'.repeat(filled) + '▱'.repeat(empty);
      
      try {
        await bot.editMessageText(
          `⏳ *Yuklab olinmoqda...*\n\n${Math.round(progress)}% ${bar}`,
          {
            chat_id: chatId,
            message_id: statusMessage.message_id,
            parse_mode: 'Markdown',
          }
        );
      } catch (e) {}
    };

    // Yuklab olish
    const result = await downloadMedia(url, type, progressCallback);
    outputDir = result.outputDir;

    // Status yangilash
    await bot.editMessageText(
      '📤 *Telegramga yuklanmoqda...*',
      {
        chat_id: chatId,
        message_id: statusMessage.message_id,
        parse_mode: 'Markdown',
      }
    );

    // Telegramga yuborish
    await uploadToTelegram(bot, chatId, result);

    // Status o'chirish
    await bot.deleteMessage(chatId, statusMessage.message_id).catch(() => {});

  } catch (err) {
    logger.error('Download failed:', err);
    if (statusMessage) {
      await bot.editMessageText(
        `❌ Xato: ${err.message}`,
        { chat_id: chatId, message_id: statusMessage.message_id }
      ).catch(() => {});
    }
    throw err;
  } finally {
    // Vaqtinchalik fayllarni tozalash
    if (outputDir) {
      await cleanup(outputDir);
    }
  }
}

module.exports = { initQueue, addToQueue };
```

---

### src/uploader.js — Telegramga yuborish

```javascript
const fs = require('fs-extra');
const path = require('path');
const logger = require('./utils').logger;

const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE) || 2000) * 1024 * 1024; // 2GB

async function uploadToTelegram(bot, chatId, result) {
  const { type, filePath, files, size, title } = result;

  if (type === 'images' && files && files.length > 1) {
    // Bir nechta rasm — media group sifatida yuborish
    await sendMediaGroup(bot, chatId, files);
  } else if (type === 'images' && files) {
    // Bitta rasm
    await sendSingleImage(bot, chatId, files[0]);
  } else if (type === 'audio') {
    await sendAudio(bot, chatId, filePath);
  } else {
    // Video
    await sendVideo(bot, chatId, filePath, size);
  }
}

async function sendVideo(bot, chatId, filePath, size) {
  if (!fs.existsSync(filePath)) {
    throw new Error('Video fayl topilmadi');
  }

  const stat = await fs.stat(filePath);
  
  if (stat.size > MAX_FILE_SIZE) {
    // 2GB dan katta bo'lsa, xabar berish
    const sizeMB = (stat.size / 1024 / 1024).toFixed(0);
    await bot.sendMessage(
      chatId,
      `⚠️ Fayl hajmi juda katta (${sizeMB}MB).\n` +
      `Telegram maksimum 2GB qabul qiladi.\n\n` +
      `Iltimos, pastroq sifat tanlang yoki boshqa usul ishlating.`
    );
    return;
  }

  logger.info(`Sending video: ${filePath} (${(stat.size/1024/1024).toFixed(1)}MB)`);

  await bot.sendVideo(chatId, fs.createReadStream(filePath), {
    supports_streaming: true,
    caption: '✅ Akir Media Bot tomonidan yuklandi',
  });
}

async function sendAudio(bot, chatId, filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('Audio fayl topilmadi');
  }

  await bot.sendAudio(chatId, fs.createReadStream(filePath), {
    caption: '✅ Akir Media Bot tomonidan yuklandi',
  });
}

async function sendSingleImage(bot, chatId, filePath) {
  if (!fs.existsSync(filePath)) return;

  const ext = path.extname(filePath).toLowerCase();
  
  if (['.mp4', '.mov', '.webm'].includes(ext)) {
    await bot.sendVideo(chatId, fs.createReadStream(filePath));
  } else {
    await bot.sendPhoto(chatId, fs.createReadStream(filePath), {
      caption: '✅ Akir Media Bot tomonidan yuklandi',
    });
  }
}

async function sendMediaGroup(bot, chatId, files) {
  // Telegramda media group maksimum 10 ta
  const chunks = chunkArray(files, 10);
  
  for (const chunk of chunks) {
    const mediaGroup = chunk.map((filePath, index) => {
      const ext = path.extname(filePath).toLowerCase();
      const isVideo = ['.mp4', '.mov', '.webm'].includes(ext);
      
      return {
        type: isVideo ? 'video' : 'photo',
        media: fs.createReadStream(filePath),
        ...(index === 0 ? { caption: '✅ Akir Media Bot tomonidan yuklandi' } : {}),
      };
    });

    await bot.sendMediaGroup(chatId, mediaGroup);
  }
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

module.exports = { uploadToTelegram };
```

---

### src/utils.js — Logger

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta) : ''
      }`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: './logs/bot.log' }),
  ],
});

module.exports = { logger };
```

---

### package.json

```json
{
  "name": "akir-media-bot",
  "version": "1.0.0",
  "description": "Akir Media Telegram Bot — universal media downloader",
  "main": "src/bot.js",
  "scripts": {
    "start": "node src/bot.js",
    "dev": "nodemon src/bot.js",
    "pm2": "pm2 start src/bot.js --name akir-media-bot --max-memory-restart 500M"
  },
  "dependencies": {
    "node-telegram-bot-api": "^0.66.0",
    "bull": "^4.12.0",
    "axios": "^1.6.0",
    "dotenv": "^16.3.0",
    "winston": "^3.11.0",
    "fs-extra": "^11.2.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.0"
  }
}
```

---

## Bot o'rnatish va ishga tushirish

### 1-qadam: Telegram bot yaratish

```
1. @BotFather ga boring
2. /newbot yuboring
3. Bot nomi: Akir Media
4. Bot username: akir_media_bot (yoki boshqa)
5. Token oling va .env ga yozing
```

### 2-qadam: Loyihani sozlash

```bash
git clone <repo> akir-media-bot
cd akir-media-bot
npm install
mkdir -p downloads logs
cp .env.example .env
nano .env  # TOKEN va boshqa sozlamalarni kiriting
```

### 3-qadam: Ishga tushirish

```bash
# Test uchun
npm start

# Production uchun PM2 bilan
npm install -g pm2
pm2 start src/bot.js --name akir-media-bot
pm2 save
pm2 startup
```

### 4-qadam: Callback query handler qo'shish

`src/bot.js` ga qo'shing:

```javascript
const { handleCallbackQuery } = require('./handler');

bot.on('callback_query', async (query) => {
  try {
    await handleCallbackQuery(bot, query);
  } catch (err) {
    logger.error('Callback error:', err);
  }
});
```

---

## Xatoliklarni tuzatish

### yt-dlp yangilash (muhim!)

```bash
# Har hafta yangilab turing
yt-dlp -U
# yoki
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
```

### Instagram/TikTok uchun cookies

```bash
# Brauzerdan cookies eksport qiling
# Chrome: cookies.txt extension
yt-dlp --cookies cookies.txt <URL>
```

`.env` ga qo'shing:
```env
COOKIES_FILE=/path/to/cookies.txt
```

`downloader.js` da args ga qo'shing:
```javascript
if (process.env.COOKIES_FILE) {
  args.push('--cookies', process.env.COOKIES_FILE);
}
```

---

## Tezlikni oshirish bo'yicha maslahatlar

1. **`--concurrent-fragments 8`** — 8 ta parallel yuklab olish (allaqachon bor)
2. **Redis queue** — bir vaqtda 5 ta yuklab olish
3. **SSD server** — disk tezligi muhim
4. **Yaxshi tarmoq** — 1Gbps server tavsiya etiladi
5. **yt-dlp yangilab turish** — tezlik oshiriladi

---

## Xavfsizlik

- Bot token hech kimga bermang
- `.env` faylni `.gitignore` ga qo'shing
- Server firewallni sozlang
- Downloads papkasini muntazam tozalab turing

---

## Qo'llab-quvvatlanadigan platformalar to'liq ro'yxati

| Platforma | Video | Audio | Rasm |
|-----------|-------|-------|------|
| YouTube | ✅ | ✅ | — |
| Instagram | ✅ | — | ✅ |
| TikTok | ✅ | — | — |
| Facebook | ✅ | — | — |
| Twitter/X | ✅ | — | ✅ |
| Pinterest | ✅ | — | ✅ |
| Vimeo | ✅ | — | — |
| Reddit | ✅ | — | ✅ |
| + 1000+ sayt | ✅ | — | — |

---

*Akir Media Bot — tez, aniq, barqaror.*
