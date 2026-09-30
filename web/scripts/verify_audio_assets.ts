import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const relativeSoundFont = path.join('assets', 'soundfonts', 'MagicSFver2.sf2');
const sourcePath = path.join(projectRoot, 'public', relativeSoundFont);
const builtPath = path.join(projectRoot, 'dist', relativeSoundFont);
const manifestUrl = '/assets/soundfonts/manifest.json';

const [source, built, header, assetNames, manifest] = await Promise.all([
  stat(sourcePath),
  stat(builtPath),
  readFile(builtPath).then(buffer => buffer.subarray(0, 12)),
  readdir(path.join(projectRoot, 'dist', 'assets')),
  readFile(path.join(projectRoot, 'dist', 'assets', 'soundfonts', 'manifest.json'), 'utf8')
    .then(contents => JSON.parse(contents) as unknown),
]);

if (source.size !== built.size || built.size < 1_000_000) {
  throw new Error(`SoundFont deployment size mismatch: source=${source.size}, built=${built.size}`);
}
if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'sfbk') {
  throw new Error('Built SoundFont does not have a valid RIFF/sfbk signature');
}
if (!Array.isArray(manifest) || !manifest.some(entry =>
  entry?.filename === 'MagicSFver2.sf2'
  && entry?.url === '/assets/soundfonts/MagicSFver2.sf2'
  && entry?.sizeBytes === built.size
)) {
  throw new Error('Built SoundFont manifest does not list MagicSFver2.sf2 with the deployed size');
}

const worklet = assetNames.find(name => /^spessasynth_processor\.min-[\w-]+\.js$/.test(name));
if (!worklet) throw new Error('Built SpessaSynth AudioWorklet asset is missing');

const applicationBundles = assetNames.filter(name => /^index-[\w-]+\.js$/.test(name));
const referencesSoundFont = await Promise.all(
  applicationBundles.map(name => readFile(path.join(projectRoot, 'dist', 'assets', name), 'utf8'))
).then(bundles => bundles.some(bundle => bundle.includes(manifestUrl)));
if (!referencesSoundFont) throw new Error('Built application does not reference the SoundFont manifest');

console.log(`Verified deployed audio assets: ${relativeSoundFont} (${built.size} bytes), ${worklet}`);
