require('dotenv').config({ override: true });
const { detectPlatform, extractUrl } = require('./platforms');
const { addToQueue }  = require('./queue');
const { canUserDownload, setCooldown } = require('./ratelimit');
const { upsertUser, getAllActiveUsers, getUserStats, getDownloadStats, getBroadcasts } = require('./database');
const { saveUrl, getUrl } = require('./urlstore');
const { logger } = require('./utils');

const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;

// Admin suhbat holati (Broadcast jarayoni uchun)
const adminState = new Map(); // userId → { step, data }

// ---- Xabarlar ----
const WELCOME = (name) =>
`👋 Salom, <b>${esc(name)}</b>!

🎬 <b>Akir Media Bot</b>

Istalgan platformadan video yoki rasm yuklab bering.

🔴 YouTube · 📸 Instagram · 🎵 TikTok
📘 Facebook · 🐦 Twitter/X · 📌 Pinterest
🎞 Vimeo · 🟠 Reddit · 🌐 +1000 sayt

<b>Ishlatish:</b> Havolani yuboring, qolganini men qilaman.`;

const HELP =
`ℹ️ <b>Yordam</b>

<b>Qanday ishlaydi:</b>
• Havola yuboring → bot yuklab beradi
• YouTube → Video yoki Audio tanlaysiz
• Boshqalar → to'g'ridan-to'g'ri yuklanadi

<b>Qo'llab-quvvatlanadi:</b>
YouTube, Instagram, TikTok, Facebook, Twitter/X, Pinterest, Vimeo, Reddit va 1000+ sayt

<b>Muammo bo'lsa:</b>
👤 <a href="https://t.me/me_abdulloh_me">@me_abdulloh_me</a> ga murojat qiling`;

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---- Asosiy xabar handleri ----
async function handleMessage(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text   = msg.text || '';

  try { upsertUser(msg.from); } catch {}

  // Admin broadcast jarayonida xabar kutilmoqda
  if (userId === ADMIN_ID) {
    const state = adminState.get(userId);
    if (state) return handleAdminInput(bot, msg, state, chatId, userId);
  }

  if (text.startsWith('/')) {
    return handleCommand(bot, msg, chatId, userId);
  }

  const url = extractUrl(text);
  if (!url) {
    return bot.sendMessage(chatId,
      '🔗 Video yoki rasm havolasini yuboring.\n<i>Misol: https://youtu.be/...</i>',
      { parse_mode: 'HTML' }
    );
  }

  const check = canUserDownload(userId);
  if (!check.allowed) {
    if (check.reason === 'cooldown')      return bot.sendMessage(chatId, '⏳ Biroz kuting.');
    if (check.reason === 'too_many_jobs') return bot.sendMessage(chatId, '⚠️ 3 ta yuklash jarayonda. Birini kuting.');
  }
  setCooldown(userId);

  const platform = detectPlatform(url);
  logger.info(`URL: ${platform.name} | user:${userId}`);

  // YouTube → Video yoki Audio tanlash
  if (platform.supportsAudio || platform.key === 'youtube') {
    const urlId = saveUrl(url);
    const platformLabel = platform.emoji ? `${platform.emoji} <b>${platform.name}</b>` : '🎬 <b>Video</b>';
    return bot.sendMessage(chatId,
      `${platformLabel} — format tanlang:`,
      {
        parse_mode: 'HTML',
        reply_to_message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[
            { text: '🎬 Video (MP4)', callback_data: `v:${urlId}` },
            { text: '🎵 Audio (MP3)', callback_data: `a:${urlId}` },
          ]],
        },
      }
    );
  }

  // Boshqa barcha platformalar → to'g'ridan-to'g'ri yuklab olish
  const urlId = saveUrl(url);
  // Instagram /p/ carousel posts → images; all others → video
  const isImagePost = /instagram\.com\/(?:[\w.]+\/)?p\/[\w-]+/i.test(url) ||
                      platform.key === 'pinterest';
  await addToQueue({ chatId, userId, url, type: isImagePost ? 'image' : 'video', urlId });
  // Xabar yuborilmaydi — queue.js o'zi "Yuklab olinmoqda" deydi
}

