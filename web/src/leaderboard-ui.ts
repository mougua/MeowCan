import { ApiClient, isTemporaryScoreError, type LeaderboardEntry, type SessionUser } from './api';
import type { GameScore } from './game/judgment';
import type { RoundOutcome } from './game/result-view';
import { scoreOutbox, type PendingScore } from './score-outbox';

type BoardKind = 'mine' | 'global';

export class LeaderboardController {
  private readonly api = new ApiClient();
  private user: SessionUser | null = null;
  private songId: number | null = null;
  private activeBoard: BoardKind = 'mine';
  private requestId = 0;
  private scoreStatusId = 0;
  private readonly submitting = new Set<string>();
  private flushing = false;

  public init(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-leaderboard-tab]').forEach(button => {
      button.addEventListener('click', () => {
        this.activeBoard = button.dataset.leaderboardTab as BoardKind;
        this.syncTabs();
      });
    });
    this.renderState('登录后可查看当前曲目的榜单');
    window.addEventListener('online', () => void this.flushPending());
    window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible') void this.flushPending();
    }, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.flushPending();
    });
  }

  public setUser(user: SessionUser | null): void {
    this.user = user;
    void this.refresh();
    void this.flushPending();
  }

  public setSong(songId: number | null): void {
    if (this.songId !== songId) this.scoreStatusId++;
    this.songId = songId;
    void this.refresh();
  }

  public beginRound(): void {
    this.scoreStatusId++;
  }

  public async submitScore(songId: number, score: GameScore, outcome: RoundOutcome): Promise<void> {
    const statusId = ++this.scoreStatusId;
    const status = document.getElementById('score-save-status');
    if (!this.user) {
      if (status) status.textContent = '未登录：本次成绩不会计入榜单';
      return;
    }
    if (score.accuracy < 80) {
      if (status) status.textContent = '成绩率未达到 80%，未计入榜单';
      return;
    }

    const entry: PendingScore = {
      userId: this.user.id,
      submission: this.api.createScoreSubmission(songId, score, outcome, this.user.id)
    };
    let queued = true;
    try {
      scoreOutbox.add(entry);
    } catch {
      queued = false;
    }
    if (status) status.textContent = '正在结算并更新榜单…';
    try {
      const result = queued
        ? await this.sendPending(entry)
        : await this.api.sendScoreSubmission(entry.submission);
      if (status && statusId === this.scoreStatusId && this.songId === songId) {
        status.textContent = result.saved ? '成绩已计入「我的最佳」' : '本次未进入个人前 10';
      }
      if (this.songId === songId) await this.refresh();
      if (queued) void this.flushPending();
    } catch (error) {
      if (status && statusId === this.scoreStatusId && this.songId === songId) {
        status.textContent = isTemporaryScoreError(error)
          ? queued ? '网络暂不可用，成绩已在本地保留 3 天，将自动重试'
            : '网络暂不可用，且本地存储不可用，成绩无法等待重试'
          : `成绩保存失败：${(error as Error).message}`;
      }
    }
  }

  private async sendPending(entry: PendingScore): Promise<{ saved: boolean }> {
    const id = entry.submission.submissionId;
    this.submitting.add(id);
    try {
      const result = await this.api.sendScoreSubmission(entry.submission);
      scoreOutbox.remove(entry.userId, id);
      return result;
    } catch (error) {
      if (!isTemporaryScoreError(error)) scoreOutbox.remove(entry.userId, id);
      throw error;
    } finally {
      this.submitting.delete(id);
    }
  }

  private async flushPending(): Promise<void> {
    if (this.flushing || !this.user) return;
    this.flushing = true;
    try {
      for (const entry of scoreOutbox.forUser(this.user.id)) {
        if (this.user?.id !== entry.userId) break;
        if (this.submitting.has(entry.submission.submissionId)) continue;
        try {
          await this.sendPending(entry);
          if (this.songId === entry.submission.songId) await this.refresh();
        } catch (error) {
          if (isTemporaryScoreError(error)) break;
        }
      }
    } catch {
      // Storage can be disabled while the page is open; the queued record remains untouched.
    } finally {
      this.flushing = false;
    }
  }

  private async refresh(): Promise<void> {
    const requestId = ++this.requestId;
    if (!this.user) {
      this.renderState('登录后可查看当前曲目的榜单');
      return;
    }
    if (this.songId === null) {
      this.renderState('请选择曲库中的在线曲目');
      return;
    }

    this.renderState('榜单加载中…');
    try {
      const result = await this.api.leaderboard(this.songId);
      if (requestId !== this.requestId) return;
      this.renderEntries('leaderboard-mine', result.mine, false);
      this.renderEntries('leaderboard-global', result.global, true);
      document.getElementById('leaderboard-note')!.textContent = '成绩率 ≥ 80% · 每曲前 10';
      this.syncTabs();
    } catch (error) {
      if (requestId === this.requestId) this.renderState(`榜单加载失败：${(error as Error).message}`);
    }
  }

  private renderEntries(id: string, entries: LeaderboardEntry[], showPlayer: boolean): void {
    const list = document.getElementById(id)!;
    list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'leaderboard-empty';
      empty.textContent = '还没有达标成绩';
      list.append(empty);
      return;
    }
    entries.forEach((entry, index) => {
      const item = document.createElement('li');
      if (entry.userId === this.user?.id) item.classList.add('is-me');
      const player = showPlayer ? `<span class="leaderboard-player"></span>` : '';
      const time = showPlayer ? '' : '<time class="leaderboard-time"></time>';
      item.innerHTML = `<b>${index + 1}</b>${player}<span class="leaderboard-result"><strong>${entry.accuracy.toFixed(1)}%</strong><small class="leaderboard-score"></small>${time}</span>`;
      if (showPlayer) item.querySelector('.leaderboard-player')!.textContent = entry.displayName;
      item.querySelector('.leaderboard-score')!.textContent = entry.score.toLocaleString('zh-CN');
      if (!showPlayer) {
        const playedAt = new Date(entry.playedAt);
        const label = Number.isNaN(playedAt.getTime()) ? entry.playedAt
          : new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
          }).format(playedAt);
        const timeElement = item.querySelector('time')!;
        timeElement.textContent = label;
        timeElement.setAttribute('datetime', entry.playedAt);
      }
      list.append(item);
    });
  }

  private renderState(message: string): void {
    for (const id of ['leaderboard-mine', 'leaderboard-global']) {
      const list = document.getElementById(id)!;
      const item = document.createElement('li');
      item.className = 'leaderboard-empty';
      item.textContent = message;
      list.replaceChildren(item);
    }
    document.getElementById('leaderboard-note')!.textContent = this.user ? '成绩率 ≥ 80%' : '账号功能';
    this.syncTabs();
  }

  private syncTabs(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-leaderboard-tab]').forEach(button => {
      const active = button.dataset.leaderboardTab === this.activeBoard;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.getElementById('leaderboard-mine')!.classList.toggle('hidden', this.activeBoard !== 'mine');
    document.getElementById('leaderboard-global')!.classList.toggle('hidden', this.activeBoard !== 'global');
  }
}
