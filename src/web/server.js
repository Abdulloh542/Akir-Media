require('dotenv').config({ override: true });
const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const fs      = require('fs-extra');
const db      = require('../database');
const { logger } = require('../utils');

const app = express();
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD  || 'akir2024admin';
const SESSION_SECRET  = process.env.SESSION_SECRET  || 'akir-secret-key-change-me';
const WEB_PORT        = parseInt(process.env.WEB_PORT) || 3000;
const ADMIN_WEB_PATH  = process.env.ADMIN_WEB_PATH  || 'x9admin2024'; // secret path

const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');
fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(path.join(process.cwd(), 'public'));

// ---- Middleware ----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 soat
}));

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|png|gif|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Faqat rasm fayllari ruxsat etiladi'));
  },
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Kirish taqiqlangan' });
  return res.redirect('/login.html');
}

// ---- Public routes ----
app.get('/', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'index.html')));

// /admin — boshqalarga hech narsa ko'rsatilmaydi (404, body yo'q)
app.get('/admin', (req, res) => res.status(404).end());
app.get('/admin/*', (req, res) => res.status(404).end());
app.get('/login.html', (req, res) => res.status(404).end());

// Secret admin login page
app.get(`/${ADMIN_WEB_PATH}`, (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.sendFile(path.join(process.cwd(), 'public', 'admin.html'));
  }
  res.sendFile(path.join(process.cwd(), 'public', 'login.html'));
});

// ---- Auth ----
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Parol noto\'g\'ri' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/auth-check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.isAdmin) });
});

// ---- Admin routes (protected, secret path) ----
app.get(`/${ADMIN_WEB_PATH}/panel`, requireAdmin, (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'admin.html'));
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  try {
    const users     = db.getUserStats();
    const downloads = db.getDownloadStats();
    const broadcasts = db.getBroadcasts(5);
    res.json({ users, downloads, broadcasts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const page   = parseInt(req.query.page) || 0;
  const limit  = 50;
  const users  = db.getUserList(limit, page * limit);
  const stats  = db.getUserStats();
  res.json({ users, total: stats.total });
});

app.get('/api/admin/broadcasts', requireAdmin, (req, res) => {
  res.json(db.getBroadcasts(50));
});

// Broadcast yuborish
app.post('/api/admin/broadcast', requireAdmin, upload.single('image'), async (req, res) => {
  const { title, message, link_url, link_text, button_text } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Xabar matni bo\'sh bo\'lishi mumkin emas' });
  }

  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
  const users = db.getAllActiveUsers();

  if (users.length === 0) {
    return res.status(400).json({ error: 'Foydalanuvchilar topilmadi' });
  }

  res.json({
    ok: true,
    message: `Yuborish boshlandi: ${users.length} ta foydalanuvchi`,
    total: users.length,
  });

  // Fonga yuborish
  setImmediate(() => sendBroadcast({
    title, message: message.trim(),
    image_path: imagePath,
    link_url: link_url || null,
    link_text: link_text || null,
    button_text: button_text || null,
    users,
  }));
});

// Global bot reference
let _bot = null;
function setBot(bot) { _bot = bot; }

async function sendBroadcast(data) {
  if (!_bot) { logger.error('Broadcast: bot reference yo\'q'); return; }

  let sent = 0, failed = 0;
  const keyboard = (data.link_url) ? {
    inline_keyboard: [[{ text: data.button_text || data.link_text || '🔗 Batafsil', url: data.link_url }]],
  } : null;

  for (const user of data.users) {
    try {
      if (data.image_path) {
        const imgPath = path.join(process.cwd(), 'public', data.image_path);
        if (fs.existsSync(imgPath)) {
          await _bot.sendPhoto(user.chat_id, fs.createReadStream(imgPath), {
            caption: data.message,
            parse_mode: 'HTML',
            reply_markup: keyboard || undefined,
          });
        } else {
          await _bot.sendMessage(user.chat_id, data.message, {
            parse_mode: 'HTML',
            reply_markup: keyboard || undefined,
            disable_web_page_preview: false,
          });
        }
      } else {
        await _bot.sendMessage(user.chat_id, data.message, {
          parse_mode: 'HTML',
          reply_markup: keyboard || undefined,
          disable_web_page_preview: false,
        });
      }
      sent++;
    } catch (e) {
      if (e.message && (e.message.includes('blocked') || e.message.includes('deactivated'))) {
        db.markBlocked(user.chat_id);
      }
      failed++;
    }

    // Telegram rate limit: ~25 msg/sek
    if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1100));
  }

  db.saveBroadcast({ ...data, recipients: sent, failed });
  logger.info(`Broadcast completed: ${sent} sent, ${failed} failed`);
}

function startWebServer() {
  app.listen(WEB_PORT, () => {
    logger.info(`🌐 Web server: http://localhost:${WEB_PORT}`);
    logger.info(`🔐 Admin panel: http://localhost:${WEB_PORT}/admin`);
  });
}

module.exports = { startWebServer, setBot };
