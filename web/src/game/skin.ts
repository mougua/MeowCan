/**
 * MeowCan Classic Visual Skin Configuration (skin.ts)
 * Centralizes texture paths, sprite frames, crop tables, font metrics,
 * and layout constants for the authentic 2002 CanMusic visual recreation.
 */

// Public assets are runtime URLs, not JavaScript modules. Keep the validated
// result-atlas crop table in the skin definition so Vite never imports /public.
const resultCrops = {
  title_result: { x: 0, y: 211, width: 160, height: 47 },
  title_clear: { x: 14, y: 258, width: 133, height: 46 },
  title_failed: { x: 168, y: 258, width: 144, height: 46 },
  panel_main: { x: 529, y: 0, width: 103, height: 94 },
  panel_score_line: { x: 529, y: 0, width: 100, height: 46 },
  panel_ratio_line: { x: 529, y: 48, width: 103, height: 46 },
  badge_2x: { x: 371, y: 462, width: 48, height: 51 },
  badge_3x: { x: 419, y: 462, width: 48, height: 51 },
  badge_4x: { x: 467, y: 462, width: 47, height: 51 },
  badge_100x: { x: 514, y: 462, width: 48, height: 51 }
};

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A screen-space rectangle in the logical 716 x 516 stage.
 * Used for both drawing and pointer hit testing so the two can never drift apart.
 */
export type StageRect = FrameRect;

/**
 * All stage geometry lives here so renderer.ts, main.ts and the dev preview
 * share one source of truth (plan P1 step 4/5/6).
 */
export interface StageLayout {
  stageWidth: number;
  stageHeight: number;

  /** play_area.img drawn at its natural 198x334 size (plan P1 step 2). */
  playX: number;
  playY: number;
  playWidth: number;
  playHeight: number;

  /** canback.lle fill behind the narrower seven-lane play area. */
  canBack: StageRect;

  /** can.lle drawn at its natural 255x424 size. */
  canX: number;
  canY: number;
  canWidth: number;
  canHeight: number;

  /** Y of the judgement contact line; notes, bursts and keys all reference it. */
  judgeY: number;

  laneCount: number;
  laneWidth: number;

  /** Judgement bar (hitbar0) drawn around judgeY. */
  hitBar: StageRect;

  /**
   * The seven judgement slot centres measured from hitbar0, in hitbar-local px.
   * Used to prove the drawn slots land on the lane centres (P1 acceptance).
   */
  hitBarSlotOffsets: number[];

  /**
   * The can's inner opening measured from can.png's alpha channel, in can-local
   * px. The keys and the judgement line must stay inside it (P1 acceptance).
   */
  canCavity: StageRect;

  /** Seven independent key buttons, shallow U shape. Draw AND hit test these. */
  keyPositions: StageRect[];
}

export interface TextureMeta {
  path: string;
  width: number;
  height: number;
}

export interface AnimatedTextureMeta extends TextureMeta {
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  layout: 'horizontal' | 'vertical';
}

export interface FontTextureMeta extends TextureMeta {
  charWidth: number;
  charHeight: number;
  spacing: number;
  charCount: number;
}

export interface NoteSkinVariant {
  name: string;
  basePath: string;
  skinPath: string;
  composedPath: string;
  width: number;
  height: number;
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  /** Sprite-local point that touches the judgement line. */
  contactX: number;
  contactY: number;
  /** Sprite-local Y used to join a long-note body to each cap. */
  connectionY: number;
}

export type NoteSkinId = 'base0' | 'base1';
export type SkinId = 'classic' | 'metallic' | 'mobile';
export type SkinAssetKey = 'playArea' | 'canBack' | 'canFrame' | 'hitBar0' | 'hitBar1'
  | 'keyBase' | 'keyNormal' | 'keyPut' | 'keyDeath' | 'noteBase0' | 'noteSkin0'
  | 'noteBase1' | 'noteSkin1' | 'noteComposed0' | 'noteComposed1' | 'longNote'
  | 'shortBurst' | 'longBurst' | 'comboFont';

const METALLIC_ASSET_PATHS: Partial<Record<SkinAssetKey, string>> = {
  playArea: '/assets/metallic/play_area.png',
  canBack: '/assets/metallic/canback.png',
  canFrame: '/assets/metallic/can.png',
  hitBar0: '/assets/metallic/hitbar0.png',
  hitBar1: '/assets/metallic/hitbar1.png',
  keyBase: '/assets/metallic/key_base.png',
  keyNormal: '/assets/metallic/key_normal.png',
  keyPut: '/assets/metallic/key_put.png',
  keyDeath: '/assets/metallic/key_death.png',
  noteBase0: '/assets/metallic/note_base0.png',
  noteSkin0: '/assets/metallic/note_skin0.png',
  noteBase1: '/assets/metallic/note_base1.png',
  noteSkin1: '/assets/metallic/note_skin1.png',
  noteComposed0: '/assets/metallic/note_composed0.png',
  noteComposed1: '/assets/metallic/note_composed1.png',
  longNote: '/assets/metallic/longnote.png',
  shortBurst: '/assets/metallic/hitani0_0.png',
  longBurst: '/assets/metallic/hitani_longnote0_0.png',
  comboFont: '/assets/metallic/combo_font.png'
};

