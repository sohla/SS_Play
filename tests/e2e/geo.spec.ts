import { expect, test, type Page } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

const path = sites.pages.find((page) => page.app === 'geo')!.path

const HOME = { latitude: -37.8136, longitude: 144.9631, accuracy: 5 }

test.use({ geolocation: HOME, permissions: ['geolocation'] })

/** Where the page says the target is: metres and bearing from here. */
async function target(page: Page) {
  const text = await page.locator('[data-testid=geo-target]').innerText()
  const match = text.match(/^([\d.]+) m at (\d+)°$/)
  return match ? { metres: Number(match[1]), bearing: Number(match[2]) } : null
}

/** A position `metres` from `from` on `bearing`, in degrees of lat/lon. */
function moved(from: typeof HOME, metres: number, bearing: number) {
  const rad = Math.PI / 180
  const north = metres * Math.cos(bearing * rad)
  const east = metres * Math.sin(bearing * rad)
  return {
    ...from,
    latitude: from.latitude + north / 6_371_000 / rad,
    longitude: from.longitude + east / (6_371_000 * Math.cos(from.latitude * rad)) / rad,
  }
}

async function boot(page: Page) {
  await page.goto(`${path}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=geo-map]').waitFor({ timeout: 30_000 })
}

test('a target is placed 10–30m away once the phone knows where it is', async ({ page }) => {
  await boot(page)
  await expect.poll(() => target(page), { timeout: 15_000 }).not.toBeNull()
  const { metres } = (await target(page))!
  expect(metres).toBeGreaterThanOrEqual(10)
  expect(metres).toBeLessThanOrEqual(30)
  await expect(page.locator('[data-testid=value-accuracy]')).toHaveText('±5 m')
})

test('walking to it settles the drone into a pure fifth', async ({ page, context }) => {
  await boot(page)
  await expect.poll(() => target(page), { timeout: 15_000 }).not.toBeNull()
  const { metres, bearing } = (await target(page))!
  const startBeat = Number.parseFloat(await page.locator('[data-testid=value-fifth-out-by]').innerText())

  // Ten fixes along the way, a second apart, then a few at the spot — the
  // filter needs more than one fix to believe a move.
  const goal = moved(HOME, metres, bearing)
  for (let step = 1; step <= 10; step++) {
    await context.setGeolocation(moved(HOME, (metres * step) / 10, bearing))
    await page.waitForTimeout(400)
  }
  for (let n = 0; n < 6; n++) {
    await context.setGeolocation(goal)
    await page.waitForTimeout(400)
  }

  await expect(page.locator('[data-testid=geo-target]')).toHaveText('arrived', { timeout: 10_000 })
  const endBeat = Number.parseFloat(await page.locator('[data-testid=value-fifth-out-by]').innerText())
  expect(startBeat).toBeGreaterThan(1)
  expect(endBeat).toBeLessThan(0.4)

  // And it is sounding: the drone was born at amp 0.07 and only gets louder.
  const peak = await page.evaluate(async () => {
    const session = (window as unknown as { __ss: { sonic: { audioContext: AudioContext; node: AudioNode } } }).__ss
    const analyser = session.sonic.audioContext.createAnalyser()
    session.sonic.node.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    let loudest = 0
    for (let n = 0; n < 50; n++) {
      analyser.getFloatTimeDomainData(samples)
      for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample))
      await new Promise((done) => setTimeout(done, 20))
    }
    return loudest
  })
  expect(peak).toBeGreaterThan(0.01)
})

test('the drone is clearly brighter facing the target, and loud without clipping', async ({ page }) => {
  await boot(page)
  // The drone at its loudest, facing away and then facing the target, measured
  // straight off the engine: no compass in a headless browser to turn.
  const measured = await page.evaluate(async () => {
    type Arg = { type: 'int' | 'float'; value: number }
    const session = (
      window as unknown as {
        __ss: { sonic: { audioContext: AudioContext; node: AudioNode; nextNodeId(): number; send(...args: unknown[]): void } }
      }
    ).__ss
    const f = (value: number): Arg => ({ type: 'float', value })
    const n = (value: number): Arg => ({ type: 'int', value })
    const id = session.sonic.nextNodeId()
    // The page's own drone would sound alongside; silence it first.
    session.sonic.send('/g_freeAll', n(0))
    await new Promise((done) => setTimeout(done, 200))
    session.sonic.send('/s_new', 'ssp_geo_drone', n(id), n(0), n(0), 'amp', f(0.35), 'cutoff', f(200), 'beat', f(0), 'lag', f(0.05), 'turn', f(0.05))

    const analyser = session.sonic.audioContext.createAnalyser()
    analyser.fftSize = 4096
    session.sonic.node.connect(analyser)
    const bins = new Float32Array(analyser.frequencyBinCount)
    const samples = new Float32Array(analyser.fftSize)
    const hz = session.sonic.audioContext.sampleRate / analyser.fftSize

    /**
     * The share of energy above 1kHz, in dB, and the peak, over half a second.
     * Not a spectral centroid: a saw's energy falls so steeply with harmonic
     * number that its centroid barely leaves the fundamental, however bright
     * it sounds. The first version of this test measured that, and read a
     * 30dB change in treble as no change at all.
     */
    const listen = async () => {
      let treble = 0
      let peak = 0
      for (let k = 0; k < 10; k++) {
        await new Promise((done) => setTimeout(done, 50))
        analyser.getFloatFrequencyData(bins)
        let total = 0
        let high = 0
        bins.forEach((db, bin) => {
          const power = 10 ** (db / 10)
          total += power
          if (bin * hz > 1000) high += power
        })
        treble += (10 * Math.log10(high / total)) / 10
        analyser.getFloatTimeDomainData(samples)
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
      }
      return { treble, peak }
    }

    // Past the 4s attack.
    await new Promise((done) => setTimeout(done, 4500))
    const away = await listen()
    session.sonic.send('/n_set', n(id), 'cutoff', f(6400))
    await new Promise((done) => setTimeout(done, 600))
    const toward = await listen()
    return { away, toward }
  })

  // Facing the target puts tens of dB more into the treble — measured at 55 —
  // and is louder, not quieter, than facing away.
  expect(measured.toward.treble - measured.away.treble).toBeGreaterThan(30)
  expect(measured.toward.peak).toBeGreaterThan(measured.away.peak)
  // Present on a phone speaker, and nowhere near clipping.
  expect(measured.toward.peak).toBeGreaterThan(0.3)
  expect(measured.toward.peak).toBeLessThan(0.8)
})
