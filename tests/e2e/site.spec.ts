import { expect, test } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }
import headers from '../../infra/headers.json' with { type: 'json' }
import { LANDING, SCRATCH } from './pages.ts'

// The pages share one origin, which is what makes a landing page possible
// without a DNS record each. These are the assertions that shape has to hold:
// every advertised page resolves, every page is isolated, and the page that
// boots nothing ships nothing.

const bootButton = 'button:has-text("Start audio")'

test('the landing page links to every page the site declares', async ({ page }) => {
  await page.goto(LANDING)

  for (const declared of sites.pages) {
    const link = page.locator(`a[href="${declared.path}"]`)
    await expect(link, `no link to ${declared.path}`).toBeVisible()
    await expect(link).toContainText(declared.title)
  }

  // Nothing beyond what sites.json declares — a hand-added link would be a
  // second source of truth, and the one that goes stale.
  await expect(page.locator('main ul a')).toHaveCount(sites.pages.length)
})

test('every declared page actually resolves', async ({ request, baseURL }) => {
  for (const { path } of [{ path: LANDING }, ...sites.pages]) {
    const response = await request.get(`${baseURL}${path}`)
    expect(response.status(), `${path} did not resolve`).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
  }
})

test('every page carries the isolation headers', async ({ request, baseURL }) => {
  // COEP applies to an origin, so these have to be right on all of them or the
  // one that is wrong silently loses SharedArrayBuffer.
  for (const { path } of [{ path: LANDING }, ...sites.pages]) {
    const response = await request.get(`${baseURL}${path}`)
    const got = response.headers()

    for (const [name, value] of Object.entries(headers.document)) {
      expect(got[name.toLowerCase()], `${path} is missing ${name}`).toBe(value)
    }
  }
})

test('the landing page ships no engine', async ({ page, request, baseURL }) => {
  // It boots nothing, so staging the engine into it would be 1.8MB of wasm
  // served to every visitor for a page of links. Asserted as absent from the
  // deployed tree rather than merely unrequested: an unused file still costs
  // disk on every release, and "nothing fetched it" is what you would see
  // either way.
  const wasm = await request.get(`${baseURL}/vendor/supersonic/wasm/scsynth-nrt.wasm`)
  expect(wasm.status(), 'the landing page is still shipping the engine').toBe(404)

  const engineRequests: string[] = []
  page.on('request', (sent) => {
    if (sent.url().includes('/vendor/supersonic/')) engineRequests.push(sent.url())
  })

  await page.goto(LANDING)
  await expect(page.getByRole('heading', { level: 1, name: 'playground' })).toBeVisible()

  expect(engineRequests).toEqual([])
  await expect(page.locator(bootButton)).toHaveCount(0)
})

test('a missing asset is a 404, not the index page', async ({ request, baseURL }) => {
  // No try_files. A site-wide fallback answers a missing .scsyndef or .wasm
  // with index.html and a 200, so a binary request receives HTML — which
  // surfaces as an opaque parse error rather than a 404. Every bug of that
  // shape in this project so far has presented as silence.
  const missing = await request.get(
    `${baseURL}${SCRATCH}vendor/supersonic/synthdefs/does-not-exist.scsyndef`,
  )
  expect(missing.status()).toBe(404)
  expect(missing.headers()['content-type'] ?? '').not.toContain('text/html')
})

test('a second page boots its own engine and sounds', async ({ page }) => {
  // The point of the second page: it declares no synthdefs and no samples, and
  // imports nothing from apps/playground. If it needed either, the preset
  // would be carrying one page's assumptions instead of being a factory.
  await page.goto(SCRATCH)
  await page.click(bootButton)

  await expect(page.getByText(/^sab · \d+ loaded$/)).toBeVisible({ timeout: 30_000 })

  await page.click('[data-testid=play]')
  await expect(page.getByText('sounding…')).toBeVisible()
  await expect(page.locator('[data-testid=play]')).toBeEnabled({ timeout: 15_000 })

  // The audio thread ran, rather than the button merely toggling.
  const blocks = await page.locator('[data-testid=blocks]').innerText()
  expect(Number(blocks.replace(/\D/g, ''))).toBeGreaterThan(0)
})

test('hashed assets are immutable and the engine is not', async ({ page, request, baseURL }) => {
  // Never immutable-cache a URL that is not content-addressed: a year-long
  // immutable response cannot be revalidated or evicted, so the only remedy is
  // a new URL. The engine's filenames are stable while its bytes are not.
  await page.goto(SCRATCH)

  const asset = await page.locator('script[type=module]').first().getAttribute('src')
  expect(asset, 'no module script on the page').toBeTruthy()

  const hashed = await request.get(new URL(asset as string, baseURL).toString())
  expect(hashed.headers()['cache-control']).toBe(headers.immutable['Cache-Control'])

  const wasm = await request.get(`${baseURL}${SCRATCH}vendor/supersonic/wasm/scsynth-nrt.wasm`)
  expect(wasm.headers()['cache-control']).toBe(headers.revalidate['Cache-Control'])
  expect(wasm.headers()['content-type']).toBe('application/wasm')
})

test('every page has a way back to the index', async ({ page }) => {
  // These are separate documents on one origin, not a single-page app, so the
  // browser's back button is the only other way out — and on a phone opened
  // from a link there may be nothing behind it.
  for (const declared of sites.pages) {
    await page.goto(declared.path)

    const back = page.locator('header a[href="/"]')
    await expect(back, `${declared.path} has no link back`).toBeVisible()

    await back.click()
    await expect(page).toHaveURL(new RegExp(`${LANDING}$`))
  }
})

test('every engine page reports what the engine is doing', async ({ page }) => {
  for (const declared of sites.pages) {
    if (!declared.engine) continue

    await page.goto(declared.path)
    await page.getByRole('button', { name: 'Start audio' }).click()

    const footer = page.locator('[data-testid=engine-footer]')
    await expect(footer, `${declared.path} has no engine footer`).toBeVisible({ timeout: 30_000 })

    await expect(page.locator('[data-testid=latency]')).toContainText('ms')
    await expect(page.locator('[data-testid=health]')).toContainText('% health')
    await expect(page.locator('[data-testid=voices]')).toContainText('voices')
  }
})
