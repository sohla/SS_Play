import { lincurve, type Motion } from '@ss/motion'
import type { Mapped } from '@ss/ui'

/**
 * `thrum`: one haptic pulse, with every parameter the research says matters on a
 * slider.
 *
 * ## What the earlier versions got wrong
 *
 * Three layers, each eventually with its own pitch, rate and length — and the
 * page was still unfeelable. The structure was never the problem. **The pulse
 * itself had no controls.** Its envelope, its onset, its two halves and their
 * balance were baked into the SynthDef, chosen from the literature, and
 * therefore wrong in exactly the way a literature value is wrong: correct about
 * a population, and silent about one hand holding one speaker.
 *
 * So: one layer, and nine parameters.
 *
 * ## The pulse is an impulse followed by a decaying tone
 *
 * Which is what a real actuator does, modelled directly rather than by analogy:
 *
 *   transient   a few ms of band-passed noise    the edge, mostly heard
 *   tone        a decaying sinusoid near 250Hz   the body, mostly felt
 *   overdrive   a brief boost on the onset       gets the mass moving at all
 *
 * The overdrive is borrowed from haptic driver ICs — TI's DRV2605 applies a
 * short higher-voltage kick at onset to overcome the actuator's inertia, because
 * a mass on a spring takes time to reach amplitude and a click that arrives late
 * is not a click. A diaphragm has the same problem and the same fix.
 *
 * Its counterpart, **braking** (driving in antiphase to stop the mass dead), is
 * deliberately absent: it exists because a physical mass rings on after the
 * drive stops, and a synthesised envelope does not. Braking and "shorten the
 * decay" would be one control wearing two names.
 *
 * ## Where each default comes from
 *
 * | | | |
 * |---|---|---|
 * | `carrier` | 250Hz | the minimum of the vibrotactile threshold curve for glabrous skin; phone LRAs sit at 125-300Hz for the same reason |
 * | `decay` | 60ms | *above* the 25-30ms tap/vibration boundary on purpose — see below |
 * | `intensity` | 0.75 | applied as `intensity^(1/0.6)`, because subjective magnitude grows as amplitude^0.6 at 250Hz |
 * | `rate` | 4Hz | under the ~6.3Hz critical segregation rate, so pulses stay countable |
 * | `sharpness` | 0.5 | Core Haptics' own parameter, where it is the "clickiness" of a transient |
 *
 * **Why `decay` defaults above the boundary.** A burst stops being felt as a
 * discrete pulse at about 25-30ms, so under that is where a crisp tap lives. But
 * the Pacinian channel — the one 250Hz addresses — summates energy over roughly
 * a second, so its detection threshold *falls* as duration rises. A burst short
 * enough to read unambiguously as a tap is close to the least detectable thing
 * this transducer can produce. That is not something to optimise; it is a
 * trade-off to hand over, which is why the range crosses it and the readout says
 * which side you are on.
 */

/** Matches the threshold the shell uses for its own playing badge. */
export const SILENCE_BELOW = 0.02

/** The tap/vibration boundary, in seconds. Reported, never enforced. */
export const TAP_BOUNDARY_S = 0.025

/**
 * The Stevens exponent for vibrotactile magnitude at 250Hz on the finger.
 *
 * Perceived magnitude grows as amplitude^0.6, so a physically linear amplitude
 * control feels compressive — most of the change crowds into the bottom of the
 * travel. The graph raises `intensity` to `1 / STEVENS` to straighten it.
 *
 * Frequency-dependent: it is 0.95 at 60Hz. So this correction belongs to this
 * carrier rather than to vibration in general, and would be wrong if the carrier
 * were taken to the bottom of its range.
 */
export const STEVENS = 0.6

/**
 * Nine parameters, each with a default from the literature and a range round it.
 *
 * No layer owns any of them, because there is one layer, and nothing is derived
 * from anything else.
 */
export interface Controls {
  /** Hz. The felt frequency. */
  carrier: number
  /** Hz. How often the pulse retriggers. */
  rate: number
  /** 0..1, perceptually linearised in the graph. */
  intensity: number
  /** Seconds. Onset time: a click at the bottom, a swell at the top. */
  attack: number
  /** Seconds. The tone's decay — the control the first version did not have. */
  decay: number
  /** Envelope curve. Negative is a resonant decay, 0 linear, positive holds. */
  curve: number
  /** 1 is no boost. The onset kick, borrowed from LRA drivers. */
  overdrive: number
  /** 0..1. Level of the impulse half. */
  transient: number
  /** 0..1. Core Haptics' "clickiness" — the band the transient lives in. */
  sharpness: number
  /**
   * Sound at these settings with the phone held still.
   *
   * **On by default**, which is a change from every other page here. This one is
   * a test bench: the question it exists to answer is what a particular hand can
   * feel, and a vibration cannot be judged while shaking the thing producing it.
   * Turn it off and shake drives intensity, turning drives rate.
   */
  freeRun: boolean
}

