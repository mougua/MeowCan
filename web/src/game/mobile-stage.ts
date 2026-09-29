import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { GameScore, JudgmentRating } from './judgment';
import type { PlayableNote } from '../parser/vos';
import type { ResultData } from './result-view';

const WIDTH = 716;
const HEIGHT = 516;
const LANES = 7;
const TOP_Y = 72;
const JUDGE_Y = 452;
const TOP_LEFT = 277;
const TOP_RIGHT = 439;
const BOTTOM_LEFT = 54;
const BOTTOM_RIGHT = 662;

/** Optional texture URLs can be added later without coupling assets to gameplay. */
export interface MobileSkinAssets {
  background?: string;
  highway?: string;
  tapNotes?: string[];
  holdNotes?: string[];
  hitEffects?: string[];
}

/** Extension seam for future animated/shader/particle effect packs. */
export interface MobileEffectPack {
  mount(parent: Container): void;
  setLanePressed?(lane: number, pressed: boolean): void;
  playHit?(lane: number, rating?: JudgmentRating): void;
  update?(deltaSec: number): void;
  destroy?(): void;
}

export interface MobileSkinTheme {
  id: string;
  colors: {
    background: number;
    highway: number;
    edge: number;
    grid: number;
    text: number;
    muted: number;
    lanes: readonly number[];
  };
  assets?: MobileSkinAssets;
  createEffects?: () => MobileEffectPack;
}

export const DEFAULT_MOBILE_THEME: MobileSkinTheme = {
  id: 'prism-live',
  colors: {
    background: 0x07101f,
    highway: 0x101b35,
    edge: 0x8beaff,
    grid: 0x87bddd,
    text: 0xffffff,
    muted: 0x8ba3bf,
    lanes: [0xff4f9a, 0x7c72ff, 0x36d9ff, 0xffd84a, 0x36d9ff, 0x7c72ff, 0xff4f9a]
  },
  assets: {}
};

export interface MobileFrameInput {
  currentTimeSec: number;
  currentTick: number;
  stepTicks: number;
  notes: PlayableNote[];
  score: GameScore;
  totalDurationSec: number;
  noteStartTick: (note: PlayableNote) => number;
  noteEndTick: (note: PlayableNote) => number;
}

/** Asset-free default implementation of the touch-first perspective stage. */
export class MobileStage {
  public readonly container = new Container();

  private background = new Graphics();
  private highway = new Graphics();
  private notes = new Container();
  private holdBodies = new Graphics();
  private noteBars: Graphics[] = [];
  private usedBars = 0;
  // Shared geometry is tessellated once; animation only changes transforms.
  private barTemplates = new Map<number, Graphics>();
  private candidates: PlayableNote[] = [];
  private sourceNotes: PlayableNote[] | null = null;
  private nextNote = 0;
  private lastTime = -Infinity;
  private effects = new Graphics();
  private effectsDrawn = false;
  private pressEffects: Graphics[] = [];
  private lastScore = -1;
  private lastAccuracy = -1;
  private lastSecond = -1;
  private lastDuration = -1;
  private extensionLayer = new Container();
  private hud = new Container();
  private resultLayer = new Container();
  private resultPanel = new Graphics();
  private resultTitle = this.makeText('', 38, 0xffffff, '800');
  private resultStats = this.makeText('', 18, 0xdcecff, '700');
  private title = this.makeText('MEOWCAN MOBILE', 13, 0xffffff, '800');
  private song = this.makeText('SELECT A SONG', 11, 0xaed8ff, '700');
  private score = this.makeText('0000000', 22, 0xffffff, '800');
  private ratio = this.makeText('100.0%', 12, 0x8eeaff, '700');
  private time = this.makeText('00:00 / 00:00', 11, 0xbfd1e8, '600');
  private combo = this.makeText('', 42, 0xffffff, '900');
  private comboCaption = this.makeText('COMBO', 11, 0x8eeaff, '800');
  private judgement = this.makeText('', 27, 0xffffff, '900');
  private auto = this.makeText('MANUAL', 10, 0x8ba3bf, '800');
  private speed = this.makeText('SPEED 8', 10, 0x8ba3bf, '800');
  private countdown = this.makeText('', 64, 0xffffff, '900');
  private countdownValue: string | null = null;
  private countdownAge = 0;
  private pressed = Array<boolean>(LANES).fill(false);
  private bursts: Array<{ lane: number; age: number }> = [];
  private judgementAge = 99;
  private comboValue = 0;
  private externalEffects?: MobileEffectPack;

