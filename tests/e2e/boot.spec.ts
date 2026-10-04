import { expect, test } from '@playwright/test'

// Phase 3's gate: scsynth actually running in the browser. Everything here is
// observable from the page, so it holds against a deployed URL too.

const bootButton = 'button:has-text("Start audio")'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.click(bootButton)
  await expect(page.getByRole('heading', { name: 'SynthDefs' })).toBeVisible({
    timeout: 30_000,
  })
})

test('boots on the SharedArrayBuffer transport', async ({ page }) => {
  // Users get a graceful fallback to postMessage; the build does not. A silent
  // downgrade would disable audio capture and make the audio assertions
  // meaningless, and nothing else would report it.
  await expect(page.getByText(/^sab · \d+ loaded$/)).toBeVisible()
  await expect(page.getByText(/compatibility mode/)).toHaveCount(0)
})

test('generates a control surface from the SynthDef contract', async ({ page }) => {
  // The payoff for the whole contract chain: no range is written in TypeScript.
  // ssp_noise declares eight specs, so eight sliders and no more.
  await expect(page.locator('input[type=range]')).toHaveCount(8)
  await expect(page.getByText('frozen')).toBeVisible()
  await expect(page.getByText('per event')).toBeVisible()
})

test('a vendored def gets inferred controls, clearly labelled as inferred', async ({ page }) => {
  // These carry no metadata, so their ranges come from Sonic Pi's naming
  // conventions. Useful, but not the same thing as a range someone chose — and
  // the page has to say so rather than presenting them identically.
  await page.selectOption('select', 'sonic-pi-prophet')
  await expect(page.getByText(/Ranges inferred/)).toBeVisible()
  await expect(page.locator('input[type=range]').first()).toBeVisible()

  // An authored def states its ranges and says nothing about inference.
  await page.selectOption('select', 'ssp_sine')
  await expect(page.getByText(/Ranges inferred/)).toHaveCount(0)
})

test('a control value can be typed, and is clamped to its own range', async ({ page }) => {
  // A slider cannot be nudged to exactly 440 on an exponential range, and
  // hunting for a specific cutoff by dragging is miserable.
  await page.selectOption('select', 'ssp_sine')
  const row = page.locator('div').filter({ hasText: /^attack/ }).last()
  const value = row.getByRole('button')

  await value.click()
  await row.locator('input[type=text]').fill('1.234')
  await row.locator('input[type=text]').press('Enter')
  await expect(value).toHaveText('1.23')

  // Clamped rather than refused: typing a large number means "as high as it
  // goes", and rejecting it outright would be unhelpful.
  await value.click()
  await row.locator('input[type=text]').fill('99')
  await row.locator('input[type=text]').press('Enter')
  await expect(value).toHaveText('2.00')

  // Escape abandons, so a half-typed number never reaches a sounding synth.
  await value.click()
  await row.locator('input[type=text]').fill('0.001')
  await row.locator('input[type=text]').press('Escape')
  await expect(value).toHaveText('2.00')
})

test('a parameter with no recognised range gets no control', async ({ page }) => {
  // fx_echo has `phase`, which no rule covers. Showing the value without a
  // slider is the honest outcome: an invented range would look authoritative.
  await page.selectOption('select', 'sonic-pi-fx_echo')
  await expect(page.getByText('no range').first()).toBeVisible()
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

test('plays the selected def and the node frees itself', async ({ page }) => {
  await page.getByRole('button', { name: 'play' }).click()

  // The button re-enables when waitForNodeEnd resolves, so this proves scsynth
  // sent /n_end — the envelope's doneAction freed the node rather than it
  // lingering until maxNodes runs out.
  await expect(page.getByRole('button', { name: 'play' })).toBeEnabled({ timeout: 15_000 })

  // A def the engine was never told about fails as /fail "SynthDef not found",
  // which presents as a note that simply never sounds.
  await expect(page.getByText('/fail')).toHaveCount(0)
})

test('drops no messages', async ({ page }) => {
  await page.getByRole('button', { name: 'play' }).click()
  await expect(page.getByRole('button', { name: 'play' })).toBeEnabled({ timeout: 15_000 })

  const dropped = await page.getByText('engineMessagesDropped').locator('..').innerText()
  expect(dropped).toMatch(/\b0\b/)
})

test('shows OSC traffic in both directions', async ({ page }) => {
  await page.getByRole('button', { name: 'play' }).click()
  await expect(page.getByRole('button', { name: 'play' })).toBeEnabled({ timeout: 15_000 })

  const osc = page.locator('section', { hasText: 'OSC' }).first()
  await expect(osc.getByText('→', { exact: true }).first()).toBeVisible()
  await expect(osc.getByText('←', { exact: true }).first()).toBeVisible()
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
