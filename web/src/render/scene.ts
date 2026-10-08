/** Small scene model used by the game. No DOM or GPU work occurs in constructors. */
export class Point {
  constructor(public x = 0, public y = 0) {}
  set(x: number, y = x): void { this.x = x; this.y = y; }
}

export class Rectangle {
  constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
  contains(x: number, y: number): boolean {
    return x >= this.x && y >= this.y && x < this.x + this.width && y < this.y + this.height;
  }
}

export class CanvasSource {
  resource: CanvasImageSource;
  scaleMode: 'nearest' | 'linear';
  revision = 0;
  destroyed = false;
  readonly dispose = new Set<() => void>();
  constructor(options: { resource: CanvasImageSource; scaleMode?: 'nearest' | 'linear'; autoGenerateMipmaps?: boolean }) {
    this.resource = options.resource;
    this.scaleMode = options.scaleMode ?? 'linear';
  }
  get width(): number { return (this.resource as HTMLCanvasElement).width; }
  get height(): number { return (this.resource as HTMLCanvasElement).height; }
  update(): void { this.revision++; }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const release of this.dispose) release();
    this.dispose.clear();
  }
}

export class Texture {
  static readonly WHITE = new Texture({ source: new CanvasSource({ resource: { width: 1, height: 1 } as HTMLCanvasElement }) });
  static readonly EMPTY = new Texture({ source: new CanvasSource({ resource: { width: 1, height: 1 } as HTMLCanvasElement }), empty: true });
  readonly source: CanvasSource;
  readonly frame: Rectangle;
  readonly empty: boolean;
  constructor(options: { source: CanvasSource; frame?: Rectangle; empty?: boolean } = { source: Texture.EMPTY.source }) {
    this.source = options.source;
    this.frame = options.frame ?? new Rectangle(0, 0, options.source.width, options.source.height);
    this.empty = options.empty ?? false;
  }
  get width(): number { return this.frame.width; }
  get height(): number { return this.frame.height; }
  destroy(destroySource = false): void { if (destroySource) this.source.destroy(); }
}

const assetCache = new Map<string, Promise<Texture>>();
export const Assets = {
  load(url: string): Promise<Texture> {
    const cached = assetCache.get(url);
    if (cached) return cached;
    const loading = new Promise<Texture>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(new Texture({ source: new CanvasSource({ resource: image }) }));
      image.onerror = () => reject(new Error(`Cannot load texture: ${url}`));
      image.src = url;
    });
    assetCache.set(url, loading);
    loading.catch(() => assetCache.delete(url));
    return loading;
  }
};

export class Container {
  label = '';
  readonly children: Container[] = [];
  parent: Container | null = null;
  readonly position = new Point();
  readonly scale = new Point(1, 1);
  visible = true;
  alpha = 1;
  eventMode = 'none';
  blendMode: 'normal' | 'add' = 'normal';
  private clip: Graphics | null = null;
  maskUsers = 0;
  get mask(): Graphics | null { return this.clip; }
  set mask(value: Graphics | null) {
    if (this.clip) this.clip.maskUsers--;
    this.clip = value;
    if (value) value.maskUsers++;
  }
  get x(): number { return this.position.x; }
  set x(value: number) { this.position.x = value; }
  get y(): number { return this.position.y; }
  set y(value: number) { this.position.y = value; }
  addChild<T extends Container>(item: T, ...others: Container[]): T {
    const items: Container[] = [item, ...others];
    for (const item of items) { item.parent?.removeChild(item); item.parent = this; this.children.push(item); }
    return item;
  }
  addChildAt<T extends Container>(item: T, index: number): T {
    item.parent?.removeChild(item); item.parent = this; this.children.splice(index, 0, item); return item;
  }
  getChildIndex(item: Container): number { return this.children.indexOf(item); }
  removeChild<T extends Container>(item: T): T {
    const index = this.children.indexOf(item);
    if (index >= 0) { this.children.splice(index, 1); item.parent = null; }
    return item;
  }
  removeChildren(): Container[] {
    const items = this.children.splice(0);
    for (const item of items) item.parent = null;
    return items;
  }
  destroy(options?: { children?: boolean; texture?: boolean }): void {
    this.parent?.removeChild(this);
    this.mask = null;
    const children = this.removeChildren();
    if (options?.children) for (const child of children) child.destroy(options);
  }
}

export class Sprite extends Container {
  readonly anchor = new Point();
  tint = 0xffffff;
  private image: Texture;
  private explicitWidth: number | null = null;
  private explicitHeight: number | null = null;
  constructor(texture = Texture.EMPTY) { super(); this.image = texture; }
  get texture(): Texture { return this.image; }
  set texture(value: Texture) {
    this.image = value;
    if (this.explicitWidth !== null) this.width = this.explicitWidth;
    if (this.explicitHeight !== null) this.height = this.explicitHeight;
  }
  get width(): number { return Math.abs(this.scale.x) * this.texture.width; }
  set width(value: number) { this.explicitWidth = value; this.scale.x = (Math.sign(this.scale.x) || 1) * value / this.texture.width; }
  get height(): number { return Math.abs(this.scale.y) * this.texture.height; }
  set height(value: number) { this.explicitHeight = value; this.scale.y = (Math.sign(this.scale.y) || 1) * value / this.texture.height; }
  override destroy(options?: { children?: boolean; texture?: boolean }): void {
    super.destroy(options); if (options?.texture) this.texture.destroy(true);
  }
}

