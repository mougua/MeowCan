import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeVIMG, decodeVLLE, encodePNG } from './convert_assets.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..', '..');
const sourceDir = path.join(rootDir, 'ref', 'CanMusic', 'image', 'skin', 'METALiC', 'left');
const outputDir = path.join(rootDir, 'web', 'public', 'assets', 'metallic');

const tasks = [
  ['play_area.img', 'play_area.png', 'vimg'],
  ['canback.lle', 'canback.png', 'vlle'],
  ['can.lle', 'can.png', 'vlle'],
  ['note_base0.lle', 'note_base0.png', 'vlle'],
  ['note_skin0.lle', 'note_skin0.png', 'vlle'],
  ['note_base1.lle', 'note_base1.png', 'vlle'],
  ['note_skin1.lle', 'note_skin1.png', 'vlle'],
  ['hitbar0.lle', 'hitbar0.png', 'vlle'],
  ['hitbar1.lle', 'hitbar1.png', 'vlle'],
  ['key_base.lle', 'key_base.png', 'vlle'],
  ['key_normal.lle', 'key_normal.png', 'vlle'],
  ['key_put.lle', 'key_put.png', 'vlle'],
  ['key_death.lle', 'key_death.png', 'vlle'],
  ['Longnote.lle', 'longnote.png', 'vlle'],
  ['hitani0_0.lle', 'hitani0_0.png', 'vlle'],
  ['hitani_longnote0_0.lle', 'hitani_longnote0_0.png', 'vlle']
];

function decode(file, type) {
  const buffer = fs.readFileSync(path.join(sourceDir, file));
  return type === 'vimg' ? decodeVIMG(buffer, file) : decodeVLLE(buffer, 0, file);
}

function compose(base, skin, frames = 16) {
  const frameWidth = skin.width / frames;
  if (base.width !== frameWidth || base.height !== skin.height) {
    throw new Error(`Metallic note dimensions do not match: ${base.width}x${base.height} vs ${frameWidth}x${skin.height}`);
  }
  const rgba = Buffer.alloc(skin.width * skin.height * 4);
  for (let frame = 0; frame < frames; frame++) {
    for (let y = 0; y < skin.height; y++) {
      for (let x = 0; x < frameWidth; x++) {
        const out = (y * skin.width + frame * frameWidth + x) * 4;
        const b = (y * base.width + x) * 4;
        const s = (y * skin.width + frame * frameWidth + x) * 4;
        const source = skin.rgba[s + 3] ? skin.rgba.subarray(s, s + 4) : base.rgba.subarray(b, b + 4);
        source.copy(rgba, out);
      }
    }
  }
  return { width: skin.width, height: skin.height, rgba };
}

fs.mkdirSync(outputDir, { recursive: true });
const decoded = new Map();
for (const [source, output, type] of tasks) {
  const asset = decode(source, type);
  decoded.set(output, asset);
  fs.writeFileSync(path.join(outputDir, output), encodePNG(asset.width, asset.height, asset.rgba));
}
for (const suffix of ['0', '1']) {
  const base = decoded.get(`note_base${suffix}.png`);
  const skin = decoded.get(`note_skin${suffix}.png`);
  const composed = compose(base, skin);
  fs.writeFileSync(path.join(outputDir, `note_composed${suffix}.png`), encodePNG(composed.width, composed.height, composed.rgba));
}
console.log(`Converted ${tasks.length + 2} METALiC assets to ${outputDir}`);