  public constructor(private readonly theme: MobileSkinTheme = DEFAULT_MOBILE_THEME) {
    this.container.visible = false;
    this.container.addChild(this.background, this.highway, this.notes, this.effects, this.extensionLayer, this.hud, this.resultLayer);
    this.notes.addChild(this.holdBodies);
    for (const color of theme.colors.lanes) {
      if (this.barTemplates.has(color)) continue;
      this.barTemplates.set(color, new Graphics()
        .roundRect(0, -14, 68, 14, 7).fill(color)
        .stroke({ width: 2, color: 0xffffff, alpha: .85 })
        .roundRect(8, -12, 52, 3.5, 2).fill({ color: 0xffffff, alpha: .45 }));
    }
    for (let lane = 0; lane < LANES; lane++) {
      const left = BOTTOM_LEFT + (BOTTOM_RIGHT - BOTTOM_LEFT) * lane / LANES;
      const right = BOTTOM_LEFT + (BOTTOM_RIGHT - BOTTOM_LEFT) * (lane + 1) / LANES;
      const top = this.noteRect(lane, .76);
      const effect = new Graphics()
        .poly([top.left, top.y, top.right, top.y, right, HEIGHT, left, HEIGHT])
        .fill({ color: this.theme.colors.lanes[lane], alpha: .18 })
        .roundRect(left + 3, JUDGE_Y + 8, right - left - 6, 45, 10)
        .fill({ color: this.theme.colors.lanes[lane], alpha: .36 })
        .stroke({ width: 2, color: 0xffffff, alpha: .45 });
      effect.visible = false;
      this.container.addChildAt(effect, this.container.getChildIndex(this.effects));
      this.pressEffects.push(effect);
    }
    this.externalEffects = theme.createEffects?.();
    this.externalEffects?.mount(this.extensionLayer);
    this.setupBackground();
    this.setupHud();
    this.setupResult();
  }

  private makeText(value: string, size: number, color: number, weight: string): Text {
    return new Text({ text: value, style: new TextStyle({
      fontFamily: 'Inter, system-ui, "Microsoft YaHei", sans-serif', fontSize: size,
      fontWeight: weight as 'normal', fill: color, letterSpacing: size < 15 ? 1.2 : 0,
      dropShadow: { color: 0x07101f, alpha: .8, blur: 5, distance: 2 }
    }) });
  }

  private setupBackground(): void {
    const c = this.theme.colors;
    this.background.rect(0, 0, WIDTH, HEIGHT).fill(c.background);
    this.background.circle(110, 108, 185).fill({ color: 0x4b2a88, alpha: .25 });
    this.background.circle(623, 180, 230).fill({ color: 0x006e96, alpha: .22 });
    this.background.circle(358, 500, 300).fill({ color: 0x101d3c, alpha: .92 });
    for (let i = 0; i < 34; i++) {
      const x = (i * 137 + 41) % WIDTH;
      const y = (i * 73 + 29) % 330;
      this.background.circle(x, y, i % 5 === 0 ? 1.8 : 1)
        .fill({ color: i % 3 === 0 ? 0x68ddff : 0xffffff, alpha: .25 + (i % 4) * .08 });
    }
    this.highway.poly([TOP_LEFT, TOP_Y, TOP_RIGHT, TOP_Y, BOTTOM_RIGHT, JUDGE_Y, BOTTOM_LEFT, JUDGE_Y])
      .fill({ color: c.highway, alpha: .96 }).stroke({ width: 3, color: c.edge, alpha: .58 });
    for (let lane = 0; lane <= LANES; lane++) {
      const topX = TOP_LEFT + (TOP_RIGHT - TOP_LEFT) * lane / LANES;
      const bottomX = BOTTOM_LEFT + (BOTTOM_RIGHT - BOTTOM_LEFT) * lane / LANES;
      this.highway.moveTo(topX, TOP_Y).lineTo(bottomX, JUDGE_Y)
        .stroke({ width: lane === 0 || lane === LANES ? 2 : 1, color: c.grid, alpha: lane % 2 ? .20 : .30 });
    }
    for (let row = 1; row < 8; row++) {
      const t = row / 8;
      const y = TOP_Y + (JUDGE_Y - TOP_Y) * t;
      const { left, right } = this.boundsAt(t);
      this.highway.moveTo(left, y).lineTo(right, y).stroke({ width: 1, color: 0x68c9ef, alpha: .06 + t * .06 });
    }
    this.highway.moveTo(BOTTOM_LEFT - 5, JUDGE_Y).lineTo(BOTTOM_RIGHT + 5, JUDGE_Y)
      .stroke({ width: 8, color: c.edge, alpha: .2 });
    this.highway.moveTo(BOTTOM_LEFT, JUDGE_Y).lineTo(BOTTOM_RIGHT, JUDGE_Y)
      .stroke({ width: 2, color: 0xe9fbff, alpha: .95 });
  }

