import { expect, test } from '@playwright/test'

/**
 * The thrum page: three vibrotactile layers out of one phone speaker.
 *
 * The unit suite already pins the boundaries this page is built on — the ~6Hz
 * segregation rate, the ~25ms pulse-to-vibration threshold, the five regimes the
 * flutter sweep crosses — because those are arithmetic and belong where they are
 * cheap. What only a browser can say is that the two mechanisms actually run:
 * that the Demand clock spawns taps and frees them, that the held bed answers to
 * a control at 30Hz, and that three layers at once make a sound without clipping.
 *
 * What nothing here can say is whether any of it is *felt*. That needs a hand.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
test.setTimeout(300_000)

const boot = async (page: import('@playwright/test').Page) => {
  await page.goto('/thrum/?debug=1')
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=playing]').waitFor({ timeout: 40_000 })
}

const value = (page: import('@playwright/test').Page, name: string) =>
  page.locator(`[data-testid="value-${name}"]`).innerText()

/**
 * Drive the two gestures independently, which is the only way to show they are
 * independent. `spin` is rotation rate, `force` is linear acceleration.
 *
 * **Awaits its own duration**, and that is the whole point of the wrapper. The
 * evaluate only *arms* an interval and returns at once, so two of these called
 * in sequence overlap: the first call is still dispatching its rotation while
 * the second is supposed to be showing what shaking alone does. Written the
 * obvious way, the separability test above passed its rotation reading straight
 * into its acceleration reading and compared a number with itself.
 */
const move = async (
  page: import('@playwright/test').Page,
  { spin, force, ms, beta = 20 }: { spin: number; force: number; ms: number; beta?: number },
) => {
  await page.evaluate(
    ([rate, accel, duration, tilt]) => {
      const tick = setInterval(() => {
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', {
            alpha: 0,
            beta: tilt as number,
            gamma: 25,
          }),
        )
        window.dispatchEvent(
          new DeviceMotionEvent('devicemotion', {
            acceleration: { x: accel as number, y: accel as number, z: accel as number },
            rotationRate: {
              alpha: rate as number,
              beta: rate as number,
              gamma: rate as number,
            },
          }),
        )
      }, 16)
      setTimeout(() => clearInterval(tick), duration as number)
    },
    [spin, force, ms, beta] as const,
  )

  await page.waitForTimeout(ms + 200)
}

/**
 * Keep orientation events arriving with no movement in them.
 *
 * Not the same as waiting. `shake` and `turn` decay on each incoming event, so a
 * page that simply stops receiving them holds its last reading for ever — the
 * clock keeps running and the bed keeps sounding. Putting the phone down has to
 * be simulated as events, because that is what a phone on a table sends.
 */
const hold = async (page: import('@playwright/test').Page, ms: number) => {
  await page.evaluate((duration) => {
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
    setTimeout(() => clearInterval(tick), duration as number)
  }, ms)

  await page.waitForTimeout(ms + 200)
}

const voices = (page: import('@playwright/test').Page) =>
  page
    .locator('[data-testid=voices]')
    .innerText()
    .then((text) => Number(text.replace(/\D/g, '')))

test('the tap clock spawns voices and every one of them frees itself', async ({ page }) => {
  await boot(page)

  // Shake only. The tap layer is the one that allocates, and a percussive voice
  // with no sustain is exactly where a missing doneAction hides: the page sounds
  // right for thirty seconds and then silently runs out of nodes.
  await move(page, { spin: 0, force: 10, ms: 6000 })

  // Six seconds at the top of the rate curve is ~35 taps. The threshold is low
  // enough to survive a slow runner and far enough above zero to mean the clock
  // ran rather than fired once.
  const spawned = Number(await value(page, 'events'))
  expect(spawned, 'the clock reported no taps').toBeGreaterThan(10)

  // Then put it down. Two synths are permanent here and not one: the clock and
  // the held bed. Every tap lives at most 25ms, so once the shaking stops there
  // can be nothing else left — and the count above proves there was something
  // to free.
  await hold(page, 4000)
  await expect.poll(() => voices(page), { timeout: 15_000 }).toBe(2)
})

test('the three gestures reach three different layers', async ({ page }) => {
  await boot(page)

  // Turn without shaking: the flutter must move and the taps must not strike.
  await move(page, { spin: 320, force: 0.2, ms: 4000 })
  const turnedFlutter = Number((await value(page, 'flutter')).replace('Hz', ''))
  const turnedStrike = Number(await value(page, 'strike'))

  // Put it down in between, so the first gesture has actually decayed before the
  // second is measured. Without this the two readings share a tail.
  await hold(page, 3000)

  // Shake without turning: the opposite.
  await move(page, { spin: 0, force: 11, ms: 4000 })
  const shakenFlutter = Number((await value(page, 'flutter')).replace('Hz', ''))
  const shakenStrike = Number(await value(page, 'strike'))

  expect(turnedFlutter, 'turning did not raise the flutter rate').toBeGreaterThan(shakenFlutter)
  expect(shakenStrike, 'shaking did not strike').toBeGreaterThan(turnedStrike)
})

