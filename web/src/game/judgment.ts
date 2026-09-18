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
 * The classic result ratio is a judgment-weighted percentage, not score/max
 * score.  GOOD is kept in the public type for compatibility, although the
 * original client has no separate GOOD timing band.
 */
export const JUDGMENT_WEIGHTS = Object.freeze({ COOL: 100, GOOD: 70, BAD: 30, MISS: 0 });

export function calculateAccuracy(score: Pick<GameScore, 'coolCount' | 'goodCount' | 'badCount' | 'missCount'>): number {
  const total = score.coolCount + score.goodCount + score.badCount + score.missCount;
  if (!total) return 100;
  const weighted = score.coolCount * JUDGMENT_WEIGHTS.COOL
    + score.goodCount * JUDGMENT_WEIGHTS.GOOD
    + score.badCount * JUDGMENT_WEIGHTS.BAD;
  return Math.max(0, Math.min(100, Math.round(weighted / total * 10) / 10));
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
  private tempoMap: TempoPoint[] = DEFAULT_TEMPO_MAP;

  /** Constants recovered from CanMusic.dll at 0x10059354/0x10059358. */
  public readonly PERFECT_WINDOW_TICKS = 210;
  public readonly BAD_WINDOW_TICKS = 360;
  /** Candidate cutoff in CPlayArea::JudgeKeyDown (0x1002236d). */
  public readonly CANDIDATE_WINDOW_TICKS = 600;

  public score: GameScore = {
    score: 0,
    combo: 0,
    maxCombo: 0,
    coolCount: 0,
    goodCount: 0,
    badCount: 0,
    missCount: 0,
    totalNotes: 0,
    accuracy: 100
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
    this.resetScore(notes.length);
  }

  public resetScore(totalNotes: number): void {
    this.score = {
      score: 0,
      combo: 0,
      maxCombo: 0,
      coolCount: 0,
      goodCount: 0,
      badCount: 0,
      missCount: 0,
      totalNotes,
      accuracy: 100
    };
  }

  public cancelActiveHolds(): void {
    for (const held of this.heldNotes.values()) held.note.holdActive = false;
    this.heldNotes.clear();
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
      this.score.missCount++;
    }

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
      while (this.lanePointers[lane] < this.notes.length) {
        const note = this.notes[this.lanePointers[lane]];
        if (note.lane !== lane || note.judged) {
          this.lanePointers[lane]++;
          continue;
        }
        if (currentTick - this.noteStartTick(note) <= this.BAD_WINDOW_TICKS) break;

        note.judged = true;
        note.hitScore = 'MISS';
        note.hitOffsetMs = Math.round((currentTimeSec - note.startSec) * 1000);
        this.score.missCount++;
        this.applyOriginalScore(false, -4);
        misses.push(note);
        this.lanePointers[lane]++;
      }
    }

    for (const [lane, held] of [...this.heldNotes]) {
      const offsetTicks = currentTick - held.pressedTick - this.noteDurationTicks(held.note);
      if (offsetTicks > this.BAD_WINDOW_TICKS) {
        this.settleHold(lane, held, offsetTicks, currentTimeSec);
        misses.push(held.note);
      }
    }

    if (misses.length) this.updateAccuracy();
    return { misses, holdTicks: [] };
  }

  private settleHold(
    lane: number,
    held: HeldNote,
    offsetTicks: number,
    currentTimeSec: number
  ): HitResult {
    this.heldNotes.delete(lane);
    held.note.holdActive = false;

    const distance = Math.abs(offsetTicks);
    let rating: JudgmentRating;
    let points: number;
    if (distance <= this.PERFECT_WINDOW_TICKS) {
      rating = 'COOL';
      held.note.holdCompleted = true;
      points = this.applyOriginalScore(true, 15 + Math.floor(this.noteDurationTicks(held.note) / 128));
    } else if (distance <= this.BAD_WINDOW_TICKS) {
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
    this.score.accuracy = calculateAccuracy(this.score);
  }
}
