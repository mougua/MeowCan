import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { decodeVIMG, decodeVLLE, decodeVIFONT } from './convert_assets.js';

const original = (file: string) => readFileSync(new URL(`../../ref/CanMusic/image/${file}`, import.meta.url));
const originalAssetTest = existsSync(new URL('../../ref/CanMusic/image', import.meta.url)) ? it : it.skip;

describe('native asset decoding', () => {
  originalAssetTest('rejects truncated, trailing and incorrectly signed image payloads', () => {
    for (const [file, decode] of [
      ['skin/default/left/play_area.img', decodeVIMG],
      ['skin/default/left/note_base1.lle', decodeVLLE],
    ] as const) {
      const valid = original(file);
      expect(() => decode(valid)).not.toThrow();
      expect(() => decode(valid.subarray(0, -1))).toThrow();
      expect(() => decode(Buffer.concat([valid, Buffer.from([0])]))).toThrow();
      const badMagic = Buffer.from(valid);
      badMagic[4] = 1;
      expect(() => decode(badMagic)).toThrow();
    }
  });

  it('rejects a span crossing the row and a declared payload shorter than its rows', () => {
    const buf = Buffer.alloc(28);
    buf.write('vlle\0');
    buf.writeUInt32LE(1, 5);
    buf.writeUInt32LE(1, 9);
    buf.writeUInt32LE(8, 16);
    buf.writeUInt16LE(2, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt16LE(1, 24);
    expect(() => decodeVLLE(buf)).toThrow('Span overflow');
    buf.writeUInt32LE(2, 16);
    expect(() => decodeVLLE(buf)).toThrow();
  });

  originalAssetTest('retains the font container type and preserves the original EQ trailer', () => {
    const eq = decodeVIFONT(original('Result/0_EQ.ift'));
    expect(eq.format).toBe('vifont');
    expect(eq.fontMeta.trailingBytesHex.length / 2).toBe(154);
    expect(eq.consumedBytes).toBe(eq.dataLen);
    expect(eq.rgba.length).toBe(70 * 7 * 4);
  });
});
