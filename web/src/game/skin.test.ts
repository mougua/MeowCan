import { describe, expect, it } from 'bun:test';
import { DEFAULT_SKIN, SkinManager, validateSkinCrops, validateStageLayout, type SkinConfig } from './skin';
import manifest from '../../public/assets/classic/manifest.json';

describe('skin configuration and validation', () => {
  it('matches every configured texture size to the exported original', () => {
    const assets = manifest.assets as Record<string, { width: number; height: number }>;
    for (const meta of Object.values(DEFAULT_SKIN)) {
      if (meta && typeof meta === 'object' && 'path' in meta) {
        const original = assets[String(meta.path).split('/').pop()!];
        expect(original).toBeDefined();
        expect(meta.width).toBe(original.width);
        expect(meta.height).toBe(original.height);
      }
    }
  });
  it('rejects empty, negative, fractional and non-finite crop dimensions', () => {
    for (const width of [0, -1, 0.5, NaN, Infinity]) {
      const skin = structuredClone(DEFAULT_SKIN);
      skin.resultAtlas.crops.titleResult.width = width;
      expect(() => validateSkinCrops(skin)).toThrow();
    }
  });

  it('checks note and font frames as well as character animations', () => {
    const skin = structuredClone(DEFAULT_SKIN);
    skin.noteBase1.frameCount = 17;
    expect(() => validateSkinCrops(skin)).toThrow();
    const fontSkin = structuredClone(DEFAULT_SKIN);
    fontSkin.scoreFont.charWidth = 27;
    expect(() => validateSkinCrops(fontSkin)).toThrow();
  });
  it('validates default skin crops without throwing', () => {
    expect(() => validateSkinCrops(DEFAULT_SKIN)).not.toThrow();
  });

  it('detects out-of-bounds crops correctly', () => {
    const corruptedSkin: SkinConfig = JSON.parse(JSON.stringify(DEFAULT_SKIN));
    // Purposely put an overflowing crop
    corruptedSkin.resultAtlas.crops.titleResult.x = 999;
    expect(() => validateSkinCrops(corruptedSkin)).toThrow();
  });

  it('detects negative crop coordinates correctly', () => {
    const corruptedSkin: SkinConfig = JSON.parse(JSON.stringify(DEFAULT_SKIN));
    corruptedSkin.resultAtlas.crops.titleResult.y = -5;
    expect(() => validateSkinCrops(corruptedSkin)).toThrow();
  });

  it('verifies note skin dimensions for base0 and base1', () => {
    expect(DEFAULT_SKIN.noteBase0.frameWidth).toBe(26);
    expect(DEFAULT_SKIN.noteBase0.frameHeight).toBe(24);
    expect(DEFAULT_SKIN.noteBase1.frameWidth).toBe(26);
    expect(DEFAULT_SKIN.noteBase1.frameHeight).toBe(12);
    expect(DEFAULT_SKIN.activeNoteSkin).toBe('base1');
    expect(DEFAULT_SKIN.noteBase1.contactX).toBe(13);
    expect(DEFAULT_SKIN.noteBase1.contactY).toBe(12);
    expect(DEFAULT_SKIN.noteBase1.connectionY).toBe(6);
  });

  it('keeps the METALiC assets at their original dimensions', () => {
    const manager = new SkinManager();
    manager.setSkin('metallic');
    expect(manager.getNoteVariant().frameHeight).toBe(8);
    expect(manager.getHitBar().height).toBe(9);
    expect(manager.getPresentation()).toMatchObject({
      playArea: { y: -46, width: 198, height: 380 },
      canBack: { width: 235, height: 354 },
      canFrame: { width: 255, height: 450 },
      keyHeight: 40,
      showFace: false,
      showDecorations: false
    });
  });

  it('keeps expression and character frame selections within their atlases', () => {
    expect(() => validateSkinCrops(DEFAULT_SKIN)).not.toThrow();
    const broken = structuredClone(DEFAULT_SKIN);
    broken.decorations.star.failedFrame = broken.star.frameCount;
    expect(() => validateSkinCrops(broken)).toThrow();
  });

  it('uses the measured face-map registration and keeps top characters on stage', () => {
    const { decorations, layout, faceMap, wingkyPinkL0, star } = DEFAULT_SKIN;
    expect(decorations.faceX).toBe(2);
    expect(decorations.faceY).toBe(43);
    expect(decorations.faceX + faceMap.frameWidth).toBeLessThanOrEqual(layout.playWidth);
    expect(decorations.faceY + faceMap.frameHeight).toBeLessThanOrEqual(layout.playHeight);
    expect(decorations.wingky.x + wingkyPinkL0.frameWidth).toBeLessThanOrEqual(layout.stageWidth);
    expect(decorations.wingky.y + wingkyPinkL0.frameHeight).toBeLessThanOrEqual(layout.stageHeight);
    expect(decorations.star.x + star.frameWidth).toBeLessThanOrEqual(layout.stageWidth);
    expect(decorations.star.y + star.frameHeight).toBeLessThanOrEqual(layout.stageHeight);
    expect(decorations.star.failedFrame).toBe(38);
  });

  it('verifies manifest has all converted assets and matching frame dimensions', () => {
    const assets = manifest.assets as Record<string, any>;
    expect(assets['note_skin0.png']).toBeDefined();
    expect(assets['note_skin0.png'].width).toBe(416);
    expect(assets['note_skin0.png'].height).toBe(24);

    expect(assets['note_skin1.png']).toBeDefined();
    expect(assets['note_skin1.png'].width).toBe(416);
    expect(assets['note_skin1.png'].height).toBe(12);

    expect(assets['result.png']).toBeDefined();
    expect(assets['result.png'].width).toBe(800);
    expect(assets['result.png'].height).toBe(600);

    expect(assets['message.png']).toBeDefined();
    expect(assets['message.png'].width).toBe(194);
    expect(assets['message.png'].height).toBe(1148);

    expect(assets['star.png']).toBeDefined();
    expect(assets['star.png'].width).toBe(122);
    expect(assets['star.png'].height).toBe(7296);
  });
});

