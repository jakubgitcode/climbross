// Offline support: serve the app shell from cache, refresh it in the background.
const CACHE = 'climbross-v15-games';
const SHELL = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/game-records.js', 'js/climb.js', 'js/scale.js', 'js/ble.js', 'js/store.js', 'js/chart.js', 'js/training.js', 'js/coach.js', 'js/jump.js', 'js/ship.js', 'js/tug.js', 'js/cloud.js', 'js/profiles.js',
  'manifest.webmanifest', 'icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request, { cache: 'no-cache' })
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
