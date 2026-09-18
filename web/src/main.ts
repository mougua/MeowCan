/**
 * MeowCan - CanMusic Web Main Entry Point
 */

import { parseVos, type VosSongData, type PlayableNote } from './parser/vos';
import { AudioEngine } from './audio/synth';
import { JudgmentEngine, type HitResult } from './game/judgment';
import { CanMusicRenderer } from './game/renderer';
import { createResultData, getRoundOutcome, type RoundOutcome } from './game/result-view';
import { RoundLifecycle } from './game/round-state';

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
  private round = new RoundLifecycle();
  private roundEndSec = 0;
  private loadRequestId = 0;

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
    const initialBounds = container.getBoundingClientRect();
    await this.renderer.init({
      container,
      width: initialBounds.width || this.renderer.getLayout().stageWidth,
      height: initialBounds.height || this.renderer.getLayout().stageHeight
    });
    const savedSkin = localStorage.getItem('meowcan.noteSkin');
    if (savedSkin === 'base0' || savedSkin === 'base1') {
      await this.renderer.setNoteSkin(savedSkin);
    }
    const savedCanSkin = localStorage.getItem('meowcan.skin');
    if (savedCanSkin === 'metallic') await this.renderer.setSkin('metallic');
    new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.renderer.resize(width, height);
    }).observe(container);

    if (import.meta.env.DEV && (new URLSearchParams(location.search).has('preview') || new URLSearchParams(location.search).has('dev'))) {
      const { DevPreviewController } = await import('./dev-preview');
      await new DevPreviewController(this.renderer).init();
      if (new URLSearchParams(location.search).has('capture')) {
        this.renderer.getApp().render();
        return;
      }
      this.renderer.startLoop(() => {});
      return;
    }

    this.setupEventListeners();
    await this.loadCatalog();

    // Default select Pachelbel's Canon in D or 1st song
    const defaultIdx = this.catalog.findIndex(s => s.filename === '500.vos');
    this.selectedSongIndex = defaultIdx >= 0 ? defaultIdx : 0;

    if (this.catalog.length > 0) {
      await this.loadSongFromCatalog(this.catalog[this.selectedSongIndex]);
    }

    // Pixi updates the game before rendering it in the same ticker callback.
    this.renderer.startLoop((deltaSec) => this.gameLoop(deltaSec));

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
        const loaded = await this.loadSongFromCatalog(song);
        if (loaded && this.isAudioUnlocked) {
          this.playSong();
        }
      };
      listEl.appendChild(item);
    });
  }

  public async loadSongFromCatalog(item: SongCatalogItem): Promise<boolean> {
    const requestId = ++this.loadRequestId;
    this.prepareForSongChange();
    const displayEl = document.getElementById('song-current-display')!;
    displayEl.textContent = `加载中: ${item.title}...`;

    try {
      const resp = await fetch(`/songs/${item.filename}`);
      if (!resp.ok) throw new Error('Failed to fetch ' + item.filename);
      const arr = await resp.arrayBuffer();
      if (requestId !== this.loadRequestId) return false;
      this.loadSongData(arr, item.filename);
      return true;
    } catch (e) {
      console.error('Error loading song:', e);
      if (requestId === this.loadRequestId) displayEl.textContent = `加载失败: ${item.title}`;
      return false;
    }
  }

  private shouldStartOnLoad = false;

  public loadSongData(arr: ArrayBuffer, name = 'Song'): void {
    try {
      const parsed = parseVos(arr);
      this.prepareForSongChange();
      this.currentSong = parsed;
      console.log('Parsed VOS:', this.currentSong);

      this.judgment.setNotes(this.currentSong.playableNotes, this.currentSong.tempoMap);
      this.renderer.setSongInfo(this.currentSong.title, this.currentSong.artist, this.currentSong.level);
      this.renderer.updateCombo(0);
      this.roundEndSec = Math.max(
        this.currentSong.durationSec,
        ...this.currentSong.playableNotes.map(note => note.startSec + note.durationSec)
      ) + 2;

      const displayEl = document.getElementById('song-current-display')!;
      displayEl.textContent = `🎵 ${this.currentSong.title} - ${this.currentSong.artist} [Lv.${this.currentSong.level}]`;

      const startBtn = document.getElementById('btn-start-game');
      if (startBtn) startBtn.textContent = `▶ 开始演奏: ${this.currentSong.title}`;
      this.syncArcadeControls();

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

    this.judgment.setNotes(this.currentSong.playableNotes, this.currentSong.tempoMap);
    this.autoPlayIndex = 0;
    this.cancelInputsWithoutJudgment();
    this.renderer.resetEffects();
    this.renderer.hideResult();
    // Give even tick-zero notes a full approach, on the audio master clock.
    this.audio.startSong(this.currentSong.bgmNotes, -2);
    this.isRunning = true;
    this.round.begin();
    this.syncArcadeControls();
  }

  public restartSong(): void {
    if (!this.currentSong) return;
    this.audio.playSfx('click');
    if (this.isAudioUnlocked) {
      this.playSong();
    }
  }

  public abortSong(): void {
    if (this.round.state !== 'playing') return;
    this.isRunning = false;
    this.round.reset();
    this.cancelInputsWithoutJudgment();
    this.audio.stopSong();
    this.renderer.resetEffects();
    this.renderer.hideResult();
    if (this.currentSong) {
      this.judgment.setNotes(this.currentSong.playableNotes, this.currentSong.tempoMap);
      this.renderer.updateCombo(0);
      this.renderer.renderFrame(0, this.currentSong.playableNotes, this.judgment.score, this.currentSong.durationSec);
    }
    this.audio.playSfx('click');
    this.syncArcadeControls();
  }

  private syncArcadeControls(): void {
    const start = document.getElementById('btn-arcade-start') as HTMLButtonElement | null;
    const abort = document.getElementById('btn-arcade-abort') as HTMLButtonElement | null;
    const playing = this.round.state === 'playing';
    if (start) start.disabled = playing || !this.currentSong;
    if (abort) abort.disabled = !playing;
  }

  private setupEventListeners(): void {
    // Start Overlay click
    document.getElementById('btn-start-game')!.onclick = () => {
      this.playSong();
    };
    document.getElementById('btn-arcade-start')!.onclick = () => this.playSong();
    document.getElementById('btn-arcade-abort')!.onclick = () => this.abortSong();

    // Keyboard handlers
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLElement && (e.target.matches('input, textarea, select') || e.target.isContentEditable)) return;
      if (document.getElementById('song-modal')!.classList.contains('active')) return;
      if (e.code === 'Space') {
        e.preventDefault(); // Prevent page scroll
      }

      if (this.laneKeyMap[e.code] !== undefined) {
        e.preventDefault();
        if (this.round.state !== 'playing') return;
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
      // The canvas and the stage share one geometry table; letterbox margins
      // and any position outside the seven keys resolve to -1 and are ignored.
      const scene = this.renderer.clientToScene(e.clientX, e.clientY);
      const lane = this.renderer.hitTestKey(scene.x, scene.y);
      if (lane < 0 || this.round.state !== 'playing') return;
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
      this.autoPlayIndex = 0;
      autoBtn.textContent = this.isAutoPlay ? '🤖 自动演示: 开' : '🤖 自动演示: 关';
      autoBtn.classList.toggle('active', this.isAutoPlay);
      this.renderer.setAutoPlay(this.isAutoPlay);
      this.audio.playSfx('click');
    };

    // Original client assets expose two note variants; the manager keeps this
    // UI independent from the renderer's asset-loading details.
    const skinButton = document.getElementById('btn-skin');
    if (skinButton) {
      const syncSkinLabel = () => {
        skinButton.textContent = this.renderer.getSkin() === 'metallic'
          ? '🎨 机台: 金属'
          : '🎨 机台: 经典';
      };
      syncSkinLabel();
      skinButton.onclick = async () => {
        const next = this.renderer.getSkin() === 'metallic' ? 'classic' : 'metallic';
        await this.renderer.setSkin(next);
        localStorage.setItem('meowcan.skin', next);
        syncSkinLabel();
        this.audio.playSfx('click');
      };
    }

    const noteSkinButton = document.getElementById('btn-note-skin');
    if (noteSkinButton) {
      const syncNoteSkinLabel = () => {
        noteSkinButton.textContent = this.renderer.getNoteSkin() === 'base1'
          ? '🃏 音符: 扁平' : '🃏 音符: 花形';
      };
      syncNoteSkinLabel();
      noteSkinButton.onclick = async () => {
        const next = this.renderer.getNoteSkin() === 'base1' ? 'base0' : 'base1';
        await this.renderer.setNoteSkin(next);
        localStorage.setItem('meowcan.noteSkin', next);
        syncNoteSkinLabel();
        this.audio.playSfx('click');
      };
    }

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
        const requestId = ++this.loadRequestId;
        this.prepareForSongChange();
        const arr = await file.arrayBuffer();
        if (requestId !== this.loadRequestId) return;
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
            const requestId = ++this.loadRequestId;
            this.prepareForSongChange();
            const arr = await file.arrayBuffer();
            if (requestId !== this.loadRequestId) return;
            this.loadSongData(arr, file.name);
          this.playSong();
        }
      }
    });
  }

  private handlePlayerKeyDown(lane: number): void {
    if (!this.isRunning || !this.currentSong) return;
    this.renderer.setLaneState(lane, true);

    const curTime = this.audio.getCurrentTime();
    const hit = this.judgment.onKeyDown(lane, curTime);

    if (hit) {
      this.renderer.showHitBurst(lane);
      this.renderer.showJudgement(hit.rating);
      this.renderer.updateCombo(this.judgment.score.combo);

      // Play keysound on hit!
      // CanMusic dispatches the captured note before grading it; key-induced MISS still sounds.
      this.audio.playKeysound(hit.note.midiNote, hit.note.velocity, hit.note.track, hit.note.durationSec, hit.note.instrument);
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
  private autoPlayIndex = 0;

  private cancelInputsWithoutJudgment(): void {
    this.activeKeys.clear();
    this.autoReleases.clear();
    this.judgment.cancelActiveHolds();
    for (let lane = 0; lane < 7; lane++) this.renderer.setLaneState(lane, false);
  }

  private prepareForSongChange(): void {
    this.isRunning = false;
    this.round.reset();
    this.cancelInputsWithoutJudgment();
    this.audio.stopSong();
    this.renderer.resetEffects();
    this.renderer.hideResult();
    this.currentSong = null;
    this.syncArcadeControls();
  }

  private finishRound(outcome: RoundOutcome): void {
    const score = this.judgment.score;
    const snapshot = createResultData(outcome, score.score, score.accuracy, score.maxCombo);
    if (!this.round.finish(snapshot)) return;

    this.isRunning = false;
    this.cancelInputsWithoutJudgment();
    this.audio.stopSong();
    this.renderer.resetEffects();
    this.renderer.showResult(snapshot);
    this.syncArcadeControls();
  }

  private gameLoop(_deltaSec: number): void {
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
        const notes = this.currentSong.playableNotes;
        while (this.autoPlayIndex < notes.length) {
          const note = notes[this.autoPlayIndex];
          if (note.startSec > curTime) break;
          this.autoPlayIndex++;
          if (!note.judged) {
            // Auto hit
            this.handlePlayerKeyDown(note.lane);
            if (note.judged) this.autoReleases.set(note.lane,
              note.isLong ? note.startSec + note.durationSec : curTime + 0.08);
          }
        }
      }

      // Check misses & hold ticks
      const { misses } = this.judgment.update(curTime);
      for (const miss of misses) {
        this.renderer.showJudgement('MISS');
        this.renderer.updateCombo(0);
      }
      // Dedicated hold effects are synchronized by the renderer; hold ticks
      // intentionally do not create repeated short-note explosions.
      this.renderer.updateCombo(this.judgment.score.combo);

      // Render Pixi stage
      this.renderer.renderFrame(
        curTime,
        this.currentSong.playableNotes,
        this.judgment.score,
        this.currentSong.durationSec
      );

      // Check song completion
      if (curTime > this.roundEndSec) {
        this.finishRound(getRoundOutcome(this.judgment.score.accuracy));
      }
    }

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
