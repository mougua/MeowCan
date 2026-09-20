import { describe, expect, it } from 'bun:test';
import { DEFAULT_LANE_KEYS, bindingsToLaneMap, isLaneKeyBindings, keyLabel } from './key-bindings';

describe('lane key bindings', () => {
  it('maps exactly seven distinct keys to the seven lanes', () => {
    const map = bindingsToLaneMap(DEFAULT_LANE_KEYS);
    expect(map.size).toBe(7);
    expect(map.get('KeyS')).toBe(0);
    expect(map.get('Space')).toBe(3);
    expect(map.get('KeyL')).toBe(6);
  });

  it('rejects malformed and duplicate persisted bindings', () => {
    expect(isLaneKeyBindings(DEFAULT_LANE_KEYS)).toBe(true);
    expect(isLaneKeyBindings(DEFAULT_LANE_KEYS.slice(0, 6))).toBe(false);
    expect(isLaneKeyBindings(DEFAULT_LANE_KEYS.map((key, lane) => lane === 6 ? { ...key, code: 'KeyS' } : key))).toBe(false);
  });

  it('creates compact labels for printable and control keys', () => {
    expect(keyLabel({ code: 'Space', key: ' ' })).toBe('SPACE');
    expect(keyLabel({ code: 'KeyQ', key: 'q' })).toBe('Q');
    expect(keyLabel({ code: 'ArrowLeft', key: 'ArrowLeft' })).toBe('←');
  });
});
