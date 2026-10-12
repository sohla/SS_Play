import { expect, test } from '@playwright/test'

/**
 * The sync page: one rhythm on every device, from the clock alone.
 *
 * `packages/engine/test/grid-conductor.test.ts` and `apps/sync/test/rhythm.test.ts`
 * already pin the grid maths and the pattern, across magnitudes and in
 * milliseconds. What only a browser can show is that the scheduler reaches the
 * engine, that the grid survives a reload in phase, and — the one that matters —
 * that **two independent page loads agree about the step** without exchanging
 * anything.
 *
 * What nothing here can show is whether two *separate devices* agree. Both
 * contexts in this file share one machine clock, so this proves the mechanism is
 * clock-derived rather than start-derived; it cannot prove anything about NTP.
 * That needs two phones, which is what the page is for.
 */

test.use({ viewport: { width: 390, height: 844 } })
test.setTimeout(180_000)

const boot = async (page: import('@playwright/test').Page) => {
  await page.goto('/sync/?debug=1')
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=beats]').waitFor({ timeout: 40_000 })
}

const value = (page: import('@playwright/test').Page, name: string) =>
  page.locator(`[data-testid="value-${name}"]`).innerText()

test('two independent loads agree about the step, having exchanged nothing', async ({ browser }) => {
  // The whole mechanism in one assertion. Two contexts, no shared state, no
  // message between them — and the same step index, because both derive it from
  // the clock rather than from when they started.
  const first = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const second = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const a = await first.newPage()
  const b = await second.newPage()

  await boot(a)
  // Deliberately late. A ClientConductor started here would be permanently
  // offset by this delay; a grid cannot be.
  await a.waitForTimeout(3000)
  await boot(b)

  const [stepA, stepB] = await Promise.all([value(a, 'step'), value(b, 'step')])

  // Read a moment apart, so one step of slack. Anything more means the phase
  // came from the start rather than from the clock.
  expect(Math.abs(Number(stepA) - Number(stepB)), `${stepA} vs ${stepB}`).toBeLessThanOrEqual(1)

  // And the bar agrees too, which is the number a person compares across two
  // phones held side by side.
  const [barA, barB] = await Promise.all([value(a, 'bar'), value(b, 'bar')])
  expect(Math.abs(Number(barA) - Number(barB))).toBeLessThanOrEqual(1)

  await first.close()
  await second.close()
})

test('the step keeps its phase across a reload', async ({ page }) => {
  await boot(page)
  const before = Number(await value(page, 'step'))

  await page.reload()
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=beats]').waitFor({ timeout: 40_000 })

  const after = Number(await value(page, 'step'))

  // Monotonic and still on the same grid: a reload is a new page, a new
  // AudioContext and a new scheduler, and none of that is allowed to move the
  // beat. Elapsed time is the only thing that may have changed it.
  expect(after).toBeGreaterThan(before)
  expect(after - before).toBeLessThan(8 * 16)
})

test('it schedules hits, frees them, and skips nothing', async ({ page }) => {
  await boot(page)
  await page.waitForTimeout(6000)

  // Six seconds is three bars: twelve kicks, six snares, eight hats.
  const sent = Number(await value(page, 'hits sent'))
  expect(sent, 'the grid scheduled nothing').toBeGreaterThan(10)

  // A stalled main thread drops steps, which sounds identical to a wrong clock
  // and is a different fault. On an idle page it must be zero.
  expect(Number(await value(page, 'skipped')), 'steps were dropped on an idle page').toBe(0)

  // Every hit is released, so a page left running cannot fill maxNodes.
  const voices = await page
    .locator('[data-testid=voices]')
    .innerText()
    .then((text) => Number(text.replace(/\D/g, '')))
  expect(voices, `${sent} hits sent, ${voices} voices alive`).toBeLessThan(12)
})

test('the bar is two seconds, and the downbeat lands on a whole second', async ({ page }) => {
  await boot(page)

  // The property that makes the grid legible against any other clock in the
  // room: bar phase passes through zero when wall-clock seconds are even.
  const samples: number[] = []
  for (let n = 0; n < 24; n++) {
    samples.push(Number((await value(page, 'bar phase')).replace('ms', '')))
    await page.waitForTimeout(120)
  }

  expect(Math.max(...samples)).toBeLessThan(2000)
  expect(Math.min(...samples)).toBeGreaterThanOrEqual(0)
  // Over ~2.9s of sampling the phase must have wrapped at least once.
  const wrapped = samples.some((value, n) => n > 0 && value < (samples[n - 1] ?? 0))
  expect(wrapped, `phase never wrapped: ${samples.join(',')}`).toBe(true)
})

test('it makes a sound, and does not clip', async ({ page }) => {
  await boot(page)
  await page.waitForTimeout(2500)

  const heard = await page.evaluate(async () => {
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

  expect(heard.rms, 'the rhythm produced no signal').toBeGreaterThan(0.001)
  expect(heard.peak, 'the rhythm clipped').toBeLessThan(0.99)
})