export interface TextOptions {
  fontFamily?: string; fontSize?: number; fontWeight?: string; fill?: number | string;
  align?: string; letterSpacing?: number; lineHeight?: number;
  stroke?: { color: number; width: number };
  dropShadow?: { color: number; alpha?: number; blur?: number; distance?: number; angle?: number };
}
export class TextStyle implements TextOptions {
  revision = 0;
  fontFamily = 'Arial'; fontSize = 26; fontWeight = 'normal'; fill: number | string = 0x000000;
  align = 'left'; letterSpacing = 0; lineHeight = 0;
  stroke?: TextOptions['stroke']; dropShadow?: TextOptions['dropShadow'];
  constructor(options: TextOptions = {}) {
    Object.assign(this, options);
    return new Proxy(this, { set(target, property, value) {
      if (Reflect.get(target, property) !== value) { Reflect.set(target, property, value); target.revision++; }
      return true;
    } });
  }
}
const cssColor = (color: number | string) => typeof color === 'string' ? color : `#${color.toString(16).padStart(6, '0')}`;
let measureContext: CanvasRenderingContext2D | null = null;
export class Text extends Sprite {
  text: string;
  style: TextStyle;
  private rasterText = '';
  private rasterStyleRevision = -1;
  private measureText = '';
  private measureStyleRevision = -1;
  private size = { width: 0, height: 0 };
  private raster: Texture | null = null;
  private measuredWidth = 0;
  private measuredHeight = 0;
  constructor(options: { text?: string; style?: TextOptions } = {}) {
    super(); this.text = options.text ?? ''; this.style = new TextStyle(options.style);
  }
  private font(): string { return `${this.style.fontWeight} ${this.style.fontSize}px ${this.style.fontFamily}`; }
  measure(): { width: number; height: number } {
    if (this.measureText === this.text && this.measureStyleRevision === this.style.revision) return this.size;
    this.measureText = this.text; this.measureStyleRevision = this.style.revision;
    // Bun's scene tests deliberately run without a DOM.
    if (typeof document === 'undefined') return this.size = { width: this.text.length * this.style.fontSize * .55, height: this.style.fontSize * 1.2 };
    measureContext ??= document.createElement('canvas').getContext('2d');
    const context = measureContext!;
    context.font = this.font();
    const lines = String(this.text).split('\n');
    const width = Math.max(0, ...lines.map(line => context.measureText(line).width + Math.max(0, [...line].length - 1) * this.style.letterSpacing));
    const metrics = context.measureText('|ÉqÅM');
    const height = (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) || this.style.fontSize * 1.2;
    return this.size = { width: Math.ceil(width + (this.style.stroke?.width ?? 0) + (this.style.dropShadow?.distance ?? 0)), height: Math.ceil(Math.max(height + (this.style.stroke?.width ?? 0), this.style.lineHeight) + (lines.length - 1) * (this.style.lineHeight || height) + (this.style.dropShadow?.distance ?? 0)) };
  }
  override get width(): number { return this.measure().width * Math.abs(this.scale.x); }
  override set width(value: number) { this.scale.x = value / Math.max(1, this.measure().width); }
  override get height(): number { return this.measure().height * Math.abs(this.scale.y); }
  override set height(value: number) { this.scale.y = value / Math.max(1, this.measure().height); }
  getTexture(): Texture {
    if (this.text === this.rasterText && this.style.revision === this.rasterStyleRevision && this.raster) return this.raster;
    this.rasterText = this.text; this.rasterStyleRevision = this.style.revision;
    const size = this.measure(); this.measuredWidth = size.width; this.measuredHeight = size.height;
    const canvas = this.raster?.source.resource as HTMLCanvasElement ?? document.createElement('canvas');
    const shadow = this.style.dropShadow;
    const padding = 0;
    const halfStroke = (this.style.stroke?.width ?? 0) / 2;
    // Retain logical size separately so texture padding never changes anchors.
    canvas.width = Math.max(1, Math.ceil(size.width + padding * 2));
    canvas.height = Math.max(1, Math.ceil(size.height + padding * 2));
    const context = canvas.getContext('2d')!;
    context.font = this.font(); context.textBaseline = 'alphabetic'; context.fillStyle = cssColor(this.style.fill);
    const metrics = context.measureText('|ÉqÅM');
    const ascent = metrics.actualBoundingBoxAscent || this.style.fontSize;
    const lineHeight = this.style.lineHeight || ((metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) || this.style.fontSize * 1.2);
    if (shadow) {
      const color = shadow.color; context.shadowColor = `rgba(${color >> 16 & 255},${color >> 8 & 255},${color & 255},${shadow.alpha ?? 1})`;
      context.shadowBlur = shadow.blur ?? 0;
      context.shadowOffsetX = Math.cos(shadow.angle ?? Math.PI / 4) * (shadow.distance ?? 0);
      context.shadowOffsetY = Math.sin(shadow.angle ?? Math.PI / 4) * (shadow.distance ?? 0);
    }
    let y = padding + halfStroke + ascent + Math.max(0, (lineHeight - ((metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) || this.style.fontSize * 1.2)) / 2);
    for (const line of String(this.text).split('\n')) {
      const lineWidth = context.measureText(line).width + Math.max(0, [...line].length - 1) * this.style.letterSpacing;
      let x = padding + halfStroke + (this.style.align === 'center' ? (size.width - lineWidth) / 2 : this.style.align === 'right' ? size.width - lineWidth : 0);
      const draw = (part: string) => {
        if (this.style.stroke) { context.strokeStyle = cssColor(this.style.stroke.color); context.lineWidth = this.style.stroke.width; context.lineJoin = 'round'; context.strokeText(part, x, y); }
        context.fillText(part, x, y);
      };
      if (this.style.letterSpacing) for (const char of line) { draw(char); x += context.measureText(char).width + this.style.letterSpacing; }
      else draw(line);
      y += lineHeight;
    }
    if (!this.raster) this.raster = new Texture({ source: new CanvasSource({ resource: canvas }) });
    this.raster.frame.width = canvas.width; this.raster.frame.height = canvas.height;
    this.raster.source.update();
    this.rasterOffset = padding;
    return this.raster;
  }
  rasterOffset = 0;
  get logicalWidth(): number { return this.measuredWidth; }
  get logicalHeight(): number { return this.measuredHeight; }
  override destroy(options?: { children?: boolean; texture?: boolean }): void {
    super.destroy(options); this.raster?.destroy(true); this.raster = null;
  }
}

