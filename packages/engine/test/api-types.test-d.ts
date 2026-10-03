import { describe, expectTypeOf, it } from 'vitest'
import type {
  AddAction,
  EngineState,
  OscArg,
  OscMessage,
  ScsynthOptions,
  SuperSonic,
  SuperSonicEventMap,
  SuperSonicOptions,
  TransportMode,
} from 'supersonic-scsynth'

// These assert the type-level facts packages/engine is built on. A library bump
// that moves any of them becomes a compile error here rather than a runtime
// mystery somewhere in an app.

type Sonic = InstanceType<typeof SuperSonic>

describe('OSC argument typing', () => {
  it('accepts the float wrapper that ctl() relies on', () => {
    // Bare integers encode as int32, but every SynthDef control bus is a float,
    // so ctl() wraps bare numbers. That wrapper has to stay assignable.
    expectTypeOf<{ type: 'float'; value: number }>().toExtend<OscArg>()
    expectTypeOf<{ type: 'int'; value: number }>().toExtend<OscArg>()
  })

  it('accepts bare primitives', () => {
    expectTypeOf<number>().toExtend<OscArg>()
    expectTypeOf<string>().toExtend<OscArg>()
    expectTypeOf<boolean>().toExtend<OscArg>()
    expectTypeOf<Uint8Array>().toExtend<OscArg>()
  })

  it('types send as variadic and synchronous', () => {
    expectTypeOf<Sonic['send']>().parameter(0).toExtend<string>()
    expectTypeOf<Sonic['send']>().returns.toBeVoid()
  })

  it('puts the address first in a decoded message', () => {
    expectTypeOf<OscMessage[0]>().toBeString()
  })
})

describe('event subscription', () => {
  it('returns an unsubscribe function from on and once', () => {
    // The Dispatcher's disposer bag depends on this, and on off() being
    // asymmetric — it returns the instance, not an unsubscribe.
    expectTypeOf<Sonic['on']>().returns.toEqualTypeOf<() => void>()
    expectTypeOf<Sonic['once']>().returns.toEqualTypeOf<() => void>()
  })

  it('types the in event as a decoded message', () => {
    expectTypeOf<SuperSonicEventMap['in']>().toEqualTypeOf<(msg: OscMessage) => void>()
  })

  it('carries engine state transitions on statechange', () => {
    expectTypeOf<SuperSonicEventMap['statechange']>()
      .parameter(0)
      .toExtend<{ state: EngineState; previous: EngineState }>()
  })
})

describe('audio capture', () => {
  it('returns Float32Array channels, right nullable', () => {
    // This is the audio-assertion mechanism for the e2e suite.
    type Capture = ReturnType<Sonic['stopCapture']>
    expectTypeOf<Capture['left']>().toEqualTypeOf<Float32Array>()
    expectTypeOf<Capture['right']>().toEqualTypeOf<Float32Array | null>()
    expectTypeOf<Capture['frames']>().toBeNumber()
    expectTypeOf<Capture['sampleRate']>().toBeNumber()
  })
})

describe('construction', () => {
  it('exposes every URL key resolveEngineUrls sets explicitly', () => {
    expectTypeOf<SuperSonicOptions>().toHaveProperty('baseURL')
    expectTypeOf<SuperSonicOptions>().toHaveProperty('coreBaseURL')
    expectTypeOf<SuperSonicOptions>().toHaveProperty('workerBaseURL')
    expectTypeOf<SuperSonicOptions>().toHaveProperty('wasmBaseURL')
    expectTypeOf<SuperSonicOptions>().toHaveProperty('wasmUrl')
    expectTypeOf<SuperSonicOptions>().toHaveProperty('workletUrl')
    expectTypeOf<SuperSonicOptions>().toHaveProperty('synthdefBaseURL')
    expectTypeOf<SuperSonicOptions>().toHaveProperty('sampleBaseURL')
  })

  it('keeps mode optional so boot() can leave negotiation upstream', () => {
    // 0.88 derives the mode from crossOriginIsolated when mode is absent.
    // Forcing it is the only way to reach the throwing capability probe.
    expectTypeOf<SuperSonicOptions['mode']>().toEqualTypeOf<TransportMode | undefined>()
  })

  it('lets maxNodes be pinned explicitly', () => {
    // Default is 1024. A def missing doneAction exhausts that in seconds, so
    // the value is ours to set and to see.
    expectTypeOf<ScsynthOptions>().toHaveProperty('maxNodes')
  })
})

describe('asset loading', () => {
  it('reports per-name results instead of rejecting', () => {
    // loadSynthDefsChecked exists because this resolves successfully even when
    // individual defs fail. Nothing throws; you have to read the map.
    expectTypeOf<Sonic['loadSynthDefs']>().returns.resolves.toEqualTypeOf<
      Record<string, { success: boolean; error?: string }>
    >()
  })

  it('requires a caller-supplied bufnum', () => {
    expectTypeOf<Parameters<Sonic['loadSample']>[0]>().toEqualTypeOf<number>()
  })
})

describe('node identity', () => {
  it('allocates node ids upstream', () => {
    // BufAllocator exists for buffers; node ids do not need one.
    expectTypeOf<Sonic['nextNodeId']>().returns.toBeNumber()
  })

  it('constrains add actions', () => {
    expectTypeOf<AddAction>().toEqualTypeOf<0 | 1 | 2 | 3 | 4>()
  })
})
