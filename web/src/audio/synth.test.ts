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

test('keeps the chart clock smooth when an output timestamp read goes stale', () => {
  const engine = new AudioEngine() as any;
  const context = {
    currentTime: 5,
    getOutputTimestamp: () => ({ contextTime: 4.6, performanceTime: performance.now() })
  };
  engine.ctx = context;
  engine.songStartTime = 1;
  engine.isPlaying = 1;
  const first = engine.getCurrentTime();
  expect(first).toBeCloseTo(3.6, 1);
  // A stale timestamp (older than the 1s trust window) must not fall back to
  // currentTime, which sits a full output latency ahead.
  context.getOutputTimestamp = () => ({ contextTime: 4.6, performanceTime: performance.now() - 1500 });
  const second = engine.getCurrentTime();
  expect(second - first).toBeGreaterThanOrEqual(0);
  expect(second - first).toBeLessThan(0.05);
  expect(second).toBeLessThan(3.8);
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

test('a stored SoundFont is reused for restart and rebuilt for a different song', async () => {
  const engine = new AudioEngine() as any;
  engine.init = async () => {};
  const loaded: object[] = [];
  engine.loadSoundFont = async (pack: { id: string }, _progress: unknown, song: object) => {
    loaded.push(song);
    engine.loadedSoundFontId = pack.id;
    engine.loadedSoundFontSong = song;
    engine.soundFontSynth = { stopAll() {}, destroy() {} };
  };
  const pack = { id: 'MagicSFver2.sf2' } as any;
  const first = {} as any;
  const second = {} as any;
  await engine.setSoundSource('soundfont', pack, undefined, first);
  await engine.setSoundSource('soundfont', pack, undefined, first);
  await engine.setSoundSource('soundfont', pack, undefined, second);
  expect(loaded).toEqual([first, second]);
});


test('practice lookahead excludes segment-end events and clips sustained accompaniment', () => {
  const engine = new AudioEngine() as any;
  engine.ctx = { currentTime: 10 };
  engine.songStartTime = 10;
  engine.isPlaying = 1;
  engine.playbackEndSec = 0.1;
  engine.soundSource = 'soundfont';
  const midi: number[] = [];
  engine.soundFontSynth = { scheduleMidiMessage(message: number[]) { midi.push(message[1]); } };
  engine.midiEvents = [
    { startSec: 0.05, message: [0xb0, 7, 90] },
    { startSec: 0.1, message: [0xb0, 11, 0] },
  ];
  engine.bgmNotes = [
    { startSec: 0.05, durationSec: 1, midiNote: 60, velocity: 100, channel: 0 },
    { startSec: 0.1, durationSec: 1, midiNote: 62, velocity: 100, channel: 0 },
  ];
  const notes: any[][] = [];
  engine.synthesizeNote = (...args: any[]) => notes.push(args);
  engine.scheduleBgm();
  expect(midi).toEqual([7]);
  expect(notes.length).toBe(1);
  expect(notes[0][4]).toBeCloseTo(0.05);
  expect(engine.bgmIndex).toBe(1);
  // Cancel the selection: the previously excluded onset becomes schedulable again.
  engine.playbackEndSec = Infinity;
  engine.scheduleBgm();
  expect(midi).toEqual([7, 11]);
  expect(notes.length).toBe(2);
});

test('practice transport scales audio, cancels voices, and resumes the seek position', () => {
  const engine = new AudioEngine() as any;
  const context = { currentTime: 10 };
  engine.ctx = context;
  const originalWindow = globalThis.window;
  globalThis.window = { setInterval: () => 123 } as any;
  try {
    const scheduled: any[][] = [];
    engine.synthesizeNote = (...args: any[]) => scheduled.push(args);
    engine.setPlaybackRate(0.5);
    engine.startSong([{ startSec: 0.05, durationSec: 2, midiNote: 60, velocity: 100, channel: 0 }], [], 0);
    expect(scheduled[0][3]).toBeCloseTo(10.1);
    expect(scheduled[0][4]).toBe(4);
    context.currentTime = 12;
    expect(engine.getCurrentTime()).toBe(1);
    let stopped = 0;
    engine.voices.add({ stop() { stopped++; } });
    engine.pauseSong();
    expect(stopped).toBe(1);
    context.currentTime = 20;
    expect(engine.getCurrentTime()).toBe(1);
    engine.seekSong(0.5);
    engine.resumeSong();
    expect(engine.getCurrentTime()).toBe(0.5);
    expect(scheduled.at(-1)[4]).toBeCloseTo(3.1);
    context.currentTime = 22;
    expect(engine.getCurrentTime()).toBe(1.5);
    engine.setPlaybackRate(2);
    expect(engine.getCurrentTime()).toBe(1.5);
    context.currentTime = 23;
    expect(engine.getCurrentTime()).toBe(3.5);
    engine.stopSong();
  } finally { globalThis.window = originalWindow; }
});