/**
 * Read off the sliders after a hand found settings that worked.
 *
 * Three of these are nowhere near where the literature would have put them, and
 * they all point the same way:
 *
 *   decay    91ms     three times the 25-30ms tap boundary — well into "buzz"
 *   attack   14.5ms   a hundred and forty times the 0.1ms a click wants
 *   curve    +4       "held": the envelope sustains, then drops
 *
 * Which is what Pacinian temporal summation predicts and what the category
 * literature obscures. **This channel wants sustained energy, not a sharp
 * event.** Detection threshold falls as duration rises, up to about a second, so
 * a long slow-rising plateau beats the crisp tap that the 25ms boundary points
 * at. The research said where the percept changes name; it could not say which
 * side of that line a phone speaker can actually reach.
 *
 * `intensity` is the only one still at its original value, because it is the one
 * nobody had to search for.
 */
export const DEFAULT_CONTROLS: Controls = {
  carrier: 250,
  rate: 2.4,
  intensity: 0.75,
  attack: 0.0145,
  decay: 0.091,
  curve: 4,
  overdrive: 1,
  transient: 0.38,
  sharpness: 0.48,
  freeRun: true,
}

/**
 * The rate steps acceleration picks between in IMU mode.
 *
 * Whole numbers, so the pulse train is a rhythm rather than a sweep — the same
 * idea as `multibeat`, where moving changes the subdivision and never the tempo.
 * A continuous rate between them would be a glissando nobody asked for.
 */
export const RATE_STEPS = [1, 2, 3, 4] as const

/**
 * The musical octave rotation sweeps in IMU mode: 150Hz to 300Hz, in semitones.
 *
 * Quantised rather than continuous because a carrier that slides is a siren and
 * one that steps is an instrument. Twelve semitones from 150 lands exactly on
 * 300, which is why the octave is the one it is — and it sits inside the
 * 100-400Hz the slider allows, so the gesture covers the useful middle while the
 * slider can still reach the ends.
 */
export const CARRIER_ROOT = 150
export const CARRIER_SEMITONES = 12

/** Every range, matching the specs `ssp_thrum` declares. */
export const RANGES = {
  carrier: { min: 100, max: 400 },
  rate: { min: 0.5, max: 6 },
  intensity: { min: 0, max: 1 },
  attack: { min: 0.0001, max: 0.05 },
  decay: { min: 0.003, max: 0.5 },
  curve: { min: -8, max: 4 },
  overdrive: { min: 1, max: 6 },
  transient: { min: 0, max: 1 },
  sharpness: { min: 0, max: 1 },
} as const

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const held = (value: number, key: keyof typeof RANGES) =>
  clamp(value, RANGES[key].min, RANGES[key].max)

/**
 * What a retrigger rate is felt as.
 *
 * Only the first of these is now reachable — `rate` stops at 6Hz, below the
 * 6.3Hz segregation rate — and the rest are kept because the readout saying
 * `discrete` is the statement that matters: these pulses are meant to be
 * countable. If the range is ever opened up again, the names are already here.
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

/** Which side of the tap/vibration boundary a decay is on. */
export function decayReads(seconds: number): string {
  if (seconds < TAP_BOUNDARY_S * 0.6) return 'tap'
  if (seconds < TAP_BOUNDARY_S * 1.4) return 'edge'
  return 'buzz'
}

/** The envelope shape, named. */
export function curveReads(curve: number): string {
  if (curve < -2) return 'struck'
  if (curve < -0.5) return 'soft'
  if (curve <= 0.5) return 'linear'
  return 'held'
}

/**
 * The amplitude an intensity setting actually produces.
 *
 * Shown on the page as well as applied, because the gap is wide enough to look
 * like a bug if you only see one of the two numbers: at 0.5 the amplitude is
 * 0.31.
 */
export function amplitudeOf(intensity: number): number {
  return clamp(intensity, 0, 1) ** (1 / STEVENS)
}

export interface Thrum {
  carrier: number
  rate: number
  intensity: number
  attack: number
  decay: number
  curve: number
  overdrive: number
  transient: number
  sharpness: number
  /** Drives the shell's playing badge. */
  level: number
  /** Three traces for the plotter. */
  drive: readonly [intensity: number, raw: number, filtered: number]
}

