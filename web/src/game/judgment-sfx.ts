// CanMusic.dll 0x10022b3f-0x10022f2b: primary play area milestones.
// 0x10022aa0-0x10022ad2: a broken streak after a mode-dependent threshold.
const COMBO_MILESTONES = new Set([50, 100, 200, 400, 800, 1200]);

export function judgmentSfx(previousCombo: number, combo: number): 'combo' | 'combo-break' | null {
  if (combo > previousCombo && COMBO_MILESTONES.has(combo)) return 'combo';
  if (previousCombo >= 25 && combo === 0) return 'combo-break';
  return null;
}
