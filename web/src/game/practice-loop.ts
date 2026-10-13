export interface PracticeRange { startSec: number; endSec: number }

/** One repeat segment, independent of playback and interface state. */
export class PracticeLoop {
  public startSec: number | null = null;
  private endSec: number | null = null;

  public get range(): PracticeRange | null {
    return this.startSec !== null && this.endSec !== null
      ? { startSec: this.startSec, endSec: this.endSec } : null;
  }

  public setStart(time: number): void {
    if (!Number.isFinite(time) || time < 0) return;
    this.startSec = time;
    this.endSec = null;
  }

  public setEnd(time: number): boolean {
    if (this.startSec === null || !Number.isFinite(time) || time - this.startSec < 0.1 - 1e-9) return false;
    this.endSec = time;
    return true;
  }

  public clear(): void { this.startSec = this.endSec = null; }

  /** Carry frame overshoot into the next pass instead of slowing every repeat. */
  public wrap(time: number): number | null {
    const range = this.range;
    return range && time >= range.endSec
      ? range.startSec + (time - range.endSec) % (range.endSec - range.startSec) : null;
  }
}
