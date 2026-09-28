/** A frame clock that follows the audio transport without inheriting its quantum steps. */
export class VisualClock {
  private time = 0;
  private lastFrameMs: number | null = null;
  private lastAudioTime: number | null = null;
  private static readonly CORRECTION_TIME_CONSTANT_SEC = 0.25;
  // Ordinary audio-time reads can stay unchanged for a frame and then jump
  // forward. Do not clamp the visual clock to each read: that turns the audio
  // clock's steps into visible stalls and catch-up jumps.
  private static readonly RESYNC_STEP_ERROR_SEC = 0.05;
  private static readonly RESYNC_DRIFT_SEC = 0.04;

  public reset(): void {
    this.lastFrameMs = null;
    this.lastAudioTime = null;
  }

  public sample(audioTime: number, frameMs: number): number {
    if (this.lastFrameMs === null || !Number.isFinite(audioTime)) {
      this.time = audioTime;
      this.lastFrameMs = frameMs;
      this.lastAudioTime = audioTime;
      return this.time;
    }

    const elapsed = Math.max(0, (frameMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = frameMs;
    const audioDelta = audioTime - (this.lastAudioTime ?? audioTime);
    this.lastAudioTime = audioTime;
    this.time += elapsed;
    const error = audioTime - this.time;
    // Resync when the source clock jumps or rendering was suspended. Ordinary
    // drift is corrected continuously with a frame-rate independent EMA.
    if (elapsed > 0.25
      || Math.abs(audioDelta - elapsed) > VisualClock.RESYNC_STEP_ERROR_SEC
      || Math.abs(error) > VisualClock.RESYNC_DRIFT_SEC) {
      this.time = audioTime;
    } else {
      const alpha = 1 - Math.exp(-elapsed / VisualClock.CORRECTION_TIME_CONSTANT_SEC);
      this.time += error * alpha;
    }
    return this.time;
  }
}
