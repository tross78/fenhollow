/* Fenhollow service worker — offline app-shell caching for PWA installs.
 *
 * The whole game (code + procedural assets) ships in the precached shell, so once
 * installed Fenhollow boots fully offline; only live P2P/arbiter networking needs
 * the network, and that fails gracefully on its own.
 *
 * CACHE_VERSION is stamped by scripts/build.mjs from the built main.js hash, so every
 * build that changes the bundle produces a new worker → install → fresh precache,
 * without needing hashed filenames.
 */
const CACHE_VERSION = '11e80684691e';
const CACHE_NAME = `fenhollow-${CACHE_VERSION}`;

// App shell. Relative to the worker's scope (the deploy root).
const SHELL = ['./', './index.html', './main.js', './styles.css', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL)
        // Optional encrypted module — exists only in protected ("code-DRM") builds. Added
        // separately/tolerantly so its absence in a normal build can't abort the precache.
        .then(() => cache.add('./protected.enc').catch(() => {})))
      // A single missing/renamed file shouldn't abort the whole install.
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('fenhollow-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only manage our own origin. WebRTC/tracker/arbiter traffic is left untouched.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so an online player always lands on the latest
  // shell, falling back to the cached index.html when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          cachePut(request, res.clone());
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('./index.html'))),
    );
    return;
  }

  // Static assets: stale-while-revalidate — instant from cache, refreshed in the
  // background so the next load is current.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          cachePut(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

function cachePut(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  caches.open(CACHE_NAME).then((cache) => cache.put(request, response)).catch(() => {});
}
