import { expect, test } from '@playwright/test'

// The sampled instruments. What is worth asserting here is the part the synth
// pages cannot exercise: that a page which must load buffers before it can play
// anything actually waits, that the lookups deciding *which* buffer land on the
// right one, and — for the dulcimer — that a voice routed through a private bus
// reaches the output at all.
//
// The dulcimer's nine-of-twenty-six library is argued for in
// apps/dulcimer/test/library.test.ts, which checks the reduction against the
// full pitch list rather than trusting it.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const boot = async (page: import('@playwright/test').Page, app: string) => {
  await page.goto(`/${app}/?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  // The instrument appears only once the samples are in — see `ready` on
  // MotionInstrument.
  await page.locator('[data-testid=playing]').waitFor({ timeout: 30_000 })
}

const shake = (page: import('@playwright/test').Page, ms: number, strength = 7) =>
  page.evaluate(
    ([duration, force]) => {
      const tick = setInterval(() => {
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 20, gamma: 15 }),
        )
        window.dispatchEvent(
          new DeviceMotionEvent('devicemotion', {
            acceleration: { x: force as number, y: force as number, z: force as number },
            rotationRate: { alpha: 200, beta: 150, gamma: 100 },
          }),
        )
      }, 16)
      setTimeout(() => clearInterval(tick), duration as number)
    },
    [ms, strength] as const,
  )

const value = (page: import('@playwright/test').Page, name: string) =>
  page.locator(`[data-testid="value-${name}"]`).innerText()

const events = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid=value-events]').innerText().then(Number)

for (const app of ['kit', 'piano', 'dulcimer', 'marimba']) {
  test(`${app} waits for its samples before claiming to be an instrument`, async ({ page }) => {
    await page.goto(`/${app}/?debug=1`)
    await page.getByRole('button', { name: 'Start audio' }).click()
    await page.locator('[data-testid=engine-footer]').waitFor({ timeout: 30_000 })

    // Either it is still loading or it is already done — but it must never be
    // showing an instrument with no buffers behind it, which would be a page
    // that looks alive and is silent.
    await page.locator('[data-testid=playing]').waitFor({ timeout: 30_000 })
    await expect(page.locator('[data-testid=pending]')).toHaveCount(0)
  })

  test(`${app} is silent until moved, then sounds`, async ({ page }) => {
    await boot(page, app)
    await page.waitForTimeout(1200)
    await expect(page.locator('[data-testid=playing]')).toContainText('stopped')

    await shake(page, 4000)
    await expect.poll(() => events(page), { timeout: 10_000 }).toBeGreaterThan(3)
  })

  test(`${app} frees its voices rather than filling maxNodes`, async ({ page }) => {
    await boot(page, app)

    const sample = async (seconds: number) => {
      await shake(page, seconds * 1000)
      await page.waitForTimeout(seconds * 1000 + 200)
      const alive = Number((await page.locator('[data-testid=voices]').innerText()).replace(/\D/g, ''))
      return { spawned: await events(page), alive }
    }

    const first = await sample(3)
    const second = await sample(3)

    expect(second.spawned, 'the pattern stopped').toBeGreaterThan(first.spawned)
    // One-shots, so nothing should accumulate at all — but the window includes
    // notes legitimately still sounding, hence a plateau rather than a number.
    expect(
      second.alive,
      `${first.alive} alive at ${first.spawned} events, ${second.alive} at ${second.spawned}`,
    ).toBeLessThan(first.alive * 1.6 + 8)
  })
}

test('the kit divides the bar more finely the harder it is moved', async ({ page }) => {
  await boot(page, 'kit')

  // The page's whole point: energy picks one of three subdivisions, so the
  // rhythm changes resolution rather than tempo.
  await shake(page, 2500, 1)
  await page.waitForTimeout(600)
  const gentle = await value(page, 'bar')

  await shake(page, 2500, 12)
  await page.waitForTimeout(600)
  const hard = await value(page, 'bar')

  const steps = (text: string) => Number(text.replace(/\D/g, ''))
  expect(steps(hard), `gentle gave ${gentle}, hard gave ${hard}`).toBeGreaterThan(steps(gentle))
  expect([2, 4, 8]).toContain(steps(hard))
})

test('the kit widens its palette with energy and keeps the kick on the downbeat', async ({
  page,
}) => {
  await boot(page, 'kit')

  await shake(page, 2500, 12)
  await page.waitForTimeout(600)

  // 12 drums loaded, sorted short to long. A full palette means the off-beats
  // can reach the rides at the long end.
  await expect(page.locator('[data-testid=value-palette]')).toContainText('of 12')
})

test('the piano reports which sample it stretched and by how much', async ({ page }) => {
  await boot(page, 'piano')
  await shake(page, 14_000, 12)

  // Let the ballistic envelope reach the top of its travel before sampling. At
  // rest the pattern runs at two notes a second, so a window opened immediately
  // covers only a few of the sixteen notes in the cycle — and the four with the
  // largest stretch are the last quarter of it. That was the whole of an earlier
  // flake against the live site: nothing to do with the page, everything to do
  // with reading a 10Hz display before the gesture had ramped.
  await page.waitForTimeout(1500)

  // The arpeggio climbs four octaves against six samples an octave apart, so the
  // shift has to move — a constant shift would mean the lookup is not running.
  const seen = new Set<string>()
  const samples = new Set<string>()
  for (let n = 0; n < 50; n++) {
    seen.add(await value(page, 'shift'))
    samples.add(await value(page, 'sample'))
    await page.waitForTimeout(150)
  }

  expect(seen.size, `only ever reported shift ${[...seen].join(',')}`).toBeGreaterThan(2)
  expect(samples.size, `only ever used ${[...samples].join(',')}`).toBeGreaterThan(1)

  // Every sample named must be one of the six that exist.
  for (const name of samples) expect(['C0', 'C1', 'C2', 'C3', 'C4', 'C5', '—']).toContain(name)

  // The claim worth pinning: the top octave reaches MIDI 83 against a highest
  // sample of C5 at 72, so the stretch goes well past the ±6 the library's
  // spacing would suggest.
  const shifts = [...seen].map(Number).filter(Number.isFinite)
  expect(Math.max(...shifts.map(Math.abs))).toBeGreaterThan(6)
})

test('the piano plays faster and louder from the same gesture', async ({ page }) => {
  await boot(page, 'piano')

  await shake(page, 2500, 1)
  await page.waitForTimeout(500)
  const slow = Number(await value(page, 'notes/s'))

  await shake(page, 2500, 14)
  await page.waitForTimeout(500)
  const fast = Number(await value(page, 'notes/s'))

  // 2/s at rest to 20/s flat out, both from one number.
  expect(fast, `${slow}/s gentle, ${fast}/s hard`).toBeGreaterThan(slow * 1.5)
})

test('the dulcimer reaches the output through a private bus, not directly', async ({ page }) => {
  await boot(page, 'dulcimer')
  await shake(page, 6000)
  await page.waitForTimeout(1200)

  // Every voice writes to a private bus and an fx synth at the root group's tail
  // reads it. Three ways that silently produces nothing: the wrong bus number,
  // the fx synth missing, or the fx synth executing before the voices. None of
  // them raises anything — the page looks alive and plays nothing — so the only
  // real check is that audio arrives.
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
    const deadline = performance.now() + 4000
    while (sonic.getCaptureFrames() < 0.5 * 48_000 && performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    const taken = sonic.stopCapture()

    let sumSquares = 0
    const from = Math.floor(taken.frames * 0.1)
    const to = Math.floor(taken.frames * 0.9)
    for (let at = from; at < to; at++) sumSquares += (taken.left[at] ?? 0) ** 2
    return Math.sqrt(sumSquares / Math.max(1, to - from))
  })

  expect(heard, 'silent — the fx routing is wrong somewhere').toBeGreaterThan(0.002)
})

test('the dulcimer plays more notes per bar as it is moved, not faster ones', async ({ page }) => {
  await boot(page, 'dulcimer')

  // `pool.keep(div)`: a finer bar reaches further down the note pool. Both
  // readouts move together, which is the distinction worth pinning — the figure
  // gains notes rather than tempo.
  await shake(page, 2500, 1)
  await page.waitForTimeout(600)
  const gentle = await value(page, 'notes')

  await shake(page, 3000, 12)
  await page.waitForTimeout(600)
  const hard = await value(page, 'notes')

  const count = (text: string) => Number(text.split(' ')[0])
  expect(count(hard), `gentle ${gentle}, hard ${hard}`).toBeGreaterThan(count(gentle))
  expect(count(hard)).toBe(6)
})

test('the marimba divides the bar four ways and reaches further down the pool', async ({ page }) => {
  await boot(page, 'marimba')

  await shake(page, 2500, 1)
  await page.waitForTimeout(600)
  const gentle = { bar: await value(page, 'bar'), notes: await value(page, 'notes') }

  await shake(page, 3000, 14)
  await page.waitForTimeout(600)
  const hard = { bar: await value(page, 'bar'), notes: await value(page, 'notes') }

  const steps = (text: string) => Number(text.replace(/\D/g, ''))
  expect(steps(hard.bar), `gentle ${gentle.bar}, hard ${hard.bar}`).toBeGreaterThan(
    steps(gentle.bar),
  )
  // `pool.keep(div)` — a finer bar plays more different notes, not the same ones
  // faster. The two readouts move together by construction.
  expect(Number(hard.notes.split(' ')[0])).toBe(steps(hard.bar))
  expect([1, 2, 4, 8]).toContain(steps(hard.bar))
})

test('the marimba never stretches a bar more than two semitones', async ({ page }) => {
  await boot(page, 'marimba')
  await shake(page, 10_000, 12)
  await page.waitForTimeout(1200)

  // Four pitches per octave in the library, so a neighbour is always within two
  // semitones. A larger shift would mean the lookup is reaching for a sample
  // that is not there — which is what shipping the wrong ten would cause.
  const shifts = new Set<number>()
  for (let n = 0; n < 40; n++) {
    shifts.add(Number(await value(page, 'shift')))
    await page.waitForTimeout(150)
  }

  const seen = [...shifts].filter(Number.isFinite)
  expect(seen.length).toBeGreaterThan(1)
  expect(Math.max(...seen.map(Math.abs)), `saw shifts ${seen.join(',')}`).toBeLessThanOrEqual(2)
})

// The loading panel. A sampled page waits on a fetch and a decode per buffer,
// which is quick enough locally that the panel is almost never seen here — and
// long enough on a phone over mobile data to look like a page that has died.
// Throttled on purpose, because the condition the panel exists for is the one a
// fast local load never reaches.

test('the loading panel counts its way through the set', async ({ page }) => {
  await page.route('**/samples/*.flac', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.continue()
  })

  await page.goto('/marimba/?debug=1')
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=pending]').waitFor({ timeout: 30_000 })

  // A count is the difference between a slow load and a dead one, which is not
  // otherwise visible to whoever is holding the phone.
  const counts = new Set<string>()
  for (let n = 0; n < 8; n++) {
    if ((await page.locator('[data-testid=pending]').count()) === 0) break
    const text = await page.locator('[data-testid=pending]').innerText()
    const match = /(\d+) of (\d+)/.exec(text)
    if (match) counts.add(match[1] as string)
    await page.waitForTimeout(400)
  }

  expect(counts.size, `the count never moved: ${[...counts].join(',')}`).toBeGreaterThan(1)
})

test('the loading panel is animated, and stops when it fails', async ({ page }) => {
  await page.route('**/samples/*.flac', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.continue()
  })

  await page.goto('/marimba/?debug=1')
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=pending]').waitFor({ timeout: 30_000 })

  const waiting = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid=pending]')
    const style = panel ? getComputedStyle(panel) : null
    return { name: style?.animationName ?? 'none', image: style?.backgroundImage ?? '' }
  })

  // Asserted through the computed style rather than the class name, because a
  // class that Tailwind did not generate is still on the element and still
  // looks right in the markup.
  expect(waiting.name).toBe('ss-stripe-scroll')
  expect(waiting.image).toContain('repeating-linear-gradient')
})

test('a failed load names the file and stops looking busy', async ({ page }) => {
  // By filename, not by request count: each file is fetched more than once, so
  // counting requests fails a duplicate the engine has already satisfied.
  await page.route('**/samples/mar_65.flac', (route) =>
    route.fulfill({ status: 404, body: 'nope' }),
  )

  await page.goto('/marimba/?debug=1')
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=pending][data-failed=true]').waitFor({ timeout: 30_000 })

  // Which file it was is the whole diagnosis: a 404 is a store that was not
  // pushed, a decode error is a format the browser will not take, and a failure
  // partway through a set that started fine is memory.
  const text = await page.locator('[data-testid=pending]').innerText()
  expect(text).toContain('mar_65.flac')
  expect(text).toMatch(/\d+ of \d+ loaded/)

  // Moving stripes behind an error message say the page is still working on it,
  // which is the one thing an error must not say.
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid=pending]')!).animationName,
    ),
  ).toBe('none')
})
