/**
 * The onboarding test's steps, as plain data and a reducer.
 *
 * Two versions, from `docs/Phone onboarding test spec.md`:
 *
 * - **A** opens the microphone and *measures* the phone's own tone and voice.
 * - **B** never opens it, and asks the person.
 *
 * A refused microphone in A drops into B's checks from the tone step on, so the
 * sequence a person walks is decided by what happens, not only by the version.
 * The order itself is in `score.ts`. Kept free of React and audio so every path — refusals, retries, skips — can
 * be tested.
 */

import { order } from './score.ts'

export type Version = 'A' | 'B'

export type StepId =
  | 'start'
  | 'speaker'
  | 'volume'
  | 'mic'
  | 'quiet'
  | 'tone'
  | 'toneAsk'
  | 'voice'
  | 'voiceAsk'
  | 'motion'
  | 'ready'

/** Measured with the microphone: Version A, until it is refused. */
const MEASURED = order.A
/** Asked of the person: Version B, and A after a refusal. */
const ASKED = order.B

/** What A has done by the time its microphone is refused. */
const BEFORE_REFUSAL = MEASURED.slice(0, MEASURED.indexOf('mic') + 1)
/** Where a refusal carries on: B's first step not already done. */
const AFTER_REFUSAL = ASKED.find((step) => !BEFORE_REFUSAL.includes(step)) ?? 'ready'

export type Outcome = 'passed' | 'skipped'

export interface Results {
  sound: Outcome | null
  voice: Outcome | null
  motion: Outcome | null
}

export interface Flow {
  version: Version
  /** Whether this run is measuring or asking — A switches to asking on a refusal. */
  asking: boolean
  step: StepId
  /** Failed tries on the current step. Two or more shows "Ask a facilitator". */
  tries: number
  results: Results
}

export type FlowEvent =
  | { type: 'next' }
  | { type: 'micRefused' }
  | { type: 'pass' }
  | { type: 'fail' }
  | { type: 'skip' }

export function startFlow(version: Version): Flow {
  return {
    version,
    asking: version === 'B',
    step: 'start',
    tries: 0,
    results: { sound: null, voice: null, motion: null },
  }
}

/** The steps this run will walk, in order. */
export function sequence(flow: Pick<Flow, 'asking'>): readonly StepId[] {
  return flow.asking ? ASKED : MEASURED
}

/**
 * "Step n of m", as the person sees it: the ready screen is not a step. After
 * A's refusal the count follows the steps actually left, so it never goes
 * backwards and never promises steps that will not come.
 */
export function progress(flow: Flow): { at: number; of: number } {
  const steps: readonly StepId[] = sequence(flow).filter((step) => step !== 'ready')
  const at = steps.indexOf(flow.step)
  if (flow.version === 'A' && flow.asking) {
    // What A did up to the refused microphone, then B's tail.
    const before = BEFORE_REFUSAL.length
    const tail: readonly StepId[] = ASKED.slice(ASKED.indexOf(AFTER_REFUSAL)).filter((step) => step !== 'ready')
    return { at: before + tail.indexOf(flow.step) + 1, of: before + tail.length }
  }
  return { at: at + 1, of: steps.length }
}

/** Which result a step settles, if any. */
export function settles(step: StepId): keyof Results | null {
  if (step === 'tone' || step === 'toneAsk') return 'sound'
  if (step === 'voice' || step === 'voiceAsk') return 'voice'
  if (step === 'motion') return 'motion'
  return null
}

function advance(flow: Flow, results = flow.results): Flow {
  const steps = sequence(flow)
  const next = steps[steps.indexOf(flow.step) + 1] ?? 'ready'
  return { ...flow, step: next, tries: 0, results }
}

export function reduce(flow: Flow, event: FlowEvent): Flow {
  if (flow.step === 'ready') return flow

  switch (event.type) {
    case 'next':
      return advance(flow)

    case 'micRefused':
      // Only meaningful on A's microphone step: carry on as B, from where A got to.
      if (flow.step !== 'mic') return flow
      return { ...flow, asking: true, step: AFTER_REFUSAL, tries: 0 }

    case 'pass':
    case 'skip': {
      const key = settles(flow.step)
      const outcome: Outcome = event.type === 'pass' ? 'passed' : 'skipped'
      return advance(flow, key ? { ...flow.results, [key]: outcome } : flow.results)
    }

    case 'fail':
      return { ...flow, tries: flow.tries + 1 }
  }
}

/** After this many failures, the step offers a facilitator and a way on. */
export const FACILITATOR_AFTER = 2

export function needsFacilitator(flow: Flow): boolean {
  return flow.tries >= FACILITATOR_AFTER
}

// ---------------------------------------------------------------- levels

/** A level as dB, with silence held at a floor rather than −∞. */
export function toDb(level: number, floor = -100): number {
  return level > 0 ? Math.max(floor, 20 * Math.log10(level)) : floor
}

/** The room's noise: the median of two seconds of readings, robust to one cough. */
export function noiseDb(readingsDb: readonly number[]): number {
  if (readingsDb.length === 0) return -100
  const sorted = [...readingsDb].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * Version A's pass rule: the last `need` tone pulses each peaked at least
 * `marginDb` above the room. Two in a row, so one loud knock is not a pass.
 */
export function tonePassed(
  pulsePeaksDb: readonly number[],
  roomDb: number,
  marginDb: number,
  need = 2,
): boolean {
  if (pulsePeaksDb.length < need) return false
  return pulsePeaksDb.slice(-need).every((peak) => peak - roomDb >= marginDb)
}