  private setupHud(): void {
    this.title.position.set(25, 20); this.song.position.set(25, 41);
    this.score.anchor.set(1, 0); this.score.position.set(691, 16);
    this.ratio.anchor.set(1, 0); this.ratio.position.set(691, 44);
    this.time.anchor.set(.5, 0); this.time.position.set(WIDTH / 2, 18);
    this.auto.position.set(25, 74); this.speed.anchor.set(1, 0); this.speed.position.set(691, 74);
    this.combo.anchor.set(.5); this.combo.position.set(WIDTH / 2, 205);
    this.comboCaption.anchor.set(.5); this.comboCaption.position.set(WIDTH / 2, 235);
    this.judgement.anchor.set(.5); this.judgement.position.set(WIDTH / 2, 365);
    this.countdown.anchor.set(.5); this.countdown.position.set(WIDTH / 2, 255);
    this.hud.addChild(this.title, this.song, this.score, this.ratio, this.time, this.auto, this.speed,
      this.combo, this.comboCaption, this.judgement, this.countdown);
    this.combo.visible = this.comboCaption.visible = false;
    this.countdown.visible = false;
  }

  private setupResult(): void {
    this.resultLayer.visible = false;
    this.resultPanel.roundRect(158, 106, 400, 300, 28).fill({ color: 0x0b1730, alpha: .96 })
      .stroke({ width: 2, color: 0x78e5ff, alpha: .75 });
    this.resultTitle.anchor.set(.5); this.resultTitle.position.set(WIDTH / 2, 165);
    this.resultStats.anchor.set(.5, 0); this.resultStats.position.set(WIDTH / 2, 226);
    this.resultStats.style.align = 'center';
    this.resultLayer.addChild(this.resultPanel, this.resultTitle, this.resultStats);
  }

  public setVisible(value: boolean): void { this.container.visible = value; }
  public setSongInfo(title: string, artist: string, level: number): void { this.song.text = `${title}  ·  ${artist}  ·  Lv.${level}`; }
  public setAutoPlay(value: boolean): void { this.auto.text = value ? 'AUTO PLAY' : 'MANUAL'; this.auto.style.fill = value ? 0xffdf65 : this.theme.colors.muted; }
  public setSpeed(gear: number): void { this.speed.text = `SPEED ${gear}`; }
  public setLaneState(lane: number, value: boolean): void {
    if (lane < 0 || lane >= LANES) return;
    this.pressed[lane] = value;
    this.pressEffects[lane].visible = value && !this.resultLayer.visible;
    this.externalEffects?.setLanePressed?.(lane, value);
  }

  public hitTest(sceneX: number, sceneY: number): number {
    if (sceneY < 350 || sceneY > HEIGHT) return -1;
    const t = Math.max(0, Math.min(1, (sceneY - TOP_Y) / (JUDGE_Y - TOP_Y)));
    const { left, right } = this.boundsAt(t);
    const padding = sceneY >= JUDGE_Y ? 34 : 8;
    if (sceneX < left - padding || sceneX >= right + padding) return -1;
    const x = Math.max(left, Math.min(right - .001, sceneX));
    return Math.max(0, Math.min(LANES - 1, Math.floor((x - left) / ((right - left) / LANES))));
  }

