import { expect, test } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

// The three AirKit ports that share MotionInstrument. They differ only in their
// SynthDefs and their mapping, so what is worth asserting is the behaviour the
// shared machinery is responsible for — and the one failure mode that would
// otherwise only appear partway through a performance.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const PORTED = ['melchair', 'suz', 'beast'] as const

const pathOf = (app: string) => {
  const page = sites.pages.find((candidate) => candidate.app === app)
  if (!page) throw new Error(`no page for ${app} in infra/sites.json`)
  return page.path
}

async function boot(page: import('@playwright/test').Page, app: string) {
  await page.goto(`${pathOf(app)}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=playing]').waitFor({ timeout: 30_000 })
}

/** Move the phone, the way a hand does. */
const shake = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    for (let n = 0; n < 60; n++) {
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 10, gamma: 10 }),
      )
    }
    for (let n = 0; n < 20; n++) {
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', {
          acceleration: { x: 6, y: 6, z: 6 },
          rotationRate: { alpha: 300, beta: 200, gamma: 150 },
        }),
      )
    }
  })

/**
 * Hold it still — which is not the same as sending nothing.
 *
 * A phone at rest keeps reporting at ~60Hz with near-zero readings, and that
 * stream is what makes the ballistic envelopes decay. Stopping the events
 * instead freezes them at their last value, which looks like the instrument
 * refusing to stop and is an artefact of the test rather than the page.
 */
const hold = (page: import('@playwright/test').Page, ms: number) =>
  page.evaluate((duration) => {
    const tick = setInterval(() => {
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 10, gamma: 10 }),
      )
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', {
          acceleration: { x: 0, y: 0, z: 0 },
          rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        }),
      )
    }, 16)
    setTimeout(() => clearInterval(tick), duration)
  }, ms)

const voices = (page: import('@playwright/test').Page) =>
  page
    .locator('[data-testid=voices]')
    .innerText()
    .then((text) => Number(text.replace(/\D/g, '')))

const events = (page: import('@playwright/test').Page) =>
  page
    .locator('[data-testid=value-events]')
    .innerText()
    .then(Number)

for (const app of PORTED) {
  test(`${app} is silent until it is moved`, async ({ page }) => {
    await boot(page, app)

    // The resting pose is a valid one, so a page that drove its clock before a
    // sensor had spoken would play on load and never stop on a desktop.
    await page.waitForTimeout(1500)
    await expect(page.locator('[data-testid=playing]')).toContainText('stopped')
    expect(await events(page)).toBe(0)
  })

  test(`${app} plays when moved`, async ({ page }) => {
    await boot(page, app)
    await shake(page)

    await expect(page.locator('[data-testid=playing]')).toContainText('events', { timeout: 10_000 })
    await expect.poll(() => events(page), { timeout: 10_000 }).toBeGreaterThan(3)
  })

  test(`${app} frees its voices rather than filling maxNodes`, async ({ page }) => {
    await boot(page, app)

    // Measured twice, with the second window twice as long. The number of
    // events roughly doubles; the number alive must not.
    //
    // That plateau is the whole property, and a ratio against the event count
    // is not: beast releases over three seconds against a tenth-of-a-second
    // step, so most of what it has spawned is legitimately still sounding at
    // any moment. What must never happen is the count tracking the events.
    const sample = async (seconds: number) => {
      for (let n = 0; n < seconds; n++) {
        await shake(page)
        await page.waitForTimeout(1000)
      }
      return { spawned: await events(page), alive: await voices(page) }
    }

    const first = await sample(4)
    const second = await sample(4)

    expect(second.spawned, 'the clock stopped').toBeGreaterThan(first.spawned * 1.5)
    expect(
      second.alive,
      `${first.alive} voices at ${first.spawned} events, ${second.alive} at ${second.spawned}`,
    ).toBeLessThan(first.alive * 1.6 + 4)

    // And once it is put down, everything goes.
    await hold(page, 9000)
    await expect.poll(() => voices(page), { timeout: 15_000 }).toBe(1)
    await expect(page.locator('[data-testid=playing]')).toContainText('stopped')
  })
}

test('each ported page reaches its own clock and voice', async ({ page }) => {
  // They share MotionInstrument, so a copy-paste of the wrong SynthDef name
  // would still render, still show a footer, and simply never make a sound.
  for (const app of PORTED) {
    await boot(page, app)
    await shake(page)
    await expect.poll(() => events(page), { timeout: 10_000 }).toBeGreaterThan(0)
  }
})
