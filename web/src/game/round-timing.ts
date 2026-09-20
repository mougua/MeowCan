import type { VosSongData } from '../parser/vos';

export const ROUND_END_GRACE_SEC = 2;

type RoundTimingData = Pick<VosSongData, 'durationSec' | 'playableNotes' | 'bgmNotes'>;

/**
 * Derive the end of a round from events that are actually performed.
 *
 * Some VOS files contain a stale container duration with a long silent tail.
 * Using it unconditionally leaves the round playing after every note and sound
 * has ended. The declared duration remains a fallback for an empty chart.
 */
export function calculateRoundEndSec(song: RoundTimingData): number {
  let lastEventEndSec = 0;

  for (const note of song.playableNotes) {
    const endSec = note.startSec + note.durationSec;
    if (Number.isFinite(endSec)) lastEventEndSec = Math.max(lastEventEndSec, endSec);
  }
  for (const note of song.bgmNotes) {
    const endSec = note.startSec + note.durationSec;
    if (Number.isFinite(endSec)) lastEventEndSec = Math.max(lastEventEndSec, endSec);
  }

  const declaredDurationSec = Number.isFinite(song.durationSec) ? Math.max(0, song.durationSec) : 0;
  return (lastEventEndSec > 0 ? lastEventEndSec : declaredDurationSec) + ROUND_END_GRACE_SEC;
}
