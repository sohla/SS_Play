import { describe, expect, it, vi } from 'vitest'
import {
  bootEngine,
  type BootResult,
  type BootableEngine,
  type EngineFactoryOptions,
} from '../src/boot'
import { resolveEngineUrls } from '../src/urls'
import { loadSynthDefsChecked, SynthDefLoadError } from '../src/assets'

const urls = resolveEngineUrls({ base: '/vendor/supersonic/' })

/** Narrows to the success branch so assertions can reach into it. */
function expectBooted<T extends BootableEngine>(result: BootResult<T>) {
  if (!result.ok) throw new Error(`expected boot to succeed, got: ${result.error.message}`)
  return result
}

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

/** A SuperSonic stand-in that mirrors 0.88's own mode negotiation. */
function fakeEngine(behaviour: { failModes?: Set<string>; isolated?: boolean } = {}) {
  const { failModes = new Set<string>(), isolated = true } = behaviour
  const created: EngineFactoryOptions[] = []
  const destroyed: string[] = []

  const create = (options: EngineFactoryOptions): BootableEngine => {
    created.push(options)
    const mode = options.mode ?? (isolated ? 'sab' : 'postMessage')

    return {
      mode,
      async init() {
        if (failModes.has(mode)) throw new Error(`init failed in ${mode} mode`)
      },
      async destroy() {
        destroyed.push(mode)
      },
    }
  }

  return { create, created, destroyed }
}

describe('the happy path', () => {
  it('never passes a mode, leaving negotiation to the library', async () => {
    const fake = fakeEngine()
    const result = await bootEngine({ create: fake.create, urls, scope: scope() })

    expect(result.ok).toBe(true)
    // Forcing `mode` is the only way to reach the capability probe that throws.
    expect(fake.created[0]).not.toHaveProperty('mode')
  })

  it('reports the achieved mode', async () => {
    const fake = fakeEngine()
    const result = await bootEngine({ create: fake.create, urls, scope: scope() })

    expect(result.ok && result.mode).toBe('sab')
    expect(result.ok && result.degraded).toBeUndefined()
  })

  it('passes the URLs through verbatim', async () => {
    const fake = fakeEngine()
    await bootEngine({ create: fake.create, urls, scope: scope() })
    expect(fake.created[0]).toMatchObject(urls)
  })

  it('forwards pinned scsynth options', async () => {
    const fake = fakeEngine()
    await bootEngine({
      create: fake.create,
      urls,
      scsynthOptions: { maxNodes: 4096 },
      scope: scope(),
    })
    expect(fake.created[0]?.scsynthOptions).toEqual({ maxNodes: 4096 })
  })
})

