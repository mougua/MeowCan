import { describe, expect, it } from 'bun:test';
import { DEFAULT_SKIN, validateSkinCrops, type SkinConfig } from './skin';
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
