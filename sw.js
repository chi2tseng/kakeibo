/* sw.js — network-first，離線時用快取（app shell + 上次資料皆可離線開啟） */
const CACHE = 'kakeibo-v12';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const host = new URL(e.request.url).hostname;
  // Google Sheet CSV 每次帶時間戳、URL 都不同 → 不進 SW 快取（否則無限增長）；離線資料由 localStorage 負責
  // 收據照片（storage.googleapis.com）本身帶一年瀏覽器快取 → 也不進 SW 快取，避免越存越大
  if (host.endsWith('google.com') || host === 'storage.googleapis.com') return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request))
  );
});
