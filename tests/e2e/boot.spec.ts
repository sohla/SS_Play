import { expect, test } from '@playwright/test'

// Phase 3's gate: scsynth actually running in the browser. Everything here is
// observable from the page, so it holds against a deployed URL too.

const bootButton = 'button:has-text("Boot scsynth")'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.click(bootButton)
  await expect(page.getByText('achieved transport')).toBeVisible({ timeout: 30_000 })
})

test('boots on the SharedArrayBuffer transport', async ({ page }) => {
  // Users get a graceful fallback to postMessage; the build does not. A silent
  // downgrade would disable audio capture and make the audio assertions
  // meaningless, and nothing else would report it.
  // Scoped to the achieved row: the pre-boot probe reports an expected mode
  // with the same value, so an unscoped match would pass without booting.
  const achieved = page.getByText('achieved transport').locator('..')
  await expect(achieved).toContainText('sab')
  await expect(page.getByText(/degraded/)).toHaveCount(0)
})

test('reports engine info from the running worklet', async ({ page }) => {
  // The AudioContext is created by the engine, so a real rate and a real boot
  // time mean the worklet started rather than merely downloaded. `version` is
  // deliberately not asserted: getInfo() types it string | null and the wasm
  // does not always report one.
  await expect(page.getByText('48000 Hz')).toBeVisible()
  await expect(page.getByText(/^\d+ ms$/)).toBeVisible()
})

test('loads the declared synthdef', async ({ page }) => {
  // loadSynthDefs reports per-name results and never rejects, so this passing
  // means loadSynthDefsChecked inspected the map rather than assuming success.
  await expect(page.getByText('sonic-pi-beep')).toBeVisible()
})

test('the audio thread is running', async ({ page }) => {
  const read = async () => {
    const text = await page.getByText('engineProcessCount').locator('..').innerText()
    return Number(text.replace(/\D/g, ''))
  }

  const first = await read()
  await page.waitForTimeout(500)
  const second = await read()

  // The process counter only advances when the worklet renders a block.
  expect(second).toBeGreaterThan(first)
})

test('plays a beep and the node frees itself', async ({ page }) => {
  await page.click('button:has-text("Play beep")')

  // The button re-enables when waitForNodeEnd resolves, so this proves scsynth
  // sent /n_end — the envelope's doneAction freed the node rather than it
  // lingering until maxNodes runs out.
  await expect(page.locator('button:has-text("Play beep")')).toBeEnabled({ timeout: 15_000 })
  await expect(page.locator('text=/Timed out/')).toHaveCount(0)
})

test('drops no messages', async ({ page }) => {
  await page.click('button:has-text("Play beep")')
  await expect(page.locator('button:has-text("Play beep")')).toBeEnabled({ timeout: 15_000 })

  const dropped = await page.getByText('engineMessagesDropped').locator('..').innerText()
  expect(dropped).toMatch(/\b0\b/)
})

test('serves the vendored engine from its own origin', async ({ page, baseURL }) => {
  // Same-origin is what keeps require-corp satisfied without CORP headers, and
  // keeps the library off its cross-origin blob-worker path.
  const wasm = await page.request.get(`${baseURL}/vendor/supersonic/wasm/scsynth-nrt.wasm`)
  expect(wasm.status()).toBe(200)
  // A wrong MIME type fails the streaming compile with a confusing error.
  expect(wasm.headers()['content-type']).toBe('application/wasm')

  for (const worker of [
    'workers/clockwork_audio_worklet.js',
    'workers/osc_in_worker.js',
    'workers/osc_out_log_sab_worker.js',
  ]) {
    const response = await page.request.get(`${baseURL}/vendor/supersonic/${worker}`)
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
  const client = await request.get(`${baseURL}/vendor/supersonic/LICENSE-supersonic-scsynth`)
  expect(client.status()).toBe(200)
  expect(await client.text()).toMatch(/GNU Affero General Public License/i)

  // The core's package.json declares AGPL-3.0-or-later but its LICENSE file is
  // GPL-3.0 text with no mention of Affero. Asserted as shipped rather than as
  // the metadata claims, so an upstream correction surfaces here. It does not
  // change our choice: GPL-3.0 code is compatible with an AGPL-3.0 whole.
  const core = await request.get(`${baseURL}/vendor/supersonic/LICENSE-supersonic-scsynth-core`)
  expect(core.status()).toBe(200)
  expect(await core.text()).toMatch(/GNU General Public License/i)
})
