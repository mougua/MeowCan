/** A frame clock that follows the audio transport without inheriting its quantum steps. */
export class VisualClock {
  private time = 0;
  private lastFrameMs: number | null = null;

  public reset(): void {
    this.lastFrameMs = null;
  }

  public sample(audioTime: number, frameMs: number): number {
    if (this.lastFrameMs === null || !Number.isFinite(audioTime)) {
      this.time = audioTime;
      this.lastFrameMs = frameMs;
      return this.time;
    }

    const elapsed = Math.max(0, (frameMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = frameMs;
    this.time += elapsed;
    const error = audioTime - this.time;
    // A seek or a suspended tab needs an immediate resync. Small quantum errors
    // are corrected slowly so adjacent rendered frames remain evenly spaced.
    if (elapsed > 0.25 || Math.abs(error) > 0.1) this.time = audioTime;
    else this.time += Math.max(-0.001, Math.min(0.001, error * 0.1));
    return this.time;
  }
}
