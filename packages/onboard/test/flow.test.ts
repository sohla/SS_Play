import { describe, expect, it } from 'vitest'
import {
  needsFacilitator,
  noiseDb,
  progress,
  reduce,
  startFlow,
  tonePassed,
  type Flow,
  type FlowEvent,
} from '../src/flow.ts'
import { GROUPS, groupFor } from '../src/groups.ts'

const run = (flow: Flow, ...events: FlowEvent[]) => events.reduce(reduce, flow)
const next: FlowEvent = { type: 'next' }
const pass: FlowEvent = { type: 'pass' }

describe('Version A', () => {
  it('walks seven steps to the ready screen when everything passes', () => {
    const steps: string[] = []
    let flow = startFlow('A')
    const script: FlowEvent[] = [next, next, next, next, pass, pass, pass]
    for (const event of script) {
      steps.push(`${flow.step} ${progress(flow).at}/${progress(flow).of}`)
      flow = reduce(flow, event)
    }
    expect(steps).toEqual([
      'start 1/7',
      'speaker 2/7',
      'mic 3/7',
      'quiet 4/7',
      'tone 5/7',
      'voice 6/7',
      'motion 7/7',
    ])
    expect(flow.step).toBe('ready')
    expect(flow.results).toEqual({ sound: 'passed', voice: 'passed', motion: 'passed' })
  })

  it('carries on as Version B from its tone check when the microphone is refused', () => {
    const flow = run(startFlow('A'), next, next, { type: 'micRefused' })
    expect(flow.step).toBe('toneAsk')
    expect(flow.asking).toBe(true)
    expect(progress(flow)).toEqual({ at: 4, of: 6 })
    const done = run(flow, pass, pass, pass)
    expect(done.step).toBe('ready')
  })

  it('ignores a refusal anywhere but the microphone step', () => {
    const flow = run(startFlow('A'), next, { type: 'micRefused' })
    expect(flow.step).toBe('speaker')
  })
})

describe('Version B', () => {
  it('walks its steps without ever reaching the microphone', () => {
    let flow = startFlow('B')
    const seen: string[] = []
    for (const event of [next, next, pass, pass, pass]) {
      seen.push(flow.step)
      flow = reduce(flow, event)
    }
    expect(seen).toEqual(['start', 'speaker', 'toneAsk', 'voiceAsk', 'motion'])
    expect(seen).not.toContain('mic')
    expect(flow.step).toBe('ready')
  })
})

describe('failures and skips', () => {
  it('offers a facilitator after two failed tries, and resets on the next step', () => {
    let flow = run(startFlow('B'), next, next)
    flow = reduce(flow, { type: 'fail' })
    expect(needsFacilitator(flow)).toBe(false)
    flow = reduce(flow, { type: 'fail' })
    expect(needsFacilitator(flow)).toBe(true)
    flow = reduce(flow, { type: 'skip' })
    expect(flow.step).toBe('voiceAsk')
    expect(needsFacilitator(flow)).toBe(false)
  })

  it('reports a skipped step as skipped on the ready screen', () => {
    const flow = run(startFlow('B'), next, next, { type: 'skip' }, pass, { type: 'skip' })
    expect(flow.results).toEqual({ sound: 'skipped', voice: 'passed', motion: 'skipped' })
  })

  it('never dead-ends: every step before ready can be left', () => {
    for (const version of ['A', 'B'] as const) {
      let flow = startFlow(version)
      for (let n = 0; n < 12 && flow.step !== 'ready'; n++) {
        flow = reduce(flow, flow.step === 'start' || flow.step === 'speaker' || flow.step === 'mic' || flow.step === 'quiet' ? next : { type: 'skip' })
      }
      expect(flow.step).toBe('ready')
    }
  })
})

describe('levels', () => {
  it('takes the room as a median, so one cough does not raise it', () => {
    expect(noiseDb([-60, -61, -59, -20, -60])).toBe(-60)
  })

  it('passes the tone on two pulses in a row over the margin, not one', () => {
    expect(tonePassed([-50, -40], -60, 15)).toBe(false)
    expect(tonePassed([-44, -40], -60, 15)).toBe(true)
    expect(tonePassed([-40], -60, 15)).toBe(false)
    expect(tonePassed([-40, -50, -40], -60, 15)).toBe(false)
  })
})

describe('the group', () => {
  it('is kept for the session, so a reload does not move anyone', () => {
    const kept = new Map<string, string>()
    const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) }
    const first = groupFor(store, () => 0.9)
    expect(first.name).toBe('Triangle')
    expect(groupFor(store, () => 0.1)).toBe(first)
  })

  it('still picks one when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(GROUPS).toContain(groupFor(broken, () => 0.5))
    expect(groupFor(null, () => 0).name).toBe('Circle')
  })
})
