import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

// Run against `bun run dev`; artifacts live outside the source tree.
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/verify_rendering.mjs <artifact-directory>');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/__render_fixture.html', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"><div id="stage"></div></body></html>' }));
await page.goto('http://127.0.0.1:3000/__render_fixture.html');
await page.evaluate(async (sourceRoot) => {
  const { CanMusicRenderer } = await import(`${sourceRoot}/game/renderer.ts`);
  const { JudgmentEngine } = await import(`${sourceRoot}/game/judgment.ts`);
  const renderer = new CanMusicRenderer();
  await renderer.init({ container: document.getElementById('stage'), width: 716, height: 516 });
  renderer.setPlaylist([{ title: 'Turkish March', level: 10 }, { title: 'Canon in D', level: 5 }]);
  renderer.prewarmNoteSprites();
  const score = new JudgmentEngine().score;
  const notes = Array.from({ length: 350 }, (_, id) => ({ id, lane: id % 7, startSec: 4 + id / 70, durationSec: 1.2, midiNote: 60, velocity: 100, track: 0, isLong: id % 13 === 0, judged: false }));
  window.fixture = { renderer, score, notes };
}, process.env.RENDER_SOURCE_ROOT ?? '/src');
const results = {};
for (const skin of ['classic', 'metallic', 'mobile']) {
  for (const mode of ['notes', 'effects', 'result', 'failed']) {
    results[`${skin}-${mode}`] = await page.evaluate(({ skin, mode }) => {
      const { renderer: r, notes, score } = window.fixture;
      r.resetEffects(); r.hideResult(); r.setSkin(skin); r.setNoteSkin('base0'); r.setSpeed(8);
      r.renderFrame(4.3, notes, score, 100);
      if (mode === 'effects') {
        r.updateCombo(123); r.showJudgement('COOL');
        for (let lane = 0; lane < 7; lane++) { r.showHitBurst(lane, 123); r.setLaneState(lane, true); }
        r.advanceVisuals(0.06);
      } else if (mode !== 'notes') {
        r.showResult({ outcome: mode === 'failed' ? 'failed' : 'result', score: 12345, accuracy: 87.6, eq: 230, multiplier: 4 });
        r.advanceVisuals(1.5);
      }
      const app = r.getApp(); app.render();
      const snapshot = r.noteSpritePool.filter(s => s.visible).map(s => [s.x, s.y, s.width, s.height, s.alpha]);
      return { snapshot, renderer: app.renderer.name, stats: app.renderer.stats ? { ...app.renderer.stats } : undefined };
    }, { skin, mode });
    await page.locator('canvas').screenshot({ path: path.join(output, `${skin}-${mode}.png`) });
  }
}
results.performance = await page.evaluate(() => {
  const { renderer: r, notes, score } = window.fixture;
  const timings = {};
  for (const skin of ['classic', 'metallic', 'mobile']) {
    r.hideResult(); r.resetEffects(); r.setSkin(skin);
    for (let i = 0; i < 60; i++) { r.renderFrame(4 + i / 600, notes, score, 100); r.getApp().render(); }
    const samples = [];
    for (let i = 0; i < 300; i++) {
      const start = performance.now();
      // Aggregate submissions to reduce Chromium's timer quantization error.
      for (let repeat = 0; repeat < 8; repeat++) { r.renderFrame(4 + i / 600, notes, score, 100); r.getApp().render(); }
      samples.push((performance.now() - start) / 8);
    }
    samples.sort((a, b) => a - b);
    timings[skin] = { medianMs: samples[150], p95Ms: samples[285], stats: r.getApp().renderer.stats ? { ...r.getApp().renderer.stats } : undefined };
  }
  return timings;
});
const baseline = process.argv[3];
if (baseline) {
  const previous = JSON.parse(await fs.readFile(path.join(baseline, 'results.json'), 'utf8'));
  results.comparison = {};
  for (const key of Object.keys(previous).filter(key => key.includes('-'))) {
    if (JSON.stringify(previous[key].snapshot) !== JSON.stringify(results[key].snapshot)) throw new Error(`Scene positions changed: ${key}`);
    const oldImage = await fs.readFile(path.join(baseline, `${key}.png`));
    const newImage = await fs.readFile(path.join(output, `${key}.png`));
    results.comparison[key] = await page.evaluate(async ([oldImage, newImage]) => {
      const decode = async data => {
        const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const a = await decode(oldImage), b = await decode(newImage);
      let changed = 0, totalError = 0;
      for (let i = 0; i < a.length; i += 4) {
        const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (delta > 16) changed++;
        totalError += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      }
      return { changedPixelFraction: changed / (a.length / 4), meanChannelError: totalError / (a.length / 4 * 3) };
    }, [oldImage.toString('base64'), newImage.toString('base64')]);
    if (results.comparison[key].changedPixelFraction > .025) throw new Error(`Visual regression: ${key}: ${JSON.stringify(results.comparison[key])}`);
  }
}
results.gpu = await page.evaluate(async () => {
  const { Application, Container, Graphics, Sprite, Texture, CanvasSource, Rectangle } = await import('/src/render/webgl.ts');
  const app = new Application(); await app.init({ width: 32, height: 32, backgroundColor: 0 });
  const gl = app.renderer.gl;
  const read = (x, y) => { const rgba = new Uint8Array(4); gl.readPixels(x, 31 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba); return [...rgba]; };
  const equal = (actual, expected, message) => { if (actual.some((value, i) => Math.abs(value - expected[i]) > 2)) throw new Error(`${message}: ${actual} != ${expected}`); };
  const sourceCanvas = document.createElement('canvas'); sourceCanvas.width = 2; sourceCanvas.height = 1;
  const ctx = sourceCanvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 1, 1); ctx.fillStyle = '#00ff00'; ctx.fillRect(1, 0, 1, 1);
  const source = new CanvasSource({ resource: sourceCanvas, scaleMode: 'nearest' });
  const sprite = new Sprite(new Texture({ source, frame: new Rectangle(1, 0, 1, 1) })); sprite.width = sprite.height = 32;
  const parent = new Container(); parent.position.set(4, 4); parent.scale.set(2);
  const clip = new Graphics().rect(0, 0, 8, 8).fill(0xffffff);
  const inner = new Container(); inner.mask = clip; inner.addChild(sprite); parent.addChild(clip, inner); app.stage.addChild(parent);
  const outerClip = new Graphics().rect(6, 6, 8, 8).fill(0xffffff); app.stage.addChild(outerClip); parent.mask = outerClip;
  app.render(); equal(read(8, 8), [0, 255, 0, 255], 'cropped UV and nested transform'); equal(read(5, 5), [0, 0, 0, 255], 'outer mask'); equal(read(21, 8), [0, 0, 0, 255], 'inner mask');
  ctx.fillStyle = '#0000ff'; ctx.fillRect(1, 0, 1, 1); source.update(); app.render(); equal(read(8, 8), [0, 0, 255, 255], 'source update');
  app.render(); if (app.renderer.stats.textureUploads !== 0) throw new Error('Steady frame uploaded a texture');
  const glow = new Sprite(Texture.WHITE); glow.tint = 0xff0000; glow.alpha = .5; glow.blendMode = 'add'; glow.width = glow.height = 32; app.stage.addChild(glow);
  app.render(); equal(read(8, 8), [128, 0, 255, 255], 'additive premultiplied alpha');
  app.stage.removeChild(glow); sprite.alpha = .5; app.render(); equal(read(8, 8), [0, 0, 128, 255], 'normal premultiplied alpha');
  sprite.alpha = 1;
  const extension = gl.getExtension('WEBGL_lose_context');
  if (!extension) throw new Error('Context-loss extension unavailable');
  const lost = new Promise(resolve => app.canvas.addEventListener('webglcontextlost', resolve, { once: true })); extension.loseContext(); await lost;
  app.render();
  const restored = new Promise(resolve => app.canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
  await new Promise(resolve => setTimeout(resolve, 100)); extension.restoreContext(); await restored;
  app.render(); equal(read(8, 8), [0, 0, 255, 255], 'context restore');
  app.stage.removeChildren();
  for (let i = 0; i < 17000; i++) { const dot = new Sprite(Texture.WHITE); dot.width = dot.height = 32; app.stage.addChild(dot); }
  app.render(); equal(read(8, 8), [255, 255, 255, 255], 'batch vertex limit');
  if (app.renderer.stats.drawCalls !== 2 || app.renderer.stats.vertices !== 68000) throw new Error('Batch capacity split dropped geometry');
  app.stage.removeChildren();
  const temporary = [];
  const capacity = app.renderer.slotCount;
  for (let i = 0; i <= capacity; i++) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    canvas.getContext('2d').fillStyle = i === capacity ? '#ff00ff' : '#ffffff'; canvas.getContext('2d').fillRect(0, 0, 1, 1);
    const texture = new Texture({ source: new CanvasSource({ resource: canvas }) }); temporary.push(texture);
    const dot = new Sprite(texture); dot.width = dot.height = 32; app.stage.addChild(dot);
  }
  app.render(); equal(read(8, 8), [255, 0, 255, 255], 'texture-slot limit and layer order');
  if (app.renderer.stats.drawCalls !== 2) throw new Error('Texture-slot limit did not split the batch');
  for (const texture of temporary) texture.destroy(true);
  source.destroy(); if (app.renderer.uploaded.has(source)) throw new Error('Destroyed source retained GPU storage');
  app.destroy(true, { children: true });
  return { nestedClipping: true, atlasUV: true, sourceUpdate: true, blending: true, contextRestore: true, batchCapacity: true, textureCapacity: true, disposal: true };
});
// Exercise the real shell with its documented offline catalog fallback.
await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
await page.setViewportSize({ width: 1366, height: 900 });
await page.goto('http://127.0.0.1:3000/');
await page.locator('#boot-loading').waitFor({ state: 'hidden' });
if (await page.locator('#game-canvas-container canvas').getAttribute('data-renderer') !== 'MeowCan WebGL') throw new Error('Shell did not select the WebGL engine');
await page.locator('#btn-song-select').click();
await page.locator('#song-table-body tr[data-id]').first().dblclick();
await page.waitForFunction(() => !document.querySelector('#btn-arcade-start').disabled);
await page.locator('#btn-auto').click();
await page.locator('#btn-arcade-start').click();
await page.waitForFunction(() => !document.querySelector('#btn-arcade-abort').disabled);
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(output, 'desktop-playing.png') });
await page.setViewportSize({ width: 1180, height: 820 });
await page.waitForTimeout(100);
await page.screenshot({ path: path.join(output, 'tablet-landscape-playing.png') });
await page.locator('#btn-arcade-abort').click();
await page.waitForFunction(() => document.querySelector('#btn-arcade-abort').disabled);
await page.locator('#btn-restart').click();
await page.waitForFunction(() => !document.querySelector('#btn-arcade-abort').disabled);
await page.locator('#btn-arcade-abort').click();
await page.goto('http://127.0.0.1:3000/?preview=1');
await page.locator('#boot-loading').waitFor({ state: 'hidden' });
for (const tab of ['notes', 'characters', 'combo', 'result', 'crops', 'layout']) {
  await page.locator(`.dev-tab-btn[data-tab="${tab}"]`).click();
  await page.waitForTimeout(50);
}
results.shell = { offlineCatalog: true, autoplay: true, abortAndRestart: true, desktop: true, tabletLandscape: true, previewTabs: true };
results.errors = errors;
await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ performance: results.performance, comparison: results.comparison, gpu: results.gpu, shell: results.shell, errors }, null, 2));
if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
