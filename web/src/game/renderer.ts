/**
 * CanMusic Pixi.js (v8) Canvas Renderer
 */

import {
  Application, Assets, Container, Sprite, Graphics, Text, TextStyle, Texture,
  Rectangle, UPDATE_PRIORITY
} from 'pixi.js';
import type { PlayableNote } from '../parser/vos';
import type { GameScore, HitResult, JudgmentRating } from './judgment';
import { DEFAULT_SKIN, validateStageLayout, type StageLayout } from './skin';

export interface RendererOptions {
  container: HTMLElement;
  width: number;
  height: number;
}

export class CanMusicRenderer {
  private app: Application;
  private rootContainer: Container;

  // Layout / stage transform (plan P1 step 1/2/3)
  private layout: StageLayout = DEFAULT_SKIN.layout;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private stageScale = 1;
  private stageOffsetX = 0;
  private stageOffsetY = 0;

  // Layer containers (plan P1 step 7 layer order)
  private bgLayer: Container;
  private playAreaContainer: Container;
  private laneLayer: Container;
  private noteClipContainer: Container;
  private noteLayer: Container;
  private hitEffectLayer: Container;
  private canFrameLayer: Container;
  private decorationLayer: Container;
  private overlayLayer: Container;
  private pdaLayer: Container;
  private uiLayer: Container;

  // Loaded textures
  private texBg!: Texture;
  private texPlayArea!: Texture;
  private texCanBack!: Texture;
  private texCanFrame!: Texture;
  private texHitBar!: Texture;
  private texNoteSkins: Texture[] = [];
  private texHitBurstFrames: Texture[] = [];
  private texComboDigits: Texture[] = [];
  private texKeyNormal!: Texture;
  private texKeyPut!: Texture;

  // Hit burst animations
  private activeHitBursts: { sprite: Sprite; frame: number; timer: number; lane: number }[] = [];

  // Active note sprites pool
  private noteSpritePool: Sprite[] = [];
  private longNoteTailPool: Sprite[] = [];
  private longNoteBodyPool: { borders: Sprite[]; fill: Sprite }[] = [];
  private renderCandidates: PlayableNote[] = [];
  private nextCandidateIndex = 0;
  private renderedNotes: PlayableNote[] | null = null;
  private lastRenderTime = Number.NEGATIVE_INFINITY;

  // Hit judgement text
  private judgeTextContainer: Container;
  private judgeText: Text;
  private judgeTextTimer = 0;

  // PDA UI elements
  private comboContainer: Container;
  private comboDigitSprites: Sprite[] = [];
  private comboLabel: Text;
  private displayedCombo = 0;

  private titleText: Text;
  private artistText: Text;
  private scoreText: Text;
  private accuracyText: Text;
  private speedText: Text;
  private timeText: Text;
  private autoText: Text;
  private lifeBarGfx: Graphics;
  private displayedLife = Number.NaN;
  private displayedScore = Number.NaN;
  private displayedAccuracy = Number.NaN;
  private displayedTimeSecond = Number.NaN;
  private displayedTotalSecond = Number.NaN;

  // Key press visuals for 7 lanes (drawn from the shared layout rectangles)
  private lanePressGfx: Graphics[] = [];
  private keySprites: Sprite[] = [];

  // Speed settings
  public speedMultiplier = 1.0;
  public basePixelsPerSec = 240;

  constructor() {
    this.app = new Application();
    this.rootContainer = new Container();
    this.bgLayer = new Container();
    this.playAreaContainer = new Container();
    this.laneLayer = new Container();
    this.noteClipContainer = new Container();
    this.noteLayer = new Container();
    this.hitEffectLayer = new Container();
    this.canFrameLayer = new Container();
    this.decorationLayer = new Container();
    this.overlayLayer = new Container();
    this.pdaLayer = new Container();
    this.uiLayer = new Container();

    this.judgeTextContainer = new Container();
    this.judgeText = new Text();
    this.comboContainer = new Container();
    this.comboLabel = new Text();
    this.titleText = new Text();
    this.artistText = new Text();
    this.scoreText = new Text();
    this.accuracyText = new Text();
    this.speedText = new Text();
    this.timeText = new Text();
    this.autoText = new Text();
    this.lifeBarGfx = new Graphics();
  }

