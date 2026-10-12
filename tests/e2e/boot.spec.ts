import { ENGINE_HOST } from './pages.ts'
import { expect, test } from '@playwright/test'

// Phase 3's gate: scsynth actually running in the browser. Everything here is
// observable from the page, so it holds against a deployed URL too.
//
// This file used to run against the def browser, and six of its eleven tests
// were about *that page's features* rather than about the engine: a control
// surface generated from a contract, an inferred contract labelled as inferred,
// a typed value clamped to its range, a parameter with no recognised range,
// playing a selected def, and OSC traffic in both directions. The page is gone
// and so are they — they tested something the site no longer does.
//
// `SynthDefControls` and the inferred-contract path still ship in `@ss/ui` with
// nothing using them, so that code is now untested. Recorded rather than quietly
// deleted: a page that picks defs at runtime would want it back.
//
// The four below are about the engine and the build, so they were kept and
// repointed. Two of them read the def browser's metrics panel; they now go
// through the `?debug=1` handle, which is an improvement — the same mechanism
// the audio specs use, and no dependence on any page's markup.
//
// One was dropped rather than moved: **drops no messages**, which read
// `engineMessagesDropped`. No surviving page renders that counter and the debug
// handle does not expose it, so there is nowhere honest to assert it from. The
// engine footer shows `engineMessagesProcessed`, a different number that would
// have made it a test in name only.

const bootButton = 'button:has-text("Start audio")'

test.beforeEach(async ({ page }) => {
  await page.goto(`${ENGINE_HOST}?debug=1`)
  await page.click(bootButton)
  await page.locator('[data-testid=surface]').waitFor({ timeout: 30_000 })
})

test('boots on the SharedArrayBuffer transport', async ({ page }) => {
  // Users get a graceful fallback to postMessage; the build does not. A silent
  // downgrade would disable audio capture and make the audio assertions
  // meaningless, and nothing else would report it.
  const mode = await page.evaluate(() => (window as unknown as { __ss: { mode: string } }).__ss.mode)
  expect(mode).toBe('sab')

  await expect(page.getByText(/compatibility mode/)).toHaveCount(0)
})

test('the audio thread is running', async ({ page }) => {
  // Was a poll of `engineProcessCount` in the def browser's metrics panel. The
  // capture frame counter is a stricter form of the same question: it only
  // advances when the worklet renders a block and writes it to the output ring,
  // so it cannot move while the audio thread is stalled.
  const frames = () =>
    page.evaluate(() => {
      const sonic = (window as unknown as { __ss: { sonic: { getCaptureFrames(): number } } }).__ss
        .sonic
      return sonic.getCaptureFrames()
    })

  await page.evaluate(() => {
    const sonic = (window as unknown as { __ss: { sonic: { startCapture(): void } } }).__ss.sonic
    sonic.startCapture()
  })

  const first = await frames()
  await page.waitForTimeout(500)
  const second = await frames()

  expect(second).toBeGreaterThan(first)
})

test('serves the vendored engine from its own origin', async ({ page, baseURL }) => {
  // Same-origin is what keeps require-corp satisfied without CORP headers, and
  // keeps the library off its cross-origin blob-worker path.
  const wasm = await page.request.get(
    `${baseURL}${ENGINE_HOST}vendor/supersonic/wasm/scsynth-nrt.wasm`,
  )
  expect(wasm.status()).toBe(200)
  // A wrong MIME type fails the streaming compile with a confusing error.
  expect(wasm.headers()['content-type']).toBe('application/wasm')

  for (const worker of [
    'workers/clockwork_audio_worklet.js',
    'workers/osc_in_worker.js',
    'workers/osc_out_log_sab_worker.js',
  ]) {
    const response = await page.request.get(`${baseURL}${ENGINE_HOST}vendor/supersonic/${worker}`)
    expect(response.status(), worker).toBe(200)
  }
})

test('ships each vendored package licence beside the code it covers', async ({
  baseURL,
  request,
}) => {
  // The client package is AGPL in both its metadata and its LICENSE, and it is
  // the one bundled into this page's JavaScript — which is what makes SS_Play
  // AGPL-3.0-or-later.
  const client = await request.get(
    `${baseURL}${ENGINE_HOST}vendor/supersonic/LICENSE-supersonic-scsynth`,
  )
  expect(client.status()).toBe(200)
  expect(await client.text()).toMatch(/GNU Affero General Public License/i)

  // The core's package.json declares AGPL-3.0-or-later but its LICENSE file is
  // GPL-3.0 text with no mention of Affero. Asserted as shipped rather than as
  // the metadata claims, so an upstream correction surfaces here. It does not
  // change our choice: GPL-3.0 code is compatible with an AGPL-3.0 whole.
  const core = await request.get(
    `${baseURL}${ENGINE_HOST}vendor/supersonic/LICENSE-supersonic-scsynth-core`,
  )
  expect(core.status()).toBe(200)
  expect(await core.text()).toMatch(/GNU General Public License/i)
})
