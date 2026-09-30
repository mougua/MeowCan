/** A frame clock that follows the audio transport without inheriting its quantum steps. */
export class VisualClock {
  private time = 0;
  private lastFrameMs: number | null = null;
  private pendingError: number | null = null;
  private static readonly CORRECTION_TIME_CONSTANT_SEC = 0.25;
  // Output timestamps can report a single outlier frame (tens of ms ahead,
  // then behind). Snapping to each read makes notes jump forward and back,
  // so only real seeks and stalls resynchronize; smaller errors are slewed.
  private static readonly RESYNC_ERROR_SEC = 0.1;
  private static readonly MAX_FRAME_GAP_SEC = 0.25;
  private static readonly OUTLIER_ERROR_SEC = 0.02;

  public reset(): void {
    this.lastFrameMs = null;
    this.pendingError = null;
  }

  public sample(audioTime: number, frameMs: number): number {
    if (!Number.isFinite(audioTime)) {
      if (this.lastFrameMs !== null) {
        this.time += Math.max(0, (frameMs - this.lastFrameMs) / 1000);
        this.lastFrameMs = frameMs;
      }
      return this.time;
    }
    if (this.lastFrameMs === null) {
      this.time = audioTime;
      this.lastFrameMs = frameMs;
      this.pendingError = null;
      return this.time;
    }

    const elapsed = Math.max(0, (frameMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = frameMs;
    const predicted = this.time + elapsed;
    const error = audioTime - predicted;
    if (elapsed > VisualClock.MAX_FRAME_GAP_SEC || Math.abs(error) > VisualClock.RESYNC_ERROR_SEC) {
      this.time = audioTime;
      this.pendingError = null;
      return this.time;
    }
    // A single output-timestamp read may be tens of milliseconds off. Require
    // two consecutive, similarly displaced reads before correcting that much.
    if (Math.abs(error) > VisualClock.OUTLIER_ERROR_SEC
      && (this.pendingError === null || Math.abs(error - this.pendingError) > VisualClock.OUTLIER_ERROR_SEC)) {
      this.pendingError = error;
      this.time = predicted;
      return this.time;
    }
    this.pendingError = null;
    // Frame-rate independent correction. Never step backwards: a falling note
    // reversing direction for one frame is far more visible than a tiny lag.
    const alpha = 1 - Math.exp(-elapsed / VisualClock.CORRECTION_TIME_CONSTANT_SEC);
    this.time = Math.max(this.time, predicted + error * alpha);
    return this.time;
  }
}
