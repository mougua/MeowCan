import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { parseVos } from './vos';
import { JudgmentEngine } from '../game/judgment';

const songs = new URL('../../public/songs/', import.meta.url);
for (const file of readdirSync(songs)) {
  test(`${file}: one judgment per visible note, full chart playable without misses`, async () => {
    const song = parseVos(await Bun.file(new URL(file, songs)).arrayBuffer());
    const keys = song.playableNotes.map(n => `${n.lane}:${n.startSec}`);
    expect(new Set(keys).size).toBe(keys.length);
    const engine = new JudgmentEngine();
    engine.setNotes(song.playableNotes);
    for (const note of song.playableNotes) {
      engine.update(note.startSec);
      expect(engine.onKeyDown(note.lane, note.startSec)?.rating).toBe('COOL');
      expect(note.instrument?.program).toBeGreaterThanOrEqual(0);
      expect(note.instrument?.program).toBeLessThan(128);
    }
    engine.update(song.durationSec + 1);
    expect(engine.score.missCount).toBe(0);
    expect(engine.score.coolCount).toBe(keys.length);
    expect(song.playableNotes.every(n => !n.isLong || n.holdCompleted)).toBe(true);
    if (file === '500.vos') expect(keys.length).toBe(1121);
  });
}
