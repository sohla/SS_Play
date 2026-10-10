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
 * instrument *length decides category and pitch does not*. Which is a trade-off
 * and not a cap: see docs/HAPTICS.md, and the `length` controls below.
 */

/**
 * Must match `level > 0.02` inside `ssp_thrum_clock`.
 *
 * The clock gates its own trigger in the graph, so this constant and that
 * comparison are one decision written in two places. They disagree silently: the
 * page would show `playing` while the server sat below its threshold.
 */
export const SILENCE_BELOW = 0.02

/** The tap/vibration boundary, in seconds. Reported, never enforced. */
export const TAP_BOUNDARY_S = 0.025

/**
 * Every layer's pitch and length, independently.
 *
 * Three rounds of feedback from a hand got this file here, and each one removed
 * something clever rather than adding something:
 *
 * 1. *"the short glitches are so short i don't feel like i can feel them"* — the
 *    envelope lengths were capped under 25ms to keep taps reading as taps, and
 *    that is the duration where the Pacinian channel is least sensitive. Capped
 *    became adjustable.
 * 2. *"no width control"* — burst length had been shipped as "pulse", which is a
 *    different control from pulse *width*. Both exist now.
 * 3. *"flutter needs its own pitch and length control as does tap … you seem to
 *    be guessing a bit and over complicating"* — correct. Three things were
 *    shared because sharing them was defensible on paper, and each one removed a
 *    question the instrument needed to be able to ask:
 *
 *    - the flutter and the carrier shared one oscillator, so the flutter had no
 *      pitch of its own
 *    - the taps took their pitch from the carrier through a sequence of ratios,
 *      so they had no pitch of their own either
 *    - one `length` fed both the taps and the flutter
 *
 *    Plus two demand sequences moving tap pitch and hardness on their own, which
 *    meant no two taps were the same stimulus — so a hand trying to find a
 *    setting was comparing things that had never been equal.
 *
 * What is left is a grid. **One pitch and one length per layer, nothing derived
 * from anything else.** The shape controls are deliberately global, because they
 * describe the waveform rather than a layer.
 */
export interface Controls {
  /** Layer 1 — the taps. */
  tapPitch: number
  tapLength: number
  /** Taps per second. Free run only; otherwise shake sets it. */
  tapRate: number

  /** Layer 2 — the flutter. */
  flutPitch: number
  flutLength: number
  /** Pulses per second. Free run only; otherwise turning sets it. */
  flutRate: number

  /** Layer 3 — the carrier, which is continuous and so has no length. */
  carPitch: number

  /**
   * Duty cycle, 0.02..0.5 — a real pulse width, shared by all three layers.
   *
   * 0.5 is a square: fundamental at 4/π of the peak, so ~27% more excursion than
   * a sine for the same headroom, and the most felt setting. Narrowing moves
   * energy into harmonics above the speaker's cutoff — louder to the ear,
   * thinner to the hand. No setting is good at both: the sharp edges that make a
   * waveform bright are the edges that move the diaphragm.
   */
  width: number
  /**
   * Onset time. The glitchiness control.
   *
   * 0.2ms is a click. 60ms has no transient left and the burst swells in.
   */
  attack: number
  /** The audible 2.5kHz tick on each tap. Zero is a legitimate setting. */
  click: number
  /** Master level into both limiters. */
  drive: number

  /**
   * Sound at these settings with the phone held still.
   *
   * Judging a vibration while shaking the thing producing it is close to
   * impossible, so this replaces the three gestures with the sliders above.
   * **The one rule: in free run every slider is exact; in gesture mode the
   * gestures modulate.**
   */
  freeRun: boolean
  muteTaps: boolean
  muteFlutter: boolean
  muteCarrier: boolean
}

export const DEFAULT_CONTROLS: Controls = {
  tapPitch: 250,
  tapLength: 0.012,
  tapRate: 3,
  flutPitch: 250,
  flutLength: 0.012,
  flutRate: 18,
  carPitch: 250,
  width: 0.5,
  attack: 0.001,
  click: 0.35,
  drive: 0.8,
  freeRun: false,
  muteTaps: false,
  muteFlutter: false,
  muteCarrier: false,
}

/**
 * Every slider's range, matching the specs the three defs declare.
 *
 * The three pitch ranges are 60-600Hz, widened from the old 150-320Hz. 250Hz is
 * where skin is most sensitive *on average*, and an average is not a hand — the
 * only way to find out where one device works is to be able to look outside it.
 */