// ---- Buyruqlar ----
async function handleCommand(bot, msg, chatId, userId) {
  const cmd = (msg.text || '').split(' ')[0].toLowerCase().split('@')[0];

  switch (cmd) {
    case '/start':
      return bot.sendMessage(chatId, WELCOME(msg.from.first_name), { parse_mode: 'HTML' });

    case '/help':
      return bot.sendMessage(chatId, HELP, { parse_mode: 'HTML', disable_web_page_preview: true });

    case '/status': {
      const { getQueueStats } = require('./queue');
      try {
        const s = await getQueueStats();
        return bot.sendMessage(chatId,
          `✅ <b>Bot ishlayapti</b>\n\n⏳ Navbat: ${s.waiting} · 🔄 Jarayonda: ${s.active}`,
          { parse_mode: 'HTML' }
        );
      } catch { return bot.sendMessage(chatId, '✅ Bot ishlayapti'); }
    }

    case '/admin':
      if (!ADMIN_ID || userId !== ADMIN_ID) return; // hech narsa qaytarmaymiz
      return showAdminMenu(bot, chatId);

    default:
      return bot.sendMessage(chatId, '❓ /help ni yuboring.');
  }
}

// ---- ADMIN TELEGRAM PANEL ----
async function showAdminMenu(bot, chatId) {
  const u = getUserStats();
  const d = getDownloadStats();
  await bot.sendMessage(chatId,
    `🔐 <b>Admin Panel</b>\n\n` +
    `👥 Foydalanuvchilar: <b>${u.total}</b> (bugun +${u.today})\n` +
    `📥 Yuklab olishlar: <b>${d.total}</b> (bugun ${d.today})\n` +
    `⚡ Faol (7 kun): <b>${u.active7}</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📢 E\'lon yuborish', callback_data: 'adm:broadcast' }],
          [{ text: '📊 Batafsil statistika', callback_data: 'adm:stats' }],
          [{ text: '🌐 Web panel', callback_data: 'adm:weblink' }],
        ],
      },
    }
  );
}

async function handleAdminInput(bot, msg, state, chatId, userId) {
  if (state.step === 'broadcast_wait') {
    // Admin xabar yuboryapti (matn yoki rasm)
    let broadcastData = {};

    if (msg.photo) {
      // Rasm + caption
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      broadcastData = { type: 'photo', fileId: photoId, caption: msg.caption || '' };
    } else if (msg.text) {
      broadcastData = { type: 'text', text: msg.text };
    } else {
      return bot.sendMessage(chatId, '⚠️ Matn yoki rasm yuboring.');
    }

    adminState.set(userId, { step: 'broadcast_confirm', data: broadcastData });

    const preview = broadcastData.type === 'photo'
      ? `📷 Rasm + "${broadcastData.caption}"`
      : `📝 "${broadcastData.text.substring(0, 100)}"`;

    const users = getAllActiveUsers();
    await bot.sendMessage(chatId,
      `📢 <b>Tasdiqlash</b>\n\n${esc(preview)}\n\n📬 Qabul qiluvchilar: <b>${users.length} ta</b>\n\nYuborilsinmi?`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Ha, yubor', callback_data: 'adm:broadcast_confirm' },
            { text: '❌ Bekor', callback_data: 'adm:broadcast_cancel' },
          ]],
        },
      }
    );
  }
}

// ---- Callback handler ----
async function handleCallbackQuery(bot, query) {
  const chatId    = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId    = query.from.id;
  const data      = query.data || '';

  // Admin callbacklari
  if (data.startsWith('adm:')) {
    if (!ADMIN_ID || userId !== ADMIN_ID) {
      await bot.answerCallbackQuery(query.id);
      return;
    }
    return handleAdminCallback(bot, query, chatId, messageId, userId, data.slice(4));
  }

  // URL callback: v:00001 / a:00001
  const colonIdx = data.indexOf(':');
  if (colonIdx === -1) return;
  const typeChar = data.substring(0, colonIdx);
  const urlId    = data.substring(colonIdx + 1);

  let type;
  if      (typeChar === 'v') type = 'video';
  else if (typeChar === 'a') type = 'audio';
  else if (typeChar === 'i') type = 'image';
  else return;

  const url = getUrl(urlId);
  if (!url) {
    await bot.answerCallbackQuery(query.id, { text: '❌ Havola eskirgan. Iltimos havolani qayta yuboring.' });
    await bot.editMessageText(
      '❌ <b>Havola eskirgan</b>\n\nIltimos havolani qayta yuboring.\n\n<i>Eslatma: Havolalar 6 soat saqlanadi.</i>',
      { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }
    ).catch(() => {});
    return;
  }

  await bot.answerCallbackQuery(query.id, { text: '⏳ Navbatga qo\'shildi!' });
  await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => {});
  await bot.editMessageText('⏳ Navbatga qo\'shildi, kuting...', { chat_id: chatId, message_id: messageId }).catch(() => {});

  await addToQueue({ chatId, userId, messageId, url, type });
}

async function handleAdminCallback(bot, query, chatId, messageId, userId, action) {
  await bot.answerCallbackQuery(query.id);

  if (action === 'broadcast') {
    adminState.set(userId, { step: 'broadcast_wait', data: null });
    await bot.editMessageText(
      '📢 <b>E\'lon yuborish</b>\n\nXabar matnini yoki rasm (caption bilan) yuboring:',
      { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }
    ).catch(() => {});
    return;
  }

  if (action === 'broadcast_confirm') {
    const state = adminState.get(userId);
    if (!state || !state.data) return;
    adminState.delete(userId);

    const users = getAllActiveUsers();
    await bot.editMessageText(`📢 Yuborilmoqda... (${users.length} ta)`, {
      chat_id: chatId, message_id: messageId,
    }).catch(() => {});

    let sent = 0, failed = 0;
    for (const u of users) {
      try {
        if (state.data.type === 'photo') {
          await bot.sendPhoto(u.chat_id, state.data.fileId, {
            caption: state.data.caption, parse_mode: 'HTML',
          });
        } else {
          await bot.sendMessage(u.chat_id, state.data.text, { parse_mode: 'HTML' });
        }
        sent++;
      } catch (e) {
        if (e.message && (e.message.includes('blocked') || e.message.includes('deactivated'))) {
          const { markBlocked } = require('./database');
          markBlocked(u.chat_id);
        }
        failed++;
      }
      if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1100));
    }

    const { saveBroadcast } = require('./database');
    saveBroadcast({
      title: 'Telegram orqali',
      message: state.data.text || state.data.caption || '',
      recipients: sent, failed,
    });

    await bot.sendMessage(chatId, `✅ <b>Yuborildi!</b>\n\n✔️ ${sent} ta muvaffaqiyatli\n❌ ${failed} ta xato`, { parse_mode: 'HTML' });
    return;
  }

  if (action === 'broadcast_cancel') {
    adminState.delete(userId);
    await bot.editMessageText('❌ Bekor qilindi.', { chat_id: chatId, message_id: messageId }).catch(() => {});
    return;
  }

  if (action === 'stats') {
    const recent = getBroadcasts(5);
    const byPlatform = getDownloadStats().byPlatform.slice(0, 5)
      .map(p => `  ${p.platform}: ${p.count}`).join('\n');
    await bot.editMessageText(
      `📊 <b>Platformalar:</b>\n${byPlatform || '  Ma\'lumot yo\'q'}\n\n📢 Oxirgi e\'lonlar: ${recent.length} ta`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }
    ).catch(() => {});
    return;
  }

  if (action === 'weblink') {
    const port = process.env.WEB_PORT || 3000;
    const secret = process.env.ADMIN_WEB_PATH || 'admin';
    await bot.editMessageText(
      `🌐 <b>Web Panel:</b>\n<code>http://localhost:${port}/${secret}</code>\n\nParol: <code>${process.env.ADMIN_PASSWORD || 'akir2024admin'}</code>`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }
    ).catch(() => {});
    return;
  }
}

module.exports = { handleMessage, handleCallbackQuery };