  public getRootContainer(): Container {
    return this.rootContainer;
  }

  public getApp(): Application {
    return this.app;
  }

  public getLayout(): StageLayout {
    return this.layout;
  }

  public async init(opts: RendererOptions): Promise<void> {
    // Guard the shared geometry table before anything is drawn from it.
    validateStageLayout(this.layout);

    await this.app.init({
      width: opts.width,
      height: opts.height,
      backgroundColor: 0x110e1a,
      preference: ['webgpu', 'webgl', 'canvas'],
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
      autoDensity: true,
      antialias: false,
      autoStart: false
    });

    // Follow the display refresh rate to preserve high-refresh input feedback.
    this.app.ticker.maxFPS = 0;

    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.dataset.renderer = this.app.renderer.name;
    opts.container.appendChild(canvas);

    this.canvasWidth = opts.width;
    this.canvasHeight = opts.height;

    // Uniform scale + centered letterbox: never stretch the 716x516 stage.
    this.stageScale = Math.min(opts.width / this.layout.stageWidth, opts.height / this.layout.stageHeight);
    this.stageOffsetX = (opts.width - this.layout.stageWidth * this.stageScale) / 2;
    this.stageOffsetY = (opts.height - this.layout.stageHeight * this.stageScale) / 2;

    this.app.stage.addChild(this.rootContainer);
    this.rootContainer.scale.set(this.stageScale);
    this.rootContainer.position.set(this.stageOffsetX, this.stageOffsetY);

    // Layer order: background -> lane/expression -> notes -> hits -> can+keys
    // -> stage characters -> combo/result -> page UI.
    this.rootContainer.addChild(this.bgLayer);
    this.rootContainer.addChild(this.playAreaContainer);
    this.playAreaContainer.addChild(this.laneLayer);
    this.playAreaContainer.addChild(this.noteClipContainer);
    this.noteClipContainer.addChild(this.noteLayer);
    this.noteClipContainer.addChild(this.hitEffectLayer);
    this.rootContainer.addChild(this.canFrameLayer);
    this.rootContainer.addChild(this.decorationLayer);
    this.rootContainer.addChild(this.pdaLayer);
    this.rootContainer.addChild(this.overlayLayer);
    this.rootContainer.addChild(this.uiLayer);

    // Load assets
    await this.loadTextures();
    this.setupScene();
  }

  private async loadTextures(): Promise<void> {
    this.texBg = await Assets.load(DEFAULT_SKIN.bg.path);
    this.texPlayArea = await Assets.load(DEFAULT_SKIN.playArea.path);
    this.texCanBack = await Assets.load(DEFAULT_SKIN.canBack.path);
    this.texCanFrame = await Assets.load(DEFAULT_SKIN.canFrame.path);
    this.texHitBar = await Assets.load(DEFAULT_SKIN.hitBar0.path);
    this.texKeyNormal = await Assets.load(DEFAULT_SKIN.keyNormal.path);
    this.texKeyPut = await Assets.load(DEFAULT_SKIN.keyPut.path);

    // Slice 16 note skins at their natural frame size (416x24, 26 px each).
    const noteMeta = DEFAULT_SKIN.noteBase0;
    const baseNoteSkin = await Assets.load(noteMeta.skinPath);
    for (let i = 0; i < noteMeta.frameCount; i++) {
      this.texNoteSkins.push(new Texture({
        source: baseNoteSkin.source,
        frame: new Rectangle(i * noteMeta.frameWidth, 0, noteMeta.frameWidth, noteMeta.frameHeight)
      }));
    }

    // Slice the hit burst animation at its declared frame size.
    const burstMeta = DEFAULT_SKIN.hitBurst0;
    const baseHitAni = await Assets.load(burstMeta.path);
    for (let i = 0; i < burstMeta.frameCount; i++) {
      this.texHitBurstFrames.push(new Texture({
        source: baseHitAni.source,
        frame: new Rectangle(i * burstMeta.frameWidth, 0, burstMeta.frameWidth, burstMeta.frameHeight)
      }));
    }

    // Slice combo digits at their declared character size.
    const comboMeta = DEFAULT_SKIN.comboFont;
    const baseCombo = await Assets.load(comboMeta.path);
    for (let i = 0; i < comboMeta.charCount; i++) {
      this.texComboDigits.push(new Texture({
        source: baseCombo.source,
        frame: new Rectangle(i * comboMeta.charWidth, 0, comboMeta.charWidth, comboMeta.charHeight)
      }));
    }
  }

