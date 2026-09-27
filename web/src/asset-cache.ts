const SERVICE_WORKER_URL = import.meta.env.DEV ? '/sw.js?mode=development' : '/sw.js';
const CONTROLLER_WAIT_MS = 2_000;
const SOUND_FONT_CACHE = 'meowcan-soundfonts-v1';

/**
 * Activates the production asset cache before Pixi and WebAudio request their
 * large static files. Failure is non-fatal: normal browser requests still work.
 */
export async function initializeAssetCache(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await waitForController();
  } catch (error) {
    console.warn('[MeowCan] Persistent asset cache is unavailable.', error);
  }
}

/** Requests eviction-resistant storage when the browser supports it. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Reports whether a large optional asset is already in the app-managed cache. */
export async function isAssetCached(url: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    return Boolean(await (await caches.open(SOUND_FONT_CACHE)).match(url, { ignoreSearch: true })
      ?? await caches.match(url, { ignoreSearch: true }));
  } catch {
    return false;
  }
}

export async function getCachedSoundFont(url: string): Promise<Response | undefined> {
  if (typeof caches === 'undefined') return undefined;
  try {
    const cache = await caches.open(SOUND_FONT_CACHE);
    const saved = await cache.match(url, { ignoreSearch: true });
    if (saved) return saved;
    const legacy = await caches.match(url, { ignoreSearch: true });
    if (legacy) {
      try {
        await cache.put(new URL(url, location.origin).pathname, legacy.clone());
      } catch (error) {
        console.warn('[MeowCan] Could not migrate the SoundFont cache.', error);
      }
      return legacy;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function cacheSoundFont(url: string, bytes: ArrayBuffer): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(SOUND_FONT_CACHE);
    await cache.put(new URL(url, location.origin).pathname, new Response(bytes, {
      headers: { 'Content-Type': 'application/octet-stream' },
    }));
  } catch (error) {
    console.warn('[MeowCan] Could not persist the SoundFont in the browser cache.', error);
  }
}

function waitForController(): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, CONTROLLER_WAIT_MS);
    navigator.serviceWorker.addEventListener('controllerchange', finish);
  });
}
