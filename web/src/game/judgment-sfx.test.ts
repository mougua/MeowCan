import { expect, test } from 'bun:test';
import { judgmentSfx } from './judgment-sfx';

test('original combo audio occurs at the primary play area milestones', () => {
  for (const combo of [50, 100, 200, 400, 800, 1200]) {
    expect(judgmentSfx(combo - 1, combo)).toBe('combo');
  }
  for (const combo of [1, 25, 49, 51, 150, 1201]) {
    expect(judgmentSfx(combo - 1, combo)).toBeNull();
  }
});

test('a high streak sounds once when BAD or MISS resets it', () => {
  expect(judgmentSfx(24, 0)).toBeNull();
  expect(judgmentSfx(25, 0)).toBe('combo-break');
  expect(judgmentSfx(100, 0)).toBe('combo-break');
  expect(judgmentSfx(0, 0)).toBeNull();
});