export interface SkinPresentation {
  playArea: StageRect;
  canBack: StageRect;
  canFrame: StageRect;
  hitBarHeight: number;
  keyHeight: number;
  showFace: boolean;
  showDecorations: boolean;
}

const METALLIC_NOTE_VARIANTS: Record<NoteSkinId, NoteSkinVariant> = {
  base0: {
    name: 'metallic_bar_8',
    basePath: METALLIC_ASSET_PATHS.noteBase0!,
    skinPath: METALLIC_ASSET_PATHS.noteSkin0!,
    composedPath: METALLIC_ASSET_PATHS.noteComposed0!,
    width: 416,
    height: 8,
    frameCount: 16,
    frameWidth: 26,
    frameHeight: 8,
    contactX: 13,
    contactY: 8,
    connectionY: 4
  },
  base1: {
    name: 'metallic_bar_8_alt',
    basePath: METALLIC_ASSET_PATHS.noteBase1!,
    skinPath: METALLIC_ASSET_PATHS.noteSkin1!,
    composedPath: METALLIC_ASSET_PATHS.noteComposed1!,
    width: 416,
    height: 8,
    frameCount: 16,
    frameWidth: 26,
    frameHeight: 8,
    contactX: 13,
    contactY: 8,
    connectionY: 4
  }
};

export interface ResultAtlasCrops {
  titleResult: FrameRect;
  titleClear: FrameRect;
  titleFailed: FrameRect;
  hearts: FrameRect[];
  heartCompact: FrameRect;
  statsPanel: FrameRect;
  panelResult: FrameRect;
  panelScoreLine: FrameRect;
  panelRatioLine: FrameRect;
  badge100x: FrameRect;
  badge2x: FrameRect;
  badge3x: FrameRect;
  badge4x: FrameRect;
}

export interface DecorationConfig {
  /** Face position is local to the play area. */
  faceX: number;
  faceY: number;
  wingky: {
    x: number;
    y: number;
    frame: number;
    eyeFrame: number;
    eyeOffsetX: number;
    eyeOffsetY: number;
  };
  star: {
    x: number;
    y: number;
    playingFrame: number;
    resultFrame: number;
    failedFrame: number;
  };
}

export interface EffectConfig {
  comboCenterX: number;
  comboY: number;
  showJudgmentText: boolean;
  shortBurstAnchorX: number;
  shortBurstAnchorY: number;
  shortBurstScale: number;
  shortBurstFps: number;
  longBurstFps: number;
}

export interface ResultLayoutConfig {
  titleY: number;
  failedTitleY: number;
  scoreY: number;
  failedScoreY: number;
  stats: StageRect;
  eqPanel: StageRect;
  heart: StageRect;
  ratioInteger: { x: number; y: number };
  ratioDecimal: { x: number; y: number };
  ratioFraction: { x: number; y: number };
  eqText: { x: number; y: number };
  failedMessageY: number;
  multiplier: { x: number; y: number };
}

export interface SkinConfig {
  name: string;
  version: string;

  // Backgrounds & Board
  bg: TextureMeta;
  playArea: TextureMeta;
  canBack: TextureMeta;
  canFrame: TextureMeta;
  hitBar0: TextureMeta;
  hitBar1: TextureMeta;

  // Keys
  keyBase: TextureMeta;
  keyNormal: TextureMeta;
  keyPut: TextureMeta;
  keyDeath: TextureMeta;

  // Notes
  noteBase0: NoteSkinVariant; // 26x24 (flower base + tall heart)
  noteBase1: NoteSkinVariant; // 26x12 (screenshot flat base + flat heart)
  activeNoteSkin: 'base0' | 'base1';
  laneColorIndices: number[]; // 7 lanes color index mapping (0..15)

  // Hold Notes
  longNote: TextureMeta;

  // Stage Characters & Expressions
  faceMap: AnimatedTextureMeta & {
    indices: {
      smile: number;     // Normal gameplay smile
      surprise: number;  // High combo / alert
      sad: number;       // Failed result
    };
  };
  faceMap2: AnimatedTextureMeta;
  wingkyPinkL0: AnimatedTextureMeta;
  wingkyPinkL1: AnimatedTextureMeta;
  star: AnimatedTextureMeta;
  chn: AnimatedTextureMeta;

