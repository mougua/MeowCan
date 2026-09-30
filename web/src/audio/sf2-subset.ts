import type { VosSongData } from '../parser/vos';
import { SoundBankLoader } from 'spessasynth_core';

export type SongSoundRequirements = Pick<VosSongData, 'bgmNotes' | 'playableNotes'>;

/** Only the small RIFF directories are retained; sample PCM stays in the Blob. */
export interface Sf2Index {
  info: Uint8Array;
  pdta: Uint8Array;
  sampleOffset: number;
  sampleBytes: number;
  fileBytes: number;
}

const decoder = new TextDecoder('ascii');
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

function tag(bytes: Uint8Array, offset: number): string {
  return decoder.decode(bytes.subarray(offset, offset + 4));
}

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function put32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).setUint32(0, value, true);
}

async function read(file: Blob, offset: number, length: number): Promise<Uint8Array> {
  if (offset < 0 || length < 0 || offset + length > file.size) throw new Error('SF2 片段超出文件范围');
  return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}

/** Reads RIFF headers and the preset directory without reading the smpl payload. */
export async function indexSf2(file: Blob): Promise<Sf2Index> {
  const header = await read(file, 0, 12);
  if (tag(header, 0) !== 'RIFF' || tag(header, 8) !== 'sfbk'
    || u32(header, 4) + 8 !== file.size) throw new Error('仅支持标准 RIFF SF2 音色库');
  let info: Uint8Array | undefined;
  let pdta: Uint8Array | undefined;
  let sampleOffset = -1;
  let sampleBytes = 0;
  for (let offset = 12; offset + 12 <= file.size;) {
    const list = await read(file, offset, 12);
    const length = u32(list, 4);
    const end = offset + 8 + length;
    if (tag(list, 0) !== 'LIST' || length < 4 || end > file.size) throw new Error('SF2 LIST 结构无效');
    const kind = tag(list, 8);
    if (kind === 'INFO' || kind === 'pdta') {
      const chunk = await read(file, offset, 8 + length + (length & 1));
      if (kind === 'INFO') info = chunk;
      else pdta = chunk;
    } else if (kind === 'sdta') {
      const smpl = await read(file, offset + 12, 8);
      sampleBytes = u32(smpl, 4);
      sampleOffset = offset + 20;
      if (tag(smpl, 0) !== 'smpl' || sampleOffset + sampleBytes > end || sampleBytes % 2) {
        throw new Error('SF2 采样区无效');
      }
    }
    offset = end + (length & 1);
  }
  if (!info || !pdta || sampleOffset < 0) throw new Error('SF2 缺少 INFO、pdta 或 smpl');
  const chunks = directory(pdta);
  for (const name of ['phdr', 'pbag', 'pmod', 'pgen', 'inst', 'ibag', 'imod', 'igen', 'shdr']) {
    if (!chunks.has(name)) throw new Error(`SF2 缺少 ${name}`);
  }
  if (chunks.get('shdr')!.length % 46) throw new Error('SF2 shdr 长度无效');
  const shdr = entries(pdta, chunks.get('shdr')!, 46);
  for (let id = 0; id < shdr.length / 46 - 1; id++) {
    if (new DataView(shdr.buffer, shdr.byteOffset + id * 46 + 44, 2).getUint16(0, true) & 16) {
      throw new Error('此音色库包含压缩采样，当前按需加载只支持 PCM SF2');
    }
  }
  return { info, pdta, sampleOffset, sampleBytes, fileBytes: file.size };
}

interface Chunk { offset: number; length: number }

function directory(pdta: Uint8Array): Map<string, Chunk> {
  if (tag(pdta, 0) !== 'LIST' || tag(pdta, 8) !== 'pdta') throw new Error('SF2 pdta 结构无效');
  const chunks = new Map<string, Chunk>();
  for (let offset = 12; offset + 8 <= pdta.length;) {
    const length = u32(pdta, offset + 4);
    if (offset + 8 + length > pdta.length) throw new Error('SF2 pdta 子块超出范围');
    chunks.set(tag(pdta, offset), { offset: offset + 8, length });
    offset += 8 + length + (length & 1);
  }
  return chunks;
}

function entries(pdta: Uint8Array, chunk: Chunk, size: number): Uint8Array {
  if (chunk.length % size) throw new Error('SF2 目录项长度无效');
  return pdta.subarray(chunk.offset, chunk.offset + chunk.length);
}

type KeyDemand = Map<number, Set<number>>;

/** Include scheduled velocities and the seven-lane fallback keysounds. */
export function songKeyDemand(song: SongSoundRequirements): { programs: Map<number, KeyDemand>; drums: KeyDemand } {
  const programs = new Map<number, KeyDemand>();
  const drums: KeyDemand = new Map();
  const add = (program: number, key: number, velocity: number, channel: number) => {
    if (key < 0 || key > 127 || velocity <= 0) return;
    const byKey = channel === 9 ? drums : programs.get(program) ?? new Map<number, Set<number>>();
    const velocities = byKey.get(key) ?? new Set<number>();
    velocities.add(velocity);
    byKey.set(key, velocities);
    if (channel !== 9) programs.set(program, byKey);
  };
  for (const note of song.bgmNotes) {
    add(note.instrument?.program ?? 0, note.midiNote, note.velocity, note.channel);
    add(note.instrument?.program ?? 0, note.midiNote, Math.round(note.velocity * 0.75), note.channel);
  }
  for (const note of song.playableNotes) {
    const program = note.instrument?.program ?? 0;
    add(program, note.midiNote, note.velocity, note.track);
    if (note.track === 9) { add(program, note.midiNote, 100, note.track); continue; }
    for (const offset of MAJOR_SCALE) {
      const key = note.midiNote + offset - MAJOR_SCALE[note.lane];
      add(program, key, 100, note.track);
    }
  }
  return { programs, drums };
}

