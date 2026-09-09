/**
 * MeowCan - CanMusic Web Main Entry Point
 */

import { parseVos, type VosSongData, type PlayableNote } from './parser/vos';
import { AudioEngine } from './audio/synth';
import { JudgmentEngine, type HitResult } from './game/judgment';
import { CanMusicRenderer } from './game/renderer';

interface SongCatalogItem {
  filename: string;
  format: string;
  title: string;
  artist: string;
  arranger: string;
  level: number;
  notes: number;
  durationSec: number;
}

class CanMusicGame {
  private renderer: CanMusicRenderer;
  private audio: AudioEngine;
  private judgment: JudgmentEngine;

  private currentSong: VosSongData | null = null;
  private catalog: SongCatalogItem[] = [];
  private selectedSongIndex = 0;

  private isAutoPlay = false;
  private isRunning = false;
  private isAudioUnlocked = false;

  // Key tracking to prevent key repeat
  private activeKeys: Map<string, number> = new Map();
  private autoReleases: Map<number, number> = new Map();
  private laneKeyMap: Record<string, number> = {
    'KeyS': 0,
    'KeyD': 1,
    'KeyF': 2,
    'Space': 3,
    'KeyJ': 4,
    'KeyK': 5,
    'KeyL': 6,
    // Alternative / Ergonomic mappings
    'KeyA': 0,
    'Semicolon': 6,
    'Digit1': 0,
    'Digit2': 1,
    'Digit3': 2,
    'Digit4': 3,
    'Digit5': 4,
    'Digit6': 5,
    'Digit7': 6
  };

  constructor() {
    this.renderer = new CanMusicRenderer();
    this.audio = new AudioEngine();
    this.judgment = new JudgmentEngine();
  }

