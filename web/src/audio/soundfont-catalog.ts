export interface SoundFontPack {
  id: string;
  filename: string;
  name: string;
  sizeBytes: number;
  url: string;
}

const MANIFEST_URL = '/assets/soundfonts/manifest.json';

export async function fetchSoundFontCatalog(): Promise<SoundFontPack[]> {
  const response = await fetch(MANIFEST_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`音源目录读取失败 (HTTP ${response.status})`);
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new Error('音源目录格式无效');
  return value.filter(isSoundFontPack);
}

function isSoundFontPack(value: unknown): value is SoundFontPack {
  if (!value || typeof value !== 'object') return false;
  const pack = value as Partial<SoundFontPack>;
  return typeof pack.id === 'string' && pack.id.length > 0
    && typeof pack.filename === 'string' && /\.sf2$/i.test(pack.filename)
    && typeof pack.name === 'string' && pack.name.length > 0
    && typeof pack.sizeBytes === 'number' && pack.sizeBytes > 0
    && typeof pack.url === 'string' && pack.url.startsWith('/assets/soundfonts/');
}
