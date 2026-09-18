import { describe, expect, test } from 'bun:test';
import { JudgmentEngine } from './judgment';
import type { PlayableNote, TempoPoint } from '../parser/vos';

function note(overrides: Partial<PlayableNote> = {}): PlayableNote {
  return {
    id: 0,
    lane: 0,
    startSec: 1,
    durationSec: 1,
    startTick: 1536,
    durationTicks: 1536,
    midiNote: 60,
    velocity: 100,
    track: 0,
    isLong: false,
    judged: false,
    ...overrides
  };
}

describe('original CanMusic judgment', () => {
  test('uses the recovered 210/360/600 tick bands', () => {
    const cases: Array<[number, string]> = [
      [1 + 210 / 1536, 'COOL'],
      [1 + 211 / 1536, 'BAD'],
      [1 + 360 / 1536, 'BAD'],
      [1 + 361 / 1536, 'MISS'],
      [1 + 599 / 1536, 'MISS']
    ];
    for (const [time, rating] of cases) {
      const engine = new JudgmentEngine();
      engine.setNotes([note()]);
      expect(engine.onKeyDown(0, time)?.rating).toBe(rating);
    }

    const engine = new JudgmentEngine();
    engine.setNotes([note()]);
    expect(engine.onKeyDown(0, 1 + 600 / 1536)).toBeNull();
  });

  test('converts seconds through the tempo map before judging', () => {
    const bpm60: TempoPoint[] = [{ quarter: 0, sec: 0, secPerQuarter: 1, bpm: 60 }];
    const slow = new JudgmentEngine();
    slow.setNotes([note({ startSec: 1, startTick: 768 })], bpm60);
    expect(slow.onKeyDown(0, 1.2)?.rating).toBe('COOL');

    const normal = new JudgmentEngine();
    normal.setNotes([note()]);
    expect(normal.onKeyDown(0, 1.2)?.rating).toBe('BAD');
  });

  test('chooses the nearest candidate on a dense lane', () => {
    const earlier = note({ id: 1, startSec: 1, startTick: 1536 });
    const nearer = note({ id: 2, startSec: 1.2, startTick: 1843.2 });
    const engine = new JudgmentEngine();
    engine.setNotes([earlier, nearer]);
    expect(engine.onKeyDown(0, 1.19)?.note.id).toBe(2);
    expect(earlier.judged).toBe(false);
  });

  test('marks an unplayed note after the 360-tick window', () => {
    const missed = note();
    const engine = new JudgmentEngine();
    engine.setNotes([missed]);
    expect(engine.update(1 + 361 / 1536).misses).toEqual([missed]);
    expect(missed.hitScore).toBe('MISS');
  });

  test('only a COOL long-note head enters the hold state', () => {
    const held = note({ isLong: true });
    const engine = new JudgmentEngine();
    engine.setNotes([held]);
    expect(engine.onKeyDown(0, 1.2)?.rating).toBe('BAD');
    expect(held.holdActive).toBe(false);
    expect(engine.onKeyUp(0, 2.2)).toBeNull();
  });

  test('judges long-note release by held MUSIC_TIME duration', () => {
    for (const [releaseTime, rating] of [
      [2 + 210 / 1536, 'COOL'],
      [2 + 211 / 1536, 'BAD'],
      [2 + 361 / 1536, 'MISS']
    ] as const) {
      const held = note({ isLong: true });
      const engine = new JudgmentEngine();
      engine.setNotes([held]);
      engine.onKeyDown(0, 1);
      expect(engine.onKeyUp(0, releaseTime)?.rating).toBe(rating);
    }
  });

  test('settles an overdue long-note tail once', () => {
    const held = note({ isLong: true });
    const engine = new JudgmentEngine();
    engine.setNotes([held]);
    engine.onKeyDown(0, 1);
    expect(engine.update(2 + 361 / 1536).misses).toEqual([held]);
    expect(held.holdBroken).toBe(true);
    expect(engine.onKeyUp(0, 3)).toBeNull();
  });

  test('restart and teardown clear active holds', () => {
    const held = note({ isLong: true });
    const engine = new JudgmentEngine();
    engine.setNotes([held]);
    engine.onKeyDown(0, 1);
    const before = { ...engine.score };
    engine.cancelActiveHolds();
    expect(engine.score).toEqual(before);
    expect(held.holdActive).toBe(false);

    engine.setNotes([held]);
    expect(held.holdBroken).toBe(false);
    expect(held.holdCompleted).toBe(false);
  });

  test('uses original combo bonus and non-negative score behavior', () => {
    const notes = Array.from({ length: 25 }, (_, id) => note({ id, startSec: id, startTick: id * 1536 }));
    const engine = new JudgmentEngine();
    engine.setNotes(notes);
    for (const current of notes) engine.onKeyDown(0, current.startSec);
    expect(engine.score.combo).toBe(25);
    expect(engine.score.score).toBe(25 * 15 + 5);
  });
});
