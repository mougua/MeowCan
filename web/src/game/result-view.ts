import { Assets, Container, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { DEFAULT_SKIN, type FontTextureMeta, type FrameRect } from './skin';

export type RoundState = 'ready' | 'playing' | 'result' | 'failed';
export type RoundOutcome = 'result' | 'failed';
export const CLEAR_ACCURACY = 60;

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
  private eqContainer = new Container();
  private heart!: Sprite;
  private stats!: Sprite;
  private multiplier!: Sprite;
  private messages: Sprite[] = [];
  private elapsedSec = 0;
  private currentData: ResultData | null = null;

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
    this.stats = new Sprite(this.crop(this.atlas, DEFAULT_SKIN.resultAtlas.crops.panelResult));
    this.multiplier = new Sprite();

    this.container.addChild(
      this.title,
      this.scoreContainer,
      this.stats,
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

    this.drawDigits(
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

    this.stats.position.set(layout.stats.x, layout.stats.y);
    this.stats.width = layout.stats.width;
    this.stats.height = layout.stats.height;

    this.heart.position.set(layout.heart.x, layout.heart.y);
    this.heart.width = layout.heart.width;
    this.heart.height = layout.heart.height;

    const ratioText = Math.max(0, Math.min(100, data.accuracy)).toFixed(1).replace('.', '');
    this.drawDigits(
      this.ratioContainer,
      this.ratioDigits,
      ratioText,
      DEFAULT_SKIN.ratioFont.charWidth,
      DEFAULT_SKIN.ratioFont.spacing
    );
    this.ratioContainer.position.set(layout.stats.x + 32, layout.stats.y + 35);

    const decimal = new Text({ text: '.', style: { fill: 0xffffff, fontSize: 9, fontFamily: 'monospace' } });
    decimal.position.set(1, 2);
    const percent = new Text({ text: '%', style: { fill: 0xffffff, fontSize: 8, fontFamily: 'monospace' } });
    percent.position.set(20, 3);
    this.ratioContainer.addChild(decimal, percent);

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
    this.eqContainer.position.set(layout.stats.x + layout.stats.width - 25, layout.stats.y + 30);

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
    if (!this.container.visible) return;
    this.elapsedSec += deltaSec;
    const pulse = 1 + Math.sin(this.elapsedSec * 5) * 0.015;
    this.title.scale.set(pulse);
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
  ): void {
    target.removeChildren().forEach(child => child.destroy());
    const width = value.length * charWidth + Math.max(0, value.length - 1) * spacing;
    let x = -width / 2;
    for (const character of value) {
      const digit = Number(character);
      if (!Number.isInteger(digit) || !textures[digit]) continue;
      const sprite = new Sprite(textures[digit]);
      sprite.position.set(x, 0);
      target.addChild(sprite);
      x += charWidth + spacing;
    }
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
