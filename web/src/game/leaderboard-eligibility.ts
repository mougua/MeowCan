export function canSubmitLeaderboardScore(songId: number | null, usedAutoPlay: boolean): songId is number {
  return songId !== null && !usedAutoPlay;
}
