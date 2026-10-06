import { describe, expect, it } from 'vitest'
import headers from '../../../infra/headers.json' with { type: 'json' }
import { MAX_SAMPLES_PER_APP, VENDOR_DIR, defineSSApp } from '../src/index.ts'

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

describe('cache rules address paths the build emits', () => {
  // A build emits exactly two trees per page: Vite's hashed assets, and the
  // staged engine under VENDOR_DIR. The first version of these globs named
  // /engine/*, /synthdefs/* and /samples/* — none of which exist — so every
  // Cache-Control rule but one matched nothing. A dead rule is invisible: the
  // site works, slightly worse, indefinitely.
  const patterns = [
    ...headers.immutablePagePaths,
    ...headers.revalidatePagePaths,
    ...headers.revalidateEnginePaths,
  ]

  it.each(patterns)('%s is relative to a page root', (pattern) => {
    // Patterns are joined to each page's own path by infra/cache-paths.mjs. A
    // leading slash would produce '/playground//assets/*' and match nothing.
    expect(pattern.startsWith('/'), `"${pattern}" must not start with a slash`).toBe(false)
  })

  it('claims immutable only for content-addressed URLs', () => {
    // A year-long immutable response cannot be revalidated or evicted; the only
    // remedy is a new URL. The engine's filenames are stable while its bytes
    // are not, so immutable there would pin a stale wasm on every return
    // visitor until the URL changed — which it never would.
    expect(headers.immutablePagePaths).toEqual(['assets/*'])
  })

  it('revalidates the document that names the hashed assets', () => {
    expect(headers.revalidatePagePaths).toEqual(['', 'index.html'])
  })

  it('addresses every engine subtree, and only under VENDOR_DIR', () => {
    // Without an explicit directive browsers cache heuristically, which can
    // serve a rebuilt synthdef from a stale copy with no way to force a refresh.
    for (const subtree of ['wasm', 'workers', 'synthdefs', 'samples']) {
      expect(headers.revalidateEnginePaths).toContain(`${VENDOR_DIR}/${subtree}/*`)
    }
    expect(headers.revalidateEnginePaths).toContain(`${VENDOR_DIR}/manifest.json`)

    for (const pattern of headers.revalidateEnginePaths) {
      expect(pattern.startsWith(`${VENDOR_DIR}/`)).toBe(true)
    }
  })
})

describe('base path', () => {
  it('moves the engine URL with the page', () => {
    // resolveEngineUrls derives every worker, wasm and synthdef URL from this
    // one value, so a page served under a prefix whose engine base was left at
    // the root fetches the wrong origin-relative paths and fails to boot.
    const nested = defineSSApp({ name: 'fixture', basePath: '/scratch/' })
    expect(nested.base).toBe('/scratch/')
    expect(nested.define?.['__SS_ENGINE_BASE__']).toBe(JSON.stringify(`/scratch/${VENDOR_DIR}/`))
  })

  it('defaults to the root', () => {
    expect(config.base).toBe('/')
    expect(config.define?.['__SS_ENGINE_BASE__']).toBe(JSON.stringify(`/${VENDOR_DIR}/`))
  })

  it('rejects a path without a trailing slash, naming the consequence', () => {
    // Vite concatenates base onto asset URLs, so '/scratch' silently yields
    // '/scratchassets/index.js' rather than erroring.
    expect(() => defineSSApp({ name: 'fixture', basePath: '/scratch' })).toThrow(
      /trailing slash.*scratchassets/s,
    )
  })

  it('rejects a path without a leading slash', () => {
    expect(() => defineSSApp({ name: 'fixture', basePath: 'scratch/' })).toThrow(/leading/)
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
