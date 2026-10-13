import { expect, test } from 'bun:test';
import { PracticeLoop } from './practice-loop';

test('selects one segment and rejects missing, reversed, or near-zero endpoints', () => {
  const loop = new PracticeLoop();
  expect(loop.setEnd(3)).toBe(false);
  loop.setStart(2);
  expect(loop.setEnd(1)).toBe(false);
  expect(loop.setEnd(2.01)).toBe(false);
  expect(loop.setEnd(NaN)).toBe(false);
  expect(loop.range).toBeNull();
  expect(loop.setEnd(3)).toBe(true);
  expect(loop.range).toEqual({ startSec: 2, endSec: 3 });
  loop.setStart(4);
  expect(loop.range).toBeNull();
  expect(loop.startSec).toBe(4);
  loop.clear();
  expect(loop.startSec).toBeNull();
  expect(loop.range).toBeNull();
});

test('wraps repeated passes and long frame stalls without losing elapsed song time', () => {
  const loop = new PracticeLoop();
  loop.setStart(10);
  loop.setEnd(12);
  expect(loop.wrap(11.99)).toBeNull();
  expect(loop.wrap(12)).toBe(10);
  expect(loop.wrap(12.25)).toBe(10.25);
  expect(loop.wrap(18.5)).toBe(10.5);
  loop.clear();
  expect(loop.wrap(18.5)).toBeNull();
});
