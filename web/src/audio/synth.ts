import { instrumentVoice, type InstrumentVoice } from './instruments';
import { fetchSoundFont, SoundFontSynth } from './soundfont';
import type { SoundFontPack } from './soundfont-catalog';
import { isLocalSoundFont, readLocalSoundFont } from './local-soundfonts';
import type { MidiState } from '../parser/midi';
/**
 * CanMusic WebAudio Polyphonic Synthesizer & Sound System
 * Provides zero-latency keysound playback, accompaniment sequencer, and authentic sound effects.
 */

import type { BgmNote, TimedMidiEvent } from '../parser/vos';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private outputLimiter: DynamicsCompressorNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private keyGain: GainNode | null = null;

  // SFX buffers
  private sfxBuffers: Map<string, AudioBuffer> = new Map();

  // BGM sequencer
  private bgmNotes: BgmNote[] = [];
  private bgmIndex = 0;
  private midiEvents: TimedMidiEvent[] = [];
  private midiEventIndex = 0;
  private songStartTime = 0;
  private isPlaying = 0; // 0=stopped, 1=playing, 2=paused
  private pauseTime = 0;
  private schedulerTimer: number | null = null;
  private lookaheadMs = 120;
  private scheduleIntervalMs = 30;

  // Active voices limit
  private activeVoices = 0;
  private maxPolyphony = 96;
  private voices = new Set<AudioScheduledSourceNode>();
  private waves = new Map<number, PeriodicWave>();
  private voiceConfigs = new Map<number, InstrumentVoice>();
  private melodicOutputs = new Map<number, { filter: BiquadFilterNode; pan: StereoPannerNode }>();
  private noiseOutputs = new Map<string, BiquadFilterNode>();
  private noiseBuffer: AudioBuffer | null = null;
  private soundFontSynth: SoundFontSynth | null = null;
  private preloadPromise: Promise<void> | null = null;
  private initPromise: Promise<void> | null = null;
  private prefetchedSfx = new Map<string, ArrayBuffer>();
  private prefetchedSoundFont: ArrayBuffer | null = null;
  private loadedSoundFontId: string | null = null;
  private soundSource: SoundSource = 'procedural';
  private soundFontLoadPromise: Promise<void> | null = null;

  private static readonly SFX_ASSETS: readonly [string, string][] = [
    ['click', '/assets/sounds/click.wav'],
    ['speedup', '/assets/sounds/speedup.wav'],
    ['speeddown', '/assets/sounds/speeddown.wav'],
    ['count', '/assets/sounds/original_count.wav'],
    ['go', '/assets/sounds/original_go.wav'],
    ['result', '/assets/sounds/original_result.wav'],
  ];

  constructor() {}

  /** Downloads every audio asset before a round can be selected or started. */
  public preload(): Promise<void> {
    if (!this.preloadPromise) {
      this.preloadPromise = this.fetchAudioAssets().catch(error => {
        this.preloadPromise = null;
        throw error;
      });
    }
    return this.preloadPromise;
  }

  private async fetchAudioAssets(): Promise<void> {
    const sfx = await Promise.all(
      AudioEngine.SFX_ASSETS.map(async ([name, url]) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Sound effect request failed: ${name} (HTTP ${response.status})`);
        return [name, await response.arrayBuffer()] as const;
      })
    );
    this.prefetchedSfx = new Map(sfx);
  }

  public async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize().catch(error => {
        this.initPromise = null;
        throw error;
      });
    }
    await this.initPromise;

    if (this.ctx!.state === 'suspended') await this.ctx!.resume();
  }

  private async initialize(): Promise<void> {
    await this.preload();
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.85;
      this.outputLimiter = this.ctx.createDynamicsCompressor();
      const now = this.ctx.currentTime;
      this.outputLimiter.threshold.setValueAtTime(-1, now);
      this.outputLimiter.knee.setValueAtTime(0, now);
      this.outputLimiter.ratio.setValueAtTime(20, now);
      this.outputLimiter.attack.setValueAtTime(0.003, now);
      this.outputLimiter.release.setValueAtTime(0.1, now);
      this.masterGain.connect(this.outputLimiter);
      this.outputLimiter.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.masterGain);

      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.75;
      this.bgmGain.connect(this.masterGain);

      this.keyGain = this.ctx.createGain();
      this.keyGain.gain.value = 1.0;
      this.keyGain.connect(this.masterGain);

      // Generate noise once during user-initiated startup. Reusing this buffer
      // avoids allocating and filling tens of thousands of samples on drum hits.
      this.noiseBuffer = this.createNoiseBuffer(1);

    }
    await this.loadSfx();
  }

  public getSoundSource(): SoundSource {
    return this.soundSource;
  }

  public getLoadedSoundFontId(): string | null {
    return this.loadedSoundFontId;
  }

  public async setSoundSource(
    source: SoundSource,
    soundFont?: SoundFontPack,
    onProgress?: (progress: SoundFontLoadProgress) => void
  ): Promise<void> {
    if (source === 'procedural') {
      this.soundFontSynth?.stopAll();
      this.soundFontSynth?.destroy();
      this.soundFontSynth = null;
      this.loadedSoundFontId = null;
      this.soundFontLoadPromise = null;
      this.prefetchedSoundFont = null;
      this.soundSource = source;
      return;
    }
    if (!soundFont) throw new Error('没有可用的音源包');
    await this.init();
    if (this.loadedSoundFontId !== soundFont.id) {
      this.soundFontLoadPromise = null;
    }
    if (!this.soundFontLoadPromise) {
      this.soundFontLoadPromise = this.loadSoundFont(soundFont, onProgress).catch(error => {
        this.soundFontLoadPromise = null;
        throw error;
      });
    }
    await this.soundFontLoadPromise;
    this.soundSource = 'soundfont';
  }

  private async loadSfx(): Promise<void> {
    for (const [name] of AudioEngine.SFX_ASSETS) {
      if (this.sfxBuffers.has(name)) continue;
      const encoded = this.prefetchedSfx.get(name);
      if (!encoded) throw new Error(`Sound effect was not prefetched: ${name}`);
      const buf = await this.ctx!.decodeAudioData(encoded.slice(0));
      this.sfxBuffers.set(name, buf);
      this.prefetchedSfx.delete(name);
    }
  }

  public playSfx(name: string, delaySec = 0): void {
    if (!this.ctx || !this.sfxGain) return;
    const buf = this.sfxBuffers.get(name);
    if (!buf) return;
    try {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.sfxGain);
        this.voices.add(src);
        src.onended = () => {
          src.disconnect();
          this.voices.delete(src);
        };
        src.start(this.ctx.currentTime + Math.max(0, delaySec));
    } catch (e) {
      // ignore
    }
  }

  public getCurrentTime(): number {
    if (!this.ctx) return 0;
    if (this.isPlaying === 1) {
      // Some Android WebViews render the audio stream well behind currentTime.
      // Drive the chart and judgments from the output position; the scheduler
      // still uses currentTime so notes can be queued ahead of playback.
      const timestamp = this.ctx.getOutputTimestamp?.();
      let outputTime = this.ctx.currentTime;
      if (timestamp && timestamp.performanceTime > 0) {
        const ageSec = (performance.now() - timestamp.performanceTime) / 1000;
        if (Number.isFinite(ageSec) && ageSec >= 0 && ageSec < 1) {
          outputTime = Math.min(outputTime, Math.max(0, timestamp.contextTime + ageSec));
        }
      }
      return outputTime - this.songStartTime;
    } else if (this.isPlaying === 2) {
      return this.pauseTime;
    }
    return 0;
  }

  /** Audio graph time used when an automatic hit must be queued for output. */
  public getTransportTime(): number {
    if (!this.ctx) return 0;
    return this.isPlaying === 1 ? this.ctx.currentTime - this.songStartTime
      : this.isPlaying === 2 ? this.pauseTime : 0;
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Start song playback & BGM scheduler
   */
  public startSong(bgmNotes: BgmNote[], midiEvents: TimedMidiEvent[], startSec = 0): void {
    if (!this.ctx) return;
    this.stopSong();

    this.bgmNotes = bgmNotes;
    this.midiEvents = midiEvents;
    this.bgmIndex = 0;
    this.midiEventIndex = 0;
    while (this.bgmIndex < this.bgmNotes.length && this.bgmNotes[this.bgmIndex].startSec < startSec) {
      this.bgmIndex++;
    }
    while (this.midiEventIndex < this.midiEvents.length
      && this.midiEvents[this.midiEventIndex].startSec < startSec) {
      if (this.soundSource === 'soundfont' && this.soundFontSynth) {
        this.soundFontSynth.scheduleMidiMessage(
          this.midiEvents[this.midiEventIndex].message,
          this.ctx.currentTime
        );
      }
      this.midiEventIndex++;
    }

    this.songStartTime = this.ctx.currentTime - startSec;
    this.isPlaying = 1;

    this.schedulerTimer = window.setInterval(() => this.scheduleBgm(), this.scheduleIntervalMs);
  }

  public pauseSong(): void {
    if (this.isPlaying === 1 && this.ctx) {
      this.pauseTime = this.ctx.currentTime - this.songStartTime;
      this.isPlaying = 2;
      if (this.schedulerTimer !== null) {
        clearInterval(this.schedulerTimer);
        this.schedulerTimer = null;
      }
    }
  }

  public resumeSong(): void {
    if (this.isPlaying === 2 && this.ctx) {
      this.songStartTime = this.ctx.currentTime - this.pauseTime;
      this.isPlaying = 1;
      this.schedulerTimer = window.setInterval(() => this.scheduleBgm(), this.scheduleIntervalMs);
    }
  }

  public stopSong(): void {
    this.isPlaying = 0;
    this.pauseTime = 0;
    this.bgmNotes = [];
    this.midiEvents = [];
    this.soundFontSynth?.stopAll();
    for (const voice of this.voices) { try { voice.stop(); } catch {} }
    this.voices.clear();
    this.activeVoices = 0;
    for (const { filter, pan } of this.melodicOutputs.values()) {
      filter.disconnect();
      pan.disconnect();
    }
    this.melodicOutputs.clear();
    for (const filter of this.noiseOutputs.values()) filter.disconnect();
    this.noiseOutputs.clear();
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  /**
   * Lookahead scheduling loop for BGM
   */
  private scheduleBgm(): void {
    if (!this.ctx || this.isPlaying !== 1) return;
    const currentSongTime = this.ctx.currentTime - this.songStartTime;
    const horizon = currentSongTime + (this.lookaheadMs / 1000);

    while (this.midiEventIndex < this.midiEvents.length) {
      const event = this.midiEvents[this.midiEventIndex];
      if (event.startSec > horizon) break;
      const scheduleAudioTime = this.songStartTime + event.startSec;
      if (scheduleAudioTime >= this.ctx.currentTime - 0.05
        && this.soundSource === 'soundfont' && this.soundFontSynth) {
        this.soundFontSynth.scheduleMidiMessage(event.message, Math.max(this.ctx.currentTime, scheduleAudioTime));
      }
      this.midiEventIndex++;
    }

    while (this.bgmIndex < this.bgmNotes.length) {
      const note = this.bgmNotes[this.bgmIndex];
      if (note.startSec > horizon) break;

      const scheduleAudioTime = this.songStartTime + note.startSec;
      if (scheduleAudioTime >= this.ctx.currentTime - 0.05) {
        this.synthesizeNote(
          note.midiNote,
          note.velocity,
          note.channel,
          scheduleAudioTime,
          note.durationSec,
          this.bgmGain!,
          note.instrument,
          'bgm'
        );
      }
      this.bgmIndex++;
    }
  }

  /**
   * Trigger immediate keysound for player hit
   */
  public playKeysound(midiNote: number, velocity: number, channel: number, durationSec = 0.3, instrument?: MidiState): void {
    if (!this.ctx || !this.keyGain) return;
    const now = this.ctx.currentTime;
    this.synthesizeNote(
      midiNote,
      velocity,
      channel,
      now,
      Math.max(0.03, durationSec),
      this.keyGain,
      instrument,
      'keysound'
    );
  }

  /**
   * Sound synthesis engine
   */
  private synthesizeNote(
    midiNote: number,
    velocity: number,
    channel: number,
    startTime: number,
    durationSec: number,
    targetGain: GainNode,
    instrument?: MidiState,
    bus: 'bgm' | 'keysound' = 'bgm'
  ): void {
    if (!this.ctx) return;

    if (velocity <= 0) return;
    startTime = Math.max(this.ctx.currentTime, startTime);
    if (this.soundSource === 'soundfont' && this.soundFontSynth) {
      this.soundFontSynth.scheduleNote({
        midiNote,
        velocity,
        channel,
        startTime,
        durationSec,
        instrument,
        bus,
      });
      return;
    }

    if (this.activeVoices >= this.maxPolyphony) return;
    const vel = Math.min(1, velocity / 127) * ((instrument?.volume ?? 100) / 127) * ((instrument?.expression ?? 127) / 127);
    const isPercussion = channel === 9; // MIDI channel 10 is percussion (0-indexed 9)

    if (isPercussion) {
      this.synthesizeDrum(midiNote, vel, startTime, targetGain);
      return;
    }

    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const stopTime = startTime + Math.max(0.08, durationSec);

    const program = Math.max(0, Math.min(127, (instrument?.program ?? 0) | 0));
    let voice = this.voiceConfigs.get(program);
    if (!voice) {
      voice = instrumentVoice(program);
      this.voiceConfigs.set(program, voice);
    }
    const osc = this.ctx.createOscillator();
    let wave = this.waves.get(program);
    if (!wave) {
      wave = this.ctx.createPeriodicWave(new Float32Array(voice.harmonics.length + 1),
        Float32Array.from([0, ...voice.harmonics]));
      this.waves.set(program, wave);
    }
    osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(freq, startTime);
    const gain = this.ctx.createGain();
    const output = this.getMelodicOutput(program, instrument?.pan ?? 64, bus, voice.cutoff, targetGain);
    const peak = vel * .3;
    const attackEnd = Math.min(stopTime, startTime + voice.attack);
    const decayEnd = Math.min(stopTime, attackEnd + voice.decay);
    gain.gain.setValueAtTime(.0001, startTime);
    gain.gain.linearRampToValueAtTime(Math.max(.0001, peak), attackEnd);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0001, peak * voice.sustain), decayEnd);
    gain.gain.setValueAtTime(Math.max(.0001, peak * voice.sustain), stopTime);
    gain.gain.exponentialRampToValueAtTime(.0001, stopTime + voice.release);
    osc.connect(gain);
    gain.connect(output);
    this.voices.add(osc);
    this.activeVoices++;
    osc.onended = () => {
      if (this.voices.delete(osc)) this.activeVoices = Math.max(0, this.activeVoices - 1);
      osc.disconnect(); gain.disconnect();
    };
    osc.start(startTime);
    osc.stop(stopTime + voice.release + .01);
  }

  /**
   * Synthesize General MIDI drum sounds
   */
  private synthesizeDrum(midiNote: number, velocity: number, startTime: number, targetGain: GainNode): void {
    if (!this.ctx) return;

    if (midiNote === 35 || midiNote === 36) {
      // Bass Drum (Kick)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.setValueAtTime(140, startTime);
      osc.frequency.exponentialRampToValueAtTime(38, startTime + 0.08);

      gain.gain.setValueAtTime(velocity * 0.6, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);

      osc.connect(gain);
      gain.connect(targetGain);
      this.trackSource(osc, [gain]);
      osc.start(startTime);
      osc.stop(startTime + 0.2);
    } else if (midiNote === 38 || midiNote === 40) {
      // Snare Drum
      // Tonal body
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.frequency.setValueAtTime(185, startTime);
      osc.frequency.exponentialRampToValueAtTime(60, startTime + 0.06);
      oscGain.gain.setValueAtTime(velocity * 0.3, startTime);
      oscGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);
      osc.connect(oscGain);
      oscGain.connect(targetGain);
      this.trackSource(osc, [oscGain]);
      osc.start(startTime);
      osc.stop(startTime + 0.12);

      // Noise snare snap
      this.playNoiseBurst(startTime, 0.12, velocity * 0.35, 1200, targetGain);
    } else if (midiNote === 42 || midiNote === 44) {
      // Closed Hi-Hat
      this.playNoiseBurst(startTime, 0.04, velocity * 0.22, 6500, targetGain, 'highpass');
    } else if (midiNote === 46) {
      // Open Hi-Hat
      this.playNoiseBurst(startTime, 0.25, velocity * 0.22, 5500, targetGain, 'highpass');
    } else if (midiNote === 49 || midiNote === 57) {
      // Crash Cymbal
      this.playNoiseBurst(startTime, 0.9, velocity * 0.3, 4000, targetGain, 'highpass');
    } else {
      // Toms / other percussion
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const tomFreq = 120 + (midiNote % 12) * 15;
      osc.frequency.setValueAtTime(tomFreq, startTime);
      osc.frequency.exponentialRampToValueAtTime(tomFreq * 0.6, startTime + 0.15);

      gain.gain.setValueAtTime(velocity * 0.4, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);

      osc.connect(gain);
      gain.connect(targetGain);
      this.trackSource(osc, [gain]);
      osc.start(startTime);
      osc.stop(startTime + 0.22);
    }
  }

  private playNoiseBurst(
    startTime: number,
    durationSec: number,
    volume: number,
    filterFreq: number,
    targetGain: GainNode,
    filterType: BiquadFilterType = 'bandpass'
  ): void {
    if (!this.ctx) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer ??= this.createNoiseBuffer(1);

    const bus = targetGain === this.keyGain ? 'key' : 'bgm';
    const outputKey = `${bus}:${filterType}:${filterFreq}`;
    let filter = this.noiseOutputs.get(outputKey);
    if (!filter) {
      filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(filterFreq, this.ctx.currentTime);
      filter.connect(targetGain);
      this.noiseOutputs.set(outputKey, filter);
    }

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);

    noise.connect(gain);
    gain.connect(filter);

    this.trackSource(noise, [gain]);
    // The cached buffer is longer than most drum hits; retain their original length.
    noise.start(startTime, 0, durationSec);
    noise.stop(startTime + durationSec + 0.02);
  }

  /** A linear filter and panner can be shared by notes with the same timbre and pan. */
  private getMelodicOutput(
    program: number, midiPan: number, bus: 'bgm' | 'keysound', cutoff: number, targetGain: GainNode
  ): AudioNode {
    const panValue = Math.max(0, Math.min(127, midiPan | 0));
    const key = (bus === 'keysound' ? 16384 : 0) + program * 128 + panValue;
    let output = this.melodicOutputs.get(key);
    if (!output) {
      const filter = this.ctx!.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, this.ctx!.currentTime);
      const pan = this.ctx!.createStereoPanner();
      pan.pan.setValueAtTime((panValue - 64) / 64, this.ctx!.currentTime);
      filter.connect(pan);
      pan.connect(targetGain);
      output = { filter, pan };
      this.melodicOutputs.set(key, output);
    }
    return output.filter;
  }

  private async loadSoundFont(
    soundFont: SoundFontPack,
    onProgress?: (progress: SoundFontLoadProgress) => void
  ): Promise<void> {
    if (this.loadedSoundFontId !== soundFont.id) {
      this.prefetchedSoundFont = isLocalSoundFont(soundFont)
        ? await readLocalSoundFont(soundFont.id)
        : await fetchSoundFont(soundFont.url, (loadedBytes, totalBytes) => {
          onProgress?.({ phase: 'download', loadedBytes, totalBytes });
        });
    }
    if (this.soundFontSynth && this.loadedSoundFontId === soundFont.id) return;
    onProgress?.({
      phase: 'initialize',
      loadedBytes: this.prefetchedSoundFont.byteLength,
      totalBytes: this.prefetchedSoundFont.byteLength
    });
    const nextSynth = await SoundFontSynth.create(
      this.ctx!, this.masterGain!, this.prefetchedSoundFont
    );
    // The worklet owns its sound bank after initialization. Keeping this
    // 71 MB source buffer on the main thread needlessly raises tab memory use.
    this.prefetchedSoundFont = null;
    this.soundFontSynth?.stopAll();
    this.soundFontSynth?.destroy();
    this.soundFontSynth = nextSynth;
    this.loadedSoundFontId = soundFont.id;
    console.info(`Loaded ${soundFont.name} SoundFont audio backend.`);
  }


  private createNoiseBuffer(durationSec: number): AudioBuffer {
    const bufferSize = Math.max(256, Math.ceil(this.ctx!.sampleRate * durationSec));
    const buffer = this.ctx!.createBuffer(1, bufferSize, this.ctx!.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private trackSource(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    this.voices.add(source);
    this.activeVoices++;
    source.onended = () => {
      if (this.voices.delete(source)) this.activeVoices = Math.max(0, this.activeVoices - 1);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
  }

  public setVolume(vol: number): void {
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(Math.max(0, Math.min(1.0, vol)), this.ctx!.currentTime);
    }
  }

  public getVolume(): number {
    return this.masterGain ? this.masterGain.gain.value : 0.85;
  }
}

export type SoundSource = 'procedural' | 'soundfont';

export interface SoundFontLoadProgress {
  phase: 'download' | 'initialize';
  loadedBytes: number;
  totalBytes: number;
}
