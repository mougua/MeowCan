import { CanvasSource, Container, Graphics, Sprite, Text, Texture } from './scene';
export * from './scene';

const STRIDE = 6;
const MAX_VERTICES = 65532;
interface UploadedTexture { texture: WebGLTexture; revision: number; filter: string; width: number; height: number; release: () => void }

/** Ordered multi-texture batching. Geometry, indices and GPU storage are reused. */
export class WebGLRenderer {
  readonly name = 'MeowCan WebGL';
  readonly screen = { width: 0, height: 0 };
  readonly stats = { drawCalls: 0, vertices: 0, textureUploads: 0 };
  readonly prepare = { upload: async (items: (Texture | Container)[]) => {
    for (const item of items) this.prepareItem(item);
  } };
  private gl: WebGLRenderingContext;
  private program!: WebGLProgram;
  private vertexBuffer!: WebGLBuffer;
  private indexBuffer!: WebGLBuffer;
  private viewportUniform!: WebGLUniformLocation;
  private readonly data = new Float32Array(MAX_VERTICES * STRIDE);
  private readonly colors = new Uint32Array(this.data.buffer);
  private readonly indices = new Uint16Array(MAX_VERTICES * 3);
  private vertexCount = 0;
  private indexCount = 0;
  private batchVertexStart = 0;
  private batchIndexStart = 0;
  private readonly uploaded = new Map<CanvasSource, UploadedTexture>();
  private readonly slots: CanvasSource[] = [];
  private readonly boundTextures: (WebGLTexture | null)[] = [];
  private activeUnit = -1;
  private slotCount = 16;
  private additive = false;
  private viewportPixelW = -1;
  private viewportPixelH = -1;
  private viewportScreenW = -1;
  private viewportScreenH = -1;
  private lost = false;
  private destroyed = false;
  private readonly clip = new Int32Array(4);
  private readonly clipStack: number[] = [];
  private clipDepth = 0;

