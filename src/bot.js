require('dotenv').config({ override: true });
const TelegramBot = require('node-telegram-bot-api');
const { handleMessage, handleCallbackQuery } = require('./handler');
const { initQueue } = require('./queue');
const { startWebServer, setBot } = require('./web/server');
const { logger } = require('./utils');
const fs = require('fs-extra');

if (!process.env.BOT_TOKEN) {
  logger.error('BOT_TOKEN .env faylida topilmadi!');
  process.exit(1);
}

fs.ensureDirSync('./downloads');
fs.ensureDirSync('./logs');
fs.ensureDirSync('./data');
fs.ensureDirSync('./public/uploads');

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10,
      allowed_updates: ['message', 'callback_query'],
    },
  },
  filepath: false,
});

// Queue va web server boshlash
initQueue(bot);
setBot(bot);
startWebServer();

// Xabarlarni qabul qilish
bot.on('message', async (msg) => {
  try {
    await handleMessage(bot, msg);
  } catch (err) {
    logger.error('Message handler error:', err.stack || err.message || String(err));
    try {
      await bot.sendMessage(msg.chat.id, '❌ Ichki xato yuz berdi. Qayta urinib ko\'ring.');
    } catch (e) {}
  }
});

// Callback query
bot.on('callback_query', async (query) => {
  try {
    await handleCallbackQuery(bot, query);
  } catch (err) {
    logger.error('Callback handler error:', err.message);
    try {
      await bot.answerCallbackQuery(query.id, { text: '❌ Xato yuz berdi' });
    } catch (e) {}
  }
});

bot.on('polling_error', (err) => {
  const code = err.code || '';
  const msg = err.message || JSON.stringify(err);
  if (code === 'ETELEGRAM' && msg.includes('409')) {
    logger.error('Bot allaqachon boshqa joyda ishlamoqda!');
    process.exit(1);
  }
  if (!msg.includes('EFATAL')) {
    logger.error(`Polling error [${code}]: ${msg}`);
  }
});

bot.on('error', (err) => {
  logger.error('Bot error:', err.message);
});

process.on('SIGINT', () => { logger.info('Bot to\'xtatilmoqda...'); bot.stopPolling(); process.exit(0); });
process.on('SIGTERM', () => { logger.info('Bot to\'xtatilmoqda...'); bot.stopPolling(); process.exit(0); });
process.on('uncaughtException', (err) => { logger.error('Uncaught exception:', err.message); });
process.on('unhandledRejection', (reason) => { logger.error('Unhandled rejection:', String(reason)); });

logger.info('🚀 Akir Media Bot ishga tushdi!');
logger.info(`Admin ID: ${process.env.ADMIN_ID || 'sozlanmagan'}`);
