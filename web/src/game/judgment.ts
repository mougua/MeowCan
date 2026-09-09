/**
 * CanMusic 7-Key Timing Judgement & Scoring System
 */

import type { PlayableNote } from '../parser/vos';

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
  life: number; // 0..100
  accuracy: number; // 0..100%
}

export class JudgmentEngine {
  private notes: PlayableNote[] = [];
  private lanePointers = [0, 0, 0, 0, 0, 0, 0];
  private heldNotes: Map<number, PlayableNote> = new Map(); // lane -> note
  private holdTickTimes: Map<number, number> = new Map();

  public score: GameScore = {
    score: 0,
    combo: 0,
    maxCombo: 0,
    coolCount: 0,
    goodCount: 0,
    badCount: 0,
    missCount: 0,
    totalNotes: 0,
    life: 50,
    accuracy: 100
  };

  // Windows in seconds
  public readonly COOL_WINDOW = 0.045; // +/- 45ms
  public readonly GOOD_WINDOW = 0.090; // +/- 90ms
  public readonly BAD_WINDOW = 0.140;  // +/- 140ms
  public readonly MISS_TIMEOUT = 0.150; // Late by > 150ms

  constructor() {}

  public setNotes(notes: PlayableNote[]): void {
    this.notes = notes;
    for (const note of notes) {
      note.judged = false;
      note.holdActive = false;
      note.holdCompleted = false;
      delete note.hitScore;
      delete note.hitOffsetMs;
    }
    this.lanePointers = [0, 0, 0, 0, 0, 0, 0];
    this.heldNotes.clear();
    this.holdTickTimes.clear();
    this.resetScore(this.notes.length);
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
      life: 50,
      accuracy: 100
    };
  }

  /**
   * Called on player key down for a specific lane (0..6)
   */
  public onKeyDown(lane: number, currentTimeSec: number): HitResult | null {
    if (lane < 0 || lane > 6) return null;

    // Find first unjudged note in this lane within BAD window
    let ptr = this.lanePointers[lane];
    let candidate: PlayableNote | null = null;

    while (ptr < this.notes.length) {
      const note = this.notes[ptr];
      if (note.lane === lane && !note.judged) {
        const diff = note.startSec - currentTimeSec; // positive = early, negative = late
        if (diff < -this.BAD_WINDOW) {
          // Already passed without being hit
          ptr++;
          continue;
        }
        if (diff > this.BAD_WINDOW) {
          // Future note, too early to hit
          break;
        }
        // Within hit window!
        candidate = note;
        break;
      }
      ptr++;
    }

    if (!candidate) return null;

    const offsetSec = currentTimeSec - candidate.startSec; // negative = early, positive = late
    const absOffsetSec = Math.abs(offsetSec);
    const offsetMs = Math.round(offsetSec * 1000);

    let rating: JudgmentRating;
    let basePoints = 0;

    if (absOffsetSec <= this.COOL_WINDOW) {
      rating = 'COOL';
      basePoints = 300;
      this.score.coolCount++;
      this.score.combo++;
      this.score.life = Math.min(100, this.score.life + 2.5);
    } else if (absOffsetSec <= this.GOOD_WINDOW) {
      rating = 'GOOD';
      basePoints = 150;
      this.score.goodCount++;
      this.score.combo++;
      this.score.life = Math.min(100, this.score.life + 1.2);
    } else if (absOffsetSec <= this.BAD_WINDOW) {
      rating = 'BAD';
      basePoints = 50;
      this.score.badCount++;
      this.score.combo = 0;
      this.score.life = Math.max(0, this.score.life - 4.0);
    } else {
      rating = 'MISS';
      this.score.missCount++;
      this.score.combo = 0;
      this.score.life = Math.max(0, this.score.life - 6.0);
    }

    this.score.maxCombo = Math.max(this.score.maxCombo, this.score.combo);
    const comboBonus = Math.floor(this.score.combo * 1.5);
    const points = basePoints + comboBonus;
    this.score.score += points;

    candidate.judged = true;
    candidate.hitScore = rating;
    candidate.hitOffsetMs = offsetMs;

    // Handle long note holding
    if (candidate.isLong && (rating === 'COOL' || rating === 'GOOD')) {
      candidate.holdActive = true;
      this.heldNotes.set(lane, candidate);
      this.holdTickTimes.set(lane, currentTimeSec);
    }

    this.updateAccuracy();

    return {
      note: candidate,
      rating,
      offsetMs,
      points
    };
  }

  /**
   * Called on player key up for lane
   */
  public onKeyUp(lane: number, currentTimeSec: number): HitResult | null {
    const held = this.heldNotes.get(lane);
    if (!held) return null;

    this.heldNotes.delete(lane);
    this.holdTickTimes.delete(lane);
    held.holdActive = false;

    const tailSec = held.startSec + held.durationSec;
    // If released within 120ms before tail or after tail, hold complete!
    if (currentTimeSec >= tailSec - 0.12) {
      held.holdCompleted = true;
      this.score.score += 200;
      this.score.combo++;
      this.score.maxCombo = Math.max(this.score.maxCombo, this.score.combo);
      this.score.life = Math.min(100, this.score.life + 3.0);
      return {
        note: held,
        rating: 'COOL',
        offsetMs: 0,
        points: 200
      };
    } else {
      // Released too early
      this.score.combo = 0;
      this.score.life = Math.max(0, this.score.life - 3.0);
      return {
        note: held,
        rating: 'BAD',
        offsetMs: Math.round((tailSec - currentTimeSec) * 1000),
        points: 0
      };
    }
  }

  /**
   * Frame update: checks for missed notes and active hold ticks
   */
  public update(currentTimeSec: number): { misses: PlayableNote[]; holdTicks: PlayableNote[] } {
    const misses: PlayableNote[] = [];
    const holdTicks: PlayableNote[] = [];

    // Check missed notes that passed judge line
    for (let lane = 0; lane < 7; lane++) {
      while (this.lanePointers[lane] < this.notes.length) {
        const note = this.notes[this.lanePointers[lane]];
        if (note.lane !== lane) {
          this.lanePointers[lane]++;
          continue;
        }

        if (note.judged) {
          this.lanePointers[lane]++;
          continue;
        }

        if (currentTimeSec - note.startSec > this.MISS_TIMEOUT) {
          // Missed!
          note.judged = true;
          note.hitScore = 'MISS';
          this.score.missCount++;
          this.score.combo = 0;
          this.score.life = Math.max(0, this.score.life - 6.0);
          misses.push(note);
          this.lanePointers[lane]++;
        } else {
          break;
        }
      }
    }

    // Check held long notes
    for (const [lane, note] of this.heldNotes.entries()) {
      if (note.holdActive) {
        const tailSec = note.startSec + note.durationSec;
        const previousTick = this.holdTickTimes.get(lane) ?? note.startSec;
        const ticks = Math.floor((Math.min(currentTimeSec, tailSec) - previousTick + 1e-9) / 0.1);
        if (ticks > 0) {
          this.score.score += ticks * 5;
          this.score.life = Math.min(100, this.score.life + ticks * 0.1);
          this.holdTickTimes.set(lane, previousTick + ticks * 0.1);
          holdTicks.push(note);
        }
        if (currentTimeSec >= tailSec) {
          // Finished holding
          note.holdActive = false;
          note.holdCompleted = true;
          this.heldNotes.delete(lane);
          this.holdTickTimes.delete(lane);
          this.score.score += 200;
          this.score.combo++;
          this.score.maxCombo = Math.max(this.score.maxCombo, this.score.combo);
          this.score.life = Math.min(100, this.score.life + 3.0);
        }
      }
    }

    if (misses.length > 0) {
      this.updateAccuracy();
    }

    return { misses, holdTicks };
  }

  private updateAccuracy(): void {
    const totalJudged = this.score.coolCount + this.score.goodCount + this.score.badCount + this.score.missCount;
    if (totalJudged === 0) {
      this.score.accuracy = 100;
      return;
    }
    const weighted = (this.score.coolCount * 100 + this.score.goodCount * 70 + this.score.badCount * 30);
    this.score.accuracy = Math.max(0, Math.min(100, Math.round((weighted / totalJudged) * 10) / 10));
  }
}
