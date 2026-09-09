/**
 * CanMusic Pixi.js (v8) Canvas Renderer
 */

import { Application, Assets, Container, Sprite, Graphics, Text, TextStyle, Texture, Rectangle } from 'pixi.js';
import type { PlayableNote } from '../parser/vos';
import type { GameScore, HitResult, JudgmentRating } from './judgment';

export interface RendererOptions {
  container: HTMLElement;
  width: number;
  height: number;
}

export class CanMusicRenderer {
  private app: Application;
  private rootContainer: Container;

  // Layer containers
  private bgLayer: Container;
  private playAreaContainer: Container;
  private laneLayer: Container;
  private noteLayer: Container;
  private hitEffectLayer: Container;
  private canFrameLayer: Container;
  private pdaLayer: Container;
  private uiLayer: Container;

  // Loaded textures
  private texBg!: Texture;
  private texPlayArea!: Texture;
  private texCanFrame!: Texture;
  private texHitBar!: Texture;
  private texNoteSkins: Texture[] = [];
  private texLongNote!: Texture;
  private texHitBurstFrames: Texture[] = [];
  private texComboDigits: Texture[] = [];
  private texKeyBase!: Texture;
  private texKeyPut!: Texture;

  // Hit burst animations
  private activeHitBursts: { sprite: Sprite; frame: number; timer: number; lane: number }[] = [];

  // Active note sprites pool
  private noteSpritePool: Sprite[] = [];
  private longNoteTailPool: Sprite[] = [];
  private longNoteBodyPool: Graphics[] = [];

  // Hit judgement text
  private judgeTextContainer: Container;
  private judgeText: Text;
  private judgeTextTimer = 0;

  // PDA UI elements
  private comboContainer: Container;
  private comboDigitSprites: Sprite[] = [];
  private comboLabel: Text;
  private displayedCombo = 0;

  private titleText: Text;
  private artistText: Text;
  private scoreText: Text;
  private accuracyText: Text;
  private speedText: Text;
  private timeText: Text;
  private autoText: Text;
  private lifeBarGfx: Graphics;

  // Key press visuals for 7 lanes
  private lanePressGfx: Graphics[] = [];
  private keySprites: Sprite[] = [];

  // Dimensions & Coordinates
  public readonly PLAY_X = 40;
  public readonly PLAY_Y = 140;
  public readonly PLAY_W = 198;
  public readonly PLAY_H = 280;
  public readonly LANE_WIDTH = 198 / 7; // ~28.28px
  public readonly JUDGE_Y = 256; // Judge line Y inside play area

  // Speed settings
  public speedMultiplier = 1.0;
  public basePixelsPerSec = 240;

  constructor() {
    this.app = new Application();
    this.rootContainer = new Container();
    this.bgLayer = new Container();
    this.playAreaContainer = new Container();
    this.laneLayer = new Container();
    this.noteLayer = new Container();
    this.hitEffectLayer = new Container();
    this.canFrameLayer = new Container();
    this.pdaLayer = new Container();
    this.uiLayer = new Container();

    this.judgeTextContainer = new Container();
    this.judgeText = new Text();
    this.comboContainer = new Container();
    this.comboLabel = new Text();
    this.titleText = new Text();
    this.artistText = new Text();
    this.scoreText = new Text();
    this.accuracyText = new Text();
    this.speedText = new Text();
    this.timeText = new Text();
    this.autoText = new Text();
    this.lifeBarGfx = new Graphics();
  }

  public async init(opts: RendererOptions): Promise<void> {
    await this.app.init({
      width: opts.width,
      height: opts.height,
      backgroundColor: 0x110e1a,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      antialias: true
    });

    opts.container.appendChild(this.app.canvas as HTMLCanvasElement);

    this.app.stage.addChild(this.rootContainer);
    // All scene coordinates use the original background's 716 x 516 space.
    this.rootContainer.scale.set(opts.width / 716, opts.height / 516);
    this.rootContainer.addChild(this.bgLayer);
    this.rootContainer.addChild(this.playAreaContainer);
    this.playAreaContainer.addChild(this.laneLayer);
    this.playAreaContainer.addChild(this.noteLayer);
    this.playAreaContainer.addChild(this.hitEffectLayer);
    this.rootContainer.addChild(this.canFrameLayer);
    this.rootContainer.addChild(this.pdaLayer);
    this.rootContainer.addChild(this.uiLayer);

    // Load assets
    await this.loadTextures();
    this.setupScene();
  }

