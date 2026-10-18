import { ApiClient, type ScoreOvertake, type SessionUser } from './api';

const POLL_MS = 60_000;

export class ScoreOvertakeController {
  private readonly api = new ApiClient();
  private userId: number | null = null;
  private blocked = true;
  private active: ScoreOvertake | null = null;
  private queue: ScoreOvertake[] = [];
  private readonly acknowledging = new Set<number>();
  private requestId = 0;
  private polling = false;

  public init(): void {
    document.getElementById('score-overtake-dismiss')!.addEventListener('click', () => void this.dismiss());
    window.setInterval(() => void this.poll(), POLL_MS);
    window.addEventListener('online', () => void this.poll());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.poll();
    });
  }

  public setUser(user: SessionUser | null): void {
    if (this.userId === (user?.id ?? null)) return;
    this.userId = user?.id ?? null;
    this.requestId++;
    this.queue = [];
    this.active = null;
    this.hide();
    void this.poll();
  }

  public setBlocked(blocked: boolean): void {
    this.blocked = blocked;
    if (blocked) this.hide();
    else this.showNext();
  }

  private async poll(): Promise<void> {
    if (!this.userId || this.polling || document.hidden) return;
    const requestId = this.requestId;
    this.polling = true;
    try {
      const rows = await this.api.scoreOvertakes();
      if (requestId !== this.requestId) return;
      const known = new Set([...this.queue.map(row => row.id), ...this.acknowledging]);
      if (this.active) known.add(this.active.id);
      for (const row of rows) if (!known.has(row.id)) this.queue.push(row);
      this.showNext();
    } catch (error) {
      console.warn('Could not check score reminders:', error);
    } finally {
      this.polling = false;
      if (requestId !== this.requestId) void this.poll();
    }
  }

  private showNext(): void {
    if (this.blocked || !this.userId || document.hidden) return;
    if (!this.active) this.active = this.queue.shift() ?? null;
    if (!this.active) return;
    const row = this.active;
    document.getElementById('score-overtake-song')!.textContent = row.songTitle;
    document.getElementById('score-overtake-message')!.textContent =
      `${row.challengerName} 在这首曲目拿到 ${row.newScore.toLocaleString('zh-CN')} 分，超过了你的 ${row.previousScore.toLocaleString('zh-CN')} 分。再来挑战一次？`;
    document.getElementById('score-overtake')!.classList.add('active');
  }

  private async dismiss(): Promise<void> {
    const row = this.active;
    if (!row || this.blocked) return;
    const userId = this.userId;
    this.active = null;
    this.acknowledging.add(row.id);
    this.hide();
    this.showNext();
    try {
      await this.api.acknowledgeScoreOvertake(row.id);
      if (this.userId === userId && !this.active && this.queue.length === 0) void this.poll();
    } catch {
      if (this.userId === userId) {
        this.queue.unshift(row);
        this.showNext();
      }
    } finally {
      this.acknowledging.delete(row.id);
    }
  }

  private hide(): void {
    const notice = document.getElementById('score-overtake')!;
    const focused = document.activeElement as HTMLElement | null;
    if (focused && notice.contains?.(focused)) focused.blur();
    notice.classList.remove('active');
  }
}