  public showHit(lane: number): void { this.bursts.push({ lane, age: 0 }); this.externalEffects?.playHit?.(lane); }
  public showJudgement(rating: JudgmentRating): void {
    const colors: Record<JudgmentRating, number> = { COOL: 0x8ff6ff, GOOD: 0x90ff9b, BAD: 0xffb84d, MISS: 0xff537b };
    this.judgement.text = rating === 'COOL' ? 'PERFECT' : rating;
    this.judgement.style.fill = colors[rating]; this.judgement.scale.set(1.25); this.judgement.alpha = 1; this.judgementAge = 0;
  }
  public setCombo(value: number): void {
    this.comboValue = value; this.combo.text = String(value);
    this.combo.visible = this.comboCaption.visible = value > 0;
    if (value > 0) this.combo.scale.set(1.12);
  }
  public setCountdown(value: string | null): void {
    this.countdown.visible = value !== null;
    this.countdown.text = value ?? '';
    if (value !== this.countdownValue) {
      this.countdownAge = 0;
      this.countdown.alpha = 1;
      this.countdown.scale.set(value === 'GO!' ? .72 : 1.65);
    }
    this.countdownValue = value;
  }
  public showResult(data: ResultData): void {
    this.resultTitle.text = data.outcome === 'result' ? 'LIVE CLEAR' : 'LIVE FAILED';
    this.resultTitle.style.fill = data.outcome === 'result' ? 0x8ff6ff : 0xff6789;
    this.resultStats.text = `SCORE\n${data.score.toString().padStart(7, '0')}\n\nACCURACY  ${data.accuracy.toFixed(1)}%\nMAX COMBO  ${data.maxCombo}`;
    this.resultLayer.visible = true; this.notes.visible = this.effects.visible = false;
    for (const effect of this.pressEffects) effect.visible = false;
  }
  public hideResult(): void {
    this.resultLayer.visible = false; this.notes.visible = this.effects.visible = true;
    this.pressEffects.forEach((effect, lane) => { effect.visible = this.pressed[lane]; });
  }
  public reset(): void {
    this.candidates.length = 0;
    this.sourceNotes = null;
    this.nextNote = 0;
    this.lastTime = -Infinity;
    for (const bar of this.noteBars) bar.visible = false;
    this.holdBodies.clear();
    this.bursts.length = 0;
    this.effects.clear();
    this.effectsDrawn = false;
    this.setCombo(0);
    this.judgement.alpha = 0;
    this.hideResult();
  }

  public advance(deltaSec: number): void {
    if (this.countdown.visible) {
      this.countdownAge += deltaSec;
      const go = this.countdownValue === 'GO!';
      const progress = Math.min(1, this.countdownAge / .18);
      const eased = 1 - Math.pow(1 - progress, 3);
      const start = go ? .72 : 1.65;
      const end = go ? 1.12 : 1;
      this.countdown.scale.set(start + (end - start) * eased);
      this.countdown.alpha = this.countdownAge < .58 ? 1 : Math.max(0, 1 - (this.countdownAge - .58) / .34);
    }
    let kept = 0;
    for (const burst of this.bursts) {
      burst.age += deltaSec;
      if (burst.age < .28) this.bursts[kept++] = burst;
    }
    this.bursts.length = kept;
    if (this.combo.scale.x > 1) this.combo.scale.set(Math.max(1, this.combo.scale.x - deltaSec * 1.7));
    if (this.judgement.scale.x > 1) this.judgement.scale.set(Math.max(1, this.judgement.scale.x - deltaSec * 2.4));
    this.judgementAge += deltaSec;
    if (this.judgementAge > .42) this.judgement.alpha = Math.max(0, 1 - (this.judgementAge - .42) * 4);
    this.externalEffects?.update?.(deltaSec);
    this.drawEffects();
  }