  // Hit burst animations
  hitBurst0: AnimatedTextureMeta;
  hitBurstSparkle: AnimatedTextureMeta;
  hitBurstLongNote0: AnimatedTextureMeta;
  hitBurstLongNote1: AnimatedTextureMeta;

  // Fonts & Metrics
  comboFont: FontTextureMeta;
  scoreFont: FontTextureMeta;
  ratioFont: FontTextureMeta;
  eqFont: FontTextureMeta;
  heartFont: FontTextureMeta;

  // Result & Messages
  resultAtlas: TextureMeta & {
    crops: ResultAtlasCrops;
  };
  messageAtlas: TextureMeta & {
    messages: FrameRect[];
  };

  decorations: DecorationConfig;
  effects: EffectConfig;
  resultLayout: ResultLayoutConfig;

  // Layout Constants (Logical 716x516 canvas space)
  layout: StageLayout;
}

export const DEFAULT_SKIN: SkinConfig = {
  name: 'classic_default',
  version: '1.0.0',

  bg: {
    path: '/assets/classic/bg.png',
    width: 716,
    height: 516
  },
  playArea: {
    path: '/assets/classic/play_area.png',
    width: 198,
    height: 334
  },
  canBack: {
    path: '/assets/classic/canback.png',
    width: 235,
    height: 342
  },
  canFrame: {
    path: '/assets/classic/can.png',
    width: 255,
    height: 424
  },
  hitBar0: {
    path: '/assets/classic/hitbar0.png',
    width: 216,
    height: 24
  },
  hitBar1: {
    path: '/assets/classic/hitbar1.png',
    width: 216,
    height: 16
  },

  keyBase: {
    path: '/assets/classic/key_base.png',
    width: 28,
    height: 28
  },
  keyNormal: {
    path: '/assets/classic/key_normal.png',
    width: 28,
    height: 28
  },
  keyPut: {
    path: '/assets/classic/key_put.png',
    width: 28,
    height: 28
  },
  keyDeath: {
    path: '/assets/classic/key_death.png',
    width: 28,
    height: 28
  },

  noteBase0: {
    name: 'tall_heart_24',
    basePath: '/assets/classic/note_base0.png',
    skinPath: '/assets/classic/note_skin0.png',
    composedPath: '/assets/classic/note_composed0.png',
    width: 416,
    height: 24,
    frameCount: 16,
    frameWidth: 26,
    frameHeight: 24,
    contactX: 13,
    contactY: 24,
    connectionY: 12
  },
  noteBase1: {
    name: 'flat_heart_12',
    basePath: '/assets/classic/note_base1.png',
    skinPath: '/assets/classic/note_skin1.png',
    composedPath: '/assets/classic/note_composed1.png',
    width: 416,
    height: 12,
    frameCount: 16,
    frameWidth: 26,
    frameHeight: 12,
    contactX: 13,
    contactY: 12,
    connectionY: 6
  },
  activeNoteSkin: 'base1', // Restoration target: authentic flat heart on base
  laneColorIndices: [3, 8, 1, 0, 1, 8, 3], // Preserve renderer mapping; original palette remains uncalibrated.

  longNote: {
    path: '/assets/classic/longnote.png',
    width: 72,
    height: 192
  },

  faceMap: {
    path: '/assets/classic/face_map.png',
    width: 194,
    height: 840,
    frameCount: 7,
    frameWidth: 194,
    frameHeight: 120,
    layout: 'vertical',
    indices: {
      smile: 0,
      surprise: 3,
      sad: 5
    }
  },
  faceMap2: {
    path: '/assets/classic/face_map2.png',
    width: 194,
    height: 840,
    frameCount: 7,
    frameWidth: 194,
    frameHeight: 120,
    layout: 'vertical'
  },
  wingkyPinkL0: {
    path: '/assets/classic/wingky_pink_l0.png',
    width: 76,
    height: 650,
    frameCount: 13,
    frameWidth: 76,
    frameHeight: 50,
    layout: 'vertical'
  },
  wingkyPinkL1: {
    path: '/assets/classic/wingky_pink_l1.png',
    width: 36,
    height: 520,
    frameCount: 20,
    frameWidth: 36,
    frameHeight: 26,
    layout: 'vertical'
  },
  star: {
    path: '/assets/classic/star.png',
    width: 122,
    height: 7296,
    frameCount: 64,
    frameWidth: 122,
    frameHeight: 114,
    layout: 'vertical'
  },
  chn: {
    path: '/assets/classic/chn.png',
    width: 122,
    height: 2052,
    frameCount: 18,
    frameWidth: 122,
    frameHeight: 114,
    layout: 'vertical'
  },

  hitBurst0: {
    path: '/assets/classic/hitani0_0.png',
    width: 800,
    height: 118,
    frameCount: 10,
    frameWidth: 80,
    frameHeight: 118,
    layout: 'horizontal'
  },
  hitBurstSparkle: {
    path: '/assets/classic/hitani1_0.png',
    width: 800,
    height: 118,
    frameCount: 10,
    frameWidth: 80,
    frameHeight: 118,
    layout: 'horizontal'
  },
  hitBurstLongNote0: {
    path: '/assets/classic/hitani_longnote0_0.png',
    width: 320,
    height: 32,
    frameCount: 10,
    frameWidth: 32,
    frameHeight: 32,
    layout: 'horizontal'
  },
  hitBurstLongNote1: {
    path: '/assets/classic/hitani_longnote1_0.png',
    width: 280,
    height: 28,
    frameCount: 10,
    frameWidth: 28,
    frameHeight: 28,
    layout: 'horizontal'
  },

  comboFont: {
    path: '/assets/classic/combo_font.png',
    width: 520,
    height: 70,
    charWidth: 52,
    charHeight: 70,
    spacing: 1,
    charCount: 10
  },
  scoreFont: {
    path: '/assets/classic/score_font.png',
    width: 260,
    height: 26,
    charWidth: 26,
    charHeight: 26,
    spacing: 1,
    charCount: 10
  },
  ratioFont: {
    path: '/assets/classic/ratio_font.png',
    width: 120,
    height: 12,
    charWidth: 12,
    charHeight: 12,
    spacing: 1,
    charCount: 10
  },
  eqFont: {
    path: '/assets/classic/eq_font.png',
    width: 70,
    height: 7,
    charWidth: 7,
    charHeight: 7,
    spacing: 1,
    charCount: 10
  },
  heartFont: {
    path: '/assets/classic/heart_font.png',
    width: 70,
    height: 5,
    charWidth: 5,
    charHeight: 5,
    spacing: 9,
    charCount: 14
  },

  resultAtlas: {
    path: '/assets/classic/result.png',
    width: 800,
    height: 600,
    crops: {
      titleResult: resultCrops.title_result,
      titleClear: resultCrops.title_clear,
      titleFailed: resultCrops.title_failed,
      hearts: [
        { x: 21, y: 134, width: 64, height: 54 },
        { x: 122, y: 129, width: 74, height: 64 },
        { x: 222, y: 123, width: 86, height: 76 },
        { x: 323, y: 119, width: 96, height: 86 },
        { x: 424, y: 116, width: 111, height: 99 }
      ],
      heartCompact: { x: 248, y: 39, width: 34, height: 29 },
      statsPanel: resultCrops.panel_main,
      panelResult: { x: 529, y: 0, width: 100, height: 35 },
      panelScoreLine: { x: 529, y: 0, width: 74, height: 24 },
      panelRatioLine: { x: 529, y: 24, width: 100, height: 23 },
      badge100x: resultCrops.badge_100x,
      badge2x: resultCrops.badge_2x,
      badge3x: resultCrops.badge_3x,
      badge4x: resultCrops.badge_4x
    }
  },

  messageAtlas: {
    path: '/assets/classic/message.png',
    width: 194,
    height: 1148,
    messages: [
      { x: 10, y: 7, width: 174, height: 66 },
      { x: 1, y: 88, width: 192, height: 67 },
      { x: 4, y: 169, width: 187, height: 74 },
      { x: 10, y: 246, width: 173, height: 81 },
      { x: 2, y: 333, width: 190, height: 75 },
      { x: 48, y: 412, width: 101, height: 30 },
      { x: 27, y: 448, width: 141, height: 42 },
      { x: 20, y: 494, width: 157, height: 27 },
      { x: 2, y: 525, width: 190, height: 39 },
      { x: 36, y: 576, width: 124, height: 38 },
      { x: 3, y: 617, width: 190, height: 35 },
      { x: 6, y: 660, width: 183, height: 76 },
      { x: 6, y: 741, width: 180, height: 78 },
      { x: 10, y: 821, width: 176, height: 80 },
      { x: 27, y: 940, width: 135, height: 31 },
      { x: 35, y: 1022, width: 119, height: 31 },
      { x: 32, y: 1104, width: 128, height: 33 }
    ]
  },

  decorations: {
    // Pixel comparison finds an exact background-gradient match at play-local y=43;
    // x=2 aligns the 194 px face-map lane separators with the 198 px play area.
    faceX: 2,
    faceY: 43,
    wingky: {
      x: 52,
      y: 36,
      frame: 0,
      eyeFrame: 0,
      eyeOffsetX: 20,
      eyeOffsetY: 12
    },
    star: {
      x: 164,
      y: 6,
      playingFrame: 23,
      resultFrame: 23,
      failedFrame: 38
    }
  },

  effects: {
    comboCenterX: 139,
    comboY: 151,
    showJudgmentText: false,
    shortBurstAnchorX: 0.5,
    shortBurstAnchorY: 0.82,
    shortBurstScale: 1,
    shortBurstFps: 30,
    longBurstFps: 30
  },

  resultLayout: {
    titleY: 108,
    failedTitleY: 112,
    scoreY: 282,
    failedScoreY: 300,
    stats: { x: 42, y: 358, width: 100, height: 23 },
    eqPanel: { x: 163, y: 369, width: 74, height: 24 },
    heart: { x: 100, y: 317, width: 34, height: 29 },
    ratioInteger: { x: 79, y: 369 },
    ratioDecimal: { x: 86, y: 378 },
    ratioFraction: { x: 95, y: 369 },
    eqText: { x: 235, y: 393 },
    failedMessageY: 190,
    multiplier: { x: 172, y: 300 }
  },

  layout: {
    stageWidth: 716,
    stageHeight: 516,

    // Play area: natural play_area.img size, no local stretch (plan P1 step 2).
    // The lane texture is inset 18 px from canback. Its vertical gradient best
    // matches canback when play row y overlays canback row y - 6.
    playX: 40,
    playY: 123,
    playWidth: 198,
    playHeight: 334,

    // canback fills the complete transparent bowl behind the narrower play_area.
    // Alpha-mask registration against can.png has four zero-leak solutions;
    // (13,69) is the top-left integer solution relative to the can frame.
    canBack: { x: 22, y: 129, width: 235, height: 342 },

    // Can frame: natural can.lle size. The offset against the play area is derived
    // from the source art, not guessed: can.png has an opaque hole at x=[23,237]
    // (center 130) and play_area (198 wide) sits symmetrically inside it, giving
    // +31 px horizontally; the play area rim starts where the can opening becomes
    // transparent (can.png y~80). The right can edge measured in ref/pics/can-bg-face.png
    // (shot x~502 for a ~1.91x screenshot scale) independently confirms +31.
    canX: 9,
    canY: 60,
    canWidth: 255,
    canHeight: 424,

    // Judgement contact line: playY + 283. The 283 comes from registering
    // play_area row 0 (shot y~146.5) and the judgement bar (shot y~687.5) in
    // ref/pics/can-bg-face.png at the lane-separator-derived scale (~1.91).
    judgeY: 423,

    laneCount: 7,
    // play_area.png has 8 white separators at x = 0, 28, ... 196 -> 28 px per lane.
    laneWidth: 28,

    // The active flat note skin uses hitbar1 at its native 216x16 size.
    // Its centre stays on judgeY, matching the contact point of the old bar.
    hitBar: { x: 31, y: 415, width: 216, height: 16 },

    // Measured from hitbar0.png: the columns that stay opaque over the full
    // 24 px height are solid bands at 0-14, 33-42, 61-70, 89-98, 117-126,
    // 145-154, 173-182 and 201-215. The seven gaps between those bands are the
    // judgement slots. With hitBar.x = 31 the slots land on 54.5, 82.5, 110.5,
    // 138.5, 166.5, 194.5 and 222.5, i.e. within 0.5 px of the lane centres.
    hitBarSlotOffsets: [23.5, 51.5, 79.5, 107.5, 135.5, 163.5, 191.5],

    // can.png alpha: the bowl opening is transparent from can-local y=81 to
    // y=396; over that span the transparent run is widest (x=18..238) around
    // y=200-300 and narrows towards the centre near the bottom. The bounding
    // box below is the containment bound for the keys and the judge line.
    canCavity: { x: 18, y: 81, width: 221, height: 316 },

    // Seven 28x28 keys follow the pronounced U curve visible in the original UI.
    // Drawing and hit testing both consume these exact rectangles.
    keyPositions: [
      { x: 40, y: 424, width: 28, height: 28 },
      { x: 68, y: 427, width: 28, height: 28 },
      { x: 96, y: 431, width: 28, height: 28 },
      { x: 124, y: 435, width: 28, height: 28 },
      { x: 152, y: 431, width: 28, height: 28 },
      { x: 180, y: 427, width: 28, height: 28 },
      { x: 208, y: 424, width: 28, height: 28 }
    ]
  }
};

