/**
 * CanMusic WebAudio Polyphonic Synthesizer & Sound System
 * Provides zero-latency keysound playback, accompaniment sequencer, and authentic sound effects.
 */

import type { BgmNote } from '../parser/vos';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private keyGain: GainNode | null = null;

  // SFX buffers
  private sfxBuffers: Map<string, AudioBuffer> = new Map();

  // BGM sequencer
  private bgmNotes: BgmNote[] = [];
  private bgmIndex = 0;
  private songStartTime = 0;
  private isPlaying = 0; // 0=stopped, 1=playing, 2=paused
  private pauseTime = 0;
  private schedulerTimer: number | null = null;
  private lookaheadMs = 120;
  private scheduleIntervalMs = 30;

  // Active voices limit
  private activeVoices = 0;
  private maxPolyphony = 48;

  constructor() {}

  public async init(): Promise<void> {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.85;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.masterGain);

      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.75;
      this.bgmGain.connect(this.masterGain);

      this.keyGain = this.ctx.createGain();
      this.keyGain.gain.value = 1.0;
      this.keyGain.connect(this.masterGain);

      await this.loadSfx();
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  private async loadSfx(): Promise<void> {
    const sfxList: [string, string][] = [
      ['click', '/assets/sounds/click.wav'],
      ['speedup', '/assets/sounds/speedup.wav'],
      ['speeddown', '/assets/sounds/speeddown.wav'],
      ['hit_cool', '/assets/sounds/hit_cool.wav'],
      ['hit_good', '/assets/sounds/hit_good.wav'],
    ];

    for (const [name, url] of sfxList) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const arr = await resp.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(arr);
          this.sfxBuffers.set(name, buf);
        }
      } catch (e) {
        console.warn(`Could not load sfx ${name}:`, e);
      }
    }
  }

  public playSfx(name: string): void {
    if (!this.ctx || !this.sfxGain) return;
    const buf = this.sfxBuffers.get(name);
    if (!buf) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.sfxGain);
      src.start();
    } catch (e) {
      // ignore
    }
  }

  public getCurrentTime(): number {
    if (!this.ctx) return 0;
    if (this.isPlaying === 1) {
      return this.ctx.currentTime - this.songStartTime;
    } else if (this.isPlaying === 2) {
      return this.pauseTime;
    }
    return 0;
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Start song playback & BGM scheduler
   */
  public startSong(bgmNotes: BgmNote[], startSec = 0): void {
    if (!this.ctx) return;
    this.stopSong();

    this.bgmNotes = bgmNotes;
    this.bgmIndex = 0;
    while (this.bgmIndex < this.bgmNotes.length && this.bgmNotes[this.bgmIndex].startSec < startSec) {
      this.bgmIndex++;
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
          this.bgmGain!
        );
      }
      this.bgmIndex++;
    }
  }

  /**
   * Trigger immediate keysound for player hit
   */
  public playKeysound(midiNote: number, velocity: number, channel: number, durationSec = 0.3): void {
    if (!this.ctx || !this.keyGain) return;
    const now = this.ctx.currentTime;
    this.synthesizeNote(midiNote, velocity, channel, now, Math.max(0.15, durationSec), this.keyGain);
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
    targetGain: GainNode
  ): void {
    if (!this.ctx || this.activeVoices >= this.maxPolyphony) return;

    const vel = Math.min(1.0, Math.max(0.1, velocity / 127.0));
    const isPercussion = channel === 9; // MIDI channel 10 is percussion (0-indexed 9)

    this.activeVoices++;

    if (isPercussion) {
      this.synthesizeDrum(midiNote, vel, startTime, targetGain);
      setTimeout(() => { this.activeVoices = Math.max(0, this.activeVoices - 1); }, 300);
      return;
    }

    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const stopTime = startTime + Math.max(0.08, durationSec);

    // Channel-based sound character
    const isBass = channel === 1 || (midiNote < 48 && channel !== 9);
    const isLead = channel === 0 || channel === 3 || channel === 4;

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const noteGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    if (isBass) {
      osc1.type = 'sawtooth';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(freq, startTime);
      osc2.frequency.setValueAtTime(freq * 0.5, startTime); // sub-octave

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, startTime);
      filter.frequency.exponentialRampToValueAtTime(250, startTime + 0.15);

      noteGain.gain.setValueAtTime(0.001, startTime);
      noteGain.gain.linearRampToValueAtTime(vel * 0.45, startTime + 0.008);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, stopTime + 0.05);
    } else if (isLead) {
      osc1.type = 'square';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, startTime);
      osc2.frequency.setValueAtTime(freq * 1.003, startTime); // slight detune chorus

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3200, startTime);
      filter.frequency.exponentialRampToValueAtTime(1400, stopTime);

      noteGain.gain.setValueAtTime(0.001, startTime);
      noteGain.gain.linearRampToValueAtTime(vel * 0.35, startTime + 0.01);
      noteGain.gain.exponentialRampToValueAtTime(vel * 0.2, startTime + 0.08);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, stopTime + 0.06);
    } else {
      // Piano / Mallet / General
      osc1.type = 'triangle';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, startTime);
      osc2.frequency.setValueAtTime(freq * 2, startTime); // 2nd harmonic

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3600, startTime);
      filter.frequency.exponentialRampToValueAtTime(800, stopTime);

      noteGain.gain.setValueAtTime(0.001, startTime);
      noteGain.gain.linearRampToValueAtTime(vel * 0.38, startTime + 0.005);
      noteGain.gain.exponentialRampToValueAtTime(vel * 0.18, startTime + 0.1);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, stopTime + 0.05);
    }

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(noteGain);
    noteGain.connect(targetGain);

    osc1.start(startTime);
    osc2.start(startTime);
    osc1.stop(stopTime + 0.08);
    osc2.stop(stopTime + 0.08);

    osc1.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      try {
        osc1.disconnect();
        osc2.disconnect();
        filter.disconnect();
        noteGain.disconnect();
      } catch (e) {
        // ignore
      }
    };
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
    const bufferSize = Math.max(256, Math.floor(this.ctx.sampleRate * durationSec));
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, startTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(targetGain);

    noise.start(startTime);
    noise.stop(startTime + durationSec + 0.02);
  }

  public setVolume(vol: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1.0, vol));
    }
  }

  public getVolume(): number {
    return this.masterGain ? this.masterGain.gain.value : 0.85;
  }
}
