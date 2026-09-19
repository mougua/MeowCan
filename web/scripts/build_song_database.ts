import fs from 'fs';
import path from 'path';
import { Database } from 'bun:sqlite';
import { parseVos } from '../src/parser/vos';

interface SongEntry {
  id: number;
  filename: string;
  genre: string;
  title: string;
  artist: string;
  charter: string;
  level: number;
  durationSec: number;
  notes: number;
  popularity: number;
}

const ROOT_DIR = path.resolve(__dirname, '..');
const CANFILE_DIR = path.join(ROOT_DIR, 'CanFile', 'All');
const DB_TXT_PATH = path.resolve(ROOT_DIR, '..', 'ref', 'MyCanMusic', 'MyCanMusicDB_Unicode.txt');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

console.log('--- Building Song Database ---');
console.log('CanFile dir:', CANFILE_DIR);
console.log('DB txt path:', DB_TXT_PATH);

const songsMap = new Map<string, SongEntry>();

// 1. Read MyCanMusicDB_Unicode.txt
if (fs.existsSync(DB_TXT_PATH)) {
  const content = fs.readFileSync(DB_TXT_PATH, 'utf16le');
  const lines = content.split(/\r?\n/);
  console.log(`Reading ${lines.length} lines from MyCanMusicDB_Unicode.txt...`);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length >= 7) {
      const idStr = parts[0].trim();
      const idNum = parseInt(idStr, 10);
      if (isNaN(idNum)) continue;

      const durationMs = parseInt(parts[6].trim(), 10) || 0;
      const entry: SongEntry = {
        id: idNum,
        filename: `${idNum}.vos`,
        genre: parts[1]?.trim() || 'other',
        title: parts[2]?.trim() || 'Untitled',
        artist: parts[3]?.trim() || 'Unknown',
        charter: parts[4]?.trim() || '',
        level: Math.max(1, Math.min(10, parseInt(parts[5]?.trim(), 10) || 1)),
        durationSec: Math.round(durationMs / 1000),
        notes: parseInt(parts[7]?.trim() || '0', 10) || 0,
        popularity: parseInt(parts[8]?.trim() || '0', 10) || 0
      };
      songsMap.set(String(idNum), entry);
    }
  }
  console.log(`Loaded ${songsMap.size} songs from DB txt.`);
}

// 2. Scan CanFile/All for any missing files or parsing
if (fs.existsSync(CANFILE_DIR)) {
  const files = fs.readdirSync(CANFILE_DIR);
  console.log(`Scanning ${files.length} files in CanFile/All...`);
  let parsedCount = 0;

  for (const f of files) {
    if (!f.toLowerCase().endsWith('.vos')) continue;
    const idStr = f.replace(/\.vos$/i, '');
    const idNum = parseInt(idStr, 10);
    if (isNaN(idNum)) continue;

    if (!songsMap.has(idStr)) {
      try {
        const filePath = path.join(CANFILE_DIR, f);
        const buf = fs.readFileSync(filePath);
        if (buf.length < 16) continue;

        const song = parseVos(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        const entry: SongEntry = {
          id: idNum,
          filename: f,
          genre: (song.genre || 'other').toLowerCase(),
          title: song.title || 'Untitled',
          artist: song.artist || 'Unknown',
          charter: song.arranger || '',
          level: Math.max(1, Math.min(10, song.level || 1)),
          durationSec: Math.round(song.durationSec || 0),
          notes: song.playableNotes?.length || 0,
          popularity: 0
        };
        songsMap.set(idStr, entry);
        parsedCount++;
      } catch (err) {
        console.warn(`Failed to parse ${f}:`, (err as Error).message);
      }
    }
  }
  console.log(`Parsed ${parsedCount} additional songs from CanFile/All.`);
}

const allSongs = Array.from(songsMap.values());
allSongs.sort((a, b) => a.id - b.id);
console.log(`Total indexed songs: ${allSongs.length}`);

// 3. Write SQLite database
const dbPaths = [
  path.join(ROOT_DIR, 'CanFile', 'songs.db'),
  path.join(PUBLIC_DIR, 'songs.db')
];

for (const dbPath of dbPaths) {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  const db = new Database(dbPath);
  db.run(`
    CREATE TABLE songs (
      id INTEGER PRIMARY KEY,
      filename TEXT NOT NULL,
      genre TEXT,
      title TEXT NOT NULL,
      artist TEXT,
      charter TEXT,
      level INTEGER,
      duration_sec INTEGER,
      notes INTEGER,
      popularity INTEGER
    )
  `);

  const insertStmt = db.prepare(`
    INSERT INTO songs (id, filename, genre, title, artist, charter, level, duration_sec, notes, popularity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const s of allSongs) {
      insertStmt.run(s.id, s.filename, s.genre, s.title, s.artist, s.charter, s.level, s.durationSec, s.notes, s.popularity);
    }
  })();

  db.run(`CREATE INDEX idx_songs_level ON songs(level)`);
  db.run(`CREATE INDEX idx_songs_genre ON songs(genre)`);
  db.run(`CREATE INDEX idx_songs_popularity ON songs(popularity)`);
  db.run(`CREATE INDEX idx_songs_title ON songs(title)`);
  db.close();
  console.log(`Saved SQLite database to: ${dbPath}`);
}

// 4. Write songs.json
const jsonPath = path.join(PUBLIC_DIR, 'songs.json');
fs.writeFileSync(jsonPath, JSON.stringify(allSongs));
console.log(`Saved JSON index (${(fs.statSync(jsonPath).size / 1024).toFixed(1)} KB) to: ${jsonPath}`);
console.log('--- Song Database Build Complete ---');
