/** CanMusic 7-key timing judgment reconstructed from CanMusic.dll. */

import { secondsToMusicTick, type PlayableNote, type TempoPoint } from '../parser/vos';

export type JudgmentRating = 'COOL' | 'GOOD' | 'BAD' | 'MISS';

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

  public onKeyDown(lane: number, currentTimeSec: number): HitResult | null {
    if (lane < 0 || lane > 6) return null;

    const currentTick = this.toTick(currentTimeSec);
    let ptr = this.lanePointers[lane];
    let candidate: PlayableNote | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    while (ptr < this.notes.length) {
      const note = this.notes[ptr];
      if (note.lane === lane && !note.judged) {
        const offsetTicks = currentTick - this.noteStartTick(note);
        if (offsetTicks < -this.CANDIDATE_WINDOW_TICKS) break;
        const distance = Math.abs(offsetTicks);
        if (distance < this.CANDIDATE_WINDOW_TICKS && distance < nearestDistance) {
          candidate = note;
          nearestDistance = distance;
        }
      }
      ptr++;
    }

    if (!candidate) return null;

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

  public onKeyUp(lane: number, currentTimeSec: number): HitResult | null {
    const held = this.heldNotes.get(lane);
    if (!held) return null;

    const currentTick = this.toTick(currentTimeSec);
    const offsetTicks = currentTick - held.pressedTick - this.noteDurationTicks(held.note);
    return this.settleHold(lane, held, offsetTicks, currentTimeSec);
  }

  public update(currentTimeSec: number): { misses: PlayableNote[]; holdTicks: PlayableNote[] } {
    const misses: PlayableNote[] = [];
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

    for (const [lane, held] of [...this.heldNotes]) {
      const offsetTicks = currentTick - held.pressedTick - this.noteDurationTicks(held.note);
      if (this.hasPassedBottom(held.note, currentTick, true)) {
        this.settleHold(lane, held, offsetTicks, currentTimeSec, true);
        misses.push(held.note);
      }
    }

    if (misses.length) this.updateAccuracy();
    return { misses, holdTicks: [] };
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