function assemble(info: Uint8Array, pdta: Uint8Array, sampleBytes: number): Uint8Array {
  const sdtaSize = 4 + 8 + sampleBytes;
  const output = new Uint8Array(12 + info.length + 8 + sdtaSize + pdta.length);
  output.set(new TextEncoder().encode('RIFF'), 0);
  put32(output, 4, output.length - 8);
  output.set(new TextEncoder().encode('sfbk'), 8);
  let cursor = 12;
  output.set(info, cursor); cursor += info.length;
  output.set(new TextEncoder().encode('LIST'), cursor);
  put32(output, cursor + 4, sdtaSize);
  output.set(new TextEncoder().encode('sdta'), cursor + 8);
  output.set(new TextEncoder().encode('smpl'), cursor + 12);
  put32(output, cursor + 16, sampleBytes);
  output.set(pdta, cursor + 20 + sampleBytes);
  return output;
}

/** Uses SpessaSynth's voice resolver on a metadata-only bank. No PCM is loaded. */
export function selectedSamples(index: Sf2Index, song: SongSoundRequirements): Set<number> {
  const metadata = index.pdta.slice();
  const shdr = entries(metadata, directory(metadata).get('shdr')!, 46);
  for (let id = 0; id < shdr.length / 46; id++) {
    for (const field of [20, 24, 28, 32]) put32(shdr, id * 46 + field, 0);
  }
  const bank = SoundBankLoader.fromArrayBuffer(assemble(index.info, metadata, 0).buffer);
  const sampleIds = new Map(bank.samples.map((sample, id) => [sample, id]));
  const { programs, drums } = songKeyDemand(song);
  const selected = new Set<number>();
  for (const preset of bank.presets) {
    const keys = preset.isDrum ? drums : programs.get(preset.program);
    if (!keys) continue;
    for (const [key, velocities] of keys) for (const velocity of velocities) {
      for (const voice of preset.getVoiceParameters(key, velocity)) {
        const id = sampleIds.get(voice.sample);
        if (id !== undefined) selected.add(id);
      }
    }
  }
  // Stereo samples must be loaded together.
  for (const id of [...selected]) {
    const link = new DataView(shdr.buffer, shdr.byteOffset + id * 46 + 42, 2).getUint16(0, true);
    const type = new DataView(shdr.buffer, shdr.byteOffset + id * 46 + 44, 2).getUint16(0, true);
    if ((type & 6) && link < shdr.length / 46 - 1) selected.add(link);
  }
  return selected;
}

/** Builds a valid small SF2 while preserving all presets, zones and modulators. */
export async function buildSongSf2(file: Blob, index: Sf2Index, song: SongSoundRequirements): Promise<ArrayBuffer> {
  if (file.size !== index.fileBytes) throw new Error('本地音色库与索引不匹配');
  const pdta = index.pdta.slice();
  const shdrChunk = directory(pdta).get('shdr')!;
  const shdr = pdta.subarray(shdrChunk.offset, shdrChunk.offset + shdrChunk.length);
  const selected = selectedSamples(index, song);
  if (selected.size === 0) throw new Error('音色库中没有匹配此曲目的采样');
  const sampleCount = shdr.length / 46 - 1;
  const ranges: Array<{ id: number; start: number; end: number; target: number }> = [];
  let sampleBytes = 0;
  for (let id = 0; id < sampleCount; id++) {
    const offset = id * 46;
    const start = u32(shdr, offset + 20), end = u32(shdr, offset + 24);
    if (selected.has(id)) {
      if (end < start || end * 2 > index.sampleBytes) throw new Error('SF2 采样边界无效');
      ranges.push({ id, start, end, target: sampleBytes / 2 });
      sampleBytes += (end - start) * 2 + 92; // SF2 interpolation guard points
    } else {
      put32(shdr, offset + 20, 0);
      put32(shdr, offset + 24, 0);
      put32(shdr, offset + 28, 0);
      put32(shdr, offset + 32, 0);
    }
  }
  if (sampleBytes > 0xffffffff - index.info.length - pdta.length - 32) throw new Error('提取后的 SF2 超出 RIFF 限制');
  const output = assemble(index.info, pdta, sampleBytes);
  const sampleTarget = 12 + index.info.length + 20;
  for (const range of ranges) {
    const count = (range.end - range.start) * 2;
    // Bound transient allocations even if one SF2 sample is unusually large.
    for (let copied = 0; copied < count; copied += 4 * 1024 * 1024) {
      const length = Math.min(4 * 1024 * 1024, count - copied);
      const bytes = await read(file, index.sampleOffset + range.start * 2 + copied, length);
      output.set(bytes, sampleTarget + range.target * 2 + copied);
    }
    const offset = range.id * 46;
    const shift = range.target - range.start;
    for (const field of [20, 24, 28, 32]) put32(shdr, offset + field, u32(shdr, offset + field) + shift);
  }
  // The terminal header points just past the last sample.
  for (const field of [20, 24, 28, 32]) put32(shdr, sampleCount * 46 + field, sampleBytes / 2);
  output.set(pdta, output.length - pdta.length);
  return output.buffer;
}
