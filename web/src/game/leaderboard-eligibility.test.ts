import { describe, expect, test } from 'bun:test';
import { canSubmitLeaderboardScore } from './leaderboard-eligibility';

describe('leaderboard eligibility', () => {
  test('rejects every round that used auto play', () => {
    expect(canSubmitLeaderboardScore(100, true)).toBe(false);
  });

  test('only accepts manual rounds tied to an online song', () => {
    expect(canSubmitLeaderboardScore(100, false)).toBe(true);
    expect(canSubmitLeaderboardScore(null, false)).toBe(false);
  });
});


test('practice rounds are excluded from all score submissions', () => {
  expect(canSubmitLeaderboardScore(1, false, true)).toBe(false);
  expect(canSubmitLeaderboardScore(1, true, true)).toBe(false);
});
