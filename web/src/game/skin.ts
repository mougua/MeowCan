/**
 * MeowCan Classic Visual Skin Configuration (skin.ts)
 * Centralizes texture paths, sprite frames, crop tables, font metrics,
 * and layout constants for the authentic 2002 CanMusic visual recreation.
 */

import manifest from '../../public/assets/classic/manifest.json';
const resultCrops = manifest.assets['result.png'].crops;

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
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
}

export interface ResultAtlasCrops {
  titleResult: FrameRect;
  titleClear: FrameRect;
  titleFailed: FrameRect;
  hearts: FrameRect[];
  statsPanel: FrameRect;
  panelScoreLine: FrameRect;
  panelRatioLine: FrameRect;
  badge100x: FrameRect;
  badge2x: FrameRect;
  badge3x: FrameRect;
  badge4x: FrameRect;
}

export interface SkinConfig {
  name: string;
  version: string;

  // Backgrounds & Board
  bg: TextureMeta;
  playArea: TextureMeta;
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
      sad: number;       // Failed / zero life
    };
  };
  faceMap2: AnimatedTextureMeta;
  wingkyPinkL0: AnimatedTextureMeta;
  wingkyPinkL1: AnimatedTextureMeta;
  star: AnimatedTextureMeta;
  chn: AnimatedTextureMeta;

  // Hit burst animations
  hitBurst0: AnimatedTextureMeta;
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

  // Layout Constants (Logical 716x516 canvas space)
  layout: {
    stageWidth: number;
    stageHeight: number;
    playX: number;
    playY: number;
    playWidth: number;
    playHeight: number;
    canX: number;
    canY: number;
    canWidth: number;
    canHeight: number;
    judgeY: number;
    laneCount: number;
    laneWidth: number;
    keyPositions: { x: number; y: number; width: number; height: number }[];
  };
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
    frameHeight: 24
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
    frameHeight: 12
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
      statsPanel: resultCrops.panel_main,
      panelScoreLine: resultCrops.panel_score_line,
      panelRatioLine: resultCrops.panel_ratio_line,
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

  layout: {
    stageWidth: 716,
    stageHeight: 516,
    playX: 40,
    playY: 140,
    playWidth: 198,
    playHeight: 334,
    canX: 14,
    canY: 68,
    canWidth: 255,
    canHeight: 424,
    judgeY: 276,
    laneCount: 7,
    laneWidth: 198 / 7,
    // Shallow U-curve 7 keys arrangement (preliminary anchor points for P1 calibration)
    keyPositions: [
      { x: 38, y: 472, width: 28, height: 28 },
      { x: 66, y: 474, width: 28, height: 28 },
      { x: 94, y: 476, width: 28, height: 28 },
      { x: 125, y: 477, width: 28, height: 28 },
      { x: 156, y: 476, width: 28, height: 28 },
      { x: 184, y: 474, width: 28, height: 28 },
      { x: 212, y: 472, width: 28, height: 28 }
    ]
  }
};

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
  checkCrop('resultAtlas', rTex.width, rTex.height, crops.statsPanel, 'statsPanel');
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
  }
  for (const meta of [skin.comboFont, skin.scoreFont, skin.ratioFont, skin.eqFont, skin.heartFont]) {
    checkCrop(meta.path, meta.width, meta.height, { x: 0, y: 0, width: meta.charCount * meta.charWidth, height: meta.charHeight }, 'font');
  }
}
