// Service Worker: online immer die neueste Version, offline aus dem Cache (Solo-Modus).
const CACHE = 'ubongo-v5';
const SHELL = [
  '.', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg',
  'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/game.js', 'js/board.js', 'js/ai.js', 'js/net.js',
  'js/highscore.js', 'js/cardgen.js', 'js/pieces.js', 'js/sound.js', 'js/gems.js',
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
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Netzwerk zuerst: online kommt immer der aktuelle Stand, der Cache wird
  // dabei aufgefrischt und dient nur offline als Reserve. Antwortet der
  // Server für eine Navigation mit einem Fehler (404/50x), bekommt eine
  // installierte App die gespeicherte Version statt der Fehlerseite.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }
      if (e.request.mode === 'navigate') {
        return caches.match(e.request)
          .then(hit => hit || caches.match('index.html'))
          .then(hit => hit || res);
      }
      return caches.match(e.request).then(hit => hit || res);
    }).catch(() =>
      caches.match(e.request).then(hit =>
        hit || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))
    )
  );
});
