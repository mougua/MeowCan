import { expect, mock, test } from 'bun:test';

mock.module('spessasynth_lib/dist/spessasynth_processor.min.js?url', () => ({ default: 'worklet.js' }));
const { AudioEngine } = await import('./synth');

test('song clock follows the audio output position when the device buffers playback', () => {
  const engine = new AudioEngine() as any;
  engine.ctx = {
    currentTime: 5,
    getOutputTimestamp: () => ({ contextTime: 4.6, performanceTime: performance.now() })
  };
  engine.songStartTime = 1;
  engine.isPlaying = 1;
  expect(engine.getCurrentTime()).toBeCloseTo(3.6, 1);

  engine.ctx = { currentTime: 5 };
  expect(engine.getCurrentTime()).toBe(4);
});

test('procedural notes share timbre routing and release their source count', () => {
  const created = { oscillator: 0, gain: 0, filter: 0, panner: 0 };
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  const sources: Array<{ onended: (() => void) | null }> = [];
  const context = {
    currentTime: 0,
    createOscillator() {
      created.oscillator++;
      const source = { ...node(), frequency: param(), setPeriodicWave() {}, start() {}, stop() {}, onended: null };
      sources.push(source);
      return source;
    },
    createGain() { created.gain++; return { ...node(), gain: param() }; },
    createBiquadFilter() { created.filter++; return { ...node(), frequency: param(), type: 'lowpass' }; },
    createStereoPanner() { created.panner++; return { ...node(), pan: param() }; },
    createBufferSource() {
      const source = { ...node(), buffer: null, start() {}, stop() {}, onended: null };
      sources.push(source);
      return source;
    },
    createPeriodicWave() { return {}; },
  };
  const engine = new AudioEngine() as any;
  engine.ctx = context;
  const output = node();

  engine.synthesizeNote(60, 100, 0, 0, 0.3, output, { program: 0, pan: 64 });
  engine.synthesizeNote(64, 100, 0, 0, 0.3, output, { program: 0, pan: 64 });
  expect(created).toEqual({ oscillator: 2, gain: 2, filter: 1, panner: 1 });
  expect(engine.activeVoices).toBe(2);

  engine.synthesizeNote(67, 100, 0, 0, 0.3, output, { program: 0, pan: 100 });
  expect(created.filter).toBe(2);
  expect(created.panner).toBe(2);
  sources.forEach(source => source.onended?.());
  expect(engine.activeVoices).toBe(0);

  engine.noiseBuffer = {};
  engine.synthesizeNote(42, 100, 9, 0, 0.1, output);
  engine.synthesizeNote(42, 100, 9, 0, 0.1, output);
  expect(created.filter).toBe(3);
  expect(engine.activeVoices).toBe(2);
  sources.slice(3).forEach(source => source.onended?.());
  expect(engine.activeVoices).toBe(0);
  engine.stopSong();
  expect(engine.melodicOutputs.size).toBe(0);
  expect(engine.noiseOutputs.size).toBe(0);
});

test('rapid SoundFont selections load one bank at a time and keep the latest choice', async () => {
  const engine = new AudioEngine() as any;
  engine.init = async () => {};
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  engine.loadSoundFont = async (pack: { id: string }) => {
    started.push(pack.id);
    await new Promise<void>(resolve => releases.set(pack.id, resolve));
    engine.loadedSoundFontId = pack.id;
    engine.soundFontSynth = { stopAll() {}, destroy() {} };
  };
  const select = (id: string) => engine.setSoundSource('soundfont', { id });
  const first = select('first');
  await Promise.resolve();
  const second = select('second');
  await Promise.resolve();
  expect(started).toEqual(['first']);
  releases.get('first')!();
  await first;
  await Promise.resolve();
  expect(started).toEqual(['first', 'second']);
  releases.get('second')!();
  await second;
  expect(engine.loadedSoundFontId).toBe('second');
  expect(engine.getSoundSource()).toBe('soundfont');
});

test('selecting procedural audio during a bank load discards the late bank', async () => {
  const engine = new AudioEngine() as any;
  engine.init = async () => {};
  let release!: () => void;
  let destroyed = 0;
  engine.loadSoundFont = async () => {
    await new Promise<void>(resolve => { release = resolve; });
    engine.loadedSoundFontId = 'late';
    engine.soundFontSynth = { stopAll() {}, destroy() { destroyed++; } };
  };
  const loading = engine.setSoundSource('soundfont', { id: 'late' });
  await Promise.resolve();
  await engine.setSoundSource('procedural');
  release();
  await loading;
  await Promise.resolve();
  expect(engine.getSoundSource()).toBe('procedural');
  expect(engine.loadedSoundFontId).toBeNull();
  expect(destroyed).toBe(1);
});
