import { expect, test } from '@playwright/test'

/**
 * The thrum page: one haptic pulse, nine parameters.
 *
 * `apps/thrum/test/pulse.test.ts` already pins what each parameter does to the
 * mapping, and does it across hundreds of values in milliseconds. What only a
 * browser can show is that the panel reaches the engine at all, that the page
 * sounds with the device completely still, and that no setting clips.
 *
 * What nothing here can say is whether any of it is *felt*. That is the page's
 * entire purpose and it needs a hand.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
test.setTimeout(180_000)

const boot = async (page: import('@playwright/test').Page) => {
  await page.goto('/thrum/?debug=1')
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=playing]').waitFor({ timeout: 40_000 })
}

const value = (page: import('@playwright/test').Page, name: string) =>
  page.locator(`[data-testid="value-${name}"]`).innerText()

const voices = (page: import('@playwright/test').Page) =>
  page
    .locator('[data-testid=voices]')
    .innerText()
    .then((text) => Number(text.replace(/\D/g, '')))

const measure = (page: import('@playwright/test').Page) =>
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
    const from = Math.floor(taken.frames * 0.1)
    const to = Math.floor(taken.frames * 0.9)
    for (let at = from; at < to; at++) {
      const v = taken.left[at] ?? 0
      sumSquares += v * v
      if (Math.abs(v) > peak) peak = Math.abs(v)
    }
    return { rms: Math.sqrt(sumSquares / Math.max(1, to - from)), peak }
  })

test('it is already running when the page opens, with nothing touched', async ({ page }) => {
  await boot(page)
  await page.waitForTimeout(1200)

  // Not one orientation or motion event is dispatched in this test. Every other
  // page here is silent until moved, and this one must not be: it is a bench for
  // judging a vibration, and a vibration cannot be judged while shaking the
  // thing producing it. Free run is on by default and wakes the shell itself.
  await expect(page.locator('[data-testid=playing]')).not.toContainText('stopped')
  await expect(page.locator('[data-testid=ctl-free-run]')).toBeChecked()

  const heard = await measure(page)
  expect(heard.rms, 'the page opened silent').toBeGreaterThan(0.002)
  expect(heard.peak, 'the page clipped at its defaults').toBeLessThan(0.99)

  // One held voice and nothing else. No clock, no spawned taps.
  expect(await voices(page)).toBe(1)
})

test('every one of the nine parameters reaches the engine', async ({ page }) => {
  await boot(page)

  // The panel's whole value is that a hand can move one thing and trust the
  // number it reads back. If a slider is wired to the wrong control, or to
  // nothing, the page still makes a noise and still looks right.
  const cases: [testId: string, set: string, readout: string, expected: string][] = [
    ['carrier', '140', 'carrier', '140Hz'],
    ['rate', '30', 'rate', '30.0Hz flutter'],
    ['decay', '0.004', 'decay', '4ms tap'],
    ['attack', '0.03', 'attack', '30.00ms'],
    ['curve', '0', 'curve', '0.0 linear'],
    ['overdrive', '3.5', 'overdrive', 'x3.5'],
    ['transient', '0', 'transient', 'off'],
    ['sharpness', '0.9', 'sharpness', '0.90'],
  ]

  for (const [testId, set, readout, expected] of cases) {
    await page.locator(`[data-testid=ctl-${testId}]`).fill(set)
    await expect
      .poll(() => value(page, readout), { timeout: 10_000 })
      .toBe(expected)
  }

  // Intensity is reported twice — the slider and the amplitude it produces —
  // because the Stevens correction between them is wide enough to read as a bug.
  await page.locator('[data-testid=ctl-intensity]').fill('0.5')
  await expect.poll(() => value(page, 'intensity'), { timeout: 10_000 }).toBe('0.50 amp 0.31')
})

test('it still sounds, and does not clip, at the extremes of the envelope', async ({ page }) => {
  await boot(page)

  // The corners most likely to break: a 3ms pulse with maximum overdrive at the
  // fused rate, and a 500ms pulse that overlaps itself many times over.
  await page.locator('[data-testid=ctl-intensity]').fill('1')
  await page.locator('[data-testid=ctl-overdrive]').fill('6')
  await page.locator('[data-testid=ctl-decay]').fill('0.003')
  await page.locator('[data-testid=ctl-rate]').fill('90')
  await page.waitForTimeout(900)

  const sharp = await measure(page)
  expect(sharp.rms, 'short pulses at a fused rate produced nothing').toBeGreaterThan(0.002)
  expect(sharp.peak, 'short pulses at full overdrive clipped').toBeLessThan(0.99)

  await page.locator('[data-testid=ctl-decay]').fill('0.5')
  await page.waitForTimeout(900)

  const long = await measure(page)
  expect(long.rms, 'long overlapping pulses produced nothing').toBeGreaterThan(0.002)
  expect(long.peak, 'long overlapping pulses clipped').toBeLessThan(0.99)
})

test('turning free run off hands the page back to the gestures', async ({ page }) => {
  await boot(page)
  await page.locator('[data-testid=ctl-free-run]').uncheck()

  // And with it off, a still device must go quiet again — the ordinary rule for
  // every page here, which this one only suspends while free running.
  await page.evaluate(() => {
    const tick = setInterval(() => {
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 20, gamma: 25 }),
      )
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', {
          acceleration: { x: 0, y: 0, z: 0 },
          rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        }),
      )
    }, 16)
    setTimeout(() => clearInterval(tick), 3000)
  })
  await page.waitForTimeout(3600)

  await expect(page.locator('[data-testid=playing]')).toContainText('stopped')
})
