export interface SkinColorAdjustment {
  hue: number;
  saturation: number;
  brightness: number;
}

export const DEFAULT_SKIN_COLOR: SkinColorAdjustment = Object.freeze({
  hue: 0, saturation: 0, brightness: 0
});

export function normalizeSkinColor(value: Partial<SkinColorAdjustment>): SkinColorAdjustment {
  const limit = (input: number | undefined, min: number, max: number) =>
    Number.isFinite(input) ? Math.max(min, Math.min(max, Math.trunc(input!))) : 0;
  return {
    hue: limit(value.hue, -180, 180),
    saturation: limit(value.saturation, -100, 100),
    brightness: limit(value.brightness, -100, 100)
  };
}

/** The original DLL moves S and V toward 0 or 255 by a signed percentage. */
export function adjustSkinPixels(data: Uint8ClampedArray, color: SkinColorAdjustment): void {
  const { hue, saturation, brightness } = color;
  if (!hue && !saturation && !brightness) return;
  if (!hue && !saturation) {
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      if (!max) {
        const gray = Math.max(0, Math.trunc(brightness * 255 / 100));
        data[i] = data[i + 1] = data[i + 2] = gray;
        continue;
      }
      const value = Math.max(0, Math.min(255,
        max + Math.trunc((brightness >= 0 ? 255 - max : max) * brightness / 100)));
      const scale = value / max;
      data[i] *= scale;
      data[i + 1] *= scale;
      data[i + 2] *= scale;
    }
    return;
  }
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta) {
      if (max === r) h = 60 * ((g - b) / delta);
      else if (max === g) h = 60 * ((b - r) / delta + 2);
      else h = 60 * ((r - g) / delta + 4);
    }
    h = ((h + hue) % 360 + 360) % 360;
    let s = max ? Math.trunc(delta * 255 / max) : 0;
    let v = max;
    s = Math.max(0, Math.min(255, s + Math.trunc((saturation >= 0 ? 255 - s : s) * saturation / 100)));
    v = Math.max(0, Math.min(255, v + Math.trunc((brightness >= 0 ? 255 - v : v) * brightness / 100)));
    const chroma = v * s / 255;
    const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - chroma;
    const sector = Math.floor(h / 60);
    const rgb = sector === 0 ? [chroma, x, 0] : sector === 1 ? [x, chroma, 0]
      : sector === 2 ? [0, chroma, x] : sector === 3 ? [0, x, chroma]
      : sector === 4 ? [x, 0, chroma] : [chroma, 0, x];
    data[i] = rgb[0] + m;
    data[i + 1] = rgb[1] + m;
    data[i + 2] = rgb[2] + m;
  }
}
