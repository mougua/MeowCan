import { expect, test } from 'bun:test';
import { isStageResize } from './stage-resize';

const applied = { width: 1180, height: 720 };

test('sub-pixel layout jitter is ignored on both axes', () => {
  expect(isStageResize({ width: 1180.4, height: 719.6 }, applied)).toBe(false);
  expect(isStageResize({ width: 1179.5, height: 720.5 }, applied)).toBe(false);
});

test('real size changes are applied', () => {
  expect(isStageResize({ width: 1181, height: 720 }, applied)).toBe(true);
  expect(isStageResize({ width: 1180, height: 721 }, applied)).toBe(true);
  expect(isStageResize({ width: 720, height: 1180 }, applied)).toBe(true);
});
