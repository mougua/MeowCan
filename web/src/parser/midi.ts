export interface MidiState {
  program: number;
  volume: number;
  expression: number;
  pan: number;
}

interface Event { quarter: number; channel: number; kind: number; a: number; b: number }

// Read channel state from every SMF track, including running-status messages.
export function readMidiState(bytes: Uint8Array): (quarter: number, channel: number, fallback?: number) => MidiState {
  const events: Event[] = [];
  if (bytes.length >= 14 && String.fromCharCode(...bytes.subarray(0, 4)) === 'MThd') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const division = view.getUint16(12);
    let p = 8 + view.getUint32(4);
    while (p + 8 <= bytes.length) {
      const end = Math.min(bytes.length, p + 8 + view.getUint32(p + 4));
      p += 8;
      let tick = 0, running = 0;
      const vlq = () => {
        let value = 0, b = 0;
        do { if (p >= end) throw new Error('Truncated MIDI event'); b = bytes[p++]; value = value * 128 + (b & 127); } while (b & 128);
        return value;
      };
      while (p < end) {
        tick += vlq();
        let status = bytes[p];
        if (status & 128) { p++; if (status < 240) running = status; }
        else status = running;
        if (!status) throw new Error('Invalid MIDI running status');
        if (status === 255) { p++; const length = vlq(); p += length; continue; }
        if (status === 240 || status === 247) { const length = vlq(); p += length; continue; }
        const kind = status & 240;
        const a = bytes[p++];
        const b = kind === 192 || kind === 208 ? 0 : bytes[p++];
        if (kind === 192 || kind === 176) events.push({ quarter: tick / division, channel: status & 15, kind, a, b });
      }
      p = end;
    }
  }
  events.sort((a, b) => a.quarter - b.quarter);
  const channels = Array.from({ length: 16 }, (_, channel) => events.filter(e => e.channel === channel));
  return (quarter, channel, fallback = 0) => {
    const state = { program: fallback & 127, volume: 100, expression: 127, pan: 64 };
    for (const e of channels[channel & 15]) {
      if (e.quarter > quarter) break;
      if (e.kind === 192) state.program = e.a;
      else if (e.a === 7) state.volume = e.b;
      else if (e.a === 11) state.expression = e.b;
      else if (e.a === 10) state.pan = e.b;
    }
    return state;
  };
}
