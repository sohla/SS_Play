#!/usr/bin/env node
// Infer a parameter contract for the vendored Sonic Pi SynthDefs.
//
//   npm run infer-contracts            report coverage
//   npm run infer-contracts -- --write  emit <name>.contract.json
//
// These defs carry no metadata, so they reach the browser with names and
// defaults but no ranges and therefore no controls. The names are extremely
// regular, though — 56% of all parameters are Sonic Pi's `x_slide`,
// `x_slide_shape`, `x_slide_curve` smoothing triplets — so a rule table over
// the convention recovers most of them without guessing per-parameter.
//
// What is produced is **inferred**, not declared, and says so: every emitted
// file carries `"source": "inferred"`. An authored contract states intent — the
// range someone chose, and why. This states a convention. The UI distinguishes
// them, because a range nobody chose should not look like one somebody did.
//
// Anything the rules do not recognise gets **no spec**. It is listed as
// `unknown` and draws no control. Inventing a range for a parameter nobody
// understands is exactly the failure this whole scheme exists to avoid.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSynthDefFile } from '@ss/engine/scsyndef'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const corpus = join(require.resolve('supersonic-scsynth-synthdefs/package.json'), '..', 'synthdefs')
const write = process.argv.includes('--write')

const spec = (min, max, warp, step, units = '') => ({ min, max, warp, step, units })

/**
 * Rules in order; the first match wins.
 *
 * Exact names before suffixes, so `cutoff` is not caught by a generic rule.
 * Each carries the reasoning, because the numbers are a reading of Sonic Pi's
 * conventions and the next person should be able to check that reading.
 */
const RULES = [
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

function inferSpec(name) {
  for (const [pattern, shape, why] of RULES) {
    if (pattern.test(name)) return { ...shape, why }
  }
  return null
}

const files = readdirSync(corpus).filter((name) => name.endsWith('.scsyndef')).sort()

let matched = 0
let unmatched = 0
const unmatchedNames = new Map()
let written = 0
const skipped = []

for (const file of files) {
  let def
  try {
    def = parseSynthDefFile(new Uint8Array(readFileSync(join(corpus, file)))).defs[0]
  } catch (error) {
    // The corrupt one. Already pinned by the parser tests; nothing to emit.
    skipped.push(`${file}: ${error.message.split('\n')[0]}`)
    continue
  }

  const specs = []
  const supplied = []
  const unknown = []

  for (const param of def.params) {
    // Buses are set by whatever routes the synth, not by a slider.
    if (/^(in_bus|out_bus|out|bus|input)$/.test(param.name)) {
      supplied.push({ name: param.name, default: param.default })
      matched++
      continue
    }

    const inferred = inferSpec(param.name)
    if (!inferred) {
      unknown.push({ name: param.name, default: param.default })
      unmatched++
      unmatchedNames.set(param.name, (unmatchedNames.get(param.name) ?? 0) + 1)
      continue
    }

    matched++
    specs.push({
      name: param.name,
      min: inferred.min,
      max: inferred.max,
      warp: inferred.warp,
      step: inferred.step,
      // Clamp into the inferred range: several defs declare a default outside
      // it (sustain: -1 meaning "hold"), and a control whose initial position
      // is off its own scale is worse than one that starts at the edge.
      default: Math.min(Math.max(param.default, inferred.min), inferred.max),
      units: inferred.units,
      ...(param.default < inferred.min || param.default > inferred.max
        ? { declaredDefault: param.default }
        : {}),
    })
  }

  if (write) {
    writeFileSync(
      join(repoRoot, 'apps/playground/public/vendor/supersonic/synthdefs', `${def.name}.contract.json`),
      `${JSON.stringify({ source: 'inferred', specs, frozen: [], supplied, unknown }, null, 2)}\n`,
    )
    written++
  }
}

const total = matched + unmatched
console.log(`defs:       ${files.length - skipped.length} parsed, ${skipped.length} skipped`)
console.log(`parameters: ${total}`)
console.log(`matched:    ${matched} (${((matched / total) * 100).toFixed(1)}%)`)
console.log(`unmatched:  ${unmatched} (${((unmatched / total) * 100).toFixed(1)}%)`)

if (unmatchedNames.size > 0) {
  console.log(`\ndistinct unmatched names: ${unmatchedNames.size}`)
  console.log('most common:')
  for (const [name, count] of [...unmatchedNames].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${name.padEnd(28)} ${count}`)
  }
}

for (const note of skipped) console.log(`\nskipped ${note}`)
if (write) console.log(`\nwrote ${written} contract files`)
