const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const fs = require('fs-extra');

fs.ensureDirSync('./data');

const adapter = new FileSync('./data/akir.json');
const db = low(adapter);

db.defaults({
  users: [],
  downloads: [],
  broadcasts: [],
}).write();

// ---- USERS ----

function upsertUser(from) {
  const existing = db.get('users').find({ chat_id: from.id }).value();
  if (existing) {
    db.get('users').find({ chat_id: from.id }).assign({
      username: from.username || null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      last_seen: Math.floor(Date.now() / 1000),
    }).write();
  } else {
    db.get('users').push({
      chat_id: from.id,
      username: from.username || null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      created_at: Math.floor(Date.now() / 1000),
      last_seen: Math.floor(Date.now() / 1000),
      downloads: 0,
      is_blocked: false,
    }).write();
  }
}

function getAllActiveUsers() {
  return db.get('users').filter({ is_blocked: false }).value();
}

function markBlocked(chatId) {
  db.get('users').find({ chat_id: chatId }).assign({ is_blocked: true }).write();
}

function getUserStats() {
  const all = db.get('users').value();
  const now = Math.floor(Date.now() / 1000);
  const total = all.length;
  const active7 = all.filter(u => u.last_seen > now - 604800).length;
  const today = all.filter(u => u.created_at > now - 86400).length;
  return { total, active7, today };
}

function getUserList(limit = 100, offset = 0) {
  return db.get('users')
    .orderBy(['last_seen'], ['desc'])
    .slice(offset, offset + limit)
    .value();
}

// ---- DOWNLOADS ----

function trackDownload(chatId, platform, type, status = 'success') {
  const id = db.get('downloads').value().length + 1;
  db.get('downloads').push({
    id,
    chat_id: chatId,
    platform: platform || 'unknown',
    type,
    status,
    created_at: Math.floor(Date.now() / 1000),
  }).write();

  if (status === 'success') {
    const u = db.get('users').find({ chat_id: chatId }).value();
    if (u) {
      db.get('users').find({ chat_id: chatId }).assign({ downloads: (u.downloads || 0) + 1 }).write();
    }
  }
}

function getDownloadStats() {
  const all = db.get('downloads').value();
  const now = Math.floor(Date.now() / 1000);
  const total = all.length;
  const today = all.filter(d => d.created_at > now - 86400).length;
  const success = all.filter(d => d.status === 'success').length;

  const platformCount = {};
  all.forEach(d => { platformCount[d.platform] = (platformCount[d.platform] || 0) + 1; });
  const byPlatform = Object.entries(platformCount)
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { total, today, success, byPlatform };
}

// ---- BROADCASTS ----

function saveBroadcast(data) {
  const id = db.get('broadcasts').value().length + 1;
  db.get('broadcasts').push({
    id,
    title: data.title || '',
    message: data.message,
    image_path: data.image_path || null,
    link_url: data.link_url || null,
    link_text: data.link_text || null,
    button_text: data.button_text || null,
    sent_at: Math.floor(Date.now() / 1000),
    recipients: data.recipients || 0,
    failed: data.failed || 0,
  }).write();
  return id;
}

function getBroadcasts(limit = 30) {
  return db.get('broadcasts')
    .orderBy(['sent_at'], ['desc'])
    .slice(0, limit)
    .value();
}

module.exports = {
  upsertUser, getAllActiveUsers, markBlocked, getUserStats, getUserList,
  trackDownload, getDownloadStats,
  saveBroadcast, getBroadcasts,
};
