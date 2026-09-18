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
  state.texLongHitFrames = Array(10).fill(Texture.WHITE);
  state.texComboDigits = Array(10).fill(Texture.WHITE);
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

test('reset hides every pooled note and long-note component immediately', () => {
  const { renderer, state, frame } = fixture();
  frame(0, [note(0), note(0, true)]);
  expect(state.noteSpritePool.some((sprite: any) => sprite.visible)).toBe(true);
  expect(state.longNoteBodyPool.some((body: any) => body.fill.visible)).toBe(true);
  renderer.resetEffects();
  expect(state.noteSpritePool.every((sprite: any) => !sprite.visible)).toBe(true);
  expect(state.longNoteTailPool.every((sprite: any) => !sprite.visible)).toBe(true);
  expect(state.longNoteBodyPool.every((body: any) =>
    !body.fill.visible && body.borders.every((border: any) => !border.visible))).toBe(true);
});

test('judgment and burst durations are independent of refresh rate', () => {
  for (const fps of [30, 60, 144]) {
    const { renderer, state, frame } = fixture();
    const notes: PlayableNote[] = [];
    frame(0, notes);
    renderer.showJudgement('COOL');
    renderer.showHitBurst(0);
    for (let i = 1; i <= fps; i++) {
      frame(i / fps, notes);
      renderer.advanceVisuals(1 / fps);
    }
    expect(state.activeHitBursts).toHaveLength(0);
    expect(state.judgeTextContainer.alpha).toBe(0);
    expect(state.judgeTextContainer.scale.x).toBe(1);
  }
});

test('flat note heads and tails use the same bottom-centre contact point', () => {
  const { renderer, state, frame } = fixture();
  const short = note(0);
  const long = note(0, true);
  long.lane = 3;
  long.durationSec = 1;
  frame(0, [short, long]);
  const judgeLocalY = renderer.getLayout().judgeY - renderer.getLayout().playY;
  const shortSprite = state.noteSpritePool[0];
  expect(shortSprite.height).toBe(12);
  expect(shortSprite.anchor.x).toBe(0.5);
  expect(shortSprite.anchor.y).toBe(1);
  expect(shortSprite.y).toBe(judgeLocalY);
  const tail = state.longNoteTailPool[0];
  expect(tail.height).toBe(12);
  expect(tail.anchor.x).toBe(0.5);
  expect(tail.anchor.y).toBe(1);
});

test('combo values from one to four digits stay centred at native size', () => {
  const { renderer, state } = fixture();
  for (const value of [1, 9, 10, 99, 100, 1000]) {
    renderer.updateCombo(value);
    expect(state.comboContainer.visible).toBe(true);
    const visible = state.comboDigitSprites.filter((sprite: any) => sprite.visible);
    const left = Math.min(...visible.map((sprite: any) => sprite.x));
    const right = Math.max(...visible.map((sprite: any) => sprite.x + sprite.width));
    expect((left + right) / 2).toBeCloseTo(0, 6);
    expect(visible.every((sprite: any) => sprite.height === 70)).toBe(true);
  }
  renderer.updateCombo(0);
  expect(state.comboContainer.visible).toBe(false);
});

test('short hit effects align all lanes and return sprites to the pool', () => {
  const { renderer, state } = fixture();
  const width = renderer.getLayout().laneWidth;
  for (let lane = 0; lane < 7; lane++) renderer.showHitBurst(lane);
  expect(state.activeHitBursts).toHaveLength(7);
  state.activeHitBursts.forEach((burst: any, lane: number) => {
    expect(burst.sprite.x).toBe(lane * width + width / 2);
  });
  renderer.advanceVisuals(1);
  expect(state.activeHitBursts).toHaveLength(0);
  expect(state.hitBurstPool).toHaveLength(7);
});

test('an active hold owns at most one dedicated effect per lane', () => {
  const { state, frame } = fixture();
  const held = note(0, true);
  held.holdActive = true;
  frame(0, [held]);
  const first = state.holdEffects.get(0).sprite;
  frame(0.1, [held]);
  expect(state.holdEffects.size).toBe(1);
  expect(state.holdEffects.get(0).sprite).toBe(first);
  held.holdActive = false;
  frame(0.2, [held]);
  expect(state.holdEffects.size).toBe(0);
  expect(state.holdEffectPool).toContain(first);
});

test('round visual states select smile, surprise and sad faces and reset to playing', () => {
  const { renderer, state } = fixture();
  state.texFaceFrames = Array.from({ length: 7 }, () => new Texture());
  state.texStarFrames = Array.from({ length: 64 }, () => new Texture());
  renderer.setRoundVisualState('result');
  expect(state.faceSprite.texture).toBe(state.texFaceFrames[3]);
  renderer.setRoundVisualState('failed');
  expect(state.faceSprite.texture).toBe(state.texFaceFrames[5]);
  expect(state.starSprite.texture).toBe(state.texStarFrames[38]);
  renderer.resetEffects();
  expect(state.faceSprite.texture).toBe(state.texFaceFrames[0]);
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