describe('isolation lost', () => {
  it('boots on postMessage and says so, rather than failing', async () => {
    // The silent case: headers dropped, nothing throws, audio capture is gone.
    const fake = fakeEngine({ isolated: false })
    const result = await bootEngine({
      create: fake.create,
      urls,
      scope: scope({ crossOriginIsolated: false }),
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.mode).toBe('postMessage')
    expect(result.ok && result.report.sabUnavailable).toContain('crossOriginIsolated')
    // Not a degradation: nothing was retried, this is simply what the browser
    // offers. The report is where the UI learns why.
    expect(result.ok && result.degraded).toBeUndefined()
  })
})

describe('the bounded fallback', () => {
  it('retries once on postMessage when the SAB boot rejects', async () => {
    const fake = fakeEngine({ failModes: new Set(['sab']) })
    const result = await bootEngine({ create: fake.create, urls, scope: scope() })

    expect(result.ok).toBe(true)
    expect(result.ok && result.mode).toBe('postMessage')
    expect(fake.created).toHaveLength(2)
    expect(fake.created[1]?.mode).toBe('postMessage')
  })

  it('preserves the original failure as the cause', async () => {
    const fake = fakeEngine({ failModes: new Set(['sab']) })
    const result = await bootEngine({ create: fake.create, urls, scope: scope() })

    const booted = expectBooted(result)
    expect(booted.degraded?.from).toBe('sab')
    expect(booted.degraded?.to).toBe('postMessage')
    expect((booted.degraded?.cause as Error).message).toMatch(/init failed in sab mode/)
  })

  it('tears down the failed engine before retrying', async () => {
    const fake = fakeEngine({ failModes: new Set(['sab']) })
    await bootEngine({ create: fake.create, urls, scope: scope() })
    expect(fake.destroyed).toEqual(['sab'])
  })

  it('retries exactly once and then gives up', async () => {
    const fake = fakeEngine({ failModes: new Set(['sab', 'postMessage']) })
    const result = await bootEngine({ create: fake.create, urls, scope: scope() })

    expect(result.ok).toBe(false)
    // Two attempts, never a loop.
    expect(fake.created).toHaveLength(2)
  })

  it('does not retry when postMessage was already the first attempt', async () => {
    const fake = fakeEngine({ isolated: false, failModes: new Set(['postMessage']) })
    const result = await bootEngine({
      create: fake.create,
      urls,
      scope: scope({ crossOriginIsolated: false }),
    })

    expect(result.ok).toBe(false)
    expect(fake.created).toHaveLength(1)
  })

  it('survives a teardown that itself throws', async () => {
    const create = vi
      .fn<(options: EngineFactoryOptions) => BootableEngine>()
      .mockImplementationOnce(() => ({
        mode: 'sab',
        init: async () => {
          throw new Error('shared memory unavailable')
        },
        destroy: async () => {
          throw new Error('teardown also failed')
        },
      }))
      .mockImplementationOnce(() => ({
        mode: 'postMessage',
        init: async () => {},
        destroy: async () => {},
      }))

    const result = await bootEngine({ create, urls, scope: scope() })

    // The teardown error must not mask the original cause.
    const booted = expectBooted(result)
    expect((booted.degraded?.cause as Error).message).toBe('shared memory unavailable')
  })
})

describe('a browser that cannot run the engine', () => {
  it('fails before constructing anything', async () => {
    const fake = fakeEngine()
    const result = await bootEngine({
      create: fake.create,
      urls,
      scope: scope({ AudioWorklet: undefined }),
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.message).toMatch(/audioWorklet/)
    expect(fake.created).toHaveLength(0)
  })
})

describe('loadSynthDefsChecked: the array shape 0.88 actually returns', () => {
  it('returns the names the engine extracted from each binary', async () => {
    const loader = {
      loadSynthDefs: async () => [
        { name: 'sonic-pi-beep', size: 2249 },
        { name: 'sonic-pi-prophet', size: 5000 },
      ],
    }
    await expect(
      loadSynthDefsChecked(loader, ['sonic-pi-beep', 'sonic-pi-prophet']),
    ).resolves.toEqual(['sonic-pi-beep', 'sonic-pi-prophet'])
  })

  it('does not read an array as a record, which reports every name as missing', async () => {
    // Object.keys of an array gives "0", "1", ... so the record path finds no
    // entry for any requested name and invents a total failure. This is the
    // bug that stopped the first real boot.
    const loader = { loadSynthDefs: async () => [{ name: 'a', size: 1 }] }
    await expect(loadSynthDefsChecked(loader, ['a'])).resolves.toEqual(['a'])
  })

  it('surfaces a name that disagrees with the file it came from', async () => {
    const loader = { loadSynthDefs: async () => [{ name: 'sonic-pi-mixou', size: 2800 }] }
    await expect(loadSynthDefsChecked(loader, ['sonic-pi-mixout'])).resolves.toEqual([
      'sonic-pi-mixou',
    ])
  })

  it('reports a short array rather than silently dropping names', async () => {
    const loader = { loadSynthDefs: async () => [{ name: 'a', size: 1 }] }
    await expect(loadSynthDefsChecked(loader, ['a', 'b'])).rejects.toThrow(/no entry at its index/)
  })

  it('lets a rejection through, since Promise.all already rejects on failure', async () => {
    const loader = {
      loadSynthDefs: async () => {
        throw new Error('HTTP 404 fetching sonic-pi-nope.scsyndef')
      },
    }
    await expect(loadSynthDefsChecked(loader, ['sonic-pi-nope'])).rejects.toThrow(/404/)
  })
})

describe('loadSynthDefsChecked: the record shape the typings describe', () => {
  it('returns the loaded names when everything succeeds', async () => {
    const loader = {
      loadSynthDefs: async () => ({ a: { success: true }, b: { success: true } }),
    }
    await expect(loadSynthDefsChecked(loader, ['a', 'b'])).resolves.toEqual(['a', 'b'])
  })

  it('throws on a partial failure that the library reports as success', async () => {
    // loadSynthDefs resolves even when individual defs fail, so the obvious
    // await reports success for a page whose instrument never loaded.
    const loader = {
      loadSynthDefs: async () => ({
        a: { success: true },
        b: { success: false, error: 'not found' },
      }),
    }

    await expect(loadSynthDefsChecked(loader, ['a', 'b'])).rejects.toThrow(SynthDefLoadError)
  })

  it('names every failure, not just the first', async () => {
    const loader = {
      loadSynthDefs: async () => ({
        a: { success: false, error: 'bad magic' },
        b: { success: true },
        c: { success: false, error: 'http 404' },
      }),
    }

    await expect(loadSynthDefsChecked(loader, ['a', 'b', 'c'])).rejects.toThrow(/a: bad magic/)
    await expect(loadSynthDefsChecked(loader, ['a', 'b', 'c'])).rejects.toThrow(/c: http 404/)
  })

  it('treats a missing result as a failure', async () => {
    const loader = { loadSynthDefs: async () => ({ a: { success: true } }) }
    await expect(loadSynthDefsChecked(loader, ['a', 'b'])).rejects.toThrow(/no result reported/)
  })

  it('does not call the loader for an empty list', async () => {
    const loadSynthDefs = vi.fn()
    await expect(loadSynthDefsChecked({ loadSynthDefs }, [])).resolves.toEqual([])
    expect(loadSynthDefs).not.toHaveBeenCalled()
  })
})