  constructor(readonly canvas: HTMLCanvasElement, private resolution: number, private background: number) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('此浏览器无法初始化 WebGL，请启用硬件加速。');
    this.gl = gl;
    this.initialize();
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }
  private onLost = (event: Event): void => { event.preventDefault(); this.lost = true; };
  private onRestored = (): void => {
    for (const [source, entry] of this.uploaded) source.dispose.delete(entry.release);
    this.uploaded.clear(); this.slots.length = 0;
    this.vertexCount = this.indexCount = this.batchVertexStart = this.batchIndexStart = 0;
    this.lost = false; this.initialize();
  };
  private initialize(): void {
    const gl = this.gl;
    this.slotCount = Math.min(16, gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
    this.boundTextures.length = this.slotCount;
    this.boundTextures.fill(null);
    this.activeUnit = -1;
    this.viewportPixelW = this.viewportPixelH = this.viewportScreenW = this.viewportScreenH = -1;
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? 'highp' : 'mediump';
    const compile = (type: number, code: string): WebGLShader => {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, code); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`WebGL shader: ${error}`); }
      return shader;
    };
    const sampleSlot = (low: number, high: number): string => {
      if (low === high) return `{ texel = texture2D(uTextures[${low}], vUV); }`;
      const mid = (low + high) >> 1;
      return `{ if (vSlot < ${mid + .5}) ${sampleSlot(low, mid)} else ${sampleSlot(mid + 1, high)} }`;
    };
    const vertex = compile(gl.VERTEX_SHADER, `
      precision highp float;
      attribute vec2 aPosition; attribute vec2 aUV; attribute vec4 aColor; attribute float aSlot;
      uniform vec2 uViewport;
      varying ${precision} vec2 vUV; varying lowp vec4 vColor; varying mediump float vSlot;
      void main() { gl_Position = vec4(aPosition / uViewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0); vUV = aUV; vColor = aColor; vSlot = aSlot; }
    `);
    const fragment = compile(gl.FRAGMENT_SHADER, `
      precision ${precision} float;
      varying ${precision} vec2 vUV; varying lowp vec4 vColor; varying mediump float vSlot;
      uniform sampler2D uTextures[${this.slotCount}];
      void main() { vec4 texel;
      ${sampleSlot(0, this.slotCount - 1)}
      gl_FragColor = texel * vColor; }
    `);
    this.program = gl.createProgram()!; gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment); gl.linkProgram(this.program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(`WebGL program: ${gl.getProgramInfoLog(this.program)}`);
    gl.useProgram(this.program);
    this.viewportUniform = gl.getUniformLocation(this.program, 'uViewport')!;
    gl.uniform1iv(gl.getUniformLocation(this.program, 'uTextures[0]'), Int32Array.from({ length: this.slotCount }, (_, i) => i));
    this.vertexBuffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer); gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.STREAM_DRAW);
    this.indexBuffer = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices.byteLength, gl.STREAM_DRAW);
    for (const [name, count, type, normalized, offset] of [
      ['aPosition', 2, gl.FLOAT, false, 0], ['aUV', 2, gl.FLOAT, false, 8],
      ['aColor', 4, gl.UNSIGNED_BYTE, true, 16], ['aSlot', 1, gl.FLOAT, false, 20]
    ] as const) {
      const location = gl.getAttribLocation(this.program, name); gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, count, type, normalized, STRIDE * 4, offset);
    }
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); this.additive = false;
    gl.clearColor((this.background >> 16 & 255) / 255, (this.background >> 8 & 255) / 255, (this.background & 255) / 255, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }
  resize(width: number, height: number): void {
    this.screen.width = width; this.screen.height = height;
    const pixelWidth = Math.max(1, Math.round(width * this.resolution));
    const pixelHeight = Math.max(1, Math.round(height * this.resolution));
    // Assigning canvas.width/height reallocates and clears the drawing buffer.
    // Fractional CSS sizes should only resize when the backing store really
    // changes; otherwise simply restyle the existing buffer.
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const styleWidth = `${width}px`, styleHeight = `${height}px`;
    if (this.canvas.style.width !== styleWidth) this.canvas.style.width = styleWidth;
    if (this.canvas.style.height !== styleHeight) this.canvas.style.height = styleHeight;
  }
  private upload(source: CanvasSource, unit = -1): WebGLTexture {
    const gl = this.gl;
    let entry = this.uploaded.get(source);
    const targetUnit = unit >= 0 ? unit : (this.activeUnit >= 0 ? this.activeUnit : 0);
    if (entry && entry.revision === source.revision && entry.filter === source.scaleMode) {
      if (unit >= 0 && this.boundTextures[targetUnit] !== entry.texture) {
        if (this.activeUnit !== targetUnit) { gl.activeTexture(gl.TEXTURE0 + targetUnit); this.activeUnit = targetUnit; }
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        this.boundTextures[targetUnit] = entry.texture;
      }
      return entry.texture;
    }
    if (!entry) {
      const texture = gl.createTexture()!;
      const release = () => {
        gl.deleteTexture(texture);
        this.uploaded.delete(source);
        for (let i = 0; i < this.boundTextures.length; i++) if (this.boundTextures[i] === texture) this.boundTextures[i] = null;
      };
      entry = { texture, revision: -1, filter: '', width: 0, height: 0, release };
      this.uploaded.set(source, entry); source.dispose.add(release);
    }
    if (this.activeUnit !== targetUnit) { gl.activeTexture(gl.TEXTURE0 + targetUnit); this.activeUnit = targetUnit; }
    if (this.boundTextures[targetUnit] !== entry.texture) {
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      this.boundTextures[targetUnit] = entry.texture;
    }
    if (entry.revision !== source.revision) {
      const width = source.width, height = source.height;
      if (source === Texture.WHITE.source || source === Texture.EMPTY.source) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      } else if (entry.revision >= 0 && entry.width === width && entry.height === height) {
        // HUD numbers and other dynamic canvases often keep their dimensions.
        // Updating in place avoids reallocating the GPU texture per edit.
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.resource as TexImageSource);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.resource as TexImageSource);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry.revision = source.revision; entry.width = width; entry.height = height; this.stats.textureUploads++;
    }
    if (entry.filter !== source.scaleMode) {
      const filter = source.scaleMode === 'nearest' ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      entry.filter = source.scaleMode;
    }
    return entry.texture;
  }
  private prepareItem(item: Texture | Container): void {
    if (this.lost || this.destroyed) return;
    if (item instanceof Texture) this.upload(item.source);
    else {
      if (item instanceof Text) this.upload(item.getTexture().source);
      else if (item instanceof Sprite) this.upload(item.texture.source);
      else if (item instanceof Graphics) this.mesh(item);
      const children = item.children;
      for (let i = 0; i < children.length; i++) this.prepareItem(children[i]);
    }
  }
  generateTexture({ target }: { target: Text }): Texture {
    const original = target.getTexture();
    const canvas = document.createElement('canvas'); canvas.width = original.width; canvas.height = original.height;
    canvas.getContext('2d')!.drawImage(original.source.resource as CanvasImageSource, 0, 0);
    return new Texture({ source: new CanvasSource({ resource: canvas }) });
  }
  render(stage: Container): void {
    if (this.lost || this.destroyed) return;
    const gl = this.gl;
    this.stats.drawCalls = this.stats.vertices = this.stats.textureUploads = 0;
    this.slots.length = 0; this.clipDepth = 0;
    if (this.viewportPixelW !== this.canvas.width || this.viewportPixelH !== this.canvas.height) {
      this.viewportPixelW = this.canvas.width; this.viewportPixelH = this.canvas.height;
      gl.viewport(0, 0, this.viewportPixelW, this.viewportPixelH);
    }
    if (this.viewportScreenW !== this.screen.width || this.viewportScreenH !== this.screen.height) {
      this.viewportScreenW = this.screen.width; this.viewportScreenH = this.screen.height;
      gl.uniform2f(this.viewportUniform, this.viewportScreenW, this.viewportScreenH);
    }
    if (this.additive) { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); this.additive = false; }
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.visit(stage, 1, 1, 0, 0, 1);
    this.flush();
  }
  private orphanBuffers(): void {
    const gl = this.gl;
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.STREAM_DRAW);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices.byteLength, gl.STREAM_DRAW);
    this.vertexCount = this.batchVertexStart = 0;
    this.indexCount = this.batchIndexStart = 0;
  }
  private flush(): void {
    const batchIndices = this.indexCount - this.batchIndexStart;
    if (!batchIndices) { this.slots.length = 0; return; }
    const gl = this.gl;
    for (let i = 0; i < this.slots.length; i++) this.upload(this.slots[i], i);
    const batchVertices = this.vertexCount - this.batchVertexStart;
    gl.bufferSubData(gl.ARRAY_BUFFER, this.batchVertexStart * STRIDE * 4,
      this.data.subarray(this.batchVertexStart * STRIDE, this.vertexCount * STRIDE));
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, this.batchIndexStart * 2,
      this.indices.subarray(this.batchIndexStart, this.indexCount));
    gl.drawElements(gl.TRIANGLES, batchIndices, gl.UNSIGNED_SHORT, this.batchIndexStart * 2);
    this.stats.drawCalls++; this.stats.vertices += batchVertices;
    this.batchVertexStart = this.vertexCount;
    this.batchIndexStart = this.indexCount;
    this.slots.length = 0;
  }
  private slot(source: CanvasSource, vertices: number, indices: number): number {
    if (this.vertexCount + vertices > MAX_VERTICES || this.indexCount + indices > this.indices.length) {
      this.flush();
      if (this.vertexCount + vertices > MAX_VERTICES || this.indexCount + indices > this.indices.length) this.orphanBuffers();
    }
    let index = this.slots.indexOf(source);
    if (index < 0) {
      if (this.slots.length === this.slotCount) {
        this.flush();
        if (this.vertexCount + vertices > MAX_VERTICES || this.indexCount + indices > this.indices.length) this.orphanBuffers();
      }
      index = this.slots.length; this.slots.push(source);
    }
    return index;
  }
  private color(tint: number, alpha: number): number {
    if (alpha === 1) return (tint >> 16 & 255) | (tint & 0xff00) | (tint & 255) << 16 | 0xff000000;
    alpha = Math.max(0, Math.min(1, alpha));
    return Math.round((tint >> 16 & 255) * alpha) | Math.round((tint >> 8 & 255) * alpha) << 8 | Math.round((tint & 255) * alpha) << 16 | Math.round(alpha * 255) << 24;
  }
  private vertex(x: number, y: number, u: number, v: number, color: number, slot: number): void {
    const offset = this.vertexCount++ * STRIDE;
    this.data[offset] = x; this.data[offset + 1] = y; this.data[offset + 2] = u; this.data[offset + 3] = v;
    this.colors[offset + 4] = color; this.data[offset + 5] = slot;
  }
  private sprite(sprite: Sprite, sx: number, sy: number, tx: number, ty: number, alpha: number): void {
    const text = sprite.renderKind === 2 ? sprite as Text : null;
    const texture = text ? text.getTexture() : sprite.texture;
    if (texture.empty || texture.source.destroyed) return;
    const padding = text?.rasterOffset ?? 0;
    const left = tx - ((text ? text.logicalWidth : texture.width) * sprite.anchor.x + padding) * sx;
    const top = ty - ((text ? text.logicalHeight : texture.height) * sprite.anchor.y + padding) * sy;
    const right = left + texture.width * sx, bottom = top + texture.height * sy;
    if (Math.max(left, right) < 0 || Math.min(left, right) > this.screen.width || Math.max(top, bottom) < 0 || Math.min(top, bottom) > this.screen.height) return;
    const slot = this.slot(texture.source, 4, 6), color = this.color(sprite.tint, alpha), base = this.vertexCount;
    const frame = texture.frame, source = texture.source;
    const u0 = frame.x / source.width, v0 = frame.y / source.height;
    const u1 = (frame.x + frame.width) / source.width, v1 = (frame.y + frame.height) / source.height;
    this.vertex(left, top, u0, v0, color, slot); this.vertex(right, top, u1, v0, color, slot);
    this.vertex(right, bottom, u1, v1, color, slot); this.vertex(left, bottom, u0, v1, color, slot);
    this.indices[this.indexCount++] = base; this.indices[this.indexCount++] = base + 1; this.indices[this.indexCount++] = base + 2;
    this.indices[this.indexCount++] = base; this.indices[this.indexCount++] = base + 2; this.indices[this.indexCount++] = base + 3;
  }
  private mesh(graphics: Graphics): Float32Array {
    const context = graphics.context;
    if (context.meshRevision === context.revision) return context.mesh;
    // Size the reusable buffers first so animated geometry (hold bodies,
    // hit effects) does not allocate arrays on every frame.
    let vertexCount = 0, indexCount = 0;
    for (const shape of context.shapes) {
      const count = shape.points.length / 2;
      if (shape.fill !== undefined) {
        vertexCount += count;
        if (count > 2) indexCount += (count - 2) * 3;
      }
      if (shape.stroke !== undefined) {
        vertexCount += count * 2;
        indexCount += (count - (shape.closed ? 0 : 1)) * 6;
      }
    }
    if (context.mesh.length < vertexCount * 4) context.mesh = new Float32Array(vertexCount * 4);
    if (context.indices.length < indexCount) context.indices = new Uint16Array(indexCount);
    if (context.colors.length < vertexCount) context.colors = new Uint32Array(vertexCount);
    const data = context.mesh, indices = context.indices, colors = context.colors;
    let vertex = 0, index = 0;
    for (const shape of context.shapes) {
      const points = shape.points, count = points.length / 2;
      if (shape.fill !== undefined) {
        const paint = shape.fill, color = typeof paint === 'number' ? paint : paint.color ?? 0xffffff, alpha = typeof paint === 'number' ? 1 : paint.alpha ?? 1;
        const base = vertex, packed = this.color(color, alpha);
        // Project polygons are convex: rectangles, circles and highway trapezoids.
        for (let i = 0; i < points.length; i += 2) {
          const offset = vertex * 4;
          data[offset] = points[i]; data[offset + 1] = points[i + 1]; data[offset + 2] = color; data[offset + 3] = alpha;
          colors[vertex++] = packed;
        }
        for (let i = 1; i < count - 1; i++) { indices[index++] = base; indices[index++] = base + i; indices[index++] = base + i + 1; }
      }
      if (shape.stroke !== undefined) {
        const paint = shape.stroke, color = typeof paint === 'number' ? paint : paint.color ?? 0xffffff, alpha = typeof paint === 'number' ? 1 : paint.alpha ?? 1;
        const half = (typeof paint === 'number' ? 1 : paint.width ?? 1) / 2;
        const base = vertex, packed = this.color(color, alpha);
        // Joined strip: each edge shares its end vertices. Translucent joins
        // therefore neither overlap nor leave cracks at rounded corners.
        for (let i = 0; i < count; i++) {
          const previous = shape.closed ? (i + count - 1) % count : Math.max(0, i - 1);
          const next = shape.closed ? (i + 1) % count : Math.min(count - 1, i + 1);
          let dx0 = points[i * 2] - points[previous * 2], dy0 = points[i * 2 + 1] - points[previous * 2 + 1];
          let dx1 = points[next * 2] - points[i * 2], dy1 = points[next * 2 + 1] - points[i * 2 + 1];
          if (previous === i) { dx0 = dx1; dy0 = dy1; }
          if (next === i) { dx1 = dx0; dy1 = dy0; }
          const len0 = Math.hypot(dx0, dy0) || 1, len1 = Math.hypot(dx1, dy1) || 1;
          const nx0 = -dy0 / len0, ny0 = dx0 / len0, nx1 = -dy1 / len1, ny1 = dx1 / len1;
          const divisor = Math.max(.25, 1 + nx0 * nx1 + ny0 * ny1);
          const nx = (nx0 + nx1) * half / divisor, ny = (ny0 + ny1) * half / divisor;
          const x = points[i * 2], y = points[i * 2 + 1];
          let offset = vertex++ * 4;
          data[offset] = x + nx; data[offset + 1] = y + ny; data[offset + 2] = color; data[offset + 3] = alpha; colors[offset / 4] = packed;
          offset = vertex++ * 4;
          data[offset] = x - nx; data[offset + 1] = y - ny; data[offset + 2] = color; data[offset + 3] = alpha; colors[offset / 4] = packed;
        }
        for (let i = 0; i < count - (shape.closed ? 0 : 1); i++) {
          const a = base + i * 2, b = base + ((i + 1) % count) * 2;
          indices[index++] = a; indices[index++] = b; indices[index++] = b + 1;
          indices[index++] = a; indices[index++] = b + 1; indices[index++] = a + 1;
        }
      }
    }
    context.meshVertexCount = vertex;
    context.meshIndexCount = index;
    context.meshRevision = context.revision;
    return data;
  }
  private graphics(graphics: Graphics, sx: number, sy: number, tx: number, ty: number, alpha: number): void {
    const context = graphics.context, mesh = this.mesh(graphics), indices = context.indices;
    const vertices = context.meshVertexCount, indexCount = context.meshIndexCount;
    if (!vertices) return;
    if (vertices > MAX_VERTICES || indexCount > this.indices.length) throw new Error('Graphics exceed the batch capacity');
    const slot = this.slot(Texture.WHITE.source, vertices, indexCount), base = this.vertexCount;
    const colors = context.colors;
    for (let i = 0, offset = 0; i < vertices; i++, offset += 4) this.vertex(mesh[offset] * sx + tx, mesh[offset + 1] * sy + ty, .5, .5, alpha === 1 ? colors[i] : this.color(mesh[offset + 2], mesh[offset + 3] * alpha), slot);
    for (let i = 0; i < indexCount; i++) this.indices[this.indexCount++] = base + indices[i];
  }
  private visit(node: Container, sx: number, sy: number, tx: number, ty: number, alpha: number): void {
    if (!node.visible || node.alpha <= 0 || node.maskUsers > 0) return;
    tx += node.x * sx; ty += node.y * sy; sx *= node.scale.x; sy *= node.scale.y; alpha *= node.alpha;
    if (node.mask) this.pushClip(node.mask);
    const kind = node.renderKind;
    if (kind > 0) {
      const additive = node.blendMode === 'add';
      if (additive !== this.additive) { this.flush(); this.additive = additive; this.gl.blendFunc(this.gl.ONE, additive ? this.gl.ONE : this.gl.ONE_MINUS_SRC_ALPHA); }
      if (kind === 3) this.graphics(node as Graphics, sx, sy, tx, ty, alpha);
      else this.sprite(node as Sprite, sx, sy, tx, ty, alpha);
    }
    // Indexed traversal: no array iterator is allocated per node per frame.
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.visible && child.alpha > 0 && child.maskUsers === 0) this.visit(child, sx, sy, tx, ty, alpha);
    }
    if (node.mask) this.popClip();
  }
  private pushClip(mask: Graphics): void {
    this.flush();
    let sx = 1, sy = 1, tx = 0, ty = 0;
    // Compose bottom-up: parent scale affects the accumulated translation.
    for (let node: Container | null = mask; node; node = node.parent) { tx = tx * node.scale.x + node.x; ty = ty * node.scale.y + node.y; sx *= node.scale.x; sy *= node.scale.y; }
    const bounds = mask.bounds(), ratioX = this.canvas.width / this.screen.width, ratioY = this.canvas.height / this.screen.height;
    let left = Math.floor(Math.min(tx + bounds.x * sx, tx + (bounds.x + bounds.width) * sx) * ratioX);
    let right = Math.ceil(Math.max(tx + bounds.x * sx, tx + (bounds.x + bounds.width) * sx) * ratioX);
    let top = Math.floor(Math.min(ty + bounds.y * sy, ty + (bounds.y + bounds.height) * sy) * ratioY);
    let bottom = Math.ceil(Math.max(ty + bounds.y * sy, ty + (bounds.y + bounds.height) * sy) * ratioY);
    for (let i = 0; i < 4; i++) this.clipStack[this.clipDepth * 4 + i] = this.clip[i];
    if (this.clipDepth) { left = Math.max(left, this.clip[0]); top = Math.max(top, this.clip[1]); right = Math.min(right, this.clip[2]); bottom = Math.min(bottom, this.clip[3]); }
    this.clip[0] = left; this.clip[1] = top; this.clip[2] = right; this.clip[3] = bottom; this.clipDepth++;
    this.applyClip();
  }
  private popClip(): void {
    this.flush(); this.clipDepth--;
    for (let i = 0; i < 4; i++) this.clip[i] = this.clipStack[this.clipDepth * 4 + i];
    this.applyClip();
  }
  private applyClip(): void {
    const gl = this.gl;
    if (!this.clipDepth) gl.disable(gl.SCISSOR_TEST);
    else { gl.enable(gl.SCISSOR_TEST); gl.scissor(this.clip[0], this.canvas.height - this.clip[3], Math.max(0, this.clip[2] - this.clip[0]), Math.max(0, this.clip[3] - this.clip[1])); }
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost); this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    for (const [source, entry] of this.uploaded) { source.dispose.delete(entry.release); this.gl.deleteTexture(entry.texture); }
    this.uploaded.clear(); this.gl.deleteBuffer(this.vertexBuffer); this.gl.deleteBuffer(this.indexBuffer); this.gl.deleteProgram(this.program);
  }
}

