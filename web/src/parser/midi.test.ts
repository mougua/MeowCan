import { expect, test } from 'bun:test';
import { readMidiAutomation, readMidiState } from './midi';

test('program changes and running-status controllers are resolved at note time across tracks', () => {
  const track = [0, 0xc2, 73, 0, 0xb2, 7, 80, 0, 11, 100, 0, 10, 32,
    0, 0xe2, 0, 64,
    0x83, 0x60, 0xc2, 6, 0, 0xff, 0x2f, 0];
  const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 0, 2, 1, 224,
    77, 84, 114, 107, 0, 0, 0, 4, 0, 255, 47, 0,
    77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
  const state = readMidiState(bytes);
  expect(state(0, 2)).toEqual({ program: 73, volume: 80, expression: 100, pan: 32 });
  expect(state(1, 2).program).toBe(6);
  expect(state(0, 1, 42).program).toBe(42);

  const automation = readMidiAutomation(bytes);
  expect(automation.some(event => event.quarter === 0
    && event.message.join(',') === [0xe2, 0, 64].join(','))).toBe(true);
  expect(automation.every(event => (event.message[0] & 0xf0) >= 0xa0)).toBe(true);
});
