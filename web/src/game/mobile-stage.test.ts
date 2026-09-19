import { describe, expect, test } from 'bun:test';
import { Container } from 'pixi.js';
import { MobileStage, type MobileEffectPack, type MobileSkinTheme, DEFAULT_MOBILE_THEME } from './mobile-stage';

describe('touch-first mobile stage', () => {
  test('maps the wide lower touch band to all seven lanes', () => {
    const stage = new MobileStage();
    const centers = [97, 184, 271, 358, 445, 532, 619];
    centers.forEach((x, lane) => expect(stage.hitTest(x, 480)).toBe(lane));
    expect(stage.hitTest(10, 480)).toBe(-1);
    expect(stage.hitTest(358, 300)).toBe(-1);
  });

  test('keeps future effect packs isolated behind the HUD extension seam', () => {
    let mountedParent: Container | undefined;
    const effects: MobileEffectPack = { mount: parent => { mountedParent = parent; } };
    const theme: MobileSkinTheme = { ...DEFAULT_MOBILE_THEME, createEffects: () => effects };
    const stage = new MobileStage(theme);
    expect(mountedParent).toBeInstanceOf(Container);
    expect(mountedParent).not.toBe(stage.container);
  });
});
