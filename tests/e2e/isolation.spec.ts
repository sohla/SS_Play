import { expect, test } from '@playwright/test'
import headers from '../../infra/headers.json' with { type: 'json' }

// Runs against a local preview build by default, or a deployed page with
// SS_BASE_URL. Same assertions either way — that is the point: the dev server,
// the preview server and Caddy all take their headers from headers.json, and
// this proves the chain end to end rather than trusting it.

test('the document carries every isolation header', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)

  const received = response?.headers() ?? {}
  for (const [name, value] of Object.entries(headers.document)) {
    expect(received[name.toLowerCase()], name).toBe(value)
  }
})

test('the browser actually grants cross-origin isolation', async ({ page }) => {
  await page.goto('/')

  // The headers being present is necessary but not sufficient — only the
  // browser can say whether isolation took effect, and without it
  // SharedArrayBuffer is gone and audio capture stops working.
  const state = await page.evaluate(() => ({
    crossOriginIsolated: globalThis.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer,
    atomics: typeof Atomics,
    audioWorklet: typeof AudioWorklet,
    wasm: typeof WebAssembly,
  }))

  expect(state).toEqual({
    crossOriginIsolated: true,
    sharedArrayBuffer: 'function',
    atomics: 'object',
    audioWorklet: 'function',
    wasm: 'object',
  })
})

test('the page reports the fast transport', async ({ page }) => {
  await page.goto('/')

  // Fails the build when isolation is lost. Visitors get a graceful fallback to
  // the slower transport; we get a hard failure, because a silent downgrade
  // would turn the audio assertions into assertions about nothing.
  await expect(page.getByText('transport mode')).toBeVisible()
  await expect(page.getByText('sab', { exact: true })).toBeVisible()
  await expect(page.getByText('degraded')).toHaveCount(0)
})

test('nothing cross-origin is requested', async ({ page, baseURL }) => {
  // Resolve the expected origin up front: during the first navigation
  // page.url() is still about:blank, so comparing against it marks the
  // document itself as foreign.
  const ownOrigin = new URL(baseURL ?? 'http://localhost:4173').origin

  const foreign: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol !== 'data:' && url.origin !== ownOrigin) foreign.push(request.url())
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // require-corp blocks cross-origin subresources that do not opt in, so a
  // third-party font or script fails silently in production. Catch it here.
  expect(foreign).toEqual([])
})

test('the AGPL source link is present and absolute', async ({ page }) => {
  await page.goto('/')

  // The bundled client API is AGPL, which makes a deployed page a derivative
  // work conveyed over a network. No page may ship without offering source.
  const link = page.getByRole('link', { name: /source for this page/i })
  await expect(link).toBeVisible()
  expect(await link.getAttribute('href')).toMatch(/^https:\/\/github\.com\//)
})
