import type { ScoreSubmission } from './api';

const STORAGE_KEY = 'meowcan.pendingScores.v1';
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

export interface PendingScore {
  userId: number;
  submission: ScoreSubmission;
}

function read(): PendingScore[] {
  let entries: unknown;
  try {
    entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    entries = [];
  }
  const now = Date.now();
  const valid = (Array.isArray(entries) ? entries : []).filter((entry): entry is PendingScore => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Partial<PendingScore>;
    const submission = item.submission;
    if (typeof item.userId !== 'number' || !Number.isSafeInteger(item.userId)
      || !submission || typeof submission.submissionId !== 'string'
      || typeof submission.playedAt !== 'string') return false;
    const playedAt = Date.parse(submission.playedAt);
    return Number.isFinite(playedAt) && playedAt <= now + 5 * 60_000
      && now - playedAt < RETENTION_MS;
  });
  if (valid.length !== (Array.isArray(entries) ? entries.length : 0)) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
  }
  return valid;
}

export const scoreOutbox = {
  forUser(userId: number): PendingScore[] {
    return read().filter(entry => entry.userId === userId);
  },
  add(entry: PendingScore): void {
    const entries = read();
    entries.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  },
  remove(userId: number, submissionId: string): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(read().filter(entry =>
      entry.userId !== userId || entry.submission.submissionId !== submissionId)));
  }
};
