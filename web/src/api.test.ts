import { expect, test } from 'bun:test';
import { ApiClient } from './api';
import { JudgmentEngine } from './game/judgment';

test('a lost score response retries with the same submission ID', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Array<{ submissionId: string }> = [];
  globalThis.fetch = (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) throw new TypeError('Load failed');
    return Response.json({ saved: true });
  }) as typeof fetch;

  try {
    const result = await new ApiClient().submitScore(3434, new JudgmentEngine().score, 'result');
    expect(result.saved).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].submissionId).toBe(bodies[1].submissionId);
    expect(bodies[0].submissionId).toMatch(/^[0-9a-f]{32}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
