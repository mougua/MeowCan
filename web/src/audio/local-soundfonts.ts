import type { SoundFontPack } from './soundfont-catalog';

const DATABASE_NAME = 'meowcan-local-soundfonts';
const STORE_NAME = 'banks';

interface StoredSoundFont {
  id: string;
  filename: string;
  name: string;
  sizeBytes: number;
  file: Blob;
}

export function isLocalSoundFont(pack: SoundFontPack): boolean {
  return pack.id.startsWith('local:');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('浏览器不支持 IndexedDB，无法持久保存本地音色库。'));
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
    request.onsuccess = () => done((request.result as StoredSoundFont[]).map(toPack));
  });
}

export async function importLocalSoundFont(file: File): Promise<SoundFontPack> {
  if (!/\.sf2$/i.test(file.name) || file.size < 12) throw new Error('请选择有效的 .sf2 音色库文件。');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const tag = (offset: number) => String.fromCharCode(...header.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'sfbk') throw new Error('文件不是有效的 SF2 音色库。');
  const entry: StoredSoundFont = {
    id: `local:${crypto.randomUUID()}`,
    filename: file.name,
    name: file.name.replace(/\.sf2$/i, ''),
    sizeBytes: file.size,
    file,
  };
  await withStore<void>('readwrite', (store) => { store.add(entry); });
  return toPack(entry);
}

export async function readLocalSoundFont(id: string): Promise<ArrayBuffer> {
  const entry = await withStore<StoredSoundFont | undefined>('readonly', (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => done(request.result as StoredSoundFont | undefined);
  });
  if (!entry) throw new Error('本地音色库已不存在，请重新导入。');
  return entry.file.arrayBuffer();
}
