import { expect, test } from '@playwright/test'
import { IMU } from './pages.ts'

// Orientation is driven two ways, for two different reasons.
//
// CDP's setDeviceOrientationOverride is the real browser sensor path, so one
// test uses it to prove events actually reach the page. It cannot be used for
// anything else: Chrome coalesces the overrides — 30 calls delivered 3 events —
// and the page smooths each reading toward the last, so a value never converges.
//
// Everywhere else the events are constructed in the page at the rate a real
// sensor produces them. That exercises every line this project wrote, and the
// page cannot tell the difference.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function boot(page: import('@playwright/test').Page) {
  await page.goto(`${IMU}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=engine-footer]').waitFor({ timeout: 30_000 })
}

/** Hold an orientation for long enough that the smoother settles on it. */
async function hold(
  page: import('@playwright/test').Page,
  orientation: { alpha: number; beta: number; gamma: number },
) {
  await page.evaluate((o) => {
    for (let n = 0; n < 60; n++) {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', o))
    }
  }, orientation)
}

/** Where a bar sits, 0..1 across its track. */
async function axis(page: import('@playwright/test').Page, name: string): Promise<number> {
  return page.evaluate((key) => {
    const marker = document.querySelector(`[data-testid=axis-${key}] .bg-emerald-400`)
    const track = marker?.parentElement
    if (!marker || !track) return -1
    const a = marker.getBoundingClientRect()
    const b = track.getBoundingClientRect()
    return (a.left + a.width / 2 - b.left) / b.width
  }, name)
}

test('the drone sounds without anything being pressed', async ({ page }) => {
  await boot(page)

  // No note to play: the instrument is always on, and the phone only changes
  // it. One synth, running, with nothing having been touched.
  await expect(page.locator('[data-testid=voices]')).toContainText('1 voices', { timeout: 10_000 })
})

test('the browser sensor path reaches the page', async ({ page }) => {
  await boot(page)
  const cdp = await page.context().newCDPSession(page)

  // The one test that goes through Chrome's own sensor plumbing rather than a
  // constructed event. It asserts movement in the right direction, not an
  // arrival: the overrides are coalesced, so the smoother gets a handful of
  // readings rather than a stream.
  const before = await axis(page, 'roll')
  await cdp.send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: 0, gamma: 70 })
  await expect.poll(() => axis(page, 'roll'), { timeout: 5_000 }).toBeGreaterThan(before + 0.02)
})

test('tilting left and right moves the roll axis', async ({ page }) => {
  await boot(page)

  await hold(page, { alpha: 0, beta: 0, gamma: -60 })
  await expect.poll(() => axis(page, 'roll'), { timeout: 5_000 }).toBeLessThan(0.3)

  await hold(page, { alpha: 0, beta: 0, gamma: 60 })
  await expect.poll(() => axis(page, 'roll'), { timeout: 5_000 }).toBeGreaterThan(0.7)
})

test('standing the phone upright raises the pitch axis', async ({ page }) => {
  await boot(page)

  await hold(page, { alpha: 0, beta: 0, gamma: 0 })
  await expect.poll(() => axis(page, 'pitch'), { timeout: 5_000 }).toBeLessThan(0.6)

  await hold(page, { alpha: 0, beta: 85, gamma: 0 })
  await expect.poll(() => axis(page, 'pitch'), { timeout: 5_000 }).toBeGreaterThan(0.8)
})

test('passing through vertical does not lurch', async ({ page }) => {
  await boot(page)

  // The posture where Euler angles are degenerate, and the reason the page
  // converts to a quaternion first. Driven through the real sensor path here,
  // where the unit test drives the maths directly.
  const readings: number[] = []
  for (let beta = 75; beta <= 105; beta += 5) {
    await hold(page, { alpha: 40, beta, gamma: 15 })
    await page.waitForTimeout(250)
    readings.push(await axis(page, 'roll'))
  }

  for (let n = 1; n < readings.length; n++) {
    const step = Math.abs((readings[n] as number) - (readings[n - 1] as number))
    expect(step, `roll jumped ${step.toFixed(2)} between readings`).toBeLessThan(0.25)
  }
})

test('a shake moves the shake axis, and it decays', async ({ page }) => {
  await boot(page)

  // No CDP override exists for acceleration, so the event is constructed. The
  // page cannot tell the difference, and everything under test is ours.
  await page.evaluate(() => {
    for (let n = 0; n < 6; n++) {
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', { acceleration: { x: 9, y: 7, z: 5 } }),
      )
    }
  })

  await expect.poll(() => axis(page, 'shake'), { timeout: 5_000 }).toBeGreaterThan(0.6)

  // Falls on its own: a shake is a transient, and the synth should settle
  // rather than stay excited because nothing told it to stop.
  await page.evaluate(() => {
    for (let n = 0; n < 60; n++) {
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', { acceleration: { x: 0, y: 0, z: 0 } }),
      )
    }
  })

  await expect.poll(() => axis(page, 'shake'), { timeout: 5_000 }).toBeLessThan(0.2)
})

test('says so when there are no sensors rather than looking broken', async ({ page }) => {
  await boot(page)

  // A desktop visitor gets a drone and no movement. Silence about that reads
  // as the page being broken, which is worse than it being honest about where
  // it is meant to be used.
  await expect(page.getByText(/needs a phone or a tablet/)).toBeVisible()
})

test('acceleration drives three axes, not one magnitude', async ({ page }) => {
  await boot(page)

  // Push along one device axis at a time. The three are separate controls:
  // collapsing them to a magnitude, which is where this started, throws away
  // the direction and leaves one knob where there are three.
  const push = (x: number, y: number, z: number) =>
    page.evaluate(
      ([ax, ay, az]) => {
        window.dispatchEvent(
          new DeviceMotionEvent('devicemotion', { acceleration: { x: ax, y: ay, z: az } }),
        )
      },
      [x, y, z],
    )

  // Polled: the display reads the sensor ref on a 100ms tick, deliberately,
  // so that a 60Hz event stream never drives a re-render.
  await push(11, 0, 0)
  await expect.poll(() => axis(page, 'accelX'), { timeout: 3_000 }).toBeGreaterThan(0.85)
  expect(await axis(page, 'accelY')).toBeCloseTo(0.5, 1)
  expect(await axis(page, 'accelZ')).toBeCloseTo(0.5, 1)

  await push(0, -11, 0)
  await expect.poll(() => axis(page, 'accelY'), { timeout: 3_000 }).toBeLessThan(0.15)

  await push(0, 0, 11)
  await expect.poll(() => axis(page, 'accelZ'), { timeout: 3_000 }).toBeGreaterThan(0.85)
})

test('acceleration returns to centre when the phone is still', async ({ page }) => {
  await boot(page)

  // A derivative, not a position: still means zero however the phone is held.
  // A control that did not return would drift away over a performance with no
  // way to recentre it short of reloading.
  await page.evaluate(() => {
    window.dispatchEvent(
      new DeviceMotionEvent('devicemotion', { acceleration: { x: 11, y: 11, z: 11 } }),
    )
    for (let n = 0; n < 120; n++) {
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', { acceleration: { x: 0, y: 0, z: 0 } }),
      )
    }
  })

  for (const name of ['accelX', 'accelY', 'accelZ']) {
    await expect.poll(() => axis(page, name), { timeout: 3_000 }).toBeCloseTo(0.5, 1)
  }
})
