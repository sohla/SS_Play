/**
 * Infer a parameter contract from Sonic Pi's naming conventions.
 *
 * The 131 vendored defs carry no metadata, so they reach the browser with names
 * and defaults but no ranges, and therefore no controls. The names are
 * extremely regular though — 56% of all parameters are the `x_slide`,
 * `x_slide_shape`, `x_slide_curve` smoothing triplets — so a rule table over
 * the convention recovers 92% of them without guessing per parameter.
 *
 * What this produces is **inferred**, not declared, and every contract says so.
 * An authored contract states intent: the range someone chose, and why. This
 * states a convention. The UI keeps them visibly apart, because a range nobody
 * chose should not look like one somebody did.
 *
 * Anything the rules do not recognise gets **no spec**: it lands in `unknown`
 * and draws no control. Inventing a range for a parameter nobody understands is
 * the failure this whole scheme exists to avoid.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SynthDefParam } from '@ss/engine/scsyndef'

/**
 * Hand-supplied ranges for parameters the conventions do not cover.
 *
 * A separate JSON file rather than entries in the rule table below, so adding
 * one is an edit to data and not to code.
 *
 * Keys are either a bare parameter name or `defName.param`. The per-def form
 * exists because some names genuinely mean different things in different defs:
 * `depth` is milliseconds in fx_flanger, a modulation index in fm, and a 0-1
 * amount in fx_tremolo. A single global range for those would be wrong
 * everywhere except by accident.
 */
function loadOverrides(): Map<string, ReturnType<typeof spec>> {
  const out = new Map<string, ReturnType<typeof spec>>()
  try {
    const path = fileURLToPath(new URL('../../../param-ranges.json', import.meta.url))
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    for (const [name, value] of Object.entries(raw)) {
      if (name.startsWith('//') || !Array.isArray(value)) continue
      const [min, max, warp, step, units] = value as [number, number, string, number, string?]
      out.set(name, spec(min, max, warp, step, units ?? ''))
    }
  } catch {
    // Absent or unreadable is fine: the pattern rules still apply.
  }
  return out
}

export interface InferredSpec {
  name: string
  min: number
  max: number
  warp: string
  step: number
  default: number
  units: string
  /** Present when the def's own default sits outside the inferred range. */
  declaredDefault?: number
}

export interface InferredContract {
  source: 'inferred'
  specs: InferredSpec[]
  frozen: never[]
  supplied: { name: string; default: number }[]
  /** Parameters the rules do not recognise. Shown as values, with no control. */
  unknown: { name: string; default: number }[]
}

/** Buses are set by whatever routes the synth, not by a slider. */
const BUS = /^(in_bus|out_bus|out|bus|input)$/

const spec = (min: number, max: number, warp: string, step: number, units = '') => ({ min, max, warp, step, units })

/**
 * Rules in order; the first match wins.
 *
 * Exact names before suffixes, so `cutoff` is not caught by a generic rule.
 * Each carries the reasoning, because the numbers are a reading of Sonic Pi's
 * conventions and the next person should be able to check that reading.
 */
