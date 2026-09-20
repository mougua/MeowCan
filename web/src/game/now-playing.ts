export interface NowPlayingMetadata {
  title: string;
  artist: string;
  level: number;
  durationSec: number;
}

export function resolveNowPlayingMetadata(
  parsedSong: NowPlayingMetadata | null,
  catalogSong?: NowPlayingMetadata
): NowPlayingMetadata | null {
  return catalogSong ?? parsedSong;
}
