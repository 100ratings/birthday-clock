const cacheName = 'birthday-clock-v13';
const files = ['./index.html','./style.css?v=13','./app.js?v=13','./aniversarios.txt','./manifest.webmanifest','./icon.png','./icon-large.png'];
const scope = self.registration.scope;
const allowed = new Set(files.map(file => new URL(file,scope).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(files.map(file => new Request(new URL(file,scope),{cache:'reload'})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const navigation = request.mode === 'navigate' &&
    (url.pathname === new URL(scope).pathname || url.pathname === new URL('index.html',scope).pathname) &&
    url.origin === self.location.origin;
  if (!navigation && !allowed.has(url.href)) return;
  const cacheKey = navigation ? new URL('index.html',scope).href : url.href;
  event.respondWith((async () => {
    try {
      const response = await fetch(request,{cache:'no-cache'});
      if (response.ok) return response;
      return (await (await caches.open(cacheName)).match(cacheKey)) || response;
    } catch {
      return (await (await caches.open(cacheName)).match(cacheKey)) || Response.error();
    }
  })());
});