  public render(input: MobileFrameInput): void {
    if (this.lastScore !== input.score.score) {
      this.lastScore = input.score.score;
      this.score.text = input.score.score.toString().padStart(7, '0');
    }
    if (this.lastAccuracy !== input.score.accuracy) {
      this.lastAccuracy = input.score.accuracy;
      this.ratio.text = `${input.score.accuracy.toFixed(1)}%`;
    }
    const current = Math.floor(Math.max(0, input.currentTimeSec));
    const duration = Math.floor(input.totalDurationSec);
    if (this.lastSecond !== current || this.lastDuration !== duration) {
      this.lastSecond = current; this.lastDuration = duration;
      this.time.text = `${this.formatTime(current)} / ${this.formatTime(duration)}`;
    }
    if (this.comboValue !== input.score.combo) this.setCombo(input.score.combo);
    this.holdBodies.clear();
    this.usedBars = 0;
    const visibleTicks = 390 * input.stepTicks;
    if (this.sourceNotes !== input.notes || input.currentTimeSec < this.lastTime) {
      this.sourceNotes = input.notes;
      this.candidates.length = 0;
      this.nextNote = 0;
    }
    this.lastTime = input.currentTimeSec;
    while (this.nextNote < input.notes.length &&
      input.noteStartTick(input.notes[this.nextNote]) <= input.currentTick + visibleTicks) {
      this.candidates.push(input.notes[this.nextNote++]);
    }
    let kept = 0;
    for (const note of this.candidates) {
      const unfinishedLong = note.isLong && !note.holdCompleted && input.currentTimeSec < note.startSec + note.durationSec + .15;
      if (note.judged && !note.holdActive && !unfinishedLong) continue;
      const headTick = input.noteStartTick(note);

      const headProgress = note.isLong && note.judged ? 1 : 1 - (headTick - input.currentTick) / visibleTicks;
      if (headProgress > 1.12 && !note.isLong) continue;
      this.candidates[kept++] = note;
      if (headProgress < -.08 || headProgress > 1.12) continue;
      const head = this.noteRect(note.lane, headProgress);
      const alpha = note.holdBroken || note.hitScore === 'MISS' ? .28 : 1;
      if (note.isLong) {
        const tailProgress = 1 - (input.noteEndTick(note) - input.currentTick) / visibleTicks;
        if (tailProgress > -.1) {
          const tail = this.noteRect(note.lane, tailProgress);
          this.holdBodies.poly([tail.left + tail.width * .13, tail.y, tail.right - tail.width * .13, tail.y,
            head.right - head.width * .13, head.y, head.left + head.width * .13, head.y])
            .fill({ color: this.theme.colors.lanes[note.lane], alpha: .24 * alpha });
          this.holdBodies.poly([tail.left + tail.width * .22, tail.y, tail.right - tail.width * .22, tail.y,
            head.right - head.width * .22, head.y, head.left + head.width * .22, head.y])
            .fill({ color: 0xc9fbff, alpha: .28 * alpha });
          this.drawNoteBar(tail, this.theme.colors.lanes[note.lane], alpha * .8);
        }
      }
      this.drawNoteBar(head, this.theme.colors.lanes[note.lane], alpha);
    }
    this.candidates.length = kept;
    for (let i = this.usedBars; i < this.noteBars.length; i++) this.noteBars[i].visible = false;
  }

  private drawEffects(): void {
    if (!this.bursts.length && !this.effectsDrawn) return;
    this.effects.clear();
    this.effectsDrawn = this.bursts.length > 0;
    for (const burst of this.bursts) {
      const center = BOTTOM_LEFT + (BOTTOM_RIGHT - BOTTOM_LEFT) * (burst.lane + .5) / LANES;
      const p = burst.age / .28;
      this.effects.circle(center, JUDGE_Y, 14 + p * 56).fill({ color: this.theme.colors.lanes[burst.lane], alpha: (1 - p) * .28 });
      this.effects.circle(center, JUDGE_Y, 9 + p * 36).stroke({ width: 3, color: 0xffffff, alpha: 1 - p });
    }
  }

  private drawNoteBar(rect: ReturnType<MobileStage['noteRect']>, color: number, alpha: number): void {
    if (rect.y < TOP_Y - 10 || rect.y > JUDGE_Y + 16) return;
    const h = Math.max(5, 6 + rect.progress * 8);
    let bar = this.noteBars[this.usedBars++];
    if (!bar) {
      bar = new Graphics(this.barTemplates.get(color)!.context);
      this.noteBars.push(bar);
      this.notes.addChild(bar);
    }
    bar.visible = true;
    bar.position.set(rect.left, rect.y);
    bar.scale.set(rect.width / 68, h / 14);
    bar.context = this.barTemplates.get(color)!.context;
    bar.alpha = alpha;
  }

  private noteRect(lane: number, rawProgress: number) {
    const progress = Math.max(0, Math.min(1, rawProgress));
    const eased = progress * progress * (.55 + .45 * progress);
    const y = TOP_Y + (JUDGE_Y - TOP_Y) * eased;
    const { left, right } = this.boundsAt(eased);
    const laneWidth = (right - left) / LANES;
    const width = laneWidth * .78;
    const center = left + laneWidth * (lane + .5);
    return { left: center - width / 2, right: center + width / 2, width, y, progress };
  }
  private boundsAt(t: number): { left: number; right: number } {
    return { left: TOP_LEFT + (BOTTOM_LEFT - TOP_LEFT) * t, right: TOP_RIGHT + (BOTTOM_RIGHT - TOP_RIGHT) * t };
  }
  private formatTime(seconds: number): string {
    return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  }
}
