// Service Worker: App-Hülle vorab speichern, damit Ubongo offline läuft (Solo-Modus).
const CACHE = 'ubongo-v2';
const SHELL = [
  '.', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg',
  'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/game.js', 'js/board.js', 'js/ai.js', 'js/net.js',
  'js/highscore.js', 'js/cardgen.js', 'js/pieces.js', 'js/sound.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/ws') || url.pathname.startsWith('/api/')) return; // live
  e.respondWith(
    caches.match(e.request).then(hit => hit ||
      fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET' && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }))
  );
});