/**
 * Runtime skin selection policy.  Rendering code consumes this small API
 * instead of knowing how many skin variants the asset pack contains.
 */
export class SkinManager {
  private readonly skin: SkinConfig;
  private activeNoteSkin: NoteSkinId;
  private activeSkin: SkinId = 'classic';

  public constructor(skin: SkinConfig = DEFAULT_SKIN) {
    this.skin = skin;
    this.activeNoteSkin = skin.activeNoteSkin;
  }

  public getConfig(): SkinConfig {
    return this.skin;
  }

  public getNoteVariant(): NoteSkinVariant {
    if (this.activeSkin === 'metallic') return METALLIC_NOTE_VARIANTS[this.activeNoteSkin];
    return this.activeNoteSkin === 'base1' ? this.skin.noteBase1 : this.skin.noteBase0;
  }

  public getHitBar(): TextureMeta {
    if (this.activeSkin === 'metallic') {
      return { path: this.getAssetPath(this.activeNoteSkin === 'base1' ? 'hitBar1' : 'hitBar0'), width: 216, height: 9 };
    }
    return this.activeNoteSkin === 'base1' ? this.skin.hitBar1 : this.skin.hitBar0;
  }

  public getPresentation(): SkinPresentation {
    const layout = this.skin.layout;
    if (this.activeSkin === 'metallic') {
      // METALiC stores its title/header above the same 198x334 playable lane
      // region and extends the can upward. Bottom-aligning the larger originals
      // preserves the shared judgement geometry without cropping or stretching.
      return {
        playArea: { x: 0, y: -46, width: 198, height: 380 },
        canBack: { x: layout.canBack.x, y: layout.canBack.y - 12, width: 235, height: 354 },
        canFrame: { x: layout.canX, y: layout.canY - 26, width: 255, height: 450 },
        hitBarHeight: 9,
        keyHeight: 40,
        showFace: false,
        showDecorations: false
      };
    }
    return {
      playArea: { x: 0, y: 0, width: layout.playWidth, height: layout.playHeight },
      canBack: { ...layout.canBack },
      canFrame: { x: layout.canX, y: layout.canY, width: layout.canWidth, height: layout.canHeight },
      hitBarHeight: this.getHitBar().height,
      keyHeight: this.skin.keyNormal.height,
      showFace: true,
      showDecorations: true
    };
  }

