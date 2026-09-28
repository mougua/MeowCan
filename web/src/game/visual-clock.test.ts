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

  test('keeps visual time close to judgment time after a transport disturbance', () => {
    const clock = new VisualClock();
    clock.sample(0, 1000);
    const first = clock.sample(0.12, 1016);
    const second = clock.sample(0.136, 1032);

    expect(first).toBe(0.12);
    expect(second).toBeGreaterThan(first);
    expect(Math.abs(second - 0.136)).toBeLessThan(0.004);
  });

  test('keeps visual movement smooth across coarse audio-time reads', () => {
    const clock = new VisualClock();
    const quantumSec = 512 / 48000;
    let previous = clock.sample(0, 0);
    let smallestStep = Infinity;
    let largestStep = 0;
    let largestError = 0;

    for (let frame = 1; frame <= 600; frame++) {
      const wallTimeSec = frame / 60;
      const audioTime = Math.floor(wallTimeSec / quantumSec) * quantumSec;
      const visualTime = clock.sample(audioTime, wallTimeSec * 1000);
      const step = visualTime - previous;

      smallestStep = Math.min(smallestStep, step);
      largestStep = Math.max(largestStep, step);
      largestError = Math.max(largestError, Math.abs(visualTime - audioTime));
      previous = visualTime;
    }

    expect(smallestStep).toBeGreaterThan(0.01);
    expect(largestStep).toBeLessThan(0.023);
    expect(largestError).toBeLessThan(0.02);
  });
});
