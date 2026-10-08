const CACHE = 'leitor-academico-v3';
const APP = ['./','./index.html','./styles.css','./app.js','./manifest.webmanifest'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP))));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
    const copy = resp.clone();
    if (new URL(e.request.url).origin === self.location.origin) caches.open(CACHE).then(c => c.put(e.request, copy));
    return resp;
  }).catch(() => r)));
});
