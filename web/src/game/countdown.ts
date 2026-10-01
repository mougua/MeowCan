/** CanMusic.dll 0x1000bffb–0x1000c150: three one-second digits, then start. */
export function countdownFrame(songTimeSec: number): { digit: number; alpha: number } | null {
  const elapsed = songTimeSec + 3;
  if (elapsed < 0 || elapsed >= 3) return null;
  const second = Math.floor(elapsed);
  // The DLL draws font12.fnt at (130, 252), fading its 5-bit blend value
  // from 32 to 12 during each second, then resetting for the next digit.
  const blend = 32 - Math.round((elapsed - second) * 20);
  return { digit: 3 - second, alpha: blend / 32 };
}
