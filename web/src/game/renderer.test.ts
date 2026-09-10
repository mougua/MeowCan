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
