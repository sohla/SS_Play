import { lincurve, unipolar, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * `thrum`: sound designed to be felt rather than heard.
 *
 * Not a port. There is no p-file behind this page — the mechanisms are AirKit's
 * and named where they are used, but what the page is *for* comes from the
 * vibrotactile literature rather than from a personality.
 *
 * ## Why a phone speaker can do this at all
 *
 * A microspeaker's system resonance sits around 800Hz-1kHz and its output falls
 * 12dB/octave below that, which reads as "a phone has no bass" and is usually
 * the end of the story. The useful half of that fact is less often said: below
 * the cutoff the diaphragm's **excursion goes roughly constant while radiated
 * level falls as f²**. The drive does not disappear, it stops becoming sound and
 * starts becoming movement. So the sub-cutoff band is not the band a phone is
 * bad at — it is the band where a phone is a vibrator rather than a speaker.
 *
 * This page works the speaker there on purpose.
 *
 * ## Why 250Hz and not 40Hz
 *
 * The instinct for anything felt is to go as low as possible, and it is wrong
 * twice over. The vibrotactile detection threshold for glabrous skin is a
 * U-curve with its minimum at **250Hz** — the Pacinian channel's 250-300Hz
 * maximum, where the hand can detect displacements on the order of nanometres.
 * At 40Hz the skin is an order of magnitude less sensitive *and* the speaker has
 * run out of travel. 250Hz is simultaneously the most-felt frequency available
 * and comfortably inside the band the diaphragm can still move through, which
 * is not a coincidence anyone here arranged: it is why phone actuators resonate
 * between 150 and 235Hz.
 *
 * ## Why the three layers are three rates
 *
 * The layers are the three mechanoreceptor channels, and each one is a *rate*
 * regime rather than a sound. Which means the page has one real axis — how
 * often something happens — and crossing a boundary on it changes what the hand
 * is holding without changing its pitch or its level:
 *
 *   1  taps      ≤ ~6Hz      SA-I     separate, countable events
 *   2  flutter   16-32Hz     RA-I     a rhythmic flutter
 *   3  carrier   35-500Hz    RA-II    one smooth continuous buzz
 *
 * The other load-bearing number is **25-30ms**: the duration at which a burst
 * stops being felt as a discrete pulse and becomes a continuous vibration. It is
 * near-constant from 40Hz to 590Hz, unlike its auditory equivalent — so in this
 * instrument *length decides category and pitch does not*. Every envelope here
 * is specced to stay on one side of it deliberately.
 */

/**
 * Must match `level > 0.02` inside `ssp_thrum_clock`.
 *
 * The clock gates its own trigger in the graph, so this constant and that
 * comparison are one decision written in two places. They disagree silently: the
 * page would show `playing` while the server sat below its threshold.
 */
export const SILENCE_BELOW = 0.02

/**
 * What a pulse rate is felt as, in order.
 *
 * These are the boundaries from the psychophysics, not a scale someone liked:
 * below about 6.3Hz the pulses of a periodic stimulus stay segregated and can be
 * counted; between roughly 16 and 32Hz they take on a flutter quality; past
 * 50-80Hz they fuse into something smooth. The two gaps are genuinely gaps —
 * the percept in them is neither thing, and naming them that way is more honest
 * than putting a boundary in the middle of one.
 *
 * Shown on the page because it is the one readout that says what the instrument
 * is currently *doing* rather than what its numbers are. A rate of 38Hz means
 * nothing to anyone; `rough` is the whole report.
 */
export const REGIMES: readonly { readonly below: number; readonly name: string }[] = [
  { below: 6.3, name: 'discrete' },
  { below: 16, name: 'stutter' },
  { below: 32, name: 'flutter' },
  { below: 80, name: 'rough' },
  { below: Infinity, name: 'fused' },
]

export function regimeOf(rate: number): string {
  return REGIMES.find((regime) => rate < regime.below)?.name ?? 'fused'
}

/** Everything the three layers need, before it is split across two synths. */
export interface Thrum {
  /** Clock: seconds between taps. */
  dur: number
  /** Clock: the striking gesture, which is also the clock's second gate. */
  strike: number
  /** Clock: the tap band's centre, moved with the carrier so all three detune together. */
  base: number
  /** Tap voice. */
  decay: number
  tapAmp: number
  /** Bed, layer two. */
  flutRate: number
  flutAmp: number
  flutDecay: number
  /** Bed, layer three. */
  carFreq: number
  carAmp: number
  /** Whether the hand is doing anything at all. Gates the clock and the badge. */
  level: number
  /** How much of the bed the taps are currently taking. */
  duck: number
  /** The bed's master level: the travel the taps left it. */
  bedAmp: number
  /** The three layers' drive, 0..1, for the plotter. */
  drive: readonly [taps: number, flutter: number, carrier: number]
}

export function thrumFrom(motion: Motion, sensitivity = 0.5): Thrum {
  // Sensitivity, AirKit style, and only on the two movement spans.
  //
  // The factor is `0.5 / sens` rather than `1 / sens` for the reason every
  // mapping in this repo says: the bounds below are the effective ones, so
  // AirKit's 0.5 default has to be the neutral point or the page arrives twice
  // as hot as it was tuned.
  //
  // Applied to `shake` and `turn` and to nothing else. Both are genuinely 0..1
  // from zero, which is the only shape AirKit ever scales — `lincurve(v, 0,
  // TOP * sens, …)`. Orientation is absolute and is left alone further down.
  const gain = 0.5 / Math.max(0.05, sensitivity)
  const mass = Math.min(1, motion.shake * gain)
  const spin = Math.min(1, motion.turn * gain)

  // One number for "the hand is doing something", from either gesture. The
  // clock takes this *and* `strike`, because they answer different questions —
  // see the note in ssp_thrum_clock.
  const level = Math.max(mass, spin)

  // Excursion is zero-sum, and this is the one line that admits it.
  //
  // The three layers are not three independent signals: they are three claims on
  // the same ±0.4mm of diaphragm travel. A tap landing on top of a bed that is
  // already using most of it does not add to the excursion, it just clips — so
  // the tap would be heard getting dirtier and not felt getting harder, which is
  // backwards for the one layer whose events are supposed to be individually
  // felt. Ducking gives the taps their headroom back by taking it from the bed.
  //
  // Done here rather than with a sidechain in the graph because the mapping
  // already knows how hard the hand is striking, and a compressor would have to
  // infer it from a signal that has not been generated yet.
  //
  // Applied as the bed's master `amp` and not to the two layer levels, so the
  // two quantities stay separable: `flutAmp` and `carAmp` are what the gesture
  // asked for, `bedAmp` is what the travel allowed. The plotter shows the first
  // and the readout shows the second.
  const duck = 1 - 0.65 * mass
  const bedAmp = 0.9 * duck

  // ── Layer 1: taps. SA-I, segregated events.
  //
  // The whole range stays under the ~6.3Hz segregation rate — 0.8Hz to 5.9Hz —
  // because this layer's entire reason to exist is that its events are counted
  // rather than fused. Letting a hard shake push it to 10Hz would turn it into a
  // worse copy of layer two.
  //
  // Negative curve, so the response arrives early: a small movement already
  // gets most of the rate, and the top of the travel is fine control rather than
  // the only place anything happens. Same sign and same reason as `suz`.
  const dur = lincurve(mass, 0, 1, 1.2, 0.17, -3)
  const strike = mass

  // 24ms down to 5ms. Both ends under the pulse-to-vibration boundary, so there
  // is no gesture at which a tap stops being a tap — moving harder makes it
  // sharper, never longer. The ceiling is the research number minus a margin,
  // not a taste.
  const decay = lincurve(mass, 0, 1, 0.024, 0.005, -2)
  const tapAmp = lincurve(mass, 0, 1, 0.12, 0.6, -2)

  // ── Layer 2: flutter. RA-I, and the sweep is the instrument.
  //
  // 6Hz to 88Hz on a *positive* curve, which keeps the output low for longer and
  // puts the fine control in the flutter band where the percept changes fastest.
  // A quarter turn is about 14Hz, half is 28Hz, three quarters is 51Hz: the
  // sweep crosses discrete → stutter → flutter → rough → fused in that order,
  // which is four changes of category for one continuous gesture.
  //
  // On rotation rather than on acceleration because it is the gesture you can
  // hold. A boundary you cross and cannot sit on is a glitch, not a control.
  const flutRate = lincurve(spin, 0, 1, 6, 88, 2)
  const flutAmp = lincurve(spin, 0, 1, 0, 0.42, -1)
  const flutDecay = lincurve(spin, 0, 1, 0.022, 0.006, -2)

  // ── Layer 3: carrier. RA-II, the Pacinian peak.
  //
  // Roll sets the frequency across 150-320Hz, so the instrument's one resonance
  // can be moved onto and off the most sensitive point. Absolute orientation, so
  // **sensitivity does not touch it**: thirty degrees of roll is thirty degrees
  // whatever the knob says, and scaling a bipolar span has no meaning AirKit
  // would recognise.
  const carFreq = lincurve(motion.roll, -1, 1, 150, 320, 0)

  // Tilt sets how much of it there is — but gated on movement, because this is
  // the one layer whose own gesture does not return to zero. A phone left
  // propped at an angle has a perfectly valid pitch, and without the gate the
  // page would drone at it on a desk until the tab closed.
  //
  // So: tilt chooses *what* the bed is, movement decides *whether* there is one.
  // Which is also the right way round for an absolute control — it belongs on a
  // timbre, not on a volume.
  const carDrive = unipolar(motion.pitch) * Math.min(1, level * 2.5)
  const carAmp = carDrive * 0.4

  return {
    dur,
    strike,
    base: carFreq,
    decay,
    tapAmp,
    flutRate,
    flutAmp,
    flutDecay,
    carFreq,
    carAmp,
    level,
    duck,
    bedAmp,
    drive: [mass, spin, carDrive],
  }
}

/** The shell's shape, from the three layers. */
export function mapThrum(motion: Motion, sensitivity = 0.5): Mapped {
  const now = thrumFrom(motion, sensitivity)

  return {
    dur: now.dur,
    level: now.level,
    // Merged into every tap as it is born. `freq` and `hard` arrive separately,
    // from the clock's two demand sequences.
    voice: { decay: now.decay, amp: now.tapAmp },
    clock: { strike: now.strike, base: now.base },
    held: {
      flutRate: now.flutRate,
      flutAmp: now.flutAmp,
      flutDecay: now.flutDecay,
      carFreq: now.carFreq,
      carAmp: now.carAmp,
      amp: now.bedAmp,
    },
    traces: [],
    values: [
      ['taps', `${(1 / now.dur).toFixed(1)}/s`],
      ['strike', now.strike.toFixed(2)],
      ['decay', `${(now.decay * 1000).toFixed(1)}ms`],
      ['flutter', `${now.flutRate.toFixed(1)}Hz`],
      ['felt as', regimeOf(now.flutRate)],
      ['carrier', `${now.carFreq.toFixed(0)}Hz`],
      ['bed', now.carAmp.toFixed(2)],
      ['duck', `−${((1 - now.duck) * 100).toFixed(0)}%`],
    ],
  }
}

/**
 * One trace per layer, which is the readout this page wants.
 *
 * Not the raw sensors: what matters here is how much of each of the three
 * channels is being driven, because the failure this plot has to make visible is
 * a gesture that is moving a number the instrument is not currently using. The
 * colour order is AirKit's, and yellow landing on the tap layer is deliberate —
 * it is also the accent colour, and the taps are the lead.
 */
export function plotOf(motion: Motion, sensitivity = 0.5): number[] {
  return [...thrumFrom(motion, sensitivity).drive]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['taps (shake)', 'flutter (turn)', 'carrier (tilt)']