  private setupScene(): void {
    const L = this.layout;

    // 1. Background at its original size.
    const bg = new Sprite(this.texBg);
    bg.width = L.stageWidth;
    bg.height = L.stageHeight;
    this.bgLayer.addChild(bg);

    // canback is the original full-width bowl fill. Without it, the narrower
    // play_area leaves the global page background visible around the lanes.
    const canBack = new Sprite(this.texCanBack);
    canBack.position.set(L.canBack.x, L.canBack.y);
    canBack.width = L.canBack.width;
    canBack.height = L.canBack.height;
    this.bgLayer.addChild(canBack);

    // 2. Play area: natural size, no local stretch. The lane origin lives here.
    this.playAreaContainer.position.set(L.playX, L.playY);

    const pa = new Sprite(new Texture({
      source: this.texPlayArea.source,
      frame: new Rectangle(0, 0, L.playWidth, L.playHeight)
    }));
    pa.width = L.playWidth;
    pa.height = L.playHeight;
    this.playAreaContainer.addChildAt(pa, 0);

    // The mask only clips falling notes and hit effects, never the combo/result.
    const clipMask = new Graphics().rect(0, 0, L.playWidth, L.playHeight).fill(0xffffff);
    this.playAreaContainer.addChild(clipMask);
    this.noteClipContainer.mask = clipMask;

    // play_area already contains the original lane dividers. Only add the
    // transient press tint here; drawing replacement lines over the texture
    // makes the original one-pixel separators look doubled and uneven.
    for (let l = 0; l < L.laneCount; l++) {
      const x = l * L.laneWidth;
      const pressGfx = new Graphics();
      pressGfx.rect(x, 0, L.laneWidth, this.judgeLocalY() + 14);
      pressGfx.fill({ color: 0xffffff, alpha: 0.15 });
      pressGfx.visible = false;
      this.laneLayer.addChild(pressGfx);
      this.lanePressGfx.push(pressGfx);
    }

    // 3. Can frame, judgement bar and the seven keys share stage coordinates.
    const hitBarRect = L.hitBar;
    const hitBar = new Sprite(this.texHitBar);
    hitBar.width = hitBarRect.width;
    hitBar.height = hitBarRect.height;
    hitBar.position.set(hitBarRect.x, hitBarRect.y);
    this.canFrameLayer.addChild(hitBar);

    const canFrame = new Sprite(this.texCanFrame);
    canFrame.width = L.canWidth;
    canFrame.height = L.canHeight;
    canFrame.position.set(L.canX, L.canY);
    this.canFrameLayer.addChild(canFrame);

    // key_base, key_normal, key_put and key_death are the same 28x28 rounded
    // silhouette with different fills (629-631 opaque px each), so they are
    // mutually exclusive states rather than stacked layers. The interactive
    // pair used here is key_normal -> key_put; key_base/key_death stay in the
    // skin table for later states.
    const keyNames = ['S', 'D', 'F', 'SPACE', 'J', 'K', 'L'];
    for (let l = 0; l < L.keyPositions.length; l++) {
      const rect = L.keyPositions[l];

      const keySpr = new Sprite(this.texKeyNormal);
      keySpr.position.set(rect.x, rect.y);
      keySpr.width = rect.width;
      keySpr.height = rect.height;
      this.canFrameLayer.addChild(keySpr);
      this.keySprites.push(keySpr);

      const keyText = new Text({
        text: keyNames[l],
        style: new TextStyle({
          fontFamily: 'monospace',
          fontSize: l === 3 ? 9 : 11,
          fontWeight: 'bold',
          fill: 0xffffff
        })
      });
      keyText.anchor.set(0.5);
      keyText.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2);
      this.canFrameLayer.addChild(keyText);
    }

