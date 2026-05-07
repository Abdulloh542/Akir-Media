// Telegram callback_data limiti 64 bayt.
// URL ni xotirada saqlab, kalta ID beramiz.
const store = new Map();
let counter = 0;

function saveUrl(url) {
  counter = (counter + 1) % 99999;
  const id = String(counter).padStart(5, '0');
  store.set(id, url);
  // 2 soatdan keyin o'chiriladi
  setTimeout(() => store.delete(id), 2 * 60 * 60 * 1000);
  return id;
}

function getUrl(id) {
  return store.get(id) || null;
}

module.exports = { saveUrl, getUrl };
