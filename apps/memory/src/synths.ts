/**
 * The synths the remembered onsets can play, as picked on the page; the first is
 * where it starts.
 *
 * `ssp_insect` is this page's own, a cricket's chirp. The rest are Sonic Pi's,
 * vendored with the engine. All are struck or plucked, self-freeing, and played
 * by `note` and `amp`. `level` is the `amp` an onset at full peak gets, so the
 * quieter and louder synths sit together.
 *
 * Read by the Vite config too, to ship exactly these.
 */
export const SYNTHS = [
  { name: 'insect', def: 'ssp_insect', level: 1 },
  { name: 'kalimba', def: 'sonic-pi-kalimba', level: 1 },
  { name: 'pluck', def: 'sonic-pi-pluck', level: 0.8 },
  { name: 'pretty bell', def: 'sonic-pi-pretty_bell', level: 0.5 },
  { name: 'rhodey', def: 'sonic-pi-rhodey', level: 0.6 },
  { name: 'piano', def: 'sonic-pi-piano', level: 0.8 },
  { name: 'fm', def: 'sonic-pi-fm', level: 0.4 },
] as const

export type Synth = (typeof SYNTHS)[number]
