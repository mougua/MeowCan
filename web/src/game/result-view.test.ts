import { expect, test } from 'bun:test';
import { Sprite } from 'pixi.js';
import { createResultData, getRoundOutcome, ResultView } from './result-view';
import { RoundLifecycle } from './round-state';

test('result snapshots are immutable and preserve the score at finish time', () => {
  let score = 5820;
  const snapshot = createResultData('result', score, 98.7, 100);
  score = 999999;
  expect(snapshot).toEqual({ outcome: 'result', score: 5820, accuracy: 98.7, maxCombo: 100 });
  expect(Object.isFrozen(snapshot)).toBe(true);
});

test('failed snapshots only include explicitly available optional metrics', () => {
  const snapshot = createResultData('failed', 50, 0.1, 4, { multiplier: 4 });
  expect(snapshot.multiplier).toBe(4);
  expect(snapshot.eq).toBeUndefined();
});

test('a round fails only when final accuracy is below 60 percent', () => {
  expect(getRoundOutcome(59.9)).toBe('failed');
  expect(getRoundOutcome(60)).toBe('result');
  expect(getRoundOutcome(100)).toBe('result');
});

test('round completion is idempotent until the next begin', () => {
  const round = new RoundLifecycle();
  const result = createResultData('result', 100, 100, 1);
  round.begin();
  expect(round.finish(result)).toBe(result);
  expect(round.finish(createResultData('failed', 0, 0, 0))).toBeNull();
  expect(round.state).toBe('result');
  round.reset();
  round.begin();
  expect(round.finish(createResultData('failed', 0, 0, 0))?.outcome).toBe('failed');
});

test('result animation time continues independently after song rendering stops', () => {
  const view = new ResultView();
  const state = view as any;
  state.title = new Sprite();
  state.container.visible = true;
  view.update(0.25);
  view.update(0.25);
  expect(state.elapsedSec).toBeCloseTo(0.5, 6);
  const scale = state.title.scale.x;
  state.container.visible = false;
  view.update(1);
  expect(state.elapsedSec).toBeCloseTo(0.5, 6);
  expect(state.title.scale.x).toBe(scale);
});
