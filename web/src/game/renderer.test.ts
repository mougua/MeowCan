import { expect, test } from 'bun:test';
import { Texture } from 'pixi.js';
import { CanMusicRenderer } from './renderer';
import { JudgmentEngine } from './judgment';
import type { PlayableNote } from '../parser/vos';

function fixture() {
  const renderer = new CanMusicRenderer();
  // Exercise the real scene update without requiring a GPU or font rasterization.
  const state = renderer as any;
  state.texNoteSkins = Array(16).fill(Texture.WHITE);
  state.texHitBurstFrames = Array(10).fill(Texture.WHITE);
  const score = new JudgmentEngine().score;
  return { renderer, state, frame: (t: number, notes: PlayableNote[]) => renderer.renderFrame(t, notes, score, 100) };
}

function note(startSec: number, isLong = false): PlayableNote {
  return { id: startSec, lane: 0, startSec, durationSec: 5,
    midiNote: 60, velocity: 100, track: 0, isLong, judged: false };
}

test('visible candidates survive speed changes and retain active long notes', () => {
  const { renderer, state, frame } = fixture();
  const notes = [note(0, true), note(2), note(4)];
  frame(0, notes);
  notes[0].judged = true;
  notes[0].holdActive = true;
  frame(2, notes);
  expect(state.renderCandidates).toContain(notes[0]);
  renderer.setSpeed(.5);
  frame(2, notes);
  expect(state.renderCandidates).toContain(notes[2]);
  renderer.setSpeed(4);
  frame(2, notes);
  expect(state.renderCandidates).toContain(notes[2]);
  notes[0].holdActive = false;
  notes[0].holdCompleted = true;
  notes[1].judged = true;
  frame(3, notes);
  expect(state.renderCandidates).toEqual([notes[2]]);
});

test('restart resets candidate cursor even when the next timestamp is identical', () => {
  const { renderer, state, frame } = fixture();
  const notes = [note(0)];
  notes[0].judged = true;
  frame(0, notes);
  expect(state.renderCandidates).toHaveLength(0);
  notes[0].judged = false;
  renderer.resetEffects();
  frame(0, notes);
  expect(state.renderCandidates).toEqual(notes);
});

test('judgment and burst durations are independent of refresh rate', () => {
  for (const fps of [30, 60, 144]) {
    const { renderer, state, frame } = fixture();
    const notes: PlayableNote[] = [];
    frame(0, notes);
    renderer.showJudgement('COOL');
    renderer.showHitBurst(0);
    for (let i = 1; i <= fps; i++) frame(i / fps, notes);
    expect(state.activeHitBursts).toHaveLength(0);
    expect(state.judgeTextContainer.alpha).toBe(0);
    expect(state.judgeTextContainer.scale.x).toBe(1);
  }
});

test('long-note border does not cover the translucent center', () => {
  const { state, frame } = fixture();
  frame(0, [note(0, true)]);
  const { fill, borders } = state.longNoteBodyPool[0];
  const x = fill.x + fill.width / 2;
  const y = fill.y + fill.height / 2;
  for (const border of borders) {
    expect(x > border.x && x < border.x + border.width &&
      y > border.y && y < border.y + border.height).toBe(false);
  }
});

test('clientToScene undoes the canvas CSS size and the letterbox transform', () => {
  const renderer = new CanMusicRenderer();
  const state = renderer as any;
  state.canvasWidth = 716;
  state.canvasHeight = 516;
  state.stageScale = 0.5;
  state.stageOffsetX = 10;
  state.stageOffsetY = 20;
  state.app = { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 358, height: 258 }) } };

  // CSS (179,129) -> canvas pixels (358,258) -> stage ((358-10)/0.5, (258-20)/0.5)
  const p = renderer.clientToScene(179, 129);
  expect(p.x).toBeCloseTo(696, 6);
  expect(p.y).toBeCloseTo(476, 6);
});

test('clientToScene keeps stage coordinates independent of the CSS scale', () => {
  const make = (cssW: number, cssH: number) => {
    const renderer = new CanMusicRenderer();
    const state = renderer as any;
    state.canvasWidth = 716;
    state.canvasHeight = 516;
    state.stageScale = 1;
    state.stageOffsetX = 0;
    state.stageOffsetY = 0;
    state.app = { canvas: { getBoundingClientRect: () => ({ left: 5, top: 7, width: cssW, height: cssH }) } };
    return renderer.clientToScene(5 + cssW / 2, 7 + cssH / 2);
  };
  const small = make(358, 258);
  const large = make(1432, 1032);
  expect(small.x).toBeCloseTo(358, 6);
  expect(large.x).toBeCloseTo(358, 6);
  expect(small.y).toBeCloseTo(258, 6);
  expect(large.y).toBeCloseTo(258, 6);
});

test('hitTestKey resolves all seven keys and rejects everything else', () => {
  const renderer = new CanMusicRenderer();
  const L = renderer.getLayout();
  L.keyPositions.forEach((k, lane) => {
    expect(renderer.hitTestKey(k.x, k.y)).toBe(lane);
    expect(renderer.hitTestKey(k.x + k.width / 2, k.y + k.height / 2)).toBe(lane);
    expect(renderer.hitTestKey(k.x + k.width - 1, k.y + k.height - 1)).toBe(lane);
  });
  // Letterbox margins and anywhere outside a key rectangle must not play.
  expect(renderer.hitTestKey(-1, 100)).toBe(-1);
  expect(renderer.hitTestKey(L.stageWidth + 50, 300)).toBe(-1);
  expect(renderer.hitTestKey(139, 100)).toBe(-1);
  expect(renderer.hitTestKey(139, L.stageHeight - 1)).toBe(-1);
});