  private async loadTextures(): Promise<void> {
    this.texBg = await Assets.load('/assets/bg.png');
    this.texPlayArea = await Assets.load('/assets/play_area.png');
    this.texCanFrame = await Assets.load('/assets/can.png');
    this.texHitBar = await Assets.load('/assets/hitbar0.png');
    this.texLongNote = await Assets.load('/assets/longnote.png');
    this.texKeyBase = await Assets.load('/assets/key_base.png');
    this.texKeyPut = await Assets.load('/assets/key_put.png');

    // Slice 16 note skins (416x24, 26px each)
    const baseNoteSkin = await Assets.load('/assets/note_skin0.png');
    for (let i = 0; i < 16; i++) {
      this.texNoteSkins.push(new Texture({
        source: baseNoteSkin.source,
        frame: new Rectangle(i * 26, 0, 26, 24)
      }));
    }

    // Slice 10 hit animation burst frames (800x118, 80px each)
    const baseHitAni = await Assets.load('/assets/hitani0_0.png');
    for (let i = 0; i < 10; i++) {
      this.texHitBurstFrames.push(new Texture({
        source: baseHitAni.source,
        frame: new Rectangle(i * 80, 0, 80, 118)
      }));
    }

    // Slice 10 combo digits (520x70, 52px each)
    const baseCombo = await Assets.load('/assets/combo.png');
    for (let i = 0; i < 10; i++) {
      this.texComboDigits.push(new Texture({
        source: baseCombo.source,
        frame: new Rectangle(i * 52, 0, 52, 70)
      }));
    }
  }

