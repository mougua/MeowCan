/**
 * MeowCan - CanMusic Web Main Entry Point
 */

import { parseVos, type VosSongData, type PlayableNote } from './parser/vos';
import { AudioEngine } from './audio/synth';
import { JudgmentEngine, type HitResult } from './game/judgment';
import { CanMusicRenderer, type PlaylistItemDisplay } from './game/renderer';
import { createResultData, getRoundOutcome, type RoundOutcome } from './game/result-view';
import { RoundLifecycle } from './game/round-state';
import { downloadChart } from './game/chart-exporter';
import { AuthController } from './auth-ui';
import { LeaderboardController } from './leaderboard-ui';
import {
  DEFAULT_LANE_KEYS, bindingsToLaneMap, isLaneKeyBindings, keyLabel,
  type LaneKeyBinding
} from './game/key-bindings';
import './shell.css';

export interface SongCatalogItem {
  id: number;
  filename: string;
  genre: string;
  title: string;
  artist: string;
  charter: string;
  level: number;
  durationSec: number;
  notes: number;
  popularity: number;
  format?: string;
  fileBuffer?: ArrayBuffer;
}

class CanMusicGame {
  private renderer: CanMusicRenderer;
  private audio: AudioEngine;
  private judgment: JudgmentEngine;
  private auth = new AuthController();
  private leaderboard = new LeaderboardController();

  private currentSong: VosSongData | null = null;
  private currentSongId: number | null = null;
  private catalog: SongCatalogItem[] = [];
  private playlist: SongCatalogItem[] = [];
  private currentPlaylistIndex = 0;
  private catalogOnline = false;

  // Selection & Modal States
  private selectedCatalogIds: Set<number> = new Set();
  private favorites: Set<number> = new Set();
  private currentTab: 'catalog' | 'favorites' | 'playlist' = 'catalog';
  private activeDifficultyFilters: Set<number> = new Set();
  private searchKeyword = '';
  private selectedGenre = '所有';
  private sortColumn: 'id' | 'title' | 'level' | 'popularity' | 'duration' = 'level';
  private sortAscending = true;
  private filteredCatalog: SongCatalogItem[] = [];
  private visibleRowCount = 100;
  private lastSelectedRowIndex = -1;
  private selectedPlaylistIndices: Set<number> = new Set();
  private lastSelectedPlaylistIndex = -1;

  private isAutoPlay = false;
  private isRunning = false;
  private isAudioUnlocked = false;
  private round = new RoundLifecycle();
  private roundEndSec = 0;
  private loadRequestId = 0;
  private advancePlaylistOnNextPlay = false;

  // Key tracking to prevent key repeat
  private activeKeys: Map<string, number> = new Map();
  private autoReleases: Map<number, number> = new Map();
  private laneKeys: LaneKeyBinding[] = DEFAULT_LANE_KEYS.map(binding => ({ ...binding }));
  private laneKeyMap: ReadonlyMap<string, number> = bindingsToLaneMap(this.laneKeys);
  private pendingLaneKeys: LaneKeyBinding[] = [];
  private capturingLane: number | null = null;

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
    if (savedCanSkin === 'metallic' || savedCanSkin === 'mobile') await this.renderer.setSkin(savedCanSkin);
    document.body.dataset.skin = this.renderer.getSkin();
    try {
      const savedSpeed = localStorage.getItem('meowcan.speedGear');
      if (savedSpeed) {
        const gear = parseInt(savedSpeed, 10);
        if (gear >= 1 && gear <= 14) {
          this.renderer.setSpeed(gear);
        }
      }
    } catch {
      // ignore
    }
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

    this.loadKeyBindings();
    this.setupEventListeners();
    this.initKeySettings();
    this.initSongSelectModal();
    this.leaderboard.init();
    this.auth.onSessionChange(user => this.leaderboard.setUser(user));
    await Promise.all([this.auth.init(), this.loadCatalog()]);

    // Pixi updates the game before rendering it in the same ticker callback.
    this.renderer.startLoop((deltaSec) => this.gameLoop(deltaSec));

