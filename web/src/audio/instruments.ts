export interface InstrumentVoice {
  harmonics: number[];
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  cutoff: number;
}

// Compact procedural GM families. Programs select timbre, never MIDI channel.
// These are synthesized approximations, without an external sample bank.
const families: InstrumentVoice[] = [
  { harmonics: [1, .5, .24, .12, .06], attack: .004, decay: .45, sustain: .08, release: .16, cutoff: 6000 }, // piano
  { harmonics: [1, .06, .45, .02, .18], attack: .002, decay: .28, sustain: .02, release: .25, cutoff: 9000 }, // chromatic percussion
  { harmonics: [1, .6, .4, .25, .2, .15], attack: .012, decay: .1, sustain: .85, release: .06, cutoff: 5500 }, // organ
  { harmonics: [1, .48, .23, .14, .07], attack: .003, decay: .22, sustain: .06, release: .12, cutoff: 4200 }, // guitar
  { harmonics: [1, .32, .14, .08], attack: .006, decay: .18, sustain: .35, release: .09, cutoff: 1600 }, // bass
  { harmonics: [1, .55, .35, .25, .2, .14], attack: .08, decay: .2, sustain: .75, release: .22, cutoff: 4500 }, // strings
  { harmonics: [1, .4, .3, .18, .12], attack: .12, decay: .3, sustain: .8, release: .3, cutoff: 3300 }, // ensemble
  { harmonics: [1, .65, .42, .3, .2], attack: .035, decay: .15, sustain: .7, release: .12, cutoff: 5000 }, // brass
  { harmonics: [1, .15, .5, .08, .28, .04, .12], attack: .025, decay: .12, sustain: .7, release: .09, cutoff: 4200 }, // reed
  { harmonics: [1, .12, .035, .01], attack: .035, decay: .15, sustain: .75, release: .12, cutoff: 5500 }, // pipe
  { harmonics: [1, .5, .33, .25, .2, .16], attack: .008, decay: .1, sustain: .65, release: .12, cutoff: 6500 }, // synth lead
  { harmonics: [1, .3, .2, .14, .1], attack: .2, decay: .3, sustain: .8, release: .45, cutoff: 3000 }, // pad
  { harmonics: [1, .1, .32, .04, .2, .03, .1], attack: .045, decay: .3, sustain: .4, release: .4, cutoff: 7000 }, // effects
  { harmonics: [1, .55, .2, .25, .08], attack: .003, decay: .2, sustain: .1, release: .15, cutoff: 5500 }, // ethnic
  { harmonics: [1, .05, .3, .015, .15], attack: .002, decay: .14, sustain: .015, release: .1, cutoff: 6500 }, // percussive
  { harmonics: [1, .7, .15, .35, .05, .2], attack: .015, decay: .12, sustain: .2, release: .15, cutoff: 4000 }, // sound effects
];

export function instrumentVoice(program: number): InstrumentVoice {
  const p = Math.max(0, Math.min(127, program | 0));
  const family = families[p >> 3];
  const variation = p & 7;
  return {
    ...family,
    harmonics: family.harmonics.map((h, i) => h * Math.pow(1 - variation * .045, i)),
    cutoff: family.cutoff * (1 - variation * .055),
    decay: family.decay * (1 + variation * .09),
  };
}
