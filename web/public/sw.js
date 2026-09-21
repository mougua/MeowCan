const CACHE_PREFIX = 'meowcan-assets-';
const IS_DEVELOPMENT = new URL(self.location.href).searchParams.get('mode') === 'development';
const CACHE_NAME = `${CACHE_PREFIX}${IS_DEVELOPMENT ? 'dev-' : ''}v1`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (!isCacheableRequest(request)) return;
  const cacheWork = cacheFirst(request);
  event.respondWith(cacheWork.then(result => result.response));
  event.waitUntil(cacheWork.then(result => result.cacheWrite));
});

function isCacheableRequest(request) {
  if (request.method !== 'GET' || request.headers.has('range')) return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;

  // Keep source images live-reloadable under Vite. Large, rarely-changing audio
  // files are still persisted so local development does not download them again.
  if (IS_DEVELOPMENT) {
    return url.pathname.startsWith('/assets/soundfonts/')
      || url.pathname.startsWith('/assets/sounds/');
  }

  return url.pathname === '/songs.json'
    || url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/songs/')
    || url.pathname.startsWith('/charts/');
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return { response: cached, cacheWrite: Promise.resolve() };

  const response = await fetch(request);
  let cacheWrite = Promise.resolve();
  if (response.ok && response.type !== 'opaque') {
    // A full cache can still serve the current request. Cache writes are best-effort.
    cacheWrite = cache.put(request, response.clone()).catch(error => {
      console.warn('[MeowCan] Could not persist an asset in the browser cache.', error);
    });
  }
  return { response, cacheWrite };
}