  public async start(): Promise<void> {
    const container = document.getElementById('game-canvas-container')!;
    await this.renderer.init({
      container,
      width: 800,
      height: 600
    });

    this.setupEventListeners();
    await this.loadCatalog();

    // Default select Pachelbel's Canon in D or 1st song
    const defaultIdx = this.catalog.findIndex(s => s.filename === '500.vos');
    this.selectedSongIndex = defaultIdx >= 0 ? defaultIdx : 0;

    if (this.catalog.length > 0) {
      await this.loadSongFromCatalog(this.catalog[this.selectedSongIndex]);
    }

    // Start render loop
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  private async loadCatalog(): Promise<void> {
    try {
      const resp = await fetch('/songs.json');
      if (resp.ok) {
        this.catalog = await resp.json();
        this.renderSongModalList();
      }
    } catch (e) {
      console.warn('Could not load song catalog:', e);
    }
  }

  private renderSongModalList(filter = ''): void {
    const listEl = document.getElementById('song-list')!;
    listEl.innerHTML = '';

    const lowerFilter = filter.toLowerCase().trim();
    const filtered = this.catalog.filter(s =>
      !lowerFilter ||
      s.title.toLowerCase().includes(lowerFilter) ||
      s.artist.toLowerCase().includes(lowerFilter) ||
      `lv.${s.level}`.includes(lowerFilter)
    );

    filtered.forEach((song, idx) => {
      const item = document.createElement('div');
      item.className = 'song-item' + (song.filename === this.catalog[this.selectedSongIndex]?.filename ? ' selected' : '');
      item.innerHTML = `
        <div class="song-item-info">
          <div class="song-item-title">${escapeHtml(song.title)}</div>
          <div class="song-item-artist">${escapeHtml(song.artist)} • ${song.format}</div>
        </div>
        <div class="song-item-meta">
          <span class="level-badge">Lv.${song.level}</span>
          <span class="notes-badge">${song.notes} Notes</span>
        </div>
      `;
      item.onclick = async () => {
        const originalIdx = this.catalog.findIndex(s => s.filename === song.filename);
        this.selectedSongIndex = originalIdx >= 0 ? originalIdx : idx;
        document.getElementById('song-modal')!.classList.remove('active');
        await this.loadSongFromCatalog(song);
        if (this.isAudioUnlocked) {
          this.playSong();
        }
      };
      listEl.appendChild(item);
    });
  }

  public async loadSongFromCatalog(item: SongCatalogItem): Promise<void> {
    const displayEl = document.getElementById('song-current-display')!;
    displayEl.textContent = `加载中: ${item.title}...`;

    try {
      const resp = await fetch(`/songs/${item.filename}`);
      if (!resp.ok) throw new Error('Failed to fetch ' + item.filename);
      const arr = await resp.arrayBuffer();
      this.loadSongData(arr, item.filename);
    } catch (e) {
      console.error('Error loading song:', e);
      displayEl.textContent = `加载失败: ${item.title}`;
    }
  }

  private shouldStartOnLoad = false;

  public loadSongData(arr: ArrayBuffer, name = 'Song'): void {
    try {
      this.currentSong = parseVos(arr);
      console.log('Parsed VOS:', this.currentSong);

      this.judgment.setNotes(this.currentSong.playableNotes);
      this.renderer.setSongInfo(this.currentSong.title, this.currentSong.artist, this.currentSong.level);
      this.renderer.updateCombo(0);

      const displayEl = document.getElementById('song-current-display')!;
      displayEl.textContent = `🎵 ${this.currentSong.title} - ${this.currentSong.artist} [Lv.${this.currentSong.level}]`;

      const startBtn = document.getElementById('btn-start-game');
      if (startBtn) startBtn.textContent = `▶ 开始演奏: ${this.currentSong.title}`;

      this.renderer.renderFrame(0, this.currentSong.playableNotes, this.judgment.score, this.currentSong.durationSec);
      if (this.shouldStartOnLoad) {
        this.shouldStartOnLoad = false;
        this.playSong();
      }
    } catch (e) {
      alert('解析 VOS 谱面失败: ' + (e as Error).message);
    }
  }

  public async playSong(): Promise<void> {
    await this.audio.init();
    this.isAudioUnlocked = true;
    document.getElementById('start-overlay')!.classList.add('hidden');

    if (!this.currentSong) {
      this.shouldStartOnLoad = true;
      return;
    }

    this.judgment.setNotes(this.currentSong.playableNotes);
    this.releaseInputs();
    this.renderer.resetEffects();
    // Give even tick-zero notes a full approach, on the audio master clock.
    this.audio.startSong(this.currentSong.bgmNotes, -2);
    this.isRunning = true;
  }

  public restartSong(): void {
    if (!this.currentSong) return;
    this.audio.stopSong();
    this.judgment.setNotes(this.currentSong.playableNotes);
    this.renderer.updateCombo(0);
    this.audio.playSfx('click');
    if (this.isAudioUnlocked) {
      this.playSong();
    }
  }

  private setupEventListeners(): void {
    // Start Overlay click
    document.getElementById('btn-start-game')!.onclick = () => {
      this.playSong();
    };

    // Keyboard handlers
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLElement && (e.target.matches('input, textarea, select') || e.target.isContentEditable)) return;
      if (document.getElementById('song-modal')!.classList.contains('active')) return;
      if (e.code === 'Space') {
        e.preventDefault(); // Prevent page scroll
      }

      if (this.laneKeyMap[e.code] !== undefined) {
        e.preventDefault();
        const lane = this.laneKeyMap[e.code];
        if (!this.activeKeys.has(e.code)) {
          const alreadyPressed = [...this.activeKeys.values()].includes(lane);
          this.activeKeys.set(e.code, lane);
          if (!alreadyPressed) this.handlePlayerKeyDown(lane);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (this.activeKeys.has(e.code)) {
        e.preventDefault();
        const lane = this.laneKeyMap[e.code];
        this.activeKeys.delete(e.code);
        if (![...this.activeKeys.values()].includes(lane)) this.handlePlayerKeyUp(lane);
      }
    });

    window.addEventListener('blur', () => this.releaseInputs());
    const canvas = document.querySelector('canvas')!;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      const bounds = canvas.getBoundingClientRect();
      const x = (e.clientX - bounds.left) * 716 / bounds.width;
      const y = (e.clientY - bounds.top) * 516 / bounds.height;
      const lane = Math.floor((x - this.renderer.PLAY_X) / this.renderer.LANE_WIDTH);
      if (lane < 0 || lane > 6 || y < 480 || y > 504) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const alreadyPressed = [...this.activeKeys.values()].includes(lane);
      this.activeKeys.set(`pointer:${e.pointerId}`, lane);
      if (!alreadyPressed) this.handlePlayerKeyDown(lane);
    });
    const releasePointer = (e: PointerEvent) => {
      const key = `pointer:${e.pointerId}`;
      const lane = this.activeKeys.get(key);
      if (lane === undefined) return;
      this.activeKeys.delete(key);
      if (![...this.activeKeys.values()].includes(lane)) this.handlePlayerKeyUp(lane);
    };
    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', releasePointer);
    canvas.addEventListener('lostpointercapture', releasePointer);

    // UI Buttons
    document.getElementById('btn-song-select')!.onclick = () => {
      this.audio.playSfx('click');
      document.getElementById('song-modal')!.classList.add('active');
    };
    document.getElementById('btn-close-modal')!.onclick = () => {
      this.audio.playSfx('click');
      document.getElementById('song-modal')!.classList.remove('active');
    };
    document.getElementById('search-input')!.oninput = (e) => {
      this.renderSongModalList((e.target as HTMLInputElement).value);
    };

    // Speed Controls
    document.getElementById('btn-speed-up')!.onclick = () => {
      const speeds = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0];
      const cur = this.renderer.speedMultiplier;
      const next = speeds.find(s => s > cur) || 4.0;
      this.renderer.setSpeed(next);
      this.audio.playSfx('speedup');
    };
    document.getElementById('btn-speed-down')!.onclick = () => {
      const speeds = [4.0, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5];
      const cur = this.renderer.speedMultiplier;
      const prev = speeds.find(s => s < cur) || 0.5;
      this.renderer.setSpeed(prev);
      this.audio.playSfx('speeddown');
    };

    // Auto Play Toggle
    const autoBtn = document.getElementById('btn-auto')!;
    autoBtn.onclick = () => {
      this.isAutoPlay = !this.isAutoPlay;
      this.releaseInputs();
      autoBtn.textContent = this.isAutoPlay ? '🤖 自动演示: 开' : '🤖 自动演示: 关';
      autoBtn.classList.toggle('active', this.isAutoPlay);
      this.renderer.setAutoPlay(this.isAutoPlay);
      this.audio.playSfx('click');
    };

    // Restart
    document.getElementById('btn-restart')!.onclick = () => {
      this.restartSong();
    };

    // File Upload
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    document.getElementById('btn-upload')!.onclick = () => {
      this.audio.playSfx('click');
      fileInput.click();
    };
    fileInput.onchange = async () => {
      if (fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const arr = await file.arrayBuffer();
        this.loadSongData(arr, file.name);
        this.playSong();
      }
    };

    // Drag & Drop
    const dropOverlay = document.getElementById('drop-overlay')!;
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropOverlay.classList.add('dragover');
    });
    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) {
        dropOverlay.classList.remove('dragover');
      }
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropOverlay.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.toLowerCase().endsWith('.vos')) {
          const arr = await file.arrayBuffer();
          this.loadSongData(arr, file.name);
          this.playSong();
        }
      }
    });
  }

  private handlePlayerKeyDown(lane: number): void {
    this.renderer.setLaneState(lane, true);
    if (!this.isRunning || !this.currentSong) return;

    const curTime = this.audio.getCurrentTime();
    const hit = this.judgment.onKeyDown(lane, curTime);

    if (hit) {
      this.renderer.showHitBurst(lane);
      this.renderer.showJudgement(hit.rating);
      this.renderer.updateCombo(this.judgment.score.combo);

      // Play keysound on hit!
      if (hit.rating === 'COOL' || hit.rating === 'GOOD') {
        this.audio.playKeysound(hit.note.midiNote, hit.note.velocity, hit.note.track, hit.note.durationSec);
        this.audio.playSfx(hit.rating === 'COOL' ? 'hit_cool' : 'hit_good');
      } else if (hit.rating === 'BAD') {
        // Muted / quieter keysound
        this.audio.playKeysound(hit.note.midiNote, Math.floor(hit.note.velocity * 0.4), hit.note.track, 0.1);
      }
    }
  }

  private handlePlayerKeyUp(lane: number): void {
    this.renderer.setLaneState(lane, false);
    if (!this.isRunning || !this.currentSong) return;

    const curTime = this.audio.getCurrentTime();
    const releaseResult = this.judgment.onKeyUp(lane, curTime);
    if (releaseResult) {
      this.renderer.showJudgement(releaseResult.rating);
      if (releaseResult.rating === 'COOL') this.renderer.showHitBurst(lane);
      this.renderer.updateCombo(this.judgment.score.combo);
    }
  }

  private releaseInputs(): void {
    this.activeKeys.clear();
    this.autoReleases.clear();
    for (let lane = 0; lane < 7; lane++) this.handlePlayerKeyUp(lane);
  }

  /**
   * Main frame update & render loop
   */
  private gameLoop(timeMs: number): void {
    if (this.isRunning && this.currentSong) {
      const curTime = this.audio.getCurrentTime();

      // Auto-Play AI
      if (this.isAutoPlay) {
        for (const [lane, releaseTime] of this.autoReleases) {
          if (curTime >= releaseTime) {
            this.handlePlayerKeyUp(lane);
            this.autoReleases.delete(lane);
          }
        }
        for (const note of this.currentSong.playableNotes) {
          if (note.startSec > curTime) break;
          if (!note.judged && curTime - note.startSec <= this.judgment.BAD_WINDOW) {
            // Auto hit
            this.handlePlayerKeyDown(note.lane);
            if (note.judged) this.autoReleases.set(note.lane,
              note.isLong ? note.startSec + note.durationSec : curTime + 0.08);
          }
        }
      }

      // Check misses & hold ticks
      const { misses, holdTicks } = this.judgment.update(curTime);
      for (const miss of misses) {
        this.renderer.showJudgement('MISS');
        this.renderer.updateCombo(0);
      }
      for (const hold of holdTicks) {
        this.renderer.showHitBurst(hold.lane);
      }
      this.renderer.updateCombo(this.judgment.score.combo);

      // Render Pixi stage
      this.renderer.renderFrame(
        curTime,
        this.currentSong.playableNotes,
        this.judgment.score,
        this.currentSong.durationSec
      );

      // Check song completion
      if (curTime > this.currentSong.durationSec + 2.0) {
        this.isRunning = false;
        this.releaseInputs();
        this.audio.stopSong();
      }
    }

    requestAnimationFrame((t) => this.gameLoop(t));
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new CanMusicGame();
  game.start().catch((err) => console.error('Game start failed:', err));
  (window as unknown as { __canMusicGame: CanMusicGame }).__canMusicGame = game;
});
