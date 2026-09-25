import type { MidiState } from '../parser/midi';
import { secondsToMusicTick, tickToSeconds, type PlayableNote, type TempoPoint } from '../parser/vos';

export type JudgmentRating = 'COOL' | 'GOOD' | 'BAD' | 'MISS';

/**
 * Original CanMusic white-key semitone offsets from CanMusic.dll at 0x100450b0.
 * Lane 0 -> Do (0)
 * Lane 1 -> Re (2)
 * Lane 2 -> Mi (4)
 * Lane 3 -> Fa (5)
 * Lane 4 -> Sol (7)
 * Lane 5 -> La (9)
 * Lane 6 -> Si (11)
 */
export const MAJOR_SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11] as const;

export interface KeysoundAction {
  midiNote: number;
  velocity: number;
  track: number;
  durationSec: number;
  instrument?: MidiState;
}

export interface HitResult {
  note: PlayableNote;
  rating: JudgmentRating;
  offsetMs: number;
  points: number;
}

export interface GameScore {
  score: number;
  maxScore: number;
  combo: number;
  maxCombo: number;
  coolCount: number;
  goodCount: number;
  badCount: number;
  missCount: number;
  totalNotes: number;
  accuracy: number;
}

/**
 * CanMusic.dll stores the chart's theoretical full-combo score and displays
 * score / maxScore * 100 in the result screen.
 */
export function calculateScorePercentage(score: number, maxScore: number): number {
  if (maxScore <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(score / maxScore * 1000) / 10));
}

export function calculateMaximumScore(
  notes: PlayableNote[],
  durationTicks: (note: PlayableNote) => number = note => note.durationTicks ?? 0
): number {
  let eventCount = notes.length;
  let maximum = notes.length * 15;
  for (const note of notes) {
    if (!note.isLong) continue;
    eventCount++;
    maximum += 15 + Math.floor(durationTicks(note) / 128);
  }
  for (let combo = 25; combo <= eventCount; combo += 25) maximum += Math.floor(Math.sqrt(combo));
  return maximum;
}

interface HeldNote {
  note: PlayableNote;
  pressedTick: number;
}

const DEFAULT_TEMPO_MAP: TempoPoint[] = [
  { quarter: 0, sec: 0, secPerQuarter: 0.5, bpm: 120 }
];

export class JudgmentEngine {
  private notes: PlayableNote[] = [];
  private lanePointers = [0, 0, 0, 0, 0, 0, 0];
  private heldNotes = new Map<number, HeldNote>();
  // The caller consumes misses immediately, before the next update clears them.
  private readonly updateResult = { misses: [] as PlayableNote[], holdTicks: [] as PlayableNote[] };
  // Original head state 2 is a penalized key press, still eligible for retry.
  private missedHeads = new WeakSet<PlayableNote>();
  private ticksPerPixel = 8;
  private bottomDistancePixels = 65;
  private longHeadHalfHeight = 12;
  private tempoMap: TempoPoint[] = DEFAULT_TEMPO_MAP;

  /** Constants recovered from CanMusic.dll at 0x10059354/0x10059358. */
  public readonly PERFECT_WINDOW_TICKS = 210;
  public readonly BAD_WINDOW_TICKS = 360;
  /** Candidate cutoff in CPlayArea::JudgeKeyDown (0x1002236d). */
  public readonly CANDIDATE_WINDOW_TICKS = 600;

  public score: GameScore = {
    score: 0,
    maxScore: 0,
    combo: 0,
    maxCombo: 0,
    coolCount: 0,
    goodCount: 0,
    badCount: 0,
    missCount: 0,
    totalNotes: 0,
    accuracy: 0
  };

  public setNotes(notes: PlayableNote[], tempoMap: TempoPoint[] = DEFAULT_TEMPO_MAP): void {
    this.notes = notes;
    this.tempoMap = tempoMap.length ? tempoMap : DEFAULT_TEMPO_MAP;
    for (const note of notes) {
      note.judged = false;
      note.holdActive = false;
      note.holdCompleted = false;
      note.holdBroken = false;
      delete note.hitScore;
      delete note.hitOffsetMs;
    }
    this.lanePointers = [0, 0, 0, 0, 0, 0, 0];
    this.heldNotes.clear();
    this.missedHeads = new WeakSet();
    this.resetScore(notes.length, calculateMaximumScore(notes, note => this.noteDurationTicks(note)));
  }

