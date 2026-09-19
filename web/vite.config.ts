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

        // SQLite query endpoint /api/songs
        if (url.pathname === '/api/songs') {
          try {
            const dbPath = path.resolve(import.meta.dirname, 'public', 'songs.db');
            if (fs.existsSync(dbPath)) {
              let rows: any[] = [];
              const q = url.searchParams.get('q') || '';
              const levels = url.searchParams.get('levels');
              const genre = url.searchParams.get('genre') || '';
              const sort = url.searchParams.get('sort') || 'popularity';
              const order = url.searchParams.get('order')?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
              const limit = parseInt(url.searchParams.get('limit') || '200', 10);
              const offset = parseInt(url.searchParams.get('offset') || '0', 10);

              let whereClauses: string[] = [];
              let params: any[] = [];

              if (q) {
                whereClauses.push(`(title LIKE ? OR artist LIKE ? OR charter LIKE ? OR CAST(id AS TEXT) LIKE ?)`);
                const term = `%${q}%`;
                params.push(term, term, term, term);
              }

              if (levels) {
                const lvlArr = levels.split(',').map(l => parseInt(l, 10)).filter(l => !isNaN(l));
                if (lvlArr.length > 0) {
                  whereClauses.push(`level IN (${lvlArr.map(() => '?').join(',')})`);
                  params.push(...lvlArr);
                }
              }

              if (genre && genre !== '所有' && genre !== 'all') {
                whereClauses.push(`genre = ?`);
                params.push(genre.toLowerCase());
              }

              const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
              const validSorts: Record<string, string> = {
                id: 'id',
                title: 'title',
                level: 'level',
                popularity: 'popularity',
                duration: 'duration_sec',
                notes: 'notes'
              };
              const sortCol = validSorts[sort] || 'popularity';
              const sql = `SELECT * FROM songs ${whereSql} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`;
              params.push(limit, offset);

              // Use node:sqlite or bun:sqlite depending on runtime
              try {
                if (typeof (process.versions as any)?.bun !== 'undefined') {
                  const { Database } = require('bun:sqlite');
                  const db = new Database(dbPath);
                  rows = db.query(sql).all(...params);
                  db.close();
                } else {
                  const { DatabaseSync } = require('node:sqlite');
                  const db = new DatabaseSync(dbPath);
                  rows = db.prepare(sql).all(...params);
                  db.close();
                }
              } catch (sqlErr) {
                console.error('SQLite execution error:', sqlErr);
                throw sqlErr;
              }

              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify(rows));
              return;
            }
          } catch (err) {
            console.error('API /api/songs error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: (err as Error).message }));
            return;
          }
        }

        next();
      });
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
    target: 'es2022'
  }
});
