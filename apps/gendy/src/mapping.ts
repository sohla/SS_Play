import { linexp, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * gendy2's `~next`, in TypeScript.
 *
 *   amp        = accelMassFiltered.linlin(0, 1.5, 0.001, 1.0) * 1.5;  0 below 0.02
 *   detune     = accelMassFiltered.linlin(0, 2.5, 0.1,   0.2)
 *   filterFreq = rrateMassFiltered.linexp(0, 1,   400,   9200)
 *   index      = gyroYFiltered.linlin(-1, 1, 0, notes.size - 1).floor
 *
 * `detune` and `rtime` are parameters of the Gendy voice, not of the miniMoog
 * the file actually instantiates — which is the evidence that the init line was
 * swapped to a stand-in and this mapping was written for the swarm.
 *
 * `filterFreq` has no counterpart on the Gendy voice at all, so it drives the
 * reverb time instead: the one control there that changes the size of the thing
 * rather than its colour. Named as a substitution, not a port.
 */
export const SILENCE_BELOW = 0.02

/** `[30, 32, 34, 35, 37] + 24 + 5` — a pentatonic figure, low. */
export const NOTES = [59, 61, 63, 64, 66]

const linlin = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((d - c) * (Math.min(Math.max(v, a), b) - a)) / (b - a)

export const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

export interface Gendy {
  amp: number
  detune: number
  rtime: number
  freq: number
  index: number
}

export function gendyFrom(motion: Motion, sensitivity = 0.5): Gendy {
  
  // Sensitivity, AirKit style. Its personalities write
  // `lincurve(v, 0, TOP * sens, …)`; scaling the input is the same function, and
  // it is one line here instead of one per curve.
  //
  // The factor is `0.5 / sens`, not `1 / sens`, and that matters. The bounds in
  // this file were ported from a personality that has no `sens` at all, so they
  // are already the *effective* bounds — the ones the instrument actually used.
  // Dividing by AirKit's 0.5 default would therefore make every page twice as
  // hot as the thing it was ported from. 0.5 is the neutral point; the range and
  // the direction are still AirKit's.
  //
  // Clamped away from zero, which would be a division by it.
  const mass = motion.shake * 2.5 * (0.5 / Math.max(0.05, sensitivity))

  let amp = linlin(mass, 0, 1.5, 0.001, 1.0) * 1.5
  if (amp < 0.02) amp = 0

  const index = Math.min(
    Math.floor(linlin(motion.pitch, -1, 1, 0, NOTES.length - 1)),
    NOTES.length - 1,
  )

  return {
    amp,
    detune: linlin(mass, 0, 2.5, 0.1, 0.2),
    // The original's filterFreq curve, over the reverb time instead.
    rtime: linexp(motion.turn, 0, 1, 0.4, 12),
    freq: midiToFreq(NOTES[index] as number),
    index,
  }
}

export function mapGendy(motion: Motion, sensitivity = 0.5): Mapped {
  const now = gendyFrom(motion, sensitivity)

  return {
    dur: 0,
    level: now.amp,
    voice: {},
    held: { amp: now.amp, detune: now.detune, rtime: now.rtime, freq: now.freq },
    traces: [
      { label: 'move', hint: 'level, and how far the swarm spreads', value: motion.shake * 2 - 1 },
      { label: 'tilt', hint: 'note', value: motion.pitch },
      { label: 'turn', hint: 'size of the room', value: motion.turn * 2 - 1 },
    ],
    values: [
      ['amp', now.amp.toFixed(3)],
      ['note', `${NOTES[now.index]}`],
      ['detune', now.detune.toFixed(3)],
      ['reverb', `${now.rtime.toFixed(1)}s`],
    ],
  }
}

/**
 * gendy2.sc's `~plot`, ported.
 *
 *   [d.sensors.gyroEvent.y]
 *
 * The plotter polls this at 33Hz and keeps fifty frames, so these are the values
 * the mapping actually feeds its curves with a second and a half of history —
 * which is the readout that makes a gesture doing nothing visible.
 */
export function plotOf(motion: Motion, sensitivity = 0.5): number[] {
  return [motion.pitch]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['tilt']
