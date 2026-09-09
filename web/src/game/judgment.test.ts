import { describe, expect, test } from 'bun:test';
import { JudgmentEngine } from './judgment';
import type { PlayableNote } from '../parser/vos';

function note(overrides: Partial<PlayableNote> = {}): PlayableNote {
  return { id: 0, lane: 0, startSec: 1, durationSec: 1, midiNote: 60,
    velocity: 100, track: 0, isLong: false, judged: false, ...overrides };
}

describe('playable note state', () => {
  test('hits and misses update the objects used by rendering; restart clears them', () => {
    const notes = [note(), note({ id: 1, lane: 1 })];
    const engine = new JudgmentEngine();
    engine.setNotes(notes);
    expect(engine.onKeyDown(0, 1)?.rating).toBe('COOL');
    expect(notes[0].judged).toBe(true);
    expect(engine.onKeyDown(0, 1)).toBeNull();
    engine.update(1.2);
    expect(notes[1].hitScore).toBe('MISS');
    engine.setNotes(notes);
    expect(notes.every(n => !n.judged && n.hitScore === undefined)).toBe(true);
    expect(engine.score.score).toBe(0);
  });

  test('an early long-note release breaks combo and ends the visible hold', () => {
    const held = note({ isLong: true });
    const engine = new JudgmentEngine();
    engine.setNotes([held]);
    engine.onKeyDown(0, 1);
    expect(held.holdActive).toBe(true);
    expect(engine.onKeyUp(0, 1.3)?.rating).toBe('BAD');
    expect(held.holdActive).toBe(false);
    expect(held.holdCompleted).toBe(false);
    expect(engine.score.combo).toBe(0);
  });

  test('hold rewards follow elapsed song time at 30 and 144 fps', () => {
    function play(fps: number) {
      const held = note({ isLong: true });
      const engine = new JudgmentEngine();
      engine.setNotes([held]);
      engine.onKeyDown(0, 1);
      for (let frame = 1; frame <= fps; frame++) engine.update(1 + frame / fps);
      expect(held.holdCompleted).toBe(true);
      expect(held.holdActive).toBe(false);
      const score = engine.score.score;
      expect(engine.onKeyUp(0, 2.01)).toBeNull();
      expect(engine.score.score).toBe(score);
      expect(engine.score.combo).toBe(2);
      return engine.score;
    }
    expect(play(30)).toEqual(play(144));
  });
});