  public setSkin(id: SkinId): void {
    this.activeSkin = id;
  }

  public getSkin(): SkinId {
    return this.activeSkin;
  }

  public getAssetPath(key: SkinAssetKey): string {
    if (this.activeSkin === 'metallic' && METALLIC_ASSET_PATHS[key]) {
      return METALLIC_ASSET_PATHS[key]!;
    }
    const classic: Record<SkinAssetKey, string> = {
      playArea: this.skin.playArea.path,
      canBack: this.skin.canBack.path,
      canFrame: this.skin.canFrame.path,
      hitBar0: this.skin.hitBar0.path,
      hitBar1: this.skin.hitBar1.path,
      keyBase: this.skin.keyBase.path,
      keyNormal: this.skin.keyNormal.path,
      keyPut: this.skin.keyPut.path,
      keyDeath: this.skin.keyDeath.path,
      noteBase0: this.skin.noteBase0.basePath,
      noteSkin0: this.skin.noteBase0.skinPath,
      noteBase1: this.skin.noteBase1.basePath,
      noteSkin1: this.skin.noteBase1.skinPath,
      noteComposed0: this.skin.noteBase0.composedPath,
      noteComposed1: this.skin.noteBase1.composedPath,
      longNote: this.skin.longNote.path,
      shortBurst: this.skin.hitBurstSparkle.path,
      longBurst: this.skin.hitBurstLongNote0.path,
      comboFont: this.skin.comboFont.path
    };
    return classic[key];
  }

