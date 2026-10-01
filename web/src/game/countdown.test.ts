import { describe, expect, test } from 'bun:test';
import { countdownFrame } from './countdown';

describe('original DLL countdown', () => {
  test('holds 3, 2, 1 for exactly one second each, then clears', () => {
    expect(countdownFrame(-3)).toBe(3);
    expect(countdownFrame(-2)).toBe(2);
    expect(countdownFrame(-1)).toBe(1);
    expect(countdownFrame(0)).toBeNull();
  });

  test('keeps each digit visible until the next second', () => {
    expect(countdownFrame(-2.001)).toBe(3);
    expect(countdownFrame(-1.001)).toBe(2);
    expect(countdownFrame(-0.001)).toBe(1);
  });
});
