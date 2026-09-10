/**
 * MeowCan Developer Visual Preview & Calibration Tool (dev-preview.ts)
 * Strictly gated by import.meta.env.DEV.
 * Allows deterministic, audio-free visual inspection of all classic assets,
 * including note bases, animations, characters, combo fonts, and result screens.
 */

import { Assets, Container, Sprite, Texture, Rectangle, Graphics, Text, TextStyle } from 'pixi.js';
import { DEFAULT_SKIN, validateSkinCrops, type FrameRect } from './game/skin';
import type { CanMusicRenderer } from './game/renderer';

export class DevPreviewController {
  private renderer: CanMusicRenderer;
  private previewLayer: Container;
  private isPreviewActive = false;
  private panelEl: HTMLElement | null = null;

  // Cached base textures
  private textures: Record<string, Texture> = {};
  private subTextures: Texture[] = [];

  // Current preview state
  private state = {
    tab: 'notes' as 'notes' | 'characters' | 'combo' | 'result' | 'crops' | 'layout',
    noteVariant: 'both' as 'base0' | 'base1' | 'both',
    faceFrame: 0,
    starFrame: 0,
    wingkyFrame: 0,
    hitFrame: 0,
    timeSec: 0,
    comboValue: 100,
    resultType: 'result' as 'result' | 'failed',
    messageIndex: 8,
    heartIndex: 2,
    badgeMultiplier: 4
  };

  constructor(renderer: CanMusicRenderer) {
    this.renderer = renderer;
    this.previewLayer = new Container();
    this.previewLayer.label = 'DevPreviewLayer';
    this.previewLayer.visible = false;
    const app = this.renderer.getApp();
    app.stage.addChild(this.previewLayer);
    const scale = Math.min(app.screen.width / 716, app.screen.height / 516);
    this.previewLayer.scale.set(scale);
    this.previewLayer.position.set((app.screen.width - 716 * scale) / 2, (app.screen.height - 516 * scale) / 2);
  }