describe('stage layout (P1)', () => {
  it('keeps the logical stage and uses the natural source sizes', () => {
    const L = DEFAULT_SKIN.layout;
    expect(L.stageWidth).toBe(716);
    expect(L.stageHeight).toBe(516);
    expect(L.playWidth).toBe(DEFAULT_SKIN.playArea.width);
    expect(L.playHeight).toBe(DEFAULT_SKIN.playArea.height);
    expect(L.canBack.width).toBe(DEFAULT_SKIN.canBack.width);
    expect(L.canBack.height).toBe(DEFAULT_SKIN.canBack.height);
    expect(L.canWidth).toBe(DEFAULT_SKIN.canFrame.width);
    expect(L.canHeight).toBe(DEFAULT_SKIN.canFrame.height);
    expect(L.hitBar.width).toBe(DEFAULT_SKIN.hitBar1.width);
    expect(L.hitBar.height).toBe(DEFAULT_SKIN.hitBar1.height);
  });

  it('matches the measured play_area lane pitch', () => {
    const L = DEFAULT_SKIN.layout;
    // play_area.png has 8 white separators at x = 0, 28, ... 196.
    expect(L.laneWidth).toBe(28);
    expect(L.laneWidth * L.laneCount).toBeLessThanOrEqual(L.playWidth);
    expect(L.playWidth - L.laneWidth * L.laneCount).toBeLessThanOrEqual(2);
  });

  it('places the judgement line inside the play area', () => {
    const L = DEFAULT_SKIN.layout;
    expect(L.judgeY).toBeGreaterThan(L.playY);
    expect(L.judgeY).toBeLessThan(L.playY + L.playHeight);
  });

  it('keeps the seven keys inside the can and in a shallow U shape', () => {
    const L = DEFAULT_SKIN.layout;
    const keyBottom = Math.max(...L.keyPositions.map(k => k.y + k.height));
    expect(keyBottom).toBeLessThanOrEqual(L.canY + L.canHeight);
    const ys = L.keyPositions.map(k => k.y);
    expect(ys[3]).toBeGreaterThan(ys[0]);
    expect(ys[3]).toBeGreaterThan(ys[6]);
    expect(ys[3] - ys[0]).toBeGreaterThanOrEqual(10);
  });

  it('validates the default layout and rejects broken geometry', () => {
    expect(() => validateStageLayout(DEFAULT_SKIN.layout)).not.toThrow();

    const outside = structuredClone(DEFAULT_SKIN.layout);
    outside.keyPositions[6].x = 700;
    expect(() => validateStageLayout(outside)).toThrow();

    const wrongCount = structuredClone(DEFAULT_SKIN.layout);
    wrongCount.keyPositions.pop();
    expect(() => validateStageLayout(wrongCount)).toThrow();

    const badJudge = structuredClone(DEFAULT_SKIN.layout);
    badJudge.judgeY = 10;
    expect(() => validateStageLayout(badJudge)).toThrow();
  });

  it('centres every key and every measured judgement slot on its lane', () => {
    const L = DEFAULT_SKIN.layout;
    expect(L.hitBarSlotOffsets).toHaveLength(L.laneCount);
    L.keyPositions.forEach((key, lane) => {
      const laneCenter = L.playX + lane * L.laneWidth + L.laneWidth / 2;
      expect(Math.abs(key.x + key.width / 2 - laneCenter)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(L.hitBar.x + L.hitBarSlotOffsets[lane] - laneCenter)).toBeLessThanOrEqual(1);
    });
    // The slots measured from hitbar0.png share the play_area lane pitch.
    L.hitBarSlotOffsets.forEach((offset, lane) => {
      expect(offset - L.hitBarSlotOffsets[0]).toBeCloseTo(lane * L.laneWidth, 6);
    });
  });

  it('keeps the judgement line in the cavity and the curved keys on the can frame', () => {
    const L = DEFAULT_SKIN.layout;
    const cavity = {
      x: L.canX + L.canCavity.x,
      y: L.canY + L.canCavity.y,
      width: L.canCavity.width,
      height: L.canCavity.height
    };
    for (const key of L.keyPositions) {
      expect(key.x).toBeGreaterThanOrEqual(L.canX);
      expect(key.y).toBeGreaterThanOrEqual(L.canY);
      expect(key.x + key.width).toBeLessThanOrEqual(L.canX + L.canWidth);
      expect(key.y + key.height).toBeLessThanOrEqual(L.canY + L.canHeight);
    }
    expect(L.judgeY).toBeGreaterThanOrEqual(cavity.y);
    expect(L.judgeY).toBeLessThanOrEqual(cavity.y + cavity.height);
  });

  it('keeps the original can background inside the can frame', () => {
    const L = DEFAULT_SKIN.layout;
    expect(L.canBack.x).toBeGreaterThanOrEqual(L.canX);
    expect(L.canBack.y).toBeGreaterThanOrEqual(L.canY);
    expect(L.canBack.x + L.canBack.width).toBeLessThanOrEqual(L.canX + L.canWidth);
    expect(L.canBack.y + L.canBack.height).toBeLessThanOrEqual(L.canY + L.canHeight);
    expect(L.playX - L.canBack.x).toBe(18);
    expect(L.playY - L.canBack.y).toBe(-6);

    const outside = structuredClone(L);
    outside.canBack.x = L.canX - 1;
    expect(() => validateStageLayout(outside)).toThrow();
  });

  it('rejects a key that drifts off its lane or leaves the can frame', () => {
    const offLane = structuredClone(DEFAULT_SKIN.layout);
    offLane.keyPositions[2].x += 3;
    expect(() => validateStageLayout(offLane)).toThrow();

    const outOfCan = structuredClone(DEFAULT_SKIN.layout);
    outOfCan.keyPositions[0].y = 50;
    expect(() => validateStageLayout(outOfCan)).toThrow();

    const straySlot = structuredClone(DEFAULT_SKIN.layout);
    straySlot.hitBar.x += 6;
    expect(() => validateStageLayout(straySlot)).toThrow();
  });
});
