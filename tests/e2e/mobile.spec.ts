import { expect, test } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }
import { LANDING, PLAYGROUND, TOUCH } from './pages.ts'

// Mobile is the primary target, so these run at phone width rather than as an
// afterthought at the end of a desktop suite. The IMU and multitouch work to
// come depends on a layout that already fits in a hand.

// iPhone SE is the narrowest screen worth supporting. Anything that fits here
// fits everywhere.
const PHONE = { width: 375, height: 667 }

const bootButton = 'button:has-text("Start audio")'

// 44px, Apple's minimum target. Below it, a control is reliably missed by a
// thumb — and a missed boot button reads as "the page does not work".
const TOUCH_TARGET = 44

test.use({ viewport: PHONE, hasTouch: true })

const everyPage = [{ path: LANDING }, ...sites.pages]

for (const { path } of everyPage) {
  test(`${path} does not scroll sideways on a phone`, async ({ page }) => {
    await page.goto(path)

    // A flex item's min-width is auto, so one long unbreakable string stretches
    // every ancestor past the viewport. This is invisible on a desktop — the
    // overflow is off to the right where nobody looks — while on a phone it
    // squeezes every other column to nothing. The OSC log did exactly this and
    // made the playground 42,874px wide.
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }))

    expect(overflow.doc, `${path} is ${overflow.doc}px wide in a ${overflow.inner}px viewport`).toBeLessThanOrEqual(
      overflow.inner + 1,
    )
  })
}

test('the playground does not scroll sideways once it is running', async ({ page }) => {
  // The panels that overflow only exist after boot, so the check above cannot
  // see them.
  await page.goto(PLAYGROUND)
  await page.click(bootButton)
  await expect(page.locator('input[type=range]').first()).toBeVisible({ timeout: 30_000 })

  // Let the OSC log fill: its rows are the longest strings on the page.
  await page.waitForTimeout(500)

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }))
  expect(overflow.doc).toBeLessThanOrEqual(overflow.inner + 1)
})

test('the gesture that starts audio is big enough to hit', async ({ page }) => {
  await page.goto(TOUCH)
  const box = await page.locator(bootButton).boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET)
})

test('sliders are draggable with a thumb, not a 4px line', async ({ page }) => {
  await page.goto(PLAYGROUND)
  await page.click(bootButton)
  const slider = page.locator('input[type=range]').first()
  await expect(slider).toBeVisible({ timeout: 30_000 })

  // The input's own box is the hit area; the visible track is drawn thinner
  // through ::-webkit-slider-runnable-track. Styling only the track would leave
  // a 4px band to aim at.
  const box = await slider.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET)

  // Wide enough to resolve a value. Three columns in 375px left 129px, which is
  // about 1.5 pixels per semitone on a cutoff control.
  expect(box?.width ?? 0).toBeGreaterThan(250)
})

test('a slider responds to a touch drag', async ({ page }) => {
  await page.goto(PLAYGROUND)
  await page.click(bootButton)
  const slider = page.locator('input[type=range]').first()
  await expect(slider).toBeVisible({ timeout: 30_000 })

  const before = await slider.inputValue()
  const box = (await slider.boundingBox()) as { x: number; y: number; width: number; height: number }

  // A real drag through the touchscreen, not a programmatic value set: the
  // whole point of the 44px box is that this path works.
  await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height / 2)

  expect(await slider.inputValue()).not.toBe(before)
})
