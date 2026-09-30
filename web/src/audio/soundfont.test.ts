import { afterEach, expect, mock, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildSongSf2, indexSf2 } from './sf2-subset';

mock.module('spessasynth_lib/dist/spessasynth_processor.min.js?url', () => ({ default: 'worklet.js' }));

const bankPath = new URL('../../public/assets/soundfonts/MagicSFver2.sf2', import.meta.url);
const originalWorklet = globalThis.AudioWorkletNode;
afterEach(() => {
  globalThis.AudioWorkletNode = originalWorklet;
});

test('restores expression on every hit after MIDI controller automation', async () => {
  const { SoundFontSynth } = await import('./soundfont');
  const controllers: Array<[number, number, number]> = [];
  const synthBackend = {
    programChange() {},
    controllerChange(channel: number, controller: number, value: number) {
      controllers.push([channel, controller, value]);
    },
    noteOn() {}, noteOff() {},
    sendMessage() {},
  };
  const synth = new (SoundFontSynth as any)(synthBackend) as InstanceType<typeof SoundFontSynth>;
  const note = { midiNote: 60, velocity: 100, channel: 2, startTime: 1,
    durationSec: 0.2, instrument: { program: 0, volume: 80, expression: 127, pan: 32 },
    bus: 'bgm' as const };
  synth.scheduleNote(note);
  synth.scheduleMidiMessage([0xb2, 121, 0], 1.5);
  synth.scheduleNote({ ...note, startTime: 2 });
  expect(controllers.filter(([, controller]) => controller === 11))
    .toEqual([[2, 11, 127], [2, 11, 127]]);
});

// Only the browser transport is simulated; the shipped processor renders real SF2 samples.
class Port {
  private handler: ((event: { data: unknown }) => void) | null = null;
  private pending: unknown[] = [];
  peer!: Port;
  set onmessage(handler: ((event: { data: unknown }) => void) | null) {
    this.handler = handler;
    if (handler) for (const data of this.pending.splice(0)) this.deliver(data);
  }
  postMessage(data: unknown) { this.peer.deliver(data); }
  private deliver(data: unknown) {
    if (this.handler) queueMicrotask(() => this.handler?.({ data }));
    else this.pending.push(data);
  }
}

