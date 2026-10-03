// Service worker : rend l'application installable et utilisable hors ligne.
// Les musiques ne passent jamais par ici (elles sont lues depuis IndexedDB).
const VERSION = 'sillon-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/views.js', 'js/player.js', 'js/library.js', 'js/metadata.js',
  'js/db.js', 'js/art.js', 'js/icons.js', 'js/util.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Polices Google : cache d'abord.
  if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(request).then(hit => hit || fetch(request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(request, copy));
      return res;
    })));
    return;
  }

  // Fichiers de l'appli : réseau d'abord, en revalidant toujours auprès du serveur
  // (sinon le cache HTTP de GitHub Pages peut servir une ancienne version pendant 10 min),
  // cache si hors ligne.
  if (url.origin === location.origin) {
    e.respondWith(fetch(request, { cache: 'no-cache' }).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(request, copy));
      }
      return res;
    }).catch(() => caches.match(request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
  }
});
