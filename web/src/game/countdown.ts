/** CanMusic.dll 0x1000bffb–0x1000c150: three one-second digits, then start. */
export function countdownFrame(songTimeSec: number): number | null {
  const elapsed = songTimeSec + 3;
  if (elapsed < 0 || elapsed >= 3) return null;
  return 3 - Math.floor(elapsed);
}
