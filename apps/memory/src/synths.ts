/**
 * The synths the remembered onsets can play, as picked on the page.
 *
 * All Sonic Pi's, vendored with the engine: struck or plucked, self-freeing, and
 * played by `note` and `amp`. `level` is the `amp` an onset at full peak and
 * full life gets, so the quieter and louder synths sit together.
 *
 * Read by the Vite config too, to ship exactly these.
 */
export const SYNTHS = [
  { name: 'kalimba', def: 'sonic-pi-kalimba', level: 1 },
  { name: 'pluck', def: 'sonic-pi-pluck', level: 0.8 },
  { name: 'pretty bell', def: 'sonic-pi-pretty_bell', level: 0.5 },
  { name: 'rhodey', def: 'sonic-pi-rhodey', level: 0.6 },
  { name: 'piano', def: 'sonic-pi-piano', level: 0.8 },
  { name: 'fm', def: 'sonic-pi-fm', level: 0.4 },
] as const

export type Synth = (typeof SYNTHS)[number]
