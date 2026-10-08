import { describe, expect, test } from 'bun:test';
import { Container } from '../render/webgl';
import { MobileStage, type MobileEffectPack, type MobileSkinTheme, DEFAULT_MOBILE_THEME } from './mobile-stage';
import { JudgmentEngine } from './judgment';
import type { PlayableNote } from '../parser/vos';

describe('touch-first mobile stage', () => {
  test('maps the wide lower touch band to all seven lanes', () => {
    const stage = new MobileStage();
    const centers = [97, 184, 271, 358, 445, 532, 619];
    centers.forEach((x, lane) => expect(stage.hitTest(x, 480)).toBe(lane));
    expect(stage.hitTest(10, 480)).toBe(-1);
    expect(stage.hitTest(358, 300)).toBe(-1);
  });

  test('keeps future effect packs isolated behind the HUD extension seam', () => {
    let mountedParent: Container | undefined;
    const effects: MobileEffectPack = { mount: parent => { mountedParent = parent; } };
    const theme: MobileSkinTheme = { ...DEFAULT_MOBILE_THEME, createEffects: () => effects };
    const stage = new MobileStage(theme);
    expect(mountedParent).toBeInstanceOf(Container);
    expect(mountedParent).not.toBe(stage.container);
  });

  test('only revisits nearby notes after catching up and recovers after a seek', () => {
    const stage = new MobileStage();
    const notes: PlayableNote[] = Array.from({ length: 10_000 }, (_, id) => ({
      id, lane: id % 7, startSec: id / 100, startTick: id * 100,
      durationSec: 0, durationTicks: 0, midiNote: 60, velocity: 100,
      track: 0, isLong: false, judged: false
    }));
    let tickReads = 0;
    const input = {
      currentTimeSec: 90, currentTick: 900_000, stepTicks: 8,
      notes, score: new JudgmentEngine().score, totalDurationSec: 100,
      noteStartTick: (note: PlayableNote) => { tickReads++; return note.startTick!; },
      noteEndTick: (note: PlayableNote) => note.startTick!
    };
    stage.render(input);
    tickReads = 0;
    stage.render({ ...input, currentTimeSec: 90.01, currentTick: 900_100 });
    expect(tickReads).toBeLessThan(100);
    stage.render({ ...input, currentTimeSec: 1, currentTick: 10_000 });
    expect((stage as any).candidates.some((note: PlayableNote) => note.id === 100)).toBe(true);
  });
});
