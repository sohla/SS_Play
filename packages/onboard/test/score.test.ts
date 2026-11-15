import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolve, synthdefsOf, type Script } from '../src/cues.ts'
import { instruments, order, scripts } from '../src/score.ts'

/** Every script in the score, fixes included, by name. */
const all = Object.entries(scripts).flatMap(([name, value]): [string, Script][] =>
  Array.isArray(value) ? [[name, value as Script]] : Object.entries(value).map(([fix, script]) => [`fixes.${fix}`, script as Script]),
)

describe('the score', () => {
  it('plays only instruments it defines', () => {
    for (const [name, script] of all) {
      for (const cue of script) if ('play' in cue) expect(instruments, `${name} plays "${cue.play}"`).toHaveProperty([cue.play])
    }
  })

  it('uses SynthDefs that exist', () => {
    const library = join(dirname(createRequire(import.meta.url).resolve('supersonic-scsynth-synthdefs/package.json')), 'synthdefs')
    for (const def of synthdefsOf(instruments)) {
      const where = def.startsWith('ssp_') ? join(import.meta.dirname, '../../../sidecar/dist') : library
      expect(existsSync(join(where, `${def}.scsyndef`)), def).toBe(true)
    }
  })

  it('keeps the voice line free of instruments, which the microphone would take for the voice', () => {
    expect(scripts.voiceLine.every((cue) => 'say' in cue)).toBe(true)
  })

  it('orders steps that can be walked', () => {
    for (const steps of [order.A, order.B]) {
      expect(steps[0]).toBe('start')
      expect(steps.at(-1)).toBe('ready')
      expect(new Set(steps).size).toBe(steps.length)
    }
    const a = (step: (typeof order.A)[number]) => order.A.indexOf(step)
    expect(a('mic')).toBeLessThan(a('quiet'))
    expect(a('quiet')).toBeLessThan(a('tone'))
    expect(a('mic')).toBeLessThan(a('voice'))
    for (const needsMic of ['mic', 'quiet', 'tone', 'voice'] as const) expect(order.B).not.toContain(needsMic)
  })
})

describe('resolve', () => {
  it('picks the phone’s words, falls back to other, drops empty lines, and names the group', () => {
    const script: Script = [
      { say: 'Hello, {group}.', as: 'heading' },
      { say: { ios: 'iPhone', other: 'Phone' }, as: 'say' },
      { say: { android: '', other: 'Not on Android' }, as: 'item' },
      { rest: 1 },
    ]
    expect(resolve(script, 'ios', 'Circle')).toEqual([
      { say: 'Hello, Circle.', as: 'heading' },
      { say: 'iPhone', as: 'say' },
      { say: 'Not on Android', as: 'item' },
      { rest: 1 },
    ])
    expect(resolve(script, 'android', 'Square').map((cue) => ('say' in cue ? cue.say : 'rest'))).toEqual([
      'Hello, Square.',
      'Phone',
      'rest',
    ])
  })
})
