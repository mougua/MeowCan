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

export class ApiHttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

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

export interface ScoreOvertake {
  id: number;
  songId: number;
  songTitle: string;
  challengerName: string;
  previousScore: number;
  newScore: number;
}

export interface ScoreSubmission {
  submissionId: string;
  userId?: number;
  songId: number;
  score: number;
  accuracy: number;
  maxCombo: number;
  coolCount: number;
  goodCount: number;
  badCount: number;
  missCount: number;
  outcome: 'clear' | 'failed';
  playedAt: string;
}

export function isTemporaryScoreError(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof DOMException && error.name === 'TimeoutError')
    || (error instanceof ApiHttpError
    && [401, 408, 409, 429, 500, 502, 503, 504].includes(error.status));
}

export class ApiClient {
  public async currentUser(): Promise<SessionUser | null> {
    const response = await fetch('/api/auth/me', {
      credentials: 'same-origin', signal: AbortSignal.timeout(8_000)
    });
    if (response.status === 401) return null;
    return (await this.read<AuthResponse>(response)).user;
  }

  public async login(identifier: string, password: string): Promise<SessionUser> {
    return (await this.post<AuthResponse>('/api/auth/login', { identifier, password })).user;
  }

  public async register(email: string, displayName: string, password: string): Promise<SessionUser> {
    return (await this.post<AuthResponse>('/api/auth/register', { email, displayName, password })).user;
  }

  public async logout(): Promise<void> {
    await this.post('/api/auth/logout', {});
  }

  public async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.post('/api/auth/change-password', { currentPassword, newPassword });
  }

  public async submitScore(songId: number, score: GameScore, outcome: RoundOutcome): Promise<SubmitScoreResponse> {
    return this.sendScoreSubmission(this.createScoreSubmission(songId, score, outcome));
  }

  public createScoreSubmission(songId: number, score: GameScore, outcome: RoundOutcome, userId?: number): ScoreSubmission {
    // The server records this ID in the score transaction, so retrying after a
    // lost response cannot insert the same play twice.
    const submissionId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
      byte.toString(16).padStart(2, '0')).join('');
    return {
      submissionId,
      userId,
      songId,
      score: score.score,
      accuracy: score.accuracy,
      maxCombo: score.maxCombo,
      coolCount: score.coolCount,
      goodCount: score.goodCount,
      badCount: score.badCount,
      missCount: score.missCount,
      outcome: outcome === 'result' ? 'clear' : 'failed',
      playedAt: new Date().toISOString()
    };
  }

  public async sendScoreSubmission(body: ScoreSubmission): Promise<SubmitScoreResponse> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.post<SubmitScoreResponse>('/api/scores', body);
      } catch (error) {
        const retryable = isTemporaryScoreError(error);
        if (!retryable || (error instanceof ApiHttpError && [401, 409].includes(error.status))
          || attempt >= 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }

  public async leaderboard(songId: number): Promise<LeaderboardResponse> {
    const response = await fetch(`/api/scores/leaderboard?song_id=${encodeURIComponent(songId)}`, {
      credentials: 'same-origin', signal: AbortSignal.timeout(8_000)
    });
    return this.read<LeaderboardResponse>(response);
  }

  public async leaderboards(songIds: number[]): Promise<Array<LeaderboardResponse & { songId: number }>> {
    return this.post('/api/scores/leaderboards', { songIds });
  }

  public async scoreOvertakes(): Promise<ScoreOvertake[]> {
    const response = await fetch('/api/scores/overtakes', {
      credentials: 'same-origin', signal: AbortSignal.timeout(8_000)
    });
    return this.read<ScoreOvertake[]>(response);
  }

  public async acknowledgeScoreOvertake(id: number): Promise<void> {
    return this.post(`/api/scores/overtakes/${encodeURIComponent(id)}/ack`, {});
  }

  private async post<T = unknown>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(url === '/api/scores' ? 12_000 : 8_000),
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
    throw new ApiHttpError(message, response.status);
  }
}
