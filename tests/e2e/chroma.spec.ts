import { expect, test, type Page } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

const path = sites.pages.find((page) => page.app === 'chroma')!.path

async function boot(page: Page) {
  await page.goto(`${path}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=playing]').waitFor({ timeout: 30_000 })
}

/** Keep the phone moving at a steady level, as a hand does. */
async function driveFor(page: Page, ms: number, force: number) {
  await page.evaluate(
    ([duration, f]) => {
      const tick = setInterval(() => {
        for (let n = 0; n < 8; n++) {
          window.dispatchEvent(
            new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 10, gamma: 10 }),
          )
          window.dispatchEvent(
            new DeviceMotionEvent('devicemotion', {
              acceleration: { x: f ?? 0, y: f ?? 0, z: f ?? 0 },
            }),
          )
        }
      }, 40)
      setTimeout(() => clearInterval(tick), duration)
    },
    [ms, force],
  )
}

/** Every change of the page's background over `ms`, with when it was seen. */
async function colourChanges(page: Page, ms: number) {
  return page.evaluate(async (duration) => {
    const main = document.querySelector('main')!
    const seen: { at: number; colour: string }[] = []
    let last = getComputedStyle(main).backgroundColor
    const end = performance.now() + duration
    await new Promise<void>((done) => {
      const frame = () => {
        const now = getComputedStyle(main).backgroundColor
        if (now !== last) seen.push({ at: performance.now(), colour: now })
        last = now
        if (performance.now() < end) requestAnimationFrame(frame)
        else done()
      }
      requestAnimationFrame(frame)
    })
    return seen
  }, ms)
}

test('moving pushes the phrase from dotted towards dense', async ({ page }) => {
  await boot(page)

  await driveFor(page, 1500, 3)
  await page.waitForTimeout(1500)
  const gentle = await page.locator('[data-testid=value-phrase]').innerText()

  await driveFor(page, 1500, 14)
  await page.waitForTimeout(1500)
  const hard = await page.locator('[data-testid=value-phrase]').innerText()

  const order = ['dotted', 'triplets', 'dense']
  expect(order).toContain(gentle)
  expect(order.indexOf(hard)).toBeGreaterThan(order.indexOf(gentle))
})

test('accents change the colour, never more than three times a second', async ({ page }) => {
  await boot(page)

  // Hard enough for the dense phrase, whose accents come faster than the cap.
  await driveFor(page, 6500, 14)
  await page.waitForTimeout(1500)
  const changes = await colourChanges(page, 4000)

  expect(changes.length, 'the screen never changed colour').toBeGreaterThanOrEqual(3)
  for (let n = 1; n < changes.length; n++) {
    // The cap is 333ms between the accents' scheduled times. Seen from frames,
    // a change can only show up late, by up to one frame, never early — but the
    // frame it was due in can itself be late, which shortens the next gap by
    // the same amount. 300ms leaves two 60Hz frames for that.
    expect(changes[n]!.at - changes[n - 1]!.at).toBeGreaterThan(300)
    expect(changes[n]!.colour).not.toBe(changes[n - 1]!.colour)
  }
})

test('holding still leaves the colour where it is', async ({ page }) => {
  await boot(page)
  // Nothing has been moved, so nothing plays and nothing accents.
  expect(await colourChanges(page, 2500)).toEqual([])
})
