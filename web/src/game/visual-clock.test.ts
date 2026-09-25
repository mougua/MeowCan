import { describe, expect, test } from 'bun:test';
import { VisualClock } from './visual-clock';

describe('visual clock', () => {
  test('advances between audio quantum updates and follows the audio clock', () => {
    const clock = new VisualClock();
    expect(clock.sample(-3, 1000)).toBe(-3);
    const next = clock.sample(-3, 1008);
    expect(next).toBeGreaterThan(-3);
    expect(next).toBeLessThan(-2.99);
    expect(clock.sample(-2.984, 1016)).toBeCloseTo(-2.984, 2);
  });

  test('resynchronizes on a seek or a long frame gap', () => {
    const clock = new VisualClock();
    clock.sample(1, 1000);
    expect(clock.sample(5, 1016)).toBe(5);
    expect(clock.sample(5.5, 1516)).toBe(5.5);
    clock.reset();
    expect(clock.sample(-3, 1600)).toBe(-3);
  });

  test('smooths a 100 ms audio offset without snapping the visual timeline', () => {
    const clock = new VisualClock();
    clock.sample(0, 1000);
    const first = clock.sample(0.12, 1016);
    const second = clock.sample(0.136, 1032);

    expect(first).toBeGreaterThan(0.016);
    expect(first).toBeLessThan(0.05);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThan(0.136);
  });
});
