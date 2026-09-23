import { readMidiAutomation, readMidiState, type MidiState } from './midi';
/**
 * CanMusic / VOS Binary Format Parser (Classic VOS + CanMusic Container VOS)
 * Conforming to docs/spec/vos-format.md
 */

export interface PlayableNote {
  instrument?: MidiState;
  id: number;
  lane: number;          // 0..6
  startSec: number;      // Trigger time in seconds
  durationSec: number;   // Duration in seconds
  startTick?: number;    // Original CanMusic MUSIC_TIME (768 ticks per quarter)
  durationTicks?: number;
  midiNote: number;      // Pitch (0..127)
  velocity: number;      // (0..127)
  track: number;         // Channel / track
  isLong: boolean;       // Hold note flag
  // Runtime gameplay state
  judged: boolean;
  hitScore?: 'COOL' | 'GOOD' | 'BAD' | 'MISS';
  hitOffsetMs?: number;
  holdActive?: boolean;
  holdCompleted?: boolean;
  holdBroken?: boolean;
}

export interface BgmNote {
  instrument?: MidiState;
  startSec: number;
  durationSec: number;
  midiNote: number;
  velocity: number;
  channel: number;
}

export interface TimedMidiEvent {
  startSec: number;
  message: number[];
}

export interface VosSongData {
  title: string;
  artist: string;
  arranger: string;
  comment: string;
  genre: string;
  level: number;
  durationSec: number;
  playableNotes: PlayableNote[];
  bgmNotes: BgmNote[];
  midiEvents: TimedMidiEvent[];
  bpm: number;
  tempoMap: TempoPoint[];
}

export interface TempoPoint {
  quarter: number;
  sec: number;
  secPerQuarter: number;
  bpm: number;
}

function decodeText(bytes: Uint8Array): string {
  // Try EUC-KR (standard for Korean CanMusic)
  try {
    const decoder = new TextDecoder('euc-kr');
    const res = decoder.decode(bytes);
    if (!res.includes('\ufffd')) return cleanString(res);
  } catch (e) {
    // fallback
  }

  // Try GBK (standard for Chinese MyCanMusic)
  try {
    const decoder = new TextDecoder('gbk');
    const res = decoder.decode(bytes);
    if (!res.includes('\ufffd')) return cleanString(res);
  } catch (e) {
    // fallback
  }

  // Fallback to UTF-8 or Latin1
  try {
    const decoder = new TextDecoder('utf-8');
    const res = decoder.decode(bytes);
    if (!res.includes('\ufffd')) return cleanString(res);
  } catch (e) {
    // fallback
  }

  // Latin1 byte-to-char
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return cleanString(s);
}

function cleanString(s: string): string {
  return s.replace(/\0.*$/, '').replace(/[\x00-\x1f]/g, '').trim();
}

/**
 * Parses MIDI buffer to extract tempo map and accompaniment events
 */
