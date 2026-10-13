export function canSubmitLeaderboardScore(songId: number | null, usedAutoPlay: boolean, practice = false): songId is number {
  return songId !== null && !usedAutoPlay && !practice;
}
