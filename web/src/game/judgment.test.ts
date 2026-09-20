import { describe, expect, test } from 'bun:test';
import { calculateMaximumScore, JudgmentEngine } from './judgment';
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
  for (const isLong of [false, true]) {
    test(`an early MISS leaves a ${isLong ? 'long' : 'short'} head hittable`, () => {
      const target = note({ isLong });
      const engine = new JudgmentEngine();
      engine.setNotes([target]);
      expect(engine.onKeyDown(0, 1 - 500 / 1536)?.rating).toBe('MISS');
      expect(target.judged).toBe(false);
      expect(target.hitScore).toBeUndefined();
      expect(engine.update(1 - 200 / 1536).misses).toEqual([]);
      expect(engine.onKeyDown(0, 1)?.rating).toBe('COOL');
      expect(engine.score.missCount).toBe(0);
      expect(engine.score.coolCount).toBe(1);
      if (isLong) expect(engine.onKeyUp(0, 2)?.rating).toBe('COOL');
      expect(engine.update(3).misses).toEqual([]);
    });
  }

  test('repeated early presses cost points, but expiry does not penalize again', () => {
    const target = note();
    const engine = new JudgmentEngine();
    engine.setNotes([target]);
    engine.score.score = 30;
    for (const ticks of [599, 500]) {
      expect(engine.onKeyDown(0, 1 - ticks / 1536)?.rating).toBe('MISS');
      engine.onKeyUp(0, 1 - (ticks - 1) / 1536);
    }
    expect(engine.score.score).toBe(22);
    expect(engine.score.missCount).toBe(1);
    expect(engine.update(3).misses).toEqual([]);
    expect(target.judged).toBe(true);
    expect(target.hitScore).toBe('MISS');
    expect(engine.score.score).toBe(22);
    expect(engine.score.missCount).toBe(1);
  });

  test('retry can settle BAD and restart clears transient MISS state', () => {
    const target = note();
    const engine = new JudgmentEngine();
    engine.setNotes([target]);
    engine.onKeyDown(0, 1 - 500 / 1536);
    expect(engine.onKeyDown(0, 1 - 300 / 1536)?.rating).toBe('BAD');
    expect(engine.score.missCount).toBe(0);
    expect(engine.score.badCount).toBe(1);
    expect(engine.onKeyDown(0, 1)).toBeNull();
    engine.setNotes([target]);
    engine.onKeyDown(0, 1 - 500 / 1536);
    engine.setNotes([target]);
    expect(engine.update(3).misses).toEqual([target]);
    expect(engine.score.missCount).toBe(1);
  });

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

  test('natural short-note expiry follows the play-area bottom, not BAD timing', () => {
    const missed = note();
    const engine = new JudgmentEngine();
    engine.setNotes([missed]);
    expect(engine.update(1 + 361 / 1536).misses).toEqual([]);
    expect(engine.update(1 + 527 / 1536).misses).toEqual([]);
    expect(engine.update(1 + 528 / 1536).misses).toEqual([missed]);
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

  test('natural expiry changes with scroll speed and original skin geometry', () => {
    for (const [step, bottom, halfHeight, expiry] of [[2, 65, 12, 132], [8, 63, 4, 512]]) {
      const target = note();
      const engine = new JudgmentEngine();
      engine.setNotes([target]);
      engine.setExpiryGeometry(step, bottom, halfHeight);
      expect(engine.update(1 + (expiry - 1) / 1536).misses).toEqual([]);
      expect(engine.update(1 + expiry / 1536).misses).toEqual([target]);
      expect(engine.update(3).misses).toEqual([]);
    }
  });

  test('a missed long head remains eligible and does not block later lane notes', () => {
    const long = note({ isLong: true });
    const next = note({ id: 1, startTick: 2304, startSec: 1.5 });
    const engine = new JudgmentEngine();
    engine.setNotes([long, next]);
    engine.setExpiryGeometry(2, 65, 12);
    expect(engine.update(1 + 108 / 1536).misses).toEqual([long]);
    expect(long.judged).toBe(false);
    expect(engine.onKeyDown(0, 1 + 150 / 1536)?.rating).toBe('COOL');
    expect(engine.score.missCount).toBe(0);
    expect(engine.update(1.6).misses).toEqual([next]);
    // Tail expiration uses chart position, even after a late head press.
    expect(engine.update(2 + 108 / 1536).misses).toEqual([long]);
    expect(long.holdBroken).toBe(true);
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
    expect(engine.update(2 + 431 / 1536).misses).toEqual([]);
    expect(engine.update(2 + 432 / 1536).misses).toEqual([held]);
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
    expect(engine.score.maxScore).toBe(25 * 15 + 5);
    expect(engine.score.accuracy).toBe(100);
  });

  test('calculates the result percentage from score versus chart maximum', () => {
    const notes = [note({ id: 1 }), note({ id: 2, startSec: 2, startTick: 3072 })];
    const engine = new JudgmentEngine();
    engine.setNotes(notes);
    expect(calculateMaximumScore(notes)).toBe(30);
    expect(engine.score.accuracy).toBe(0);
    engine.onKeyDown(0, 1);
    expect(engine.score.score).toBe(15);
    expect(engine.score.accuracy).toBe(50);
  });

  test('includes long-note tails and duration points in the chart maximum', () => {
    const held = note({ isLong: true, durationTicks: 1536 });
    const engine = new JudgmentEngine();
    engine.setNotes([held]);
    expect(engine.score.maxScore).toBe(42);
    engine.onKeyDown(0, 1);
    engine.onKeyUp(0, 2);
    expect(engine.score.score).toBe(42);
    expect(engine.score.accuracy).toBe(100);
  });
});
