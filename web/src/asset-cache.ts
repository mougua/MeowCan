const SERVICE_WORKER_URL = import.meta.env.DEV ? '/sw.js?mode=development' : '/sw.js';
const CONTROLLER_WAIT_MS = 2_000;

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
