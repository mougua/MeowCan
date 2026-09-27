/** A frame clock that follows the audio transport without inheriting its quantum steps. */
export class VisualClock {
  private time = 0;
  private lastFrameMs: number | null = null;
  private lastAudioTime: number | null = null;
  private static readonly CORRECTION_TIME_CONSTANT_SEC = 0.25;
  // Judgment and keysounds use the audio transport directly. Keep the visual
  // estimate within one small timing quantum so misses cannot appear early.
  private static readonly MAX_AUDIO_ERROR_SEC = 0.004;

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
    if (elapsed > 0.25 || Math.abs(audioDelta - elapsed) > 0.5) {
      this.time = audioTime;
    } else {
      const alpha = 1 - Math.exp(-elapsed / VisualClock.CORRECTION_TIME_CONSTANT_SEC);
      this.time += error * alpha;
      this.time = Math.max(audioTime - VisualClock.MAX_AUDIO_ERROR_SEC,
        Math.min(audioTime + VisualClock.MAX_AUDIO_ERROR_SEC, this.time));
    }
    return this.time;
  }
}
