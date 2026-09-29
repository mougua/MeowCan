import { expect, test } from 'bun:test';
import { Texture } from 'pixi.js';
import { CanMusicRenderer } from './renderer';
import { JudgmentEngine } from './judgment';
import type { PlayableNote, TempoPoint } from '../parser/vos';

function fixture() {
  const renderer = new CanMusicRenderer();
  // Exercise the real scene update without requiring a GPU or font rasterization.
  const state = renderer as any;
  state.texNoteSkins = Array(16).fill(Texture.WHITE);
  state.texHitBurstFrames = Array.from({ length: 7 }, () => Array(10).fill(Texture.WHITE));
  state.texLongHitFrames = Array(10).fill(Texture.WHITE);
  state.texComboDigits = Array(10).fill(Texture.WHITE);
  const score = new JudgmentEngine().score;
  return {
    renderer,
    state,
    frame: (t: number, notes: PlayableNote[], tempoMap?: TempoPoint[]) =>
      renderer.renderFrame(t, notes, score, 100, tempoMap)
  };
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
  renderer.setSpeed(1);
  frame(2, notes);
  expect(state.renderCandidates).toContain(notes[2]);
  renderer.setSpeed(14);
  frame(2, notes);
  expect(state.renderCandidates).toContain(notes[2]);
  notes[0].holdActive = false;
  notes[0].holdCompleted = true;
  notes[1].judged = true;
  frame(3, notes);
  expect(state.renderCandidates).toEqual([notes[2]]);
});

test('speed gear clamps between 1 and 14 and updates PDA speedText', () => {
  const { renderer, state } = fixture();
  expect(renderer.speedGear).toBe(8);
  expect(state.speedText.text).toBe('SPD: 8');

  renderer.setSpeed(14);
  expect(renderer.speedGear).toBe(14);
  expect(state.speedText.text).toBe('SPD: 14');

  renderer.setSpeed(20);
  expect(renderer.speedGear).toBe(14);

  renderer.setSpeed(1);
  expect(renderer.speedGear).toBe(1);
  expect(state.speedText.text).toBe('SPD: 1');

  renderer.setSpeed(-5);
  expect(renderer.speedGear).toBe(1);
});

test('speed displacement follows retro MUSIC_TIME tick formula', () => {
  const { renderer, state, frame } = fixture();
  const judgeY = state.judgeLocalY();

  // At the fallback 120 BPM, one second is 1536 MUSIC_TIME ticks.
  // The original default step is 16 - 8 = 8 ticks per pixel.
  renderer.setSpeed(8);
  frame(0, [note(1.0)]);
  const sprite8 = state.noteSpritePool[0];
  expect(sprite8.visible).toBe(true);
  expect(sprite8.y).toBe(judgeY - 192);

  // A quarter second is 384 ticks. Gear 14 uses a 2-tick step.
  renderer.setSpeed(14);
  frame(0, [note(0.25)]);
  const sprite14 = state.noteSpritePool[0];
  expect(sprite14.y).toBe(judgeY - 192);

  // The same 384 ticks at gear 1 use a 15-tick step.
  renderer.setSpeed(1);
  frame(0, [note(0.25)]);
  const sprite1 = state.noteSpritePool[0];
  expect(sprite1.y).toBeCloseTo(judgeY - 25.6);
});

test('note positions advance between 60 Hz and 120 Hz frames', () => {
  const { renderer, state, frame } = fixture();
  renderer.setSpeed(1);
  const notes = [note(1)];
  frame(0, notes);
  const startY = state.noteSpritePool[0].y;
  frame(1 / 120, notes);
  const at120Hz = state.noteSpritePool[0].y;
  frame(1 / 60, notes);
  const at60Hz = state.noteSpritePool[0].y;
  expect(at120Hz).toBeGreaterThan(startY);
  expect(at60Hz).toBeGreaterThan(at120Hz);
  expect(at120Hz - startY).toBeCloseTo(1536 / 15 / 120);
});

test('tempo map changes scroll speed in seconds while preserving tick positions', () => {
  const { renderer, state, frame } = fixture();
  const judgeY = state.judgeLocalY();
  const sixtyBpm: TempoPoint[] = [{ quarter: 0, sec: 0, secPerQuarter: 1, bpm: 60 }];

  renderer.setSpeed(8);
  frame(0, [note(1)], sixtyBpm);
  // At 60 BPM, one second is 768 ticks, so the same gear moves 96 px.
  expect(state.noteSpritePool[0].y).toBe(judgeY - 96);
});

test('long-note tails use duration ticks across a tempo change', () => {
  const { renderer, state, frame } = fixture();
  const tempoMap: TempoPoint[] = [
    { quarter: 0, sec: 0, secPerQuarter: 0.5, bpm: 120 },
    { quarter: 2, sec: 1, secPerQuarter: 1, bpm: 60 }
  ];
  const held = note(0.5, true);
  held.startTick = 768;
  held.durationTicks = 1536;

  renderer.setSpeed(8);
  frame(0.5, [held], tempoMap);
  const tail = state.longNoteTailPool[0];
  const connectionFromContact = state.activeNoteMeta().connectionY - state.activeNoteMeta().contactY;
  // At the head's tick (768), the release is 1536 ticks away, regardless of
  // the BPM change at quarter 2.
  expect(tail.y).toBe(state.judgeLocalY() - 192 + connectionFromContact);
});