  public getShortBurst(): AnimatedTextureMeta {
    if (this.activeSkin === 'metallic') {
      return {
        path: this.getAssetPath('shortBurst'), width: 980, height: 98,
        frameCount: 10, frameWidth: 98, frameHeight: 98, layout: 'horizontal'
      };
    }
    return this.skin.hitBurstSparkle;
  }

  public getLongBurst(): AnimatedTextureMeta {
    if (this.activeSkin === 'metallic') {
      return {
        path: this.getAssetPath('longBurst'), width: 800, height: 80,
        frameCount: 10, frameWidth: 80, frameHeight: 80, layout: 'horizontal'
      };
    }
    return this.skin.hitBurstLongNote0;
  }

  public getComboFont(): FontTextureMeta {
    if (this.activeSkin === 'metallic') {
      return { ...this.skin.comboFont, path: this.getAssetPath('comboFont') };
    }
    return this.skin.comboFont;
  }

  public getEffects(): EffectConfig {
    if (this.activeSkin === 'metallic') {
      return { ...this.skin.effects, shortBurstAnchorY: 0.5 };
    }
    return this.skin.effects;
  }

  public setNoteSkin(id: NoteSkinId): void {
    this.activeNoteSkin = id;
  }

  public getNoteSkin(): NoteSkinId {
    return this.activeNoteSkin;
  }
}

/**
 * Validates all crop boxes and frame bounds within their parent textures.
 * Throws an Error if any crop coordinate is outside texture boundaries.
 */
