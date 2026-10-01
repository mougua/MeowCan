const CACHE_NAME = 'meowcan-song-vos-v1';

/** Shares active requests and keeps downloaded charts for later playlist playback. */
export class SongVosDownloads {
  private inFlight = new Map<string, Promise<ArrayBuffer>>();
  private prefetchGeneration = 0;

  async load(filename: string): Promise<ArrayBuffer> {
    const existing = this.inFlight.get(filename);
    if (existing) return existing;

    const pending = this.loadOrFetch(filename);
    this.inFlight.set(filename, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(filename) === pending) this.inFlight.delete(filename);
    }
  }

  /** Starts one request at a time in playlist order; failures do not stop the queue. */
  prefetch(filenames: readonly string[], isCurrent: () => boolean = () => true): Promise<void> {
    const generation = ++this.prefetchGeneration;
    return (async () => {
      for (const filename of filenames) {
        if (generation !== this.prefetchGeneration || !isCurrent()) return;
        try {
          await this.load(filename);
        } catch (error) {
          console.warn(`Could not prefetch ${filename}:`, error);
        }
      }
    })();
  }

  private async loadOrFetch(filename: string): Promise<ArrayBuffer> {
    const key = `/songs/${encodeURIComponent(filename)}`;
    const cache = await this.openCache();
    try {
      const saved = await cache?.match(key);
      if (saved) {
        const buffer = await saved.arrayBuffer();
        if (isVos(buffer)) return buffer;
        await cache?.delete(key);
      }
    } catch (error) {
      console.warn(`Could not read cached ${filename}:`, error);
    }

    for (const path of [key, `/CanFile/All/${encodeURIComponent(filename)}`]) {
      try {
        const response = await fetch(path, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) continue;
        const buffer = await response.arrayBuffer();
        // Vite may answer a missing static file with index.html and HTTP 200.
        if (!isVos(buffer)) continue;
        try {
          await cache?.put(key, new Response(buffer));
        } catch (error) {
          console.warn(`Could not cache ${filename}:`, error);
        }
        return buffer;
      } catch (error) {
        console.warn(`Could not fetch ${path}:`, error);
      }
    }
    throw new Error(`Failed to fetch ${filename}`);
  }

  private async openCache(): Promise<Cache | undefined> {
    if (typeof caches === 'undefined') return undefined;
    try {
      return await caches.open(CACHE_NAME);
    } catch {
      return undefined;
    }
  }
}

function isVos(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const count = new DataView(buffer).getUint32(0, true);
  return count >= 2 && count <= 10;
}