    // 4. Hit Judgement text, positioned from the shared judge line.
    this.judgeTextContainer.position.set(L.playWidth / 2, this.judgeLocalY() - 40);
    this.judgeText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'Impact, Arial Black, sans-serif',
        fontSize: 32,
        fontWeight: 'bold',
        fill: 0x00ffff,
        stroke: { color: 0x001133, width: 5 }
      })
    });
    this.judgeText.anchor.set(0.5);
    this.judgeTextContainer.addChild(this.judgeText);
    this.judgeTextContainer.alpha = 0;
    this.playAreaContainer.addChild(this.judgeTextContainer);

    // 5. PDA Console Display (inside the green CRT screen at right).
    // Bounds measured in the original BG texture, shared with the scene scale.
    const pdaCenterX = 358;
    const pdaLeftX = 302;
    const pdaTopY = 124;

    this.titleText = new Text({
      text: 'CanMusic Web',
      style: new TextStyle({
        fontFamily: 'system-ui, sans-serif',
        fontSize: 10,
        fontWeight: 'bold',
        fill: 0x003311,
        align: 'center'
      })
    });
    this.titleText.anchor.set(0.5, 0);
    this.titleText.position.set(pdaCenterX, pdaTopY);
    this.pdaLayer.addChild(this.titleText);

    this.artistText = new Text({
      text: 'Select a song',
      style: new TextStyle({
        fontFamily: 'system-ui, sans-serif',
        fontSize: 8,
        fill: 0x115522,
        align: 'center'
      })
    });
    this.artistText.anchor.set(0.5, 0);
    this.artistText.position.set(pdaCenterX, pdaTopY + 13);
    this.pdaLayer.addChild(this.artistText);

    this.scoreText = new Text({
      text: 'SCORE: 0000000',
      style: new TextStyle({
        fontFamily: 'Courier New, monospace',
        fontSize: 9,
        fontWeight: 'bold',
        fill: 0x004411
      })
    });
    this.scoreText.position.set(pdaLeftX, pdaTopY + 25);
    this.pdaLayer.addChild(this.scoreText);

    this.accuracyText = new Text({
      text: 'ACCURACY: 100%',
      style: new TextStyle({
        fontFamily: 'Courier New, monospace',
        fontSize: 8,
        fontWeight: 'bold',
        fill: 0x004411
      })
    });
    this.accuracyText.position.set(pdaLeftX, pdaTopY + 36);
    this.pdaLayer.addChild(this.accuracyText);

    this.timeText = new Text({
      text: 'TIME: 00:00 / 00:00',
      style: new TextStyle({
        fontFamily: 'Courier New, monospace',
        fontSize: 8,
        fill: 0x004411
      })
    });
    this.timeText.position.set(pdaLeftX, pdaTopY + 47);
    this.pdaLayer.addChild(this.timeText);

    this.speedText = new Text({
      text: `SPD: ${this.speedMultiplier.toFixed(1)}x`,
      style: new TextStyle({
        fontFamily: 'Courier New, monospace',
        fontSize: 8,
        fontWeight: 'bold',
        fill: 0x004411
      })
    });
    this.speedText.position.set(pdaLeftX, pdaTopY + 58);
    this.pdaLayer.addChild(this.speedText);

    this.autoText = new Text({
      text: 'AUTO: OFF',
      style: new TextStyle({
        fontFamily: 'Courier New, monospace',
        fontSize: 8,
        fontWeight: 'bold',
        fill: 0x771111
      })
    });
    this.autoText.position.set(pdaLeftX + 65, pdaTopY + 58);
    this.pdaLayer.addChild(this.autoText);

    // Life / Groove bar at bottom of green screen
    this.lifeBarGfx.position.set(pdaLeftX, pdaTopY + 70);
    this.pdaLayer.addChild(this.lifeBarGfx);
    this.renderLifeBar(50);

    // 6. Combo counter lives in its own overlay container so the lane mask
    // can never clip it (plan P1 step 8). P4 relocates it into the play area.
    this.comboContainer.position.set(pdaCenterX - 45, 290);
    this.comboContainer.visible = false;
    this.overlayLayer.addChild(this.comboContainer);

    this.comboLabel = new Text({
      text: 'COMBO',
      style: new TextStyle({
        fontFamily: 'Impact, Arial Black, sans-serif',
        fontSize: 18,
        fontWeight: 'bold',
        fill: 0xffeb3b,
        stroke: { color: 0x33691e, width: 4 }
      })
    });
    this.comboLabel.position.set(40, 48);
    this.comboContainer.addChild(this.comboLabel);
  }

  /** Judge line in play-area local coordinates (notes, keys and bursts share it). */
  private judgeLocalY(): number {
    return this.layout.judgeY - this.layout.playY;
  }

  public setLaneState(lane: number, pressed: boolean): void {
    if (lane >= 0 && lane < this.layout.laneCount) {
      if (this.lanePressGfx[lane]) this.lanePressGfx[lane].visible = pressed;
      if (this.keySprites[lane]) {
        this.keySprites[lane].texture = pressed ? this.texKeyPut : this.texKeyNormal;
      }
    }
  }

  /**
   * Convert a pointer position in client (CSS) coordinates to logical stage
   * coordinates, undoing the canvas CSS size and the uniform stage transform.
   */
  public clientToScene(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = this.app.canvas as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width > 0 ? (clientX - rect.left) * (this.canvasWidth / rect.width) : 0;
    const cy = rect.height > 0 ? (clientY - rect.top) * (this.canvasHeight / rect.height) : 0;
    return {
      x: this.stageScale ? (cx - this.stageOffsetX) / this.stageScale : cx,
      y: this.stageScale ? (cy - this.stageOffsetY) / this.stageScale : cy
    };
  }

  /**
   * Hit test a logical stage position against the same rectangles used to draw
   * the keys. Returns -1 outside every key, so letterbox margins never play.
   */
  public hitTestKey(sceneX: number, sceneY: number): number {
    const keys = this.layout.keyPositions;
    for (let lane = 0; lane < keys.length; lane++) {
      const k = keys[lane];
      if (sceneX >= k.x && sceneX < k.x + k.width &&
          sceneY >= k.y && sceneY < k.y + k.height) {
        return lane;
      }
    }
    return -1;
  }

  public startLoop(update: () => void): void {
    // Application.render is registered at LOW priority by Pixi's TickerPlugin.
    // HIGH guarantees game state is updated immediately before that render.
    this.app.ticker.add(update, undefined, UPDATE_PRIORITY.HIGH);
    this.app.start();
  }

  public showHitBurst(lane: number): void {
    const burstSprite = new Sprite(this.texHitBurstFrames[0]);
    burstSprite.anchor.set(0.5, 0.7);
    const x = lane * this.layout.laneWidth + this.layout.laneWidth / 2;
    const y = this.judgeLocalY() + 12;
    burstSprite.position.set(x, y);
    burstSprite.scale.set(0.65);
    this.hitEffectLayer.addChild(burstSprite);

    this.activeHitBursts.push({
      sprite: burstSprite,
      frame: 0,
      timer: 0,
      lane
    });
  }

  public showJudgement(rating: JudgmentRating): void {
    this.judgeText.text = rating;
    let color = 0x00ffff;
    if (rating === 'COOL') color = 0x00ffff;
    else if (rating === 'GOOD') color = 0x76ff03;
    else if (rating === 'BAD') color = 0xff9100;
    else if (rating === 'MISS') color = 0xff1744;

    this.judgeText.style.fill = color;
    this.judgeTextContainer.scale.set(1.3);
    this.judgeTextContainer.alpha = 1.0;
    this.judgeTextTimer = 35; // frames to stay visible
  }

  public updateCombo(combo: number): void {
    if (combo === this.displayedCombo) return;
    this.displayedCombo = combo;
    if (combo <= 1) {
      this.comboContainer.visible = false;
      return;
    }

    this.comboContainer.visible = true;
    const str = combo.toString();

    // Ensure we have enough digit sprites
    while (this.comboDigitSprites.length < str.length) {
      const spr = new Sprite(this.texComboDigits[0]);
      spr.scale.set(0.65);
      this.comboContainer.addChild(spr);
      this.comboDigitSprites.push(spr);
    }

    // Hide unused digits
    for (let i = str.length; i < this.comboDigitSprites.length; i++) {
      this.comboDigitSprites[i].visible = false;
    }

    let curX = 0;
    const digitWidth = DEFAULT_SKIN.comboFont.charWidth * 0.65;
    for (let i = 0; i < str.length; i++) {
      const digit = parseInt(str[i], 10);
      const spr = this.comboDigitSprites[i];
      spr.texture = this.texComboDigits[digit];
      spr.visible = true;
      spr.position.set(curX, 0);
      curX += digitWidth - 5;
    }

    this.comboLabel.position.set((curX - 45) / 2, 48);

    // Bump scale animation
    this.comboContainer.scale.set(1.15);
  }

  public setSongInfo(title: string, artist: string, level: number): void {
    this.fitText(this.titleText, title, 112);
    this.fitText(this.artistText, `${artist} (Lv.${level})`, 112);
  }

  public resetEffects(): void {
    this.renderCandidates.length = 0;
    this.nextCandidateIndex = 0;
    this.lastRenderTime = Number.NEGATIVE_INFINITY;
    this.updateCombo(0);
    this.judgeTextTimer = 0;
    this.judgeTextContainer.alpha = 0;
    for (const burst of this.activeHitBursts) burst.sprite.destroy();
    this.activeHitBursts = [];
  }

  private fitText(label: Text, value: string, maxWidth: number): void {
    label.text = value;
    const chars = Array.from(value);
    while (label.width > maxWidth && chars.length > 0) {
      chars.pop();
      label.text = chars.join('') + '…';
    }
  }

  public setAutoPlay(enabled: boolean): void {
    this.autoText.text = enabled ? 'AUTO: ON' : 'AUTO: OFF';
    this.autoText.style.fill = enabled ? 0x008822 : 0x771111;
  }

  public setSpeed(multiplier: number): void {
    this.speedMultiplier = multiplier;
    this.speedText.text = `SPD: ${multiplier.toFixed(1)}x`;
  }

  public renderLifeBar(life: number): void {
    if (life === this.displayedLife) return;
    this.displayedLife = life;
    this.lifeBarGfx.clear();
    const w = 112;
    const h = 6;

    // Background
    this.lifeBarGfx.rect(0, 0, w, h);
    this.lifeBarGfx.fill({ color: 0x00220a, alpha: 0.8 });
    this.lifeBarGfx.rect(0, 0, w, h);
    this.lifeBarGfx.stroke({ width: 1, color: 0x00551a });

    // Fill
    const fillW = Math.max(0, Math.min(w, (life / 100) * w));
    let color = 0x00e676;
    if (life < 30) color = 0xff3d00;
    else if (life < 60) color = 0xffea00;

    if (fillW > 0) {
      this.lifeBarGfx.rect(1, 1, Math.max(0, fillW - 2), h - 2);
      this.lifeBarGfx.fill({ color });
    }
  }

  /**
   * Main render loop called on every frame
   */
  public renderFrame(
    currentTimeSec: number,
    playableNotes: PlayableNote[],
    score: GameScore,
    totalDurationSec: number
  ): void {
    const L = this.layout;
    const judgeY = this.judgeLocalY();

    // Preserve the original 60 Hz animation durations at any display refresh rate.
    const elapsedFrames = this.renderedNotes === playableNotes && Number.isFinite(this.lastRenderTime)
      ? Math.max(0, currentTimeSec - this.lastRenderTime) * 60 : 0;
    // 1. Update PDA stats
    if (score.score !== this.displayedScore) {
      this.displayedScore = score.score;
      this.scoreText.text = `SCORE: ${score.score.toString().padStart(7, '0')}`;
    }
    if (score.accuracy !== this.displayedAccuracy) {
      this.displayedAccuracy = score.accuracy;
      this.accuracyText.text = `ACCURACY: ${score.accuracy.toFixed(1)}%`;
    }
    this.renderLifeBar(score.life);

    const currentSecond = Math.floor(Math.max(0, currentTimeSec));
    const totalSecond = Math.floor(totalDurationSec);
    if (currentSecond !== this.displayedTimeSecond || totalSecond !== this.displayedTotalSecond) {
      this.displayedTimeSecond = currentSecond;
      this.displayedTotalSecond = totalSecond;
      const curMin = Math.floor(currentSecond / 60);
      const curSec = currentSecond % 60;
      const totMin = Math.floor(totalSecond / 60);
      const totSec = totalSecond % 60;
      this.timeText.text = `TIME: ${curMin.toString().padStart(2, '0')}:${curSec.toString().padStart(2, '0')} / ${totMin.toString().padStart(2, '0')}:${totSec.toString().padStart(2, '0')}`;
    }

    // 2. Animate combo scale
    if (this.comboContainer.scale.x > 1.0) {
      const s = Math.max(1.0, this.comboContainer.scale.x - 0.02 * elapsedFrames);
      this.comboContainer.scale.set(s);
    }

    // 3. Animate judge text fade
    if (this.judgeTextTimer > 0) {
      this.judgeTextTimer = Math.max(0, this.judgeTextTimer - elapsedFrames);
      if (this.judgeTextContainer.scale.x > 1.0) {
        this.judgeTextContainer.scale.set(Math.max(1, this.judgeTextContainer.scale.x - 0.015 * elapsedFrames));
      }
      if (this.judgeTextTimer < 15) {
        this.judgeTextContainer.alpha = this.judgeTextTimer / 15;
      }
    } else {
      this.judgeTextContainer.alpha = 0;
    }

    // 4. Update hit burst animations
    for (let i = this.activeHitBursts.length - 1; i >= 0; i--) {
      const b = this.activeHitBursts[i];
      b.timer += elapsedFrames;
      const frame = Math.floor((b.timer + 1e-9) / 2);
      if (frame !== b.frame) {
        b.frame = frame;
        if (b.frame >= this.texHitBurstFrames.length) {
          this.hitEffectLayer.removeChild(b.sprite);
          b.sprite.destroy();
          this.activeHitBursts.splice(i, 1);
          continue;
        }
        b.sprite.texture = this.texHitBurstFrames[b.frame];
      }
    }

    // 5. Render visible falling notes
    const speed = this.basePixelsPerSec * this.speedMultiplier;
    const laneColors = DEFAULT_SKIN.laneColorIndices;
    const noteW = DEFAULT_SKIN.noteBase0.frameWidth;
    const noteH = DEFAULT_SKIN.noteBase0.frameHeight;

    if (this.renderedNotes !== playableNotes || currentTimeSec < this.lastRenderTime) {
      this.renderedNotes = playableNotes;
      this.renderCandidates.length = 0;
      this.nextCandidateIndex = 0;
    }
    this.lastRenderTime = currentTimeSec;

    // Add notes only when their head is close enough to enter the clipped area.
    const approachSec = (judgeY + 80) / speed;
    while (this.nextCandidateIndex < playableNotes.length &&
      playableNotes[this.nextCandidateIndex].startSec <= currentTimeSec + approachSec) {
      this.renderCandidates.push(playableNotes[this.nextCandidateIndex++]);
    }

    let spriteIndex = 0;
    let longTailIndex = 0;
    let longBodyIndex = 0;
    let keptCandidateCount = 0;

    for (let i = 0; i < this.renderCandidates.length; i++) {
      const note = this.renderCandidates[i];
      const unfinishedLong = note.isLong && !note.holdCompleted &&
        currentTimeSec < note.startSec + note.durationSec + .15;
      if (note.judged && !note.holdActive && !unfinishedLong) continue;

      const delta = note.startSec - currentTimeSec;
      const yPos = note.isLong && note.judged ? judgeY : judgeY - delta * speed;

      // A speed change can temporarily leave future notes in the candidate list.
      if (yPos < -80) {
        this.renderCandidates[keptCandidateCount++] = note;
        continue;
      }
      if (yPos > L.playHeight + 40 && !note.isLong) {
        continue;
      }
      this.renderCandidates[keptCandidateCount++] = note;

      const laneX = note.lane * L.laneWidth + (L.laneWidth - noteW) / 2;

      // Handle Long Note Body & Tail
      if (note.isLong) {
        const tailDelta = (note.startSec + note.durationSec) - currentTimeSec;
        const tailY = judgeY - tailDelta * speed;

        if (tailY < L.playHeight + 50) {
          const bodyTopY = Math.max(0, tailY + 12);
          const bodyBottomY = Math.min(L.playHeight, yPos + 12);
          const bodyHeight = bodyBottomY - bodyTopY;

          if (bodyHeight > 0) {
            // Keep the center transparent; a solid white backing washes out the fill.
            let body = this.longNoteBodyPool[longBodyIndex];
            if (!body) {
              body = {
                borders: Array.from({ length: 4 }, () => new Sprite(Texture.WHITE)),
                fill: new Sprite(Texture.WHITE)
              };
              this.noteLayer.addChild(body.fill, ...body.borders);
              this.longNoteBodyPool.push(body);
            }

            const laneColorHex = [0xff4081, 0x00e5ff, 0xffd600, 0xff1744, 0xffd600, 0x00e5ff, 0xff4081][note.lane];
            const stateAlpha = note.holdBroken || note.hitScore === 'MISS' ? .3 : 1;
            const [top, bottom, left, right] = body.borders;
            for (const border of body.borders) {
              border.visible = true;
              border.alpha = .85 * stateAlpha;
            }
            top.position.set(laneX + 2, bodyTopY - 1);
            bottom.position.set(laneX + 2, bodyTopY + Math.max(1, bodyHeight - 1));
            top.width = bottom.width = 22;
            top.height = Math.min(2, bodyHeight + 2);
            bottom.height = Math.min(2, bodyHeight);
            left.position.set(laneX + 2, bodyTopY + 1);
            right.position.set(laneX + 22, bodyTopY + 1);
            left.width = right.width = 2;
            left.height = right.height = Math.max(0, bodyHeight - 2);
            body.fill.visible = true;
            body.fill.tint = laneColorHex;
            body.fill.alpha = .65 * stateAlpha;
            body.fill.position.set(laneX + 3, bodyTopY);
            body.fill.width = 20;
            body.fill.height = bodyHeight;

            longBodyIndex++;

            // Long note tail cap
            let tailSpr = this.longNoteTailPool[longTailIndex];
            if (!tailSpr) {
              tailSpr = new Sprite(this.texNoteSkins[laneColors[note.lane]]);
              this.noteLayer.addChild(tailSpr);
              this.longNoteTailPool.push(tailSpr);
            }
            tailSpr.visible = true;
            tailSpr.texture = this.texNoteSkins[laneColors[note.lane]];
            tailSpr.width = noteW;
            tailSpr.height = noteH;
            tailSpr.alpha = note.holdBroken || note.hitScore === 'MISS' ? .3 : .9;
            tailSpr.position.set(laneX, tailY);
            longTailIndex++;
          }
        }
      }

      // Short Note Head (or Long Note Head if not yet completed)
      if (yPos >= -noteH && yPos <= L.playHeight + 20) {
        let spr = this.noteSpritePool[spriteIndex];
        if (!spr) {
          spr = new Sprite(this.texNoteSkins[0]);
          this.noteLayer.addChild(spr);
          this.noteSpritePool.push(spr);
        }
        spr.visible = true;
        spr.alpha = note.holdBroken || note.hitScore === 'MISS' ? .3 : 1;
        spr.texture = this.texNoteSkins[laneColors[note.lane]];
        spr.width = noteW;
        spr.height = noteH;
        spr.position.set(laneX, yPos);
        spriteIndex++;
      }
    }
    this.renderCandidates.length = keptCandidateCount;

    // Hide remaining unused sprites in pool
    for (let k = spriteIndex; k < this.noteSpritePool.length; k++) {
      this.noteSpritePool[k].visible = false;
    }
    for (let k = longTailIndex; k < this.longNoteTailPool.length; k++) {
      this.longNoteTailPool[k].visible = false;
    }
    for (let k = longBodyIndex; k < this.longNoteBodyPool.length; k++) {
      for (const border of this.longNoteBodyPool[k].borders) border.visible = false;
      this.longNoteBodyPool[k].fill.visible = false;
    }
  }

  public destroy(): void {
    this.app.destroy(true, { children: true, texture: false });
  }
}