export function validateSkinCrops(skin: SkinConfig = DEFAULT_SKIN): void {
  function checkCrop(texName: string, w: number, h: number, rect: FrameRect, label: string) {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) ||
        rect.width <= 0 || rect.height <= 0 || rect.x < 0 || rect.y < 0 || rect.x + rect.width > w || rect.y + rect.height > h) {
      throw new Error(
        `Invalid crop in ${texName} [${label}]: {x:${rect.x}, y:${rect.y}, w:${rect.width}, h:${rect.height}} exceeds tex bounds ${w}x${h}`
      );
    }
  }

  // Result Atlas
  const rTex = skin.resultAtlas;
  const crops = rTex.crops;
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.titleResult, 'titleResult');
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.titleClear, 'titleClear');
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.titleFailed, 'titleFailed');
  crops.hearts.forEach((h, idx) => checkCrop('resultAtlas', rTex.width, rTex.height, h, `heart_${idx}`));
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.heartCompact, 'heartCompact');
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.statsPanel, 'statsPanel');
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.panelResult, 'panelResult');
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.panelScoreLine, 'panelScoreLine');
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.panelRatioLine, 'panelRatioLine');
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.badge100x, 'badge100x');
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.badge2x, 'badge2x');
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.badge3x, 'badge3x');
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.badge4x, 'badge4x');

  // Messages
  const mTex = skin.messageAtlas;
  mTex.messages.forEach((m, idx) => checkCrop('messageAtlas', mTex.width, mTex.height, m, `message_${idx}`));

  // Animated Textures Frames Check
  const animatedList: [string, AnimatedTextureMeta][] = [
    ['faceMap', skin.faceMap],
    ['faceMap2', skin.faceMap2],
    ['wingkyPinkL0', skin.wingkyPinkL0],
    ['wingkyPinkL1', skin.wingkyPinkL1],
    ['star', skin.star],
    ['chn', skin.chn],
    ['hitBurst0', skin.hitBurst0],
    ['hitBurstSparkle', skin.hitBurstSparkle],
    ['hitBurstLongNote0', skin.hitBurstLongNote0],
    ['hitBurstLongNote1', skin.hitBurstLongNote1]
  ];

  for (const [name, meta] of animatedList) {
    if (!Number.isSafeInteger(meta.frameCount) || meta.frameCount <= 0) throw new Error(`Invalid frame count: ${name}`);
    for (let f = 0; f < meta.frameCount; f++) {
      const fx = meta.layout === 'horizontal' ? f * meta.frameWidth : 0;
      const fy = meta.layout === 'vertical' ? f * meta.frameHeight : 0;
      checkCrop(name, meta.width, meta.height, { x: fx, y: fy, width: meta.frameWidth, height: meta.frameHeight }, `frame_${f}`);
    }
  }
  for (const meta of [skin.noteBase0, skin.noteBase1]) {
    checkCrop(meta.name, meta.width, meta.height, { x: 0, y: 0, width: meta.frameCount * meta.frameWidth, height: meta.frameHeight }, 'notes');
    if (meta.contactX < 0 || meta.contactX > meta.frameWidth ||
        meta.contactY < 0 || meta.contactY > meta.frameHeight ||
        meta.connectionY < 0 || meta.connectionY > meta.frameHeight) {
      throw new Error(`Invalid note anchors for ${meta.name}`);
    }
  }
  for (const meta of [skin.comboFont, skin.scoreFont, skin.ratioFont, skin.eqFont, skin.heartFont]) {
    checkCrop(meta.path, meta.width, meta.height, { x: 0, y: 0, width: meta.charCount * meta.charWidth, height: meta.charHeight }, 'font');
  }

  const face = skin.decorations;
  if (face.faceX < 0 || face.faceY < 0 ||
      face.faceX + skin.faceMap.frameWidth > skin.layout.playWidth ||
      face.faceY + skin.faceMap.frameHeight > skin.layout.playHeight) {
    throw new Error('Face frame leaves the play area');
  }
  const frameChecks: Array<[string, number, number]> = [
    ['wingky', face.wingky.frame, skin.wingkyPinkL0.frameCount],
    ['wingky eyes', face.wingky.eyeFrame, skin.wingkyPinkL1.frameCount],
    ['playing star', face.star.playingFrame, skin.star.frameCount],
    ['result star', face.star.resultFrame, skin.star.frameCount],
    ['failed star', face.star.failedFrame, skin.star.frameCount]
  ];
  for (const [label, frame, count] of frameChecks) {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= count) {
      throw new Error(`Invalid ${label} frame ${frame}`);
    }
  }
}

/**
 * Validates the shared stage geometry used by both drawing and hit testing.
 * Every key rectangle must stay inside the logical stage, so a click in the
 * letterbox margin can never resolve to a lane (plan P1 acceptance).
 */
