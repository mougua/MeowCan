import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const relativeSoundFont = path.join('assets', 'soundfonts', 'MagicSFver2.sf2');
const sourcePath = path.join(projectRoot, 'public', relativeSoundFont);
const builtPath = path.join(projectRoot, 'dist', relativeSoundFont);

const [source, built, header, assetNames] = await Promise.all([
  stat(sourcePath),
  stat(builtPath),
  readFile(builtPath).then(buffer => buffer.subarray(0, 12)),
  readdir(path.join(projectRoot, 'dist', 'assets')),
]);

if (source.size !== built.size || built.size < 1_000_000) {
  throw new Error(`SoundFont deployment size mismatch: source=${source.size}, built=${built.size}`);
}
if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'sfbk') {
  throw new Error('Built SoundFont does not have a valid RIFF/sfbk signature');
}

const worklet = assetNames.find(name => /^spessasynth_processor\.min-[\w-]+\.js$/.test(name));
if (!worklet) throw new Error('Built SpessaSynth AudioWorklet asset is missing');

const applicationBundles = assetNames.filter(name => /^index-[\w-]+\.js$/.test(name));
const referencesSoundFont = await Promise.all(
  applicationBundles.map(name => readFile(path.join(projectRoot, 'dist', 'assets', name), 'utf8'))
).then(bundles => bundles.some(bundle => bundle.includes('/assets/soundfonts/MagicSFver2.sf2')));
if (!referencesSoundFont) throw new Error('Built application does not reference MagicSFver2.sf2');

console.log(`Verified deployed audio assets: ${relativeSoundFont} (${built.size} bytes), ${worklet}`);
