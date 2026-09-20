import { afterEach, expect, mock, test } from 'bun:test';

class FakeChannel {
  public drumModes: boolean[] = [];

  public setDrums(enabled: boolean): void {
    this.drumModes.push(enabled);
  }
}

class FakeSynthesizer {
  public static latest: FakeSynthesizer | null = null;
  public readonly midiChannels = Array.from({ length: 16 }, () => new FakeChannel());
  public readonly soundBankManager = {
    addSoundBank: async () => undefined,
  };
  public readonly isReady = Promise.resolve();

  public constructor() {
    FakeSynthesizer.latest = this;
  }

  public addNewChannel(): void {
    this.midiChannels.push(new FakeChannel());
  }

  public connect(): void {}
  public destroy(): void {}
}

mock.module('spessasynth_lib', () => ({ WorkletSynthesizer: FakeSynthesizer }));
mock.module('spessasynth_lib/dist/spessasynth_processor.min.js?url', () => ({ default: 'worklet.js' }));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  FakeSynthesizer.latest = null;
});

test('player channels mirror GM drum modes instead of all becoming percussion', async () => {
  const soundFont = new Uint8Array(12);
  soundFont.set(new TextEncoder().encode('RIFF'), 0);
  soundFont.set(new TextEncoder().encode('sfbk'), 8);
  globalThis.fetch = mock(async () => new Response(soundFont));

  const { SoundFontSynth } = await import('./soundfont');
  const context = {
    audioWorklet: { addModule: async () => undefined },
  } as unknown as AudioContext;

  await SoundFontSynth.create(context, {} as AudioNode);

  const synth = FakeSynthesizer.latest;
  expect(synth).not.toBeNull();
  expect(synth!.midiChannels).toHaveLength(32);
  for (let channel = 0; channel < 16; channel++) {
    expect(synth!.midiChannels[16 + channel].drumModes).toEqual([channel === 9]);
  }
  expect(synth!.midiChannels[9].drumModes).toEqual([true]);
});