test('candidate cropping uses tick distance after a speed change', () => {
  const { renderer, state, frame } = fixture();
  const tempoMap: TempoPoint[] = [{ quarter: 0, sec: 0, secPerQuarter: 1, bpm: 60 }];
  const far = note(7);
  frame(0, [far], tempoMap);
  expect(state.renderCandidates).toHaveLength(0);

  renderer.setSpeed(1);
  frame(0, [far], tempoMap);
  // The slower gear has a wider tick look-ahead and admits the same note.
  expect(state.renderCandidates).toContain(far);
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

test('flat note heads use the bottom-centre contact point and long notes have a release cap', () => {
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
  expect(state.longNoteTailPool).toHaveLength(1);
  const tail = state.longNoteTailPool[0];
  expect(tail.visible).toBe(true);
  expect(tail.y).toBeLessThan(shortSprite.y);
  expect(tail.width).toBe(24);
  long.judged = true;
  long.holdActive = true;
  const initialTailY = tail.y;
  frame(.5, [short, long]);
  expect(tail.y).toBeGreaterThan(initialTailY);
  expect(state.noteSpritePool[1].y).toBe(judgeLocalY);
  long.holdActive = false;
  long.holdCompleted = true;
  frame(1, [short, long]);
  expect(tail.visible).toBe(false);
  renderer.resetEffects();
  expect(tail.visible).toBe(false);
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

test('hit bursts keep their combo palette while later hits use the new tier', () => {
  const { renderer, state } = fixture();
  state.texHitBurstFrames = Array.from({ length: 7 }, () =>
    Array.from({ length: 10 }, () => new Texture({ source: Texture.WHITE.source })));
  renderer.showHitBurst(0, 49);
  renderer.showHitBurst(1, 50);
  expect(state.activeHitBursts[0].frames).toBe(state.texHitBurstFrames[0]);
  expect(state.activeHitBursts[1].frames).toBe(state.texHitBurstFrames[1]);
  renderer.advanceVisuals(1 / 30);
  expect(state.activeHitBursts[0].sprite.texture).toBe(state.texHitBurstFrames[0][1]);
  expect(state.activeHitBursts[1].sprite.texture).toBe(state.texHitBurstFrames[1][1]);
});

test('hit effect atlases bypass skin brightness adjustment', () => {
  const { state } = fixture();
  for (const variant of state.skinManager.getShortBurstVariants()) {
    state.textureCache.set(variant.path, Texture.WHITE);
  }
  state.textureCache.set(state.skinManager.getLongBurst().path, Texture.WHITE);
  state.skinColor = { hue: 0, saturation: 0, brightness: -100 };
  state.loadHitEffectTextures();
  expect(state.adjustedTextures.size).toBe(0);
  expect(state.texHitBurstFrames).toHaveLength(5);
});

test('metallic hit effects use their centered contact point', () => {
  const { renderer, state } = fixture();
  state.skinManager.setSkin('metallic');
  renderer.showHitBurst(3);
  expect(state.activeHitBursts[0].sprite.anchor.y).toBe(0.5);
  expect(state.activeHitBursts[0].sprite.blendMode).toBe('add');
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

test('hold effects inspect visible candidates instead of the whole chart', () => {
  const { state, frame } = fixture();
  const held = note(0, true);
  held.holdActive = true;
  const farNotes = Array.from({ length: 100 }, (_, i) => note(20 + i));
  const sync = state.syncHoldEffects.bind(state);
  let inspected = 0;
  state.syncHoldEffects = (candidates: PlayableNote[]) => {
    inspected = candidates.length;
    sync(candidates);
  };
  frame(0, [held, ...farNotes]);
  expect(inspected).toBe(1);
  expect(state.holdEffects.has(0)).toBe(true);
});

test('classic visuals do not advance the hidden mobile stage', () => {
  const { renderer, state } = fixture();
  let advances = 0;
  state.mobileStage.advance = () => { advances++; };
  renderer.advanceVisuals(1 / 60);
  expect(advances).toBe(0);
  state.skinManager.setSkin('mobile');
  renderer.advanceVisuals(1 / 60);
  expect(advances).toBe(1);
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

test('long notes use native palette textures instead of synthetic colored rectangles', () => {
  const { state, frame } = fixture();
  state.texLongBodies = Array.from({ length: 16 }, () => new Texture());
  state.texLongHeads = Array.from({ length: 16 }, () => new Texture());
  frame(0, [note(0, true)]);
  const { fill, borders } = state.longNoteBodyPool[0];
  expect(fill.texture).toBe(state.texLongBodies[3]);
  expect(state.noteSpritePool[0].texture).toBe(state.texLongHeads[3]);
  expect(fill.tint).toBe(0xffffff);
  expect(borders).toHaveLength(0);
});

test('pink hit and hold effects add light without drawing their black atlas background', () => {
  const { renderer, state, frame } = fixture();
  renderer.showHitBurst(0);
  expect(state.activeHitBursts[0].sprite.blendMode).toBe('add');
  const held = note(0, true);
  held.holdActive = true;
  frame(0, [held]);
  expect(state.holdEffects.get(0).sprite.blendMode).toBe('add');
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

test('metallic key hit testing follows its deeper visual arc', () => {
  const renderer = new CanMusicRenderer();
  const state = renderer as any;
  state.skinManager.setSkin('metallic');
  const L = renderer.getLayout();
  const offsets = state.skinManager.getPresentation().keyOffsetsY as readonly number[];
  L.keyPositions.forEach((key, lane) => {
    expect(renderer.hitTestKey(key.x + key.width / 2, key.y + offsets[lane] + key.height / 2)).toBe(lane);
  });
  expect(renderer.hitTestKey(
    L.keyPositions[3].x + L.keyPositions[3].width / 2,
    L.keyPositions[3].y
  )).toBe(-1);
});
