/**
 * CanMusic Pixi.js (v8) Canvas Renderer
 */

import {
  Application, Assets, Container, Sprite, Graphics, Text, TextStyle, Texture,
  Rectangle, UPDATE_PRIORITY, GlProgram, CanvasSource
} from 'pixi.js';
import { secondsToMusicTick, type PlayableNote, type TempoPoint } from '../parser/vos';
import type { GameScore, HitResult, JudgmentRating } from './judgment';
import { DEFAULT_SKIN, SkinManager, hitBurstTier, validateStageLayout, type StageLayout } from './skin';
import type { NoteSkinId, SkinId } from './skin';
import { ResultView, type ResultData } from './result-view';
import { MobileStage } from './mobile-stage';
import { createPaddedFrames, refreshPaddedFrames } from './texture-frames';
import { adjustSkinPixels, DEFAULT_SKIN_COLOR, normalizeSkinColor, type SkinColorAdjustment } from './skin-color';
import { countdownFrame } from './countdown';
import 'pixi.js/prepare';

export interface RendererOptions {
  container: HTMLElement;
  width: number;
  height: number;
  rendererPreference?: 'webgpu' | 'webgl';
  onProgress?: (loaded: number, total: number, asset: string) => void;
}

export interface PlaylistItemDisplay {
  id?: number | string;
  title: string;
  level: number;
  artist?: string;
  charter?: string;
}

export class CanMusicRenderer {
  private static readonly PDA_PLAYLIST_BOUNDS = new Rectangle(302, 124, 112, 73);
  private static readonly PDA_PLAYLIST_ROWS_TOP = 137;
  private static readonly PDA_PLAYLIST_ROW_HEIGHT = 12;
  private static readonly PDA_UP_BOUNDS = new Rectangle(308, 207, 47, 23);
  private static readonly PDA_DOWN_BOUNDS = new Rectangle(361, 207, 47, 23);

  private app: Application;
  private rootContainer: Container;

  // Layout / stage transform (plan P1 step 1/2/3)
  private layout: StageLayout = DEFAULT_SKIN.layout;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private fpsDisplay: HTMLElement | null = null;
  private stageScale = 1;
  private stageOffsetX = 0;
  private stageOffsetY = 0;

  // Layer containers (plan P1 step 7 layer order)
  private bgLayer: Container;
  private playAreaContainer: Container;
  private laneLayer: Container;
  private noteClipContainer: Container;
  private noteLayer: Container;
  private noteBodyLayer = new Container();
  private noteTailLayer = new Container();
  private noteHeadLayer = new Container();
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
  private texHitBurstFrames: Texture[][] = [];
  private texLongHitFrames: Texture[] = [];
  private texLongHeads: Texture[] = [];
  private texLongBodies: Texture[] = [];
  private countdownSprite: Sprite | null = null;
  private texComboDigits: Texture[] = [];
  private comboMeta = DEFAULT_SKIN.comboFont;
  private texFaceFrames: Texture[] = [];
  private texWingkyFrames: Texture[] = [];
  private texWingkyEyeFrames: Texture[] = [];
  private texStarFrames: Texture[] = [];
  private texKeyNormal!: Texture;
  private texKeyPut!: Texture;
  private readonly textureCache = new Map<string, Texture>();
  private readonly adjustedTextures = new Map<string, Texture>();
  private readonly noteColorAtlases = new Map<string, Texture>();
  private skinColor: SkinColorAdjustment = { ...DEFAULT_SKIN_COLOR };
  private readonly noteFrameCache = new Map<string, {
    notes: Texture[]; longHeads: Texture[]; longBodies: Texture[];
  }>();
  private readonly effectFrameCache = new Map<string, {
    short: Texture[][]; long: Texture[];
  }>();
  private readonly comboFrameCache = new Map<string, {
    meta: typeof DEFAULT_SKIN.comboFont; digits: Texture[];
  }>();
  private hitBarSprite!: Sprite;
  private playAreaSprite!: Sprite;
  private canBackSprite!: Sprite;
  private canFrameSprite!: Sprite;
  private readonly skinManager: SkinManager;

  // Hit burst animations
  private activeHitBursts: { sprite: Sprite; frames: Texture[]; elapsedSec: number; lane: number }[] = [];
  private hitBurstPool: Sprite[] = [];
  private holdEffectPool: Sprite[] = [];
  private holdEffects = new Map<number, { sprite: Sprite; elapsedSec: number }>();

  // Active note sprites pool
  private noteSpritePool: Sprite[] = [];
  private longNoteBodyPool: { borders: Sprite[]; fill: Sprite }[] = [];
  private longNoteTailPool: Sprite[] = [];
  private renderCandidates: PlayableNote[] = [];
  private nextCandidateIndex = 0;
  private renderedNotes: PlayableNote[] | null = null;
  private lastRenderTime = Number.NEGATIVE_INFINITY;

  // Hit judgement text
  private judgeTextContainer: Container;
  private judgeSprites = new Map<JudgmentRating, Sprite>();
  private judgeTextTimer = 0;
  private readonly activeHoldLanes = new Set<number>();

  // PDA UI elements
  private comboContainer: Container;
  private comboDigitSprites: Sprite[] = [];
  private displayedCombo = 0;

  private faceSprite: Sprite;
  private wingkySprite: Sprite;
  private wingkyEyeSprite: Sprite;
  private starSprite: Sprite;
  private resultView: ResultView;
  private mobileStage: MobileStage;

  // PDA Playlist UI elements
  private pdaPlaylistTitle!: Text;
  private pdaDivider!: Graphics;
  private pdaRowTexts: Text[] = [];
  private pdaRowBgs: Graphics[] = [];
  private playlistItems: PlaylistItemDisplay[] = [];
  private playlistActiveIndex = 0;

  private titleText: Text;
  private artistText: Text;
  private speedText: Text;
  private autoText: Text;

  // Key press visuals for 7 lanes (drawn from the shared layout rectangles)
  private lanePressGfx: Graphics[] = [];
  private keySprites: Sprite[] = [];
  private keyLabels: Text[] = [];

  // Speed settings: gears 1 to 14, default 8. The original client divides
  // MUSIC_TIME deltas (768 PPQ ticks) by its internal step, 16 - gear.
  public speedGear = 8;
  public basePixelsPerSec = 240;
  private tempoMap: TempoPoint[] = [{ quarter: 0, sec: 0, secPerQuarter: 0.5, bpm: 120 }];

  public get speedMultiplier(): number {
    return this.speedGear;
  }

  public set speedMultiplier(val: number) {
    this.setSpeed(val);
  }

