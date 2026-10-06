import { expect, test } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

// The page that runs its pattern in JavaScript rather than as a Demand graph in
// the server. What is worth asserting is the thing that makes that viable: the
// events land at the rate the pattern asked for, because each one is scheduled
// ahead with an OSC timetag rather than sent when a timer happened to fire.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const path = sites.pages.find((p) => p.app === 'multibeat')?.path ?? '/multibeat/'

async function boot(page: import('@playwright/test').Page) {
  await page.goto(`${path}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=playing]').waitFor({ timeout: 30_000 })
}

/** Keep the phone moving at a steady level, as a hand does. */
async function driveFor(page: import('@playwright/test').Page, ms: number, force: number) {
  await page.evaluate(
    ([duration, f]) => {
      const tick = setInterval(() => {
        for (let n = 0; n < 8; n++) {
          window.dispatchEvent(
            new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 10, gamma: 10 }),
          )
          window.dispatchEvent(
            new DeviceMotionEvent('devicemotion', { acceleration: { x: f, y: f, z: f } }),
          )
        }
      }, 40)
      setTimeout(() => clearInterval(tick), duration)
    },
    [ms, force],
  )
  await page.waitForTimeout(ms + 200)
}

const events = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid=value-events]').innerText().then(Number)

const voices = (page: import('@playwright/test').Page) =>
  page
    .locator('[data-testid=voices]')
    .innerText()
    .then((t) => Number(t.replace(/\D/g, '')))

test('the drone holds from boot, before anything is played', async ({ page }) => {
  await boot(page)
  // A sequence over a bed: two instruments on one page, one of them a single
  // voice that never stops.
  await expect.poll(() => voices(page), { timeout: 10_000 }).toBe(1)
  await expect(page.locator('[data-testid=playing]')).toContainText('stopped')
})

test('moving changes the subdivision, not the tempo', async ({ page }) => {
  await boot(page)

  await driveFor(page, 1200, 3)
  const gentle = await page.locator('[data-testid=value-notes\\/bar]').innerText()

  await driveFor(page, 1200, 12)
  const hard = await page.locator('[data-testid=value-notes\\/bar]').innerText()

  // One, two or four notes in the same half-second bar. The bar does not get
  // shorter — it gets cut up differently, which is the whole personality.
  expect(['1', '2', '4']).toContain(gentle)
  expect(['1', '2', '4']).toContain(hard)
  expect(Number(hard)).toBeGreaterThan(Number(gentle))
})

test('events arrive at the rate the pattern asked for', async ({ page }) => {
  await boot(page)

  // Settle on a subdivision first, so the measurement is of one rate.
  await driveFor(page, 1500, 12)
  const step = Number(
    (await page.locator('[data-testid=value-step]').innerText()).replace('s', ''),
  )
  const before = await events(page)

  const windowMs = 3000
  await driveFor(page, windowMs, 12)
  const after = await events(page)

  const spawned = after - before
  const expected = windowMs / 1000 / step

  // Generous, because the window's edges are soft and the subdivision is free
  // to change within it. What this catches is a scheduler that drifts or stalls
  // — a setInterval that quietly loses a beat every second would land here at
  // half the expected count, and is exactly what bundle timetags avoid.
  expect(spawned, `${spawned} events in ${windowMs}ms at a ${step}s step`).toBeGreaterThan(
    expected * 0.6,
  )
  expect(spawned).toBeLessThan(expected * 1.4)
})

test('the pattern stops scheduling when the phone is still', async ({ page }) => {
  await boot(page)
  await driveFor(page, 1200, 10)
  expect(await events(page)).toBeGreaterThan(3)

  // A still phone keeps reporting at ~zero, which is what makes the ballistic
  // envelope decay. The level falls below the floor and the pattern stops being
  // asked for events — it keeps its place rather than restarting.
  await driveFor(page, 2500, 0)
  const settled = await events(page)
  await page.waitForTimeout(1200)

  expect(await events(page)).toBe(settled)
  await expect(page.locator('[data-testid=playing]')).toContainText('stopped')
})

test('voices free themselves and the drone remains', async ({ page }) => {
  await boot(page)
  await driveFor(page, 2500, 10)
  expect(await events(page)).toBeGreaterThan(10)

  await driveFor(page, 3000, 0)
  // Back to the drone alone. The voices use a perc envelope with doneAction, so
  // nothing has to decide when they end.
  await expect.poll(() => voices(page), { timeout: 10_000 }).toBe(1)
})
