import { test, expect } from 'bun:test';
import { LeaderboardController } from './leaderboard-ui';
import { JudgmentEngine } from './game/judgment';

test('an earlier score submission finishes without changing the next round status', async () => {
  const status = { textContent: '' };
  const originalDocument = globalThis.document;
  globalThis.document = {
    getElementById: () => status
  } as unknown as Document;

  try {
    const controller = new LeaderboardController();
    const pending: Array<(result: { saved: boolean }) => void> = [];
    const internal = controller as unknown as {
      user: { id: number };
      songId: number;
      api: { submitScore: () => Promise<{ saved: boolean }> };
      refresh: () => Promise<void>;
    };
    internal.user = { id: 1 };
    internal.songId = 10;
    internal.api = {
      submitScore: () => new Promise(resolve => pending.push(resolve))
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
  }
});
