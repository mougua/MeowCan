import { defineConfig, type Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

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