function parseMidiTrack0(midiBytes: Uint8Array): { tempoMap: TempoPoint[]; defaultBpm: number } {
  const tempoMap: TempoPoint[] = [];
  let defaultBpm = 130;

  if (midiBytes.length < 14) {
    return {
      tempoMap: [{ quarter: 0, sec: 0, secPerQuarter: 60 / defaultBpm, bpm: defaultBpm }],
      defaultBpm
    };
  }

  const view = new DataView(midiBytes.buffer, midiBytes.byteOffset, midiBytes.byteLength);
  const magic = String.fromCharCode(...midiBytes.subarray(0, 4));
  if (magic !== 'MThd') {
    return {
      tempoMap: [{ quarter: 0, sec: 0, secPerQuarter: 60 / defaultBpm, bpm: defaultBpm }],
      defaultBpm
    };
  }

  const headerLen = view.getUint32(4, false);
  const division = view.getUint16(12, false);

  let p = 8 + headerLen;
  if (p + 8 > midiBytes.length) {
    return {
      tempoMap: [{ quarter: 0, sec: 0, secPerQuarter: 60 / defaultBpm, bpm: defaultBpm }],
      defaultBpm
    };
  }

  const trkLen = view.getUint32(p + 4, false);
  p += 8;
  const trkEnd = Math.min(p + trkLen, midiBytes.length);

  function readVarInt(): number {
    let val = 0;
    while (p < trkEnd) {
      const b = midiBytes[p++];
      val = (val << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return val;
  }

  let currentTick = 0;
  let runningStatus = 0;
  const rawTempos: { tick: number; usPerQuarter: number; bpm: number }[] = [];

  while (p < trkEnd) {
    const delta = readVarInt();
    currentTick += delta;
    if (p >= trkEnd) break;
    let status = midiBytes[p];
    if (status >= 0x80) {
      p++;
      runningStatus = status;
    } else {
      status = runningStatus;
    }

    if (status === 0xff) {
      if (p >= trkEnd) break;
      const metaType = midiBytes[p++];
      const len = readVarInt();
      if (metaType === 0x51 && len === 3 && p + 3 <= trkEnd) {
        const us = (midiBytes[p] << 16) | (midiBytes[p + 1] << 8) | midiBytes[p + 2];
        const bpm = 60000000 / us;
        rawTempos.push({ tick: currentTick, usPerQuarter: us, bpm });
      }
      p += len;
    } else if (status === 0xf0 || status === 0xf7) {
      const len = readVarInt();
      p += len;
    } else {
      const high = status & 0xf0;
      if (high === 0xc0 || high === 0xd0) {
        p += 1;
      } else {
        p += 2;
      }
    }
  }

  if (rawTempos.length === 0) {
    rawTempos.push({ tick: 0, usPerQuarter: 500000, bpm: 120 });
  }
  defaultBpm = rawTempos[0].bpm;

  // Build piecewise linear timeline
  let accumulatedSec = 0;
  let prevQuarter = 0;
  let currentSecPerQuarter = rawTempos[0].usPerQuarter / 1000000;

  for (let i = 0; i < rawTempos.length; i++) {
    const t = rawTempos[i];
    const q = t.tick / division;
    if (q > prevQuarter) {
      accumulatedSec += (q - prevQuarter) * currentSecPerQuarter;
      prevQuarter = q;
    }
    currentSecPerQuarter = t.usPerQuarter / 1000000;
    tempoMap.push({
      quarter: q,
      sec: accumulatedSec,
      secPerQuarter: currentSecPerQuarter,
      bpm: t.bpm
    });
  }

  return { tempoMap, defaultBpm };
}

function quarterToSeconds(quarter: number, tempoMap: TempoPoint[]): number {
  if (tempoMap.length === 0) return quarter * 0.5;
  let idx = 0;
  while (idx + 1 < tempoMap.length && tempoMap[idx + 1].quarter <= quarter) {
    idx++;
  }
  const point = tempoMap[idx];
  return point.sec + (quarter - point.quarter) * point.secPerQuarter;
}

export function tickToSeconds(tick: number, tempoMap: TempoPoint[]): number {
  // PPQ = 768 in VOS
  const quarter = tick / 768.0;
  return quarterToSeconds(quarter, tempoMap);
}

/** Convert the audio clock back to CanMusic's 768 PPQ MUSIC_TIME domain. */
export function secondsToMusicTick(seconds: number, tempoMap: TempoPoint[]): number {
  if (tempoMap.length === 0) return seconds * 768 / 0.5;
  let low = 0;
  let high = tempoMap.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (tempoMap[mid].sec <= seconds) low = mid;
    else high = mid;
  }
  const point = tempoMap[low];
  return (point.quarter + (seconds - point.sec) / point.secPerQuarter) * 768;
}

/**
 * Main parser entry point: parses raw .vos file
 */
export function parseVos(arrayBuffer: ArrayBuffer): VosSongData {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const first = view.getUint32(0, true);

  if (first === 3 && String.fromCharCode(...bytes.subarray(8, 11)) === 'inf') {
    return parseClassicVos(bytes, view);
  } else if (first >= 2 && first <= 10) {
    return parseContainerVos(bytes, view);
  } else {
    throw new Error(`Unsupported VOS header: 0x${first.toString(16)}`);
  }
}

function parseContainerVos(bytes: Uint8Array, view: DataView): VosSongData {
  const subfileCount = view.getUint32(0, true);
  let offset = 4;
  let trkBytes: Uint8Array | null = null;
  let midBytes: Uint8Array | null = null;

  for (let i = 0; i < subfileCount; i++) {
    const nameLen = view.getUint32(offset, true); offset += 4;
    let name = '';
    for (let c = 0; c < nameLen; c++) name += String.fromCharCode(bytes[offset + c]);
    offset += nameLen;
    const dataLen = view.getUint32(offset, true); offset += 4;
    const data = bytes.subarray(offset, offset + dataLen);
    offset += dataLen;

    const lower = name.toLowerCase();
    if (lower.endsWith('.trk')) trkBytes = data;
    else if (lower.endsWith('.mid')) midBytes = data;
  }

  if (!trkBytes) throw new Error('Missing Vosctemp.trk inside VOS container');

  const { tempoMap, defaultBpm } = midBytes
    ? parseMidiTrack0(midBytes)
    : { tempoMap: [{ quarter: 0, sec: 0, secPerQuarter: 0.5, bpm: 120 }], defaultBpm: 120 };

  const trkView = new DataView(trkBytes.buffer, trkBytes.byteOffset, trkBytes.byteLength);
  const magic = String.fromCharCode(...trkBytes.subarray(0, 6));
  const verNum = parseInt(magic.slice(3), 10) || 22;

  let p = 6;
  function readStr16(): string {
    const len = trkView.getUint16(p, true); p += 2;
    const raw = trkBytes!.subarray(p, p + len); p += len;
    return decodeText(raw);
  }

  const title = readStr16() || 'Untitled';
  const artist = readStr16() || 'Unknown Artist';
  const comment = readStr16() || '';
  const arranger = readStr16() || 'HanseulSoft';
  const genre = readStr16() || 'Game';

  p += 7; // header_bytes_7
  const length_tt = trkView.getUint32(p, true); p += 4;
  const length_rt = trkView.getUint32(p, true); p += 4;
  const length_extra = trkView.getUint32(p, true); p += 4;
  p += 3; // header_bytes_3
  const default_flags = trkView.getUint32(p, true); p += 4;

  if (verNum === 9) {
    p += 4 + 1013;
  } else {
    p += 1017;
  }

  const narr = trkView.getUint32(p, true); p += 4;
  const numDiffs = trkView.getUint32(p, true); p += 4;

  const programs: number[] = [];
  for (let a = 0; a < narr; a++) {
    programs.push(trkView.getUint32(p + 1, true));
    p += 5;
  }
  const midiState = readMidiState(midBytes ?? new Uint8Array());
  const midiEvents = readMidiAutomation(midBytes ?? new Uint8Array()).map(event => ({
    startSec: tickToSeconds(event.quarter * 768, tempoMap),
    message: event.message
  }));

  let level = 1;
  for (let d = 0; d < numDiffs; d++) {
    if (d === 0) level = trkBytes[p] + 1; p += 2; // level + keyMode
    const descLen = trkView.getUint16(p, true); p += 2 + descLen + 4;
  }

  // Read note tracks
  interface NoteRecord {
    time: number;
    noteNum: number;
    track: number;
    velocity: number;
    isUser: number;
    isLong: number;
    duration: number;
  }

  const allTracks: NoteRecord[][] = [];
  for (let a = 0; a < narr; a++) {
    const nnote = trkView.getUint32(p, true); p += 4;
    const notes: NoteRecord[] = [];
    for (let n = 0; n < nnote; n++) {
      const time = trkView.getUint32(p + 1, true);
      const noteNum = trkBytes[p + 5];
      const track = trkBytes[p + 6];
      const velocity = trkBytes[p + 7];
      const isUser = trkBytes[p + 8];
      const isLong = trkBytes[p + 10];
      const duration = trkView.getUint32(p + 11, true);
      p += 16;
      notes.push({ time, noteNum, track, velocity, isUser, isLong, duration });
    }
    allTracks.push(notes);
  }

  if (verNum >= 8) {
    const v8Count = trkView.getUint32(p, true); p += 4;
    p += v8Count * 8;
  }

  // Read user note mapping table
  const playableNotes: PlayableNote[] = [];
  let noteId = 0;

  for (let d = 0; d < numDiffs; d++) {
    const nunote = trkView.getUint32(p, true); p += 4;
    for (let u = 0; u < nunote; u++) {
      const arrIdx = trkBytes[p];
      const idx = trkView.getUint32(p + 1, true);
      const key = trkBytes[p + 5];
      p += 6;

      if (d === 0 && arrIdx < allTracks.length && idx < allTracks[arrIdx].length) {
        const nr = allTracks[arrIdx][idx];
        const startSec = tickToSeconds(nr.time, tempoMap);
        const endSec = tickToSeconds(nr.time + Math.max(nr.duration, 192), tempoMap);
        const durationSec = Math.max(0.08, endSec - startSec);

        playableNotes.push({
          id: noteId++,
          lane: Math.min(6, Math.max(0, key)),
          startSec,
          durationSec,
          startTick: nr.time,
          durationTicks: nr.duration,
          midiNote: nr.noteNum,
          velocity: nr.velocity || 90,
          track: nr.track,
          instrument: midiState(nr.time / 768, nr.track, programs[arrIdx]),
          isLong: nr.isLong === 1 && durationSec > 0.25,
          judged: false
        });
      }
    }
  }

  playableNotes.sort((a, b) => a.startSec - b.startSec);

  // Collect BGM accompaniment notes (isUser == 0)
  const bgmNotes: BgmNote[] = [];
  for (const [arrIdx, trk] of allTracks.entries()) {
    for (const nr of trk) {
      if (nr.isUser === 0) {
        const startSec = tickToSeconds(nr.time, tempoMap);
        const endSec = tickToSeconds(nr.time + nr.duration, tempoMap);
        bgmNotes.push({
          startSec,
          durationSec: Math.max(0.05, endSec - startSec),
          midiNote: nr.noteNum,
          velocity: nr.velocity,
          channel: nr.track,
          instrument: midiState(nr.time / 768, nr.track, programs[arrIdx])
        });
      }
    }
  }
  bgmNotes.sort((a, b) => a.startSec - b.startSec);

  const durationSec = Math.max(length_rt / 1000, ...playableNotes.map(n => n.startSec + n.durationSec), ...bgmNotes.map(n => n.startSec + n.durationSec));

  return {
    title,
    artist,
    arranger,
    comment,
    genre,
    level,
    durationSec,
    playableNotes,
    bgmNotes,
    midiEvents,
    bpm: Math.round(defaultBpm),
    tempoMap
  };
}

function parseClassicVos(bytes: Uint8Array, view: DataView): VosSongData {
  let offset = 4;
  const segs: Record<string, number> = {};
  for (let i = 0; i < 3; i++) {
    const segOffset = view.getUint32(offset, true);
    let name = '';
    for (let c = 0; c < 16; c++) {
      const ch = bytes[offset + 4 + c];
      if (ch === 0) break;
      name += String.fromCharCode(ch);
    }
    offset += 20;
    segs[name] = segOffset;
  }

  let pos = segs['inf'] || 64;
  const magic = String.fromCharCode(...bytes.subarray(pos, pos + 4));
  if (magic === 'VOS1') {
    pos += 4 + 2 + 64;
    const sLen = bytes[pos++];
    pos += sLen;
  }

  function readStr8(): string {
    const len = bytes[pos++];
    const s = bytes.subarray(pos, pos + len);
    pos += len;
    return decodeText(s);
  }

  const title = readStr8() || 'Untitled';
  const artist = readStr8() || 'Unknown Artist';
  const comment = readStr8() || '';
  const arranger = readStr8() || 'HanseulSoft';
  pos += 2; // songType, extType
  const songLength = view.getUint32(pos, true); pos += 4;
  const level = bytes[pos] + 1; pos += 1;

  // Adaptive 1023 / 1024 padding
  let padLen = 1023;
  const testPos = pos + 1023 + 8;
  let is14Zeros = true;
  for (let k = 0; k < 14; k++) {
    if (testPos + k >= bytes.length || bytes[testPos + k] !== 0) {
      is14Zeros = false;
      break;
    }
  }
  if (!is14Zeros) padLen = 1024;
  pos += padLen;

  // Extract MIDI for tempo
  const midOffset = segs['mid'] || bytes.length;
  const eofOffset = segs['EOF'] || bytes.length;
  const midBytes = bytes.subarray(midOffset, eofOffset);
  const { tempoMap, defaultBpm } = parseMidiTrack0(midBytes);
  const midiState = readMidiState(midBytes);
  const midiEvents = readMidiAutomation(midBytes).map(event => ({
    startSec: tickToSeconds(event.quarter * 768, tempoMap),
    message: event.message
  }));
  const seenPlayerNotes = new Set<string>();

  const playableNotes: PlayableNote[] = [];
  const bgmNotes: BgmNote[] = [];
  let noteId = 0;

  while (pos + 8 <= midOffset) {
    const program = view.getUint32(pos, true);
    pos += 4; // instrument type
    const nnote = view.getUint32(pos, true); pos += 4 + 14; // dummy2
    for (let n = 0; n < nnote; n++) {
      if (pos + 13 > midOffset) break;
      const time = view.getUint32(pos, true);
      const duration = view.getUint32(pos + 4, true);
      const cmd = bytes[pos + 8];
      const noteNum = bytes[pos + 9];
      const velocity = bytes[pos + 10];
      const flags1 = bytes[pos + 11];
      const flags2 = bytes[pos + 12];
      pos += 13;

      const isUser = (flags1 & 0x80) !== 0;
      const key = (flags1 >> 4) & 0x07;
      const isLong = (flags2 & 0x80) !== 0;

      const startSec = tickToSeconds(time, tempoMap);
      const endSec = tickToSeconds(time + Math.max(duration, 192), tempoMap);
      const durationSec = Math.max(0.08, endSec - startSec);

      if (isUser && key < 7) {
        // Classic files repeat player events in a final summary array.
        // Keep the original instrument-track event, never a second judgment.
        const identity = `${time}:${key}:${noteNum}:${cmd & 15}:${duration}`;
        if (seenPlayerNotes.has(identity)) continue;
        seenPlayerNotes.add(identity);
        playableNotes.push({
          id: noteId++,
          lane: key,
          startSec,
          durationSec,
          startTick: time,
          durationTicks: duration,
          midiNote: noteNum,
          velocity: velocity || 90,
          track: cmd & 0x0f,
          instrument: midiState(time / 768, cmd & 15, program),
          isLong: isLong && durationSec > 0.25,
          judged: false
        });
      } else {
        bgmNotes.push({
          startSec,
          durationSec: Math.max(0.05, endSec - startSec),
          midiNote: noteNum,
          velocity,
          channel: cmd & 0x0f,
          instrument: midiState(time / 768, cmd & 15, program)
        });
      }
    }
  }

  playableNotes.sort((a, b) => a.startSec - b.startSec);
  bgmNotes.sort((a, b) => a.startSec - b.startSec);

  const durationSec = Math.max(songLength / 1000, ...playableNotes.map(n => n.startSec + n.durationSec), ...bgmNotes.map(n => n.startSec + n.durationSec));

  return {
    title,
    artist,
    arranger,
    comment,
    genre: 'Classic',
    level,
    durationSec,
    playableNotes,
    bgmNotes,
    midiEvents,
    bpm: Math.round(defaultBpm),
    tempoMap
  };
}