export const RANGES = {
  tapPitch: { min: 60, max: 600 },
  tapLength: { min: 0.003, max: 0.4 },
  tapRate: { min: 0.8, max: 6 },
  flutPitch: { min: 60, max: 600 },
  flutLength: { min: 0.003, max: 0.4 },
  flutRate: { min: 4, max: 90 },
  carPitch: { min: 60, max: 600 },
  width: { min: 0.02, max: 0.5 },
  attack: { min: 0.0002, max: 0.06 },
  click: { min: 0, max: 0.6 },
  drive: { min: 0, max: 1 },
} as const

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const held = (value: number, key: keyof typeof RANGES) =>
  clamp(value, RANGES[key].min, RANGES[key].max)

/**
 * What a pulse rate is felt as, in order.
 *
 * The boundaries from the psychophysics, not a scale someone liked: below about
 * 6.3Hz the pulses of a periodic stimulus stay segregated and can be counted;
 * between roughly 16 and 32Hz they take on a flutter quality; past 50-80Hz they
 * fuse into something smooth. The two gaps are genuinely gaps — the percept in
 * them is neither thing.
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

/** Which side of the tap/vibration boundary a length is on. */
export function pulseReads(seconds: number): string {
  if (seconds < TAP_BOUNDARY_S * 0.6) return 'tap'
  if (seconds < TAP_BOUNDARY_S * 1.4) return 'edge'
  return 'buzz'
}

/** Which way a duty cycle is trading the two senses. */
export function widthReads(width: number): string {
  if (width > 0.38) return 'fat, felt'
  if (width > 0.18) return 'mid'
  return 'thin, heard'
}

/** Everything the three layers need, before it is split across two synths. */
export interface Thrum {
  /** Clock: seconds between taps, the tap pitch, and the clock's second gate. */
  dur: number
  tapFreq: number
  strike: number
  /** Tap voice. */
  tapLength: number
  tapAmp: number
  /** Bed, layer two. */
  flutFreq: number
  flutRate: number
  flutLength: number
  flutAmp: number
  /** Bed, layer three. */
  carFreq: number
  carAmp: number
  /** Shape, shared. */
  width: number
  attack: number
  clickAmp: number
  /** Whether the hand is doing anything. Gates the clock and the badge. */
  level: number
  bedAmp: number
  /** The three layers' drive, 0..1, for the plotter. */
  drive: readonly [taps: number, flutter: number, carrier: number]
}

/**
 * The gesture drive free run stands in for.
 *
 * 0.7 rather than 1: it leaves all three layers audible at once, which is what
 * auditioning them needs.
 */
const FREE_DRIVE = 0.7

