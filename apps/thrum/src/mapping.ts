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
 * The boundary the pulse-width control crosses, in seconds.
 *
 * Under it a burst is felt as a discrete tap; over it as a continuous
 * vibration. Shown on the page rather than enforced, because the page cannot
 * know which side the user wants to be on — see `PULSE` below.
 */
export const TAP_BOUNDARY_S = 0.025

/**
 * What the page lets you change by hand, and why any of it is adjustable.
 *
 * Everything else here is derived from published numbers. These five are not,
 * because they depend on a particular speaker in a particular palm — and the
 * first report back from a hand was that the taps were *too short to feel*,
 * which no amount of reading would have produced.
 *
 * That report is also a finding. A burst short enough to read unambiguously as
 * a tap sits where the Pacinian channel is least sensitive, because that channel
 * summates energy over time up to about a second: detection threshold falls as
 * duration rises. So crispness and detectability trade against each other, the
 * exchange rate is per-device and per-hand, and the honest response is to expose
 * the axis instead of picking a point on it.
 */
export interface Controls {
  /** Burst length for the taps and the flutter pulses, in seconds. */
  pulse: number
  /** Master level into both limiters. The other likely reason nothing is felt. */
  drive: number
  /** Carrier centre in Hz. Roll still offsets it, so the band can be parked. */
  carrier: number
  /** Taps per second, used only when free-running. */
  tapRate: number
  /** Flutter rate in Hz, used only when free-running. */
  flutter: number
  /**
   * Sound at fixed values with the phone held still.
   *
   * The control that makes the rest of them usable. Judging a tactile sensation
   * while shaking the device that produces it is close to impossible — the
   * gesture masks the thing it is meant to trigger — so this replaces the three
   * gestures with the sliders above and lets the phone sit in a palm.
   */
  freeRun: boolean
  /** Per layer, so one can be felt without the other two. */
  muteTaps: boolean
  muteFlutter: boolean
  muteCarrier: boolean
}

/**
 * The gesture drive free run stands in for.
 *
 * Not 1: a page pinned at maximum has the taps ducking the bed by the full 65%,
 * so the layer being auditioned would be the quietest it ever gets. 0.7 leaves
 * all three audible at once, which is what auditioning them needs.
 */
const FREE_DRIVE = 0.7

