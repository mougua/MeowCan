/**
 * MeowCan Chart Long Image Generator (generate_charts.ts)
 * Generates full-song chart strips (长图) using the authentic metallic skin
 * and saves them to web/public/charts/
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVos, type VosSongData } from '../src/parser/vos';
import {
  CHART_HEADER_HEIGHT,
  CHART_PPQ,
  chartYForTick,
  createChartLayout,
  noteEndTick,
  noteStartTick
} from '../src/game/chart-layout';
import { decodeVIMG, decodeVLLE, encodePNG } from './convert_assets.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const sourceDir = path.resolve(rootDir, '..', 'ref', 'CanMusic', 'image', 'skin', 'METALiC', 'left');
const songsDir = path.resolve(rootDir, 'public', 'songs');
const outputDir = path.resolve(rootDir, 'public', 'charts');

// 5x7 Bitmap Font definitions for ASCII 32-126
// Each character is 5 columns of 7-bit values (LSB at top, MSB at bottom).
const FONT_5X7: Record<string, number[]> = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  '!': [0x00, 0x00, 0x5f, 0x00, 0x00],
  '"': [0x00, 0x07, 0x00, 0x07, 0x00],
  '#': [0x14, 0x7f, 0x14, 0x7f, 0x14],
  '$': [0x24, 0x2a, 0x7f, 0x2a, 0x12],
  '%': [0x23, 0x13, 0x08, 0x64, 0x62],
  '&': [0x36, 0x49, 0x55, 0x22, 0x50],
  '\'': [0x00, 0x05, 0x03, 0x00, 0x00],
  '(': [0x00, 0x1c, 0x22, 0x41, 0x00],
  ')': [0x00, 0x41, 0x22, 0x1c, 0x00],
  '*': [0x14, 0x08, 0x3e, 0x08, 0x14],
  '+': [0x08, 0x08, 0x3e, 0x08, 0x08],
  ',': [0x00, 0x50, 0x30, 0x00, 0x00],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '.': [0x00, 0x60, 0x60, 0x00, 0x00],
  '/': [0x20, 0x10, 0x08, 0x04, 0x02],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  ':': [0x00, 0x36, 0x36, 0x00, 0x00],
  ';': [0x00, 0x56, 0x36, 0x00, 0x00],
  '<': [0x08, 0x14, 0x22, 0x41, 0x00],
  '=': [0x14, 0x14, 0x14, 0x14, 0x14],
  '>': [0x00, 0x41, 0x22, 0x14, 0x08],
  '?': [0x02, 0x01, 0x51, 0x09, 0x06],
  '@': [0x32, 0x49, 0x79, 0x41, 0x3e],
  'A': [0x7e, 0x11, 0x11, 0x11, 0x7e],
  'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
  'C': [0x3e, 0x41, 0x41, 0x41, 0x22],
  'D': [0x7f, 0x41, 0x41, 0x22, 0x1c],
  'E': [0x7f, 0x49, 0x49, 0x49, 0x41],
  'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
  'G': [0x3e, 0x41, 0x49, 0x49, 0x7a],
  'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
  'I': [0x00, 0x41, 0x7f, 0x41, 0x00],
  'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
  'K': [0x7f, 0x08, 0x14, 0x22, 0x41],
  'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
  'M': [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  'N': [0x7f, 0x04, 0x08, 0x10, 0x7f],
  'O': [0x3e, 0x41, 0x41, 0x41, 0x3e],
  'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
  'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e],
  'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
  'S': [0x46, 0x49, 0x49, 0x49, 0x31],
  'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
  'U': [0x3f, 0x40, 0x40, 0x40, 0x3f],
  'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
  'W': [0x3f, 0x40, 0x38, 0x40, 0x3f],
  'X': [0x63, 0x14, 0x08, 0x14, 0x63],
  'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
  'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
  '[': [0x00, 0x7f, 0x41, 0x41, 0x00],
  '\\': [0x02, 0x04, 0x08, 0x10, 0x20],
  ']': [0x00, 0x41, 0x41, 0x7f, 0x00],
  '^': [0x04, 0x02, 0x01, 0x02, 0x04],
  '_': [0x40, 0x40, 0x40, 0x40, 0x40],
  '`': [0x00, 0x01, 0x02, 0x04, 0x00],
  'a': [0x20, 0x54, 0x54, 0x54, 0x78],
  'b': [0x7f, 0x48, 0x44, 0x44, 0x38],
  'c': [0x38, 0x44, 0x44, 0x44, 0x20],
  'd': [0x38, 0x44, 0x44, 0x48, 0x7f],
  'e': [0x38, 0x54, 0x54, 0x54, 0x18],
  'f': [0x08, 0x7e, 0x09, 0x01, 0x02],
  'g': [0x0c, 0x52, 0x52, 0x52, 0x3e],
  'h': [0x7f, 0x08, 0x04, 0x04, 0x78],
  'i': [0x00, 0x44, 0x7d, 0x40, 0x00],
  'j': [0x20, 0x40, 0x44, 0x3d, 0x00],
  'k': [0x7f, 0x10, 0x28, 0x44, 0x00],
  'l': [0x00, 0x41, 0x7f, 0x40, 0x00],
  'm': [0x7c, 0x04, 0x18, 0x04, 0x78],
  'n': [0x7c, 0x08, 0x04, 0x04, 0x78],
  'o': [0x38, 0x44, 0x44, 0x44, 0x38],
  'p': [0x7c, 0x14, 0x14, 0x14, 0x08],
  'q': [0x08, 0x14, 0x14, 0x18, 0x7c],
  'r': [0x7c, 0x08, 0x04, 0x04, 0x08],
  's': [0x48, 0x54, 0x54, 0x54, 0x20],
  't': [0x04, 0x3f, 0x44, 0x40, 0x20],
  'u': [0x3c, 0x40, 0x40, 0x20, 0x7c],
  'v': [0x1c, 0x20, 0x40, 0x20, 0x1c],
  'w': [0x3c, 0x40, 0x30, 0x40, 0x3c],
  'x': [0x44, 0x28, 0x10, 0x28, 0x44],
  'y': [0x0c, 0x50, 0x50, 0x50, 0x3c],
  'z': [0x44, 0x64, 0x54, 0x4c, 0x44],
  '|': [0x00, 0x00, 0x7f, 0x00, 0x00],
  '~': [0x08, 0x04, 0x08, 0x10, 0x08]
};

function drawText(
  buf: Buffer,
  bufWidth: number,
  bufHeight: number,
  x: number,
  y: number,
  text: string,
  r: number,
  g: number,
  b: number,
  a = 255
): void {
  let curX = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const cols = FONT_5X7[ch] ?? FONT_5X7['?'] ?? [0x00, 0x00, 0x00, 0x00, 0x00];
    for (let c = 0; c < 5; c++) {
      const px = curX + c;
      if (px < 0 || px >= bufWidth) continue;
      const colBits = cols[c];
      for (let rBit = 0; rBit < 7; rBit++) {
        const py = y + rBit;
        if (py < 0 || py >= bufHeight) continue;
        if ((colBits & (1 << rBit)) !== 0) {
          const idx = (py * bufWidth + px) * 4;
          buf[idx] = r;
          buf[idx + 1] = g;
          buf[idx + 2] = b;
          buf[idx + 3] = a;
        }
      }
    }
    curX += 6; // 5 px width + 1 px space
  }
}

// Composition function for note sprites
function compose(base: any, skin: any, frames = 16) {
  const frameWidth = skin.width / frames;
  const rgba = Buffer.alloc(skin.width * skin.height * 4);
  for (let frame = 0; frame < frames; frame++) {
    for (let y = 0; y < skin.height; y++) {
      for (let x = 0; x < frameWidth; x++) {
        const out = (y * skin.width + frame * frameWidth + x) * 4;
        const b = (y * base.width + x) * 4;
        const s = (y * skin.width + frame * frameWidth + x) * 4;
        const source = skin.rgba[s + 3] ? skin.rgba.subarray(s, s + 4) : base.rgba.subarray(b, b + 4);
        source.copy(rgba, out);
      }
    }
  }
  return { width: skin.width, height: skin.height, rgba };
}

export function generateChartImage(vos: VosSongData): Buffer {
  // Load metallic textures
  const playArea = decodeVIMG(fs.readFileSync(path.join(sourceDir, 'play_area.img')));
  const noteBase0 = decodeVLLE(fs.readFileSync(path.join(sourceDir, 'note_base0.lle')));
  const noteSkin0 = decodeVLLE(fs.readFileSync(path.join(sourceDir, 'note_skin0.lle')));
  const longNote = decodeVLLE(fs.readFileSync(path.join(sourceDir, 'Longnote.lle')));
  const composedNote = compose(noteBase0, noteSkin0);

  const laneColors = [3, 8, 1, 0, 1, 8, 3];
  const layout = createChartLayout(vos);
  const { beatHeight, lastTick, totalHeight, trackTop, trackBottom } = layout;

  // Width: Left margin 44px (measure & time) + 198px play area + 4px right border = 246px
  const totalWidth = 246;
  const trackStartX = 44;

  const canvasBuffer = Buffer.alloc(totalWidth * totalHeight * 4);

  // 1. Fill base background with dark metal #0c1521
  for (let i = 0; i < totalWidth * totalHeight; i++) {
    const idx = i * 4;
    canvasBuffer[idx] = 12;
    canvasBuffer[idx + 1] = 21;
    canvasBuffer[idx + 2] = 33;
    canvasBuffer[idx + 3] = 255;
  }

  // 2. Draw Header Area (y = 0..63)
  for (let y = 0; y < CHART_HEADER_HEIGHT; y++) {
    const grad = Math.round(18 + (y / CHART_HEADER_HEIGHT) * 12);
    for (let x = 0; x < totalWidth; x++) {
      const idx = (y * totalWidth + x) * 4;
      canvasBuffer[idx] = grad;
      canvasBuffer[idx + 1] = grad + 8;
      canvasBuffer[idx + 2] = grad + 18;
    }
  }
  // Header bottom border
  for (let x = 0; x < totalWidth; x++) {
    const idx = ((CHART_HEADER_HEIGHT - 1) * totalWidth + x) * 4;
    canvasBuffer[idx] = 53;
    canvasBuffer[idx + 1] = 215;
    canvasBuffer[idx + 2] = 255;
  }

  // Header texts
  const titleDisplay = (vos.title || 'Untitled').slice(0, 32);
  const artistDisplay = (vos.artist || 'Unknown').slice(0, 24);
  const charterDisplay = vos.arranger ? ` / ${vos.arranger.slice(0, 16)}` : '';
  drawText(canvasBuffer, totalWidth, totalHeight, 10, 10, titleDisplay, 234, 246, 255);
  drawText(canvasBuffer, totalWidth, totalHeight, 10, 24, `${artistDisplay}${charterDisplay}`, 140, 163, 186);
  drawText(canvasBuffer, totalWidth, totalHeight, 10, 38, `LV.${vos.level}  NOTES:${vos.playableNotes.length}  BPM:${Math.round(vos.bpm || 120)}`, 53, 215, 255);
  drawText(canvasBuffer, totalWidth, totalHeight, 10, 50, `TIME: ${Math.floor(vos.durationSec / 60)}:${String(Math.round(vos.durationSec % 60)).padStart(2, '0')}`, 140, 163, 186);

  // 3. Tile play area (y = headerHeight to totalHeight - footerHeight)
  const playRegionTop = 46;
  const playRegionHeight = 334;
  for (let y = trackTop; y < trackBottom; y++) {
    const srcY = playRegionTop + ((y - trackTop) % playRegionHeight);
    const srcRowOffset = srcY * playArea.width * 4;
    const dstRowOffset = (y * totalWidth + trackStartX) * 4;
    playArea.rgba.copy(canvasBuffer, dstRowOffset, srcRowOffset, srcRowOffset + playArea.width * 4);
  }

  // 4. Draw Beat and Measure Lines
  const totalQuarters = lastTick / CHART_PPQ;
  for (let q = 0; q <= totalQuarters; q++) {
    const y = chartYForTick(q * CHART_PPQ, layout);
    const isBar = q % 4 === 0;
    const r = isBar ? 53 : 34;
    const g = isBar ? 215 : 61;
    const b = isBar ? 255 : 89;
    const a = isBar ? 200 : 90;

    // Draw horizontal line across the 7 lanes
    for (let x = trackStartX; x < trackStartX + 198; x++) {
      const idx = (y * totalWidth + x) * 4;
      canvasBuffer[idx] = Math.round((r * a + canvasBuffer[idx] * (255 - a)) / 255);
      canvasBuffer[idx + 1] = Math.round((g * a + canvasBuffer[idx + 1] * (255 - a)) / 255);
      canvasBuffer[idx + 2] = Math.round((b * a + canvasBuffer[idx + 2] * (255 - a)) / 255);
    }

    // Draw measure number in the left margin
    if (isBar) {
      const barNum = Math.floor(q / 4) + 1;
      const barStr = `[${String(barNum).padStart(3, '0')}]`;
      drawText(canvasBuffer, totalWidth, totalHeight, 4, y - 4, barStr, 53, 215, 255);
    }
  }

  // 5. Draw Notes (Sorted by tick)
  const sortedNotes = [...vos.playableNotes].sort((a, b) => noteStartTick(b, vos) - noteStartTick(a, vos));

  for (const note of sortedNotes) {
    const lane = Math.max(0, Math.min(6, note.lane));
    const colorIdx = laneColors[lane];
    const noteX = trackStartX + lane * 28 + 1;
    const startY = chartYForTick(noteStartTick(note, vos), layout);

    if (note.isLong) {
      const endY = chartYForTick(noteEndTick(note, vos), layout);
      const bodyX = trackStartX + lane * 28 + 2;
      const bodySrcY = colorIdx * 12 + 6;
      const bodySrcOffset = (bodySrcY * longNote.width + 0) * 4;

      // Draw long note body (24px wide)
      for (let by = endY - 6; by <= startY - 6; by++) {
        if (by < trackTop || by >= trackBottom) continue;
        for (let bx = 0; bx < 24; bx++) {
          const sIdx = bodySrcOffset + bx * 4;
          const dIdx = (by * totalWidth + bodyX + bx) * 4;
          if (longNote.rgba[sIdx + 3] > 0) {
            canvasBuffer[dIdx] = longNote.rgba[sIdx];
            canvasBuffer[dIdx + 1] = longNote.rgba[sIdx + 1];
            canvasBuffer[dIdx + 2] = longNote.rgba[sIdx + 2];
            canvasBuffer[dIdx + 3] = 255;
          }
        }
      }

      // Draw long note head & tail caps (24x12)
      const headSrcY = colorIdx * 12;
      for (let cy = 0; cy < 12; cy++) {
        for (let cx = 0; cx < 24; cx++) {
          const sIdx = ((headSrcY + cy) * longNote.width + cx) * 4;
          if (longNote.rgba[sIdx + 3] > 0) {
            const dy = startY - 12 + cy;
            if (dy >= trackTop && dy < trackBottom) {
              const dIdx = (dy * totalWidth + bodyX + cx) * 4;
              canvasBuffer[dIdx] = longNote.rgba[sIdx];
              canvasBuffer[dIdx + 1] = longNote.rgba[sIdx + 1];
              canvasBuffer[dIdx + 2] = longNote.rgba[sIdx + 2];
              canvasBuffer[dIdx + 3] = 255;
            }
            const ty = endY - 12 + cy;
            if (ty >= trackTop && ty < trackBottom) {
              const dIdx = (ty * totalWidth + bodyX + cx) * 4;
              canvasBuffer[dIdx] = longNote.rgba[sIdx];
              canvasBuffer[dIdx + 1] = longNote.rgba[sIdx + 1];
              canvasBuffer[dIdx + 2] = longNote.rgba[sIdx + 2];
              canvasBuffer[dIdx + 3] = 255;
            }
          }
        }
      }
    } else {
      // Short note (26x8)
      const srcX = colorIdx * 26;
      for (let ny = 0; ny < 8; ny++) {
        const dy = startY - 8 + ny;
        if (dy < trackTop || dy >= trackBottom) continue;
        for (let nx = 0; nx < 26; nx++) {
          const sIdx = (ny * composedNote.width + srcX + nx) * 4;
          if (composedNote.rgba[sIdx + 3] > 0) {
            const dIdx = (dy * totalWidth + noteX + nx) * 4;
            canvasBuffer[dIdx] = composedNote.rgba[sIdx];
            canvasBuffer[dIdx + 1] = composedNote.rgba[sIdx + 1];
            canvasBuffer[dIdx + 2] = composedNote.rgba[sIdx + 2];
            canvasBuffer[dIdx + 3] = 255;
          }
        }
      }
    }
  }

  // 6. Draw Footer Area (totalHeight - footerHeight .. totalHeight)
  const footerY = trackBottom;
  for (let y = footerY; y < totalHeight; y++) {
    for (let x = 0; x < totalWidth; x++) {
      const idx = (y * totalWidth + x) * 4;
      canvasBuffer[idx] = 10;
      canvasBuffer[idx + 1] = 16;
      canvasBuffer[idx + 2] = 25;
    }
  }
  for (let x = 0; x < totalWidth; x++) {
    const idx = (footerY * totalWidth + x) * 4;
    canvasBuffer[idx] = 40;
    canvasBuffer[idx + 1] = 60;
    canvasBuffer[idx + 2] = 80;
  }
  drawText(canvasBuffer, totalWidth, totalHeight, 20, footerY + 10, 'START ^  MEOWCAN 7-KEY VOS CHART', 80, 110, 140);

  return encodePNG(totalWidth, totalHeight, canvasBuffer);
}

// CLI Execution: Process all songs in public/songs/
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const songFiles = fs.readdirSync(songsDir).filter(f => f.toLowerCase().endsWith('.vos'));
  console.log(`Found ${songFiles.length} VOS files in ${songsDir}`);

  let successCount = 0;
  for (const file of songFiles) {
    const filePath = path.join(songsDir, file);
    try {
      const buf = fs.readFileSync(filePath);
      const arr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const vos = parseVos(arr);
      const pngBuffer = generateChartImage(vos);

      const outName = `${file}.png`;
      const outPath = path.join(outputDir, outName);
      fs.writeFileSync(outPath, pngBuffer);
      console.log(`[OK] Generated ${outName} (${(pngBuffer.length / 1024).toFixed(1)} KB) - ${vos.title}`);
      successCount++;
    } catch (err) {
      console.error(`[FAIL] Error generating chart for ${file}:`, err);
    }
  }

  console.log(`Done! Successfully generated ${successCount}/${songFiles.length} charts in ${outputDir}`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('generate_charts.ts')) {
  main().catch(console.error);
}
