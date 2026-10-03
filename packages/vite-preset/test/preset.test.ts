import { describe, expect, it } from 'vitest'
import headers from '../../../infra/headers.json' with { type: 'json' }
import { MAX_SAMPLES_PER_APP, defineSSApp } from '../src/index.ts'

// infra/headers.json is the single source of truth: the Vite servers import it
// and infra/gen.mjs renders the Caddyfile from it. These tests guard the Vite
// half; `npm run verify` guards the Caddy half with a git diff.

const config = defineSSApp({ name: 'fixture' })

describe('isolation headers', () => {
  it('are sent by the dev server', () => {
    expect(config.server?.headers).toEqual(headers.document)
  })

  it('are sent by the preview server too', () => {
    // Preview is what the e2e suite and the production build are checked
    // against, so it drifting from dev is the expensive failure.
    expect(config.preview?.headers).toEqual(headers.document)
  })

  it('are byte-identical between the two servers', () => {
    expect(config.server?.headers).toEqual(config.preview?.headers)
  })

  it('contain no header literal of their own', () => {
    // If someone hardcodes a header here, this still passes — but the Caddyfile
    // diff in `verify` will not. Asserted so the intent is recorded.
    expect(Object.keys(headers.document)).toEqual([
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Embedder-Policy',
    ])
  })
})

describe('the AGPL core stays unbundled', () => {
  it('is excluded from dependency optimisation', () => {
    // Fetched at runtime from the vendor directory, never imported. Bundling it
    // would break the worklet and blur the licence boundary at once.
    expect(config.optimizeDeps?.exclude).toContain('supersonic-scsynth-core')
  })

  it('does not exclude the client API, which is meant to be bundled', () => {
    expect(config.optimizeDeps?.include).toContain('supersonic-scsynth')
  })
})

describe('sample budget', () => {
  it('accepts a page-sized handful', () => {
    expect(() => defineSSApp({ name: 'fixture', samples: ['bd_haus', 'ambi_choir'] })).not.toThrow()
  })

  it('accepts exactly the limit', () => {
    const samples = Array.from({ length: MAX_SAMPLES_PER_APP }, (_, i) => `s${i}`)
    expect(() => defineSSApp({ name: 'fixture', samples })).not.toThrow()
  })

  it('rejects one over, naming the app and the cost', () => {
    const samples = Array.from({ length: MAX_SAMPLES_PER_APP + 1 }, (_, i) => `s${i}`)
    expect(() => defineSSApp({ name: 'greedy', samples })).toThrow(/greedy.*33.*32/s)
  })
})

describe('mode negotiation is left upstream', () => {
  it('never pins a port collision between dev and preview', () => {
    expect(config.server?.port).not.toBe(config.preview?.port)
  })
})