export function validateStageLayout(layout: StageLayout = DEFAULT_SKIN.layout): void {
  const isRect = (r: StageRect) =>
    !!r && [r.x, r.y, r.width, r.height].every(Number.isSafeInteger) && r.width > 0 && r.height > 0;

  const inStage = (r: StageRect, label: string) => {
    if (!isRect(r)) throw new Error(`Invalid layout rect ${label}: ${JSON.stringify(r)}`);
    if (r.x < 0 || r.y < 0 || r.x + r.width > layout.stageWidth || r.y + r.height > layout.stageHeight) {
      throw new Error(`Layout rect ${label} leaves the ${layout.stageWidth}x${layout.stageHeight} stage: ${JSON.stringify(r)}`);
    }
  };

  if (!Number.isSafeInteger(layout.stageWidth) || !Number.isSafeInteger(layout.stageHeight) ||
      layout.stageWidth <= 0 || layout.stageHeight <= 0) {
    throw new Error(`Invalid stage size: ${layout.stageWidth}x${layout.stageHeight}`);
  }

  inStage({ x: layout.playX, y: layout.playY, width: layout.playWidth, height: layout.playHeight }, 'playArea');
  inStage({ x: layout.canX, y: layout.canY, width: layout.canWidth, height: layout.canHeight }, 'canFrame');
  inStage(layout.canBack, 'canBack');
  inStage(layout.hitBar, 'hitBar');

  if (layout.canBack.x < layout.canX || layout.canBack.y < layout.canY ||
      layout.canBack.x + layout.canBack.width > layout.canX + layout.canWidth ||
      layout.canBack.y + layout.canBack.height > layout.canY + layout.canHeight) {
    throw new Error(`canBack ${JSON.stringify(layout.canBack)} leaves the can frame`);
  }

  if (!Number.isSafeInteger(layout.laneWidth) || layout.laneWidth <= 0) {
    throw new Error(`Invalid lane width: ${layout.laneWidth}`);
  }
  if (layout.keyPositions.length !== layout.laneCount) {
    throw new Error(`Expected ${layout.laneCount} key rectangles, found ${layout.keyPositions.length}`);
  }
  layout.keyPositions.forEach((key, lane) => inStage(key, `key_${lane}`));

  if (layout.judgeY < layout.playY || layout.judgeY > layout.playY + layout.playHeight) {
    throw new Error(`judgeY ${layout.judgeY} is outside the play area [${layout.playY}, ${layout.playY + layout.playHeight}]`);
  }

  // The measured can opening (can-local) must stay inside the can frame and
  // contain the judge line. The curved keys sit on the frame below the opening.
  const cavity = layout.canCavity;
  if (!isRect(cavity) ||
      cavity.x + cavity.width > layout.canWidth || cavity.y + cavity.height > layout.canHeight) {
    throw new Error(`canCavity ${JSON.stringify(cavity)} leaves the can frame ${layout.canWidth}x${layout.canHeight}`);
  }
  const cavityOnStage: StageRect = {
    x: layout.canX + cavity.x,
    y: layout.canY + cavity.y,
    width: cavity.width,
    height: cavity.height
  };
  inStage(cavityOnStage, 'canCavity');
  if (layout.judgeY < cavityOnStage.y || layout.judgeY > cavityOnStage.y + cavityOnStage.height) {
    throw new Error(`judgeY ${layout.judgeY} is outside the can cavity [${cavityOnStage.y}, ${cavityOnStage.y + cavityOnStage.height}]`);
  }
  const canOnStage: StageRect = {
    x: layout.canX,
    y: layout.canY,
    width: layout.canWidth,
    height: layout.canHeight
  };
  layout.keyPositions.forEach((key, lane) => {
    if (key.x < canOnStage.x || key.y < canOnStage.y ||
        key.x + key.width > canOnStage.x + canOnStage.width ||
        key.y + key.height > canOnStage.y + canOnStage.height) {
      throw new Error(`key_${lane} ${JSON.stringify(key)} leaves the can frame ${JSON.stringify(canOnStage)}`);
    }
  });

  // Acceptance: every key and every measured judgement slot sits on its lane
  // centre, so the drawn keys and the drawn hitbar share the note lanes.
  if (layout.hitBarSlotOffsets.length !== layout.laneCount) {
    throw new Error(`Expected ${layout.laneCount} judgement slot offsets, found ${layout.hitBarSlotOffsets.length}`);
  }
  layout.keyPositions.forEach((key, lane) => {
    const laneCenter = layout.playX + lane * layout.laneWidth + layout.laneWidth / 2;
    if (Math.abs(key.x + key.width / 2 - laneCenter) > 0.5) {
      throw new Error(`key_${lane} centre ${key.x + key.width / 2} is off lane centre ${laneCenter}`);
    }
    const slotCenter = layout.hitBar.x + layout.hitBarSlotOffsets[lane];
    if (Math.abs(slotCenter - laneCenter) > 1) {
      throw new Error(`hitbar slot ${lane} centre ${slotCenter} is off lane centre ${laneCenter} by more than 1 px`);
    }
  });
}
