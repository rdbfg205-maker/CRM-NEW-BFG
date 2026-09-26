/* BASPAR FOAM SMART CRM — Service Worker v4
   - JS/CSS/HTML: network-first (code updates always win; cache = offline fallback)
   - fonts/images: cache-first
   - API: network-first, cache fallback
*/
const CACHE = 'baspar-crm-v5';
const SHELL = [
  '/', '/index.html', '/css/app.css', '/js/main.js', '/js/core.js', '/js/ui.js',
  '/js/resource-view.js', '/js/vendor/jalali.js',
  '/assets/logo-selen.png', '/assets/logo-baspar.png',
  '/assets/logo-full.png', '/assets/logo-mark.png',
  '/assets/icon-192.png', '/assets/icon-512.png',
  '/fonts/vazirmatn-var.woff2', '/manifest.webmanifest',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const p = url.pathname;
  const isCode = p.startsWith('/js/') || p.endsWith('.js') || p.endsWith('.css') || p === '/' || p === '/index.html';
  const isStatic = p.startsWith('/fonts/') || p.startsWith('/assets/') || p === '/manifest.webmanifest';
  // code + html: network first, fall back to cache (offline)
  if (isCode) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((m) => m || caches.match('/index.html')))
    );
    return;
  }
  // fonts/images: cache first
  if (isStatic) {
    e.respondWith(
      caches.match(req).then((m) => m || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => new Response('', { status: 504 })))
    );
    return;
  }
  // API: network first, stale fallback
  if (p.startsWith('/api/')) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req).then((m) => m || new Response(JSON.stringify({ error: { code: 'OFFLINE', message: 'آفلاین هستید' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    );
    return;
  }
});
