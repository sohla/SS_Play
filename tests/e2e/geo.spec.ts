import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

const path = sites.pages.find((page) => page.app === 'geo')!.path
const HOME = { latitude: -37.8136, longitude: 144.9631 }

test.use({ geolocation: { ...HOME, accuracy: 5 }, permissions: ['geolocation'] })

/**
 * Chrome's emulated position fires the watch only when it changes, and the
 * tracker weighs each fix against the last, so a move is given as several.
 */
async function standAt(context: BrowserContext, page: Page, latitude: number, longitude: number) {
  for (let n = 0; n < 6; n++) {
    await context.setGeolocation({ latitude: latitude + n * 1e-8, longitude, accuracy: 4 })
    await page.waitForTimeout(250)
  }
}

/** The loudest the engine's output gets over `ms`, read at the worklet. */
function outputPeak(page: Page, ms: number) {
  return page.evaluate(async (duration) => {
    const session = (window as unknown as { __ss: { sonic: { audioContext: AudioContext; node: AudioNode } } }).__ss
    const analyser = session.sonic.audioContext.createAnalyser()
    analyser.fftSize = 2048
    session.sonic.node.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    let peak = 0
    const end = performance.now() + duration
    while (performance.now() < end) {
      analyser.getFloatTimeDomainData(samples)
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
      await new Promise((done) => setTimeout(done, 20))
    }
    session.sonic.node.disconnect(analyser)
    return peak
  }, ms)
}

test('a good fix chooses a spot 5–20m away, and walking to it finds it', async ({ page, context }) => {
  await page.goto(`${path}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  const status = page.locator('[data-testid=geo-status][data-phase]')
  await expect(status).toHaveAttribute('data-phase', 'seeking', { timeout: 30_000 })

  const metres = Number((await page.locator('[data-testid=geo-distance]').innerText()).replace(' m', ''))
  expect(metres).toBeGreaterThanOrEqual(5)
  expect(metres).toBeLessThanOrEqual(20)

  const radar = page.locator('[data-testid=geo-radar]')
  const lat = Number(await radar.getAttribute('data-target-lat'))
  const lon = Number(await radar.getAttribute('data-target-lon'))
  await standAt(context, page, lat, lon)
  await expect(status).toHaveAttribute('data-phase', 'arrived')
})

test('the drone is louder at the spot than where the walk began', async ({ page, context }) => {
  await page.goto(`${path}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await expect(page.locator('[data-phase=seeking]')).toBeVisible({ timeout: 30_000 })

  // The drone's attack is 3s and the level glides over 1.5s, so let both settle.
  await page.waitForTimeout(5000)
  const far = await outputPeak(page, 1500)

  const radar = page.locator('[data-testid=geo-radar]')
  await standAt(
    context,
    page,
    Number(await radar.getAttribute('data-target-lat')),
    Number(await radar.getAttribute('data-target-lon')),
  )
  await page.waitForTimeout(5000)
  const near = await outputPeak(page, 1500)

  expect(far, 'nothing sounded at the start').toBeGreaterThan(0.001)
  // The start sits at -32dB and arrival at -10dB: 22dB, about twelve times.
  expect(near / far).toBeGreaterThan(6)
  expect(near).toBeLessThan(0.99)
})
