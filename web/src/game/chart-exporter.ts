/**
 * MeowCan Chart Exporter (chart-exporter.ts)
 * Exports full song charts as long images (长图) using the metallic skin assets.
 * Supports both direct downloading of pre-generated charts from /charts/
 * and on-the-fly client-side Canvas rendering for custom / dynamically loaded songs.
 */

import type { VosSongData } from '../parser/vos';
import {
  CHART_FOOTER_HEIGHT,
  CHART_HEADER_HEIGHT,
  CHART_PLAY_AREA_SOURCE_Y,
  CHART_PLAY_AREA_WIDTH,
  CHART_PPQ,
  chartYForTick,
  createChartLayout,
  noteEndTick,
  noteStartTick
} from './chart-layout';

export interface ChartExportOptions {
  filename: string;
  song?: VosSongData;
  loadSong?: () => Promise<VosSongData | undefined>;
  title?: string;
  onProgress?: (msg: string) => void;
}

/**
 * Loads an image from a URL and returns an HTMLImageElement
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error(`Failed to load image ${src}: ${err}`));
    img.src = src;
  });
}

/**
 * Renders a full-song chart long image in the browser via Canvas API
 */
export async function renderChartToCanvas(song: VosSongData): Promise<HTMLCanvasElement> {
  // 1. Load metallic skin assets
  const [playAreaImg, noteComposedImg, longNoteImg] = await Promise.all([
    loadImage('/assets/metallic/play_area.png'),
    loadImage('/assets/metallic/note_composed0.png'),
    loadImage('/assets/metallic/longnote.png')
  ]);

  const laneColors = [3, 8, 1, 0, 1, 8, 3];
  const layout = createChartLayout(song);
  const { beatHeight, lastTick, totalHeight, trackTop, trackBottom } = layout;

  // 44px left margin (measure & time) + 198px play area + 4px right margin = 246px
  const totalWidth = 246;
  const trackStartX = 44;

  const canvas = document.createElement('canvas');
  canvas.width = totalWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;

  // 1. Background #0c1521
  ctx.fillStyle = '#0c1521';
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // 2. Header Area
  const headerGrad = ctx.createLinearGradient(0, 0, 0, CHART_HEADER_HEIGHT);
  headerGrad.addColorStop(0, '#111a28');
  headerGrad.addColorStop(1, '#1b293d');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, totalWidth, CHART_HEADER_HEIGHT);

  ctx.strokeStyle = '#35d7ff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, CHART_HEADER_HEIGHT - 0.5);
  ctx.lineTo(totalWidth, CHART_HEADER_HEIGHT - 0.5);
  ctx.stroke();

  // Header Texts
  ctx.fillStyle = '#eaf6ff';
  ctx.font = 'bold 13px system-ui, "Microsoft YaHei", sans-serif';
  const titleDisplay = (song.title || 'Untitled').slice(0, 28);
  ctx.fillText(titleDisplay, 10, 20);

  ctx.fillStyle = '#8ca3ba';
  ctx.font = '10px system-ui, "Microsoft YaHei", sans-serif';
  const artistDisplay = (song.artist || 'Unknown').slice(0, 22);
  const charterDisplay = song.arranger ? ` / ${song.arranger.slice(0, 16)}` : '';
  ctx.fillText(`${artistDisplay}${charterDisplay}`, 10, 35);

  ctx.fillStyle = '#35d7ff';
  ctx.font = 'bold 10px monospace, sans-serif';
  ctx.fillText(`LV.${song.level}  NOTES:${song.playableNotes.length}  BPM:${Math.round(song.bpm || 120)}`, 10, 50);

  ctx.fillStyle = '#7895b2';
  ctx.font = '10px monospace, sans-serif';
  const durMin = Math.floor(song.durationSec / 60);
  const durSec = String(Math.round(song.durationSec % 60)).padStart(2, '0');
  ctx.fillText(`TIME: ${durMin}:${durSec}`, 10, 63);

  // 3. Repeat one horizontal scanline through the full play area. Repeating
  // the original 334px region restarts its vertical gradient at every tile
  // boundary and leaves visible seams in long charts.
  const bottomLimit = trackBottom;
  ctx.drawImage(
    playAreaImg,
    0, CHART_PLAY_AREA_SOURCE_Y, CHART_PLAY_AREA_WIDTH, 1,
    trackStartX, trackTop, CHART_PLAY_AREA_WIDTH, bottomLimit - trackTop
  );

  // 4. Beat and Measure Lines
  const totalQuarters = lastTick / CHART_PPQ;
  ctx.font = '9px monospace';

  for (let q = 0; q <= totalQuarters; q++) {
    const tick = q * CHART_PPQ;
    const y = chartYForTick(tick, layout);
    const isBar = q % 4 === 0;

    ctx.strokeStyle = isBar ? 'rgba(53, 215, 255, 0.75)' : 'rgba(34, 61, 89, 0.45)';
    ctx.lineWidth = isBar ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(trackStartX, y + 0.5);
    ctx.lineTo(trackStartX + CHART_PLAY_AREA_WIDTH, y + 0.5);
    ctx.stroke();

    if (isBar) {
      const barNum = Math.floor(q / 4) + 1;
      ctx.fillStyle = '#35d7ff';
      ctx.fillText(`[${String(barNum).padStart(3, '0')}]`, 6, y + 3);
    }
  }

  // 5. Draw Notes (Sorted by tick)
  const sortedNotes = [...song.playableNotes].sort((a, b) => noteStartTick(b, song) - noteStartTick(a, song));

  for (const note of sortedNotes) {
    const lane = Math.max(0, Math.min(6, note.lane));
    const colorIdx = laneColors[lane];
    const noteX = trackStartX + lane * 28 + 1;
    const startTick = noteStartTick(note, song);
    const startY = chartYForTick(startTick, layout);

    if (note.isLong) {
      const endY = chartYForTick(noteEndTick(note, song), layout);
      const bodyX = trackStartX + lane * 28 + 2;

      // Draw long note body (24px wide)
      // Body scanline in longnote.png: sx=0, sy=colorIdx*12+6, sw=24, sh=1
      const bodyTop = endY - 6;
      const bodyH = Math.max(0, startY - endY);
      if (bodyH > 0 && bodyTop < bottomLimit) {
        ctx.drawImage(
          longNoteImg,
          0, colorIdx * 12 + 6, 24, 1,
          bodyX, bodyTop, 24, Math.min(bodyH, bottomLimit - bodyTop)
        );
      }

      // Draw head cap (24x12)
      if (startY <= bottomLimit) {
        ctx.drawImage(
          longNoteImg,
          0, colorIdx * 12, 24, 12,
          bodyX, startY - 12, 24, 12
        );
      }

      // Draw tail cap (24x12)
      if (endY >= trackTop) {
        ctx.drawImage(
          longNoteImg,
          0, colorIdx * 12, 24, 12,
          bodyX, endY - 12, 24, 12
        );
      }
    } else {
      // Short Note (26x8)
      // Frame in note_composed0.png: sx=colorIdx*26, sy=0, sw=26, sh=8
      if (startY <= bottomLimit) {
        ctx.drawImage(
          noteComposedImg,
          colorIdx * 26, 0, 26, 8,
          noteX, startY - 8, 26, 8
        );
      }
    }
  }

  // 6. Footer Area
  ctx.fillStyle = '#0b121d';
  ctx.fillRect(0, bottomLimit, totalWidth, CHART_FOOTER_HEIGHT);

  ctx.strokeStyle = '#273a50';
  ctx.beginPath();
  ctx.moveTo(0, bottomLimit + 0.5);
  ctx.lineTo(totalWidth, bottomLimit + 0.5);
  ctx.stroke();

  ctx.fillStyle = '#516880';
  ctx.font = 'bold 9px monospace';
  ctx.fillText('START  ↑   MEOWCAN 7-KEY VOS CHART', 22, bottomLimit + 18);

  return canvas;
}

