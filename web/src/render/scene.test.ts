import { expect, test } from 'bun:test';
import { CanvasSource, Container, Graphics, Rectangle, Sprite, Text, Texture } from './scene';
import { WebGLRenderer } from './webgl';

test('pooled sprites retain explicit size and contact point when frames change', () => {
  const source = new CanvasSource({ resource: { width: 100, height: 100 } as HTMLCanvasElement });
  const sprite = new Sprite(new Texture({ source, frame: new Rectangle(0, 0, 26, 24) }));
  sprite.anchor.set(.5, 1); sprite.width = 26; sprite.height = 24;
  sprite.texture = new Texture({ source, frame: new Rectangle(0, 24, 26, 12) });
  expect([sprite.width, sprite.height, sprite.anchor.x, sprite.anchor.y]).toEqual([26, 24, .5, 1]);
  sprite.height = 12;
  expect(sprite.scale.y).toBe(1);
});

test('reparenting and disposal preserve draw order and detach children', () => {
  const a = new Container(), b = new Container(), first = new Sprite(), last = new Sprite();
  a.addChild(first, last); b.addChild(first);
  expect(a.children).toEqual([last]); expect(first.parent).toBe(b);
  b.addChildAt(last, 0);
  expect(b.children).toEqual([last, first]); expect(a.children).toEqual([]);
  b.destroy({ children: true });
  expect(first.parent).toBeNull(); expect(last.parent).toBeNull();
});

test('unchanged text styles keep the raster cache valid and edits invalidate it', () => {
  const text = new Text({ text: 'SPEED 8', style: { fill: 0xffffff, fontSize: 10 } });
  const revision = text.style.revision;
  text.style.fill = 0xffffff;
  expect(text.style.revision).toBe(revision);
  text.style.fill = 0xff0000;
  expect(text.style.revision).toBe(revision + 1);
  const width = text.width;
  text.style.fontSize = 20;
  expect(text.width).toBe(width * 2);
});

test('shared atlas storage releases GPU owners once', () => {
  const source = new CanvasSource({ resource: { width: 16, height: 16 } as HTMLCanvasElement });
  const a = new Texture({ source }), b = new Texture({ source });
  let released = 0; source.dispose.add(() => released++);
  a.destroy(false); expect(source.destroyed).toBe(false);
  source.update(); expect(source.revision).toBe(1);
  b.destroy(true); a.destroy(true);
  expect(released).toBe(1); expect(source.dispose.size).toBe(0);
});

test('graphics bounds cache reuses rectangle until geometry changes', () => {
  const gfx = new Graphics().rect(10, 20, 30, 40).fill(0xffffff);
  const first = gfx.bounds();
  const second = gfx.bounds();
  expect(second).toBe(first);
  expect([first.x, first.y, first.width, first.height]).toEqual([10, 20, 30, 40]);
  gfx.clear().rect(5, 6, 7, 8).fill(0xffffff);
  const updated = gfx.bounds();
  expect([updated.x, updated.y, updated.width, updated.height]).toEqual([5, 6, 7, 8]);
});

test('WebGLRenderer appends streaming vertex ranges and skips redundant texture binds across frames', () => {
  const subDataOffsets: number[] = [];
  const drawOffsets: number[] = [];
  let bindTextureCalls = 0;
  let texCounter = 0;
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    MAX_TEXTURE_IMAGE_UNITS: 5, HIGH_FLOAT: 6, ARRAY_BUFFER: 7, ELEMENT_ARRAY_BUFFER: 8,
    STREAM_DRAW: 9, FLOAT: 10, UNSIGNED_BYTE: 11, UNSIGNED_SHORT: 12, TRIANGLES: 13,
    DEPTH_TEST: 14, CULL_FACE: 15, BLEND: 16, SCISSOR_TEST: 17, ONE: 18, ONE_MINUS_SRC_ALPHA: 19,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 20, UNPACK_FLIP_Y_WEBGL: 21, COLOR_BUFFER_BIT: 22,
    TEXTURE0: 100, TEXTURE_2D: 23, RGBA: 24, CLAMP_TO_EDGE: 25, TEXTURE_WRAP_S: 26,
    TEXTURE_WRAP_T: 27, TEXTURE_MIN_FILTER: 28, TEXTURE_MAG_FILTER: 29, NEAREST: 30, LINEAR: 31,
    getParameter: () => 8,
    getShaderPrecisionFormat: () => ({ precision: 23 }),
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    deleteShader: () => {},
    getProgramParameter: () => true,
    useProgram: () => {},
    getUniformLocation: () => ({}),
    uniform1iv: () => {},
    uniform2f: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: (target: number, offset: number) => {
      if (target === 7) subDataOffsets.push(offset);
    },
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    disable: () => {},
    enable: () => {},
    blendFunc: () => {},
    clearColor: () => {},
    clear: () => {},
    viewport: () => {},
    pixelStorei: () => {},
    createTexture: () => ({ id: ++texCounter }),
    activeTexture: () => {},
    bindTexture: () => { bindTextureCalls++; },
    texImage2D: () => {},
    texSubImage2D: () => {},
    texParameteri: () => {},
    drawElements: (_mode: number, _count: number, _type: number, offset: number) => {
      drawOffsets.push(offset);
    },
    deleteTexture: () => {},
    deleteBuffer: () => {},
    deleteProgram: () => {},
  };
  const canvas = {
    width: 100, height: 100, style: { width: '', height: '' },
    getContext: () => gl,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;

  const renderer = new WebGLRenderer(canvas, 1, 0);
  renderer.resize(100, 100);
  const stage = new Container();
  const sprite = new Sprite(Texture.WHITE);
  sprite.width = 10; sprite.height = 10;
  stage.addChild(sprite);

  renderer.render(stage);
  const bindsAfterFirst = bindTextureCalls;
  renderer.render(stage);
  expect(subDataOffsets).toEqual([0, 96]);
  expect(drawOffsets).toEqual([0, 12]);
  expect(bindTextureCalls).toBe(bindsAfterFirst);
});
