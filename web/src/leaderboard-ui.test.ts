import { test, expect } from 'bun:test';
import { LeaderboardController } from './leaderboard-ui';
import { JudgmentEngine } from './game/judgment';

test('an earlier score submission finishes without changing the next round status', async () => {
  const status = { textContent: '' };
  const originalDocument = globalThis.document;
  const originalStorage = globalThis.localStorage;
  const stored = new Map<string, string>();
  globalThis.document = {
    getElementById: () => status
  } as unknown as Document;
  globalThis.localStorage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); }
  } as Storage;

  try {
    const controller = new LeaderboardController();
    const pending: Array<(result: { saved: boolean }) => void> = [];
    const internal = controller as unknown as {
      user: { id: number };
      songId: number;
      api: {
        createScoreSubmission: () => object;
        sendScoreSubmission: () => Promise<{ saved: boolean }>;
      };
      refresh: () => Promise<void>;
    };
    internal.user = { id: 1 };
    internal.songId = 10;
    internal.api = {
      createScoreSubmission: () => ({
        submissionId: crypto.randomUUID(), songId: 10, playedAt: new Date().toISOString()
      }),
      sendScoreSubmission: () => new Promise(resolve => pending.push(resolve))
    };
    internal.refresh = async () => {};

    const score = new JudgmentEngine().score;
    score.accuracy = 90;
    const first = controller.submitScore(10, { ...score }, 'result');
    expect(pending).toHaveLength(1);

    controller.beginRound();
    status.textContent = '下一首正在演奏';
    pending[0]({ saved: true });
    await first;
    expect(status.textContent).toBe('下一首正在演奏');

    const second = controller.submitScore(10, { ...score }, 'result');
    expect(pending).toHaveLength(2);
    pending[1]({ saved: true });
    await second;
    expect(status.textContent).toBe('成绩已计入「我的最佳」');
  } finally {
    globalThis.document = originalDocument;
    globalThis.localStorage = originalStorage;
  }
});

test('playlist boards are fetched in one batch and reused until a song is refreshed', async () => {
  const controller = new LeaderboardController();
  const internal = controller as unknown as {
    user: { id: number };
    api: {
      leaderboards: (ids: number[]) => Promise<Array<{ songId: number; mine: never[]; global: never[] }>>;
      leaderboard: (id: number) => Promise<{ mine: never[]; global: never[] }>;
    };
    getBoard: (id: number) => Promise<{ mine: never[]; global: never[] }>;
    refreshSong: (id: number) => Promise<void>;
  };
  internal.user = { id: 1 };
  const batches: number[][] = [];
  const singles: number[] = [];
  internal.api = {
    leaderboards: async ids => {
      batches.push(ids);
      return ids.map(songId => ({ songId, mine: [], global: [] }));
    },
    leaderboard: async id => {
      singles.push(id);
      return { mine: [], global: [] };
    }
  };

  await controller.prefetch([1, 2, 1]);
  await internal.getBoard(1);
  await internal.getBoard(2);
  expect(batches).toEqual([[1, 2]]);
  expect(singles).toEqual([]);

  await internal.refreshSong(2);
  await internal.getBoard(2);
  expect(singles).toEqual([2]);
});