test.skipIf(!existsSync(bankPath))('extracted SoundFont renders player hits on every MIDI channel after startup and restart', async () => {
  let Processor: any;
  let processor: any;
  const mainPort = new Port();
  const workletPort = new Port();
  mainPort.peer = workletPort;
  workletPort.peer = mainPort;
  runInNewContext(readFileSync(new URL('../../node_modules/spessasynth_lib/dist/spessasynth_processor.min.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { port = workletPort; },
    registerProcessor: (_name: string, implementation: any) => { Processor = implementation; },
    sampleRate: 44100, currentTime: 0, console, WebAssembly, TextDecoder, TextEncoder,
    atob, setTimeout, clearTimeout,
  });
  globalThis.AudioWorkletNode = class {
    port = mainPort;
    constructor(public context: unknown, _name: string, options: unknown) { processor = new Processor(options); }
    connect() {}
    disconnect() {}
  } as unknown as typeof AudioWorkletNode;
  const file = Bun.file(bankPath);
  const index = await indexSf2(file);
  const song = { bgmNotes: [
    { midiNote: 38, velocity: 100, channel: 0, instrument: { program: 30 } },
    { midiNote: 38, velocity: 100, channel: 9, instrument: { program: 0 } },
  ], playableNotes: [] } as any;
  const subset = await buildSongSf2(file, index, song);
  expect(subset.byteLength).toBeLessThan(file.size);
  const { SoundFontSynth } = await import('./soundfont');
  const synth = await SoundFontSynth.create({
    currentTime: 0,
    audioWorklet: { addModule: async () => undefined },
  } as unknown as AudioContext, {} as AudioNode, subset);
  const outputs = Array.from({ length: 17 }, () => [new Float32Array(128), new Float32Array(128)]);
  let time = 0;
  const firstHits: number[] = [];
  let pass = 0;
  for (const bus of ['keysound', 'bgm', 'keysound'] as const) {
    synth.stopAll();
    for (let channel = 0; channel < 16; channel++) {
      // Song 4330 (Evolution) starts with this short distortion-guitar note.
      // Match effective velocity between buses to compare channel initialization.
      synth.scheduleNote({ midiNote: 38, velocity: bus === 'bgm' ? 100 : 75, channel,
        instrument: { program: channel === 9 ? 0 : 30, volume: 126, expression: 127, pan: 64 },
        startTime: time, durationSec: 0.09, bus });
      await new Promise(resolve => setTimeout(resolve, 0));
      let peak = 0;
      for (let block = 0; block < 90; block++) {
        for (const output of outputs) for (const samples of output) samples.fill(0);
        processor.process([], outputs);
        time += 128 / 44100;
        // Dry output excludes other channels and reverb tails.
        for (const samples of outputs[channel + 1]) for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      }
      expect(peak, `${bus} channel ${channel} must produce audible PCM`).toBeGreaterThan(0.0001);
      if (pass === 0) firstHits.push(peak);
      else expect(peak, `${bus} channel ${channel} must match the initial player output`).toBeCloseTo(firstHits[channel], 5);
    }
    pass++;
  }
}, 30000);

test('restores expression after automation scheduled between notes', async () => {
  const { SoundFontSynth } = await import('./soundfont');
  const sent: string[] = [];
  const backend = {
    programChange(channel: number, program: number) { sent.push(`pc${channel}:${program}`); },
    controllerChange(channel: number, controller: number, value: number) { sent.push(`cc${channel}:${controller}=${value}`); },
    noteOn() { sent.push('on'); }, noteOff() { sent.push('off'); },
    sendMessage() { sent.push('msg'); },
  };
  const synth = new (SoundFontSynth as any)(backend) as InstanceType<typeof SoundFontSynth>;
  const note = { midiNote: 60, velocity: 100, channel: 1, startTime: 1, durationSec: 0.2,
    instrument: { program: 5, volume: 90, expression: 127, pan: 64 }, bus: 'bgm' as const };
  // scheduleBgm sends all MIDI messages in a lookahead window before notes.
  synth.scheduleMidiMessage([0xb1, 11, 40], 1.5);
  synth.scheduleNote(note);
  synth.scheduleNote({ ...note, startTime: 2 });
  expect(sent).toEqual(['msg', 'msg', 'pc1:5', 'cc1:7=90', 'cc1:10=64',
    'cc1:11=127', 'on', 'off', 'cc1:11=127', 'on', 'off']);
});

test('zero-velocity hits do not touch channel state', async () => {
  const { SoundFontSynth } = await import('./soundfont');
  const sent: string[] = [];
  const backend = { programChange() { sent.push('pc'); }, controllerChange() { sent.push('cc'); },
    noteOn() { sent.push('on'); }, noteOff() {}, sendMessage() {} };
  const synth = new (SoundFontSynth as any)(backend) as InstanceType<typeof SoundFontSynth>;
  synth.scheduleNote({ midiNote: 60, velocity: 0, channel: 0, startTime: 0, durationSec: 0.1, bus: 'bgm' });
  expect(sent).toEqual([]);
});

test('reports missing AudioWorklet before reading a SoundFont', async () => {
  const { SoundFontSynth, soundFontUnavailableReason } = await import('./soundfont');
  const context = { audioWorklet: undefined } as unknown as AudioContext;
  expect(soundFontUnavailableReason(context)).toContain('AudioWorklet');
  await expect(SoundFontSynth.create(context, {} as AudioNode, new ArrayBuffer(0)))
    .rejects.toThrow('AudioWorklet');
});