export const DEFAULT_CONTROLS: Controls = {
  pulse: 0.012,
  drive: 0.8,
  carrier: 250,
  tapRate: 3,
  flutter: 18,
  freeRun: false,
  muteTaps: false,
  muteFlutter: false,
  muteCarrier: false,
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/** The declared range of each slider, matching the specs the three defs carry. */
export const RANGES = {
  pulse: { min: 0.003, max: 0.4 },
  drive: { min: 0, max: 1 },
  carrier: { min: 150, max: 320 },
  tapRate: { min: 0.8, max: 6 },
  flutter: { min: 4, max: 90 },
} as const

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

/**
 * Which side of the tap/vibration boundary a pulse length is on.
 *
 * `tap` is crisp and, in the Pacinian channel, close to undetectable. `buzz` is
 * easy to feel and is not an event. Neither is the right answer and the page
 * says which one you currently have rather than implying one of them is correct.
 */
export function pulseReads(seconds: number): string {
  if (seconds < TAP_BOUNDARY_S * 0.6) return 'tap'
  if (seconds < TAP_BOUNDARY_S * 1.4) return 'edge'
  return 'buzz'
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

export function thrumFrom(
  motion: Motion,
  sensitivity = 0.5,
  controls: Controls = DEFAULT_CONTROLS,
): Thrum {
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

  // How hard each gesture is being made, 0..1. In free run these become a fixed
  // moderate drive rather than an inverse of the rate curves: the sliders set the
  // two *rates* directly further down, and what is still wanted from `mass` and
  // `spin` here is an amplitude and a duck, which should not swing about as a
  // rate is dialled.
  const mass = controls.freeRun ? FREE_DRIVE : Math.min(1, motion.shake * gain)
  const spin = controls.freeRun ? FREE_DRIVE : Math.min(1, motion.turn * gain)

  // One number for "the hand is doing something", from either gesture. The
  // clock takes this *and* `strike`, because they answer different questions —
  // see the note in ssp_thrum_clock.
  //
  // Pinned open in free run, which is the whole point of the mode: the page has
  // to sound while the phone sits still, so the thing being judged is the
  // vibration rather than the arm making it.
  const level = controls.freeRun ? 1 : Math.max(mass, spin)

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
  const bedAmp = 0.9 * duck * controls.drive

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
  const dur = controls.freeRun
    ? 1 / clamp(controls.tapRate, RANGES.tapRate.min, RANGES.tapRate.max)
    : lincurve(mass, 0, 1, 1.2, 0.17, -3)
  // Muting the taps stops the clock rather than silencing the voice, because the
  // clock gates on `strike > 0.02` in the graph — so a muted layer costs no
  // nodes at all rather than spawning one per beat at zero amplitude.
  const strike = controls.muteTaps ? 0 : mass

  // Straight from the slider rather than from the gesture. A duration you are
  // trying to judge cannot also be moving — that was the mistake in the first
  // version, where shaking harder shortened the very thing being felt for, so
  // the harder you looked the less there was to find.
  const decay = clamp(controls.pulse, RANGES.pulse.min, RANGES.pulse.max)
  const tapAmp = lincurve(mass, 0, 1, 0.12, 1, -2) * controls.drive

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
  const flutRate = controls.freeRun
    ? clamp(controls.flutter, RANGES.flutter.min, RANGES.flutter.max)
    : lincurve(spin, 0, 1, 6, 88, 2)
  const flutAmp = controls.muteFlutter ? 0 : lincurve(spin, 0, 1, 0, 0.42, -1)
  const flutDecay = decay

  // ── Layer 3: carrier. RA-II, the Pacinian peak.
  //
  // Roll sets the frequency across 150-320Hz, so the instrument's one resonance
  // can be moved onto and off the most sensitive point. Absolute orientation, so
  // **sensitivity does not touch it**: thirty degrees of roll is thirty degrees
  // whatever the knob says, and scaling a bipolar span has no meaning AirKit
  // would recognise.
  // The slider parks the band and roll offsets it, so the gesture survives while
  // the carrier can still be held still — which is what finding the most-felt
  // frequency on a particular device actually needs.
  const carFreq = clamp(
    controls.carrier + lincurve(motion.roll, -1, 1, -35, 35, 0),
    RANGES.carrier.min,
    RANGES.carrier.max,
  )

  // Tilt sets how much of it there is — but gated on movement, because this is
  // the one layer whose own gesture does not return to zero. A phone left
  // propped at an angle has a perfectly valid pitch, and without the gate the
  // page would drone at it on a desk until the tab closed.
  //
  // So: tilt chooses *what* the bed is, movement decides *whether* there is one.
  // Which is also the right way round for an absolute control — it belongs on a
  // timbre, not on a volume.
  const carDrive = controls.muteCarrier
    ? 0
    : (controls.freeRun ? 1 : unipolar(motion.pitch)) * Math.min(1, level * 2.5)
  const carAmp = carDrive * 0.45

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
export function mapThrum(
  motion: Motion,
  sensitivity = 0.5,
  controls: Controls = DEFAULT_CONTROLS,
): Mapped {
  const now = thrumFrom(motion, sensitivity, controls)

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
      // Both the number and which side of the boundary it is on. 30ms means
      // nothing on its own; "30ms buzz" is the whole report, the same way the
      // flutter rate is reported as a named regime rather than as a frequency.
      ['pulse', `${(now.decay * 1000).toFixed(0)}ms ${pulseReads(now.decay)}`],
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
export function plotOf(
  motion: Motion,
  sensitivity = 0.5,
  controls: Controls = DEFAULT_CONTROLS,
): number[] {
  return [...thrumFrom(motion, sensitivity, controls).drive]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['taps (shake)', 'flutter (turn)', 'carrier (tilt)']
