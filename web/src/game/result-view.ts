import { Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from '../render/webgl';
import { DEFAULT_SKIN, type FontTextureMeta, type FrameRect } from './skin';

export type RoundState = 'ready' | 'playing' | 'result' | 'failed';
export type RoundOutcome = 'result' | 'failed';
export const CLEAR_ACCURACY = 60;

// Recovered from CanMusic.dll's result state machine. The percentage advances
// for 40 fixed 60 Hz frames. Score digits then enter left-to-right over nine
// frames using the original signed position-offset table.
export const RESULT_INTRO_FRAMES = 9;
export const RESULT_RATIO_FRAMES = 40;
export const RESULT_SCORE_FRAMES_PER_DIGIT = 9;
export const RESULT_SCORE_OFFSETS = Object.freeze([-25, -10, 0, 5, 4, 3, 2, 1, 0]);

export interface ResultAnimationState {
  accuracy: number;
  settledScoreDigits: number;
  activeScoreDigit: number;
  activeScoreFrame: number;
  complete: boolean;
}

/** Deterministic 60 Hz reconstruction of the original result counters. */
export function getResultAnimationState(elapsedSec: number, accuracy: number, scoreDigits = 5): ResultAnimationState {
  const elapsedFrames = Math.max(0, Math.floor(elapsedSec * 60));
  const ratioFrame = Math.max(0, Math.min(RESULT_RATIO_FRAMES, elapsedFrames - RESULT_INTRO_FRAMES));
  const scoreFrame = elapsedFrames - RESULT_INTRO_FRAMES - RESULT_RATIO_FRAMES;
  if (scoreFrame < 0) {
    return {
      accuracy: Math.max(0, Math.min(100, accuracy)) * ratioFrame / RESULT_RATIO_FRAMES,
      settledScoreDigits: 0,
      activeScoreDigit: -1,
      activeScoreFrame: 0,
      complete: false
    };
  }
  const settledScoreDigits = Math.min(scoreDigits, Math.floor(scoreFrame / RESULT_SCORE_FRAMES_PER_DIGIT));
  const activeScoreDigit = settledScoreDigits < scoreDigits ? settledScoreDigits : -1;
  const activeScoreFrame = activeScoreDigit < 0 ? RESULT_SCORE_FRAMES_PER_DIGIT - 1
    : scoreFrame % RESULT_SCORE_FRAMES_PER_DIGIT;
  return {
    accuracy: Math.max(0, Math.min(100, accuracy)) * ratioFrame / RESULT_RATIO_FRAMES,
    settledScoreDigits,
    activeScoreDigit,
    activeScoreFrame,
    complete: settledScoreDigits === scoreDigits
  };
}

/** The original round is settled only after the song; exactly 60% is a clear. */
export function getRoundOutcome(accuracy: number): RoundOutcome {
  return accuracy < CLEAR_ACCURACY ? 'failed' : 'result';
}

export interface ResultData {
  outcome: RoundOutcome;
  score: number;
  accuracy: number;
  maxCombo: number;
  eq?: number;
  multiplier?: number;
}

/** Pure snapshot helper used before input/audio cleanup can mutate live state. */
export function createResultData(
  outcome: RoundOutcome,
  score: number,
  accuracy: number,
  maxCombo: number,
  extras: Pick<ResultData, 'eq' | 'multiplier'> = {}
): ResultData {
  return Object.freeze({ outcome, score, accuracy, maxCombo, ...extras });
}

/**
 * Draws immutable round data. It never reads from or writes to the judgment engine.
 */
export class ResultView {
  public readonly container = new Container();

  private atlas!: Texture;
  private messageAtlas!: Texture;
  private scoreDigits: Texture[] = [];
  private ratioDigits: Texture[] = [];
  private eqDigits: Texture[] = [];
  private title!: Sprite;
  private scoreContainer = new Container();
  private ratioContainer = new Container();
  private ratioIntegerContainer = new Container();
  private ratioDecimal = new Graphics();
  private ratioFractionContainer = new Container();
  private eqContainer = new Container();
  private heart!: Sprite;
  private stats!: Sprite;
  private eqPanel!: Sprite;
  private multiplier!: Sprite;
  private messages: Sprite[] = [];
  private elapsedSec = 0;
  private currentData: ResultData | null = null;
  private scoreGlyphs: Sprite[] = [];
  private scoreGlyphBasePositions: Array<{ x: number; y: number }> = [];
  private displayedRatioTenths = -1;

  public constructor() {
    this.container.visible = false;
  }

  public async init(parent: Container): Promise<void> {
    this.atlas = await Assets.load(DEFAULT_SKIN.resultAtlas.path);
    this.messageAtlas = await Assets.load(DEFAULT_SKIN.messageAtlas.path);
    this.scoreDigits = await this.loadDigits(DEFAULT_SKIN.scoreFont);
    this.ratioDigits = await this.loadDigits(DEFAULT_SKIN.ratioFont);
    this.eqDigits = await this.loadDigits(DEFAULT_SKIN.eqFont);

    this.title = new Sprite();
    this.title.anchor.set(0.5, 0);
    this.heart = new Sprite(this.crop(this.atlas, DEFAULT_SKIN.resultAtlas.crops.heartCompact));
    this.stats = new Sprite(this.crop(this.atlas, DEFAULT_SKIN.resultAtlas.crops.panelRatioLine));
    this.eqPanel = new Sprite(this.crop(this.atlas, DEFAULT_SKIN.resultAtlas.crops.panelScoreLine));
    this.multiplier = new Sprite();
    // The original decimal point is a tiny white pixel block with a red
    // lower-right shadow; it is not part of 0_Ratio.ift or result.lle.
    this.ratioDecimal.rect(1, 1, 2, 2).fill(0xbd203a);
    this.ratioDecimal.rect(0, 0, 2, 2).fill(0xffffff);
    this.ratioContainer.addChild(
      this.ratioIntegerContainer,
      this.ratioDecimal,
      this.ratioFractionContainer
    );

    this.container.addChild(
      this.title,
      this.scoreContainer,
      this.stats,
      this.eqPanel,
      this.heart,
      this.ratioContainer,
      this.eqContainer,
      this.multiplier
    );
    parent.addChild(this.container);
    this.hide();
  }

  public show(data: ResultData): void {
    this.currentData = data;
    this.elapsedSec = 0;
    this.container.visible = true;
    this.clearMessages();

    const layout = DEFAULT_SKIN.resultLayout;
    const crops = DEFAULT_SKIN.resultAtlas.crops;
    const isFailed = data.outcome === 'failed';
    this.title.texture = this.crop(this.atlas, isFailed ? crops.titleFailed : crops.titleResult);
    this.title.position.set(DEFAULT_SKIN.effects.comboCenterX, isFailed ? layout.failedTitleY : layout.titleY);

    this.scoreGlyphs = this.drawDigits(
      this.scoreContainer,
      this.scoreDigits,
      String(Math.max(0, Math.trunc(data.score))).padStart(5, '0'),
      DEFAULT_SKIN.scoreFont.charWidth,
      DEFAULT_SKIN.scoreFont.spacing
    );
    this.scoreContainer.position.set(
      DEFAULT_SKIN.effects.comboCenterX,
      isFailed ? layout.failedScoreY : layout.scoreY
    );
    this.scoreGlyphBasePositions = this.scoreGlyphs.map(glyph => ({ x: glyph.x, y: glyph.y }));
    for (const glyph of this.scoreGlyphs) glyph.visible = false;

    this.stats.position.set(layout.stats.x, layout.stats.y);
    this.stats.width = layout.stats.width;
    this.stats.height = layout.stats.height;

    this.eqPanel.position.set(layout.eqPanel.x, layout.eqPanel.y);
    this.eqPanel.width = layout.eqPanel.width;
    this.eqPanel.height = layout.eqPanel.height;

    this.heart.position.set(layout.heart.x, layout.heart.y);
    this.heart.width = layout.heart.width;
    this.heart.height = layout.heart.height;

    this.ratioContainer.position.set(0, 0);
    this.ratioIntegerContainer.position.set(layout.ratioInteger.x, layout.ratioInteger.y);
    this.ratioDecimal.position.set(layout.ratioDecimal.x, layout.ratioDecimal.y);
    this.ratioFractionContainer.position.set(layout.ratioFraction.x, layout.ratioFraction.y);
    this.displayedRatioTenths = -1;
    this.drawRatio(0);

    if (data.eq === undefined) {
      this.drawFallbackText(this.eqContainer, '--');
    } else {
      this.drawDigits(
        this.eqContainer,
        this.eqDigits,
        String(Math.max(0, Math.trunc(data.eq))),
        DEFAULT_SKIN.eqFont.charWidth,
        DEFAULT_SKIN.eqFont.spacing
      );
    }
    this.eqContainer.position.set(layout.eqText.x, layout.eqText.y);

    this.multiplier.visible = data.multiplier !== undefined;
    if (data.multiplier !== undefined) {
      const rect = data.multiplier === 100 ? crops.badge100x
        : data.multiplier === 4 ? crops.badge4x
          : data.multiplier === 3 ? crops.badge3x : crops.badge2x;
      this.multiplier.texture = this.crop(this.atlas, rect);
      this.multiplier.position.set(layout.multiplier.x, layout.multiplier.y);
    }

    if (isFailed) this.addFailedMessages();
  }

  public update(deltaSec: number): void {
    if (!this.container.visible || !this.currentData) return;
    this.elapsedSec += deltaSec;
    const animation = getResultAnimationState(
      this.elapsedSec,
      this.currentData.accuracy,
      this.scoreGlyphs.length
    );
    this.drawRatio(animation.accuracy);

    for (let index = 0; index < this.scoreGlyphs.length; index++) {
      const glyph = this.scoreGlyphs[index];
      const base = this.scoreGlyphBasePositions[index];
      if (index < animation.settledScoreDigits) {
        glyph.visible = true;
        glyph.position.set(base.x, base.y);
      } else if (index === animation.activeScoreDigit) {
        const offset = RESULT_SCORE_OFFSETS[animation.activeScoreFrame];
        glyph.visible = true;
        glyph.position.set(base.x + offset, base.y + offset);
      } else {
        glyph.visible = false;
      }
    }
  }

  public hide(): void {
    this.container.visible = false;
    this.currentData = null;
    this.elapsedSec = 0;
    this.clearMessages();
  }

  public reset(): void {
    this.hide();
    this.title?.scale.set(1);
    this.scoreGlyphs = [];
    this.scoreGlyphBasePositions = [];
    this.displayedRatioTenths = -1;
  }

  public getData(): ResultData | null {
    return this.currentData;
  }

  private async loadDigits(meta: FontTextureMeta): Promise<Texture[]> {
    const atlas = await Assets.load(meta.path);
    return Array.from({ length: meta.charCount }, (_, digit) => new Texture({
      source: atlas.source,
      frame: new Rectangle(digit * meta.charWidth, 0, meta.charWidth, meta.charHeight)
    }));
  }

  private crop(texture: Texture, rect: FrameRect): Texture {
    return new Texture({
      source: texture.source,
      frame: new Rectangle(rect.x, rect.y, rect.width, rect.height)
    });
  }

  private drawDigits(
    target: Container,
    textures: Texture[],
    value: string,
    charWidth: number,
    spacing: number
  ): Sprite[] {
    target.removeChildren().forEach(child => child.destroy());
    const glyphs: Sprite[] = [];
    const width = value.length * charWidth + Math.max(0, value.length - 1) * spacing;
    let x = -width / 2;
    for (const character of value) {
      const digit = Number(character);
      if (!Number.isInteger(digit) || !textures[digit]) continue;
      const sprite = new Sprite(textures[digit]);
      sprite.position.set(x, 0);
      target.addChild(sprite);
      glyphs.push(sprite);
      x += charWidth + spacing;
    }
    return glyphs;
  }

  private drawRatio(value: number): void {
    const tenths = Math.round(Math.max(0, Math.min(100, value)) * 10);
    if (tenths === this.displayedRatioTenths) return;
    this.displayedRatioTenths = tenths;
    const integer = Math.floor(tenths / 10);
    const fraction = tenths % 10;
    this.drawDigits(
      this.ratioIntegerContainer,
      this.ratioDigits,
      String(integer),
      DEFAULT_SKIN.ratioFont.charWidth,
      DEFAULT_SKIN.ratioFont.spacing
    );
    this.drawDigits(
      this.ratioFractionContainer,
      this.ratioDigits,
      String(fraction),
      DEFAULT_SKIN.ratioFont.charWidth,
      DEFAULT_SKIN.ratioFont.spacing
    );
    // Keep the integer right-aligned against the decimal, including 100.0.
    const meta = DEFAULT_SKIN.ratioFont;
    const width = String(integer).length * (meta.charWidth + meta.spacing) - meta.spacing;
    this.ratioIntegerContainer.x = DEFAULT_SKIN.resultLayout.ratioDecimal.x - 2 - width / 2;
  }

  private drawFallbackText(target: Container, value: string): void {
    target.removeChildren().forEach(child => child.destroy());
    const text = new Text({ text: value, style: { fill: 0xffffff, fontSize: 9, fontFamily: 'monospace' } });
    text.anchor.set(0.5, 0);
    target.addChild(text);
  }

  private addFailedMessages(): void {
    const layout = DEFAULT_SKIN.resultLayout;
    // Block 4 contains the exact two-line encouragement shown in the failed
    // reference screenshot; the following blocks are different messages.
    const indices = [4];
    let y = layout.failedMessageY;
    for (const index of indices) {
      const rect = DEFAULT_SKIN.messageAtlas.messages[index];
      const sprite = new Sprite(this.crop(this.messageAtlas, rect));
      sprite.anchor.set(0.5, 0);
      sprite.position.set(DEFAULT_SKIN.effects.comboCenterX, y);
      y += rect.height - 4;
      this.container.addChild(sprite);
      this.messages.push(sprite);
    }
  }

  private clearMessages(): void {
    for (const message of this.messages) message.destroy();
    this.messages = [];
  }
}
