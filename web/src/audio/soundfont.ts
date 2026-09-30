import { WorkletSynthesizer } from 'spessasynth_lib';
import workletUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

import type { MidiState } from '../parser/midi';
import { cacheSoundFont, getCachedSoundFont } from '../asset-cache';

const PLAYER_CHANNEL_OFFSET = 16;
const MIDI_CHANNEL_COUNT = 16;

type SoundFontBus = 'bgm' | 'keysound';

export interface SoundFontNote {
  midiNote: number;
  velocity: number;
  channel: number;
  startTime: number;
  durationSec: number;
  instrument?: MidiState;
  bus: SoundFontBus;
}

/** Sample-based GM renderer. Construction fails cleanly when Worklets or SF2 are unavailable. */
export class SoundFontSynth {
  private readonly channelStates = new Map<number, ChannelState>();

  private constructor(private readonly synth: WorkletSynthesizer) {}

  public static async create(
    context: AudioContext,
    destination: AudioNode,
    prefetchedSoundBank?: ArrayBuffer
  ): Promise<SoundFontSynth> {
    if (!context.audioWorklet) throw new Error('AudioWorklet is unavailable');

    const [soundBank] = await Promise.all([
      prefetchedSoundBank ? Promise.resolve(prefetchedSoundBank) : fetchSoundFont(),
      context.audioWorklet.addModule(workletUrl),
    ]);
    assertSoundFont(soundBank);

    const synth = new WorkletSynthesizer(context);
    try {
      await synth.soundBankManager.addSoundBank(soundBank, 'magic-sf2');
      await synth.isReady;

      // Keep player hits away from the 16 accompaniment channel states.
      for (let i = 0; i < MIDI_CHANNEL_COUNT; i++) {
        synth.addNewChannel();
      }
      // Dynamically-added channels have zero-filled MIDI controllers, including
      // brightness and envelope controls whose neutral value is 64. Merely
      // setting drums/program/volume leaves player notes heavily attenuated.
      // Reset after adding ALL channels, before scheduling any notes. This also
      // restores GM percussion on channels 9 and 25 and melodic mode elsewhere.
      synth.reset();
      synth.connect(destination);
      return new SoundFontSynth(synth);
    } catch (error) {
      synth.destroy();
      throw error;
    }
  }

  public scheduleNote(note: SoundFontNote): void {
    const gain = note.bus === 'bgm' ? 0.75 : 1;
    const velocity = clampMidi(Math.round(note.velocity * gain));
    if (velocity === 0) return;
    const baseChannel = note.channel & 0x0f;
    const channel = baseChannel + (note.bus === 'keysound' ? PLAYER_CHANNEL_OFFSET : 0);
    const options = { time: note.startTime };

    this.applyChannelState(channel, note.instrument, options);
    const midiNote = clampMidi(note.midiNote);
    this.synth.noteOn(channel, midiNote, velocity, options);
    this.synth.noteOff(channel, midiNote, {
      time: note.startTime + Math.max(0.03, note.durationSec),
    });
  }

  /** Schedules VOS-embedded MIDI automation on accompaniment and player channels. */
  public scheduleMidiMessage(message: readonly number[], startTime: number): void {
    if (message.length < 2) return;
    const options = { time: startTime };
    this.synth.sendMessage(message, 0, options);
    this.synth.sendMessage(message, PLAYER_CHANNEL_OFFSET, options);
  }

  public stopAll(): void {
    this.synth.stopAll(true);
    this.synth.reset();
    this.channelStates.clear();
  }

  public destroy(): void {
    this.synth.destroy();
  }

  private applyChannelState(
    channel: number,
    instrument: MidiState | undefined,
    options: { time: number }
  ): void {
    const program = clampMidi(instrument?.program ?? 0);
    const volume = clampMidi(instrument?.volume ?? 100);
    const expression = clampMidi(instrument?.expression ?? 127);
    const pan = clampMidi(instrument?.pan ?? 64);
    let current = this.channelStates.get(channel);
    if (!current) {
      current = new ChannelState();
      this.channelStates.set(channel, current);
    }
    if (current.program !== program) {
      this.synth.programChange(channel, program, options);
      current.program = program;
    }
    if (current.volume !== volume) {
      this.synth.controllerChange(channel, 7, volume, options);
      current.volume = volume;
    }
    if (current.pan !== pan) {
      this.synth.controllerChange(channel, 10, pan, options);
      current.pan = pan;
    }
    // MIDI automation is queued ahead of notes in the lookahead window, even
    // when its playback time falls between two notes. A send-order cache cannot
    // describe that time order, so restore expression at every note onset.
    this.synth.controllerChange(channel, 11, expression, options);
  }
}

/** Last values written to a synth channel; -1 means unknown and forces a write. */
class ChannelState {
  program = -1;
  volume = -1;
  pan = -1;
}

export async function fetchSoundFont(
  url = '/assets/soundfonts/MagicSFver2.sf2',
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<ArrayBuffer> {
  const cached = await getCachedSoundFont(url);
  const response = cached ?? await fetch(url);
  if (!response.ok) throw new Error(`SoundFont request failed: HTTP ${response.status}`);
  const totalBytes = Number(response.headers.get('content-length')) || 0;
  // A cached body is local; reading it in one call avoids holding every
  // streamed chunk and a second full-size copy at the same time.
  if (cached || !response.body) {
    const buffer = await response.arrayBuffer();
    assertSoundFont(buffer);
    onProgress?.(buffer.byteLength, totalBytes || buffer.byteLength);
    if (!cached) await cacheSoundFont(url, buffer);
    return buffer;
  }

  const bytes = await readBodyWithProgress(response.body, totalBytes, onProgress);
  assertSoundFont(bytes.buffer as ArrayBuffer);
  onProgress?.(bytes.byteLength, totalBytes || bytes.byteLength);
  await cacheSoundFont(url, bytes.buffer as ArrayBuffer);
  return bytes.buffer as ArrayBuffer;
}

/**
 * Streams a download into one buffer. A known length is written in place;
 * otherwise the buffer grows geometrically instead of keeping every chunk.
 */
async function readBodyWithProgress(
  body: ReadableStream<Uint8Array>,
  totalBytes: number,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<Uint8Array> {
  const reader = body.getReader();
  let bytes = new Uint8Array(totalBytes > 0 ? totalBytes : 1 << 20);
  let loadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loadedBytes + value.byteLength > bytes.byteLength) {
      const grown = new Uint8Array(Math.max(bytes.byteLength * 2, loadedBytes + value.byteLength));
      grown.set(bytes.subarray(0, loadedBytes));
      bytes = grown;
    }
    bytes.set(value, loadedBytes);
    loadedBytes += value.byteLength;
    onProgress?.(loadedBytes, totalBytes);
  }
  if (loadedBytes === bytes.byteLength) return bytes;
  // Content-Length can describe compressed bytes; return an exact-size copy.
  return bytes.slice(0, loadedBytes);
}

function clampMidi(value: number): number {
  return Math.max(0, Math.min(127, value | 0));
}

function assertSoundFont(buffer: ArrayBuffer): void {
  if (buffer.byteLength < 12) throw new Error('SoundFont is truncated');
  const bytes = new Uint8Array(buffer, 0, 12);
  const text = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
  if (text(0) !== 'RIFF' || text(8) !== 'sfbk') {
    throw new Error('SoundFont has an invalid RIFF/sfbk signature');
  }
}