export function thrumFrom(
  motion: Motion,
  sensitivity = 0.5,
  controls: Controls = DEFAULT_CONTROLS,
): Thrum {
  // Sensitivity, AirKit style, on the two movement spans and nothing else. The
  // factor is `0.5 / sens` rather than `1 / sens` for the reason every mapping
  // here says: the bounds below are the effective ones, so AirKit's 0.5 default
  // has to be the neutral point or the page arrives twice as hot as it was tuned.
  const gain = 0.5 / Math.max(0.05, sensitivity)

  const mass = controls.freeRun ? FREE_DRIVE : Math.min(1, motion.shake * gain)
  const spin = controls.freeRun ? FREE_DRIVE : Math.min(1, motion.turn * gain)

  // Pinned open in free run, which is the point of the mode: the page has to
  // sound while the phone sits still, so what is being judged is the vibration
  // rather than the arm making it.
  const level = controls.freeRun ? 1 : Math.max(mass, spin)

  // ── Layer 1: taps.
  //
  // The rate stays under the ~6.3Hz segregation rate, because countable events
  // are this layer's whole reason to exist. Negative curve so the response
  // arrives early, same sign and reason as `suz`.
  const dur = controls.freeRun
    ? 1 / held(controls.tapRate, 'tapRate')
    : lincurve(mass, 0, 1, 1.2, 0.17, -3)

  // Muting stops the clock rather than silencing the voice: the clock gates on
  // `strike > 0.02` in the graph, so a muted layer costs no nodes at all.
  const strike = controls.muteTaps ? 0 : mass
  const tapAmp = lincurve(mass, 0, 1, 0.12, 1, -2) * controls.drive

  // ── Layer 2: flutter.
  //
  // The rate is the instrument: 6Hz to 88Hz crosses discrete → stutter →
  // flutter → rough → fused, four changes of category for one gesture. On
  // rotation because it is the gesture you can hold.
  const flutRate = controls.freeRun
    ? held(controls.flutRate, 'flutRate')
    : lincurve(spin, 0, 1, 6, 88, 2)
  const flutAmp = controls.muteFlutter ? 0 : lincurve(spin, 0, 1, 0, 0.42, -1)

  // ── Layer 3: carrier.
  //
  // Gated on movement, because this is the one layer whose own gesture does not
  // return to zero: a phone propped at an angle has a valid tilt, and without
  // the gate the page would drone at it on a desk until the tab closed.
  const carDrive = controls.muteCarrier
    ? 0
    : (controls.freeRun ? 1 : unipolar(motion.pitch)) * Math.min(1, level * 2.5)

  return {
    dur,
    // Each layer's pitch is its own control and is derived from nothing. In
    // gesture mode roll offsets the carrier by ±35Hz — the one rule, that free
    // run is exact and gestures modulate — and the other two are left alone,
    // since no gesture is mapped to them.
    tapFreq: held(controls.tapPitch, 'tapPitch'),
    strike,
    tapLength: held(controls.tapLength, 'tapLength'),
    tapAmp,
    flutFreq: held(controls.flutPitch, 'flutPitch'),
    flutRate,
    flutLength: held(controls.flutLength, 'flutLength'),
    flutAmp,
    carFreq: held(
      controls.freeRun
        ? controls.carPitch
        : controls.carPitch + lincurve(motion.roll, -1, 1, -35, 35, 0),
      'carPitch',
    ),
    carAmp: carDrive * 0.45,
    width: held(controls.width, 'width'),
    attack: held(controls.attack, 'attack'),
    clickAmp: held(controls.click, 'click'),
    level,
    // No duck. The taps used to pull the bed down as the hand struck harder, on
    // the argument that excursion is zero-sum and a tap needs headroom to land
    // in. The argument is right and the control was wrong: a level that moves
    // while you are trying to judge a level is the thing that makes a page
    // impossible to tune. The limiter already handles the sum.
    bedAmp: 0.9 * controls.drive,
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
    voice: {
      freq: now.tapFreq,
      decay: now.tapLength,
      attack: now.attack,
      width: now.width,
      clickAmp: now.clickAmp,
      hard: 0.7,
      amp: now.tapAmp,
    },
    clock: { strike: now.strike, freq: now.tapFreq },
    held: {
      flutFreq: now.flutFreq,
      flutRate: now.flutRate,
      flutAmp: now.flutAmp,
      flutDecay: now.flutLength,
      flutAttack: now.attack,
      width: now.width,
      carFreq: now.carFreq,
      carAmp: now.carAmp,
      amp: now.bedAmp,
    },
    traces: [],
    // Grouped by layer, in the order of the plot's colours, so the readout and
    // the panel can be read against each other.
    values: [
      ['tap', `${(1 / now.dur).toFixed(1)}/s`],
      ['tap Hz', `${now.tapFreq.toFixed(0)}`],
      ['tap len', `${(now.tapLength * 1000).toFixed(0)}ms ${pulseReads(now.tapLength)}`],
      ['flut', `${now.flutRate.toFixed(1)}Hz ${regimeOf(now.flutRate)}`],
      ['flut Hz', `${now.flutFreq.toFixed(0)}`],
      ['flut len', `${(now.flutLength * 1000).toFixed(0)}ms ${pulseReads(now.flutLength)}`],
      ['carrier', `${now.carFreq.toFixed(0)}Hz`],
      // `bed` and `strike` are the two levels, kept because they are how you
      // tell a muted layer from a silent one — and because the spec reads them.
      ['bed', now.carAmp.toFixed(2)],
      ['strike', now.strike.toFixed(2)],
      ['width', `${now.width.toFixed(2)} ${widthReads(now.width)}`],
    ],
  }
}

/**
 * One trace per layer.
 *
 * Not the raw sensors: what matters is how much of each channel is being driven,
 * because the failure this has to make visible is a gesture moving a number the
 * instrument is not using. Yellow lands on the taps deliberately — it is also
 * the accent colour, and the taps are the lead.
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
