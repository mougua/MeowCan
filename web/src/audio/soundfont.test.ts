import { afterEach, expect, mock, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

mock.module('spessasynth_lib/dist/spessasynth_processor.min.js?url', () => ({ default: 'worklet.js' }));

const bankPath = new URL('../../public/assets/soundfonts/MagicSFver2.sf2', import.meta.url);
const originalFetch = globalThis.fetch;
const originalWorklet = globalThis.AudioWorkletNode;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.AudioWorkletNode = originalWorklet;
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

test.skipIf(!existsSync(bankPath))('real SoundFont renders player hits on every MIDI channel after startup and restart', async () => {
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
  globalThis.fetch = mock(async () => new Response(readFileSync(bankPath)));
  const { SoundFontSynth } = await import('./soundfont');
  const synth = await SoundFontSynth.create({
    currentTime: 0,
    audioWorklet: { addModule: async () => undefined },
  } as unknown as AudioContext, {} as AudioNode);
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
