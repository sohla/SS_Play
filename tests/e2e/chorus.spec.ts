import { expect, test, type Page } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

const path = sites.pages.find((page) => page.app === 'chorus')!.path

/**
 * Loopback throughout: the listener reads the page's own output bus, so the
 * calls reach the detector without a speaker, a room or a microphone — none of
 * which a headless browser has. What it proves is the detector, the timing and
 * the coupling; what it cannot is that a call carries across a real room.
 */
async function boot(page: Page, voices: number) {
  await page.goto(`${path}?debug=1&loopback=1&voices=${voices}`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=chorus-circle]').waitFor({ timeout: 30_000 })
}

const value = (page: Page, name: string) => page.locator(`[data-testid=value-${name}]`).innerText()

test('a caller alone hears its own call, learns its delay, and couples to nothing', async ({
  page,
}) => {
  await boot(page, 1)

  // Three agreeing self-detections, a call every ~2s with calibration jitter.
  await expect.poll(() => value(page, 'own-delay'), { timeout: 20_000 }).toMatch(/^\d+ms$/)

  // Loopback has no speaker or mic in the way, so this is the detector's own
  // latency, and it reads *under* the 80ms call: it is measured from the
  // timetag, and Chrome renders ~35ms ahead of a timetag (see
  // `uncompensatedLatencyS`); the detector's clock is also anchored a block or
  // two before its synth starts. The model only takes differences on that
  // clock, so the number need only be steady — hence a wide band.
  const delay = Number.parseInt(await value(page, 'own-delay'))
  expect(delay).toBeGreaterThan(0)
  expect(delay).toBeLessThan(140)
  await page.waitForTimeout(4000)
  expect(Number.parseInt(await value(page, 'own-delay')), 'the delay moved once fixed').toBe(delay)
  expect(await value(page, 'heard')).toBe('0')
})

test('callers in one room hear each other', async ({ page }) => {
  await boot(page, 3)

  // Each of the three hears the others once calibrated. The page reads out the
  // first caller; anything above zero is a call it took to be someone else's.
  await expect
    .poll(async () => Number(await value(page, 'heard')), { timeout: 30_000 })
    .toBeGreaterThan(0)
  expect(await value(page, 'together')).toMatch(/^\d\.\d\d$/)
})

test('the detector hears the call, or one like it, and nothing else', async ({ page }) => {
  test.setTimeout(120_000)
  await boot(page, 1)
  await expect.poll(() => value(page, 'own-delay'), { timeout: 20_000 }).toMatch(/^\d+ms$/)

  // Ten of each, 600ms apart, against the page's own call every ~2s. What is
  // counted is detections beyond the page's own calls in the same stretch.
  const extra = await page.evaluate(async () => {
    type Arg = { type: 'int' | 'float'; value: number }
    const session = (
      window as unknown as {
        __ss: {
          sonic: { loadSynthDef(name: string): Promise<unknown>; nextNodeId(): number; send(...args: unknown[]): void }
          dispatcher: { on(address: string, handler: () => void): () => void }
        }
      }
    ).__ss
    await session.sonic.loadSynthDef('ssp_noise')
    await session.sonic.loadSynthDef('ssp_sine')

    let heard = 0
    session.dispatcher.on('/ssp_heard', () => (heard += 1))
    const f = (value: number): Arg => ({ type: 'float', value })
    const n = (value: number): Arg => ({ type: 'int', value })
    const play = (def: string, args: Arg[], holdMs = 0) => {
      const id = session.sonic.nextNodeId()
      session.sonic.send('/s_new', def, n(id), n(0), n(0), ...args)
      if (holdMs) setTimeout(() => session.sonic.send('/n_set', n(id), 'gate', n(0)), holdMs)
    }
    const named = (pairs: Record<string, number>) =>
      Object.entries(pairs).flatMap(([name, value]) => [name as unknown as Arg, f(value)])

    const sounds: Record<string, () => void> = {
      // A clap: broadband, 30ms.
      burst: () => play('ssp_noise', named({ cutoff: 12000, rq: 1, amp: 0.6, attack: 0.001, release: 0.02 }), 30),
      // A held tone inside the call's band.
      tone: () => play('ssp_sine', named({ freq: 3500, amp: 0.3, cutoff: 10000 }), 200),
      // The call backwards in frequency.
      upward: () => play('ssp_call', named({ from: 2500, to: 5000, amp: 0.3 })),
      call: () => play('ssp_call', named({ amp: 0.3 })),
      // A slower, narrower slur — a person whistling it, roughly.
      similar: () => play('ssp_call', named({ from: 4500, to: 2700, dur: 0.12, amp: 0.3 })),
    }

    const calls = () => Number(document.querySelector('[data-testid=value-calls]')!.textContent)
    const result: Record<string, number> = {}
    for (const [name, sound] of Object.entries(sounds)) {
      const before = heard
      const ownBefore = calls()
      for (let k = 0; k < 10; k++) {
        sound()
        await new Promise((done) => setTimeout(done, 600))
      }
      await new Promise((done) => setTimeout(done, 400))
      result[name] = heard - before - (calls() - ownBefore)
    }
    return result
  })

  // One either way is the page's own call and an injected sound landing inside
  // one holdoff of each other, which is one detection where there were two.
  expect(extra['burst']).toBeLessThanOrEqual(1)
  expect(extra['tone']).toBeLessThanOrEqual(1)
  expect(extra['upward']).toBeLessThanOrEqual(1)
  expect(extra['call']).toBeGreaterThanOrEqual(7)
  expect(extra['similar']).toBeGreaterThanOrEqual(7)
})
