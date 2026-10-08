import { expect, test } from 'bun:test';
import { Sprite, Texture } from '../render/webgl';
import { DEFAULT_SKIN } from './skin';
import {
  createResultData,
  getResultAnimationState,
  getRoundOutcome,
  RESULT_SCORE_OFFSETS,
  ResultView
} from './result-view';
import { RoundLifecycle } from './round-state';

test('result integer stays left of the decimal across digit-count transitions', () => {
  const view = new ResultView() as any;
  view.ratioDigits = Array(10).fill(Texture.WHITE);
  for (const ratio of [0, 9.9, 10, 99.9, 100]) {
    view.drawRatio(ratio);
    const digits = view.ratioIntegerContainer.children;
    const right = view.ratioIntegerContainer.x + digits.at(-1).x + DEFAULT_SKIN.ratioFont.charWidth;
    expect(right).toBe(DEFAULT_SKIN.resultLayout.ratioDecimal.x - 2);
    expect(digits.length).toBe(String(Math.floor(ratio)).length);
  }
});

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
  state.currentData = createResultData('result', 100, 100, 1);
  state.drawRatio = () => {};
  state.container.visible = true;
  view.update(0.25);
  view.update(0.25);
  expect(state.elapsedSec).toBeCloseTo(0.5, 6);
  state.container.visible = false;
  view.update(1);
  expect(state.elapsedSec).toBeCloseTo(0.5, 6);
});

test('result counters reproduce the original 60 Hz timing and score cascade', () => {
  expect(getResultAnimationState(8 / 60, 87.5)).toMatchObject({
    accuracy: 0,
    settledScoreDigits: 0,
    activeScoreDigit: -1,
    activeScoreFrame: 0
  });
  expect(getResultAnimationState(29 / 60, 80).accuracy).toBe(40);
  expect(getResultAnimationState(48 / 60, 87.5)).toMatchObject({
    accuracy: 85.3125,
    activeScoreDigit: -1
  });
  expect(getResultAnimationState(49 / 60, 87.5)).toMatchObject({
    accuracy: 87.5,
    activeScoreDigit: 0,
    activeScoreFrame: 0
  });
  expect(getResultAnimationState(57 / 60, 87.5)).toMatchObject({
    settledScoreDigits: 0,
    activeScoreDigit: 0,
    activeScoreFrame: 8
  });
  expect(getResultAnimationState(58 / 60, 87.5)).toMatchObject({
    settledScoreDigits: 1,
    activeScoreDigit: 1,
    activeScoreFrame: 0
  });
  expect(getResultAnimationState(94 / 60, 87.5).complete).toBe(true);
  expect(RESULT_SCORE_OFFSETS).toEqual([-25, -10, 0, 5, 4, 3, 2, 1, 0]);
});
