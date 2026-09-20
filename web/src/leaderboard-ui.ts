import { ApiClient, type LeaderboardEntry, type SessionUser } from './api';
import type { GameScore } from './game/judgment';
import type { RoundOutcome } from './game/result-view';

type BoardKind = 'mine' | 'global';

export class LeaderboardController {
  private readonly api = new ApiClient();
  private user: SessionUser | null = null;
  private songId: number | null = null;
  private activeBoard: BoardKind = 'mine';
  private requestId = 0;

  public init(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-leaderboard-tab]').forEach(button => {
      button.addEventListener('click', () => {
        this.activeBoard = button.dataset.leaderboardTab as BoardKind;
        this.syncTabs();
      });
    });
    this.renderState('登录后可查看当前曲目的榜单');
  }

  public setUser(user: SessionUser | null): void {
    this.user = user;
    void this.refresh();
  }

  public setSong(songId: number | null): void {
    this.songId = songId;
    void this.refresh();
  }

  public async submitScore(songId: number, score: GameScore, outcome: RoundOutcome): Promise<void> {
    const status = document.getElementById('score-save-status');
    if (!this.user) {
      if (status) status.textContent = '未登录：本次成绩不会计入榜单';
      return;
    }
    if (score.accuracy < 80) {
      if (status) status.textContent = '成绩率未达到 80%，未计入榜单';
      return;
    }

    if (status) status.textContent = '正在结算并更新榜单…';
    try {
      const result = await this.api.submitScore(songId, score, outcome);
      if (status) status.textContent = result.saved ? '成绩已计入「我的最佳」' : '本次未进入个人前 10';
      if (this.songId === songId) await this.refresh();
    } catch (error) {
      if (status) status.textContent = `成绩保存失败：${(error as Error).message}`;
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
      item.innerHTML = `<b>${index + 1}</b>${player}<span class="leaderboard-score"></span><small>${entry.accuracy.toFixed(1)}%</small>`;
      if (showPlayer) item.querySelector('.leaderboard-player')!.textContent = entry.displayName;
      item.querySelector('.leaderboard-score')!.textContent = entry.score.toLocaleString('zh-CN');
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
