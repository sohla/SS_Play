import { describe, expect, it } from 'vitest'
import { WASM_FILENAME, WORKLET_FILENAME, resolveEngineUrls } from '../src/urls'

describe('defaults', () => {
  const urls = resolveEngineUrls({ base: '/vendor/supersonic/' })

  it('derives every URL from one vendor directory', () => {
    expect(urls).toEqual({
      baseURL: '/vendor/supersonic/',
      coreBaseURL: '/vendor/supersonic/',
      workerBaseURL: '/vendor/supersonic/workers/',
      wasmBaseURL: '/vendor/supersonic/wasm/',
      wasmUrl: '/vendor/supersonic/wasm/scsynth-nrt.wasm',
      workletUrl: '/vendor/supersonic/workers/clockwork_audio_worklet.js',
      synthdefBaseURL: '/vendor/supersonic/synthdefs/',
      sampleBaseURL: '/vendor/supersonic/samples/',
    })
  })

  it('names the wasm file that exists', () => {
    // The Clockwork layer defaults this to clockwork-engine.wasm, which is not
    // in the core package; only the SuperSonic layer's override makes it work.
    expect(WASM_FILENAME).toBe('scsynth-nrt.wasm')
    expect(urls.wasmUrl).not.toContain('clockwork-engine')
  })

  it('names the worklet that 0.88 renamed', () => {
    expect(WORKLET_FILENAME).toBe('clockwork_audio_worklet.js')
    expect(urls.workletUrl).not.toContain('scsynth_audio_worklet')
  })
})

describe('trailing slashes', () => {
  it('adds one to the base when missing', () => {
    expect(resolveEngineUrls({ base: '/vendor/supersonic' }).synthdefBaseURL).toBe(
      '/vendor/supersonic/synthdefs/',
    )
  })

  it('does not double one that is present', () => {
    expect(resolveEngineUrls({ base: '/v/' }).baseURL).toBe('/v/')
  })

  it('normalises overrides too', () => {
    const urls = resolveEngineUrls({ base: '/v/', synthdefBaseURL: '/defs' })
    expect(urls.synthdefBaseURL).toBe('/defs/')
  })
})

describe('overrides', () => {
  it('lets the core live somewhere else', () => {
    const urls = resolveEngineUrls({ base: '/app/', coreBaseURL: '/engine/0.88.0/' })
    expect(urls.wasmBaseURL).toBe('/engine/0.88.0/wasm/')
    expect(urls.wasmUrl).toBe('/engine/0.88.0/wasm/scsynth-nrt.wasm')
    // Workers still come from the main package's vendor tree.
    expect(urls.workerBaseURL).toBe('/app/workers/')
  })

  it('accepts an absolute URL base', () => {
    const urls = resolveEngineUrls({ base: 'https://example.test/engine/0.88.0/' })
    expect(urls.wasmUrl).toBe('https://example.test/engine/0.88.0/wasm/scsynth-nrt.wasm')
  })

  it('honours a fully explicit wasmUrl', () => {
    const urls = resolveEngineUrls({ base: '/v/', wasmUrl: '/custom/engine.wasm' })
    expect(urls.wasmUrl).toBe('/custom/engine.wasm')
  })

  it('keeps synthdefs relative to the base the engine is given', () => {
    // SuperSonic resolves synthdef names against synthdefBaseURL. Staging them
    // anywhere else fails with an opaque exception rather than a 404.
    const urls = resolveEngineUrls({ base: '/vendor/supersonic/' })
    expect(urls.synthdefBaseURL.startsWith(urls.baseURL)).toBe(true)
  })
})
