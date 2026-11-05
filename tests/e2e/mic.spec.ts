import { expect, test, type Page } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

const path = sites.pages.find((page) => page.app === 'mic')!.path

// Chrome's fake capture device: a microphone that plays a periodic beep, and
// the permission prompt answered yes. `--mute-audio` is repeated because this
// replaces the config's launch args rather than adding to them.
test.use({
  launchOptions: {
    args: ['--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['microphone'],
})

async function boot(page: Page) {
  await page.goto(`${path}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=mic-db]').waitFor({ timeout: 30_000 })
}

/** The loudest the engine's output gets over `ms`, read at the worklet. */
function outputPeak(page: Page, ms: number) {
  return page.evaluate(async (duration) => {
    const session = (window as unknown as { __ss: { sonic: { audioContext: AudioContext; node: AudioNode } } }).__ss
    const analyser = session.sonic.audioContext.createAnalyser()
    analyser.fftSize = 2048
    session.sonic.node.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    let peak = 0
    const end = performance.now() + duration
    while (performance.now() < end) {
      analyser.getFloatTimeDomainData(samples)
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
      await new Promise((done) => setTimeout(done, 20))
    }
    session.sonic.node.disconnect(analyser)
    return peak
  }, ms)
}

test('scsynth hears the microphone, and the meter shows it', async ({ page }) => {
  await boot(page)

  // The follower's own reports, read beside the page's. The fake device beeps
  // at 0 dBFS about once a second, so the mic path is either near full scale or
  // broken — nothing in between is a matter of tuning.
  const loudest = await page.evaluate(async () => {
    const session = (window as unknown as { __ss: { dispatcher: { on(address: string, handler: (message: unknown[]) => void): () => void } } }).__ss
    let max = 0
    const off = session.dispatcher.on('/ssp_mic', (message) => {
      if (typeof message[3] === 'number') max = Math.max(max, message[3])
    })
    await new Promise((done) => setTimeout(done, 4000))
    off()
    return max
  })
  expect(20 * Math.log10(loudest), 'the follower never heard the beep').toBeGreaterThan(-12)

  // The beep is short, so this relies on the meter's fall to be seen at all.
  await expect
    .poll(async () => page.locator('[data-testid=mic-db]').innerText(), { timeout: 5000 })
    .not.toBe('silent')
})

test('the mic level drives the drone', async ({ page }) => {
  await boot(page)
  // The drone starts at amp 0 and only the mapped bus can raise it.
  const peak = await outputPeak(page, 4000)
  expect(peak, 'nothing sounded: the bus map or the mic path is broken').toBeGreaterThan(0.01)
  // `ceiling` caps the follower at 0.3; the drone's two oscillators sum to 1.1
  // before its pan, so this is the most it can reach.
  expect(peak).toBeLessThan(0.99)
})
