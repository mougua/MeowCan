export interface LaneKeyBinding {
  code: string;
  label: string;
}

export const DEFAULT_LANE_KEYS: readonly LaneKeyBinding[] = [
  { code: 'KeyS', label: 'S' },
  { code: 'KeyD', label: 'D' },
  { code: 'KeyF', label: 'F' },
  { code: 'Space', label: 'SPACE' },
  { code: 'KeyJ', label: 'J' },
  { code: 'KeyK', label: 'K' },
  { code: 'KeyL', label: 'L' }
];

export function isLaneKeyBindings(value: unknown): value is LaneKeyBinding[] {
  if (!Array.isArray(value) || value.length !== 7) return false;
  const codes = new Set<string>();
  for (const binding of value) {
    if (!binding || typeof binding !== 'object') return false;
    const candidate = binding as Partial<LaneKeyBinding>;
    if (typeof candidate.code !== 'string' || !candidate.code || candidate.code === 'Unidentified') return false;
    if (typeof candidate.label !== 'string' || !candidate.label.trim()) return false;
    codes.add(candidate.code);
  }
  return codes.size === 7;
}

export function keyLabel(event: Pick<KeyboardEvent, 'code' | 'key'>): string {
  if (event.code === 'Space') return 'SPACE';
  if (event.key && event.key !== 'Unidentified') {
    const aliases: Record<string, string> = {
      ' ': 'SPACE', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      Control: 'CTRL', Alt: 'ALT', Shift: 'SHIFT', Meta: 'META', Escape: 'ESC', Enter: 'ENTER'
    };
    return (aliases[event.key] ?? event.key).toLocaleUpperCase().slice(0, 10);
  }
  return event.code.replace(/^(Key|Digit)/, '').toLocaleUpperCase().slice(0, 10);
}

export function bindingsToLaneMap(bindings: readonly LaneKeyBinding[]): ReadonlyMap<string, number> {
  return new Map(bindings.map((binding, lane) => [binding.code, lane]));
}
