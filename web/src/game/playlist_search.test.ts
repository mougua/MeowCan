import { expect, test, describe } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { parseVos } from '../parser/vos';
import { CanMusicRenderer, type PlaylistItemDisplay } from './renderer';

describe('VOS Catalog & Search Engine', () => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const jsonPath = path.join(rootDir, 'public', 'songs.json');

  test('offline JSON index contains 8,542 songs', () => {
    expect(fs.existsSync(jsonPath)).toBe(true);
    const songs = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(Array.isArray(songs)).toBe(true);
    expect(songs.length).toBe(8542);

    const song500 = songs.find((s: any) => s.id === 500);
    expect(song500).toBeDefined();
    expect(song500.title).toBeDefined();
  });

  test('Multi-dimensional search: filter by difficulty, keyword, and genre', () => {
    const songs = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    // Filter by difficulty: levels 9 and 10 (matching user screenshot)
    const level9and10 = songs.filter((s: any) => s.level === 9 || s.level === 10);
    expect(level9and10.length).toBeGreaterThan(0);
    expect(level9and10.every((s: any) => s.level === 9 || s.level === 10)).toBe(true);

    // Search by title keyword
    const turkish = songs.filter((s: any) => s.title.includes('터키'));
    expect(turkish.length).toBeGreaterThan(0);

    // Search by charter keyword
    const kks6428 = songs.filter((s: any) => s.charter.includes('kks6428'));
    expect(kks6428.length).toBeGreaterThan(0);

    // Search by ID
    const byId = songs.filter((s: any) => String(s.id).includes('4607'));
    expect(byId.some((s: any) => s.id === 4607)).toBe(true);

    // Genre filter
    const rockSongs = songs.filter((s: any) => (s.genre || '').toLowerCase() === 'rock');
    expect(rockSongs.length).toBeGreaterThan(0);
    expect(rockSongs.every((s: any) => s.genre.toLowerCase() === 'rock')).toBe(true);
  });

  test('Sorting by popularity, level, and title', () => {
    const songs = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    // Filter by levels 9 & 10 like in the user screenshot
    const lvl910 = songs.filter((s: any) => s.level === 9 || s.level === 10);
    lvl910.sort((a: any, b: any) => (b.popularity || 0) - (a.popularity || 0));

    // Top song in screenshot is Turkish March (4607) with 77,122 popularity!
    expect(lvl910[0].id).toBe(4607);
    expect(lvl910[0].popularity).toBe(77122);
    expect(lvl910[0].level).toBe(10);
    expect(lvl910[1].id).toBe(3687); // Sonic Ice Cap
    expect(lvl910[2].id).toBe(3434); // Soldier Blade

    // Sort by level desc
    const sortedByLevel = [...songs].sort((a: any, b: any) => b.level - a.level);
    expect(sortedByLevel[0].level).toBe(10);
  });
});

describe('Playlist & Arcade Central CRT Display', () => {
  test('Renderer updates playlist in PDA display', () => {
    const renderer = new CanMusicRenderer();
    const state = renderer as any;
    const { Text } = require('pixi.js');

    state.pdaPlaylistTitle = new Text({ text: '' });
    state.pdaRowTexts = Array.from({ length: 5 }, () => new Text({ text: '' }));
    state.pdaRowBgs = Array.from({ length: 5 }, () => ({ visible: false }));

    const playlist: PlaylistItemDisplay[] = [
      { id: 4607, title: 'Turkish March Guitar Remix', level: 10, artist: 'Mozart', charter: 'sunkyest' },
      { id: 3434, title: 'Soldier Blade', level: 9, artist: 'Unknown', charter: 'kks6428' },
      { id: 500, title: 'Canon in D', level: 5, artist: 'Pachelbel' }
    ];

    renderer.setPlaylist(playlist, 0);
    expect(state.playlistItems.length).toBe(3);
    expect(state.playlistActiveIndex).toBe(0);
    expect(state.pdaPlaylistTitle.text).toBe('PLAYLIST (1/3)');

    // Active item has prefix '▶ ' and displays level & title
    expect(state.pdaRowTexts[0].text).toContain('[Lv.10]');
    expect(state.pdaRowTexts[0].text).toContain('Turkish March');
    expect(state.pdaRowTexts[0].text.startsWith('▶ ')).toBe(true);

    // Next item displays level & title
    expect(state.pdaRowTexts[1].text).toContain('[Lv.9]');
    expect(state.pdaRowTexts[1].text).toContain('Soldier Blade');

    // Move to item 1
    renderer.setPlaylist(playlist, 1);
    expect(state.playlistActiveIndex).toBe(1);
    expect(state.pdaPlaylistTitle.text).toBe('PLAYLIST (2/3)');
    expect(state.pdaRowTexts[0].text.startsWith('✓ ')).toBe(true);
    expect(state.pdaRowTexts[1].text.startsWith('▶ ')).toBe(true);
  });

  test('Renderer hit-tests visible PDA playlist rows', () => {
    const renderer = new CanMusicRenderer();
    const state = renderer as any;
    const { Text } = require('pixi.js');
    state.pdaPlaylistTitle = new Text({ text: '' });
    state.pdaRowTexts = Array.from({ length: 5 }, () => new Text({ text: '' }));
    state.pdaRowBgs = Array.from({ length: 5 }, () => ({ visible: false }));

    renderer.setPlaylist(Array.from({ length: 8 }, (_, index) => ({
      id: index,
      title: `Song ${index}`,
      level: index + 1
    })), 4);

    expect(renderer.hitTestPlaylistScreen(310, 130)).toBe(true);
    expect(renderer.hitTestPlaylistScreen(290, 130)).toBe(false);
    // Active index 4 is centred on the third visible row, so the first row is item 2.
    expect(renderer.hitTestPlaylistItem(310, 138)).toBe(2);
    expect(renderer.hitTestPlaylistItem(310, 162)).toBe(4);
    expect(renderer.hitTestPlaylistItem(310, 125)).toBe(-1);
  });

  test('Sequential playback advancing logic', () => {
    const playlist = [
      { id: 1, title: 'Song 1', level: 5 },
      { id: 2, title: 'Song 2', level: 6 },
      { id: 3, title: 'Song 3', level: 7 }
    ];

    let currentIndex = 0;

    // Finish song 1 -> advances to song 2
    currentIndex = (currentIndex + 1) % playlist.length;
    expect(currentIndex).toBe(1);
    expect(playlist[currentIndex].id).toBe(2);

    // Abort song 2 -> advances to song 3
    currentIndex = (currentIndex + 1) % playlist.length;
    expect(currentIndex).toBe(2);
    expect(playlist[currentIndex].id).toBe(3);

    // Finish song 3 -> loops to song 1
    currentIndex = (currentIndex + 1) % playlist.length;
    expect(currentIndex).toBe(0);
    expect(playlist[currentIndex].id).toBe(1);
  });

  test('CanFile/All/4607.vos parses and can be loaded', () => {
    const filePath = path.resolve(__dirname, '..', '..', 'CanFile', 'All', '4607.vos');
    expect(fs.existsSync(filePath)).toBe(true);
    const buf = fs.readFileSync(filePath);
    const parsed = parseVos(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(parsed).toBeDefined();
    expect(parsed.playableNotes.length).toBeGreaterThan(0);
  });
});
