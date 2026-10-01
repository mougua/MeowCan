import { describe, expect, test } from 'bun:test';
import { countdownFrame } from './countdown';

describe('original DLL countdown', () => {
  test('holds 3, 2, 1 for exactly one second each, then clears', () => {
    expect(countdownFrame(-3)).toEqual({ digit: 3, alpha: 1 });
    expect(countdownFrame(-2)).toEqual({ digit: 2, alpha: 1 });
    expect(countdownFrame(-1)).toEqual({ digit: 1, alpha: 1 });
    expect(countdownFrame(0)).toBeNull();
  });

  test('fades within each second and resets on the next digit', () => {
    expect(countdownFrame(-2.5)).toEqual({ digit: 3, alpha: 22 / 32 });
    expect(countdownFrame(-2.01)?.alpha).toBeLessThan(.4);
    expect(countdownFrame(-2)?.alpha).toBe(1);
  });
});
