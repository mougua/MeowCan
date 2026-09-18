import type { ResultData, RoundState } from './result-view';

/** Owns only the idempotent round transition; the main controller performs side effects. */
export class RoundLifecycle {
  private current: RoundState = 'ready';

  public get state(): RoundState {
    return this.current;
  }

  public reset(): void {
    this.current = 'ready';
  }

  public begin(): void {
    this.current = 'playing';
  }

  public finish(snapshot: ResultData): ResultData | null {
    if (this.current !== 'playing') return null;
    this.current = snapshot.outcome;
    return snapshot;
  }
}