  constructor(skinManager = new SkinManager()) {
    this.skinManager = skinManager;
    this.app = new Application();
    this.rootContainer = new Container();
    this.bgLayer = new Container();
    this.playAreaContainer = new Container();
    this.laneLayer = new Container();
    this.noteClipContainer = new Container();
    this.noteLayer = new Container();
    // Pool growth/reuse must not put a hold body above another note's head.
    this.noteLayer.addChild(this.noteBodyLayer, this.noteTailLayer, this.noteHeadLayer);
    // Note and effect pools toggle sprite visibility every frame. In Pixi v8
    // that rebuilds the owning render group's instruction list, so keep these
    // churning subtrees in their own groups instead of rebuilding the stage.
    this.noteLayer.isRenderGroup = true;
    this.hitEffectLayer = new Container({ isRenderGroup: true });
    this.canFrameLayer = new Container();
    this.decorationLayer = new Container();
    this.overlayLayer = new Container();
    this.pdaLayer = new Container();
    this.uiLayer = new Container();

    this.judgeTextContainer = new Container();
    this.comboContainer = new Container();
    this.faceSprite = new Sprite();
    this.wingkySprite = new Sprite();
    this.wingkyEyeSprite = new Sprite();
    this.starSprite = new Sprite();
    this.resultView = new ResultView();
    this.mobileStage = new MobileStage();
    this.titleText = new Text();
    this.artistText = new Text();
    this.speedText = new Text({ text: `SPD: ${this.speedGear}` });
    this.autoText = new Text();
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

  /** Resize the render surface while preserving the fixed logical stage. */
  public resize(width: number, height: number): void {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (nextWidth !== this.canvasWidth || nextHeight !== this.canvasHeight) {
      this.app.renderer.resize(nextWidth, nextHeight);
    }
    this.updateStageTransform(nextWidth, nextHeight);
  }

  private updateStageTransform(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
    // On touch portrait screens, frame the original can instead of shrinking
    // the full cabinet (whose controls and decorations occupy the right side).
    const portraitCan = this.skinManager.getSkin() !== 'mobile'
      && window.matchMedia('(orientation: portrait)').matches;
    const view = portraitCan
      ? { x: 0, y: 34, width: 273, height: 456 }
      : { x: 0, y: 0, width: this.layout.stageWidth, height: this.layout.stageHeight };
    this.stageScale = Math.min(width / view.width, height / view.height);
    this.stageOffsetX = (width - view.width * this.stageScale) / 2 - view.x * this.stageScale;
    this.stageOffsetY = (height - view.height * this.stageScale) / 2 - view.y * this.stageScale;
    this.rootContainer.scale.set(this.stageScale);
    this.rootContainer.position.set(this.stageOffsetX, this.stageOffsetY);
  }

  public async init(opts: RendererOptions): Promise<void> {
    // Guard the shared geometry table before anything is drawn from it.
    validateStageLayout(this.layout);

    // Mobile GPUs may implement mediump UV arithmetic at half precision.
    // Preserve scanline/frame boundaries when sprites are scaled or moving.
    GlProgram.defaultOptions.preferredFragmentPrecision = 'highp';
    await this.app.init({
      width: opts.width,
      height: opts.height,
      backgroundColor: 0x110e1a,
      preference: opts.rendererPreference === 'webgl'
        ? ['webgl', 'webgpu', 'canvas']
        : ['webgpu', 'webgl', 'canvas'],
      // The source art is a 716x516 pixel stage. At DPR 2 the default desktop
      // canvas shades four times as many pixels without adding source detail.
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
      autoDensity: true,
      // Sprite artwork does not benefit from multisampled geometry edges.
      antialias: false,
      roundPixels: false,
      autoStart: false
    });

    if (import.meta.env.DEV) {
      try {
        const { initDevtools } = await import('@pixi/devtools');
        await initDevtools({ app: this.app });
        (globalThis as unknown as { __PIXI_APP__?: unknown }).__PIXI_APP__ = this.app;
      } catch (err) {
        console.warn('Failed to initialize PixiJS DevTools:', err);
      }
    }

    // Follow the display refresh rate to preserve high-refresh input feedback.
    this.app.ticker.maxFPS = 0;

    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.dataset.renderer = this.app.renderer.name;
    opts.container.appendChild(canvas);
    if (new URLSearchParams(window.location.search).has('fps')) {
      this.fpsDisplay = document.createElement('div');
      this.fpsDisplay.className = 'fps-display';
      this.fpsDisplay.textContent = 'FPS: --';
      opts.container.parentElement?.appendChild(this.fpsDisplay);
    }

    // Input uses DOM listeners and explicit lane hit testing.
    this.app.stage.eventMode = 'none';
    this.app.stage.addChild(this.rootContainer);
    // Uniform scale + centered letterbox: never stretch the 716x516 stage.
    this.updateStageTransform(opts.width, opts.height);

    // Layer order: background -> lane/expression -> notes -> can+keys -> hits
    // -> stage characters -> combo/result -> page UI. Hit flashes sit over the
    // physical keys, as in the original DirectDraw composition.
    this.rootContainer.addChild(this.bgLayer);
    this.rootContainer.addChild(this.playAreaContainer);
    this.playAreaContainer.addChild(this.laneLayer);
    this.playAreaContainer.addChild(this.noteClipContainer);
    this.noteClipContainer.addChild(this.noteLayer);
    this.rootContainer.addChild(this.canFrameLayer);
    this.rootContainer.addChild(this.hitEffectLayer);
    this.hitEffectLayer.position.set(this.layout.playX, this.layout.playY);
    this.rootContainer.addChild(this.decorationLayer);
    this.rootContainer.addChild(this.pdaLayer);
    this.rootContainer.addChild(this.overlayLayer);
    this.rootContainer.addChild(this.uiLayer);
    this.rootContainer.addChild(this.mobileStage.container);

    // Load every built-in gameplay texture before the scene becomes usable.
    await this.preloadTextures(opts.onProgress);
    this.prebuildTextureFrames();
    await this.loadTextures();
    this.setupScene();
    await this.resultView.init(this.overlayLayer);
    // Decoding PNGs does not upload them. Prepare frames before the first hit
    // instead of paying texture upload costs during gameplay.
    const frames = [
      ...this.texNoteSkins, ...this.texLongHeads, ...this.texLongBodies,
      ...this.texHitBurstFrames.flat(), ...this.texLongHitFrames
    ];
    await this.app.renderer.prepare.upload([...frames, this.app.stage]);
  }

  private async preloadTextures(
    onProgress?: (loaded: number, total: number, asset: string) => void
  ): Promise<void> {
    const paths = new Set<string>([
      DEFAULT_SKIN.bg.path,
      DEFAULT_SKIN.faceMap.path,
      DEFAULT_SKIN.faceMap2.path,
      DEFAULT_SKIN.wingkyPinkL0.path,
      DEFAULT_SKIN.wingkyPinkL1.path,
      DEFAULT_SKIN.star.path,
      DEFAULT_SKIN.chn.path,
      DEFAULT_SKIN.resultAtlas.path,
      DEFAULT_SKIN.messageAtlas.path,
      DEFAULT_SKIN.scoreFont.path,
      DEFAULT_SKIN.ratioFont.path,
      DEFAULT_SKIN.eqFont.path,
      DEFAULT_SKIN.heartFont.path,
    ]);
    const pathResolver = new SkinManager(this.skinManager.getConfig());
    const assetKeys = [
      'playArea', 'canBack', 'canFrame', 'hitBar0', 'hitBar1',
      'keyBase', 'keyNormal', 'keyPut', 'keyDeath', 'noteComposed0',
      'noteComposed1', 'noteBase0', 'noteBase1', 'noteSkin0', 'noteSkin1',
      'longNote', 'shortBurst', 'longBurst', 'comboFont'
    ] as const;

    for (const skin of ['classic', 'metallic'] as const) {
      pathResolver.setSkin(skin);
      for (const key of assetKeys) paths.add(pathResolver.getAssetPath(key));
      for (const variant of pathResolver.getShortBurstVariants()) paths.add(variant.path);
    }

    const assetPaths = [...paths];
    let loaded = 0;
    onProgress?.(loaded, assetPaths.length, '初始化渲染器');
    await Promise.all(assetPaths.map(async path => {
      this.textureCache.set(path, await Assets.load(path));
      loaded++;
      onProgress?.(loaded, assetPaths.length, path);
    }));
  }

  private texture(path: string): Texture {
    const texture = this.textureCache.get(path);
    if (!texture) throw new Error(`Texture was not preloaded: ${path}`);
    return texture;
  }

  private coloredTexture(path: string): Texture {
    let texture = this.adjustedTextures.get(path);
    const original = this.texture(path);
    if (!texture) {
      const canvas = document.createElement('canvas');
      canvas.width = original.width;
      canvas.height = original.height;
      texture = new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'linear', autoGenerateMipmaps: false }) });
      this.adjustedTextures.set(path, texture);
      this.updateColoredTexture(path);
    }
    return texture;
  }

  private updateColoredTexture(path: string): void {
    const texture = this.adjustedTextures.get(path);
    if (!texture) return;
    const canvas = texture.source.resource as HTMLCanvasElement;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(this.texture(path).source.resource as CanvasImageSource, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    adjustSkinPixels(pixels.data, this.skinColor);
    context.putImageData(pixels, 0, 0);
    texture.source.update();
  }

  private prebuildTextureFrames(): void {
    const originalSkin = this.skinManager.getSkin();
    const originalNoteSkin = this.skinManager.getNoteSkin();
    for (const skin of ['classic', 'metallic'] as const) {
      this.skinManager.setSkin(skin);
      this.loadHitEffectTextures();
      this.loadComboTextures();
      for (const noteSkin of ['base0', 'base1'] as const) {
        this.skinManager.setNoteSkin(noteSkin);
        this.loadNoteSkinTextures();
      }
    }
    this.skinManager.setSkin(originalSkin);
    this.skinManager.setNoteSkin(originalNoteSkin);
  }

  private async loadTextures(): Promise<void> {
    this.texBg = this.texture(DEFAULT_SKIN.bg.path);
    this.texPlayArea = this.coloredTexture(this.skinManager.getAssetPath('playArea'));
    this.texCanBack = this.coloredTexture(this.skinManager.getAssetPath('canBack'));
    this.texCanFrame = this.coloredTexture(this.skinManager.getAssetPath('canFrame'));
    this.texHitBar = this.coloredTexture(this.skinManager.getAssetPath(this.getHitBarKey()));
    this.texKeyNormal = this.coloredTexture(this.skinManager.getAssetPath('keyNormal'));
    this.texKeyPut = this.coloredTexture(this.skinManager.getAssetPath('keyPut'));
    // Keep the lane art pixel-precise, but smooth the cabinet silhouettes when
    // the fixed 716x516 stage is displayed at a fractional CSS scale.
    this.texPlayArea.source.scaleMode = 'nearest';
    for (const texture of [this.texCanBack, this.texCanFrame,
      this.texHitBar, this.texKeyNormal, this.texKeyPut]) {
      texture.source.scaleMode = 'linear';
    }

    // Slice the selected pre-composed base + heart atlas at its native size.
    // base1 is 26x12; it is never produced by vertically shrinking base0.
    this.loadNoteSkinTextures();
    this.loadHitEffectTextures();
    this.loadComboTextures();


    const sliceVertical = (path: string, width: number, height: number, count: number, recolor = false) => {
      const atlas = recolor ? this.coloredTexture(path) : this.texture(path);
      return Array.from({ length: count }, (_, index) => new Texture({
        source: atlas.source,
        frame: new Rectangle(0, index * height, width, height)
      }));
    };
    this.texFaceFrames = sliceVertical(
      DEFAULT_SKIN.faceMap.path,
      DEFAULT_SKIN.faceMap.frameWidth,
      DEFAULT_SKIN.faceMap.frameHeight,
      DEFAULT_SKIN.faceMap.frameCount,
      true
    );
    this.texWingkyFrames = sliceVertical(
      DEFAULT_SKIN.wingkyPinkL0.path,
      DEFAULT_SKIN.wingkyPinkL0.frameWidth,
      DEFAULT_SKIN.wingkyPinkL0.frameHeight,
      DEFAULT_SKIN.wingkyPinkL0.frameCount
    );
    this.texWingkyEyeFrames = sliceVertical(
      DEFAULT_SKIN.wingkyPinkL1.path,
      DEFAULT_SKIN.wingkyPinkL1.frameWidth,
      DEFAULT_SKIN.wingkyPinkL1.frameHeight,
      DEFAULT_SKIN.wingkyPinkL1.frameCount
    );
    this.texStarFrames = sliceVertical(
      DEFAULT_SKIN.star.path,
      DEFAULT_SKIN.star.frameWidth,
      DEFAULT_SKIN.star.frameHeight,
      DEFAULT_SKIN.star.frameCount
    );
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
    const presentation = this.skinManager.getPresentation();
    canBack.position.set(presentation.canBack.x, presentation.canBack.y);
    canBack.width = presentation.canBack.width;
    canBack.height = presentation.canBack.height;
    this.canBackSprite = canBack;
    this.bgLayer.addChild(canBack);

    // 2. Play area: natural size, no local stretch. The lane origin lives here.
    this.playAreaContainer.position.set(L.playX, L.playY);

    // Both play-area assets already have the exact dimensions declared by the
    // presentation. Keep the loaded texture intact: replacing a differently
    // sized framed sub-texture while the result overlay is batched can leave
    // one triangle of the sprite using stale UVs in Pixi's WebGL renderer.
    const pa = new Sprite(this.texPlayArea);
    pa.position.set(presentation.playArea.x, presentation.playArea.y);
    pa.width = presentation.playArea.width;
    pa.height = presentation.playArea.height;
    this.playAreaSprite = pa;
    this.playAreaContainer.addChildAt(pa, 0);

    // face_map frame backgrounds are pixel-identical to play_area at y=43.
    // Drawing the frame opaquely avoids seams and keeps all lane lines aligned.
    this.faceSprite.texture = this.texFaceFrames[DEFAULT_SKIN.faceMap.indices.smile];
    this.faceSprite.position.set(DEFAULT_SKIN.decorations.faceX, DEFAULT_SKIN.decorations.faceY);
    this.faceSprite.visible = presentation.showFace;
    this.laneLayer.addChild(this.faceSprite);

    // The mask clips falling notes. Hit effects intentionally extend over the
    // judgement keys and therefore live in the foreground root layer.
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

    const decoration = DEFAULT_SKIN.decorations;
    this.wingkySprite.texture = this.texWingkyFrames[decoration.wingky.frame];
    this.wingkySprite.position.set(decoration.wingky.x, decoration.wingky.y);
    this.decorationLayer.addChild(this.wingkySprite);

    this.wingkyEyeSprite.texture = this.texWingkyEyeFrames[decoration.wingky.eyeFrame];
    this.wingkyEyeSprite.position.set(
      decoration.wingky.x + decoration.wingky.eyeOffsetX,
      decoration.wingky.y + decoration.wingky.eyeOffsetY
    );
    this.decorationLayer.addChild(this.wingkyEyeSprite);

    this.starSprite.texture = this.texStarFrames[decoration.star.playingFrame];
    this.starSprite.position.set(decoration.star.x, decoration.star.y);
    this.decorationLayer.addChild(this.starSprite);
    this.decorationLayer.visible = presentation.showDecorations;

    // 3. Can frame, judgement bar and the seven keys share stage coordinates.
    const hitBarRect = L.hitBar;
    this.hitBarSprite = new Sprite(this.texHitBar);
    this.hitBarSprite.width = hitBarRect.width;
    this.hitBarSprite.height = presentation.hitBarHeight;
    this.hitBarSprite.position.set(hitBarRect.x, Math.round(this.judgeStageY() - presentation.hitBarHeight / 2));
    this.canFrameLayer.addChild(this.hitBarSprite);

    const canFrame = new Sprite(this.texCanFrame);
    canFrame.width = presentation.canFrame.width;
    canFrame.height = presentation.canFrame.height;
    canFrame.position.set(presentation.canFrame.x, presentation.canFrame.y);
    this.canFrameSprite = canFrame;
    this.canFrameLayer.addChild(canFrame);

    // key_base, key_normal, key_put and key_death are the same 28x28 rounded
    // silhouette with different fills (629-631 opaque px each), so they are
    // mutually exclusive states rather than stacked layers. The interactive
    // pair used here is key_normal -> key_put; key_base/key_death stay in the
    // skin table for later states.
    const keyNames = ['S', 'D', 'F', 'SPACE', 'J', 'K', 'L'];
    for (let l = 0; l < L.keyPositions.length; l++) {
      const rect = L.keyPositions[l];
      const keyOffsetY = presentation.keyOffsetsY[l] ?? 0;

      const keySpr = new Sprite(this.texKeyNormal);
      keySpr.position.set(rect.x, rect.y + rect.height - presentation.keyHeight + keyOffsetY);
      keySpr.width = rect.width;
      keySpr.height = presentation.keyHeight;
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
      keyText.position.set(
        rect.x + rect.width / 2,
        rect.y + rect.height - presentation.keyHeight / 2 + keyOffsetY
      );
      this.canFrameLayer.addChild(keyText);
      this.keyLabels.push(keyText);
    }

    // 4. Hit Judgement text, positioned from the shared judge line.
    this.judgeTextContainer.position.set(L.playWidth / 2, this.judgeLocalY() - 40);
    for (const [rating, color] of [
      ['COOL', 0x00ffff], ['GOOD', 0x76ff03],
      ['BAD', 0xff9100], ['MISS', 0xff1744]
    ] as const) {
      const label = new Text({
        text: rating,
        style: new TextStyle({
          fontFamily: 'Impact, Arial Black, sans-serif',
          fontSize: 32,
          fontWeight: 'bold',
          fill: color,
          stroke: { color: 0x001133, width: 5 }
        })
      });
      const sprite = new Sprite(this.app.renderer.generateTexture({ target: label }));
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.judgeTextContainer.addChild(sprite);
      this.judgeSprites.set(rating, sprite);
      label.destroy();
    }
    this.judgeTextContainer.alpha = 0;
    this.playAreaContainer.addChild(this.judgeTextContainer);

    // 5. PDA Console Display (inside the green CRT screen in center).
    // Bounds measured in the original BG texture, shared with the scene scale.
    const pdaCenterX = 358;
    const pdaLeftX = 302;
    const pdaTopY = 124;

    this.pdaPlaylistTitle = new Text({
      text: 'PLAYLIST (0)',
      style: new TextStyle({
        fontFamily: 'monospace, "Microsoft YaHei", sans-serif',
        fontSize: 8,
        fontWeight: 'bold',
        fill: 0x003311,
        align: 'center'
      })
    });
    this.pdaPlaylistTitle.anchor.set(0.5, 0);
    this.pdaPlaylistTitle.position.set(pdaCenterX, pdaTopY);
    this.pdaLayer.addChild(this.pdaPlaylistTitle);

    this.pdaDivider = new Graphics();
    this.pdaDivider.moveTo(pdaLeftX + 2, pdaTopY + 11).lineTo(pdaLeftX + 110, pdaTopY + 11).stroke({ width: 1, color: 0x114422, alpha: 0.5 });
    this.pdaLayer.addChild(this.pdaDivider);

    this.pdaRowTexts = [];
    this.pdaRowBgs = [];
    const maxRows = 5;
    for (let i = 0; i < maxRows; i++) {
      const rowY = pdaTopY + 13 + i * 12;
      const bg = new Graphics();
      bg.rect(pdaLeftX + 1, rowY - 1, 110, 11).fill({ color: 0x003311, alpha: 0.85 });
      bg.visible = false;
      this.pdaLayer.addChild(bg);
      this.pdaRowBgs.push(bg);

      const rowText = new Text({
        text: '',
        style: new TextStyle({
          fontFamily: 'system-ui, "Microsoft YaHei", "Malgun Gothic", monospace, sans-serif',
          fontSize: 8,
          fontWeight: 'normal',
          fill: 0x004411
        })
      });
      rowText.position.set(pdaLeftX + 3, rowY);
      rowText.visible = false;
      this.pdaLayer.addChild(rowText);
      this.pdaRowTexts.push(rowText);
    }

    // Maintain legacy/test fields
    this.titleText = new Text({ text: 'CanMusic Web' });
    this.artistText = new Text({ text: 'Select a song' });
    this.speedText = new Text({ text: `SPD: ${this.speedGear}` });
    this.autoText = new Text({ text: 'AUTO: OFF' });
    this.refreshPlaylistDisplay();

    // Combo is centred over the upper play field and remains outside the lane mask.
    this.comboContainer.position.set(DEFAULT_SKIN.effects.comboCenterX, DEFAULT_SKIN.effects.comboY);
    this.comboContainer.visible = false;
    this.overlayLayer.addChild(this.comboContainer);
  }

  /** Judge line in play-area local coordinates (notes, keys and bursts share it). */
  private judgeLocalY(): number {
    return this.judgeStageY() - this.layout.playY;
  }

  private judgeStageY(): number {
    return this.layout.judgeY + this.skinManager.getPresentation().judgeOffsetY;
  }

  private activeNoteMeta() {
    return this.skinManager.getNoteVariant();
  }

  private getHitBarKey(): 'hitBar0' | 'hitBar1' {
    return this.skinManager.getNoteSkin() === 'base1' ? 'hitBar1' : 'hitBar0';
  }

  private loadNoteSkinTextures(): void {
    const cacheKey = `${this.skinManager.getSkin()}:${this.skinManager.getNoteSkin()}`;
    const cached = this.noteFrameCache.get(cacheKey);
    if (cached) {
      this.texNoteSkins = cached.notes;
      this.texLongHeads = cached.longHeads;
      this.texLongBodies = cached.longBodies;
      this.refreshActiveNoteColor();
      return;
    }
    // The original DLL slices longnote.lle and sets its color key without
    // applying the skin HSV adjustment (0x10024cb2–0x10024da4).
    const longAtlas = this.texture(this.skinManager.getAssetPath('longNote'));
    const noteMeta = this.activeNoteMeta();
    const atlas = this.texture(this.skinManager.getAssetPath(
      this.skinManager.getNoteSkin() === 'base1' ? 'noteComposed1' : 'noteComposed0'
    ));
    // Isolate every crop, including the single-row body, before enabling linear
    // sampling. Adjacent palette entries must never bleed into a moving note.
    this.texLongHeads = createPaddedFrames(longAtlas, Array.from({ length: 16 }, (_, i) =>
      new Rectangle(0, i * 12, 24, 12)));
    this.texLongBodies = createPaddedFrames(longAtlas, Array.from({ length: 16 }, (_, i) =>
      new Rectangle(0, i * 12 + 6, 24, 1)));
    this.texNoteSkins = createPaddedFrames(atlas, Array.from({ length: noteMeta.frameCount }, (_, i) =>
      new Rectangle(i * noteMeta.frameWidth, 0, noteMeta.frameWidth, noteMeta.frameHeight)));
    this.noteFrameCache.set(cacheKey, {
      notes: this.texNoteSkins,
      longHeads: this.texLongHeads,
      longBodies: this.texLongBodies
    });
    this.refreshActiveNoteColor();
  }

  private refreshActiveNoteColor(): void {
    if (!this.skinColor.hue && !this.skinColor.saturation && !this.skinColor.brightness) {
      const key = `${this.skinManager.getSkin()}:${this.skinManager.getNoteSkin()}`;
      if (!this.noteColorAtlases.has(key)) return;
    }
    const variant = this.skinManager.getNoteSkin() === 'base1' ? '1' : '0';
    const key = `${this.skinManager.getSkin()}:${this.skinManager.getNoteSkin()}`;
    const base = this.texture(this.skinManager.getAssetPath(variant === '1' ? 'noteBase1' : 'noteBase0'));
    const skin = this.texture(this.skinManager.getAssetPath(variant === '1' ? 'noteSkin1' : 'noteSkin0'));
    let atlas = this.noteColorAtlases.get(key);
    if (!atlas) {
      const canvas = document.createElement('canvas');
      canvas.width = skin.width;
      canvas.height = skin.height;
      atlas = new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'linear', autoGenerateMipmaps: false }) });
      this.noteColorAtlases.set(key, atlas);
    }
    const canvas = atlas.source.resource as HTMLCanvasElement;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    const frameWidth = base.width;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = base.width;
    baseCanvas.height = base.height;
    const baseContext = baseCanvas.getContext('2d', { willReadFrequently: true });
    if (!baseContext) return;
    baseContext.drawImage(base.source.resource as CanvasImageSource, 0, 0);
    const pixels = baseContext.getImageData(0, 0, base.width, base.height);
    adjustSkinPixels(pixels.data, this.skinColor);
    baseContext.putImageData(pixels, 0, 0);
    for (let frame = 0; frame < 16; frame++) {
      context.drawImage(baseCanvas, frame * frameWidth, 0);
    }
    // Original note_skin is overlaid after the base color adjustment.
    context.drawImage(skin.source.resource as CanvasImageSource, 0, 0);
    atlas.source.update();
    const crops = Array.from({ length: 16 }, (_, i) => new Rectangle(i * frameWidth, 0, frameWidth, base.height));
    refreshPaddedFrames(atlas, crops, this.texNoteSkins);
  }

  public getSkinColor(): SkinColorAdjustment {
    return { ...this.skinColor };
  }

  public setSkinColor(value: SkinColorAdjustment): void {
    const next = normalizeSkinColor(value);
    if (next.hue === this.skinColor.hue && next.saturation === this.skinColor.saturation && next.brightness === this.skinColor.brightness) return;
    this.skinColor = next;
    for (const path of this.adjustedTextures.keys()) this.updateColoredTexture(path);
    if (this.playAreaSprite) {
      this.texPlayArea = this.coloredTexture(this.skinManager.getAssetPath('playArea'));
      this.texCanBack = this.coloredTexture(this.skinManager.getAssetPath('canBack'));
      this.texCanFrame = this.coloredTexture(this.skinManager.getAssetPath('canFrame'));
      this.texHitBar = this.coloredTexture(this.skinManager.getAssetPath(this.getHitBarKey()));
      this.texKeyNormal = this.coloredTexture(this.skinManager.getAssetPath('keyNormal'));
      this.texKeyPut = this.coloredTexture(this.skinManager.getAssetPath('keyPut'));
      this.playAreaSprite.texture = this.texPlayArea;
      this.canBackSprite.texture = this.texCanBack;
      this.canFrameSprite.texture = this.texCanFrame;
      this.hitBarSprite.texture = this.texHitBar;
      this.keySprites.forEach((sprite, lane) => { sprite.texture = this.activeHoldLanes.has(lane) ? this.texKeyPut : this.texKeyNormal; });
      this.refreshActiveNoteColor();
    }
  }

  private loadHitEffectTextures(): void {
    const cacheKey = this.skinManager.getSkin();
    const cached = this.effectFrameCache.get(cacheKey);
    if (cached) {
      this.texHitBurstFrames = cached.short;
      this.texLongHitFrames = cached.long;
      return;
    }
    const sliceHorizontal = (meta: ReturnType<SkinManager['getShortBurst']>) => {
      // DLL 0x100242a3 loads hitani directly; the skin H/S/B transform is not applied.
      const atlas = this.texture(meta.path);
      atlas.source.scaleMode = 'nearest';
      return Array.from({ length: meta.frameCount }, (_, index) => new Texture({
        source: atlas.source,
        frame: new Rectangle(index * meta.frameWidth, 0, meta.frameWidth, meta.frameHeight)
      }));
    };
    this.texHitBurstFrames = this.skinManager.getShortBurstVariants().map(sliceHorizontal);
    this.texLongHitFrames = sliceHorizontal(this.skinManager.getLongBurst());
    this.effectFrameCache.set(cacheKey, {
      short: this.texHitBurstFrames,
      long: this.texLongHitFrames
    });
  }

  private loadComboTextures(): void {
    const cacheKey = this.skinManager.getSkin();
    const cached = this.comboFrameCache.get(cacheKey);
    if (cached) {
      this.comboMeta = cached.meta;
      this.texComboDigits = cached.digits;
      for (const sprite of this.comboDigitSprites) {
        const digit = Number(sprite.label);
        if (Number.isInteger(digit)) sprite.texture = this.texComboDigits[digit];
      }
      return;
    }
    this.comboMeta = this.skinManager.getComboFont();
    const atlas = this.texture(this.comboMeta.path);
    atlas.source.scaleMode = 'nearest';
    this.texComboDigits = Array.from({ length: this.comboMeta.charCount }, (_, index) => new Texture({
      source: atlas.source,
      frame: new Rectangle(
        index * this.comboMeta.charWidth,
        0,
        this.comboMeta.charWidth,
        this.comboMeta.charHeight
      )
    }));
    this.comboFrameCache.set(cacheKey, { meta: this.comboMeta, digits: this.texComboDigits });
    for (const sprite of this.comboDigitSprites) {
      const digit = Number(sprite.label);
      if (Number.isInteger(digit)) sprite.texture = this.texComboDigits[digit];
    }
  }

  /** Switches between the two note skins extracted from the original client. */
  public setNoteSkin(skin: NoteSkinId): void {
    if (skin === this.skinManager.getNoteSkin() && this.texNoteSkins.length) return;
    this.skinManager.setNoteSkin(skin);
    this.loadNoteSkinTextures();

    const meta = this.activeNoteMeta();
    for (const sprite of this.noteSpritePool) {
      sprite.anchor.set(meta.contactX / meta.frameWidth, meta.contactY / meta.frameHeight);
      sprite.width = meta.frameWidth;
      sprite.height = meta.frameHeight;
    }
    if (this.hitBarSprite) {
      const hitBarMeta = this.skinManager.getHitBar();
      this.texHitBar = this.coloredTexture(this.skinManager.getAssetPath(this.getHitBarKey()));
      this.texHitBar.source.scaleMode = 'linear';
      this.hitBarSprite.texture = this.texHitBar;
      this.hitBarSprite.width = this.layout.hitBar.width;
      this.hitBarSprite.height = hitBarMeta.height;
      this.hitBarSprite.y = Math.round(this.judgeStageY() - hitBarMeta.height / 2);
    }
    this.renderCandidates.length = 0;
    this.nextCandidateIndex = 0;
    this.lastRenderTime = Number.NEGATIVE_INFINITY;
  }

  public setSkin(skin: SkinId): void {
    if (skin === this.skinManager.getSkin()) return;
    this.applySkin(skin);
  }

  private applySkin(skin: SkinId): void {
    if (skin === this.skinManager.getSkin()) return;
    this.skinManager.setSkin(skin);
    if (skin === 'mobile') {
      this.applySkinVisibility();
      this.updateStageTransform(this.canvasWidth, this.canvasHeight);
      this.renderCandidates.length = 0;
      this.nextCandidateIndex = 0;
      this.lastRenderTime = Number.NEGATIVE_INFINITY;
      return;
    }
    this.texPlayArea = this.coloredTexture(this.skinManager.getAssetPath('playArea'));
    this.texCanBack = this.coloredTexture(this.skinManager.getAssetPath('canBack'));
    this.texCanFrame = this.coloredTexture(this.skinManager.getAssetPath('canFrame'));
    this.texHitBar = this.coloredTexture(this.skinManager.getAssetPath(this.getHitBarKey()));
    this.texKeyNormal = this.coloredTexture(this.skinManager.getAssetPath('keyNormal'));
    this.texKeyPut = this.coloredTexture(this.skinManager.getAssetPath('keyPut'));
    this.texPlayArea.source.scaleMode = 'nearest';
    for (const texture of [this.texCanBack, this.texCanFrame,
      this.texHitBar, this.texKeyNormal, this.texKeyPut]) {
      texture.source.scaleMode = 'linear';
    }
    this.loadNoteSkinTextures();
    this.loadHitEffectTextures();
    this.loadComboTextures();

    const presentation = this.skinManager.getPresentation();
    this.playAreaSprite.texture = this.texPlayArea;
    this.playAreaSprite.position.set(presentation.playArea.x, presentation.playArea.y);
    this.playAreaSprite.width = presentation.playArea.width;
    this.playAreaSprite.height = presentation.playArea.height;
    this.canBackSprite.texture = this.texCanBack;
    this.canBackSprite.position.set(presentation.canBack.x, presentation.canBack.y);
    this.canBackSprite.width = presentation.canBack.width;
    this.canBackSprite.height = presentation.canBack.height;
    this.canFrameSprite.texture = this.texCanFrame;
    this.canFrameSprite.position.set(presentation.canFrame.x, presentation.canFrame.y);
    this.canFrameSprite.width = presentation.canFrame.width;
    this.canFrameSprite.height = presentation.canFrame.height;
    this.hitBarSprite.texture = this.texHitBar;
    this.hitBarSprite.height = presentation.hitBarHeight;
    this.hitBarSprite.y = Math.round(this.judgeStageY() - presentation.hitBarHeight / 2);
    this.faceSprite.visible = presentation.showFace;
    this.decorationLayer.visible = presentation.showDecorations;
    this.keySprites.forEach((key, lane) => {
      const rect = this.layout.keyPositions[lane];
      const keyOffsetY = presentation.keyOffsetsY[lane] ?? 0;
      key.texture = this.texKeyNormal;
      key.position.set(rect.x, rect.y + rect.height - presentation.keyHeight + keyOffsetY);
      key.width = rect.width;
      key.height = presentation.keyHeight;
      this.keyLabels[lane]?.position.set(
        rect.x + rect.width / 2,
        rect.y + rect.height - presentation.keyHeight / 2 + keyOffsetY
      );
    });
    this.renderCandidates.length = 0;
    this.nextCandidateIndex = 0;
    this.lastRenderTime = Number.NEGATIVE_INFINITY;
    this.applySkinVisibility();
    this.updateStageTransform(this.canvasWidth, this.canvasHeight);
  }

  public setLaneKeyLabels(labels: readonly string[]): void {
    this.keyLabels.forEach((label, lane) => {
      if (labels[lane]) label.text = labels[lane];
    });
  }

  private applySkinVisibility(): void {
    const mobile = this.skinManager.getSkin() === 'mobile';
    this.mobileStage.setVisible(mobile);
    for (const layer of [this.bgLayer, this.playAreaContainer, this.hitEffectLayer, this.canFrameLayer,
      this.decorationLayer, this.pdaLayer, this.overlayLayer, this.uiLayer]) {
      layer.visible = !mobile;
    }
    if (!mobile) this.decorationLayer.visible = this.skinManager.getPresentation().showDecorations;
  }

  public getSkin(): SkinId {
    return this.skinManager.getSkin();
  }

  public getNoteSkin(): NoteSkinId {
    return this.skinManager.getNoteSkin();
  }

  public setLaneState(lane: number, pressed: boolean): void {
    this.mobileStage.setLaneState(lane, pressed);
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
    if (this.skinManager.getSkin() === 'mobile') return this.mobileStage.hitTest(sceneX, sceneY);
    const keys = this.layout.keyPositions;
    const keyOffsetsY = this.skinManager.getPresentation().keyOffsetsY;
    for (let lane = 0; lane < keys.length; lane++) {
      const k = keys[lane];
      const keyOffsetY = keyOffsetsY[lane] ?? 0;
      if (sceneX >= k.x && sceneX < k.x + k.width &&
          sceneY >= k.y + keyOffsetY && sceneY < k.y + keyOffsetY + k.height) {
        return lane;
      }
    }
    return -1;
  }

  /** Touch input uses the full can opening, with its edges assigned to the nearest lane. */
  public hitTestTouchLane(sceneX: number, sceneY: number): number {
    if (this.skinManager.getSkin() === 'mobile') return this.mobileStage.hitTest(sceneX, sceneY);
    const keyLane = this.hitTestKey(sceneX, sceneY);
    if (keyLane >= 0) return keyLane;
    const cavity = this.layout.canCavity;
    if (sceneX < this.layout.canX + cavity.x || sceneX >= this.layout.canX + cavity.x + cavity.width
      || sceneY < this.layout.canY + cavity.y || sceneY >= this.layout.canY + cavity.y + cavity.height) return -1;
    return Math.max(0, Math.min(this.layout.laneCount - 1,
      Math.floor((sceneX - this.layout.playX) / this.layout.laneWidth)));
  }

  /** Direction of the physical UP/DN buttons below the playlist screen. */
  public hitTestPlaylistArrow(sceneX: number, sceneY: number): -1 | 0 | 1 {
    if (this.skinManager.getSkin() === 'mobile') return 0;
    if (CanMusicRenderer.PDA_UP_BOUNDS.contains(sceneX, sceneY)) return -1;
    if (CanMusicRenderer.PDA_DOWN_BOUNDS.contains(sceneX, sceneY)) return 1;
    return 0;
  }

  /** Whether a logical stage point is over the green playlist CRT. */
  public hitTestPlaylistScreen(sceneX: number, sceneY: number): boolean {
    return this.skinManager.getSkin() !== 'mobile'
      && CanMusicRenderer.PDA_PLAYLIST_BOUNDS.contains(sceneX, sceneY);
  }

  /** Resolve a logical stage point to the playlist item currently drawn there. */
  public hitTestPlaylistItem(sceneX: number, sceneY: number): number {
    if (!this.hitTestPlaylistScreen(sceneX, sceneY)) return -1;
    const row = Math.floor((sceneY - CanMusicRenderer.PDA_PLAYLIST_ROWS_TOP)
      / CanMusicRenderer.PDA_PLAYLIST_ROW_HEIGHT);
    if (row < 0 || row >= this.pdaRowTexts.length) return -1;
    const itemIndex = this.getPlaylistStartIndex() + row;
    return itemIndex < this.playlistItems.length ? itemIndex : -1;
  }

  public startLoop(update: (deltaSec: number, frameMs: number) => void): void {
    // Application.render is registered at LOW priority by Pixi's TickerPlugin.
    // HIGH guarantees game state is updated immediately before that render.
    let fpsStart = performance.now();
    let fpsFrames = 0;
    this.app.ticker.add((ticker) => {
      const deltaSec = Math.min(0.1, Math.max(0, ticker.deltaMS / 1000));
      this.advanceVisuals(deltaSec);
      // Pixi updates lastTime after its listeners. Reconstruct the current
      // requestAnimationFrame timestamp instead of sampling callback latency.
      update(deltaSec, ticker.lastTime + ticker.elapsedMS);
      if (this.fpsDisplay) {
        fpsFrames++;
        const now = performance.now();
        const elapsed = now - fpsStart;
        if (elapsed >= 1000) {
          this.fpsDisplay.textContent = `FPS: ${Math.round(fpsFrames * 1000 / elapsed)}`;
          fpsStart = now;
          fpsFrames = 0;
        }
      }
    }, undefined, UPDATE_PRIORITY.HIGH);
    this.app.start();
  }

  public showHitBurst(lane: number, combo = this.displayedCombo): void {
    if (this.skinManager.getSkin() === 'mobile') {
      this.mobileStage.showHit(lane);
      return;
    }
    const burstSprite = this.hitBurstPool.pop() ?? this.createEffectSprite();
    const family = this.skinManager.getSkin() === 'metallic' ? 0 : 1;
    const frames = this.texHitBurstFrames[Math.min(hitBurstTier(combo, family), this.texHitBurstFrames.length - 1)];
    burstSprite.texture = frames[0];
    burstSprite.visible = true;
    burstSprite.blendMode = 'add';
    const effects = this.skinManager.getEffects();
    burstSprite.anchor.set(effects.shortBurstAnchorX, effects.shortBurstAnchorY);
    const x = lane * this.layout.laneWidth + this.layout.laneWidth / 2;
    const y = this.judgeLocalY();
    burstSprite.position.set(x, y);
    burstSprite.scale.set(effects.shortBurstScale);

    this.activeHitBursts.push({
      sprite: burstSprite,
      frames,
      elapsedSec: 0,
      lane
    });
  }

  public showJudgement(rating: JudgmentRating): void {
    if (this.skinManager.getSkin() === 'mobile') {
      this.mobileStage.showJudgement(rating);
      return;
    }
    if (!DEFAULT_SKIN.effects.showJudgmentText) return;
    for (const [kind, sprite] of this.judgeSprites) sprite.visible = kind === rating;
    this.judgeTextContainer.scale.set(1.3);
    this.judgeTextContainer.alpha = 1.0;
    this.judgeTextTimer = 35; // frames to stay visible
  }

  public updateCombo(combo: number): void {
    if (combo === this.displayedCombo) return;
    this.displayedCombo = combo;
    if (this.skinManager.getSkin() === 'mobile') this.mobileStage.setCombo(combo);
    if (combo <= 0) {
      this.comboContainer.visible = false;
      return;
    }

    this.comboContainer.visible = true;
    const str = combo.toString();

    // Ensure we have enough digit sprites
    while (this.comboDigitSprites.length < str.length) {
      const spr = new Sprite(this.texComboDigits[0]);
      this.comboContainer.addChild(spr);
      this.comboDigitSprites.push(spr);
    }

    // Hide unused digits
    for (let i = str.length; i < this.comboDigitSprites.length; i++) {
      this.comboDigitSprites[i].visible = false;
    }

    const digitWidth = this.comboMeta.charWidth;
    const spacing = this.comboMeta.spacing;
    const totalWidth = str.length * digitWidth + Math.max(0, str.length - 1) * spacing;
    let curX = -totalWidth / 2;
    for (let i = 0; i < str.length; i++) {
      const digit = parseInt(str[i], 10);
      const spr = this.comboDigitSprites[i];
      spr.texture = this.texComboDigits[digit];
      spr.label = String(digit);
      spr.visible = true;
      spr.width = digitWidth;
      spr.height = this.comboMeta.charHeight;
      spr.position.set(curX, 0);
      curX += digitWidth + spacing;
    }

    // Bump scale animation
    this.comboContainer.scale.set(1.15);
  }

  public setPlaylist(items: PlaylistItemDisplay[], activeIndex = 0): void {
    this.playlistItems = items;
    this.playlistActiveIndex = Math.max(0, Math.min(items.length - 1, activeIndex));
    this.refreshPlaylistDisplay();
  }

  public refreshPlaylistDisplay(): void {
    if (!this.pdaPlaylistTitle) return;
    const total = this.playlistItems.length;
    if (total === 0) {
      this.pdaPlaylistTitle.text = 'PLAYLIST (0)';
      for (let i = 0; i < this.pdaRowTexts.length; i++) {
        this.pdaRowTexts[i].visible = false;
        this.pdaRowBgs[i].visible = false;
      }
      return;
    }

    this.pdaPlaylistTitle.text = `PLAYLIST (${this.playlistActiveIndex + 1}/${total})`;

    const maxVisible = this.pdaRowTexts.length;
    const startIdx = this.getPlaylistStartIndex();

    for (let i = 0; i < maxVisible; i++) {
      const itemIdx = startIdx + i;
      if (itemIdx < total) {
        const item = this.playlistItems[itemIdx];
        const isActive = itemIdx === this.playlistActiveIndex;
        const isDone = itemIdx < this.playlistActiveIndex;
        const prefix = isActive ? '▶ ' : (isDone ? '✓ ' : '  ');
        const textStr = `${prefix}[Lv.${item.level}] ${item.title}`;

        this.fitText(this.pdaRowTexts[i], textStr, 106);
        this.pdaRowTexts[i].style.fill = isActive ? 0xccffcc : (isDone ? 0x336644 : 0x004411);
        this.pdaRowTexts[i].style.fontWeight = isActive ? 'bold' : 'normal';
        this.pdaRowTexts[i].visible = true;
        this.pdaRowBgs[i].visible = isActive;
      } else {
        this.pdaRowTexts[i].visible = false;
        this.pdaRowBgs[i].visible = false;
      }
    }
  }

  private getPlaylistStartIndex(): number {
    const maxVisible = this.pdaRowTexts.length;
    if (this.playlistItems.length <= maxVisible) return 0;
    return Math.max(0, Math.min(
      this.playlistActiveIndex - 2,
      this.playlistItems.length - maxVisible
    ));
  }

  public setSongInfo(title: string, artist: string, level: number): void {
    this.mobileStage.setSongInfo(title, artist, level);
    this.fitText(this.titleText, title, 112);
    this.fitText(this.artistText, `${artist} (Lv.${level})`, 112);
    if (this.playlistItems.length <= 1) {
      this.setPlaylist([{ title, level, artist }], 0);
    } else {
      this.refreshPlaylistDisplay();
    }
  }

  public resetEffects(): void {
    this.mobileStage.reset();
    this.renderCandidates.length = 0;
    this.nextCandidateIndex = 0;
    this.lastRenderTime = Number.NEGATIVE_INFINITY;
    for (const sprite of this.noteSpritePool) sprite.visible = false;
    for (const sprite of this.longNoteTailPool) sprite.visible = false;
    for (const body of this.longNoteBodyPool) {
      body.fill.visible = false;
      for (const border of body.borders) border.visible = false;
    }
    this.updateCombo(0);
    this.judgeTextTimer = 0;
    this.judgeTextContainer.alpha = 0;
    for (const burst of this.activeHitBursts) {
      burst.sprite.visible = false;
      this.hitBurstPool.push(burst.sprite);
    }
    this.activeHitBursts = [];
    for (const effect of this.holdEffects.values()) {
      effect.sprite.visible = false;
      this.holdEffectPool.push(effect.sprite);
    }
    this.holdEffects.clear();
    this.setRoundVisualState('playing');
  }

  /** Effect sprites are parented once and only toggled afterwards. */
  private createEffectSprite(): Sprite {
    const sprite = new Sprite();
    sprite.blendMode = 'add';
    sprite.visible = false;
    this.hitEffectLayer.addChild(sprite);
    return sprite;
  }

  /** Move first-use sprite creation out of the opening frames of a round. */
  public prewarmNoteSprites(): void {
    while (this.hitBurstPool.length + this.activeHitBursts.length < 14) {
      this.hitBurstPool.push(this.createEffectSprite());
    }
    while (this.holdEffectPool.length + this.holdEffects.size < 7) {
      this.holdEffectPool.push(this.createEffectSprite());
    }
    const noteMeta = this.activeNoteMeta();
    while (this.noteSpritePool.length < 64) {
      const sprite = new Sprite(this.texNoteSkins[0]);
      sprite.anchor.set(noteMeta.contactX / noteMeta.frameWidth,
        noteMeta.contactY / noteMeta.frameHeight);
      sprite.visible = false;
      this.noteHeadLayer.addChild(sprite);
      this.noteSpritePool.push(sprite);
    }
    while (this.longNoteBodyPool.length < 32) {
      const fill = new Sprite(Texture.WHITE);
      fill.visible = false;
      this.noteBodyLayer.addChild(fill);
      this.longNoteBodyPool.push({ borders: [], fill });
    }
    while (this.longNoteTailPool.length < 32) {
      const tail = new Sprite();
      tail.anchor.set(.5);
      tail.visible = false;
      this.noteTailLayer.addChild(tail);
      this.longNoteTailPool.push(tail);
    }
  }

  public setRoundVisualState(state: 'playing' | 'result' | 'failed'): void {
    const faceIndex = state === 'playing'
      ? DEFAULT_SKIN.faceMap.indices.smile
      : state === 'failed' ? DEFAULT_SKIN.faceMap.indices.sad : DEFAULT_SKIN.faceMap.indices.surprise;
    if (this.texFaceFrames[faceIndex]) this.faceSprite.texture = this.texFaceFrames[faceIndex];
    const star = DEFAULT_SKIN.decorations.star;
    const starIndex = state === 'failed' ? star.failedFrame : state === 'result' ? star.resultFrame : star.playingFrame;
    if (this.texStarFrames[starIndex]) this.starSprite.texture = this.texStarFrames[starIndex];
  }

  public showCountdown(songTimeSec: number | null): void {
    const digit = songTimeSec === null ? null : countdownFrame(songTimeSec);
    this.mobileStage.setCountdown(digit);
    if (!this.countdownSprite && digit !== null) {
      this.countdownSprite = new Sprite(this.texComboDigits[digit]);
      this.countdownSprite.anchor.set(.5, 0);
      this.countdownSprite.position.set(this.layout.playX + this.layout.playWidth / 2, 252);
      this.overlayLayer.addChild(this.countdownSprite);
    }
    if (!this.countdownSprite) return;
    this.countdownSprite.visible = digit !== null;
    if (digit !== null) this.countdownSprite.texture = this.texComboDigits[digit];
  }

  public advanceVisuals(deltaSec: number): void {
    if (this.skinManager.getSkin() === 'mobile') this.mobileStage.advance(deltaSec);
    this.resultView.update(deltaSec);
    const frames = deltaSec * 60;
    if (this.comboContainer.scale.x > 1) {
      const scale = Math.max(1, this.comboContainer.scale.x - 0.02 * frames);
      this.comboContainer.scale.set(scale);
    }
    if (this.judgeTextTimer > 0) {
      this.judgeTextTimer = Math.max(0, this.judgeTextTimer - frames);
      if (this.judgeTextContainer.scale.x > 1) {
        this.judgeTextContainer.scale.set(Math.max(1, this.judgeTextContainer.scale.x - 0.015 * frames));
      }
      this.judgeTextContainer.alpha = this.judgeTextTimer < 15 ? this.judgeTextTimer / 15 : 1;
    } else {
      this.judgeTextContainer.alpha = 0;
    }

    for (let index = this.activeHitBursts.length - 1; index >= 0; index--) {
      const burst = this.activeHitBursts[index];
      burst.elapsedSec += deltaSec;
      const frame = Math.floor(burst.elapsedSec * this.skinManager.getEffects().shortBurstFps);
      if (frame >= burst.frames.length) {
        burst.sprite.visible = false;
        this.hitBurstPool.push(burst.sprite);
        this.activeHitBursts.splice(index, 1);
      } else {
        burst.sprite.texture = burst.frames[frame];
      }
    }

    for (const effect of this.holdEffects.values()) {
      effect.elapsedSec += deltaSec;
      const frame = Math.floor(effect.elapsedSec * this.skinManager.getEffects().longBurstFps) % this.texLongHitFrames.length;
      effect.sprite.texture = this.texLongHitFrames[frame];
    }
  }

  public showResult(data: ResultData): void {
    if (this.skinManager.getSkin() === 'mobile') {
      this.mobileStage.showResult(data);
      return;
    }
    this.noteClipContainer.visible = false;
    this.comboContainer.visible = false;
    this.judgeTextContainer.alpha = 0;
    this.setRoundVisualState(data.outcome);
    this.resultView.show(data);
  }

  public hideResult(): void {
    this.mobileStage.hideResult();
    this.resultView.reset();
    this.noteClipContainer.visible = true;
    this.setRoundVisualState('playing');
  }

  public getResultData(): ResultData | null {
    return this.resultView.getData();
  }

  private syncHoldEffects(notes: PlayableNote[]): void {
    const activeLanes = this.activeHoldLanes;
    activeLanes.clear();
    for (const note of notes) {
      if (!note.isLong || !note.holdActive) continue;
      activeLanes.add(note.lane);
      if (this.holdEffects.has(note.lane)) continue;
      const sprite = this.holdEffectPool.pop() ?? this.createEffectSprite();
      sprite.texture = this.texLongHitFrames[0];
      sprite.visible = true;
      sprite.anchor.set(0.5);
      sprite.scale.set(1);
      sprite.position.set(note.lane * this.layout.laneWidth + this.layout.laneWidth / 2, this.judgeLocalY());
      this.holdEffects.set(note.lane, { sprite, elapsedSec: 0 });
    }
    for (const [lane, effect] of this.holdEffects) {
      if (activeLanes.has(lane)) continue;
      effect.sprite.visible = false;
      this.holdEffectPool.push(effect.sprite);
      this.holdEffects.delete(lane);
    }
  }

  private fitText(label: Text, value: string, maxWidth: number): void {
    label.text = value;
    if (typeof document === 'undefined') return;
    const chars = Array.from(value);
    while (label.width > maxWidth && chars.length > 0) {
      chars.pop();
      label.text = chars.join('') + '…';
    }
  }

  public setAutoPlay(enabled: boolean): void {
    this.mobileStage.setAutoPlay(enabled);
    this.autoText.text = enabled ? 'AUTO: ON' : 'AUTO: OFF';
    this.autoText.style.fill = enabled ? 0x008822 : 0x771111;
  }

  public setSpeed(gear: number): void {
    const clamped = Math.max(1, Math.min(14, Math.round(gear)));
    this.speedGear = clamped;
    this.speedText.text = `SPD: ${clamped}`;
    this.mobileStage.setSpeed(clamped);
  }

  /** Set the song clock used by the original tick-based note scroll. */
  public setTempoMap(tempoMap: TempoPoint[] | undefined): void {
    this.tempoMap = tempoMap?.length ? tempoMap : [{
      quarter: 0,
      sec: 0,
      secPerQuarter: 0.5,
      bpm: 120
    }];
  }

  private musicTickAt(seconds: number): number {
    return secondsToMusicTick(seconds, this.tempoMap);
  }

  private noteStartTick(note: PlayableNote): number {
    return note.startTick ?? this.musicTickAt(note.startSec);
  }

  private noteEndTick(note: PlayableNote): number {
    if (note.startTick !== undefined && note.durationTicks !== undefined) {
      return note.startTick + note.durationTicks;
    }
    return this.musicTickAt(note.startSec + note.durationSec);
  }

  /**
   * Main render loop called on every frame
   */
  public renderFrame(
    currentTimeSec: number,
    playableNotes: PlayableNote[],
    score: GameScore,
    totalDurationSec: number,
    tempoMap?: TempoPoint[]
  ): void {
    if (tempoMap) this.setTempoMap(tempoMap);
    const L = this.layout;
    const judgeY = this.judgeLocalY();

    // Render visible falling notes. Animation timing is advanced separately
    // from the audio clock by advanceVisuals(). The original client computes
    // both head and tail positions from MUSIC_TIME (768 PPQ ticks), then
    // divides by its speed step. Keeping this calculation in tick space is
    // essential when a song changes tempo.
    const stepTicks = 16 - this.speedGear;
    const currentTick = this.musicTickAt(currentTimeSec);
    if (this.skinManager.getSkin() === 'mobile') {
      this.mobileStage.render({
        currentTimeSec,
        currentTick,
        stepTicks,
        notes: playableNotes,
        score,
        totalDurationSec,
        noteStartTick: note => this.noteStartTick(note),
        noteEndTick: note => this.noteEndTick(note)
      });
      return;
    }
    const laneColors = DEFAULT_SKIN.laneColorIndices;
    const noteMeta = this.activeNoteMeta();
    const noteW = noteMeta.frameWidth;
    const noteH = noteMeta.frameHeight;
    const connectionFromContact = noteMeta.connectionY - noteMeta.contactY;

    if (this.renderedNotes !== playableNotes || currentTimeSec < this.lastRenderTime) {
      this.renderedNotes = playableNotes;
      this.renderCandidates.length = 0;
      this.nextCandidateIndex = 0;
    }
    this.lastRenderTime = currentTimeSec;

    // Add notes only when their head is close enough to enter the clipped area.
    const approachTicks = (judgeY + 80) * stepTicks;
    while (this.nextCandidateIndex < playableNotes.length &&
      this.noteStartTick(playableNotes[this.nextCandidateIndex]) <= currentTick + approachTicks) {
      this.renderCandidates.push(playableNotes[this.nextCandidateIndex++]);
    }
    // Active holds remain candidates until their tails pass the play area.
    // Only these nearby notes can contribute a visible hold effect.
    this.syncHoldEffects(this.renderCandidates);

    let spriteIndex = 0;
    let longBodyIndex = 0;
    let longTailIndex = 0;
    let keptCandidateCount = 0;

    for (let i = 0; i < this.renderCandidates.length; i++) {
      const note = this.renderCandidates[i];
      const unfinishedLong = note.isLong && !note.holdCompleted &&
        currentTimeSec < note.startSec + note.durationSec + .15;
      if (note.judged && !note.holdActive && !unfinishedLong) continue;

      const remainingTicks = this.noteStartTick(note) - currentTick;
      const offsetPx = remainingTicks / stepTicks;
      const yPos = note.isLong && note.judged ? judgeY : judgeY - offsetPx;

      // A speed change can temporarily leave future notes in the candidate list.
      if (yPos < -80) {
        this.renderCandidates[keptCandidateCount++] = note;
        continue;
      }
      if (yPos > L.playHeight + 40 && !note.isLong) {
        continue;
      }
      this.renderCandidates[keptCandidateCount++] = note;

      const laneCenterX = note.lane * L.laneWidth + L.laneWidth / 2;

      // Handle Long Note Body & Tail
      if (note.isLong) {
        const tailRemainingTicks = this.noteEndTick(note) - currentTick;
        const tailOffsetPx = tailRemainingTicks / stepTicks;
        const tailY = judgeY - tailOffsetPx;

        if (tailY < L.playHeight + 50) {
          const bodyTopY = Math.max(0, tailY + connectionFromContact);
          const bodyBottomY = Math.min(L.playHeight, yPos + connectionFromContact);
          const bodyHeight = bodyBottomY - bodyTopY;

          if (bodyHeight > 0) {
            // Extend a native atlas scanline, preserving its RGB565 palette and highlights.
            let body = this.longNoteBodyPool[longBodyIndex];
            if (!body) {
              body = {
                borders: [],
                fill: new Sprite(Texture.WHITE)
              };
              this.noteBodyLayer.addChild(body.fill, ...body.borders);
              this.longNoteBodyPool.push(body);
            }

            const stateAlpha = note.holdBroken || note.hitScore === 'MISS' ? .3 : 1;
            body.fill.visible = true;
            body.fill.texture = this.texLongBodies[laneColors[note.lane]] ?? Texture.WHITE;
            body.fill.tint = 0xffffff;
            body.fill.alpha = stateAlpha;
            body.fill.position.set(laneCenterX - 12, bodyTopY);
            body.fill.width = 24;
            body.fill.height = bodyHeight;

            longBodyIndex++;

          }
        }
        // The release endpoint has its own rounded cap. It follows the tail
        // time even while the head is pinned to the judgment line.
        const tailCenterY = tailY + connectionFromContact;
        if (tailCenterY >= -6 && tailCenterY <= L.playHeight + 6) {
          let tail = this.longNoteTailPool[longTailIndex];
          if (!tail) {
            tail = new Sprite();
            tail.anchor.set(.5);
            this.noteTailLayer.addChild(tail);
            this.longNoteTailPool.push(tail);
          }
          tail.texture = this.texLongHeads[laneColors[note.lane]] ?? this.texNoteSkins[laneColors[note.lane]];
          tail.width = 24;
          tail.height = 12;
          tail.position.set(laneCenterX, tailCenterY);
          tail.alpha = note.holdBroken || note.hitScore === 'MISS' ? .3 : 1;
          tail.visible = true;
          longTailIndex++;
        }
      }

      // Short Note Head (or Long Note Head if not yet completed)
      if (yPos >= -noteH && yPos <= L.playHeight + 20) {
        let spr = this.noteSpritePool[spriteIndex];
        if (!spr) {
          spr = new Sprite(this.texNoteSkins[0]);
          spr.anchor.set(noteMeta.contactX / noteW, noteMeta.contactY / noteH);
          this.noteHeadLayer.addChild(spr);
          this.noteSpritePool.push(spr);
        }
        spr.visible = true;
        spr.alpha = note.holdBroken || note.hitScore === 'MISS' ? .3 : 1;
        spr.texture = note.isLong ? (this.texLongHeads[laneColors[note.lane]] ?? this.texNoteSkins[laneColors[note.lane]]) : this.texNoteSkins[laneColors[note.lane]];
        spr.anchor.set(note.isLong ? 0.5 : noteMeta.contactX / noteW, note.isLong ? 1 : noteMeta.contactY / noteH);
        spr.width = note.isLong ? 24 : noteW;
        spr.height = note.isLong ? 12 : noteH;
        spr.position.set(laneCenterX, yPos);
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
    this.fpsDisplay?.remove();
    this.app.destroy(true, { children: true, texture: false });
    const sources = new Set([...this.noteFrameCache.values()].flatMap(value =>
      [...value.notes, ...value.longHeads, ...value.longBodies].map(texture => texture.source)));
    for (const source of sources) source.destroy();
    for (const texture of this.adjustedTextures.values()) texture.destroy(true);
    for (const texture of this.noteColorAtlases.values()) texture.destroy(true);
    this.noteFrameCache.clear();
  }
}
