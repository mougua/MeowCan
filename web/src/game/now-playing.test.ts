import { describe, expect, test } from 'bun:test';
import { resolveNowPlayingMetadata } from './now-playing';

describe('resolveNowPlayingMetadata', () => {
  const parsedSong = {
    title: 'VOS internal title',
    artist: 'VOS artist',
    level: 3,
    durationSec: 182.8
  };

  test('uses catalog metadata for catalog songs', () => {
    const catalogSong = {
      title: 'Catalog title',
      artist: 'Catalog artist',
      level: 5,
      durationSec: 149
    };

    expect(resolveNowPlayingMetadata(parsedSong, catalogSong)).toEqual(catalogSong);
  });

  test('falls back to parsed metadata for local songs', () => {
    expect(resolveNowPlayingMetadata(parsedSong)).toEqual(parsedSong);
  });
});