export const UPDATE_PRIORITY = { HIGH: 50 };
interface FrameClock { deltaMS: number; elapsedMS: number; lastTime: number }
class FrameLoop implements FrameClock {
  maxFPS = 0;
  deltaMS = 0; elapsedMS = 0; lastTime = 0;
  private callbacks: ((clock: FrameClock) => void)[] = [];
  add(callback: (clock: FrameClock) => void, _context?: unknown, _priority?: number): void { this.callbacks.push(callback); }
  tick(now: number): void {
    this.elapsedMS = Math.max(0, now - this.lastTime); this.deltaMS = Math.min(100, this.elapsedMS);
    for (const callback of this.callbacks) callback(this);
    this.lastTime = now;
  }
  clear(): void { this.callbacks.length = 0; }
}

export class Application {
  readonly stage = new Container();
  readonly ticker = new FrameLoop();
  canvas!: HTMLCanvasElement;
  renderer!: WebGLRenderer;
  get screen(): { width: number; height: number } { return this.renderer.screen; }
  private frame = 0;
  private running = false;
  async init(options: { width: number; height: number; backgroundColor?: number; resolution?: number }): Promise<void> {
    this.canvas = document.createElement('canvas');
    this.renderer = new WebGLRenderer(this.canvas, options.resolution ?? 1, options.backgroundColor ?? 0);
    this.renderer.resize(options.width, options.height);
  }
  render(): void { this.renderer.render(this.stage); }
  /**
   * Starts the requestAnimationFrame loop.
   *
   * `shouldRender` lets a caller skip GPU submission on frames where nothing
   * visible changed. Game/animation updates still run every frame, so clocks,
   * judgments and decay stay correct; only the draw call is elided.
   * `ticker.maxFPS` (when > 0) caps GPU submission. Logic still ticks at the
   * display rate, and an accumulator keeps the effective rate on target even
   * when the display refresh is not an integer multiple of the cap.
   */
  start(shouldRender?: () => boolean): void {
    if (this.running) return;
    this.running = true;
    this.ticker.lastTime = performance.now();
    let lastNow = this.ticker.lastTime;
    let accumulator = 0;
    const tick = (now: number) => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(tick);
      const deltaMs = Math.max(0, now - lastNow);
      lastNow = now;
      this.ticker.tick(now);
      const maxFPS = this.ticker.maxFPS;
      if (maxFPS > 0) {
        const interval = 1000 / maxFPS;
        accumulator += deltaMs;
        if (accumulator < interval) return;
        accumulator %= interval;
      }
      if (!shouldRender || shouldRender()) this.render();
    };
    this.frame = requestAnimationFrame(tick);
  }
  stop(): void { this.running = false; cancelAnimationFrame(this.frame); }
  destroy(removeCanvas = false, options?: { children?: boolean; texture?: boolean }): void {
    this.stop(); this.ticker.clear(); this.stage.destroy(options); this.renderer?.destroy(); if (removeCanvas) this.canvas?.remove();
  }
}
