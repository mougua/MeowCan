import { secondsToMusicTick, type PlayableNote, type VosSongData } from '../parser/vos';

export const CHART_PPQ = 768;
export const CHART_HEADER_HEIGHT = 70;
export const CHART_FOOTER_HEIGHT = 30;
export const CHART_TRACK_PADDING = 24;
export const CHART_MAX_TRACK_HEIGHT = 55_000;

export interface ChartLayout {
  beatHeight: number;
  pixelsPerTick: number;
  lastTick: number;
  trackHeight: number;
  totalHeight: number;
  trackTop: number;
  trackBottom: number;
}

export function noteStartTick(note: PlayableNote, song: VosSongData): number {
  return note.startTick ?? secondsToMusicTick(note.startSec, song.tempoMap);
}

export function noteEndTick(note: PlayableNote, song: VosSongData): number {
  if (note.startTick !== undefined && note.durationTicks !== undefined) {
    return note.startTick + note.durationTicks;
  }
  return secondsToMusicTick(note.startSec + note.durationSec, song.tempoMap);
}

/**
 * Build the same 768 PPQ geometry used by the live renderer at speed gear 8.
 * Only playable note data determines the chart extent: container duration can
 * include accompaniment tails (or bad metadata) that are not part of the chart.
 */
export function createChartLayout(song: VosSongData): ChartLayout {
  const furthestNoteTick = song.playableNotes.reduce((furthest, note) => {
    const tick = note.isLong ? noteEndTick(note, song) : noteStartTick(note, song);
    return Math.max(furthest, Number.isFinite(tick) ? tick : 0);
  }, 0);
  const lastTick = Math.max(CHART_PPQ, Math.ceil(furthestNoteTick / CHART_PPQ) * CHART_PPQ);

  // Gear 8 uses (16 - 8) = 8 ticks per pixel, i.e. 96 px per quarter.
  // Scale down only when required by browser canvas height limits.
  const availableHeight = CHART_MAX_TRACK_HEIGHT - CHART_TRACK_PADDING * 2;
  const trackSpan = Math.min(lastTick / 8, availableHeight);
  const pixelsPerTick = trackSpan / lastTick;
  const beatHeight = pixelsPerTick * CHART_PPQ;
  const trackHeight = Math.ceil(trackSpan) + CHART_TRACK_PADDING * 2;
  const trackTop = CHART_HEADER_HEIGHT;
  const trackBottom = trackTop + trackHeight;

  return {
    beatHeight,
    pixelsPerTick,
    lastTick,
    trackHeight,
    totalHeight: trackBottom + CHART_FOOTER_HEIGHT,
    trackTop,
    trackBottom
  };
}

/** Earlier notes are lower; later notes are higher, matching a falling chart. */
export function chartYForTick(tick: number, layout: ChartLayout): number {
  return layout.trackTop + CHART_TRACK_PADDING +
    Math.round((layout.lastTick - tick) * layout.pixelsPerTick);
}
