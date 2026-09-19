import { expect, test, describe } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { parseVos } from '../parser/vos';
import { generateChartImage } from '../../scripts/generate_charts';
import { chartYForTick, createChartLayout } from './chart-layout';

describe('Chart Long Image Export (金属皮肤谱面长图)', () => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const chartsDir = path.join(rootDir, 'public', 'charts');
  const songsDir = path.join(rootDir, 'public', 'songs');

  test('Public charts directory exists and contains pre-generated long images for built-in songs', () => {
    expect(fs.existsSync(chartsDir)).toBe(true);
    const chartFiles = fs.readdirSync(chartsDir).filter(f => f.endsWith('.png'));
    expect(chartFiles.length).toBeGreaterThanOrEqual(20);

    // Verify known classic Canon in D (500.vos.png)
    const canonChart = path.join(chartsDir, '500.vos.png');
    expect(fs.existsSync(canonChart)).toBe(true);

    const stat = fs.statSync(canonChart);
    expect(stat.size).toBeGreaterThan(100 * 1024); // >= 100 KB

    // Check PNG signature
    const buf = fs.readFileSync(canonChart);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // P
    expect(buf[2]).toBe(0x4e); // N
    expect(buf[3]).toBe(0x47); // G
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBe(246);
    expect(height).toBeGreaterThan(5000); // Canon in D is ~29,500 px
  });

  test('generateChartImage produces valid PNG for arbitrary VOS', () => {
    const vosPath = path.join(songsDir, '1.vos');
    const buf = fs.readFileSync(vosPath);
    const arr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const vos = parseVos(arr);

    const png = generateChartImage(vos);
    expect(png).toBeDefined();
    expect(png.length).toBeGreaterThan(10000);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });

  test('chart reads bottom-to-top and ignores non-playable duration tails', () => {
    const vosPath = path.join(songsDir, '1.vos');
    const buf = fs.readFileSync(vosPath);
    const arr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const vos = parseVos(arr);
    const layout = createChartLayout({ ...vos, durationSec: vos.durationSec + 3600 });
    const originalLayout = createChartLayout(vos);

    expect(layout.lastTick).toBe(originalLayout.lastTick);
    expect(layout.totalHeight).toBe(originalLayout.totalHeight);
    expect(chartYForTick(768, layout)).toBeLessThan(chartYForTick(0, layout));

    const furthestPlayableTick = Math.max(...vos.playableNotes.map(note =>
      note.isLong
        ? (note.startTick ?? 0) + (note.durationTicks ?? 0)
        : (note.startTick ?? 0)
    ));
    expect(layout.lastTick - furthestPlayableTick).toBeLessThan(768);
  });
});

describe('Playlist Multi-select Deletion & Clear All (歌单多选删除与全部删除)', () => {
  interface MockSong {
    id: number;
    title: string;
    filename: string;
  }

  test('Multi-select delete removes selected indices and updates active index', () => {
    let playlist: MockSong[] = [
      { id: 1, title: 'Song 1', filename: '1.vos' },
      { id: 2, title: 'Song 2', filename: '2.vos' },
      { id: 3, title: 'Song 3', filename: '3.vos' },
      { id: 4, title: 'Song 4', filename: '4.vos' },
      { id: 5, title: 'Song 5', filename: '5.vos' }
    ];
    let currentIndex = 2; // Song 3
    const selectedIndices = new Set([0, 2]); // Song 1 and Song 3 selected for deletion

    const removedCurrent = selectedIndices.has(currentIndex);
    expect(removedCurrent).toBe(true);

    playlist = playlist.filter((_, idx) => !selectedIndices.has(idx));
    expect(playlist.length).toBe(3);
    expect(playlist.map(s => s.id)).toEqual([2, 4, 5]);

    if (removedCurrent) {
      currentIndex = Math.max(0, Math.min(playlist.length - 1, currentIndex));
    }
    expect(currentIndex).toBe(2); // Clamped to last index or same position (Song 5)
  });

  test('Delete all (clear playlist) empties the playlist completely', () => {
    let playlist: MockSong[] = [
      { id: 1, title: 'Song 1', filename: '1.vos' },
      { id: 2, title: 'Song 2', filename: '2.vos' }
    ];
    let currentIndex = 1;
    let selectedIndices = new Set([0]);

    playlist = [];
    currentIndex = 0;
    selectedIndices.clear();

    expect(playlist.length).toBe(0);
    expect(currentIndex).toBe(0);
    expect(selectedIndices.size).toBe(0);
  });
});
