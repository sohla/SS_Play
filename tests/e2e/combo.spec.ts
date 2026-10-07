import { expect, test } from '@playwright/test'

/**
 * The combo page: a kit, a moog bass and a piano line on one two-second bar.
 *
 * What is worth asserting is the brief rather than the plumbing — that the three
 * layers divide a common bar, that rotation and acceleration do *different* jobs,
 * and that the root moves on a flick and not on every knock.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
test.setTimeout(400_000)

const boot = async (page: import('@playwright/test').Page) => {
  await page.goto('/combo/?debug=1')
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=playing]').waitFor({ timeout: 40_000 })
}

const value = (page: import('@playwright/test').Page, name: string) =>
  page.locator(`[data-testid="value-${name}"]`).innerText()

/**
 * Drive the two gestures independently, which is the only way to test that they
 * are independent. `spin` is rotation rate; `force` is linear acceleration.
 */
const move = (
  page: import('@playwright/test').Page,
  { spin, force, ms }: { spin: number; force: number; ms: number },
) =>
  page.evaluate(
    ([rate, accel, duration]) => {
      let n = 0
      const tick = setInterval(() => {
        n++
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', {
            alpha: (n * 6) % 360,
            beta: 20 * Math.sin(n / 11),
            gamma: 15 * Math.cos(n / 9),
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
    [spin, force, ms] as const,
  )

test('all three layers sound together', async ({ page }) => {
  await boot(page)
  await move(page, { spin: 300, force: 9, ms: 8000 })
  await page.waitForTimeout(2000)

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

  expect(heard.rms).toBeGreaterThan(0.002)
  // Three layers at once is the case where clipping would show up.
  expect(heard.peak).toBeLessThan(0.99)
})

test('every layer divides the same bar', async ({ page }) => {
  await boot(page)
  await move(page, { spin: 300, force: 9, ms: 5000 })
  await page.waitForTimeout(1500)

  // The brief: durations are subdivisions of each other. Read as counts per bar,
  // that means each one divides the largest — which is what keeps three
  // independently scheduled conductors from sounding like three machines.
  const counts = await Promise.all(
    ['kit', 'bass', 'melody'].map(async (layer) =>
      Number((await value(page, layer)).split(' ')[0]),
    ),
  )

  const largest = Math.max(...counts)
  for (const count of counts) {
    expect(largest % count, `${counts.join(' / ')} per bar do not divide`).toBe(0)
  }
  // And each is a power of two, so they also divide each other rather than only
  // the largest.
  for (const count of counts) expect(Number.isInteger(Math.log2(count))).toBe(true)
})

test('rotation widens the pitch set and acceleration does not', async ({ page }) => {
  await boot(page)

  // The distinction the brief asks for: rotation is the smooth control. Shaking
  // hard without turning must not open the pitch set.
  await move(page, { spin: 10, force: 12, ms: 3000 })
  await page.waitForTimeout(900)
  const shakenOnly = Number((await value(page, 'pool')).split(' ')[0])

  await move(page, { spin: 400, force: 12, ms: 3000 })
  await page.waitForTimeout(900)
  const turned = Number((await value(page, 'pool')).split(' ')[0])

  expect(turned, `pool was ${shakenOnly} shaken, ${turned} turned`).toBeGreaterThan(shakenOnly)
})

test('acceleration steps the rhythm and rotation does not', async ({ page }) => {
  await boot(page)

  // The other half: turning hard without shaking must leave the subdivision
  // alone, so you can open the harmony up without the rhythm changing under you.
  await move(page, { spin: 400, force: 1, ms: 3000 })
  await page.waitForTimeout(900)
  const turnedOnly = Number((await value(page, 'kit')).split(' ')[0])

  await move(page, { spin: 400, force: 12, ms: 3000 })
  await page.waitForTimeout(900)
  const shaken = Number((await value(page, 'kit')).split(' ')[0])

  expect(shaken, `kit was ${turnedOnly} turned, ${shaken} shaken`).toBeGreaterThan(turnedOnly)
})

test('the root moves on a flick, and not more than once a bar', async ({ page }) => {
  await boot(page)

  // Sustained hard movement for eight seconds. The bar is 2s and the floor is one
  // bar, so four shifts is the ceiling — a root that moved on every knock would
  // run through the four-chord cycle several times over.
  const seen: string[] = []
  await move(page, { spin: 300, force: 12, ms: 9000 })
  for (let n = 0; n < 20; n++) {
    seen.push(await value(page, 'root'))
    await page.waitForTimeout(450)
  }

  const distinct = [...new Set(seen)]
  expect(distinct.length, `root never moved: ${distinct.join(',')}`).toBeGreaterThan(1)

  // Every root it visits must be one of the four in the progression — i, iv, VI,
  // III — so a shift cannot leave the mode.
  for (const root of distinct) {
    expect(['i', 'iv', 'VI', 'III'].some((name) => root.startsWith(name))).toBe(true)
  }

  // Count the changes rather than the distinct values: four in nine seconds is
  // the floor working.
  const changes = seen.filter((root, at) => at > 0 && root !== seen[at - 1]).length
  expect(changes, `${changes} shifts in 9s, floor is one per 2s bar`).toBeLessThanOrEqual(6)
})

test('the melody stays inside the pitch set it is given', async ({ page }) => {
  await boot(page)
  await move(page, { spin: 50, force: 9, ms: 6000 })
  await page.waitForTimeout(1200)

  // At the narrow end the pool is three notes — root, fifth, minor third — so
  // every note sounded has to be one of those three above the current root.
  const pool = Number((await value(page, 'pool')).split(' ')[0])
  const notes = new Set<number>()
  for (let n = 0; n < 20; n++) {
    notes.add(Number(await value(page, 'note')))
    await page.waitForTimeout(150)
  }

  const DEGREES = [0, 7, 3, 10, 5, 2, 8]
  const allowed = new Set(DEGREES.slice(0, pool))
  for (const note of notes) {
    // The root moves and octaves alternate, so the test is on the pitch class
    // relative to the tonic rather than the absolute note.
    const degree = ((note - 45) % 12 + 12) % 12
    const reachable = [...allowed].some((d) => [0, 5, 8, 3].some((r) => (d + r) % 12 === degree))
    expect(reachable, `note ${note} (degree ${degree}) is outside a ${pool}-note pool`).toBe(true)
  }
})

test('combo stays inside the decoded-audio budget', async ({ page }) => {
  await boot(page)

  // The full kit and the full piano library together are 6.15MB, which stalls an
  // iPhone. This page takes six drums and three octaves instead.
  const megabytes = await page.evaluate(() => {
    const sonic = (
      window as unknown as {
        __ss: { sonic: { getLoadedBuffers(): { numFrames: number; numChannels: number }[] } }
      }
    ).__ss.sonic
    return (
      sonic.getLoadedBuffers().reduce((t, b) => t + b.numFrames * b.numChannels * 4, 0) / 1048576
    )
  })

  expect(megabytes, `${megabytes.toFixed(2)}MB decoded`).toBeLessThan(3.7)
})
