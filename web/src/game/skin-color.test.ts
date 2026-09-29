import { expect, test } from 'bun:test';
import { adjustSkinPixels, normalizeSkinColor } from './skin-color';

test('original brightness extremes preserve alpha and darken only adjusted pixels', () => {
  const pixels = new Uint8ClampedArray([220, 80, 40, 255, 70, 140, 200, 0]);
  adjustSkinPixels(pixels, { hue: 0, saturation: 0, brightness: -100 });
  expect([...pixels]).toEqual([0, 0, 0, 255, 70, 140, 200, 0]);
});

test('saturation and hue use bounded signed adjustments', () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
  adjustSkinPixels(pixels, { hue: 120, saturation: 0, brightness: 0 });
  expect([...pixels]).toEqual([0, 255, 0, 255]);
  expect(normalizeSkinColor({ hue: 999, saturation: -999, brightness: Number.NaN }))
    .toEqual({ hue: 180, saturation: -100, brightness: 0 });
});
