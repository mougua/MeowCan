import type { GameScore } from './game/judgment';
import type { RoundOutcome } from './game/result-view';

export interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

interface AuthResponse { user: SessionUser }

interface ApiErrorBody { error?: { message?: string } }

export interface LeaderboardEntry {
  userId: number;
  displayName: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  playedAt: string;
}

export interface LeaderboardResponse {
  mine: LeaderboardEntry[];
  global: LeaderboardEntry[];
}

export interface SubmitScoreResponse {
  saved: boolean;
}

export class ApiClient {
  public async currentUser(): Promise<SessionUser | null> {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (response.status === 401) return null;
    return (await this.read<AuthResponse>(response)).user;
  }

  public async login(email: string, password: string): Promise<SessionUser> {
    return (await this.post<AuthResponse>('/api/auth/login', { email, password })).user;
  }

  public async register(email: string, displayName: string, password: string): Promise<SessionUser> {
    return (await this.post<AuthResponse>('/api/auth/register', { email, displayName, password })).user;
  }

  public async logout(): Promise<void> {
    await this.post('/api/auth/logout', {});
  }

  public async submitScore(songId: number, score: GameScore, outcome: RoundOutcome): Promise<SubmitScoreResponse> {
    return this.post<SubmitScoreResponse>('/api/scores', {
      songId,
      score: score.score,
      accuracy: score.accuracy,
      maxCombo: score.maxCombo,
      coolCount: score.coolCount,
      goodCount: score.goodCount,
      badCount: score.badCount,
      missCount: score.missCount,
      outcome: outcome === 'result' ? 'clear' : 'failed'
    });
  }

  public async leaderboard(songId: number): Promise<LeaderboardResponse> {
    const response = await fetch(`/api/scores/leaderboard?song_id=${encodeURIComponent(songId)}`, {
      credentials: 'same-origin'
    });
    return this.read<LeaderboardResponse>(response);
  }

  private async post<T = unknown>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return this.read<T>(response);
  }

  private async read<T>(response: Response): Promise<T> {
    if (response.ok) {
      if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T;
      return response.json() as Promise<T>;
    }
    let message = `请求失败 (${response.status})`;
    try {
      const body = await response.json() as ApiErrorBody;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Keep the status-based fallback for non-JSON proxy errors.
    }
    throw new Error(message);
  }
}
