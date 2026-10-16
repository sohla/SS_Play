import { expect, test, type Page } from '@playwright/test'

/**
 * The happy birthday page: a looped melody, and a descant the phone plays above it.
 *
 * `apps/birthday/test/song.test.ts` pins the music — the conversion, the chords,
 * and every rule the descant keeps. What only a browser shows is the one thing
 * this page does differently from every other motion page: **the tune plays with
 * nothing moving**, because it does not run through `MotionInstrument`'s gate.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
test.setTimeout(180_000)

const boot = async (page: Page) => {
  await page.goto('/birthday/?debug=1')
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=playing]').waitFor({ timeout: 40_000 })
}

const value = (page: Page, name: string) =>
  page.locator(`[data-testid="value-${name}"]`).innerText()

const listen = (page: Page) =>
  page.evaluate(async () => {
    const sonic = (
      window as unknown as {
        __ss: {
          sonic: {
            startCapture(): void
            stopCapture(): { frames: number; left: Float32Array }
            getCaptureFrames(): number
          }
        }
      }
    ).__ss.sonic

    sonic.startCapture()
    const deadline = performance.now() + 5000
    while (sonic.getCaptureFrames() < 48_000 && performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    const taken = sonic.stopCapture()

    let sumSquares = 0
    let peak = 0
    for (let at = 0; at < taken.frames; at++) {
      const v = taken.left[at] ?? 0
      sumSquares += v * v
      if (Math.abs(v) > peak) peak = Math.abs(v)
    }
    return { rms: Math.sqrt(sumSquares / Math.max(1, taken.frames)), peak }
  })

/** Shake the phone: linear acceleration with a little rotation, at 60Hz. */
const shake = (page: Page, ms: number) =>
  page.evaluate((duration) => {
    let n = 0
    const tick = setInterval(() => {
      n++
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientation', {
          alpha: (n * 4) % 360,
          beta: 30,
          gamma: 10 * Math.sin(n / 7),
        }),
      )
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', {
          acceleration: { x: 6, y: 6, z: 6 },
          rotationRate: { alpha: 120, beta: 120, gamma: 120 },
        }),
      )
    }, 16)
    setTimeout(() => clearInterval(tick), duration)
  }, ms)

test('the tune plays with nothing moving, and does not clip', async ({ page }) => {
  await boot(page)
  await page.waitForTimeout(2500)

  // About eight notes of the melody in the second captured; ssp_mel holds each
  // through 90% of its length, so a silent capture means the loop is not running.
  const heard = await listen(page)
  expect(heard.rms, 'the melody produced no signal').toBeGreaterThan(0.001)
  expect(heard.peak, 'the melody clipped').toBeLessThan(0.99)
})

test('shaking brings the descant in over the chord of the bar', async ({ page }) => {
  await boot(page)
  await shake(page, 6000)
  await page.waitForTimeout(2500)

  expect(await value(page, 'descant')).toMatch(/^every [124] \/ 16$/)
  expect(['I', 'IV', 'V']).toContain(await value(page, 'chord'))
  expect(Number(await value(page, 'note'))).toBeGreaterThan(72)

  const heard = await listen(page)
  expect(heard.peak, 'melody and descant together clipped').toBeLessThan(0.99)
})
