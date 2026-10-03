import { describe, expect, it } from 'vitest'
import { probeCapabilities } from '../src/capabilities'

// probeCapabilities takes its scope as a parameter precisely so the degraded
// paths can be exercised without a browser. Everything a page shows about why
// audio will be slow or absent comes from here.

function scope(overrides: Record<string, unknown> = {}) {
  const base = {
    AudioWorklet: class {},
    Worker: class {},
    WebAssembly: {},
    SharedArrayBuffer: class {},
    Atomics: {},
    crossOriginIsolated: true,
  }
  const merged: Record<string, unknown> = { ...base, ...overrides }
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key]
  }
  return merged as unknown as typeof globalThis
}

describe('a fully capable browser', () => {
  const report = probeCapabilities(scope())

  it('expects the fast transport', () => {
    expect(report.expectedMode).toBe('sab')
  })

  it('reports nothing blocking or missing', () => {
    expect(report.blocking).toEqual([])
    expect(report.sabUnavailable).toEqual([])
  })
})

describe('isolation lost', () => {
  // The case this whole design guards against: headers dropped in production.
  // 0.88 negotiates postMessage silently, so nothing throws.
  const report = probeCapabilities(scope({ crossOriginIsolated: false }))

  it('degrades the mode instead of blocking the boot', () => {
    expect(report.expectedMode).toBe('postMessage')
    expect(report.blocking).toEqual([])
  })

  it('names isolation as the reason', () => {
    expect(report.sabUnavailable).toContain('crossOriginIsolated')
  })
})

describe('SharedArrayBuffer absent', () => {
  const report = probeCapabilities(
    scope({ crossOriginIsolated: false, SharedArrayBuffer: undefined }),
  )

  it('lists every missing prerequisite, not just the first', () => {
    expect(report.sabUnavailable).toEqual(['sharedArrayBuffer', 'crossOriginIsolated'])
  })
})

describe('a browser that cannot run the engine at all', () => {
  const report = probeCapabilities(scope({ AudioWorklet: undefined, WebAssembly: undefined }))

  it('reports what blocks the boot', () => {
    expect(report.blocking).toEqual(['audioWorklet', 'wasm'])
  })

  it('still reports a mode, because the mode is not what is wrong', () => {
    expect(report.expectedMode).toBe('sab')
  })
})

describe('the capability set', () => {
  it('covers exactly what the engine and the page care about', () => {
    expect(Object.keys(probeCapabilities(scope()).capabilities).sort()).toEqual([
      'atomics',
      'audioWorklet',
      'crossOriginIsolated',
      'sharedArrayBuffer',
      'wasm',
      'webWorker',
    ])
  })

  it('treats a merely truthy crossOriginIsolated as not isolated', () => {
    const report = probeCapabilities(scope({ crossOriginIsolated: 'yes' }))
    expect(report.capabilities.crossOriginIsolated).toBe(false)
  })
})
