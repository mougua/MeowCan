import type { SoundFontPack } from './soundfont-catalog';
import { indexSf2, type Sf2Index } from './sf2-subset';
import type { VosSongData } from '../parser/vos';
import { deleteCachedSoundFont, getCachedSoundFont } from '../asset-cache';

const DATABASE_NAME = 'meowcan-local-soundfonts';
const STORE_NAME = 'banks';
const legacyIndexes = new Map<string, Sf2Index>();

interface StoredSoundFont {
  id: string;
  filename: string;
  name: string;
  sizeBytes: number;
  file: Blob;
  index?: Sf2Index;
}

export function isLocalSoundFont(pack: SoundFontPack): boolean {
  return pack.id.startsWith('local:');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('浏览器不支持 IndexedDB，无法保存音色库。'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    let value: T;
    transaction.oncomplete = () => { db.close(); resolve(value); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
    run(transaction.objectStore(STORE_NAME), result => { value = result; });
  });
}

function toPack(entry: StoredSoundFont): SoundFontPack {
  return { id: entry.id, filename: entry.filename, name: entry.name, sizeBytes: entry.sizeBytes, url: '' };
}

export async function listLocalSoundFonts(): Promise<SoundFontPack[]> {
  return withStore('readonly', (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done((request.result as StoredSoundFont[])
      .filter(entry => entry.id.startsWith('local:')).map(toPack));
  });
}

export async function isSoundFontStored(id: string): Promise<boolean> {
  return withStore('readonly', (store, done) => {
    const request = store.count(id);
    request.onsuccess = () => done(request.result > 0);
  });
}

/** Streams a downloaded bank into a Blob, then saves it beside imported files. */
export async function storeDownloadedSoundFont(
  pack: SoundFontPack,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<void> {
  if (await isSoundFontStored(pack.id)) return;
  const cached = await getCachedSoundFont(pack.url);
  const response = cached ?? await fetch(pack.url);
  if (!response.ok) throw new Error(`音色库读取失败 (HTTP ${response.status})`);
  const total = Number(response.headers.get('content-length')) || pack.sizeBytes;
  let blob: Blob;
  if (response.body) {
    const reader = response.body.getReader();
    let loaded = 0;
    const tracked = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }
        loaded += value.byteLength;
        onProgress?.(loaded, total);
        controller.enqueue(value);
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    blob = await new Response(tracked).blob();
  } else {
    blob = await response.blob();
  }
  if (blob.size !== pack.sizeBytes) throw new Error('下载的音色库大小与目录不符');
  const index = await indexSf2(blob);
  const entry: StoredSoundFont = {
    id: pack.id, filename: pack.filename, name: pack.name,
    sizeBytes: blob.size, file: blob, index,
  };
  await withStore<void>('readwrite', (store) => { store.put(entry); });
  if (cached) await deleteCachedSoundFont(pack.url);
  onProgress?.(blob.size, blob.size);
}

export async function importLocalSoundFont(file: File): Promise<SoundFontPack> {
  if (!/\.sf2$/i.test(file.name) || file.size < 12) throw new Error('请选择有效的 .sf2 音色库文件。');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const tag = (offset: number) => String.fromCharCode(...header.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'sfbk') throw new Error('文件不是有效的 SF2 音色库。');
  const index = await indexSf2(file);
  const entry: StoredSoundFont = {
    id: `local:${crypto.randomUUID()}`,
    filename: file.name,
    name: file.name.replace(/\.sf2$/i, ''),
    sizeBytes: file.size,
    file,
    index,
  };
  await withStore<void>('readwrite', (store) => { store.add(entry); });
  return toPack(entry);
}

export async function readStoredSoundFont(id: string): Promise<{ file: Blob; index: Sf2Index }> {
  const entry = await withStore<StoredSoundFont | undefined>('readonly', (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => done(request.result as StoredSoundFont | undefined);
  });
  if (!entry) throw new Error('音色库未保存在此浏览器，请重新选择。');
  const index = entry.index ?? legacyIndexes.get(id) ?? await indexSf2(entry.file);
  if (!entry.index) legacyIndexes.set(id, index);
  return { file: entry.file, index };
}

export async function buildStoredSongSoundFont(id: string, song: VosSongData): Promise<{ bank: ArrayBuffer; elapsedMs: number }> {
  const { file, index } = await readStoredSoundFont(id);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sf2-subset-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ bank?: ArrayBuffer; elapsedMs?: number; error?: string }>) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.bank) resolve({ bank: event.data.bank, elapsedMs: event.data.elapsedMs ?? 0 });
      else reject(new Error('音色提取线程未返回结果'));
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({ file, index, song: { bgmNotes: song.bgmNotes, playableNotes: song.playableNotes } });
  });
}
