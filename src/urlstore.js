// Telegram callback_data limiti 64 bayt.
// URL ni xotirada saqlab, kalta ID beramiz.
// Bot qayta ishga tushganda ham URL lar 6 soat davomida saqlanadi.

const store = new Map();
let counter = 0;

const URL_TTL_MS = 6 * 60 * 60 * 1000; // 6 soat (avval 2 soat edi)

function saveUrl(url) {
  counter = (counter + 1) % 99999;
  const id = String(counter).padStart(5, '0');

  // Eski yozuvni tozalash (agar mavjud bo'lsa)
  if (store.has(id)) {
    const old = store.get(id);
    if (old._timer) clearTimeout(old._timer);
  }

  const timer = setTimeout(() => store.delete(id), URL_TTL_MS);

  store.set(id, { url, timer });
  return id;
}

function getUrl(id) {
  const entry = store.get(id);
  if (!entry) return null;
  return entry.url;
}

function storeSize() {
  return store.size;
}

module.exports = { saveUrl, getUrl, storeSize };