  public resetScore(totalNotes: number, maxScore = 0): void {
    this.score = {
      score: 0,
      maxScore,
      combo: 0,
      maxCombo: 0,
      coolCount: 0,
      goodCount: 0,
      badCount: 0,
      missCount: 0,
      totalNotes,
      accuracy: calculateScorePercentage(0, maxScore)
    };
  }

  public cancelActiveHolds(): void {
    for (const held of this.heldNotes.values()) held.note.holdActive = false;
    this.heldNotes.clear();
  }

  /** Original skin geometry, independent of the remade stage's visual layout. */
  public setExpiryGeometry(ticksPerPixel: number, bottomDistancePixels: number, longHeadHalfHeight: number): void {
    this.ticksPerPixel = ticksPerPixel;
    this.bottomDistancePixels = bottomDistancePixels;
    this.longHeadHalfHeight = longHeadHalfHeight;
  }

  /**
   * Finds the reference playable note for the fallback keysound synthesizer.
   * Reconstructed from CanMusic.dll at 0x100222d5 / 0x100223ae.
   *
   * When no candidate note is within the candidate timing window (e.g. before any
   * note has arrived, during song lead-in countdown, or on an empty lane),
   * CanMusic picks the reference note corresponding to the cursor (last played note)
   * or the chart's initial note if playback has not yet reached note 0.
   */
  public findReferenceNote(currentTick: number): PlayableNote | null {
    if (this.notes.length === 0) return null;

    let left = 0;
    let right = this.notes.length - 1;
    let lastPlayed: PlayableNote | null = null;

    while (left <= right) {
      const mid = (left + right) >> 1;
      const n = this.notes[mid];
      const tick = this.noteStartTick(n);
      if (tick <= currentTick) {
        lastPlayed = n;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return lastPlayed ?? this.notes[0];
  }

  /**
   * Resolves the sound to play for a lane press, faithfully reproducing
   * CanMusic.dll's two-tier keysound system (0x10022271):
   *
   * 1. Hit/candidate sound: If an active note on this lane is within the
   *    candidate timing window (600 ticks), play that specific note.
   * 2. Fallback instrument sound: If no note is in range (e.g. right after starting,
   *    lead-in countdown, or empty lane), synthesize a keysound using the reference
   *    note's instrument and major-scale pitch offset (0x100450b0).
   */
  public getKeysound(lane: number, currentTimeSec: number): KeysoundAction | null {
    if (lane < 0 || lane > 6 || this.notes.length === 0) return null;

    const currentTick = this.toTick(currentTimeSec);
    const candidate = this.findCandidate(lane, currentTick, this.CANDIDATE_WINDOW_TICKS);
    if (candidate) {
      return {
        midiNote: candidate.midiNote,
        velocity: candidate.velocity || 100,
        track: candidate.track,
        durationSec: candidate.durationSec,
        instrument: candidate.instrument
      };
    }

    const refNote = this.findReferenceNote(currentTick);
    if (!refNote) return null;

    let midiNote = refNote.midiNote;
    if (refNote.track !== 9) { // Channel 9 is percussion (GM channel 10)
      const refOffset = MAJOR_SCALE_OFFSETS[refNote.lane] ?? 0;
      const pressedOffset = MAJOR_SCALE_OFFSETS[lane] ?? 0;
      const targetPitch = refNote.midiNote + (pressedOffset - refOffset);
      if (targetPitch >= 0 && targetPitch <= 127) {
        midiNote = targetPitch;
      }
    }

    // CanMusic.dll pushes 0x180 (384 ticks = half beat / eighth note) and 0x64 (velocity 100)
    const durationSec = Math.max(0.1, tickToSeconds(384, this.tempoMap) - tickToSeconds(0, this.tempoMap));

    return {
      midiNote,
      velocity: 100,
      track: refNote.track,
      durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0.25,
      instrument: refNote.instrument
    };
  }

  /**
   * Returns the note whose instrument should answer a lane press.
   *
   * Keysound selection is deliberately independent from score judgement.
   * If an active note is on the lane, it is returned. Otherwise a fallback
   * synthetic playable note mapped to the major scale is provided.
   */
  public getKeysoundNote(lane: number, currentTimeSec: number): PlayableNote | null {
    if (lane < 0 || lane > 6) return null;
    const candidate = this.findCandidate(lane, this.toTick(currentTimeSec), Number.POSITIVE_INFINITY);
    if (candidate) return candidate;

    const action = this.getKeysound(lane, currentTimeSec);
    if (!action) return null;

    return {
      id: -1,
      lane,
      startSec: currentTimeSec,
      durationSec: action.durationSec,
      midiNote: action.midiNote,
      velocity: action.velocity,
      track: action.track,
      instrument: action.instrument,
      isLong: false,
      judged: false
    };
  }

  public onKeyDown(lane: number, currentTimeSec: number): HitResult | null {
    if (lane < 0 || lane > 6) return null;

    const currentTick = this.toTick(currentTimeSec);
    const candidate = this.findCandidate(lane, currentTick, this.CANDIDATE_WINDOW_TICKS);

    if (!candidate) return null;

    const nearestDistance = Math.abs(currentTick - this.noteStartTick(candidate));

    const offsetMs = Math.round((currentTimeSec - candidate.startSec) * 1000);
    let rating: JudgmentRating;
    let points: number;

    if (nearestDistance <= this.PERFECT_WINDOW_TICKS) {
      rating = 'COOL';
      points = this.applyOriginalScore(true, 15);
      this.score.coolCount++;
    } else if (nearestDistance <= this.BAD_WINDOW_TICKS) {
      rating = 'BAD';
      points = this.applyOriginalScore(false, 0);
      this.score.badCount++;
    } else {
      rating = 'MISS';
      points = this.applyOriginalScore(false, -4);
      if (!this.missedHeads.has(candidate)) this.score.missCount++;
      this.missedHeads.add(candidate);
      // 0x10022559 writes state 2; both candidate searches accept states < 3.
      // Keep the note visible and hittable. Each distinct bad press still costs
      // points, but per-note result counters must not count the note twice.
      this.updateAccuracy();
      return { note: candidate, rating, offsetMs, points };
    }

    if (this.missedHeads.delete(candidate)) this.score.missCount--;
    candidate.judged = true;
    candidate.hitScore = rating;
    candidate.hitOffsetMs = offsetMs;

    // The original only enters the long-note hold state after its 210-tick hit.
    if (candidate.isLong && rating === 'COOL') {
      candidate.holdActive = true;
      this.heldNotes.set(lane, { note: candidate, pressedTick: currentTick });
    }

    this.advanceLanePointer(lane);
    this.updateAccuracy();
    return { note: candidate, rating, offsetMs, points };
  }

  private findCandidate(lane: number, currentTick: number, maxDistanceTicks: number): PlayableNote | null {
    let ptr = this.lanePointers[lane];
    let candidate: PlayableNote | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    while (ptr < this.notes.length) {
      const note = this.notes[ptr];
      if (note.lane === lane && !note.judged) {
        const offsetTicks = currentTick - this.noteStartTick(note);
        if (maxDistanceTicks !== Number.POSITIVE_INFINITY
          && offsetTicks < -maxDistanceTicks) break;
        const distance = Math.abs(offsetTicks);
        if (distance < maxDistanceTicks && distance < nearestDistance) {
          candidate = note;
          nearestDistance = distance;
        }
      }
      ptr++;
    }

    return candidate;
  }

  public onKeyUp(lane: number, currentTimeSec: number): HitResult | null {
    const held = this.heldNotes.get(lane);
    if (!held) return null;

    const currentTick = this.toTick(currentTimeSec);
    const offsetTicks = currentTick - held.pressedTick - this.noteDurationTicks(held.note);
    return this.settleHold(lane, held, offsetTicks, currentTimeSec);
  }

  public update(currentTimeSec: number): { misses: PlayableNote[]; holdTicks: PlayableNote[] } {
    const result = this.updateResult;
    const misses = result.misses;
    misses.length = 0;
    const currentTick = this.toTick(currentTimeSec);

    for (let lane = 0; lane < 7; lane++) {
      for (let ptr = this.lanePointers[lane]; ptr < this.notes.length; ptr++) {
        const note = this.notes[ptr];
        if (this.noteStartTick(note) > currentTick) break;
        if (note.lane !== lane || note.judged) continue;
        if (!this.hasPassedBottom(note, currentTick)) continue;

        // The original expiry path penalizes only untouched state 0, not 2.
        if (!this.missedHeads.has(note)) {
          this.missedHeads.add(note);
          this.score.missCount++;
          this.applyOriginalScore(false, -4);
          misses.push(note);
        }
        // Long head state 1 remains a candidate until the tail leaves the area.
        if (!note.isLong || this.hasPassedBottom(note, currentTick, true)) {
          note.judged = true;
          note.hitScore = 'MISS';
          note.hitOffsetMs = Math.round((currentTimeSec - note.startSec) * 1000);
          this.missedHeads.delete(note);
        }
      }
      this.advanceLanePointer(lane);
    }

    // Map iteration remains valid when settleHold deletes the current entry.
    for (const [lane, held] of this.heldNotes) {
      const offsetTicks = currentTick - held.pressedTick - this.noteDurationTicks(held.note);
      if (this.hasPassedBottom(held.note, currentTick, true)) {
        this.settleHold(lane, held, offsetTicks, currentTimeSec, true);
        misses.push(held.note);
      }
    }

    if (misses.length) this.updateAccuracy();
    return result;
  }

  private hasPassedBottom(note: PlayableNote, currentTick: number, tail = false): boolean {
    const headY = Math.trunc((currentTick - this.noteStartTick(note)) / this.ticksPerPixel)
      + (note.isLong ? this.longHeadHalfHeight : 0);
    const y = headY - (tail ? Math.trunc(this.noteDurationTicks(note) / this.ticksPerPixel) : 0);
    return y > this.bottomDistancePixels;
  }

  private settleHold(
    lane: number,
    held: HeldNote,
    offsetTicks: number,
    currentTimeSec: number,
    expired = false
  ): HitResult {
    this.heldNotes.delete(lane);
    held.note.holdActive = false;

    const distance = Math.abs(offsetTicks);
    let rating: JudgmentRating;
    let points: number;
    if (!expired && distance <= this.PERFECT_WINDOW_TICKS) {
      rating = 'COOL';
      held.note.holdCompleted = true;
      points = this.applyOriginalScore(true, 15 + Math.floor(this.noteDurationTicks(held.note) / 128));
    } else if (!expired && distance <= this.BAD_WINDOW_TICKS) {
      rating = 'BAD';
      points = this.applyOriginalScore(false, 0);
      this.replaceHeadRating(held.note, 'BAD');
    } else {
      rating = 'MISS';
      points = this.applyOriginalScore(false, -4);
      this.replaceHeadRating(held.note, 'MISS');
    }

    if (rating !== 'COOL') held.note.holdBroken = true;
    this.updateAccuracy();
    return {
      note: held.note,
      rating,
      offsetMs: Math.round((currentTimeSec - (held.note.startSec + held.note.durationSec)) * 1000),
      points
    };
  }

  private replaceHeadRating(note: PlayableNote, rating: 'BAD' | 'MISS'): void {
    if (note.hitScore === 'COOL') this.score.coolCount--;
    else if (note.hitScore === 'GOOD') this.score.goodCount--;
    else if (note.hitScore === 'BAD') this.score.badCount--;
    note.hitScore = rating;
    if (rating === 'BAD') this.score.badCount++;
    else this.score.missCount++;
  }

  private applyOriginalScore(keepsCombo: boolean, basePoints: number): number {
    if (!keepsCombo) {
      this.score.combo = 0;
    } else {
      this.score.combo++;
      this.score.maxCombo = Math.max(this.score.maxCombo, this.score.combo);
      if (this.score.combo % 25 === 0) basePoints += Math.floor(Math.sqrt(this.score.combo));
    }
    this.score.score = Math.max(0, this.score.score + basePoints);
    return basePoints;
  }

  private advanceLanePointer(lane: number): void {
    while (this.lanePointers[lane] < this.notes.length) {
      const note = this.notes[this.lanePointers[lane]];
      if (note.lane === lane && !note.judged) break;
      this.lanePointers[lane]++;
    }
  }

  private noteStartTick(note: PlayableNote): number {
    return note.startTick ?? this.toTick(note.startSec);
  }

  private noteDurationTicks(note: PlayableNote): number {
    return note.durationTicks ?? Math.max(1, this.toTick(note.startSec + note.durationSec) - this.toTick(note.startSec));
  }

  private toTick(seconds: number): number {
    return secondsToMusicTick(seconds, this.tempoMap);
  }

  private updateAccuracy(): void {
    this.score.accuracy = calculateScorePercentage(this.score.score, this.score.maxScore);
  }
}