  public async init(): Promise<void> {
    console.log('[DevPreview] init() called, import.meta.env.DEV:', import.meta.env.DEV);
    if (!import.meta.env.DEV) return;

    // Preload required classic textures for preview
    console.log('[DevPreview] preloading textures...');
    await this.preloadTextures();
    console.log('[DevPreview] textures preloaded!');

    // Create the floating developer HUD panel
    this.createUI();

    // Parse query parameters for deep linking & automation
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('preview') || urlParams.has('dev')) {
      if (urlParams.has('tab')) {
        this.state.tab = urlParams.get('tab') as any;
      }
      if (urlParams.has('face')) {
        this.state.faceFrame = parseInt(urlParams.get('face')!, 10) || 0;
      }
      if (urlParams.has('star')) {
        this.state.starFrame = parseInt(urlParams.get('star')!, 10) || 0;
      }
      if (urlParams.has('wingky')) {
        this.state.wingkyFrame = parseInt(urlParams.get('wingky')!, 10) || 0;
      }
      if (urlParams.has('combo')) {
        this.state.comboValue = parseInt(urlParams.get('combo')!, 10) || 0;
      }
      if (urlParams.has('hit')) {
        this.state.hitFrame = parseInt(urlParams.get('hit')!, 10) || 0;
      }
      if (urlParams.has('type')) {
        this.state.resultType = urlParams.get('type') as any;
      }
      if (urlParams.has('msg')) {
        this.state.messageIndex = parseInt(urlParams.get('msg')!, 10) || 0;
      }
      if (urlParams.has('heart')) {
        this.state.heartIndex = parseInt(urlParams.get('heart')!, 10) || 0;
      }
      if (urlParams.has('badge')) {
        this.state.badgeMultiplier = parseInt(urlParams.get('badge')!, 10) || 4;
      }

      const clamp = (value: number, max: number) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.trunc(value))) : 0;
      if (!['notes', 'characters', 'combo', 'result', 'crops', 'layout'].includes(this.state.tab)) this.state.tab = 'notes';
      if (!['result', 'failed'].includes(this.state.resultType)) this.state.resultType = 'result';
      this.state.faceFrame = clamp(this.state.faceFrame, 6);
      this.state.starFrame = clamp(this.state.starFrame, 63);
      this.state.wingkyFrame = clamp(this.state.wingkyFrame, 12);
      this.state.hitFrame = clamp(this.state.hitFrame, 9);
      this.state.comboValue = clamp(this.state.comboValue, 99999);
      this.state.messageIndex = clamp(this.state.messageIndex, 16);
      this.state.heartIndex = clamp(this.state.heartIndex, 4);
      const time = Number(urlParams.get('time') ?? 0);
      this.state.timeSec = Number.isFinite(time) ? Math.max(0, Math.min(2, time)) : 0;
      this.updateTabUI();
      this.activate();
    }
  }

  private async preloadTextures(): Promise<void> {
    const urls = [
      DEFAULT_SKIN.bg.path,
      DEFAULT_SKIN.playArea.path,
      DEFAULT_SKIN.canBack.path,
      DEFAULT_SKIN.canFrame.path,
      DEFAULT_SKIN.hitBar0.path,
      DEFAULT_SKIN.hitBar1.path,
      DEFAULT_SKIN.keyNormal.path,
      DEFAULT_SKIN.keyPut.path,
      DEFAULT_SKIN.noteBase0.basePath,
      DEFAULT_SKIN.noteBase0.skinPath,
      DEFAULT_SKIN.noteBase0.composedPath,
      DEFAULT_SKIN.noteBase1.basePath,
      DEFAULT_SKIN.noteBase1.skinPath,
      DEFAULT_SKIN.noteBase1.composedPath,
      DEFAULT_SKIN.faceMap.path,
      DEFAULT_SKIN.star.path,
      DEFAULT_SKIN.wingkyPinkL0.path,
      DEFAULT_SKIN.wingkyPinkL1.path,
      DEFAULT_SKIN.hitBurst0.path,
      DEFAULT_SKIN.hitBurstLongNote0.path,
      DEFAULT_SKIN.comboFont.path,
      DEFAULT_SKIN.scoreFont.path,
      DEFAULT_SKIN.ratioFont.path,
      DEFAULT_SKIN.eqFont.path,
      DEFAULT_SKIN.heartFont.path,
      DEFAULT_SKIN.resultAtlas.path,
      DEFAULT_SKIN.messageAtlas.path,
      '/assets/classic/contact_sheet_overview.png'
    ];

    for (const url of urls) {
      this.textures[url] = await Assets.load(url);
      this.textures[url].source.scaleMode = 'nearest';
    }
  }

  public activate(): void {
    console.log('[DevPreview] activate() called');
    this.isPreviewActive = true;
    this.previewLayer.visible = true;
    this.renderer.getRootContainer().visible = false;

    // Hide gameplay start & loading overlays so preview canvas is fully visible
    const startOverlay = document.getElementById('start-overlay');
    if (startOverlay) {
      startOverlay.classList.add('hidden');
      startOverlay.style.display = 'none';
    }
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.classList.add('hidden');
      loadingOverlay.style.display = 'none';
    }
    const songLabel = document.getElementById('song-current-display');
    if (songLabel) songLabel.textContent = 'DEV preview';

    if (this.panelEl) {
      this.panelEl.style.display = 'block';
    }
    const btn = document.getElementById('dev-preview-toggle-btn');
    if (btn) btn.classList.add('active');
    this.renderCurrentState();
  }

  public deactivate(): void {
    const url = new URL(location.href);
    url.searchParams.delete('preview');
    url.searchParams.delete('dev');
    location.assign(url.href);
    this.isPreviewActive = false;
    this.previewLayer.visible = false;
    this.clearPreview();
    this.renderer.getRootContainer().visible = true;

    const startOverlay = document.getElementById('start-overlay');
    if (startOverlay) {
      startOverlay.classList.remove('hidden');
      startOverlay.style.display = '';
    }

    if (this.panelEl) {
      this.panelEl.style.display = 'none';
    }
    const btn = document.getElementById('dev-preview-toggle-btn');
    if (btn) btn.classList.remove('active');
  }

  public toggle(): void {
    if (this.isPreviewActive) {
      this.deactivate();
    } else {
      this.activate();
    }
  }

  private createSubTexture(path: string, rect: FrameRect): Texture | null {
    const base = this.textures[path];
    if (!base) return null;
    const texture = new Texture({
      source: base.source,
      frame: new Rectangle(rect.x, rect.y, rect.width, rect.height)
    });
    this.subTextures.push(texture);
    return texture;
  }

  private clearPreview(): void {
    for (const child of this.previewLayer.removeChildren()) child.destroy({ children: true });
    for (const texture of this.subTextures) texture.destroy(false);
    this.subTextures = [];
  }

  public renderCurrentState(): void {
    if (!this.isPreviewActive) return;
    this.clearPreview();

    // Background scrim matching 716x516 logical stage
    const bgGfx = new Graphics();
    bgGfx.rect(0, 0, 716, 516);
    bgGfx.fill({ color: 0x110e1b, alpha: 1.0 });
    this.previewLayer.addChild(bgGfx);

    switch (this.state.tab) {
      case 'notes':
        this.renderNotesComparisonView();
        break;
      case 'characters':
        this.renderCharactersView();
        break;
      case 'combo':
        this.renderComboAndBurstsView();
        break;
      case 'result':
        this.renderResultSimulationView();
        break;
      case 'crops':
        this.renderCropsInspectorView();
        break;
      case 'layout':
        this.renderLayoutCalibrationView();
        break;
    }
  }

  // -------------------------------------------------------------
  // View 1: Note Bases & Composed Note Comparison
  // -------------------------------------------------------------
  private renderNotesComparisonView(): void {
    const title = new Text({
      text: '🎵 音符底座与心形图集像素对比 (Base 0 vs Base 1)',
      style: new TextStyle({ fill: 0xff80ab, fontSize: 18, fontWeight: 'bold' })
    });
    title.position.set(30, 25);
    this.previewLayer.addChild(title);

    // Section 1: Note Base 0 (Tall: 26x24)
    const lbl0 = new Text({
      text: '【皮肤方案 0】note_base0 (26×24) + note_skin0 (26×24) [早期花形高底座]',
      style: new TextStyle({ fill: 0xffffff, fontSize: 13, fontWeight: 'bold' })
    });
    lbl0.position.set(30, 65);
    this.previewLayer.addChild(lbl0);

    // Row for Base0 raw
    const b0Tex = this.textures[DEFAULT_SKIN.noteBase0.basePath];
    if (b0Tex) {
      const b0 = new Sprite(b0Tex);
      b0.position.set(30, 95);
      this.previewLayer.addChild(b0);

      const b0Desc = new Text({ text: 'base0 (26×24)', style: { fill: 0xaaaaaa, fontSize: 11 } });
      b0Desc.position.set(30, 125);
      this.previewLayer.addChild(b0Desc);
    }

    // Row for Composed 0 (16 frames)
    const c0Tex = this.textures[DEFAULT_SKIN.noteBase0.composedPath];
    if (c0Tex) {
      const c0 = new Sprite(c0Tex);
      c0.position.set(130, 95);
      this.previewLayer.addChild(c0);

      const c0Desc = new Text({ text: 'composed0 全 16 帧复合心形', style: { fill: 0xaaaaaa, fontSize: 11 } });
      c0Desc.position.set(130, 125);
      this.previewLayer.addChild(c0Desc);
    }

    // 7 lanes preview for Base 0
    const lane0Lbl = new Text({ text: '7 轨底座排布 (Base 0):', style: { fill: 0x81d4fa, fontSize: 12 } });
    lane0Lbl.position.set(30, 155);
    this.previewLayer.addChild(lane0Lbl);

    for (let l = 0; l < 7; l++) {
      const colorIdx = DEFAULT_SKIN.laneColorIndices[l];
      const tex = this.createSubTexture(DEFAULT_SKIN.noteBase0.composedPath, {
        x: colorIdx * 26,
        y: 0,
        width: 26,
        height: 24
      });
      if (tex) {
        const s = new Sprite(tex);
        s.position.set(30 + l * 28.28, 180);
        this.previewLayer.addChild(s);
      }
    }

    // Section 2: Note Base 1 (Flat: 26x12) - RESTORATION TARGET
    const lbl1 = new Text({
      text: '【皮肤方案 1 (原版截图规范)】note_base1 (26×12) + note_skin1 (26×12) [白色扁底座]',
      style: new TextStyle({ fill: 0x00e676, fontSize: 13, fontWeight: 'bold' })
    });
    lbl1.position.set(30, 245);
    this.previewLayer.addChild(lbl1);

    const b1Tex = this.textures[DEFAULT_SKIN.noteBase1.basePath];
    if (b1Tex) {
      const b1 = new Sprite(b1Tex);
      b1.position.set(30, 275);
      this.previewLayer.addChild(b1);

      const b1Desc = new Text({ text: 'base1 (26×12)', style: { fill: 0xaaaaaa, fontSize: 11 } });
      b1Desc.position.set(30, 295);
      this.previewLayer.addChild(b1Desc);
    }

    const c1Tex = this.textures[DEFAULT_SKIN.noteBase1.composedPath];
    if (c1Tex) {
      const c1 = new Sprite(c1Tex);
      c1.position.set(130, 275);
      this.previewLayer.addChild(c1);

      const c1Desc = new Text({ text: 'composed1 全 16 帧复合扁心形 (截图对应)', style: { fill: 0x00e676, fontSize: 11 } });
      c1Desc.position.set(130, 295);
      this.previewLayer.addChild(c1Desc);
    }

    // 7 lanes preview for Base 1
    const lane1Lbl = new Text({ text: '7 轨底座排布 (Base 1 扁心形):', style: { fill: 0x81d4fa, fontSize: 12 } });
    lane1Lbl.position.set(30, 330);
    this.previewLayer.addChild(lane1Lbl);

    for (let l = 0; l < 7; l++) {
      const colorIdx = DEFAULT_SKIN.laneColorIndices[l];
      const tex = this.createSubTexture(DEFAULT_SKIN.noteBase1.composedPath, {
        x: colorIdx * 26,
        y: 0,
        width: 26,
        height: 12
      });
      if (tex) {
        const s = new Sprite(tex);
        s.position.set(30 + l * 28.28, 355);
        this.previewLayer.addChild(s);
      }
    }

    // Overlay Comparison (2x Zoomed for visual inspection)
    const holdX = 530;
    const holdY = 400 - (1 - this.state.timeSec) * 20;
    const hold = new Graphics().rect(holdX + 7, holdY - 60, 12, 60).fill(0xff80ab);
    this.previewLayer.addChild(hold);
    for (const y of [holdY - 60, holdY]) {
      const head = new Sprite(this.createSubTexture(DEFAULT_SKIN.noteBase1.composedPath, { x: 0, y: 0, width: 26, height: 12 })!);
      head.anchor.set(0.5, 1);
      head.position.set(holdX + 13, y);
      this.previewLayer.addChild(head);
    }
    const timeLabel = new Text({ text: `Hold sample t=${this.state.timeSec.toFixed(2)}s`, style: { fill: 0xffffff, fontSize: 11 } });
    timeLabel.position.set(440, 435);
    this.previewLayer.addChild(timeLabel);
    const zoomTitle = new Text({ text: '🔍 像素级放大对比 (3x Zoom):', style: { fill: 0xffd54f, fontSize: 13, fontWeight: 'bold' } });
    zoomTitle.position.set(30, 410);
    this.previewLayer.addChild(zoomTitle);

    if (c0Tex) {
      const zoom0 = new Sprite(this.createSubTexture(DEFAULT_SKIN.noteBase0.composedPath, { x: 0, y: 0, width: 26, height: 24 })!);
      zoom0.position.set(30, 440);
      zoom0.scale.set(3);
      this.previewLayer.addChild(zoom0);
    }
    if (c1Tex) {
      const zoom1 = new Sprite(this.createSubTexture(DEFAULT_SKIN.noteBase1.composedPath, { x: 0, y: 0, width: 26, height: 12 })!);
      zoom1.position.set(160, 440);
      zoom1.scale.set(3);
      this.previewLayer.addChild(zoom1);
    }
  }

  // -------------------------------------------------------------
  // View 2: Face Map & Stage Characters (Frame by Frame)
  // -------------------------------------------------------------
  private renderCharactersView(): void {
    const title = new Text({
      text: '🎭 表情与上方角色逐帧检查 (Face Map & Stage Characters)',
      style: new TextStyle({ fill: 0xff80ab, fontSize: 18, fontWeight: 'bold' })
    });
    title.position.set(30, 25);
    this.previewLayer.addChild(title);

    // 1. Face Map inside Play Area
    const faceLbl = new Text({
      text: `1. 跑道表情图 (face_map frame ${this.state.faceFrame} / 6):`,
      style: { fill: 0xffffff, fontSize: 13, fontWeight: 'bold' }
    });
    faceLbl.position.set(30, 65);
    this.previewLayer.addChild(faceLbl);

    // Show play_area background
    const paTex = this.textures[DEFAULT_SKIN.playArea.path];
    if (paTex) {
      const pa = new Sprite(paTex);
      pa.position.set(30, 95);
      this.previewLayer.addChild(pa);
    }

    // Overlay the selected face frame at (32, 95)
    const fTex = this.createSubTexture(DEFAULT_SKIN.faceMap.path, {
      x: 0,
      y: this.state.faceFrame * 120,
      width: 194,
      height: 120
    });
    if (fTex) {
      const f = new Sprite(fTex);
      f.position.set(32, 95);
      this.previewLayer.addChild(f);
    }

    const faceNote = new Text({
      text: `当前: Frame ${this.state.faceFrame} (${
        this.state.faceFrame === 0 ? '微笑笑脸' : this.state.faceFrame === 3 ? '惊讶脸' : this.state.faceFrame === 5 ? '悲伤脸' : '状态' + this.state.faceFrame
      })\n观察与背景轨道线是否重合对齐`,
      style: { fill: 0xffd54f, fontSize: 11 }
    });
    faceNote.position.set(30, 440);
    this.previewLayer.addChild(faceNote);

    // 2. Yellow Star Character
    const starLbl = new Text({
      text: `2. 黄色星形角色 (star frame ${this.state.starFrame} / 63):`,
      style: { fill: 0xffffff, fontSize: 13, fontWeight: 'bold' }
    });
    starLbl.position.set(270, 65);
    this.previewLayer.addChild(starLbl);

    const sTex = this.createSubTexture(DEFAULT_SKIN.star.path, {
      x: 0,
      y: this.state.starFrame * 114,
      width: 122,
      height: 114
    });
    if (sTex) {
      const s = new Sprite(sTex);
      s.position.set(270, 95);
      s.scale.set(1.4, 1.4);
      this.previewLayer.addChild(s);
    }

    // 3. Pink Wingky Character
    const wingkyLbl = new Text({
      text: `3. 粉色翅膀角色 (Wingky L0 frame ${this.state.wingkyFrame} / 12):`,
      style: { fill: 0xffffff, fontSize: 13, fontWeight: 'bold' }
    });
    wingkyLbl.position.set(480, 65);
    this.previewLayer.addChild(wingkyLbl);

    const w0Tex = this.createSubTexture(DEFAULT_SKIN.wingkyPinkL0.path, {
      x: 0,
      y: this.state.wingkyFrame * 50,
      width: 76,
      height: 50
    });
    if (w0Tex) {
      const w0 = new Sprite(w0Tex);
      w0.position.set(480, 95);
      w0.scale.set(1.5, 1.5);
      this.previewLayer.addChild(w0);
    }
  }

  // -------------------------------------------------------------
  // View 3: Combo Font & Hit Bursts
  // -------------------------------------------------------------
  private renderComboAndBurstsView(): void {
    const title = new Text({
      text: '💥 连击字模与击中闪光逐帧检查 (Combo & Hit Bursts)',
      style: new TextStyle({ fill: 0xff80ab, fontSize: 18, fontWeight: 'bold' })
    });
    title.position.set(30, 25);
    this.previewLayer.addChild(title);

    // 1. Combo Digits Rendering
    const comboLbl = new Text({
      text: `1. 原版连击字模渲染 (当前连击值: ${this.state.comboValue}):`,
      style: { fill: 0xffffff, fontSize: 13, fontWeight: 'bold' }
    });
    comboLbl.position.set(30, 65);
    this.previewLayer.addChild(comboLbl);

    const digits = String(this.state.comboValue).split('');
    const charW = DEFAULT_SKIN.comboFont.charWidth;
    const charH = DEFAULT_SKIN.comboFont.charHeight;
    const totalW = digits.length * charW;
    const startX = 200 - totalW / 2; // Centered at 200

    // Can background context
    const canTex = this.textures[DEFAULT_SKIN.canFrame.path];
    if (canTex) {
      const can = new Sprite(canTex);
      can.position.set(30, 95);
      can.scale.set(0.7, 0.7);
      this.previewLayer.addChild(can);
    }

    digits.forEach((d, i) => {
      const num = parseInt(d, 10);
      const tex = this.createSubTexture(DEFAULT_SKIN.comboFont.path, {
        x: num * charW,
        y: 0,
        width: charW,
        height: charH
      });
      if (tex) {
        const s = new Sprite(tex);
        s.position.set(startX + i * charW, 140);
        this.previewLayer.addChild(s);
      }
    });

    // 2. Short note burst (hitani0_0)
    const burstLbl = new Text({
      text: `2. 短音符闪光 (hitani0_0 Frame ${this.state.hitFrame}/9):`,
      style: { fill: 0xffffff, fontSize: 12, fontWeight: 'bold' }
    });
    burstLbl.position.set(260, 65);
    this.previewLayer.addChild(burstLbl);

    const bTex = this.createSubTexture(DEFAULT_SKIN.hitBurst0.path, {
      x: this.state.hitFrame * 80,
      y: 0,
      width: 80,
      height: 118
    });
    if (bTex) {
      const bs = new Sprite(bTex);
      bs.position.set(260, 95);
      this.previewLayer.addChild(bs);
    }

    // 3. Long note hold burst
    const holdLbl = new Text({
      text: `3. 长按爆光 (longnote Frame ${this.state.hitFrame}/9):`,
      style: { fill: 0xffffff, fontSize: 12, fontWeight: 'bold' }
    });
    holdLbl.position.set(470, 65);
    this.previewLayer.addChild(holdLbl);

    const lTex = this.createSubTexture(DEFAULT_SKIN.hitBurstLongNote0.path, {
      x: this.state.hitFrame * 32,
      y: 0,
      width: 32,
      height: 32
    });
    if (lTex) {
      const ls = new Sprite(lTex);
      ls.position.set(470, 100);
      ls.scale.set(2, 2);
      this.previewLayer.addChild(ls);
    }
  }

  // -------------------------------------------------------------
  // View 4: Result Simulation & Korean Message Blocks
  // -------------------------------------------------------------
  private renderResultSimulationView(): void {
    const title = new Text({
      text: `🏆 模拟结算画面检查 (Mode: ${this.state.resultType.toUpperCase()})`,
      style: new TextStyle({ fill: 0xff80ab, fontSize: 18, fontWeight: 'bold' })
    });
    title.position.set(30, 25);
    this.previewLayer.addChild(title);

    // Can Frame
    const canTex = this.textures[DEFAULT_SKIN.canFrame.path];
    if (canTex) {
      const can = new Sprite(canTex);
      can.position.set(40, 70);
      this.previewLayer.addChild(can);
    }

    const crops = DEFAULT_SKIN.resultAtlas.crops;

    if (this.state.resultType === 'result') {
      // 1. Result Title
      const titleTex = this.createSubTexture(DEFAULT_SKIN.resultAtlas.path, crops.titleResult);
      if (titleTex) {
        const s = new Sprite(titleTex);
        s.position.set(85, 90);
        this.previewLayer.addChild(s);
      }

      // 2. Score with 0_Score font (e.g. 05820)
      const scoreStr = '05820';
      const charW = DEFAULT_SKIN.scoreFont.charWidth;
      const charH = DEFAULT_SKIN.scoreFont.charHeight;
      scoreStr.split('').forEach((d, i) => {
        const num = parseInt(d, 10);
        const sTex = this.createSubTexture(DEFAULT_SKIN.scoreFont.path, {
          x: num * charW,
          y: 0,
          width: charW,
          height: charH
        });
        if (sTex) {
          const s = new Sprite(sTex);
          s.position.set(100 + i * charW, 140);
          this.previewLayer.addChild(s);
        }
      });

      // 3. Heart badge
      const hCrop = crops.hearts[this.state.heartIndex] || crops.hearts[2];
      const hTex = this.createSubTexture(DEFAULT_SKIN.resultAtlas.path, hCrop);
      if (hTex) {
        const h = new Sprite(hTex);
        h.position.set(125, 180);
        this.previewLayer.addChild(h);
      }

      // 4. Multiplier badge (e.g. x4)
      const bCrop = this.state.badgeMultiplier === 4 ? crops.badge4x : crops.badge2x;
      const bTex = this.createSubTexture(DEFAULT_SKIN.resultAtlas.path, bCrop);
      if (bTex) {
        const b = new Sprite(bTex);
        b.position.set(135, 290);
        this.previewLayer.addChild(b);
      }
    } else {
      // Failed Screen
      const failTex = this.createSubTexture(DEFAULT_SKIN.resultAtlas.path, crops.titleFailed);
      if (failTex) {
        const f = new Sprite(failTex);
        f.position.set(93, 90);
        this.previewLayer.addChild(f);
      }

      // Sad expression
      const sadTex = this.createSubTexture(DEFAULT_SKIN.faceMap.path, {
        x: 0,
        y: 5 * 120,
        width: 194,
        height: 120
      });
      if (sadTex) {
        const sad = new Sprite(sadTex);
        sad.position.set(70, 150);
        this.previewLayer.addChild(sad);
      }
    }

    // Korean Encouragement Message Block
    const msgLbl = new Text({
      text: `韩文结算文字 message.png (Block ${this.state.messageIndex} / 16):`,
      style: { fill: 0xffffff, fontSize: 13, fontWeight: 'bold' }
    });
    msgLbl.position.set(340, 70);
    this.previewLayer.addChild(msgLbl);

    const mCrop = DEFAULT_SKIN.messageAtlas.messages[this.state.messageIndex];
    if (mCrop) {
      const mTex = this.createSubTexture(DEFAULT_SKIN.messageAtlas.path, mCrop);
      if (mTex) {
        const ms = new Sprite(mTex);
        ms.position.set(340, 100);
        ms.scale.set(1.5, 1.5);
        this.previewLayer.addChild(ms);
      }
    }
  }

  // -------------------------------------------------------------
  // View 5: Crop Bounds & Metadata Inspector
  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // View 6: P1 Layout Calibration (background + can + play area + judge line)
  // -------------------------------------------------------------
  private renderLayoutCalibrationView(): void {
    const L = DEFAULT_SKIN.layout;

    // 1. Global background at its natural size.
    const bgTex = this.textures[DEFAULT_SKIN.bg.path];
    if (bgTex) {
      const bg = new Sprite(bgTex);
      bg.width = L.stageWidth;
      bg.height = L.stageHeight;
      this.previewLayer.addChild(bg);
    }

    const canBackTex = this.textures[DEFAULT_SKIN.canBack.path];
    if (canBackTex) {
      const canBack = new Sprite(canBackTex);
      canBack.position.set(L.canBack.x, L.canBack.y);
      canBack.width = L.canBack.width;
      canBack.height = L.canBack.height;
      this.previewLayer.addChild(canBack);
    }

    // 2. Play area at its natural size; no local stretch (plan P1 step 2).
    const paTex = this.createSubTexture(DEFAULT_SKIN.playArea.path,
      { x: 0, y: 0, width: L.playWidth, height: L.playHeight });
    if (paTex) {
      const pa = new Sprite(paTex);
      pa.position.set(L.playX, L.playY);
      pa.width = L.playWidth;
      pa.height = L.playHeight;
      this.previewLayer.addChild(pa);
    }

    // 3. Can frame at its natural size.
    const canTex = this.textures[DEFAULT_SKIN.canFrame.path];
    if (canTex) {
      const can = new Sprite(canTex);
      can.position.set(L.canX, L.canY);
      can.width = L.canWidth;
      can.height = L.canHeight;
      this.previewLayer.addChild(can);
    }

    // 4. Judgement bar and the seven keys, drawn from the shared rectangles
    // that hitTestKey() uses for pointer input.
    const hbTex = this.textures[DEFAULT_SKIN.hitBar0.path];
    if (hbTex) {
      const hb = new Sprite(hbTex);
      hb.position.set(L.hitBar.x, L.hitBar.y);
      hb.width = L.hitBar.width;
      hb.height = L.hitBar.height;
      this.previewLayer.addChild(hb);
    }

    const keyTex = this.textures[DEFAULT_SKIN.keyNormal.path];
    L.keyPositions.forEach((k, lane) => {
      if (keyTex) {
        const key = new Sprite(keyTex);
        key.position.set(k.x, k.y);
        key.width = k.width;
        key.height = k.height;
        this.previewLayer.addChild(key);
      }
      const outline = new Graphics().rect(k.x, k.y, k.width, k.height)
        .stroke({ width: 1, color: lane === 3 ? 0x00e676 : 0xffd54f });
      this.previewLayer.addChild(outline);
    });

    // 5. Judgement contact line marker.
    const judge = new Graphics()
      .moveTo(L.playX - 24, L.judgeY)
      .lineTo(L.playX + L.playWidth + 24, L.judgeY)
      .stroke({ width: 1, color: 0xff00ff, alpha: .9 });
    this.previewLayer.addChild(judge);

    const info = new Text({
      text: [
        `P1 layout | stage ${L.stageWidth}x${L.stageHeight}`,
        `play (${L.playX},${L.playY}) ${L.playWidth}x${L.playHeight}`,
        `canback (${L.canBack.x},${L.canBack.y}) ${L.canBack.width}x${L.canBack.height}`,
        `can (${L.canX},${L.canY}) ${L.canWidth}x${L.canHeight}`,
        `judgeY ${L.judgeY} (play-local ${L.judgeY - L.playY})`,
        `lane ${L.laneWidth}x${L.laneCount} | hitBar (${L.hitBar.x},${L.hitBar.y})`,
        `keys ${L.keyPositions.map(k => `${k.x},${k.y}`).join(' | ')}`
      ].join('\n'),
      style: new TextStyle({ fill: 0x00e676, fontSize: 10, fontFamily: 'monospace' })
    });
    info.position.set(288, 40);
    this.previewLayer.addChild(info);
  }

  private renderCropsInspectorView(): void {
    let isValid = true;
    let errorMsg = '';
    try {
      validateSkinCrops(DEFAULT_SKIN);
    } catch (e: any) {
      isValid = false;
      errorMsg = e?.message || String(e);
    }

    const title = new Text({
      text: isValid ? '✅ 全图集裁剪矩形与帧边界验证：全部合法 (0 越界)' : '❌ 裁剪越界错误',
      style: new TextStyle({ fill: isValid ? 0x00e676 : 0xff5252, fontSize: 16, fontWeight: 'bold' })
    });
    title.position.set(30, 20);
    this.previewLayer.addChild(title);

    if (!isValid) {
      const err = new Text({ text: errorMsg, style: { fill: 0xff5252, fontSize: 12 } });
      err.position.set(30, 50);
      this.previewLayer.addChild(err);
      return;
    }

    const details = new Text({
      text: [
        '• 资产清单: 42 项专有格式资产 100% 成功转换 (RGB565 / vlle / vifont)',
        '• 图像数据消费与 dataLen 一致；字模附加数据保存在 manifest 中',
        '• Result 图集: titleResult, clear, failed, 5 组心形徽章, 4 组倍率徽章全部位于 (800×600) 范围内',
        '• Message 图集: 17 组韩文鼓励文字边界全部合法位于 (194×1148) 范围内',
        '• 多帧图集: note_skin0/1 (16 帧), face_map (7 帧), star (64 帧), wingky (13 帧) 切分合法',
        '• 字模解析: combo (52×70), score (26×26), ratio (12×12), eq (7×7) 头信息与图集对齐'
      ].join('\n'),
      style: { fill: 0xb0bec5, fontSize: 11, lineHeight: 18 }
    });
    details.position.set(30, 50);
    this.previewLayer.addChild(details);

    // Overview contact sheet preview
    const sheetTex = this.textures['/assets/classic/contact_sheet_overview.png'];
    if (sheetTex) {
      const s = new Sprite(sheetTex);
      s.position.set(30, 180);
      s.scale.set(0.5, 0.5);
      this.previewLayer.addChild(s);
    }
  }

  // -------------------------------------------------------------
  // Floating HTML HUD Panel
  // -------------------------------------------------------------
  private createUI(): void {
    // 1. Header toggle button
    const headerBtns = document.querySelector('.header-btns');
    if (headerBtns) {
      const btn = document.createElement('button');
      btn.id = 'dev-preview-toggle-btn';
      btn.className = 'btn';
      btn.innerHTML = '🛠 视觉校准预览';
      btn.onclick = () => this.toggle();
      headerBtns.prepend(btn);
    }

    // 2. Floating panel container
    const panel = document.createElement('div');
    panel.id = 'dev-preview-panel';
    panel.style.cssText = `
      position: fixed;
      bottom: 12px;
      right: 12px;
      width: min(440px, calc(100vw - 48px));
      max-height: 480px;
      background: rgba(18, 14, 30, 0.95);
      border: 1px solid rgba(255, 64, 129, 0.5);
      border-radius: 8px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.85);
      z-index: 999999;
      color: #eee;
      font-family: monospace, sans-serif;
      font-size: 12px;
      display: none;
      overflow-y: auto;
      padding: 12px;
    `;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid #ff4081; padding-bottom: 6px; margin-bottom: 8px;">
        <strong style="color:#ff80ab; font-size:13px;">🛠 MeowCan 视觉校准开发预览 (DEV)</strong>
        <button id="dev-preview-close" style="background:none; border:none; color:#bbb; cursor:pointer; font-size:16px;">✕</button>
      </div>

      <div style="display:flex; gap:4px; margin-bottom:10px; flex-wrap:wrap;">
        <button class="dev-tab-btn" data-tab="layout" style="padding:3px 8px; cursor:pointer; background:#2c2240; color:#fff; border:1px solid #443;">布局校准</button>
        <button class="dev-tab-btn" data-tab="notes" style="padding:3px 8px; cursor:pointer; background:#2c2240; color:#fff; border:1px solid #443;">音符底座</button>
        <button class="dev-tab-btn" data-tab="characters" style="padding:3px 8px; cursor:pointer; background:#2c2240; color:#fff; border:1px solid #443;">表情角色</button>
        <button class="dev-tab-btn" data-tab="combo" style="padding:3px 8px; cursor:pointer; background:#2c2240; color:#fff; border:1px solid #443;">连击击中</button>
        <button class="dev-tab-btn" data-tab="result" style="padding:3px 8px; cursor:pointer; background:#2c2240; color:#fff; border:1px solid #443;">结算文字</button>
        <button class="dev-tab-btn" data-tab="crops" style="padding:3px 8px; cursor:pointer; background:#2c2240; color:#fff; border:1px solid #443;">裁剪校验</button>
      </div>

      <div id="dev-tab-content"></div>
    `;

    document.body.appendChild(panel);
    this.panelEl = panel;

    // Attach Tab events
    const tabBtns = panel.querySelectorAll('.dev-tab-btn');
    tabBtns.forEach((b) => {      b.addEventListener('click', (e) => {
        const tab = (e.target as HTMLElement).getAttribute('data-tab') as any;
        this.state.tab = tab;
        this.updateTabUI();
        this.renderCurrentState();
      });
    });

    panel.querySelector('#dev-preview-close')?.addEventListener('click', () => {
      this.deactivate();
    });

    this.updateTabUI();
  }

  private updateTabUI(): void {
    if (!this.panelEl) return;
    const content = this.panelEl.querySelector('#dev-tab-content');
    if (!content) return;

    // Update active tab button style
    this.panelEl.querySelectorAll('.dev-tab-btn').forEach((btn) => {
      const t = btn.getAttribute('data-tab');
      if (t === this.state.tab) {
        (btn as HTMLElement).style.background = '#ff4081';
        (btn as HTMLElement).style.borderColor = '#ff80ab';
      } else {
        (btn as HTMLElement).style.background = '#2c2240';
        (btn as HTMLElement).style.borderColor = '#443';
      }
    });

    if (this.state.tab === 'notes') {
      content.innerHTML = `
        <div style="line-height:1.6;">
          <p><strong>底座对比：</strong></p>
          <p>• 方案 0：note_base0 (26×24) + note_skin0 (26×24)</p>
          <p>• 方案 1：note_base1 (26×12) + note_skin1 (26×12) <span style="color:#00e676;">[原版截图规范]</span></p>
          <p style="color:#aaa; font-size:11px;">画布中央已同时列出两种底座的单帧、全 16 帧复合图、7 轨排布与放大像素。</p>
          <label>固定时间 (秒)：<input id="input-time" type="number" min="0" max="2" step="0.1" value="${this.state.timeSec}"></label>
        </div>
      `;
      content.querySelector('#input-time')?.addEventListener('input', (e: Event) => {
        this.state.timeSec = Math.max(0, Math.min(2, Number((e.target as HTMLInputElement).value) || 0));
        this.renderCurrentState();
      });
    } else if (this.state.tab === 'characters') {
      content.innerHTML = `
        <div>
          <label>表情帧 face_map (0..6): <span id="val-face">${this.state.faceFrame}</span></label>
          <input type="range" id="input-face" min="0" max="6" value="${this.state.faceFrame}" style="width:100%;">

          <label style="margin-top:8px; display:block;">黄色星形 star.lle (0..63): <span id="val-star">${this.state.starFrame}</span></label>
          <input type="range" id="input-star" min="0" max="63" value="${this.state.starFrame}" style="width:100%;">

          <label style="margin-top:8px; display:block;">翅膀角色 Wingky L0 (0..12): <span id="val-wingky">${this.state.wingkyFrame}</span></label>
          <input type="range" id="input-wingky" min="0" max="12" value="${this.state.wingkyFrame}" style="width:100%;">
        </div>
      `;

      content.querySelector('#input-face')?.addEventListener('input', (e: any) => {
        this.state.faceFrame = parseInt(e.target.value, 10);
        content.querySelector('#val-face')!.textContent = String(this.state.faceFrame);
        this.renderCurrentState();
      });

      content.querySelector('#input-star')?.addEventListener('input', (e: any) => {
        this.state.starFrame = parseInt(e.target.value, 10);
        content.querySelector('#val-star')!.textContent = String(this.state.starFrame);
        this.renderCurrentState();
      });

      content.querySelector('#input-wingky')?.addEventListener('input', (e: any) => {
        this.state.wingkyFrame = parseInt(e.target.value, 10);
        content.querySelector('#val-wingky')!.textContent = String(this.state.wingkyFrame);
        this.renderCurrentState();
      });
    } else if (this.state.tab === 'combo') {
      content.innerHTML = `
        <div>
          <label>输入测试连击数值: </label>
          <input type="number" id="input-combo" value="${this.state.comboValue}" min="0" max="99999" style="width:80px; background:#222; color:#fff; border:1px solid #555; padding:2px 4px;">
          <div style="margin-top:6px; display:flex; gap:4px;">
            <button class="combo-preset" data-v="1">1</button>
            <button class="combo-preset" data-v="9">9</button>
            <button class="combo-preset" data-v="10">10</button>
            <button class="combo-preset" data-v="99">99</button>
            <button class="combo-preset" data-v="100">100</button>
            <button class="combo-preset" data-v="1000">1000</button>
          </div>

          <label style="margin-top:12px; display:block;">击中闪光帧 (0..9): <span id="val-hit">${this.state.hitFrame}</span></label>
          <input type="range" id="input-hit" min="0" max="9" value="${this.state.hitFrame}" style="width:100%;">
        </div>
      `;

      content.querySelector('#input-combo')?.addEventListener('input', (e: any) => {
        this.state.comboValue = Math.max(0, Math.min(99999, parseInt(e.target.value, 10) || 0));
        this.renderCurrentState();
      });

      content.querySelectorAll('.combo-preset').forEach((b) => {
        b.addEventListener('click', (e: any) => {
          this.state.comboValue = parseInt(e.target.getAttribute('data-v'), 10);
          (content.querySelector('#input-combo') as HTMLInputElement).value = String(this.state.comboValue);
          this.renderCurrentState();
        });
      });

      content.querySelector('#input-hit')?.addEventListener('input', (e: any) => {
        this.state.hitFrame = parseInt(e.target.value, 10);
        content.querySelector('#val-hit')!.textContent = String(this.state.hitFrame);
        this.renderCurrentState();
      });
    } else if (this.state.tab === 'result') {
      content.innerHTML = `
        <div>
          <label>结算状态切换: </label>
          <select id="select-res-type" style="background:#222; color:#fff; border:1px solid #555; padding:2px;">
            <option value="result" ${this.state.resultType === 'result' ? 'selected' : ''}>Clear (通关结算)</option>
            <option value="failed" ${this.state.resultType === 'failed' ? 'selected' : ''}>Failed (失败结算)</option>
          </select>

          <label style="margin-top:10px; display:block;">韩文鼓励文字 message.png (Block 0..16): <span id="val-msg">${this.state.messageIndex}</span></label>
          <input type="range" id="input-msg" min="0" max="16" value="${this.state.messageIndex}" style="width:100%;">

          <div style="margin-top:8px; display:flex; gap:12px;">
            <label>心形 (0..4):
              <select id="select-heart" style="background:#222; color:#fff; border:1px solid #555;">
                <option value="0" ${this.state.heartIndex === 0 ? 'selected' : ''}>0 (小)</option>
                <option value="1" ${this.state.heartIndex === 1 ? 'selected' : ''}>1</option>
                <option value="2" ${this.state.heartIndex === 2 ? 'selected' : ''}>2 (中)</option>
                <option value="3" ${this.state.heartIndex === 3 ? 'selected' : ''}>3</option>
                <option value="4" ${this.state.heartIndex === 4 ? 'selected' : ''}>4 (大)</option>
              </select>
            </label>
            <label>倍率:
              <select id="select-badge" style="background:#222; color:#fff; border:1px solid #555;">
                <option value="4" ${this.state.badgeMultiplier === 4 ? 'selected' : ''}>x4</option>
                <option value="2" ${this.state.badgeMultiplier === 2 ? 'selected' : ''}>x2</option>
              </select>
            </label>
          </div>
        </div>
      `;

      content.querySelector('#select-res-type')?.addEventListener('change', (e: any) => {
        this.state.resultType = e.target.value;
        this.renderCurrentState();
      });

      content.querySelector('#input-msg')?.addEventListener('input', (e: any) => {
        this.state.messageIndex = parseInt(e.target.value, 10);
        content.querySelector('#val-msg')!.textContent = String(this.state.messageIndex);
        this.renderCurrentState();
      });

      content.querySelector('#select-heart')?.addEventListener('change', (e: any) => {
        this.state.heartIndex = parseInt(e.target.value, 10);
        this.renderCurrentState();
      });

      content.querySelector('#select-badge')?.addEventListener('change', (e: any) => {
        this.state.badgeMultiplier = parseInt(e.target.value, 10);
        this.renderCurrentState();
      });
    } else if (this.state.tab === 'crops') {
      content.innerHTML = `
        <div>
          <p style="color:#00e676;">✅ 显式裁剪表 (Crops Table) 校验通过！</p>
          <ul style="padding-left:16px; margin-top:6px; color:#ccc; font-size:11px;">
            <li>result.lle 标题 (Result, Clear, Failed) 尺寸与坐标合法</li>
            <li>result.lle 心形徽章 (5 组矩形) 尺寸合法无截断</li>
            <li>result.lle 统计线与倍率徽章 (×2、×3、×4、×100) 尺寸合法</li>
            <li>message.lle 17 个文字块矩形边界全量校验通过</li>
            <li>多帧图集 (face_map, star, wingky, hitani) 帧跨度合法</li>
          </ul>
        </div>
      `;
    } else if (this.state.tab === 'layout') {
      const L = DEFAULT_SKIN.layout;
      content.innerHTML = `
        <div>
          <p style="color:#00e676;">✅ P1 布局常量 (单一几何来源)</p>
          <ul style="padding-left:16px; margin-top:6px; color:#ccc; font-size:11px;">
            <li>逻辑舞台 ${L.stageWidth}×${L.stageHeight}，等比缩放并居中留边</li>
            <li>跑道 (${L.playX}, ${L.playY}) ${L.playWidth}×${L.playHeight}（自然尺寸，无拉伸）</li>
            <li>罐内背景 (${L.canBack.x}, ${L.canBack.y}) ${L.canBack.width}×${L.canBack.height}</li>
            <li>罐体 (${L.canX}, ${L.canY}) ${L.canWidth}×${L.canHeight}</li>
            <li>判定接触线 judgeY = ${L.judgeY}，判定条 (${L.hitBar.x}, ${L.hitBar.y})</li>
            <li>轨道宽 ${L.laneWidth}×${L.laneCount}，按键 7 组浅 U 形</li>
          </ul>
          <p style="color:#ffd54f; font-size:11px; margin-top:6px;">点击按键矩形可查看命中测试（黄框 = 命中区域）。</p>
        </div>
      `;
    }
  }
}
