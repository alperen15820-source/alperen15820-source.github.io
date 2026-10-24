// Uygulama kabuğunu önbelleğe alır; veri her zaman önce ağdan denenir.
const CACHE = 'kanal-takip-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  if (url.pathname.endsWith('/state.json')) {
    // Ağ yoksa son bilinen veriyi göster
    const key = url.origin + url.pathname;
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(key, res.clone()));
          return res;
        })
        .catch(() => caches.match(key).then((r) => r || Response.error())),
    );
    return;
  }

  if (url.origin === location.origin) {
    // Önbellekten hızlı aç, arkada güncelle
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const fresh = fetch(e.request)
          .then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    );
  }
});
