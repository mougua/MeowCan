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
    engine.setNotes(song.playableNotes, song.tempoMap);
    const events = song.playableNotes.flatMap(note => [
      { time: note.startSec, type: 'down' as const, note },
      ...(note.isLong ? [{ time: note.startSec + note.durationSec, type: 'up' as const, note }] : [])
    ]).sort((a, b) => a.time - b.time || (a.type === 'up' ? -1 : 1));
    for (const event of events) {
      engine.update(event.time);
      if (event.type === 'down') {
        expect(engine.onKeyDown(event.note.lane, event.time)?.rating).toBe('COOL');
        expect(event.note.instrument?.program).toBeGreaterThanOrEqual(0);
        expect(event.note.instrument?.program).toBeLessThan(128);
      } else {
        expect(engine.onKeyUp(event.note.lane, event.time)?.rating).toBe('COOL');
      }
    }
    engine.update(song.durationSec + 1);
    expect(engine.score.missCount).toBe(0);
    expect(engine.score.coolCount).toBe(keys.length);
    expect(song.playableNotes.every(n => !n.isLong || n.holdCompleted)).toBe(true);
    if (file === '500.vos') expect(keys.length).toBe(1121);
  });
}
