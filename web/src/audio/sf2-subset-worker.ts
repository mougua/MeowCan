import { buildSongSf2, type Sf2Index, type SongSoundRequirements } from './sf2-subset';

self.onmessage = async (event: MessageEvent<{ file: Blob; index: Sf2Index; song: SongSoundRequirements }>) => {
  try {
    const started = performance.now();
    const bank = await buildSongSf2(event.data.file, event.data.index, event.data.song);
    const elapsedMs = performance.now() - started;
    self.postMessage({ bank, elapsedMs }, { transfer: [bank] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
