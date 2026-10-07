import { expect, test } from '@playwright/test'

/**
 * AirKit's plotter and its sensitivity control, on the pages that port its
 * personalities.
 *
 * The plotter is a canvas with no React state behind it, so the only honest way
 * to assert it is to read the pixels back. The colour order is not cosmetic:
 * every p-file carries a `// [yellow, magenta, cyan]` comment above its `~plot`
 * naming which expression is which trace, so an order change silently invalidates
 * a decade of those.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
test.setTimeout(300_000)

const boot = async (page: import('@playwright/test').Page, app: string) => {
  await page.goto(`/${app}/?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=plotter]').waitFor({ timeout: 40_000 })
}

/** Move it in a way that puts every axis somewhere different. */
const stir = (page: import('@playwright/test').Page, ms: number) =>
  page.evaluate((duration) => {
    let n = 0
    const tick = setInterval(() => {
      n++
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientation', {
          alpha: (n * 7) % 360,
          beta: 30 * Math.sin(n / 9),
          gamma: 25 * Math.cos(n / 7),
        }),
      )
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', {
          acceleration: { x: 8 * Math.abs(Math.sin(n / 5)), y: 6, z: 4 },
          rotationRate: { alpha: 200, beta: 150, gamma: 90 },
        }),
      )
    }, 16)
    setTimeout(() => clearInterval(tick), duration as number)
  }, ms)

/** Which of AirKit's first three trace colours are actually on the canvas. */
const traceColours = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('[data-testid=plotter]') as HTMLCanvasElement
    const context = canvas.getContext('2d')
    if (!context) return []
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data

    const seen = new Set<string>()
    for (let at = 0; at < pixels.length; at += 4) {
      const [r, g, b, a] = [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!, pixels[at + 3]!]
      if (a < 200) continue
      if (r > 180 && g > 180 && b < 80) seen.add('yellow')
      if (r > 180 && b > 180 && g < 80) seen.add('magenta')
      if (g > 180 && b > 180 && r < 80) seen.add('cyan')
    }
    return [...seen].sort()
  })

// How many series each page's `~plot` returns, from the p-file it was ported
// from. Named here so a mapping that quietly loses a series is caught.
const SERIES: Record<string, number> = {
  suz: 3, // suz3: three gyro axes
  marimba: 3, // multiBeat5: raw, filtered, tilt
  multibeat: 3, // multiBeatSynth1: raw, filtered, drone level
  beast: 2, // movingBeast: raw, filtered
  moog: 2, // miniMoog: raw turn, scaled turn
  gendy: 1, // gendy2: tilt alone
  leaves: 1, // leaves: filtered turn alone
  // The two pages with hand-rolled shells, which predate MotionInstrument.
  droplet: 3, // droplet: folded roll, tilt, side movement
  imu: 3, // not a port — roll, tilt and turn, chosen rather than carried over
}

for (const [app, count] of Object.entries(SERIES)) {
  test(`${app} plots ${count} series in AirKit's colour order`, async ({ page }) => {
    await boot(page, app)
    await stir(page, 6000)
    await page.waitForTimeout(2500)

    const expected = ['yellow', 'magenta', 'cyan'].slice(0, count).sort()
    expect(await traceColours(page)).toEqual(expected)

    // The legend is the p-file's own comment, so it must agree with the series.
    const legend = await page.locator('[data-testid=plotter] + ul li').allInnerTexts()
    expect(legend).toHaveLength(count)
  })
}

test('the plotter shows a flat line before any sensor has spoken', async ({ page }) => {
  // AirKit draws `[0]!50` for a disabled device. A plot holding its last shape
  // looks like a live instrument that has stopped responding, which is the one
  // thing it must not look like.
  await boot(page, 'marimba')
  await page.waitForTimeout(1200)
  expect(await traceColours(page)).toEqual([])
})

test('sensitivity is on every instrument page and defaults to AirKit s midpoint', async ({
  page,
}) => {
  await boot(page, 'suz')
  const slider = page.locator('[data-testid=sensitivity]')
  await expect(slider).toBeVisible()
  expect(await slider.inputValue()).toBe('0.5')

  // 44px, the same rule as every other control here: below it a thumb misses.
  const box = await slider.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})

for (const app of ['marimba', 'suz', 'pluck', 'droplet']) {
  test(`${app} responds to sensitivity in AirKit's direction`, async ({ page }) => {
    await boot(page, app)

    const values = async () => (await page.locator('dl').innerText()).replace(/\n/g, ' ')
    const gesture = () =>
      page.evaluate(() => {
        const tick = setInterval(() => {
          window.dispatchEvent(
            new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 15, gamma: 10 }),
          )
          window.dispatchEvent(
            new DeviceMotionEvent('devicemotion', {
              acceleration: { x: 2, y: 2, z: 2 },
              rotationRate: { alpha: 120, beta: 90, gamma: 60 },
            }),
          )
        }, 16)
        setTimeout(() => clearInterval(tick), 2500)
      })

    // The same small movement at both ends. Lower sensitivity shrinks the input
    // span, so it must read as *more* — `lincurve(v, 0, TOP * sens, …)`.
    await page.locator('[data-testid=sensitivity]').fill('1')
    await gesture()
    await page.waitForTimeout(700)
    const dull = await values()

    await page.locator('[data-testid=sensitivity]').fill('0.1')
    await gesture()
    await page.waitForTimeout(700)
    const hot = await values()

    expect(hot, `sensitivity did nothing: ${dull}`).not.toBe(dull)
  })
}

test('imu leaves the compass bearing alone', async ({ page }) => {
  // Sensitivity means nothing on a wrapping heading, so it is not applied there
  // rather than given a plausible-looking behaviour. The slider is still present,
  // and the page says which axis it skips.
  await boot(page, 'imu')
  await expect(page.locator('[data-testid=sensitivity]')).toBeVisible()
  await expect(page.getByText('a compass bearing has no sensitivity')).toBeVisible()
})