  private setupScene(): void {
    // 1. Background in the original asset coordinate space.
    const bg = new Sprite(this.texBg);
    bg.width = 716;
    bg.height = 516;
    this.bgLayer.addChild(bg);

    // 2. Play area setup
    this.playAreaContainer.position.set(this.PLAY_X, this.PLAY_Y);

    // Play area background
    // The texture includes a can rim; the separate frame already supplies it.
    const pa = new Sprite(new Texture({ source: this.texPlayArea.source,
      frame: new Rectangle(0, 34, 198, 270) }));
    pa.width = this.PLAY_W;
    pa.height = this.PLAY_H;
    this.playAreaContainer.addChildAt(pa, 0);
    const playMask = new Graphics().rect(0, 0, this.PLAY_W, this.PLAY_H).fill(0xffffff);
    this.playAreaContainer.addChild(playMask);
    this.playAreaContainer.mask = playMask;

    // Lane dividing lines and press visualizers
    for (let l = 0; l < 7; l++) {
      const x = l * this.LANE_WIDTH;
      // Lane press glow
      const pressGfx = new Graphics();
      pressGfx.rect(x, 0, this.LANE_WIDTH, this.JUDGE_Y + 14);
      pressGfx.fill({ color: 0xffffff, alpha: 0.15 });
      pressGfx.visible = false;
      this.laneLayer.addChild(pressGfx);
      this.lanePressGfx.push(pressGfx);

      // Lane divider
      if (l > 0) {
        const line = new Graphics();
        line.moveTo(x, 0);
        line.lineTo(x, this.PLAY_H);
        line.stroke({ width: 1, color: 0xffaacc, alpha: 0.35 });
        this.laneLayer.addChild(line);
      }
    }

    // Hit bar at judge line
    const hitBar = new Sprite(this.texHitBar);
    hitBar.width = this.PLAY_W + 18;
    hitBar.height = 24;
    hitBar.position.set(-9, this.JUDGE_Y);
    this.laneLayer.addChild(hitBar);

    // Can frame overlay
    const canFrame = new Sprite(this.texCanFrame);
    canFrame.width = 255;
    canFrame.height = 424;
    canFrame.position.set(this.PLAY_X - 28, 44);
    canFrame.alpha = 0.92;
    this.canFrameLayer.addChild(canFrame);

    // 3. Lane key buttons below the can
    const keyNames = ['S', 'D', 'F', 'SPACE', 'J', 'K', 'L'];
    for (let l = 0; l < 7; l++) {
      const kx = this.PLAY_X + l * this.LANE_WIDTH + (this.LANE_WIDTH - 24) / 2;
      const ky = 480;

      const keySpr = new Sprite(this.texKeyBase);
      keySpr.width = 24;
      keySpr.height = 24;
      keySpr.position.set(kx, ky);
      this.rootContainer.addChild(keySpr);
      this.keySprites.push(keySpr);

      const keyText = new Text({
        text: keyNames[l],
        style: new TextStyle({
          fontFamily: 'monospace',
          fontSize: l === 3 ? 9 : 11,
          fontWeight: 'bold',
          fill: 0xffffff
        })
      });
      keyText.anchor.set(0.5);
      keyText.position.set(kx + 12, ky + 12);
      this.rootContainer.addChild(keyText);
    }

    // 4. Hit Judgement text
    this.judgeTextContainer.position.set(this.PLAY_W / 2, this.JUDGE_Y - 40);
    this.judgeText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'Impact, Arial Black, sans-serif',
        fontSize: 32,
        fontWeight: 'bold',
        fill: 0x00ffff,
        stroke: { color: 0x001133, width: 5 }
      })
    });
    this.judgeText.anchor.set(0.5);
    this.judgeTextContainer.addChild(this.judgeText);
    this.playAreaContainer.addChild(this.judgeTextContainer);

    // 5. PDA Console Display (inside the green CRT screen at right)
    // Bounds measured in the original BG texture, shared with the scene scale.
    const pdaCenterX = 358;
    const pdaLeftX = 302;
    const pdaTopY = 124;

    this.titleText = new Text({
      text: 'CanMusic Web',
      style: new TextStyle({
        fontFamily: 'system-ui, sans-serif',
        fontSize: 10,
        fontWeight: 'bold',
        fill: 0x003311,
        align: 'center'
      })
    });
    this.titleText.anchor.set(0.5, 0);
    this.titleText.position.set(pdaCenterX, pdaTopY);
    this.pdaLayer.addChild(this.titleText);

    this.artistText = new Text({
      text: 'Select a song',
      style: new TextStyle({
        fontFamily: 'system-ui, sans-serif',
        fontSize: 8,
        fill: 0x115522,
        align: 'center'
      })
    });
    this.artistText.anchor.set(0.5, 0);
    this.artistText.position.set(pdaCenterX, pdaTopY + 13);
    this.pdaLayer.addChild(this.artistText);

    this.scoreText = new Text({
      text: 'SCORE: 0000000',
      style: new TextStyle({
        fontFamily: 'Courier New, monospace',
        fontSize: 9,
        fontWeight: 'bold',
        fill: 0x004411
      })
    });
    this.scoreText.position.set(pdaLeftX, pdaTopY + 25);
    this.pdaLayer.addChild(this.scoreText);

    this.accuracyText = new Text({
      text: 'ACCURACY: 100%',
      style: new TextStyle({
        fontFamily: 'Courier New, monospace',
        fontSize: 8,
        fontWeight: 'bold',
        fill: 0x004411
      })
    });
    this.accuracyText.position.set(pdaLeftX, pdaTopY + 36);
    this.pdaLayer.addChild(this.accuracyText);

    this.timeText = new Text({
      text: 'TIME: 00:00 / 00:00',
      style: new TextStyle({
        fontFamily: 'Courier New, monospace',
        fontSize: 8,
        fill: 0x004411
      })
    });
    this.timeText.position.set(pdaLeftX, pdaTopY + 47);
    this.pdaLayer.addChild(this.timeText);

    this.speedText = new Text({
      text: `SPD: ${this.speedMultiplier.toFixed(1)}x`,
      style: new TextStyle({
        fontFamily: 'Courier New, monospace',
        fontSize: 8,
        fontWeight: 'bold',
        fill: 0x004411
      })
    });
    this.speedText.position.set(pdaLeftX, pdaTopY + 58);
    this.pdaLayer.addChild(this.speedText);

    this.autoText = new Text({
      text: 'AUTO: OFF',
      style: new TextStyle({
        fontFamily: 'Courier New, monospace',
        fontSize: 8,
        fontWeight: 'bold',
        fill: 0x771111
      })
    });
    this.autoText.position.set(pdaLeftX + 65, pdaTopY + 58);
    this.pdaLayer.addChild(this.autoText);

    // Life / Groove bar at bottom of green screen
    this.lifeBarGfx.position.set(pdaLeftX, pdaTopY + 70);
    this.pdaLayer.addChild(this.lifeBarGfx);
    this.renderLifeBar(50);

    // 6. Combo counter below the PDA, clear of its information screen.
    this.comboContainer.position.set(pdaCenterX - 45, 290);
    this.comboContainer.visible = false;
    this.rootContainer.addChild(this.comboContainer);

    this.comboLabel = new Text({
      text: 'COMBO',
      style: new TextStyle({
        fontFamily: 'Impact, Arial Black, sans-serif',
        fontSize: 18,
        fontWeight: 'bold',
        fill: 0xffeb3b,
        stroke: { color: 0x33691e, width: 4 }
      })
    });
    this.comboLabel.position.set(40, 48);
    this.comboContainer.addChild(this.comboLabel);
  }

  public setLaneState(lane: number, pressed: boolean): void {
    if (lane >= 0 && lane < 7) {
      this.lanePressGfx[lane].visible = pressed;
      this.keySprites[lane].texture = pressed ? this.texKeyPut : this.texKeyBase;
    }
  }

  public showHitBurst(lane: number): void {
    const burstSprite = new Sprite(this.texHitBurstFrames[0]);
    burstSprite.anchor.set(0.5, 0.7);
    const x = lane * this.LANE_WIDTH + this.LANE_WIDTH / 2;
    const y = this.JUDGE_Y + 12;
    burstSprite.position.set(x, y);
    burstSprite.scale.set(0.65);
    this.hitEffectLayer.addChild(burstSprite);

    this.activeHitBursts.push({
      sprite: burstSprite,
      frame: 0,
      timer: 0,
      lane
    });
  }

  public showJudgement(rating: JudgmentRating): void {
    this.judgeText.text = rating;
    let color = 0x00ffff;
    if (rating === 'COOL') color = 0x00ffff;
    else if (rating === 'GOOD') color = 0x76ff03;
    else if (rating === 'BAD') color = 0xff9100;
    else if (rating === 'MISS') color = 0xff1744;

    this.judgeText.style.fill = color;
    this.judgeTextContainer.scale.set(1.3);
    this.judgeTextContainer.alpha = 1.0;
    this.judgeTextTimer = 35; // frames to stay visible
  }

  public updateCombo(combo: number): void {
    if (combo === this.displayedCombo) return;
    this.displayedCombo = combo;
    if (combo <= 1) {
      this.comboContainer.visible = false;
      return;
    }

    this.comboContainer.visible = true;
    const str = combo.toString();

    // Ensure we have enough digit sprites
    while (this.comboDigitSprites.length < str.length) {
      const spr = new Sprite(this.texComboDigits[0]);
      spr.scale.set(0.65);
      this.comboContainer.addChild(spr);
      this.comboDigitSprites.push(spr);
    }

    // Hide unused digits
    for (let i = str.length; i < this.comboDigitSprites.length; i++) {
      this.comboDigitSprites[i].visible = false;
    }

    let curX = 0;
    const digitWidth = 52 * 0.65;
    for (let i = 0; i < str.length; i++) {
      const digit = parseInt(str[i], 10);
      const spr = this.comboDigitSprites[i];
      spr.texture = this.texComboDigits[digit];
      spr.visible = true;
      spr.position.set(curX, 0);
      curX += digitWidth - 5;
    }

    this.comboLabel.position.set((curX - 45) / 2, 48);

    // Bump scale animation
    this.comboContainer.scale.set(1.15);
  }

  public setSongInfo(title: string, artist: string, level: number): void {
    this.fitText(this.titleText, title, 112);
    this.fitText(this.artistText, `${artist} (Lv.${level})`, 112);
  }

  public resetEffects(): void {
    this.updateCombo(0);
    this.judgeTextTimer = 0;
    this.judgeTextContainer.alpha = 0;
    for (const burst of this.activeHitBursts) burst.sprite.destroy();
    this.activeHitBursts = [];
  }

  private fitText(label: Text, value: string, maxWidth: number): void {
    label.text = value;
    const chars = Array.from(value);
    while (label.width > maxWidth && chars.length > 0) {
      chars.pop();
      label.text = chars.join('') + '…';
    }
  }

  public setAutoPlay(enabled: boolean): void {
    this.autoText.text = enabled ? 'AUTO: ON' : 'AUTO: OFF';
    this.autoText.style.fill = enabled ? 0x008822 : 0x771111;
  }

  public setSpeed(multiplier: number): void {
    this.speedMultiplier = multiplier;
    this.speedText.text = `SPD: ${multiplier.toFixed(1)}x`;
  }

  public renderLifeBar(life: number): void {
    this.lifeBarGfx.clear();
    const w = 112;
    const h = 6;

    // Background
    this.lifeBarGfx.rect(0, 0, w, h);
    this.lifeBarGfx.fill({ color: 0x00220a, alpha: 0.8 });
    this.lifeBarGfx.rect(0, 0, w, h);
    this.lifeBarGfx.stroke({ width: 1, color: 0x00551a });

    // Fill
    const fillW = Math.max(0, Math.min(w, (life / 100) * w));
    let color = 0x00e676;
    if (life < 30) color = 0xff3d00;
    else if (life < 60) color = 0xffea00;

    if (fillW > 0) {
      this.lifeBarGfx.rect(1, 1, Math.max(0, fillW - 2), h - 2);
      this.lifeBarGfx.fill({ color });
    }
  }

  /**
   * Main render loop called on every frame
   */
  public renderFrame(
    currentTimeSec: number,
    playableNotes: PlayableNote[],
    score: GameScore,
    totalDurationSec: number
  ): void {
    // 1. Update PDA stats
    this.scoreText.text = `SCORE: ${score.score.toString().padStart(7, '0')}`;
    this.accuracyText.text = `ACCURACY: ${score.accuracy.toFixed(1)}%`;
    this.renderLifeBar(score.life);

    const curMin = Math.floor(Math.max(0, currentTimeSec) / 60);
    const curSec = Math.floor(Math.max(0, currentTimeSec) % 60);
    const totMin = Math.floor(totalDurationSec / 60);
    const totSec = Math.floor(totalDurationSec % 60);
    this.timeText.text = `TIME: ${curMin.toString().padStart(2, '0')}:${curSec.toString().padStart(2, '0')} / ${totMin.toString().padStart(2, '0')}:${totSec.toString().padStart(2, '0')}`;

    // 2. Animate combo scale
    if (this.comboContainer.scale.x > 1.0) {
      const s = Math.max(1.0, this.comboContainer.scale.x - 0.02);
      this.comboContainer.scale.set(s);
    }

    // 3. Animate judge text fade
    if (this.judgeTextTimer > 0) {
      this.judgeTextTimer--;
      if (this.judgeTextContainer.scale.x > 1.0) {
        this.judgeTextContainer.scale.x -= 0.015;
        this.judgeTextContainer.scale.y -= 0.015;
      }
      if (this.judgeTextTimer < 15) {
        this.judgeTextContainer.alpha = this.judgeTextTimer / 15;
      }
    } else {
      this.judgeTextContainer.alpha = 0;
    }

    // 4. Update hit burst animations
    for (let i = this.activeHitBursts.length - 1; i >= 0; i--) {
      const b = this.activeHitBursts[i];
      b.timer += 1;
      if (b.timer % 2 === 0) {
        b.frame++;
        if (b.frame >= this.texHitBurstFrames.length) {
          this.hitEffectLayer.removeChild(b.sprite);
          b.sprite.destroy();
          this.activeHitBursts.splice(i, 1);
          continue;
        }
        b.sprite.texture = this.texHitBurstFrames[b.frame];
      }
    }

    // 5. Render visible falling notes
    const speed = this.basePixelsPerSec * this.speedMultiplier;
    const laneColors = [3, 8, 1, 0, 1, 8, 3]; // symmetric CanMusic heart colors

    let spriteIndex = 0;
    let longTailIndex = 0;
    let longBodyIndex = 0;

    for (let i = 0; i < playableNotes.length; i++) {
      const note = playableNotes[i];
      if (note.judged && !note.holdActive) continue;

      const delta = note.startSec - currentTimeSec;
      const yPos = note.holdActive ? this.JUDGE_Y : this.JUDGE_Y - delta * speed;

      // Check if note is visible on screen
      if (yPos < -80) {
        // Below top, future note (notes are sorted by startSec)
        break;
      }
      if (yPos > this.PLAY_H + 40 && !note.isLong) {
        // Passed bottom
        continue;
      }

      const laneX = note.lane * this.LANE_WIDTH + (this.LANE_WIDTH - 26) / 2;

      // Handle Long Note Body & Tail
      if (note.isLong) {
        const tailDelta = (note.startSec + note.durationSec) - currentTimeSec;
        const tailY = this.JUDGE_Y - tailDelta * speed;

        if (tailY < this.PLAY_H + 50) {
          const bodyTopY = Math.max(0, tailY + 12);
          const bodyBottomY = Math.min(this.PLAY_H, yPos + 12);
          const bodyHeight = bodyBottomY - bodyTopY;

          if (bodyHeight > 0) {
            // Allocate long body graphic
            let bodyGfx = this.longNoteBodyPool[longBodyIndex];
            if (!bodyGfx) {
              bodyGfx = new Graphics();
              this.noteLayer.addChild(bodyGfx);
              this.longNoteBodyPool.push(bodyGfx);
            }
            bodyGfx.visible = true;
            bodyGfx.clear();

            const laneColorHex = [0xff4081, 0x00e5ff, 0xffd600, 0xff1744, 0xffd600, 0x00e5ff, 0xff4081][note.lane];
            // Ribbon fill
            bodyGfx.rect(laneX + 3, bodyTopY, 20, bodyHeight);
            bodyGfx.fill({ color: laneColorHex, alpha: 0.65 });
            // Glowing border
            bodyGfx.rect(laneX + 3, bodyTopY, 20, bodyHeight);
            bodyGfx.stroke({ width: 2, color: 0xffffff, alpha: 0.85 });

            longBodyIndex++;

            // Long note tail cap
            let tailSpr = this.longNoteTailPool[longTailIndex];
            if (!tailSpr) {
              tailSpr = new Sprite(this.texNoteSkins[laneColors[note.lane]]);
              this.noteLayer.addChild(tailSpr);
              this.longNoteTailPool.push(tailSpr);
            }
            tailSpr.visible = true;
            tailSpr.texture = this.texNoteSkins[laneColors[note.lane]];
            tailSpr.width = 26;
            tailSpr.height = 24;
            tailSpr.alpha = 0.8;
            tailSpr.position.set(laneX, tailY);
            longTailIndex++;
          }
        }
      }

      // Short Note Head (or Long Note Head if not yet completed)
      if (yPos >= -24 && yPos <= this.PLAY_H + 20) {
        let spr = this.noteSpritePool[spriteIndex];
        if (!spr) {
          spr = new Sprite(this.texNoteSkins[0]);
          this.noteLayer.addChild(spr);
          this.noteSpritePool.push(spr);
        }
        spr.visible = true;
        spr.texture = this.texNoteSkins[laneColors[note.lane]];
        spr.width = 26;
        spr.height = 24;
        spr.position.set(laneX, yPos);
        spriteIndex++;
      }
    }

    // Hide remaining unused sprites in pool
    for (let k = spriteIndex; k < this.noteSpritePool.length; k++) {
      this.noteSpritePool[k].visible = false;
    }
    for (let k = longTailIndex; k < this.longNoteTailPool.length; k++) {
      this.longNoteTailPool[k].visible = false;
    }
    for (let k = longBodyIndex; k < this.longNoteBodyPool.length; k++) {
      this.longBodyIndexGfx(k).visible = false;
    }
  }

  private longBodyIndexGfx(k: number): Graphics {
    return this.longNoteBodyPool[k];
  }

  public destroy(): void {
    this.app.destroy(true, { children: true, texture: false });
  }
}
