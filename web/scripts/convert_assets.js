/**
 * CanMusic Asset Conversion Tool (convert_assets.js)
 * Converts proprietary 16-bit RGB565 formats (.img, .lle, .ift) to standard PNGs
 * and exports metadata manifest with explicit crop tables and frame definitions.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const REF_IMAGE_DIR = path.join(ROOT_DIR, 'ref', 'CanMusic', 'image');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'public', 'assets', 'classic');

// ==========================================
// 1. Minimal Native PNG Encoder (IHDR + IDAT + IEND with CRC32)
// ==========================================

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + len)), 8 + len);
  return chunk;
}

function encodePNG(width, height, rgbaBuffer) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);  // 8 bits per channel
  ihdr.writeUInt8(6, 9);  // RGBA color type
  ihdr.writeUInt8(0, 10); // Deflate
  ihdr.writeUInt8(0, 11); // Standard filter
  ihdr.writeUInt8(0, 12); // No interlace

  const stride = width * 4;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    scanlines[y * (stride + 1)] = 0; // Filter: None
    rgbaBuffer.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const idat = makePngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 }));
  const iend = makePngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, makePngChunk('IHDR', ihdr), idat, iend]);
}

// ==========================================
// 2. Binary Decoders (vimg, vlle, vifont)
// ==========================================

export function decodeVIMG(buf, relPath = '') {
  if (buf.length < 18) {
    throw new Error(`[${relPath}] File too small for vimg header: ${buf.length} bytes`);
  }
  const magic = buf.subarray(0, 5).toString('ascii');
  if (magic !== 'vimg\0') {
    throw new Error(`[${relPath}] Invalid magic for vimg: "${magic}"`);
  }
  const width = buf.readUInt32LE(5);
  const height = buf.readUInt32LE(9);
  const bpp = buf.readUInt8(13);
  const dataLen = buf.readUInt32LE(14);
  const expectedDataLen = width * height * 2;

  if (dataLen !== expectedDataLen) {
    throw new Error(`[${relPath}] vimg data length mismatch: header ${dataLen} != calculated ${expectedDataLen}`);
  }
  if (!width || !height || buf.length !== 18 + dataLen) {
    throw new Error(`[${relPath}] vimg buffer truncated: actual ${buf.length} < required ${18 + dataLen}`);
  }

  const rgba = Buffer.alloc(width * height * 4);
  let srcPos = 18;
  let dstPos = 0;
  const totalPixels = width * height;

  for (let i = 0; i < totalPixels; i++) {
    const c = buf.readUInt16LE(srcPos);
    srcPos += 2;
    rgba[dstPos] = Math.round(((c >> 11) & 0x1f) * 255 / 31);
    rgba[dstPos + 1] = Math.round(((c >> 5) & 0x3f) * 255 / 63);
    rgba[dstPos + 2] = Math.round((c & 0x1f) * 255 / 31);
    rgba[dstPos + 3] = 255;
    dstPos += 4;
  }

  return {
    format: 'vimg',
    width,
    height,
    bpp,
    dataLen,
    consumedBytes: srcPos - 18,
    rgba
  };
}

export function decodeVLLE(buf, offset = 0, relPath = '') {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid vlle offset');
  if (buf.length < offset + 20) {
    throw new Error(`[${relPath}] File too small for vlle header at offset ${offset}`);
  }
  const magic = buf.subarray(offset, offset + 5).toString('ascii');
  if (magic !== 'vlle\0') {
    throw new Error(`[${relPath}] Invalid magic for vlle at offset ${offset}: "${magic}"`);
  }

  const width = buf.readUInt32LE(offset + 5);
  const height = buf.readUInt32LE(9 + offset);
  const bpp = buf.readUInt8(13 + offset);
  const colorKey = buf.readUInt16LE(14 + offset);
  const dataLen = buf.readUInt32LE(16 + offset);

  if (!width || !height || width * height > 16 * 1024 * 1024 ||
      buf.length !== offset + 20 + dataLen || dataLen < height * 2) {
    throw new Error(`[${relPath}] Invalid vlle dimensions or payload length`);
  }

  const rgba = Buffer.alloc(width * height * 4); // initialized to 0 (fully transparent)
  let pos = offset + 20;

  for (let y = 0; y < height; y++) {
    if (pos + 2 > buf.length) {
      throw new Error(`[${relPath}] Unexpected EOF while reading row flag at row ${y}`);
    }
    const flag = buf.readUInt16LE(pos);
    pos += 2;

    if (flag === 0) {
      // Fully transparent row, skip
      continue;
    } else if (flag === 1) {
      // Solid row of width pixels
      if (pos + width * 2 > buf.length) {
        throw new Error(`[${relPath}] Unexpected EOF in solid row ${y}`);
      }
      for (let x = 0; x < width; x++) {
        const c = buf.readUInt16LE(pos);
        pos += 2;
        if (c === colorKey) continue;
        const idx = (y * width + x) * 4;
        rgba[idx] = Math.round(((c >> 11) & 0x1f) * 255 / 31);
        rgba[idx + 1] = Math.round(((c >> 5) & 0x3f) * 255 / 63);
        rgba[idx + 2] = Math.round((c & 0x1f) * 255 / 31);
        rgba[idx + 3] = 255;
      }
    } else {
      // Span-based row
      const numSpans = flag - 1;
      let curX = 0;

      for (let s = 0; s < numSpans; s++) {
        if (pos + 4 > buf.length) {
          throw new Error(`[${relPath}] Unexpected EOF reading span ${s} header in row ${y}`);
        }
        const skip = buf.readUInt16LE(pos);
        const len = buf.readUInt16LE(pos + 2);
        pos += 4;

        curX += skip;
        if (curX + len > width) {
          throw new Error(
            `[${relPath}] Span overflow at row ${y}, span ${s}: curX(${curX}) + len(${len}) = ${curX + len} > width(${width})`
          );
        }

        if (pos + len * 2 > buf.length) {
          throw new Error(`[${relPath}] Unexpected EOF reading span pixels at row ${y}, span ${s}`);
        }

        for (let i = 0; i < len; i++) {
          const c = buf.readUInt16LE(pos);
          pos += 2;
          if (c === colorKey) continue;
          const idx = (y * width + (curX + i)) * 4;
          rgba[idx] = Math.round(((c >> 11) & 0x1f) * 255 / 31);
          rgba[idx + 1] = Math.round(((c >> 5) & 0x3f) * 255 / 63);
          rgba[idx + 2] = Math.round((c & 0x1f) * 255 / 31);
          rgba[idx + 3] = 255;
        }
        curX += len;
      }
    }
  }

  const consumed = pos - (offset + 20);
  if (consumed !== dataLen) {
    throw new Error(
      `[${relPath}] Byte consumption mismatch in vlle: decoded ${consumed} bytes, header declared ${dataLen} bytes`
    );
  }

  return {
    format: 'vlle',
    width,
    height,
    bpp,
    colorKey,
    colorKeyHex: '0x' + colorKey.toString(16).padStart(4, '0'),
    dataLen,
    consumedBytes: consumed,
    rgba
  };
}

export function decodeVIFONT(buf, relPath = '') {
  if (buf.length < 11 + 20) {
    throw new Error(`[${relPath}] File too small for vifont header: ${buf.length} bytes`);
  }
  const magic = buf.subarray(0, 7).toString('ascii');
  if (magic !== 'vifont\0') {
    throw new Error(`[${relPath}] Invalid magic for vifont: "${magic}"`);
  }

  const charWidth = buf.readUInt8(7);
  const charHeight = buf.readUInt8(8);
  const spacing = buf.readUInt8(9);
  const param4 = buf.readUInt8(10);

  const imageEnd = 31 + buf.readUInt32LE(27);
  const vlleData = decodeVLLE(buf.subarray(0, imageEnd), 11, relPath);

  return {
    ...vlleData,
    format: 'vifont',
    fontMeta: {
      charWidth,
      charHeight,
      spacing,
      param4,
      // Some original fonts (0_EQ.ift) carry additional bytes after the image.
      // Preserve them without guessing their meaning or decoding them as pixels.
      trailingBytesHex: buf.subarray(imageEnd).toString('hex')
    }
  };
}

// ==========================================
// 3. Asset Extraction Manifest Definitions
// ==========================================

const ASSET_TASKS = [
  // Background & Play Area
  { source: 'BG.img', output: 'bg.png', type: 'vimg' },
  { source: 'skin/default/left/play_area.img', output: 'play_area.png', type: 'vimg' },
  { source: 'skin/default/left/canback.lle', output: 'canback.png', type: 'vlle' },
  { source: 'skin/default/left/can.lle', output: 'can.png', type: 'vlle' },
  {
    source: 'skin/default/left/face_map.img',
    output: 'face_map.png',
    type: 'vimg',
    frames: { count: 7, frameWidth: 194, frameHeight: 120, layout: 'vertical' }
  },
  {
    source: 'skin/default/left/face_map2.img',
    output: 'face_map2.png',
    type: 'vimg',
    frames: { count: 7, frameWidth: 194, frameHeight: 120, layout: 'vertical' }
  },

  // Note Skins & Bases
  { source: 'skin/default/left/note_base0.lle', output: 'note_base0.png', type: 'vlle' },
  {
    source: 'skin/default/left/note_skin0.lle',
    output: 'note_skin0.png',
    type: 'vlle',
    frames: { count: 16, frameWidth: 26, frameHeight: 24, layout: 'horizontal' }
  },
  { source: 'skin/default/left/note_base1.lle', output: 'note_base1.png', type: 'vlle' },
  {
    source: 'skin/default/left/note_skin1.lle',
    output: 'note_skin1.png',
    type: 'vlle',
    frames: { count: 16, frameWidth: 26, frameHeight: 12, layout: 'horizontal' }
  },
  { source: 'skin/default/left/Longnote.lle', output: 'longnote.png', type: 'vlle' },

  // Keys & Hitbars
  { source: 'skin/default/left/hitbar0.lle', output: 'hitbar0.png', type: 'vlle' },
  { source: 'skin/default/left/hitbar1.lle', output: 'hitbar1.png', type: 'vlle' },
  { source: 'skin/default/left/key_base.lle', output: 'key_base.png', type: 'vlle' },
  { source: 'skin/default/left/key_normal.lle', output: 'key_normal.png', type: 'vlle' },
  { source: 'skin/default/left/key_put.lle', output: 'key_put.png', type: 'vlle' },
  { source: 'skin/default/left/key_death.lle', output: 'key_death.png', type: 'vlle' },
  { source: 'skin/default/left/bubble_ani0.lle', output: 'bubble_ani0.png', type: 'vlle' },

  // Hit Burst Animations (10 frames each, 80x118)
  { source: 'skin/default/left/hitani0_0.lle', output: 'hitani0_0.png', type: 'vlle', frames: { count: 10, frameWidth: 80, frameHeight: 118, layout: 'horizontal' } },
  { source: 'skin/default/left/hitani0_1.lle', output: 'hitani0_1.png', type: 'vlle', frames: { count: 10, frameWidth: 80, frameHeight: 118, layout: 'horizontal' } },
  { source: 'skin/default/left/hitani0_2.lle', output: 'hitani0_2.png', type: 'vlle', frames: { count: 10, frameWidth: 80, frameHeight: 118, layout: 'horizontal' } },
  { source: 'skin/default/left/hitani0_3.lle', output: 'hitani0_3.png', type: 'vlle', frames: { count: 10, frameWidth: 80, frameHeight: 118, layout: 'horizontal' } },
  { source: 'skin/default/left/hitani0_4.lle', output: 'hitani0_4.png', type: 'vlle', frames: { count: 10, frameWidth: 80, frameHeight: 118, layout: 'horizontal' } },

  { source: 'skin/default/left/hitani1_0.lle', output: 'hitani1_0.png', type: 'vlle', frames: { count: 10, frameWidth: 80, frameHeight: 118, layout: 'horizontal' } },
  { source: 'skin/default/left/hitani1_1.lle', output: 'hitani1_1.png', type: 'vlle', frames: { count: 10, frameWidth: 80, frameHeight: 118, layout: 'horizontal' } },
  { source: 'skin/default/left/hitani1_2.lle', output: 'hitani1_2.png', type: 'vlle', frames: { count: 10, frameWidth: 80, frameHeight: 118, layout: 'horizontal' } },
  { source: 'skin/default/left/hitani1_3.lle', output: 'hitani1_3.png', type: 'vlle', frames: { count: 10, frameWidth: 80, frameHeight: 118, layout: 'horizontal' } },
  { source: 'skin/default/left/hitani1_4.lle', output: 'hitani1_4.png', type: 'vlle', frames: { count: 10, frameWidth: 80, frameHeight: 118, layout: 'horizontal' } },

  { source: 'skin/default/left/hitani_longnote0_0.lle', output: 'hitani_longnote0_0.png', type: 'vlle', frames: { count: 10, frameWidth: 32, frameHeight: 32, layout: 'horizontal' } },
  { source: 'skin/default/left/hitani_longnote1_0.lle', output: 'hitani_longnote1_0.png', type: 'vlle', frames: { count: 10, frameWidth: 28, frameHeight: 28, layout: 'horizontal' } },

  // Stage Characters
  { source: 'star/Wingky_Pink_L0.lle', output: 'wingky_pink_l0.png', type: 'vlle', frames: { count: 13, frameWidth: 76, frameHeight: 50, layout: 'vertical' } },
  { source: 'star/Wingky_Pink_L1.lle', output: 'wingky_pink_l1.png', type: 'vlle', frames: { count: 20, frameWidth: 36, frameHeight: 26, layout: 'vertical' } },
  { source: 'star/Wingky_Blue_L0.lle', output: 'wingky_blue_l0.png', type: 'vlle', frames: { count: 13, frameWidth: 76, frameHeight: 50, layout: 'vertical' } },
  { source: 'star/Wingky_Blue_L1.lle', output: 'wingky_blue_l1.png', type: 'vlle', frames: { count: 20, frameWidth: 36, frameHeight: 26, layout: 'vertical' } },
  { source: 'star/star.lle', output: 'star.png', type: 'vlle', frames: { count: 64, frameWidth: 122, frameHeight: 114, layout: 'vertical' } },
  { source: 'star/chn.lle', output: 'chn.png', type: 'vlle', frames: { count: 18, frameWidth: 122, frameHeight: 114, layout: 'vertical' } },

  // Result and Fonts
  {
    source: 'Result/result.lle',
    output: 'result.png',
    type: 'vlle',
    crops: {
      title_result: { x: 0, y: 211, width: 160, height: 47 },
      title_clear: { x: 14, y: 258, width: 133, height: 46 },
      title_failed: { x: 168, y: 258, width: 144, height: 46 },
      heart_0: { x: 21, y: 134, width: 64, height: 54 },
      heart_1: { x: 122, y: 129, width: 74, height: 64 },
      heart_2: { x: 222, y: 123, width: 86, height: 76 },
      heart_3: { x: 323, y: 119, width: 96, height: 86 },
      heart_4: { x: 424, y: 116, width: 111, height: 99 },
      panel_main: { x: 529, y: 0, width: 103, height: 94 },
      panel_score_line: { x: 529, y: 0, width: 100, height: 46 },
      panel_ratio_line: { x: 529, y: 48, width: 103, height: 46 },
      badge_2x: { x: 371, y: 462, width: 48, height: 51 },
      badge_3x: { x: 419, y: 462, width: 48, height: 51 },
      badge_4x: { x: 467, y: 462, width: 47, height: 51 },
      badge_100x: { x: 514, y: 462, width: 48, height: 51 }
    }
  },
  {
    source: 'Result/message.lle',
    output: 'message.png',
    type: 'vlle',
    crops: {
      block_0: { x: 10, y: 7, width: 174, height: 66 },
      block_1: { x: 1, y: 88, width: 192, height: 67 },
      block_2: { x: 4, y: 169, width: 187, height: 74 },
      block_3: { x: 10, y: 246, width: 173, height: 81 },
      block_4: { x: 2, y: 333, width: 190, height: 75 },
      block_5: { x: 48, y: 412, width: 101, height: 30 },
      block_6: { x: 27, y: 448, width: 141, height: 42 },
      block_7: { x: 20, y: 494, width: 157, height: 27 },
      block_8: { x: 2, y: 525, width: 190, height: 39 },
      block_9: { x: 36, y: 576, width: 124, height: 38 },
      block_10: { x: 3, y: 617, width: 190, height: 35 },
      block_11: { x: 6, y: 660, width: 183, height: 76 },
      block_12: { x: 6, y: 741, width: 180, height: 78 },
      block_13: { x: 10, y: 821, width: 176, height: 80 },
      block_14: { x: 27, y: 940, width: 135, height: 31 },
      block_15: { x: 35, y: 1022, width: 119, height: 31 },
      block_16: { x: 32, y: 1104, width: 128, height: 33 }
    }
  },
  { source: 'Result/0_Score.ift', output: 'score_font.png', type: 'vifont' },
  { source: 'Result/0_Ratio.ift', output: 'ratio_font.png', type: 'vifont' },
  { source: 'Result/0_EQ.ift', output: 'eq_font.png', type: 'vifont' },
  { source: 'Result/Heart.ift', output: 'heart_font.png', type: 'vifont' },
  { source: 'skin/default/combo.ift', output: 'combo_font.png', type: 'vifont' }
];

// ==========================================
// 4. Note Base + Skin Pre-compositor
// ==========================================

function composeNotes(baseRgba, baseW, baseH, skinRgba, skinW, skinH, numFrames = 16) {
  const frameW = skinW / numFrames;
  if (baseW !== frameW || baseH !== skinH) {
    throw new Error(`Dimension mismatch in composeNotes: base (${baseW}x${baseH}) vs skin frame (${frameW}x${skinH})`);
  }
  const outRgba = Buffer.alloc(skinW * skinH * 4);

  for (let f = 0; f < numFrames; f++) {
    const frameOffsetX = f * frameW;
    for (let y = 0; y < skinH; y++) {
      for (let x = 0; x < frameW; x++) {
        const outIdx = (y * skinW + (frameOffsetX + x)) * 4;
        const baseIdx = (y * baseW + x) * 4;
        const skinIdx = (y * skinW + (frameOffsetX + x)) * 4;

        const baseAlpha = baseRgba[baseIdx + 3];
        const skinAlpha = skinRgba[skinIdx + 3];

        if (skinAlpha > 0) {
          outRgba[outIdx] = skinRgba[skinIdx];
          outRgba[outIdx + 1] = skinRgba[skinIdx + 1];
          outRgba[outIdx + 2] = skinRgba[skinIdx + 2];
          outRgba[outIdx + 3] = skinAlpha;
        } else if (baseAlpha > 0) {
          outRgba[outIdx] = baseRgba[baseIdx];
          outRgba[outIdx + 1] = baseRgba[baseIdx + 1];
          outRgba[outIdx + 2] = baseRgba[baseIdx + 2];
          outRgba[outIdx + 3] = baseAlpha;
        }
      }
    }
  }
  return outRgba;
}

// ==========================================
// 5. Contact Sheet Generator for Visual Inspection
// ==========================================

function createContactSheet(items, sheetWidth = 800) {
  let totalHeight = 20;
  for (const item of items) {
    totalHeight += item.height + 24;
  }
  const sheetRgba = Buffer.alloc(sheetWidth * totalHeight * 4);
  for (let i = 0; i < sheetRgba.length; i += 4) sheetRgba.set([24, 24, 24, 255], i);

  let curY = 10;
  for (const item of items) {
    const drawX = Math.max(10, Math.floor((sheetWidth - item.width) / 2));
    for (let y = 0; y < item.height; y++) {
      for (let x = 0; x < item.width; x++) {
        const srcIdx = (y * item.width + x) * 4;
        const alpha = item.rgba[srcIdx + 3];
        if (alpha > 0) {
          const dstIdx = ((curY + y) * sheetWidth + (drawX + x)) * 4;
          sheetRgba[dstIdx] = item.rgba[srcIdx];
          sheetRgba[dstIdx + 1] = item.rgba[srcIdx + 1];
          sheetRgba[dstIdx + 2] = item.rgba[srcIdx + 2];
          sheetRgba[dstIdx + 3] = 255;
        }
      }
    }
    curY += item.height + 24;
  }
  return { width: sheetWidth, height: totalHeight, rgba: sheetRgba };
}

// ==========================================
// 6. Main Execution Pipeline
// ==========================================

export async function convertAllAssets() {
  console.log('--- Starting MeowCan Asset Extraction (P0) ---');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const manifest = {
    version: '1.0.0',
    sourceRoot: 'ref/CanMusic/image',
    destination: 'web/public/assets/classic',
    assets: {},
    compositeNotes: {},
    contactSheets: []
  };

  const decodedCache = new Map();
  let successCount = 0;

  for (const task of ASSET_TASKS) {
    const inputPath = path.join(REF_IMAGE_DIR, task.source);
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Source file not found: ${inputPath}`);
    }

    const buf = fs.readFileSync(inputPath);
    let decoded;

    if (task.type === 'vimg') {
      decoded = decodeVIMG(buf, task.source);
    } else if (task.type === 'vlle') {
      decoded = decodeVLLE(buf, 0, task.source);
    } else if (task.type === 'vifont') {
      decoded = decodeVIFONT(buf, task.source);
    } else {
      throw new Error(`Unknown type: ${task.type}`);
    }

    decodedCache.set(task.output, decoded);

    // Save PNG
    const pngBuf = encodePNG(decoded.width, decoded.height, decoded.rgba);
    const outputPath = path.join(OUTPUT_DIR, task.output);
    fs.writeFileSync(outputPath, pngBuf);

    // Build frame list if applicable
    let frameList = [];
    if (task.frames) {
      const { count, frameWidth, frameHeight, layout } = task.frames;
      for (let f = 0; f < count; f++) {
        frameList.push({
          index: f,
          x: layout === 'horizontal' ? f * frameWidth : 0,
          y: layout === 'vertical' ? f * frameHeight : 0,
          width: frameWidth,
          height: frameHeight
        });
      }
    }

    manifest.assets[task.output] = {
      source: task.source,
      output: task.output,
      format: task.type,
      width: decoded.width,
      height: decoded.height,
      bpp: decoded.bpp,
      colorKey: decoded.colorKeyHex || null,
      fontMeta: decoded.fontMeta || null,
      frames: frameList.length > 0 ? frameList : null,
      crops: task.crops || null
    };

    for (const rect of [...frameList, ...Object.values(task.crops || {})]) {
      if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 ||
          rect.x + rect.width > decoded.width || rect.y + rect.height > decoded.height) {
        throw new Error(`Invalid frame/crop: ${task.output} ${JSON.stringify(rect)}`);
      }
    }

    successCount++;
    console.log(`[OK] ${task.source} -> ${task.output} (${decoded.width}x${decoded.height})`);
  }

  // Pre-compose Note Base + Skins
  console.log('--- Composing Note Base + Skin Combinations ---');
  const base0 = decodedCache.get('note_base0.png');
  const skin0 = decodedCache.get('note_skin0.png');
  const comp0Rgba = composeNotes(base0.rgba, base0.width, base0.height, skin0.rgba, skin0.width, skin0.height, 16);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'note_composed0.png'), encodePNG(skin0.width, skin0.height, comp0Rgba));
  manifest.compositeNotes['note_composed0.png'] = {
    base: 'note_base0.png',
    skin: 'note_skin0.png',
    width: skin0.width,
    height: skin0.height,
    frames: 16,
    frameWidth: 26,
    frameHeight: 24
  };

  const base1 = decodedCache.get('note_base1.png');
  const skin1 = decodedCache.get('note_skin1.png');
  const comp1Rgba = composeNotes(base1.rgba, base1.width, base1.height, skin1.rgba, skin1.width, skin1.height, 16);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'note_composed1.png'), encodePNG(skin1.width, skin1.height, comp1Rgba));
  manifest.compositeNotes['note_composed1.png'] = {
    base: 'note_base1.png',
    skin: 'note_skin1.png',
    width: skin1.width,
    height: skin1.height,
    frames: 16,
    frameWidth: 26,
    frameHeight: 12
  };
  console.log('[OK] Generated note_composed0.png (416x24) & note_composed1.png (416x12)');

  // Contact Sheet for Quick Overview
  console.log('--- Generating Overview Contact Sheets ---');
  const sampleItems = [
    { width: 26, height: 24, rgba: base0.rgba },
    { width: skin0.width, height: skin0.height, rgba: comp0Rgba },
    { width: 26, height: 12, rgba: base1.rgba },
    { width: skin1.width, height: skin1.height, rgba: comp1Rgba },
    { width: decodedCache.get('can.png').width, height: decodedCache.get('can.png').height, rgba: decodedCache.get('can.png').rgba },
    { width: decodedCache.get('combo_font.png').width, height: decodedCache.get('combo_font.png').height, rgba: decodedCache.get('combo_font.png').rgba },
    { width: decodedCache.get('score_font.png').width, height: decodedCache.get('score_font.png').height, rgba: decodedCache.get('score_font.png').rgba }
  ];
  const sheet = createContactSheet(sampleItems, 800);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'contact_sheet_overview.png'), encodePNG(sheet.width, sheet.height, sheet.rgba));
  manifest.contactSheets.push('contact_sheet_overview.png');
  // One labelled, native-size contact sheet per atlas; embed pixels for offline use.
  for (const [name, meta] of Object.entries(manifest.assets)) {
    const source = decodedCache.get(name);
    const entries = meta.frames?.map(r => [`frame ${r.index}`, r]) ??
      (meta.crops ? Object.entries(meta.crops) : [['full', { x: 0, y: 0, width: meta.width, height: meta.height }]]);
    let y = 0;
    const parts = [];
    for (const [label, r] of entries) {
      const pixels = Buffer.alloc(r.width * r.height * 4);
      for (let row = 0; row < r.height; row++) {
        const start = ((r.y + row) * source.width + r.x) * 4;
        source.rgba.copy(pixels, row * r.width * 4, start, start + r.width * 4);
      }
      parts.push(`<text x="8" y="${y + 16}" fill="white" font-family="monospace" font-size="12">${name} / ${label}</text><image x="8" y="${y + 24}" width="${r.width}" height="${r.height}" href="data:image/png;base64,${encodePNG(r.width, r.height, pixels).toString('base64')}"/>`);
      y += r.height + 36;
    }
    const filename = `contact_${name.replace('.png', '.svg')}`;
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(360, meta.width + 16)}" height="${y}"><rect width="100%" height="100%" fill="#181818"/>${parts.join('')}</svg>`);
    manifest.contactSheets.push(filename);
  }
  console.log('[OK] Generated contact_sheet_overview.png');

  // Save Manifest JSON
  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`[OK] Saved manifest metadata to ${manifestPath}`);

  console.log(`--- Finished: ${successCount} assets converted successfully, 100% verified ---`);
}

// Run directly when executed as a script
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  convertAllAssets().catch((err) => {
    console.error('Fatal conversion error:', err);
    process.exit(1);
  });
}