/**
 * Downloads a chart image for the specified song:
 * 1. Checks if /charts/${filename}.png exists (pre-generated).
 * 2. If not, renders on-the-fly and downloads as a PNG Blob.
 */
export async function downloadChart(options: ChartExportOptions): Promise<boolean> {
  const { filename, song, loadSong, title, onProgress } = options;
  const cleanFilename = /\.vos$/i.test(filename) ? filename : `${filename}.vos`;
  const chartUrl = `/charts/${encodeURIComponent(cleanFilename)}.png`;

  onProgress?.('正在准备谱面长图...');

  // Step 1: download and validate the local PNG. A GET is intentional: dev
  // servers may answer a missing HEAD request with the SPA's index.html.
  try {
    const response = await fetch(chartUrl);
    if (response.ok) {
      const blob = await response.blob();
      const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
      const isPng = signature.length === 8 &&
        signature[0] === 0x89 && signature[1] === 0x50 &&
        signature[2] === 0x4e && signature[3] === 0x47 &&
        signature[4] === 0x0d && signature[5] === 0x0a &&
        signature[6] === 0x1a && signature[7] === 0x0a;
      if (!isPng) throw new Error('Local chart response is not a PNG');
      onProgress?.('下载中...');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || filename}_chart.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      onProgress?.('导出完成！');
      return true;
    }
  } catch {
    // Ignore and proceed to client-side generation
  }

  // Step 2: only load/parse the VOS after proving no local image exists.
  let renderSong = song;
  if (!renderSong && loadSong) {
    onProgress?.('正在载入谱面数据...');
    try {
      renderSong = await loadSong();
    } catch (err) {
      console.error('Chart source loading failed:', err);
    }
  }

  if (renderSong) {
    try {
      onProgress?.('正在生成谱面长图 (金属皮肤)...');
      const canvas = await renderChartToCanvas(renderSong);
      onProgress?.('正在导出图片...');

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Canvas toBlob failed');

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || renderSong.title || filename}_chart.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      onProgress?.('导出完成！');
      return true;
    } catch (err) {
      console.error('Client chart generation failed:', err);
      onProgress?.(`导出失败: ${(err as Error).message}`);
      return false;
    }
  }

  onProgress?.('未找到该曲目的谱面长图');
  return false;
}