const RULES: [RegExp, ReturnType<typeof spec>, string][] = [
  // --- buses: integers, and the range is the engine's, not a guess ----------
  [/^(in|out)_bus$/, spec(0, 1023, 'linear', 1), 'audio bus index; 0.88 allocates 1024'],

  // --- the slide triplets, 56% of everything -------------------------------
  [
    /_slide$/,
    spec(0, 4, 'linear', 0, 's'),
    'control-smoothing time in seconds; must include 0, which rules out an exponential warp',
  ],
  [
    /_slide_shape$/,
    spec(0, 7, 'linear', 1),
    "Env shape number: 0 step, 1 linear, 2 exponential, 3 sine, 4 welch, 5 curve, 6 squared, 7 cubed",
  ],
  [/_slide_curve$/, spec(-10, 10, 'linear', 0), 'curve amount, used when the shape is 5'],

  // --- envelope ------------------------------------------------------------
  [
    /^(attack|decay|sustain|release)$/,
    spec(0, 8, 'linear', 0, 's'),
    'envelope segment in seconds; sustain defaults to -1 in some defs, meaning "hold"',
  ],
  [
    /_level$/,
    spec(-1, 1, 'linear', 0),
    'envelope level; decay_level defaults to -1, which Sonic Pi reads as "use sustain_level"',
  ],
  [/^env_curve$/, spec(1, 7, 'linear', 1), 'Sonic Pi envelope curve type'],

  // --- level and position --------------------------------------------------
  [/^amp$/, spec(0, 1, 'amp', 0), "SuperCollider's own amplitude spec"],
  [/^pre_amp$/, spec(0, 10, 'amp', 0), 'input gain before an effect; defaults range to 10'],
  [/^pan$/, spec(-1, 1, 'linear', 0), 'stereo position'],
  [/^(mix|pre_mix)$/, spec(0, 1, 'linear', 0), 'dry/wet'],

  // --- pitch and filter ----------------------------------------------------
  [/^note$/, spec(0, 127, 'linear', 0), 'MIDI note; fractional values are allowed'],
  [
    /^(cutoff|cutoff_min|cutoff_max|hpf|lpf|hpf_min|lpf_max)$/,
    spec(0, 130, 'linear', 0),
    'a MIDI note, not Hz — inferred from defaults of 83/100/102/110, which would be nonsensical as a filter frequency in Hz',
  ],
  [/^(res|hpf_res|lpf_res)$/, spec(0, 1, 'linear', 0), 'Sonic Pi resonance, 0 to 1'],

  // --- oscillator shape ----------------------------------------------------
  [/^(wave|mod_wave)$/, spec(0, 3, 'linear', 1), 'waveform selector: saw, pulse, triangle, sine'],
  [
    /^(pulse_width|mod_pulse_width|.*_pulse_width)$/,
    spec(0.001, 0.999, 'linear', 0),
    'duty cycle; the endpoints are degenerate, so the range stops short of them',
  ],
  [/^detune\d*$/, spec(-12, 12, 'linear', 0, 'st'), 'detune in semitones'],
  [/^mod_range$/, spec(0, 24, 'linear', 0, 'st'), 'modulation depth in semitones'],
  [/^freq$/, spec(20, 20000, 'exponential', 0, 'Hz'), "SuperCollider's own frequency spec"],
  [/^click$/, spec(0, 1, 'linear', 0, 's'), 'attack transient length'],

  // --- switches ------------------------------------------------------------
  [/_bypass$/, spec(0, 1, 'linear', 1), 'a switch'],
  [/^(invert_wave|mod_invert_wave|.*_invert_wave)$/, spec(0, 1, 'linear', 1), 'a switch'],

  // Last: catches decay_curve and friends, after the specific curve rules
  // above have had their chance.
  [/_curve$/, spec(-10, 10, 'linear', 0), 'envelope curve amount'],
]


const OVERRIDES = loadOverrides()

function inferSpec(name: string, defName: string) {
  // Per-def first, then the bare name, then the patterns.
  const scoped = OVERRIDES.get(`${defName.replace(/^sonic-pi-/, '')}.${name}`)
  if (scoped) return scoped

  const override = OVERRIDES.get(name)
  if (override) return override

  for (const [pattern, shape] of RULES) {
    if (pattern.test(name)) return shape
  }
  return null
}

export function inferContract(params: SynthDefParam[], defName = ''): InferredContract {
  const specs: InferredSpec[] = []
  const supplied: { name: string; default: number }[] = []
  const unknown: { name: string; default: number }[] = []

  for (const param of params) {
    if (BUS.test(param.name)) {
      supplied.push({ name: param.name, default: param.default })
      continue
    }

    const inferred = inferSpec(param.name, defName)
    if (!inferred) {
      unknown.push({ name: param.name, default: param.default })
      continue
    }

    const clamped = Math.min(Math.max(param.default, inferred.min), inferred.max)
    specs.push({
      name: param.name,
      min: inferred.min,
      max: inferred.max,
      warp: inferred.warp,
      step: inferred.step,
      // Clamped because several defs declare a default outside the inferred
      // range — `sustain: -1` means "hold" — and a control that starts off its
      // own scale is worse than one that starts at the edge.
      default: clamped,
      units: inferred.units,
      ...(clamped === param.default ? {} : { declaredDefault: param.default }),
    })
  }

  return { source: 'inferred', specs, frozen: [], supplied, unknown }
}
