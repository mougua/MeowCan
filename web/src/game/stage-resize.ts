export interface StageSize {
  width: number;
  height: number;
}

/**
 * Decide whether a ResizeObserver report is a real layout change.
 *
 * Tablets report fractional content sizes that jitter by sub-pixels while the
 * URL bar, a scrollbar or split view settles. Applying those reports rebuilds
 * the WebGL drawing buffer (and clears the canvas), which reads as flicker.
 * Ignore changes below the threshold on both axes.
 */
export function isStageResize(next: StageSize, applied: StageSize, threshold = 1): boolean {
  return Math.abs(next.width - applied.width) >= threshold
    || Math.abs(next.height - applied.height) >= threshold;
}
