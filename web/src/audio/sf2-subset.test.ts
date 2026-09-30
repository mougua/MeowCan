import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { SoundBankLoader } from 'spessasynth_core';
import { parseVos } from '../parser/vos';
import { buildSongSf2, indexSf2, selectedSamples, songKeyDemand } from './sf2-subset';

const bankPath = new URL('../../public/assets/soundfonts/MagicSFver2.sf2', import.meta.url);
const songPaths = ['1.vos', '1000.vos', '3000.vos'].map(name => new URL(`../../public/songs/${name}`, import.meta.url));

test('key demand covers seven-lane fallback pitches and percussion', () => {
  const song = { bgmNotes: [{ midiNote: 36, velocity: 100, channel: 9 }],
    playableNotes: [{ midiNote: 60, velocity: 90, track: 0, lane: 3,
      instrument: { program: 5 } }] } as any;
  const demand = songKeyDemand(song);
  expect(demand.drums.has(36)).toBe(true);
  expect([...demand.programs.get(5)!.keys()].sort((a, b) => a - b)).toEqual([55, 57, 59, 60, 62, 64, 66]);
});

test.skipIf(!existsSync(bankPath) || songPaths.some(path => !existsSync(path)))('real songs extract playable SF2s without reading the full Blob', async () => {
  const original = Bun.file(bankPath);
  let bytesRead = 0;
  const file = {
    size: original.size,
    slice(start: number, end: number) {
      bytesRead += end - start;
      return original.slice(start, end);
    },
  } as Blob;
  const index = await indexSf2(file);
  for (const path of songPaths) {
    const song = parseVos(await Bun.file(path).arrayBuffer());
    const start = performance.now();
    const samples = selectedSamples(index, song);
    const subset = await buildSongSf2(file, index, song);
    const elapsed = performance.now() - start;
    const loaded = SoundBankLoader.fromArrayBuffer(subset);
    expect(samples.size).toBeGreaterThan(0);
    expect(subset.byteLength).toBeLessThan(file.size);
    expect(loaded.samples.length).toBeGreaterThan(0);
    for (const id of samples) expect(loaded.samples[id].getRawData(false).byteLength).toBeGreaterThan(0);
    const demand = songKeyDemand(song);
    let voiced = 0;
    for (const [program, keys] of demand.programs) {
      const preset = loaded.getPreset({ program, bankMSB: 0, bankLSB: 0, isGMGSDrum: false }, 'gm');
      for (const [key, velocities] of keys) for (const velocity of velocities) {
        for (const voice of preset.getVoiceParameters(key, velocity)) {
          expect(voice.sample.getRawData(false).byteLength).toBeGreaterThan(0);
          voiced++;
        }
      }
    }
    for (const [key, velocities] of demand.drums) {
      const preset = loaded.getPreset({ program: 0, bankMSB: 128, bankLSB: 0, isGMGSDrum: true }, 'gm');
      for (const velocity of velocities) {
        for (const voice of preset.getVoiceParameters(key, velocity)) {
          expect(voice.sample.getRawData(false).byteLength).toBeGreaterThan(0);
          voiced++;
        }
      }
    }
    expect(voiced).toBeGreaterThan(0);
    console.info(`SF2 subset ${path.pathname.split('/').at(-1)}: ${file.size} -> ${subset.byteLength} bytes, ${samples.size} samples, ${elapsed.toFixed(0)} ms`);
  }
  expect(bytesRead).toBeLessThan(file.size);
}, 30000);