test('the flutter sweep is reported as a named regime, not just a rate', async ({ page }) => {
  await boot(page)

  // The readout that says what the instrument is doing rather than what its
  // numbers are. Hard rotation has to reach the fused end of the sweep.
  await move(page, { spin: 400, force: 0.2, ms: 5000 })

  const felt = await value(page, 'felt as')
  expect(['flutter', 'rough', 'fused'], `hard rotation reported "${felt}"`).toContain(felt)
})

test('three layers at once sound, and do not clip', async ({ page }) => {
  await boot(page)

  // Everything at once: shaken, turned and tilted. This is the case where three
  // claims on the same diaphragm travel would show up as clipping, which is what
  // the ducking and the shared limiter exist to prevent.
  await move(page, { spin: 300, force: 10, ms: 6000, beta: 70 })

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
    const from = Math.floor(taken.frames * 0.1)
    const to = Math.floor(taken.frames * 0.9)
    for (let at = from; at < to; at++) {
      const value = taken.left[at] ?? 0
      sumSquares += value * value
      if (Math.abs(value) > peak) peak = Math.abs(value)
    }
    return { rms: Math.sqrt(sumSquares / Math.max(1, to - from)), peak }
  })

  expect(heard.rms, 'three layers driven hard produced no signal').toBeGreaterThan(0.002)
  expect(heard.peak, 'the shared limiter did not hold').toBeLessThan(0.99)
})

test('a still phone is silent, however it is being held', async ({ page }) => {
  await boot(page)

  // Tilt is the one input that does not return to zero on its own, so it is the
  // one that could leave a page droning on a desk. Orientation events only: no
  // acceleration, no rotation.
  await page.evaluate(() =>
    window.dispatchEvent(
      new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 75, gamma: 40 }),
    ),
  )
  await page.waitForTimeout(1500)

  expect(Number(await value(page, 'bed'))).toBe(0)
  await expect(page.locator('[data-testid=playing]')).toContainText('stopped')
})

/**
 * The control panel, which exists because the first report from a hand was that
 * the taps were too short to feel.
 *
 * `apps/thrum/test/layers.test.ts` already pins what each control does to the
 * mapping. What only a browser can show is that the panel reaches the engine at
 * all — and, for free run, that the page sounds with the device completely
 * still, which is the one thing the shell is otherwise careful to prevent.
 */
test('free run sounds with no sensor events whatsoever', async ({ page }) => {
  await boot(page)

  // Not one orientation or motion event is dispatched in this test. On a desktop
  // none arrive on their own either, so `motion.live` is false and the shell
  // sends nothing — which is correct for every other page and would make free
  // run silently useless. The toggle wakes the shell itself.
  await page.locator('[data-testid=ctl-free-run]').check()
  await page.waitForTimeout(1500)

  // The badge shows the event count when it is sounding and "stopped — move to
  // start" when it is not, so the absence of the second is the assertion. There
  // is no literal "playing" in it.
  await expect(page.locator('[data-testid=playing]')).not.toContainText('stopped')
  await expect.poll(() => value(page, 'events'), { timeout: 15_000 }).not.toBe('0')

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
    const from = Math.floor(taken.frames * 0.1)
    const to = Math.floor(taken.frames * 0.9)
    for (let at = from; at < to; at++) {
      const v = taken.left[at] ?? 0
      sumSquares += v * v
      if (Math.abs(v) > peak) peak = Math.abs(v)
    }
    return { rms: Math.sqrt(sumSquares / Math.max(1, to - from)), peak }
  })

  expect(heard.rms, 'free run produced no signal from a still device').toBeGreaterThan(0.002)
  expect(heard.peak, 'free run clipped').toBeLessThan(0.99)
})

test('the pulse control crosses the tap/buzz boundary and says which side it is on', async ({
  page,
}) => {
  await boot(page)
  await page.locator('[data-testid=ctl-free-run]').check()

  // The readout names the side rather than only the number, the same way the
  // flutter rate is reported as a named regime. 30ms means nothing on its own.
  await page.locator('[data-testid=ctl-pulse]').fill('0.005')
  await expect.poll(() => value(page, 'pulse'), { timeout: 10_000 }).toContain('tap')

  await page.locator('[data-testid=ctl-pulse]').fill('0.3')
  await expect.poll(() => value(page, 'pulse'), { timeout: 10_000 }).toContain('buzz')
})

test('muting all three layers silences the page without stopping it', async ({ page }) => {
  await boot(page)
  await page.locator('[data-testid=ctl-free-run]').check()
  await page.waitForTimeout(800)

  for (const layer of ['taps', 'flutter', 'carrier']) {
    await page.locator(`[data-testid=ctl-mute-${layer}]`).uncheck()
  }
  await page.waitForTimeout(1200)

  // The bed is a held voice: muted means zero amplitude, not freed. And the taps
  // mute by closing the clock's own gate, so the node count must come back to
  // the two permanent synths rather than carrying silent voices.
  expect(Number(await value(page, 'bed'))).toBe(0)
  await expect.poll(() => voices(page), { timeout: 15_000 }).toBe(2)
})
