import { describe, expect, test } from 'bun:test';
import type { BgmNote, PlayableNote } from '../parser/vos';
import { calculateRoundEndSec, ROUND_END_GRACE_SEC } from './round-timing';

function playable(startSec: number, durationSec: number): PlayableNote {
  return {
    id: startSec,
    lane: 0,
    startSec,
    durationSec,
    midiNote: 60,
    velocity: 100,
    track: 0,
    isLong: durationSec > .25,
    judged: false
  };
}

function bgm(startSec: number, durationSec: number): BgmNote {
  return { startSec, durationSec, midiNote: 60, velocity: 100, channel: 0 };
}

describe('round completion timing', () => {
  test('ignores a stale declared duration after all performed events end', () => {
    expect(calculateRoundEndSec({
      durationSec: 300,
      playableNotes: [playable(98, 1)],
      bgmNotes: [bgm(99, 2)]
    })).toBe(101 + ROUND_END_GRACE_SEC);
  });

  test('waits for the later of playable notes and accompaniment', () => {
    expect(calculateRoundEndSec({
      durationSec: 10,
      playableNotes: [playable(20, 4)],
      bgmNotes: [bgm(25, 3)]
    })).toBe(28 + ROUND_END_GRACE_SEC);
  });

  test('uses the declared duration when a chart has no events', () => {
    expect(calculateRoundEndSec({
      durationSec: 12,
      playableNotes: [],
      bgmNotes: []
    })).toBe(12 + ROUND_END_GRACE_SEC);
  });
});