export function thrumFrom(
  motion: Motion,
  sensitivity = 0.5,
  controls: Controls = DEFAULT_CONTROLS,
): Thrum {
  // Sensitivity, AirKit style, on the two movement spans and nothing else. The
  // factor is `0.5 / sens` rather than `1 / sens` for the reason every mapping
  // here says: the bounds below are the effective ones, so AirKit's 0.5 default
  // has to be the neutral point.
  const gain = 0.5 / Math.max(0.05, sensitivity)
  const mass = Math.min(1, motion.shake * gain)
  const spin = Math.min(1, motion.turn * gain)

  // One rule, and it is the whole of the mode: **in free run every slider is
  // exact; otherwise two gestures take over, and only two.** Everything else
  // stays where the slider put it, because a parameter being judged must not
  // also be moving.
  //
  // Acceleration picks the rate, rotation picks the carrier. Nothing is mapped
  // to the envelope at all — the shape is the thing you tuned, so a gesture
  // moving it would undo the tuning every time you played.

  // Acceleration steps the rate between whole numbers, `multibeat` style: round
  // then clip, which is the original p-files' own
  // `lincurve(...).round.clip(0, n)`. A positive curve keeps the low rates
  // across most of the travel, so a firm shake is what reaches 4Hz.
  const step = Math.min(
    Math.max(Math.round(lincurve(mass, 0, 1, 0, RATE_STEPS.length - 1, 1)), 0),
    RATE_STEPS.length - 1,
  )
  const rate = controls.freeRun ? held(controls.rate, 'rate') : (RATE_STEPS[step] ?? 1)

  // Movement decides whether, the slider decides how loud. Acceleration is
  // already doing a job here, so the alternative was leaving the page droning on
  // a desk — which is the one behaviour every other page in this project is
  // careful to avoid.
  const gate = controls.freeRun ? 1 : Math.min(1, Math.max(mass, spin) * 2.5)
  const intensity = held(controls.intensity, 'intensity') * gate

  // Roll sweeps a chromatic octave, 150Hz to 300Hz. Quantised, because a carrier
  // that slides is a siren and one that steps is an instrument.
  const semitone = Math.round(lincurve(motion.roll, -1, 1, 0, CARRIER_SEMITONES, 0))

  return {
    carrier: held(
      controls.freeRun ? controls.carrier : CARRIER_ROOT * 2 ** (semitone / 12),
      'carrier',
    ),
    rate,
    intensity,
    attack: held(controls.attack, 'attack'),
    decay: held(controls.decay, 'decay'),
    curve: held(controls.curve, 'curve'),
    overdrive: held(controls.overdrive, 'overdrive'),
    transient: held(controls.transient, 'transient'),
    sharpness: held(controls.sharpness, 'sharpness'),
    // Pinned open in free run: the page has to sound while the phone sits still.
    level: controls.freeRun ? 1 : Math.max(mass, spin),
    drive: [intensity, motion.shakeRaw, motion.shake],
  }
}

export function mapThrum(
  motion: Motion,
  sensitivity = 0.5,
  controls: Controls = DEFAULT_CONTROLS,
): Mapped {
  const now = thrumFrom(motion, sensitivity, controls)

  return {
    // No clock on this page, so nothing reads `dur`. The shell's type wants it.
    dur: 0.25,
    level: now.level,
    voice: {},
    held: {
      carrier: now.carrier,
      rate: now.rate,
      intensity: now.intensity,
      attack: now.attack,
      decay: now.decay,
      curve: now.curve,
      overdrive: now.overdrive,
      transient: now.transient,
      sharpness: now.sharpness,
    },
    traces: [],
    values: [
      ['carrier', `${now.carrier.toFixed(0)}Hz`],
      ['rate', `${now.rate.toFixed(1)}Hz ${regimeOf(now.rate)}`],
      // The semitone above the 150Hz root, so a quantised carrier reads as a
      // step rather than as a number that refuses to land where you put it.
      ['note', `+${Math.round(12 * Math.log2(now.carrier / CARRIER_ROOT))}`],
      ['decay', `${(now.decay * 1000).toFixed(0)}ms ${decayReads(now.decay)}`],
      ['attack', `${(now.attack * 1000).toFixed(2)}ms`],
      ['curve', `${now.curve.toFixed(1)} ${curveReads(now.curve)}`],
      ['overdrive', `x${now.overdrive.toFixed(1)}`],
      // `off` rather than `0.00`, matching the slider's own label. Two places
      // naming the same state differently is a small thing that costs a reader
      // a glance every time.
      ['transient', now.transient === 0 ? 'off' : now.transient.toFixed(2)],
      ['sharpness', now.sharpness.toFixed(2)],
      ['intensity', `${now.intensity.toFixed(2)} amp ${amplitudeOf(now.intensity).toFixed(2)}`],
    ],
  }
}

/**
 * Intensity against the raw and the filtered shake.
 *
 * `[accelMass, accelMassFiltered]` is the commonest `~plot` body in AirKit's
 * personalities, because the pair is the diagnostic: the raw trace is what the
 * hand did and the filtered one is what the instrument heard, so the distance
 * between them is the envelope follower made visible. Intensity on top is what
 * actually reached the synth.
 */
export function plotOf(
  motion: Motion,
  sensitivity = 0.5,
  controls: Controls = DEFAULT_CONTROLS,
): number[] {
  return [...thrumFrom(motion, sensitivity, controls).drive]
}

/** The series in colour order: yellow, magenta, cyan. */
export const PLOT_LABELS = ['intensity', 'shake raw', 'shake filtered']
