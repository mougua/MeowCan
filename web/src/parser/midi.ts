export interface MidiState {
  program: number;
  volume: number;
  expression: number;
  pan: number;
}

/** A normalized MIDI channel message whose timestamp uses quarter notes. */
export interface MidiAutomationEvent {
  quarter: number;
  message: number[];
}

interface ChannelEvent extends MidiAutomationEvent {
  channel: number;
  kind: number;
  a: number;
  b: number;
}

/**
 * Reads the non-note MIDI messages embedded in a VOS file. Notes live in the
 * TRK section; the accompanying SMF supplies program, controller, pressure and
 * pitch-wheel automation for the SoundFont engine to interpret.
 */
export function readMidiAutomation(bytes: Uint8Array): MidiAutomationEvent[] {
  return readChannelEvents(bytes).map(({ quarter, message }) => ({ quarter, message }));
}

// Read channel state from every SMF track, including running-status messages.
export function readMidiState(bytes: Uint8Array): (quarter: number, channel: number, fallback?: number) => MidiState {
  const events = readChannelEvents(bytes);
  events.sort((a, b) => a.quarter - b.quarter);
  const channels = Array.from({ length: 16 }, (_, channel) => events.filter(e => e.channel === channel));
  return (quarter, channel, fallback = 0) => {
    const state = { program: fallback & 127, volume: 100, expression: 127, pan: 64 };
    for (const e of channels[channel & 15]) {
      if (e.quarter > quarter) break;
      if (e.kind === 0xc0) state.program = e.a;
      else if (e.kind === 0xb0 && e.a === 7) state.volume = e.b;
      else if (e.kind === 0xb0 && e.a === 11) state.expression = e.b;
      else if (e.kind === 0xb0 && e.a === 10) state.pan = e.b;
    }
    return state;
  };
}

function readChannelEvents(bytes: Uint8Array): ChannelEvent[] {
  const events: ChannelEvent[] = [];
  if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'MThd') return events;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const division = view.getUint16(12);
  if (division === 0 || (division & 0x8000) !== 0) return events;

  let position = 8 + view.getUint32(4);
  while (position + 8 <= bytes.length) {
    const length = view.getUint32(position + 4);
    const end = Math.min(bytes.length, position + 8 + length);
    position += 8;
    let tick = 0;
    let runningStatus = 0;

    const readVlq = () => {
      let value = 0;
      let byte = 0;
      do {
        if (position >= end) throw new Error('Truncated MIDI event');
        byte = bytes[position++];
        value = value * 128 + (byte & 0x7f);
      } while ((byte & 0x80) !== 0);
      return value;
    };

    while (position < end) {
      tick += readVlq();
      let status = bytes[position];
      if ((status & 0x80) !== 0) {
        position++;
        if (status < 0xf0) runningStatus = status;
      } else {
        status = runningStatus;
      }
      if (!status) throw new Error('Invalid MIDI running status');

      if (status === 0xff) {
        position++; // meta type
        const metaLength = readVlq();
        position += metaLength;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const sysexLength = readVlq();
        position += sysexLength;
        continue;
      }

      const kind = status & 0xf0;
      const a = bytes[position++];
      const hasSecondDataByte = kind !== 0xc0 && kind !== 0xd0;
      const b = hasSecondDataByte ? bytes[position++] : 0;

      // Note messages are reconstructed from VOS TRK data; replaying any SMF
      // notes as well would produce doubled voices.
      if (kind >= 0xa0 && kind <= 0xe0) {
        events.push({
          quarter: tick / division,
          channel: status & 0x0f,
          kind,
          a,
          b,
          message: hasSecondDataByte ? [status, a, b] : [status, a]
        });
      }
    }
    position = end;
  }

  events.sort((left, right) => left.quarter - right.quarter);
  return events;
}