type Paint = number | { color?: number; alpha?: number; width?: number };
interface Shape { points: number[]; closed: boolean; fill?: Paint; stroke?: Paint }
export class GraphicsContext {
  readonly shapes: Shape[] = [];
  revision = 0;
  // Interleaved local x,y,color,alpha, cached across all instances sharing a context.
  mesh: Float32Array = new Float32Array();
  indices: Uint16Array = new Uint16Array();
  colors: Uint32Array = new Uint32Array();
  meshRevision = -1;
}
export class Graphics extends Container {
  constructor(public context = new GraphicsContext()) { super(); }
  clear(): this { this.context.shapes.length = 0; this.context.revision++; return this; }
  private shape(points: number[], closed = true): this {
    this.context.shapes.push({ points, closed }); this.context.revision++; return this;
  }
  rect(x: number, y: number, width: number, height: number): this { return this.shape([x, y, x + width, y, x + width, y + height, x, y + height]); }
  poly(points: number[]): this { return this.shape(points.slice()); }
  circle(x: number, y: number, radius: number): this {
    const points: number[] = []; const count = Math.max(16, Math.min(128, Math.ceil(Math.sqrt(radius) * 8)));
    for (let i = 0; i < count; i++) { const angle = i * Math.PI * 2 / count; points.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius); }
    return this.shape(points);
  }
  roundRect(x: number, y: number, width: number, height: number, radius: number): this {
    radius = Math.min(radius, width / 2, height / 2);
    const points: number[] = []; const count = Math.max(4, Math.ceil(Math.sqrt(radius) * 2));
    for (let corner = 0; corner < 4; corner++) {
      const cx = x + (corner === 0 || corner === 3 ? width - radius : radius);
      const cy = y + (corner < 2 ? height - radius : radius);
      for (let i = 0; i <= count; i++) { const angle = (corner + i / count) * Math.PI / 2; points.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius); }
    }
    return this.shape(points);
  }
  moveTo(x: number, y: number): this { return this.shape([x, y], false); }
  lineTo(x: number, y: number): this { this.context.shapes.at(-1)!.points.push(x, y); this.context.revision++; return this; }
  fill(paint: Paint): this { this.context.shapes.at(-1)!.fill = paint; this.context.revision++; return this; }
  stroke(paint: Paint): this { this.context.shapes.at(-1)!.stroke = paint; this.context.revision++; return this; }
  bounds(): Rectangle {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const shape of this.context.shapes) for (let i = 0; i < shape.points.length; i += 2) {
      left = Math.min(left, shape.points[i]); right = Math.max(right, shape.points[i]);
      top = Math.min(top, shape.points[i + 1]); bottom = Math.max(bottom, shape.points[i + 1]);
    }
    return new Rectangle(left, top, right - left, bottom - top);
  }
}
