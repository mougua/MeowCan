import { expect, test } from 'bun:test';
import { ScoreOvertakeController } from './score-overtake-ui';
import type { ScoreOvertake, SessionUser } from './api';

test('score reminder waits until a round ends and is acknowledged once dismissed', async () => {
  const originalDocument = globalThis.document;
  const nodes = new Map<string, { textContent: string; active: boolean; classList: { add: () => void; remove: () => void } }>();
  for (const id of ['score-overtake', 'score-overtake-song', 'score-overtake-message']) {
    const node = {
      textContent: '', active: false,
      classList: {
        add: () => { node.active = true; },
        remove: () => { node.active = false; }
      }
    };
    nodes.set(id, node);
  }
  globalThis.document = {
    hidden: false,
    getElementById: (id: string) => nodes.get(id) ?? null
  } as unknown as Document;

  try {
    const controller = new ScoreOvertakeController();
    const row: ScoreOvertake = {
      id: 7, songId: 3, songTitle: '星光练习曲', challengerName: '音符猫',
      previousScore: 100, newScore: 120
    };
    const acknowledged: number[] = [];
    let pending = true;
    const internal = controller as unknown as {
      api: { scoreOvertakes: () => Promise<ScoreOvertake[]>; acknowledgeScoreOvertake: (id: number) => Promise<void> };
      dismiss: () => Promise<void>;
      poll: () => Promise<void>;
    };
    internal.api = {
      scoreOvertakes: async () => pending ? [row] : [],
      acknowledgeScoreOvertake: async id => { acknowledged.push(id); pending = false; }
    };
    controller.setBlocked(true);
    controller.setUser({ id: 1 } as SessionUser);
    await internal.poll();
    expect(nodes.get('score-overtake')!.active).toBe(false);
    controller.setBlocked(false);
    expect(nodes.get('score-overtake')!.active).toBe(true);
    expect(nodes.get('score-overtake-song')!.textContent).toBe('星光练习曲');
    expect(nodes.get('score-overtake-message')!.textContent).toContain('音符猫');
    controller.setBlocked(true);
    expect(nodes.get('score-overtake')!.active).toBe(false);
    controller.setBlocked(false);
    expect(nodes.get('score-overtake')!.active).toBe(true);
    await internal.dismiss();
    expect(acknowledged).toEqual([7]);
    expect(nodes.get('score-overtake')!.active).toBe(false);
  } finally {
    globalThis.document = originalDocument;
  }
});
