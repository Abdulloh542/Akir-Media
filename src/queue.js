require('dotenv').config({ override: true });
const Queue = require('bull');
const { downloadMedia, cleanup, NonRetryableError } = require('./downloader');
const { uploadToTelegram } = require('./uploader');
const { incrementJobs, decrementJobs } = require('./ratelimit');
const { trackDownload } = require('./database');
const { detectPlatform } = require('./platforms');
const { logger, buildProgressBar } = require('./utils');

let downloadQueue;

function initQueue(bot) {
  downloadQueue = new Queue('akir-downloads', process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    settings: {
      stalledInterval: 120000,   // 2 daqiqa (avval 60s edi)
      maxStalledCount: 2,
    },
    defaultJobOptions: {
      attempts: 2,               // 2 urinish (avval 3 edi — ortiqcha)
      backoff: { type: 'exponential', delay: 5000 },
      timeout: 120 * 60 * 1000, // 2 soat (avval 35 daqiqa — uzun video uchun yetmaydi)
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  });

  const concurrency = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 5;
  downloadQueue.process(concurrency, async (job) => processDownload(bot, job));

  downloadQueue.on('failed', async (job, err) => {
    const errMsg = err?.message || err?.toString() || 'Noma\'lum xato';
    logger.error(`Job ${job.id} failed (${job.attemptsMade}/${job.opts.attempts}): ${errMsg}`);
    // decrementJobs is handled in processDownload's finally block
    try { trackDownload(job.data.chatId, detectPlatform(job.data.url).name, job.data.type, 'failed'); } catch {}
  });

  downloadQueue.on('error', (err) => logger.error('Queue error:', err.message));
  downloadQueue.on('stalled', (job) => logger.warn(`Job ${job.id} stalled`));

  logger.info(`Queue: ${concurrency} parallel worker`);
  return downloadQueue;
}

async function addToQueue(data) {
  if (!downloadQueue) throw new Error('Queue ishga tushirilmagan');
  if (data.userId) incrementJobs(data.userId);
  const job = await downloadQueue.add(data);
  logger.info(`Job ${job.id}: ${data.type} | ${(data.url || '').substring(0, 60)}`);
  return job;
}

async function processDownload(bot, job) {
  const { chatId, userId, url, type } = job.data;
  let statusMsg = null;
  let outputDir = null;

  const typeLabel = type === 'audio' ? '🎵 Audio' : type === 'image' ? '🖼 Rasmlar' : '🎬 Video';

  try {
    statusMsg = await bot.sendMessage(chatId,
      `⏳ <b>Yuklab olinmoqda...</b>\n\n0% ${buildProgressBar(0)}\n${typeLabel}`,
      { parse_mode: 'HTML' }
    );

    let lastPct = -1, lastUpdate = 0;

    const onProgress = async (info) => {
      const now = Date.now();
      const pct = Math.round(info.percent || 0);
      if (now - lastUpdate < 3000 || Math.abs(pct - lastPct) < 3) return;
      lastPct = pct; lastUpdate = now;

      const bar = buildProgressBar(pct);
      const speed = info.speed ? `\n⚡ ${info.speed}` : '';
      const size  = info.total ? ` · 📦 ${info.total}` : '';

      try {
        await bot.editMessageText(
          `⏳ <b>Yuklab olinmoqda...</b>\n\n${pct}% ${bar}${size}${speed}\n${typeLabel}`,
          { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
        );
      } catch {}
    };

    const result = await downloadMedia(url, type, onProgress);
    outputDir = result.outputDir;

    await bot.editMessageText('📤 <b>Telegramga yuklanmoqda...</b>', {
      chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML',
    }).catch(() => {});

    await uploadToTelegram(bot, chatId, result);
    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
    statusMsg = null;

    try { trackDownload(chatId, detectPlatform(url).name, type, 'success'); } catch {}
    logger.info(`Job ${job.id} done`);

  } catch (err) {
    logger.error(`Job ${job.id} error:`, err.message);

    // Non-retryable: discard so Bull won't retry
    if (err.nonRetryable) {
      try { await job.discard(); } catch {}
    }

    // Show error to user only on last attempt or non-retryable
    const isFinalAttempt = err.nonRetryable || job.attemptsMade >= (job.opts.attempts || 2);
    if (isFinalAttempt) {
      const errMsg = `❌ <b>Yuklab bo'lmadi:</b>\n${err?.message || String(err)}`;
      if (statusMsg) {
        await bot.editMessageText(errMsg, {
          chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML',
        }).catch(async () => {
          await bot.sendMessage(chatId, errMsg, { parse_mode: 'HTML' }).catch(() => {});
        });
        statusMsg = null;
      } else {
        await bot.sendMessage(chatId, errMsg, { parse_mode: 'HTML' }).catch(() => {});
      }
    } else if (statusMsg) {
      await bot.editMessageText(
        `⚠️ Xato yuz berdi, qayta urinilmoqda... (${job.attemptsMade}/${job.opts.attempts || 2})`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      ).catch(() => {});
    }

    throw err;
  } finally {
    if (userId) decrementJobs(userId);
    if (outputDir) await cleanup(outputDir);
  }
}

async function getQueueStats() {
  if (!downloadQueue) return { waiting: 0, active: 0, completed: 0, failed: 0 };
  const [waiting, active, completed, failed] = await Promise.all([
    downloadQueue.getWaitingCount(),
    downloadQueue.getActiveCount(),
    downloadQueue.getCompletedCount(),
    downloadQueue.getFailedCount(),
  ]);
  return { waiting, active, completed, failed };
}

module.exports = { initQueue, addToQueue, getQueueStats };
