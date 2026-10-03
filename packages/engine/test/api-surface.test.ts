import { describe, expect, it } from 'vitest'
import { OscChannel, SuperSonic, osc } from 'supersonic-scsynth'

// SuperSonic subclasses the Clockwork host, so most of the API lives one level
// up the prototype chain. Anything that only inspects SuperSonic.prototype sees
// 16 of the ~65 members and silently concludes the rest were removed.
function walkChain(ctor: abstract new (...args: never[]) => unknown) {
  const methods = new Set<string>()
  const accessors = new Set<string>()
  let proto: object | null = ctor.prototype as object

  while (proto && proto !== Object.prototype) {
    for (const [name, desc] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (name === 'constructor') continue
      if (desc.get || desc.set) accessors.add(name)
      else if (typeof desc.value === 'function') methods.add(name)
    }
    proto = Object.getPrototypeOf(proto) as object | null
  }

  return {
    methods: [...methods].sort(),
    accessors: [...accessors].sort(),
  }
}

const surface = walkChain(SuperSonic)

describe('module exports', () => {
  it('exports the three documented entry points', () => {
    expect(typeof SuperSonic).toBe('function')
    expect(typeof OscChannel).toBe('function')
    expect(typeof osc).toBe('object')
  })

  it('exposes the codec as a static, not an instance member', () => {
    // The instance `.osc` accessor is the transport. Reaching for it expecting
    // encodeMessage is the single easiest mistake to make against this library.
    expect(Object.keys(osc).sort()).toEqual([
      'NTP_EPOCH_OFFSET',
      'decode',
      'encodeBundle',
      'encodeMessage',
      'encodeSingleBundle',
      'ntpNow',
      'readTimetag',
    ])
    expect(surface.accessors).toContain('osc')
  })
})

describe('members packages/engine depends on', () => {
  const requiredMethods = [
    'destroy',
    'getCaptureFrames',
    'getEngineState',
    'getInfo',
    'getMetricsArray',
    'getTree',
    'init',
    'isCaptureEnabled',
    'loadSample',
    'loadSynthDef',
    'loadSynthDefs',
    'nextNodeId',
    'off',
    'on',
    'once',
    'purge',
    'sampleInfo',
    'send',
    'sendOSC',
    'shutdown',
    'startCapture',
    'stopCapture',
    'sync',
  ]

  it.each(requiredMethods)('has method %s', (name) => {
    expect(surface.methods).toContain(name)
  })

  const requiredAccessors = ['audioContext', 'clock', 'initialized', 'mode', 'sharedBuffer']

  it.each(requiredAccessors)('has accessor %s', (name) => {
    expect(surface.accessors).toContain(name)
  })

  it.each(['getMetricsSchema', 'getTreeSchema', 'getRawTreeSchema'])('has static %s', (name) => {
    expect(SuperSonic).toHaveProperty(name)
    expect(typeof (SuperSonic as unknown as Record<string, unknown>)[name]).toBe('function')
  })
})

describe('members deliberately NOT relied on', () => {
  // The 0.66 prescheduler and its cancellation API are gone. If any of these
  // reappear, revisit the scheduling design rather than discovering it by bug.
  it.each(['cancelTag', 'cancelSession', 'cancelSessionTag', 'cancelAll'])(
    '%s is absent',
    (name) => {
      expect(surface.methods).not.toContain(name)
    },
  )

  it('getMetrics exists but is not our data source', () => {
    // It does exist; its key names and nesting disagree with the shipped
    // typings. createMetricsPoller reads getMetricsArray() with offsets
    // resolved from the runtime schema instead.
    expect(surface.methods).toContain('getMetrics')
  })

  it('request is undeclared in the typings, so treat it as private', () => {
    expect(surface.methods).toContain('request')
  })
})

describe('metrics schema', () => {
  const schema = SuperSonic.getMetricsSchema() as {
    metrics: Record<string, { offset: number; type?: string }>
    nativeStats: Record<string, { index: number }>
    composites: Record<string, { description: string }>
    layout: { panels: unknown[] }
  }

  it('has the four sections createMetricsPoller and MetricsPanel read', () => {
    expect(Object.keys(schema).sort()).toEqual([
      'composites',
      'layout',
      'metrics',
      'nativeStats',
    ])
  })

  it('resolves names to offsets at runtime', () => {
    expect(Object.keys(schema.metrics).length).toBeGreaterThan(40)
    for (const [name, def] of Object.entries(schema.metrics)) {
      expect(def, name).toHaveProperty('offset')
      expect(Number.isInteger(def.offset), name).toBe(true)
    }
  })

  it('has non-contiguous offsets, so array length must never be assumed', () => {
    const offsets = Object.values(schema.metrics).map((d) => d.offset)
    expect(Math.max(...offsets)).toBeGreaterThan(offsets.length - 1)
  })

  it('names the engine process counter engineProcessCount', () => {
    // Renamed from scsynthProcessCount. The e2e suite asserts this one climbs
    // to prove the audio thread is actually running.
    expect(schema.metrics).toHaveProperty('engineProcessCount')
    expect(schema.metrics).not.toHaveProperty('scsynthProcessCount')
  })

  it('keys nativeStats by index, not offset — a separate array', () => {
    for (const [name, def] of Object.entries(schema.nativeStats)) {
      expect(def, name).toHaveProperty('index')
      expect(def, name).not.toHaveProperty('offset')
    }
  })

  it('ships a panel layout for MetricsPanel to render from', () => {
    expect(Array.isArray(schema.layout.panels)).toBe(true)
    expect(schema.layout.panels.length).toBeGreaterThan(0)
  })
})

describe('full surface', () => {
  it('has not drifted', () => {
    expect({
      methodCount: surface.methods.length,
      accessorCount: surface.accessors.length,
      methods: surface.methods,
      accessors: surface.accessors,
    }).toMatchSnapshot()
  })
})