    if (new URLSearchParams(location.search).has('modal')) {
      document.getElementById('song-modal')?.classList.add('active');
    }
  }

  private async loadCatalog(): Promise<void> {
    this.catalogOnline = false;
    try {
      try {
        const response = await fetch('/api/songs?limit=10000&sort=id&order=asc');
        if (!response.ok) throw new Error(`API catalog request failed (${response.status})`);
        const page = await response.json() as { items: SongCatalogItem[] };
        this.catalog = page.items;
        this.catalogOnline = true;
      } catch (apiError) {
        console.warn('Song API unavailable; using the offline catalog.', apiError);
        const response = await fetch('/songs.json');
        if (!response.ok) throw new Error(`offline catalog request failed (${response.status})`);
        this.catalog = await response.json();
      }

      if (this.catalogOnline) {
        this.restorePlaylist();
        this.syncPlaylistToRenderer();
        if (this.playlist.length > 0) await this.loadCurrentPlaylistItem(false);
      }
      this.applyFilters();
    } catch (e) {
      console.warn('Could not load song catalog:', e);
    }
  }

  // --- Modal & Search / Playlist Implementation ---

  private initSongSelectModal(): void {
    // Load favorites from localStorage
    try {
      const savedFavs = localStorage.getItem('meowcan.favorites');
      if (savedFavs) {
        const parsed = JSON.parse(savedFavs);
        if (Array.isArray(parsed)) {
          this.favorites = new Set(parsed);
        }
      }
    } catch {
      // ignore
    }

    // Tabs
    const tabBtns = document.querySelectorAll('.win-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = (btn as HTMLElement).dataset.tab as 'catalog' | 'favorites' | 'playlist';
        this.switchTab(tab);
        this.audio.playSfx('click');
      });
    });

    // Difficulty Checkboxes
    const diffCbs = document.querySelectorAll('.diff-cb') as NodeListOf<HTMLInputElement>;
    diffCbs.forEach(cb => {
      cb.addEventListener('change', () => {
        const val = parseInt(cb.value, 10);
        if (cb.checked) {
          this.activeDifficultyFilters.add(val);
        } else {
          this.activeDifficultyFilters.delete(val);
        }
        this.applyFilters();
      });
    });

    // Search input
    const searchInput = document.getElementById('modal-search-input') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.searchKeyword = searchInput.value.trim().toLowerCase();
        this.applyFilters();
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.searchKeyword = searchInput.value.trim().toLowerCase();
          this.applyFilters();
        }
      });
    }

    const btnSearchGo = document.getElementById('btn-search-go');
    if (btnSearchGo && searchInput) {
      btnSearchGo.addEventListener('click', () => {
        this.searchKeyword = searchInput.value.trim().toLowerCase();
        this.applyFilters();
      });
    }

    const btnSearchClean = document.getElementById('btn-search-clean');
    if (btnSearchClean && searchInput) {
      btnSearchClean.addEventListener('click', () => {
        searchInput.value = '';
        this.searchKeyword = '';
        this.applyFilters();
      });
    }

    // Genre select
    const genreSelect = document.getElementById('genre-select') as HTMLSelectElement | null;
    if (genreSelect) {
      genreSelect.addEventListener('change', () => {
        this.selectedGenre = genreSelect.value;
        this.applyFilters();
      });
    }

    // Table Header Sort Clicks
    const sortHeaders = document.querySelectorAll('.win-table th.sortable');
    sortHeaders.forEach(th => {
      th.addEventListener('click', () => {
        const col = (th as HTMLElement).dataset.sort as 'id' | 'title' | 'level' | 'popularity' | 'duration';
        if (this.sortColumn === col) {
          this.sortAscending = !this.sortAscending;
        } else {
          this.sortColumn = col;
          this.sortAscending = col === 'title' || col === 'id';
        }
        this.updateSortIndicators();
        this.applyFilters();
      });
    });

    // Infinite scroll for catalog table
    const catalogViewport = document.getElementById('catalog-viewport');
    if (catalogViewport) {
      catalogViewport.addEventListener('scroll', () => {
        if (catalogViewport.scrollTop + catalogViewport.clientHeight >= catalogViewport.scrollHeight - 150) {
          if (this.visibleRowCount < this.filteredCatalog.length) {
            this.visibleRowCount += 80;
            this.renderCatalogTable(false);
          }
        }
      });
    }

    // Action Buttons
    document.getElementById('btn-add-selected')?.addEventListener('click', () => {
      this.addSelectedToPlaylist();
      this.audio.playSfx('click');
    });

    document.getElementById('btn-add-unselected')?.addEventListener('click', () => {
      this.addUnselectedToPlaylist();
      this.audio.playSfx('click');
    });

    document.getElementById('btn-del-selected')?.addEventListener('click', () => {
      this.deleteSelectedSongs();
      this.audio.playSfx('click');
    });

    document.getElementById('btn-clear-playlist')?.addEventListener('click', () => {
      this.clearPlaylist();
      this.audio.playSfx('click');
    });

    document.getElementById('btn-add-favorite')?.addEventListener('click', () => {
      this.toggleFavorites();
      this.audio.playSfx('click');
    });

    document.getElementById('btn-random-select')?.addEventListener('click', () => {
      this.randomSelect();
      this.audio.playSfx('click');
    });

    document.getElementById('btn-reload-list')?.addEventListener('click', () => {
      this.reloadCatalog();
      this.audio.playSfx('click');
    });

    document.getElementById('btn-modal-export-chart')?.addEventListener('click', () => {
      this.exportSelectedChart();
      this.audio.playSfx('click');
    });

    document.getElementById('btn-confirm-selection')?.addEventListener('click', () => {
      this.confirmSelection();
      this.audio.playSfx('click');
    });

    // Check all checkbox in playlist view
    const playlistCheckAll = document.getElementById('playlist-check-all') as HTMLInputElement | null;
    if (playlistCheckAll) {
      playlistCheckAll.addEventListener('change', () => {
        if (playlistCheckAll.checked) {
          this.playlist.forEach((_, idx) => this.selectedPlaylistIndices.add(idx));
        } else {
          this.selectedPlaylistIndices.clear();
        }
        this.updatePlaylistRowSelectionStyles();
        this.updateStatus();
      });
    }

    // Close Modal Button
    document.getElementById('btn-close-modal')?.addEventListener('click', () => {
      this.closeModal();
      this.audio.playSfx('click');
    });

    // Global Modal Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      const modal = document.getElementById('song-modal');
      if (!modal || !modal.classList.contains('active')) return;

      if (e.key === 'Escape') {
        this.closeModal();
        return;
      }

      if (e.key === 'Delete') {
        if (e.target instanceof HTMLElement && (e.target.matches('input, textarea, select') || e.target.isContentEditable)) return;
        e.preventDefault();
        this.deleteSelectedSongs();
        return;
      }

      if (e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 's') {
          e.preventDefault();
          this.addSelectedToPlaylist();
        } else if (key === 'r') {
          e.preventDefault();
          this.addUnselectedToPlaylist();
        } else if (key === 'd') {
          e.preventDefault();
          this.deleteSelectedSongs();
        } else if (key === 'c') {
          e.preventDefault();
          this.clearPlaylist();
        } else if (key === 'f') {
          e.preventDefault();
          this.toggleFavorites();
        } else if (key === 'm') {
          e.preventDefault();
          this.randomSelect();
        } else if (key === 'l') {
          e.preventDefault();
          this.reloadCatalog();
        } else if (key === 'o') {
          e.preventDefault();
          this.confirmSelection();
        }
      }
    });
  }

  private switchTab(tab: 'catalog' | 'favorites' | 'playlist'): void {
    this.currentTab = tab;
    document.querySelectorAll('.win-tab-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
    });

    const catalogViewport = document.getElementById('catalog-viewport');
    const playlistViewport = document.getElementById('playlist-viewport');
    const filtersRow = document.getElementById('win-filters-row');

    if (tab === 'playlist') {
      catalogViewport?.classList.add('hidden');
      playlistViewport?.classList.remove('hidden');
      filtersRow?.classList.add('hidden');
      this.renderPlaylistTable();
    } else {
      catalogViewport?.classList.remove('hidden');
      playlistViewport?.classList.add('hidden');
      filtersRow?.classList.remove('hidden');
      this.applyFilters();
    }
  }

  private applyFilters(): void {
    let list = this.catalog;

    // Tab filter (favorites)
    if (this.currentTab === 'favorites') {
      list = list.filter(s => this.favorites.has(s.id));
    }

    // Difficulty filter
    if (this.activeDifficultyFilters.size > 0) {
      list = list.filter(s => this.activeDifficultyFilters.has(s.level));
    }

    // Genre filter
    if (this.selectedGenre && this.selectedGenre !== '所有') {
      const g = this.selectedGenre.toLowerCase();
      list = list.filter(s => (s.genre || '').toLowerCase() === g);
    }

    // Keyword filter
    if (this.searchKeyword) {
      const q = this.searchKeyword;
      list = list.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.charter.toLowerCase().includes(q) ||
        String(s.id).includes(q)
      );
    }

    // Sort
    const col = this.sortColumn;
    const asc = this.sortAscending;
    list = [...list].sort((a, b) => {
      let valA: any = a.id;
      let valB: any = b.id;
      if (col === 'title') {
        valA = a.title.toLowerCase();
        valB = b.title.toLowerCase();
      } else if (col === 'level') {
        valA = a.level;
        valB = b.level;
      } else if (col === 'popularity') {
        valA = a.popularity || 0;
        valB = b.popularity || 0;
      } else if (col === 'duration') {
        valA = a.durationSec;
        valB = b.durationSec;
      }
      if (valA < valB) return asc ? -1 : 1;
      if (valA > valB) return asc ? 1 : -1;
      return a.id - b.id;
    });

    this.filteredCatalog = list;
    this.visibleRowCount = 100;
    this.renderCatalogTable(true);
    this.updateStatus();
  }

  private updateSortIndicators(): void {
    const ids = ['id', 'title', 'level', 'popularity', 'duration'];
    for (const id of ids) {
      const el = document.getElementById(`sort-ind-${id}`);
      if (el) {
        if (this.sortColumn === id) {
          el.textContent = this.sortAscending ? '▲' : '▼';
        } else {
          el.textContent = '';
        }
      }
    }
  }

  private renderCatalogTable(resetScroll = false): void {
    const tbody = document.getElementById('song-table-body');
    const emptyMsg = document.getElementById('table-empty-msg');
    if (!tbody) return;

    if (resetScroll) {
      const viewport = document.getElementById('catalog-viewport');
      if (viewport) viewport.scrollTop = 0;
      tbody.innerHTML = '';
    }

    const currentCount = tbody.children.length;
    const targetCount = Math.min(this.filteredCatalog.length, this.visibleRowCount);

    if (this.filteredCatalog.length === 0) {
      emptyMsg?.classList.remove('hidden');
    } else {
      emptyMsg?.classList.add('hidden');
    }

    const fragment = document.createDocumentFragment();
    for (let i = currentCount; i < targetCount; i++) {
      const song = this.filteredCatalog[i];
      const tr = document.createElement('tr');
      tr.dataset.id = String(song.id);
      tr.dataset.index = String(i);
      if (this.selectedCatalogIds.has(song.id)) {
        tr.classList.add('selected');
      }

      const displayTitle = song.charter ? `${song.title} / ${song.charter}` : song.title;
      tr.innerHTML = `
        <td class="col-id">${song.id}</td>
        <td class="col-title" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</td>
        <td class="col-level">${song.level}</td>
        <td class="col-pop">${song.popularity ? song.popularity.toLocaleString() : '-'}</td>
        <td class="col-len">${formatDuration(song.durationSec)}</td>
      `;

      tr.addEventListener('click', (e) => {
        this.handleRowClick(song.id, i, e);
      });

      tr.addEventListener('dblclick', async () => {
        // Double click selects and loads; starting remains an explicit action.
        this.playlist = [song];
        this.currentPlaylistIndex = 0;
        this.syncPlaylistToRenderer();
        this.closeModal();
        await this.loadSongFromCatalog(song);
      });

      fragment.appendChild(tr);
    }
    tbody.appendChild(fragment);
  }

  private handleRowClick(songId: number, rowIndex: number, e: MouseEvent): void {
    if (e.ctrlKey || e.metaKey) {
      if (this.selectedCatalogIds.has(songId)) {
        this.selectedCatalogIds.delete(songId);
      } else {
        this.selectedCatalogIds.add(songId);
      }
      this.lastSelectedRowIndex = rowIndex;
    } else if (e.shiftKey && this.lastSelectedRowIndex >= 0) {
      const start = Math.min(this.lastSelectedRowIndex, rowIndex);
      const end = Math.max(this.lastSelectedRowIndex, rowIndex);
      this.selectedCatalogIds.clear();
      for (let i = start; i <= end; i++) {
        if (this.filteredCatalog[i]) {
          this.selectedCatalogIds.add(this.filteredCatalog[i].id);
        }
      }
    } else {
      this.selectedCatalogIds.clear();
      this.selectedCatalogIds.add(songId);
      this.lastSelectedRowIndex = rowIndex;
    }
    this.updateRowSelectionStyles();
    this.updateStatus();
  }

  private updateRowSelectionStyles(): void {
    const tbody = document.getElementById('song-table-body');
    if (!tbody) return;
    for (let i = 0; i < tbody.children.length; i++) {
      const row = tbody.children[i] as HTMLElement;
      const id = parseInt(row.dataset.id || '0', 10);
      row.classList.toggle('selected', this.selectedCatalogIds.has(id));
    }
  }

  private updatePlaylistRowSelectionStyles(): void {
    const tbody = document.getElementById('playlist-table-body');
    if (!tbody) return;
    for (let i = 0; i < tbody.children.length; i++) {
      const row = tbody.children[i] as HTMLElement;
      const idx = parseInt(row.dataset.idx || '-1', 10);
      const isSelected = this.selectedPlaylistIndices.has(idx);
      const isCurrent = idx === this.currentPlaylistIndex;
      row.classList.toggle('selected', isSelected || isCurrent);
      const cb = row.querySelector('.playlist-row-cb') as HTMLInputElement | null;
      if (cb) cb.checked = isSelected;
    }
    const checkAll = document.getElementById('playlist-check-all') as HTMLInputElement | null;
    if (checkAll) {
      const total = this.playlist.length;
      const selected = this.selectedPlaylistIndices.size;
      checkAll.checked = total > 0 && selected === total;
      checkAll.indeterminate = selected > 0 && selected < total;
    }
  }

  private renderPlaylistTable(): void {
    const tbody = document.getElementById('playlist-table-body');
    const emptyMsg = document.getElementById('playlist-empty-msg');
    const checkAll = document.getElementById('playlist-check-all') as HTMLInputElement | null;
    if (!tbody) return;
    tbody.innerHTML = '';

    if (this.playlist.length === 0) {
      emptyMsg?.classList.remove('hidden');
      if (checkAll) {
        checkAll.checked = false;
        checkAll.indeterminate = false;
      }
      return;
    }
    emptyMsg?.classList.add('hidden');

    this.playlist.forEach((song, idx) => {
      const tr = document.createElement('tr');
      tr.dataset.idx = String(idx);
      const isCurrent = idx === this.currentPlaylistIndex;
      const isSelected = this.selectedPlaylistIndices.has(idx);
      if (isCurrent || isSelected) tr.classList.add('selected');

      const displayTitle = song.charter ? `${song.title} / ${song.charter}` : song.title;
      tr.innerHTML = `
        <td class="col-check"><input type="checkbox" class="playlist-row-cb" data-idx="${idx}" ${isSelected ? 'checked' : ''}></td>
        <td class="col-seq">${idx + 1}</td>
        <td class="col-id">${song.id}</td>
        <td class="col-title" title="${escapeHtml(displayTitle)}">${isCurrent ? '▶ ' : ''}${escapeHtml(displayTitle)}</td>
        <td class="col-level">${song.level}</td>
        <td class="col-len">${formatDuration(song.durationSec)}</td>
        <td class="col-ops">
          <button class="win-btn btn-seq-up" title="上移" data-idx="${idx}">▲</button>
          <button class="win-btn btn-seq-down" title="下移" data-idx="${idx}">▼</button>
          <button class="win-btn btn-seq-del" title="移除" data-idx="${idx}">✕</button>
        </td>
      `;

      // Checkbox click
      const cb = tr.querySelector('.playlist-row-cb') as HTMLInputElement | null;
      cb?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cb.checked) {
          this.selectedPlaylistIndices.add(idx);
        } else {
          this.selectedPlaylistIndices.delete(idx);
        }
        this.lastSelectedPlaylistIndex = idx;
        this.updatePlaylistRowSelectionStyles();
        this.updateStatus();
      });

      // Row click for multi-select
      tr.addEventListener('click', (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
        if (e.ctrlKey || e.metaKey) {
          if (this.selectedPlaylistIndices.has(idx)) {
            this.selectedPlaylistIndices.delete(idx);
          } else {
            this.selectedPlaylistIndices.add(idx);
          }
          this.lastSelectedPlaylistIndex = idx;
        } else if (e.shiftKey && this.lastSelectedPlaylistIndex >= 0) {
          const start = Math.min(this.lastSelectedPlaylistIndex, idx);
          const end = Math.max(this.lastSelectedPlaylistIndex, idx);
          this.selectedPlaylistIndices.clear();
          for (let i = start; i <= end; i++) {
            this.selectedPlaylistIndices.add(i);
          }
        } else {
          this.selectedPlaylistIndices.clear();
          this.selectedPlaylistIndices.add(idx);
          this.lastSelectedPlaylistIndex = idx;
        }
        this.updatePlaylistRowSelectionStyles();
        this.updateStatus();
      });

      tr.addEventListener('dblclick', async () => {
        this.currentPlaylistIndex = idx;
        this.syncPlaylistToRenderer();
        this.closeModal();
        await this.loadSongFromCatalog(song);
      });

      // Button actions
      tr.querySelector('.btn-seq-up')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (idx > 0) {
          const temp = this.playlist[idx];
          this.playlist[idx] = this.playlist[idx - 1];
          this.playlist[idx - 1] = temp;
          if (this.currentPlaylistIndex === idx) this.currentPlaylistIndex = idx - 1;
          else if (this.currentPlaylistIndex === idx - 1) this.currentPlaylistIndex = idx;
          this.renderPlaylistTable();
          this.syncPlaylistToRenderer();
        }
      });

      tr.querySelector('.btn-seq-down')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (idx < this.playlist.length - 1) {
          const temp = this.playlist[idx];
          this.playlist[idx] = this.playlist[idx + 1];
          this.playlist[idx + 1] = temp;
          if (this.currentPlaylistIndex === idx) this.currentPlaylistIndex = idx + 1;
          else if (this.currentPlaylistIndex === idx + 1) this.currentPlaylistIndex = idx;
          this.renderPlaylistTable();
          this.syncPlaylistToRenderer();
        }
      });

      tr.querySelector('.btn-seq-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (idx === this.currentPlaylistIndex && this.round.state === 'playing') {
          this.updateStatus('正在演奏的曲目不能移除');
          return;
        }

        const removedCurrent = idx === this.currentPlaylistIndex;
        this.playlist.splice(idx, 1);
        this.selectedPlaylistIndices.delete(idx);
        if (idx < this.currentPlaylistIndex) {
          this.currentPlaylistIndex--;
        } else if (this.currentPlaylistIndex >= this.playlist.length) {
          this.currentPlaylistIndex = Math.max(0, this.playlist.length - 1);
        }
        this.renderPlaylistTable();
        this.syncPlaylistToRenderer();
        if (removedCurrent) {
          if (this.playlist.length > 0) void this.loadCurrentPlaylistItem(false);
          else this.prepareForSongChange();
        }
      });

      tbody.appendChild(tr);
    });

    this.updatePlaylistRowSelectionStyles();
  }

  private deleteSelectedSongs(): void {
    if (this.currentTab === 'playlist') {
      if (this.selectedPlaylistIndices.size === 0) {
        this.updateStatus('请先在歌单中勾选要删除的曲目');
        return;
      }

      if (this.round.state === 'playing' && this.selectedPlaylistIndices.has(this.currentPlaylistIndex)) {
        this.updateStatus('正在演奏的曲目不能移除');
        return;
      }

      const deletedCount = this.selectedPlaylistIndices.size;
      const removedCurrent = this.selectedPlaylistIndices.has(this.currentPlaylistIndex);

      this.playlist = this.playlist.filter((_, idx) => !this.selectedPlaylistIndices.has(idx));

      if (removedCurrent) {
        this.currentPlaylistIndex = Math.max(0, Math.min(this.playlist.length - 1, this.currentPlaylistIndex));
      } else {
        let countBefore = 0;
        for (const idx of this.selectedPlaylistIndices) {
          if (idx < this.currentPlaylistIndex) countBefore++;
        }
        this.currentPlaylistIndex = Math.max(0, this.currentPlaylistIndex - countBefore);
      }

      this.selectedPlaylistIndices.clear();
      this.lastSelectedPlaylistIndex = -1;

      this.renderPlaylistTable();
      this.syncPlaylistToRenderer();

      if (removedCurrent) {
        if (this.playlist.length > 0) void this.loadCurrentPlaylistItem(false);
        else this.prepareForSongChange();
      }

      this.updateStatus(`已从歌单删除 ${deletedCount} 首曲目`);
    } else {
      if (this.selectedCatalogIds.size === 0) {
        this.updateStatus('请先在列表中选择曲目');
        return;
      }

      const initialLen = this.playlist.length;
      const removedCurrent = this.playlist.some((p, idx) => idx === this.currentPlaylistIndex && this.selectedCatalogIds.has(p.id));

      if (this.round.state === 'playing' && removedCurrent) {
        this.updateStatus('正在演奏的曲目不能移除');
        return;
      }

      this.playlist = this.playlist.filter(p => !this.selectedCatalogIds.has(p.id));
      const deletedCount = initialLen - this.playlist.length;

      if (deletedCount > 0) {
        this.currentPlaylistIndex = Math.max(0, Math.min(this.playlist.length - 1, this.currentPlaylistIndex));
        this.renderPlaylistTable();
        this.syncPlaylistToRenderer();
        if (removedCurrent) {
          if (this.playlist.length > 0) void this.loadCurrentPlaylistItem(false);
          else this.prepareForSongChange();
        }
        this.updateStatus(`已从歌单删除 ${deletedCount} 首曲目`);
      } else {
        this.updateStatus('选中的曲目不在歌单中');
      }
    }
  }

  private clearPlaylist(): void {
    if (this.playlist.length === 0) {
      this.updateStatus('歌单已经是空的了');
      return;
    }
    const count = this.playlist.length;
    this.playlist = [];
    this.currentPlaylistIndex = 0;
    this.selectedPlaylistIndices.clear();
    this.lastSelectedPlaylistIndex = -1;
    this.prepareForSongChange();
    this.renderPlaylistTable();
    this.syncPlaylistToRenderer();
    this.updateStatus(`已清空歌单（共 ${count} 首）`);
  }

  private async exportSelectedChart(): Promise<void> {
    let targetSongItem: SongCatalogItem | null = null;
    if (this.currentTab === 'playlist') {
      if (this.selectedPlaylistIndices.size > 0) {
        const firstIdx = Array.from(this.selectedPlaylistIndices)[0];
        targetSongItem = this.playlist[firstIdx];
      } else if (this.playlist.length > 0) {
        targetSongItem = this.playlist[this.currentPlaylistIndex] || this.playlist[0];
      }
    } else {
      if (this.selectedCatalogIds.size > 0) {
        const firstId = Array.from(this.selectedCatalogIds)[0];
        targetSongItem = this.catalog.find(s => s.id === firstId) || null;
      }
    }

    if (!targetSongItem && this.currentSong) {
      await this.exportCurrentChart();
      return;
    }

    if (!targetSongItem) {
      this.updateStatus('请先选择要导出谱面的曲目');
      return;
    }

    this.updateStatus(`正在准备导出: ${targetSongItem.title}...`);

    await downloadChart({
      filename: targetSongItem.filename,
      title: targetSongItem.title,
      loadSong: async () => {
        if (targetSongItem.fileBuffer) return parseVos(targetSongItem.fileBuffer);
        if (this.currentSong && this.playlist[this.currentPlaylistIndex]?.filename === targetSongItem.filename) {
          return this.currentSong;
        }

        let response = await fetch(`/songs/${encodeURIComponent(targetSongItem.filename)}`);
        if (!response.ok) {
          response = await fetch(`/CanFile/All/${encodeURIComponent(targetSongItem.filename)}`);
        }
        if (!response.ok) return undefined;
        return parseVos(await response.arrayBuffer());
      },
      onProgress: (msg) => this.updateStatus(msg)
    });
  }

  public async exportCurrentChart(): Promise<void> {
    if (!this.currentSong) {
      alert('请先载入或选择一首曲目');
      return;
    }
    const currentItem = this.playlist[this.currentPlaylistIndex];
    const filename = currentItem?.filename || `${this.currentSong.title}.vos`;
    const displayEl = document.getElementById('song-current-display');
    const oldText = displayEl ? displayEl.textContent : '';

    await downloadChart({
      filename,
      song: this.currentSong,
      title: this.currentSong.title,
      onProgress: (msg) => {
        if (displayEl) displayEl.textContent = msg;
        this.updateStatus(msg);
      }
    });

    setTimeout(() => {
      if (displayEl && oldText) displayEl.textContent = oldText;
    }, 2500);
  }

  private addSelectedToPlaylist(): void {
    if (this.selectedCatalogIds.size === 0) return;
    const selected = this.catalog.filter(s => this.selectedCatalogIds.has(s.id));
    for (const s of selected) {
      if (!this.playlist.some(p => p.id === s.id && p.filename === s.filename)) {
        this.playlist.push(s);
      }
    }
    this.syncPlaylistToRenderer();
    this.updateStatus(`已添加 ${selected.length} 首曲目到歌单`);
  }

  private addUnselectedToPlaylist(): void {
    const unselected = this.filteredCatalog.filter(s => !this.selectedCatalogIds.has(s.id));
    if (unselected.length === 0) return;
    for (const s of unselected) {
      if (!this.playlist.some(p => p.id === s.id && p.filename === s.filename)) {
        this.playlist.push(s);
      }
    }
    this.syncPlaylistToRenderer();
    this.updateStatus(`已添加 ${unselected.length} 首未选曲目到歌单`);
  }

  private toggleFavorites(): void {
    if (this.selectedCatalogIds.size === 0) return;
    let added = 0;
    let removed = 0;
    for (const id of this.selectedCatalogIds) {
      if (this.favorites.has(id)) {
        this.favorites.delete(id);
        removed++;
      } else {
        this.favorites.add(id);
        added++;
      }
    }
    try {
      localStorage.setItem('meowcan.favorites', JSON.stringify(Array.from(this.favorites)));
    } catch {
      // ignore
    }
    this.updateStatus(`收藏夹更新: +${added}, -${removed}`);
    if (this.currentTab === 'favorites') {
      this.applyFilters();
    }
  }

  private randomSelect(): void {
    if (this.filteredCatalog.length === 0) return;
    const randomIdx = Math.floor(Math.random() * this.filteredCatalog.length);
    const randomSong = this.filteredCatalog[randomIdx];
    this.selectedCatalogIds.clear();
    this.selectedCatalogIds.add(randomSong.id);
    this.lastSelectedRowIndex = randomIdx;

    if (randomIdx >= this.visibleRowCount) {
      this.visibleRowCount = randomIdx + 40;
      this.renderCatalogTable(false);
    } else {
      this.updateRowSelectionStyles();
    }

    const rowEl = document.querySelector(`tr[data-id="${randomSong.id}"]`);
    rowEl?.scrollIntoView({ block: 'center' });
    this.updateStatus();
  }

  private reloadCatalog(): void {
    // Reset all filters
    this.searchKeyword = '';
    this.activeDifficultyFilters.clear();
    this.selectedGenre = '所有';
    this.selectedCatalogIds.clear();
    this.sortColumn = 'level';
    this.sortAscending = true;

    const searchInput = document.getElementById('modal-search-input') as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';
    const genreSelect = document.getElementById('genre-select') as HTMLSelectElement | null;
    if (genreSelect) genreSelect.value = '所有';
    const diffCbs = document.querySelectorAll('.diff-cb') as NodeListOf<HTMLInputElement>;
    diffCbs.forEach(cb => cb.checked = false);

    this.updateSortIndicators();
    this.applyFilters();
  }

  private async confirmSelection(): Promise<void> {
    if (this.playlist.length === 0) {
      if (this.selectedCatalogIds.size > 0) {
        this.addSelectedToPlaylist();
      } else if (this.filteredCatalog.length > 0) {
        this.playlist.push(this.filteredCatalog[0]);
      }
    }
    this.closeModal();

    if (this.playlist.length > 0) {
      this.currentPlaylistIndex = Math.max(0, Math.min(this.playlist.length - 1, this.currentPlaylistIndex));
      this.syncPlaylistToRenderer();
      const current = this.playlist[this.currentPlaylistIndex];
      await this.loadSongFromCatalog(current);
    }
  }

  private closeModal(): void {
    document.getElementById('song-modal')?.classList.remove('active');
  }

  private updateStatus(customMsg?: string): void {
    const statusText = document.getElementById('win-status-text');
    const selText = document.getElementById('win-selection-text');
    const favBadge = document.getElementById('fav-badge');
    const playlistBadge = document.getElementById('playlist-badge');

    if (statusText) {
      if (customMsg) {
        statusText.textContent = customMsg;
      } else {
        statusText.textContent = `当前列表: ${this.filteredCatalog.length} 首 / 全库 ${this.catalog.length} 首`;
      }
    }

    if (selText) {
      if (this.currentTab === 'playlist') {
        selText.textContent = `已选: ${this.selectedPlaylistIndices.size} / ${this.playlist.length} 首`;
      } else {
        selText.textContent = `已选: ${this.selectedCatalogIds.size} 首`;
      }
    }

    if (favBadge) {
      favBadge.textContent = this.favorites.size > 0 ? `(${this.favorites.size})` : '';
    }

    if (playlistBadge) {
      playlistBadge.textContent = this.playlist.length > 0 ? `(${this.playlist.length})` : '';
    }
  }

  public syncPlaylistToRenderer(): void {
    const displayItems: PlaylistItemDisplay[] = this.playlist.map(item => ({
      id: item.id,
      title: item.title,
      level: item.level,
      artist: item.artist,
      charter: item.charter
    }));
    this.renderer.setPlaylist(displayItems, this.currentPlaylistIndex);
    this.persistPlaylist();
    this.updateStatus();
    this.syncArcadeControls();
  }

  private restorePlaylist(): void {
    try {
      const raw = localStorage.getItem('meowcan.playlist.v1');
      const saved = raw ? JSON.parse(raw) as { index?: number; songs?: { filename?: string }[] } : null;
      if (!saved || !Array.isArray(saved.songs)) return;
      const byFilename = new Map(this.catalog.map(song => [song.filename, song]));
      this.playlist = saved.songs
        .map(entry => typeof entry?.filename === 'string' ? byFilename.get(entry.filename) : undefined)
        .filter((song): song is SongCatalogItem => Boolean(song));
      const index = Number.isInteger(saved.index) ? saved.index! : 0;
      this.currentPlaylistIndex = this.playlist.length > 0
        ? Math.max(0, Math.min(this.playlist.length - 1, index)) : 0;
    } catch {
      this.playlist = [];
      this.currentPlaylistIndex = 0;
    }
  }

  private persistPlaylist(): void {
    if (!this.catalogOnline) return;
    try {
      localStorage.setItem('meowcan.playlist.v1', JSON.stringify({
        index: this.currentPlaylistIndex,
        songs: this.playlist.map(song => ({ filename: song.filename }))
      }));
    } catch {
      // Storage is optional.
    }
  }

  public async loadCurrentPlaylistItem(autoPlay = false): Promise<boolean> {
    if (this.playlist.length === 0) return false;
    const item = this.playlist[this.currentPlaylistIndex];
    const loaded = await this.loadSongFromCatalog(item);
    if (loaded && autoPlay && this.isAudioUnlocked) {
      this.playSong();
    }
    return loaded;
  }

  public async loadSongFromCatalog(item: SongCatalogItem): Promise<boolean> {
    const requestId = ++this.loadRequestId;
    this.prepareForSongChange();
    const displayEl = document.getElementById('song-current-display')!;
    displayEl.textContent = `加载中: ${item.title}...`;

    if (item.fileBuffer) {
      if (requestId !== this.loadRequestId) return false;
      return this.loadSongData(item.fileBuffer, item.filename, item.id);
    }

    try {
      let resp = await fetch(`/songs/${item.filename}`);
      if (!resp.ok) {
        resp = await fetch(`/CanFile/All/${item.filename}`);
      }
      if (!resp.ok) throw new Error('Failed to fetch ' + item.filename);
      const arr = await resp.arrayBuffer();
      if (requestId !== this.loadRequestId) return false;
      return this.loadSongData(arr, item.filename, item.id);
    } catch (e) {
      console.error('Error loading song:', e);
      if (requestId === this.loadRequestId) displayEl.textContent = `加载失败: ${item.title}`;
      return false;
    }
  }

  private shouldStartOnLoad = false;

  public loadSongData(arr: ArrayBuffer, name = 'Song', songId: number | null = null): boolean {
    try {
      const parsed = parseVos(arr);
      this.prepareForSongChange();
      this.currentSong = parsed;
      this.currentSongId = songId;
      this.leaderboard.setSong(songId);
      console.log('Parsed VOS:', this.currentSong);

      this.judgment.setNotes(this.currentSong.playableNotes, this.currentSong.tempoMap);
      this.renderer.setTempoMap(this.currentSong.tempoMap);
      this.renderer.setSongInfo(this.currentSong.title, this.currentSong.artist, this.currentSong.level);
      this.syncPlaylistToRenderer();
      this.renderer.updateCombo(0);
      this.roundEndSec = Math.max(
        this.currentSong.durationSec,
        ...this.currentSong.playableNotes.map(note => note.startSec + note.durationSec)
      ) + 2;

      const displayEl = document.getElementById('song-current-display')!;
      displayEl.textContent = `${this.currentSong.title} - ${this.currentSong.artist} [Lv.${this.currentSong.level}]`;

      this.syncArcadeControls();

      this.renderer.renderFrame(
        0,
        this.currentSong.playableNotes,
        this.judgment.score,
        this.currentSong.durationSec,
        this.currentSong.tempoMap
      );
      if (this.shouldStartOnLoad) {
        this.shouldStartOnLoad = false;
        this.playSong();
      }
      return true;
    } catch (e) {
      alert('解析 VOS 谱面失败: ' + (e as Error).message);
      return false;
    }
  }

  public async playSong(): Promise<void> {
    const requestId = this.loadRequestId;
    await this.audio.init();
    if (requestId !== this.loadRequestId) return;
    this.isAudioUnlocked = true;

    // Keep the completed song loaded while its result animation is visible.
    // The next explicit play action advances and loads the playlist instead.
    if (this.advancePlaylistOnNextPlay && this.playlist.length > 0) {
      this.advancePlaylistOnNextPlay = false;
      this.currentPlaylistIndex = (this.currentPlaylistIndex + 1) % this.playlist.length;
      this.syncPlaylistToRenderer();
      await this.loadCurrentPlaylistItem(true);
      return;
    }

    if (!this.currentSong) {
      if (this.playlist.length > 0) {
        await this.loadCurrentPlaylistItem(true);
      } else {
        this.shouldStartOnLoad = true;
      }
      return;
    }

    this.judgment.setNotes(this.currentSong.playableNotes, this.currentSong.tempoMap);
    this.renderer.setTempoMap(this.currentSong.tempoMap);
    this.autoPlayIndex = 0;
    this.cancelInputsWithoutJudgment();
    this.renderer.resetEffects();
    this.renderer.hideResult();
    // Give even tick-zero notes a full approach, on the audio master clock.
    this.audio.startSong(this.currentSong.bgmNotes, -3);
    this.audio.playSfx('count');
    this.audio.playSfx('count', 1);
    this.audio.playSfx('count', 2);
    this.audio.playSfx('go', 3);
    this.renderer.showCountdown('3');
    this.isRunning = true;
    this.round.begin();
    this.syncArcadeControls();
  }

  public restartSong(): void {
    if (!this.currentSong) return;
    this.advancePlaylistOnNextPlay = false;
    this.audio.playSfx('click');
    if (this.isAudioUnlocked) {
      this.playSong();
    }
  }

  public abortSong(): void {
    if (this.round.state !== 'playing') return;
    this.finishRound(getRoundOutcome(this.judgment.score.accuracy));
    this.audio.playSfx('click');
  }

  private syncArcadeControls(): void {
    const start = document.getElementById('btn-arcade-start') as HTMLButtonElement | null;
    const abort = document.getElementById('btn-arcade-abort') as HTMLButtonElement | null;
    const playing = this.round.state === 'playing';
    const playIndex = this.advancePlaylistOnNextPlay && this.playlist.length > 0
      ? (this.currentPlaylistIndex + 1) % this.playlist.length
      : this.currentPlaylistIndex;
    const currentItem = this.playlist[playIndex];

    if (start) {
      start.disabled = playing;
      if (currentItem) {
        start.title = `开始演奏: [Lv.${currentItem.level}] ${currentItem.title}`;
      }
    }
    if (abort) abort.disabled = !playing;
    const keySettings = document.getElementById('btn-key-settings') as HTMLButtonElement | null;
    if (keySettings) keySettings.disabled = playing;

  }

  private loadKeyBindings(): void {
    try {
      const saved = localStorage.getItem('meowcan.laneKeys.v1');
      const parsed: unknown = saved ? JSON.parse(saved) : null;
      if (isLaneKeyBindings(parsed)) this.laneKeys = parsed.map(binding => ({ ...binding }));
    } catch {
      this.laneKeys = DEFAULT_LANE_KEYS.map(binding => ({ ...binding }));
    }
    this.rebuildLaneKeyMap();
    this.renderKeyHints();
    this.renderer.setLaneKeyLabels(this.laneKeys.map(binding => binding.label));
  }

  private rebuildLaneKeyMap(): void {
    this.laneKeyMap = bindingsToLaneMap(this.laneKeys);
  }

  private renderKeyHints(): void {
    const hints = document.getElementById('key-hints');
    if (!hints) return;
    hints.replaceChildren(...this.laneKeys.map(binding => {
      const chip = document.createElement('kbd');
      chip.className = 'key-chip';
      if (binding.label.length > 3) chip.classList.add('space-key');
      chip.textContent = binding.label;
      return chip;
    }));
    hints.setAttribute('aria-label', `演奏键位 ${this.laneKeys.map(binding => binding.label).join(' ')}`);
  }

  private initKeySettings(): void {
    const modal = document.getElementById('key-settings-modal');
    const open = document.getElementById('btn-key-settings');
    const close = document.getElementById('btn-close-key-settings');
    const save = document.getElementById('btn-save-keys');
    const reset = document.getElementById('btn-reset-keys');
    if (!modal || !open || !close || !save || !reset) return;

    const closeModal = () => {
      modal.classList.remove('active');
      this.capturingLane = null;
    };
    open.addEventListener('click', () => {
      this.pendingLaneKeys = this.laneKeys.map(binding => ({ ...binding }));
      this.capturingLane = null;
      this.renderKeySettings();
      modal.classList.add('active');
      this.audio.playSfx('click');
    });
    close.addEventListener('click', closeModal);
    reset.addEventListener('click', () => {
      this.pendingLaneKeys = DEFAULT_LANE_KEYS.map(binding => ({ ...binding }));
      this.capturingLane = null;
      this.renderKeySettings('已恢复默认预览，点击“保存键位”后生效');
    });
    save.addEventListener('click', () => {
      if (!isLaneKeyBindings(this.pendingLaneKeys)) return;
      this.cancelInputsWithoutJudgment();
      this.laneKeys = this.pendingLaneKeys.map(binding => ({ ...binding }));
      this.rebuildLaneKeyMap();
      this.renderKeyHints();
      this.renderer.setLaneKeyLabels(this.laneKeys.map(binding => binding.label));
      try {
        localStorage.setItem('meowcan.laneKeys.v1', JSON.stringify(this.laneKeys));
      } catch {
        // The bindings still apply for this session when storage is unavailable.
      }
      closeModal();
      this.audio.playSfx('click');
    });

    window.addEventListener('keydown', event => {
      if (!modal.classList.contains('active') || this.capturingLane === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.code || event.code === 'Unidentified') {
        this.renderKeySettings('浏览器无法识别这个键，请换一个键');
        return;
      }
      const lane = this.capturingLane;
      const duplicateLane = this.pendingLaneKeys.findIndex(binding => binding.code === event.code);
      const replacement = { code: event.code, label: keyLabel(event) };
      if (duplicateLane >= 0 && duplicateLane !== lane) {
        this.pendingLaneKeys[duplicateLane] = this.pendingLaneKeys[lane];
      }
      this.pendingLaneKeys[lane] = replacement;
      this.capturingLane = null;
      this.renderKeySettings(`第 ${lane + 1} 轨已设为 ${replacement.label}`);
    }, true);
  }

  private renderKeySettings(status = '点击轨道后，按下任意一个键'): void {
    const list = document.getElementById('key-binding-list');
    const statusEl = document.getElementById('key-binding-status');
    if (!list) return;
    list.replaceChildren(...this.pendingLaneKeys.map((binding, lane) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'key-binding';
      button.classList.toggle('active', lane === this.capturingLane);
      const laneLabel = document.createElement('small');
      laneLabel.textContent = `轨道 ${lane + 1}`;
      const key = document.createElement('kbd');
      key.textContent = lane === this.capturingLane ? '按键…' : binding.label;
      button.append(laneLabel, key);
      button.addEventListener('click', () => {
        this.capturingLane = lane;
        this.renderKeySettings(`请按下第 ${lane + 1} 轨的新按键`);
      });
      return button;
    }));
    if (statusEl) statusEl.textContent = status;
  }

  private setupEventListeners(): void {
    document.getElementById('btn-arcade-start')!.onclick = () => this.playSong();
    document.getElementById('btn-arcade-abort')!.onclick = () => this.abortSong();

    // Keyboard handlers
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLElement && (e.target.matches('input, textarea, select') || e.target.isContentEditable)) return;
      if (document.getElementById('song-modal')!.classList.contains('active')) return;
      if (document.getElementById('key-settings-modal')?.classList.contains('active')) return;
      if (e.code === 'Space') {
        e.preventDefault(); // Prevent page scroll
      }

      if (e.code === 'Escape' && this.round.state === 'playing') {
        e.preventDefault();
        this.abortSong();
        return;
      }

      // Space remains the centre lane while playing, and starts a round while idle.
      if (e.code === 'Space' && this.round.state !== 'playing') {
        if (!e.repeat) void this.playSong();
        return;
      }

      // Vertical arrows follow the cabinet context: adjust speed during a
      // round, otherwise move through the playlist and load that song.
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        const direction = e.code === 'ArrowUp' ? -1 : 1;
        if (this.round.state === 'playing') {
          this.changeSpeed(-direction);
        } else {
          void this.selectPlaylistItem(this.currentPlaylistIndex + direction);
        }
        return;
      }

      // A configured play key wins over the remaining global shortcuts while a round is active.
      const mappedLane = this.laneKeyMap.get(e.code);
      if (mappedLane !== undefined && this.round.state === 'playing') {
        e.preventDefault();
        if (this.audio.getCurrentTime() < 0) return;
        if (!this.activeKeys.has(e.code)) {
          const alreadyPressed = [...this.activeKeys.values()].includes(mappedLane);
          this.activeKeys.set(e.code, mappedLane);
          if (!alreadyPressed) this.handlePlayerKeyDown(mappedLane);
        }
        return;
      }

      // Alternate speed shortcuts remain available outside active rounds.
      if (e.code === 'PageUp' || e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault();
        this.changeSpeed(1);
        return;
      }
      if (e.code === 'PageDown' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        this.changeSpeed(-1);
        return;
      }

    });

    window.addEventListener('keyup', (e) => {
      if (this.activeKeys.has(e.code)) {
        e.preventDefault();
        const lane = this.activeKeys.get(e.code)!;
        this.activeKeys.delete(e.code);
        if (![...this.activeKeys.values()].includes(lane)) this.handlePlayerKeyUp(lane);
      }
    });

    window.addEventListener('blur', () => this.releaseInputs());
    const canvas = document.querySelector('canvas')!;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      const scene = this.renderer.clientToScene(e.clientX, e.clientY);
      const playlistIndex = this.renderer.hitTestPlaylistItem(scene.x, scene.y);
      if (playlistIndex >= 0 && this.round.state !== 'playing') {
        e.preventDefault();
        void this.selectPlaylistItem(playlistIndex);
        return;
      }
      const lane = this.renderer.hitTestKey(scene.x, scene.y);
      if (lane < 0 || this.round.state !== 'playing' || this.audio.getCurrentTime() < 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const alreadyPressed = [...this.activeKeys.values()].includes(lane);
      this.activeKeys.set(`pointer:${e.pointerId}`, lane);
      if (!alreadyPressed) this.handlePlayerKeyDown(lane);
    });
    canvas.addEventListener('pointermove', (e) => {
      const key = `pointer:${e.pointerId}`;
      const previousLane = this.activeKeys.get(key);
      if (previousLane === undefined || this.renderer.getSkin() !== 'mobile') return;
      const scene = this.renderer.clientToScene(e.clientX, e.clientY);
      const nextLane = this.renderer.hitTestKey(scene.x, scene.y);
      if (nextLane < 0 || nextLane === previousLane) return;
      this.activeKeys.delete(key);
      if (![...this.activeKeys.values()].includes(previousLane)) this.handlePlayerKeyUp(previousLane);
      const alreadyPressed = [...this.activeKeys.values()].includes(nextLane);
      this.activeKeys.set(key, nextLane);
      if (!alreadyPressed) this.handlePlayerKeyDown(nextLane);
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
    canvas.addEventListener('wheel', (e) => {
      const scene = this.renderer.clientToScene(e.clientX, e.clientY);
      if (!this.renderer.hitTestPlaylistScreen(scene.x, scene.y)
        || this.round.state === 'playing' || this.playlist.length === 0 || e.deltaY === 0) return;
      e.preventDefault();
      const nextIndex = Math.max(0, Math.min(
        this.playlist.length - 1,
        this.currentPlaylistIndex + (e.deltaY > 0 ? 1 : -1)
      ));
      void this.selectPlaylistItem(nextIndex);
    }, { passive: false });

    // UI Buttons
    document.getElementById('btn-song-select')!.onclick = () => {
      this.audio.playSfx('click');
      document.getElementById('song-modal')!.classList.add('active');
    };

    document.getElementById('btn-export-chart')?.addEventListener('click', () => {
      this.audio.playSfx('click');
      this.exportCurrentChart();
    });

    // Speed Controls
    this.updateSpeedUI();
    document.getElementById('btn-speed-up')!.onclick = () => {
      this.changeSpeed(1);
    };
    document.getElementById('btn-speed-down')!.onclick = () => {
      this.changeSpeed(-1);
    };
    const speedDisplay = document.getElementById('speed-display');
    if (speedDisplay) {
      speedDisplay.onclick = () => {
        if (this.renderer.speedGear !== 8) {
          const delta = 8 - this.renderer.speedGear;
          this.changeSpeed(delta);
        }
      };
    }

    // Auto Play Toggle
    const autoBtn = document.getElementById('btn-auto')!;
    autoBtn.onclick = () => {
      this.isAutoPlay = !this.isAutoPlay;
      this.releaseInputs();
      this.autoPlayIndex = 0;
      autoBtn.textContent = this.isAutoPlay ? '自动演奏: 开' : '自动演奏: 关';
      autoBtn.classList.toggle('active', this.isAutoPlay);
      autoBtn.setAttribute('aria-pressed', String(this.isAutoPlay));
      this.renderer.setAutoPlay(this.isAutoPlay);
      this.audio.playSfx('click');
    };

    // Skin controls
    const skinButton = document.getElementById('btn-skin');
    if (skinButton) {
      const syncSkinLabel = () => {
        document.body.dataset.skin = this.renderer.getSkin();
        document.querySelector('meta[name="theme-color"]')?.setAttribute(
          'content', this.renderer.getSkin() === 'classic' ? '#edbed5' : '#07101d'
        );
        const labels = { classic: '机台: 粉色', metallic: '机台: 金属', mobile: '机台: 移动端' } as const;
        skinButton.textContent = labels[this.renderer.getSkin()];
        const mobile = this.renderer.getSkin() === 'mobile';
        document.getElementById('btn-note-skin')?.toggleAttribute('disabled', mobile);
        document.getElementById('game-wrapper')?.setAttribute(
          'aria-label', mobile ? '移动端七键触控打歌界面' : '经典 CanMusic 打歌界面'
        );
        const arcadeStart = document.getElementById('btn-arcade-start');
        const arcadeAbort = document.getElementById('btn-arcade-abort');
        const startLabel = arcadeStart?.querySelector('span');
        const abortLabel = arcadeAbort?.querySelector('span');
        if (startLabel) startLabel.textContent = '开始';
        if (abortLabel) abortLabel.textContent = '结束';
      };
      syncSkinLabel();
      skinButton.onclick = async () => {
        const order = ['classic', 'metallic', 'mobile'] as const;
        const next = order[(order.indexOf(this.renderer.getSkin()) + 1) % order.length];
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
          ? '音符: 扁平' : '音符: 花形';
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

    // File Upload (supports multiple files!)
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    document.getElementById('btn-upload')?.addEventListener('click', () => {
      this.audio.playSfx('click');
      fileInput.click();
    });
    fileInput.onchange = async () => {
      if (fileInput.files && fileInput.files.length > 0) {
        await this.handleFilesLoaded(Array.from(fileInput.files));
      }
    };

    // Drag & Drop (supports multiple files!)
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
        const vosFiles = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.vos'));
        if (vosFiles.length > 0) {
          await this.handleFilesLoaded(vosFiles);
        }
      }
    });
  }

  private async handleFilesLoaded(files: File[]): Promise<void> {
    const newItems: SongCatalogItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const arr = await file.arrayBuffer();
        const parsed = parseVos(arr);
        newItems.push({
          id: 90000 + i,
          filename: file.name,
          genre: parsed.genre || 'Other',
          title: parsed.title || file.name.replace(/\.vos$/i, ''),
          artist: parsed.artist || 'Unknown',
          charter: parsed.arranger || '',
          level: parsed.level || 1,
          durationSec: Math.round(parsed.durationSec || 0),
          notes: parsed.playableNotes?.length || 0,
          popularity: 0,
          fileBuffer: arr
        });
      } catch (err) {
        console.warn(`Failed to parse dropped file ${file.name}:`, err);
      }
    }

    if (newItems.length > 0) {
      this.playlist = newItems;
      this.currentPlaylistIndex = 0;
      this.syncPlaylistToRenderer();
      await this.loadCurrentPlaylistItem(false);
    }
  }

  private changeSpeed(delta: number): void {
    const cur = this.renderer.speedGear;
    const next = Math.max(1, Math.min(14, cur + delta));
    if (next === cur) return; // 边界不循环
    this.renderer.setSpeed(next);
    this.updateSpeedUI();
    this.audio.playSfx(delta > 0 ? 'speedup' : 'speeddown');
    try {
      localStorage.setItem('meowcan.speedGear', next.toString());
    } catch {
      // ignore
    }
  }

  private async selectPlaylistItem(index: number): Promise<void> {
    if (this.round.state === 'playing' || index < 0 || index >= this.playlist.length
      || index === this.currentPlaylistIndex) return;
    this.currentPlaylistIndex = index;
    this.syncPlaylistToRenderer();
    this.audio.playSfx('click');
    await this.loadCurrentPlaylistItem(false);
  }

  private updateSpeedUI(): void {
    const gear = this.renderer.speedGear;
    const display = document.getElementById('speed-display');
    if (display) {
      display.textContent = `速度: ${gear}`;
    }
    const upBtn = document.getElementById('btn-speed-up') as HTMLButtonElement | null;
    const downBtn = document.getElementById('btn-speed-down') as HTMLButtonElement | null;
    if (upBtn) {
      upBtn.disabled = gear >= 14;
    }
    if (downBtn) {
      downBtn.disabled = gear <= 1;
    }
  }

  private handlePlayerKeyDown(lane: number): void {
    if (!this.isRunning || !this.currentSong) return;
    if (this.audio.getCurrentTime() < 0) return;
    this.renderer.setLaneState(lane, true);

    const curTime = this.audio.getCurrentTime();
    const hit = this.judgment.onKeyDown(lane, curTime);

    if (hit) {
      this.renderer.showHitBurst(lane);
      this.renderer.showJudgement(hit.rating);
      this.renderer.updateCombo(this.judgment.score.combo);

      // Play keysound on hit!
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

  private autoPlayIndex = 0;

  private cancelInputsWithoutJudgment(): void {
    this.activeKeys.clear();
    this.autoReleases.clear();
    this.judgment.cancelActiveHolds();
    for (let lane = 0; lane < 7; lane++) this.renderer.setLaneState(lane, false);
  }

  private prepareForSongChange(): void {
    this.renderer.showCountdown(null);
    this.isRunning = false;
    this.round.reset();
    this.cancelInputsWithoutJudgment();
    this.audio.stopSong();
    this.renderer.resetEffects();
    this.renderer.hideResult();
    this.currentSong = null;
    this.currentSongId = null;
    this.leaderboard.setSong(null);
    this.advancePlaylistOnNextPlay = false;
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
    this.renderer.showCountdown(null);
    this.audio.playSfx('result');

    if (!this.isAutoPlay && this.currentSongId !== null) {
      void this.leaderboard.submitScore(this.currentSongId, { ...score }, outcome);
    }

    // Defer loading the next item: loadSongFromCatalog() clears the result
    // layer, so doing it here would erase the score/ratio animation instantly.
    this.advancePlaylistOnNextPlay = this.playlist.length > 0;
    this.syncArcadeControls();
  }

  private gameLoop(_deltaSec: number): void {
    if (this.isRunning && this.currentSong) {
      const curTime = this.audio.getCurrentTime();
      this.renderer.showCountdown(curTime < 0 ? String(Math.ceil(-curTime)) : curTime < .45 ? 'GO!' : null);

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
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDuration(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new CanMusicGame();
  game.start().catch((err) => console.error('Game start failed:', err));
  (window as unknown as { __canMusicGame: CanMusicGame }).__canMusicGame = game;
});
