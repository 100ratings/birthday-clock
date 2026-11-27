const cacheName = 'birthday-clock-v1.0.50';
const files = ['./index.html','./style.css?v=1.0.50','./app.js?v=1.0.50','./aniversarios.txt','./manifest.webmanifest?v=1.0.50','./apple-touch-icon.png?v=1.0.50','./favicon-32x32.png?v=1.0.50','./favicon-16x16.png?v=1.0.50','./favicon.ico?v=1.0.50','./android-chrome-192x192.png?v=1.0.50','./android-chrome-512x512.png?v=1.0.50'];
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
  event.waitUntil((async () => {
    // Limpa apenas caches antigos deste aplicativo, sem afetar outros sites
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('birthday-clock-v') && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
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
  const forceFresh = navigation && url.searchParams.has('v') && url.searchParams.has('t');
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(cacheKey);
    if (cached && !forceFresh) return cached;
    try {
      const response = await fetch(request,{cache:forceFresh ? 'reload' : 'no-cache'});
      if (response.ok) await cache.put(cacheKey,response.clone());
      return response;
    } catch {
      if (cached) return cached;
      return Response.error();
    }
  })());
});
