import { describe, expect, test } from 'bun:test';
import { SongVosDownloads } from './song-vos-downloads';

function vos(): ArrayBuffer {
  const buffer = new ArrayBuffer(12);
  new DataView(buffer).setUint32(0, 3, true);
  return buffer;
}

describe('playlist VOS downloads', () => {
  test('reuses a hot chart in memory without reopening persistent storage', async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    let opens = 0;
    let requests = 0;
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: { open: async () => {
        opens++;
        return { match: async () => undefined, put: async () => {} };
      } },
    });
    globalThis.fetch = async () => {
      requests++;
      return new Response(vos());
    };

    try {
      const downloads = new SongVosDownloads();
      await downloads.prefetch(['hot.vos']);
      expect(await downloads.load('hot.vos')).toEqual(vos());
      expect(opens).toBe(1);
      expect(requests).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis, 'caches', { configurable: true, value: originalCaches });
    }
  });

  test('tries songs in order, continues after a failure, and reuses saved VOS', async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const saved = new Map<string, Response>();
    const requests: string[] = [];
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: {
        open: async () => ({
          match: async (key: string) => saved.get(key)?.clone(),
          put: async (key: string, response: Response) => { saved.set(key, response.clone()); },
          delete: async (key: string) => saved.delete(key),
        }),
      },
    });
    globalThis.fetch = async (input) => {
      const path = String(input);
      requests.push(path);
      if (path.includes('missing.vos')) return new Response('missing', { status: 404 });
      if (path === '/songs/second.vos') return new Response('<html>Vite fallback</html>');
      return new Response(vos());
    };

    try {
      const downloads = new SongVosDownloads();
      await downloads.prefetch(['first.vos', 'missing.vos', 'second.vos']);
      expect(requests).toEqual([
        '/songs/first.vos',
        '/songs/missing.vos',
        '/CanFile/All/missing.vos',
        '/songs/second.vos',
        '/CanFile/All/second.vos',
      ]);
      expect(await downloads.load('first.vos')).toEqual(vos());
      expect(await downloads.load('second.vos')).toEqual(vos());
      expect(requests).toHaveLength(5);
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis, 'caches', { configurable: true, value: originalCaches });
    }
  });
});
