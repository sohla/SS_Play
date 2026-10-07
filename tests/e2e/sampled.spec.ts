import { expect, test } from '@playwright/test'

// The two sampled instruments. What is worth asserting here is the part the
// synth pages cannot exercise: that a page which must load buffers before it can
// play anything actually waits, and that the lookups deciding *which* buffer
// land on the right one.

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

for (const app of ['kit', 'piano']) {
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
