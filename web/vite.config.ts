import { defineConfig, type Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

interface SoundFontManifestEntry {
  id: string;
  filename: string;
  name: string;
  sizeBytes: number;
  url: string;
}

const SOUND_FONT_MANIFEST_PATH = '/assets/soundfonts/manifest.json';

function readSoundFontName(filename: string): string | null {
  const descriptor = fs.openSync(filename, 'r');
  try {
    const stat = fs.fstatSync(descriptor);
    const riffHeader = Buffer.alloc(12);
    if (fs.readSync(descriptor, riffHeader, 0, riffHeader.length, 0) !== riffHeader.length
      || riffHeader.toString('ascii', 0, 4) !== 'RIFF'
      || riffHeader.toString('ascii', 8, 12) !== 'sfbk') return null;

    let offset = 12;
    while (offset + 12 <= stat.size) {
      const header = Buffer.alloc(12);
      if (fs.readSync(descriptor, header, 0, header.length, offset) !== header.length) break;
      const chunkId = header.toString('ascii', 0, 4);
      const chunkSize = header.readUInt32LE(4);
      if (chunkId === 'LIST' && header.toString('ascii', 8, 12) === 'INFO') {
        const infoEnd = Math.min(stat.size, offset + 8 + chunkSize);
        let infoOffset = offset + 12;
        while (infoOffset + 8 <= infoEnd) {
          const infoHeader = Buffer.alloc(8);
          fs.readSync(descriptor, infoHeader, 0, infoHeader.length, infoOffset);
          const infoId = infoHeader.toString('ascii', 0, 4);
          const infoSize = infoHeader.readUInt32LE(4);
          if (infoId === 'INAM' && infoSize > 0 && infoSize <= 16_384) {
            const value = Buffer.alloc(infoSize);
            fs.readSync(descriptor, value, 0, infoSize, infoOffset + 8);
            return value.toString('utf8').replace(/\0.*$/s, '').trim() || null;
          }
          infoOffset += 8 + infoSize + (infoSize & 1);
        }
      }
      if (chunkSize > stat.size || offset + 8 + chunkSize <= offset) break;
      offset += 8 + chunkSize + (chunkSize & 1);
    }
    return null;
  } finally {
    fs.closeSync(descriptor);
  }
}

function soundFontManifest(projectRoot: string): SoundFontManifestEntry[] {
  const directory = path.resolve(projectRoot, 'public', 'assets', 'soundfonts');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name === 'MagicSFver2.sf2')
    .map(entry => {
      const fullPath = path.join(directory, entry.name);
      const stat = fs.statSync(fullPath);
      const fallbackName = path.basename(entry.name, path.extname(entry.name))
        .replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
      return {
        id: entry.name,
        filename: entry.name,
        name: readSoundFontName(fullPath) || fallbackName,
        sizeBytes: stat.size,
        url: `/assets/soundfonts/${encodeURIComponent(entry.name)}`,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

function canMusicDbPlugin(): Plugin {
  const projectRoot = import.meta.dirname;
  const songDirectories = [
    path.resolve(projectRoot, 'CanFile', 'All'),
    path.resolve(projectRoot, 'CanFile'),
    path.resolve(projectRoot, '..', 'ref', 'MyCanMusic', 'CanFile', 'All')
  ];

  return {
    name: 'canmusic-db-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost:3000');

        if (url.pathname === SOUND_FONT_MANIFEST_PATH) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(soundFontManifest(projectRoot)));
          return;
        }

        // Serve /songs/:file with fallback to CanFile/All/:file
        if (url.pathname.startsWith('/songs/')) {
          const filename = path.basename(url.pathname);
          const candidates = [
            path.resolve(projectRoot, 'public', 'songs', filename),
            ...songDirectories.map(directory => path.resolve(directory, filename))
          ];
          for (const cand of candidates) {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
              res.setHeader('Content-Type', 'application/octet-stream');
              fs.createReadStream(cand).pipe(res);
              return;
            }
          }
        }

        next();
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: SOUND_FONT_MANIFEST_PATH.slice(1),
        source: JSON.stringify(soundFontManifest(projectRoot), null, 2),
      });
    },
    transformIndexHtml(html) {
      return html.replace(/<script type="module"/g, '<script type="module" data-cfasync="false"');
    },
    closeBundle() {
      const source = songDirectories.find(directory => fs.existsSync(directory));
      if (!source) {
        console.warn('[canmusic] Full song directory was not found; the build only contains public/songs.');
        return;
      }

      const destination = path.resolve(projectRoot, 'dist', 'songs');
      fs.mkdirSync(destination, { recursive: true });
      fs.cpSync(source, destination, { recursive: true, force: true });
      console.log(`[canmusic] Copied the full song library to ${destination}.`);
    }
  };
}

export default defineConfig({
  plugins: [canMusicDbPlugin()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/health': 'http://127.0.0.1:8080'
    },
    fs: {
      allow: ['..']
    },
    watch: {
      ignored: [
        '**/dist/**',
        '**/CanFile/**',
        '**/node_modules/**',
        '**/*.db',
        '**/*.db-journal'
      ]
    }
  },
  build: {
    target: 'es2022',
    emptyOutDir: false
  }
});
