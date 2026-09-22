import { WorkletSynthesizer } from 'spessasynth_lib';
import workletUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

import type { MidiState } from '../parser/midi';

const PLAYER_CHANNEL_OFFSET = 16;
const MIDI_CHANNEL_COUNT = 16;

type SoundFontBus = 'bgm' | 'keysound';

interface ChannelState {
  program: number;
  volume: number;
  expression: number;
  pan: number;
}

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
    const baseChannel = note.channel & 0x0f;
    const channel = baseChannel + (note.bus === 'keysound' ? PLAYER_CHANNEL_OFFSET : 0);
    const state = normalizeState(note.instrument);
    const options = { time: note.startTime };

    this.applyChannelState(channel, state, options);
    const gain = note.bus === 'bgm' ? 0.75 : 1;
    const velocity = clampMidi(Math.round(note.velocity * gain));
    if (velocity === 0) return;

    this.synth.noteOn(channel, clampMidi(note.midiNote), velocity, options);
    this.synth.noteOff(channel, clampMidi(note.midiNote), {
      time: note.startTime + Math.max(0.03, note.durationSec),
    });
  }

  public stopAll(): void {
    this.synth.stopAll(true);
  }

  public destroy(): void {
    this.synth.destroy();
  }

  private applyChannelState(
    channel: number,
    next: ChannelState,
    options: { time: number }
  ): void {
    const current = this.channelStates.get(channel);
    if (!current || current.program !== next.program) {
      this.synth.programChange(channel, next.program, options);
    }
    if (!current || current.volume !== next.volume) {
      this.synth.controllerChange(channel, 7, next.volume, options);
    }
    if (!current || current.pan !== next.pan) {
      this.synth.controllerChange(channel, 10, next.pan, options);
    }
    if (!current || current.expression !== next.expression) {
      this.synth.controllerChange(channel, 11, next.expression, options);
    }
    this.channelStates.set(channel, next);
  }
}

export async function fetchSoundFont(
  url = '/assets/soundfonts/MagicSFver2.sf2',
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`SoundFont request failed: HTTP ${response.status}`);
  const totalBytes = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength, totalBytes || buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loadedBytes += value.byteLength;
    onProgress?.(loadedBytes, totalBytes);
  }
  const bytes = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.(loadedBytes, totalBytes || loadedBytes);
  return bytes.buffer;
}

function normalizeState(instrument?: MidiState): ChannelState {
  return {
    program: clampMidi(instrument?.program ?? 0),
    volume: clampMidi(instrument?.volume ?? 100),
    expression: clampMidi(instrument?.expression ?? 127),
    pan: clampMidi(instrument?.pan ?? 64),
  };
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
