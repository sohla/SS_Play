import { expect, test } from '@playwright/test'
import { DROPLET } from './pages.ts'

// The port of AirKit's `droplet` personality. What is worth asserting here is
// the thing the architecture is for: a Demand sequence running in the server
// spawns real polyphonic voices, each freeing itself, with the phone changing
// the shower while it runs.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function boot(page: import('@playwright/test').Page) {
  await page.goto(`${DROPLET}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=playing]').waitFor({ timeout: 30_000 })
}

/** Hold an orientation for long enough that the smoother settles on it. */
async function hold(page: import('@playwright/test').Page, beta: number, gamma = 0) {
  await page.evaluate(
    ([b, g]) => {
      for (let n = 0; n < 60; n++) {
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: b, gamma: g }),
        )
      }
    },
    [beta, gamma],
  )
}

const voices = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid=voices]').innerText().then((text) => Number(text.replace(/\D/g, '')))

test('a sequence in the server spawns polyphonic voices', async ({ page }) => {
  await boot(page)
  await hold(page, 0)

  // The whole reason for the conductor arrangement. A Demand graph cannot
  // allocate nodes, so without this the drops would be one voice retriggering
  // and choking its own tail.
  await expect.poll(() => voices(page), { timeout: 10_000 }).toBeGreaterThan(1)
  await expect(page.locator('[data-testid=playing]')).toContainText('droplets')
})

test('every drop frees itself', async ({ page }) => {
  await boot(page)

  // The reverb and the clock are synths too and never go away, so the floor is
  // two rather than zero — the footer counts synths, which is right for every
  // other page and needs reading carefully on this one. Polled, because the
  // tree is a snapshot refreshed on an interval and reading it straight after
  // boot can see it as it was before the synths existed.
  const floor = 2
  await expect.poll(() => voices(page), { timeout: 10_000 }).toBe(floor)

  await hold(page, 0)
  await expect.poll(() => voices(page), { timeout: 10_000 }).toBeGreaterThan(floor)

  // DetectSilence, not the envelope — the BPF rings past the end of a 5ms perc.
  // A drop that failed to free would show up as a count that only climbs, and
  // in a performance as maxNodes exhaustion partway through.
  await hold(page, 88)
  await expect.poll(() => voices(page), { timeout: 15_000 }).toBe(floor)
})

test('standing the phone up stops the droplets, in the SynthDef', async ({ page }) => {
  await boot(page)

  await hold(page, 0)
  await expect(page.locator('[data-testid=playing]')).toContainText('droplets', { timeout: 10_000 })

  // The threshold is a comparison inside ssp_drop_clock gating its own trigger,
  // so nothing is spawned rather than spawned silently.
  await hold(page, 88)
  await expect(page.locator('[data-testid=playing]')).toContainText('stopped', { timeout: 10_000 })

  const stopped = await page.locator('[data-testid=value-drops]').innerText()
  await page.waitForTimeout(1200)
  expect(await page.locator('[data-testid=value-drops]').innerText()).toBe(stopped)
})

test('the mapping produces the values SuperCollider does', async ({ page }) => {
  await boot(page)
  await hold(page, 0)

  // sclang: 0.lincurve(-1, 1, 0.5, 0.075) is 0.1256612418594. The unit tests
  // check the function; this checks that a level phone actually reaches it
  // through the sensor, the quaternion and the smoother.
  await expect
    .poll(() => page.locator('[data-testid=value-dur]').innerText(), { timeout: 5_000 })
    .toBe('0.126s')

  // 0.lincurve(-1, 1, 0, 1, -2) is 0.73105857863.
  await expect(page.locator('[data-testid=value-level]')).toContainText('0.731')
})

test('laying the phone flat plays faster', async ({ page }) => {
  await boot(page)

  // Read through a poll: the display samples the sensor ref on a 100ms tick,
  // deliberately, so a 60Hz event stream never drives a re-render.
  const durAfter = async (beta: number) => {
    await hold(page, beta)
    await page.waitForTimeout(400)
    return Number((await page.locator('[data-testid=value-dur]').innerText()).replace('s', ''))
  }

  const slow = await durAfter(60)
  const fast = await durAfter(-40)

  expect(fast).toBeLessThan(slow)
  // The spec on ssp_drop_clock is 0.075..0.5, and the mapping must stay inside
  // it or mapSpec would clamp and the gesture would go dead at one end.
  expect(fast).toBeGreaterThanOrEqual(0.075)
  expect(slow).toBeLessThanOrEqual(0.5)
})
