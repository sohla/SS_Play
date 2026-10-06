import { lincurve, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * woiworung1's `~next`, in TypeScript.
 *
 *   a  = accelMassFiltered.lincurve(0, 2, 0, 0.15, -2);  below 0.1 -> 0
 *   ch = (accelMassFiltered * 0.25).linlin(0, 1, 0.1, 10)
 *   amp = a * 0.25
 *
 * No pattern at all. One voice is held open and the phone moves two of its
 * controls — and the only event in the whole personality is a note change,
 * which fires when the movement falls back below a threshold rather than when
 * it rises above one. You strike it by stopping.
 */
export const SILENCE_BELOW = 0.003

/** `58 + [4, -10, 4, 8-12, -10, 6-12, 4]`, as written in the original. */
export const NOTES = [62, 48, 62, 54, 48, 52, 62]

const linlin = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((d - c) * (Math.min(Math.max(v, a), b) - a)) / (b - a)

export const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

export function mapWoiworung(motion: Motion, freq: number): Mapped {
  const mass = motion.shake * 2

  let amp = lincurve(mass, 0, 2, 0, 0.15, -2)
  // The original's two clamps, which turn a curve into something with a floor
  // and a ceiling you can actually find with a hand.
  if (amp < 0.1) amp = 0
  if (amp > 0.9) amp = 1

  const ch = linlin(mass * 0.25, 0, 1, 0.1, 10)

  return {
    dur: 0,
    level: mass * 0.1,
    voice: { amp: amp * 0.25, ch, freq },
    traces: [{ label: 'move', hint: 'level, and the rattle', value: motion.shake * 2 - 1 }],
    values: [
      ['amp', (amp * 0.25).toFixed(3)],
      ['ch', ch.toFixed(2)],
      ['note', `${freq.toFixed(1)}Hz`],
    ],
  }
}
