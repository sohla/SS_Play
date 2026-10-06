import { expect, test } from '@playwright/test'

// The sample page, driven through its own controls rather than through the
// engine — the point is that loading a file into a buffer and looping it works
// from the UI a visitor actually has.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const boot = async (page: import('@playwright/test').Page) => {
  await page.goto('/sample/?debug=1')
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=engine-footer]').waitFor({ timeout: 30_000 })
}

/** Seconds of buffer, read off the page's own readout. */
const bufferSeconds = async (page: import('@playwright/test').Page) => {
  const text = await page.locator('[data-testid=buffer]').innerText()
  const match = /([\d.]+)s/.exec(text)
  if (!match) throw new Error(`no duration in "${text}"`)
  return Number(match[1])
}

/**
 * Record what reaches the output.
 *
 * SAB-only, which makes it a precondition rather than a convenience: a page that
 * silently fell back to postMessage would return zero frames, and a test that
 * tolerated that would be asserting nothing.
 */
async function capture(page: import('@playwright/test').Page, seconds: number) {
  return page.evaluate(async (want) => {
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
    const deadline = performance.now() + want * 1000 + 4000
    while (sonic.getCaptureFrames() < want * 48_000 && performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    const taken = sonic.stopCapture()

    // The middle 60%, so neither the attack nor the release is measured.
    const from = Math.floor(taken.frames * 0.2)
    const to = Math.floor(taken.frames * 0.8)
    let peak = 0
    let sumSquares = 0
    for (let at = from; at < to; at++) {
      const value = taken.left[at] ?? 0
      sumSquares += value * value
      if (Math.abs(value) > peak) peak = Math.abs(value)
    }
    return { frames: taken.frames, rms: Math.sqrt(sumSquares / Math.max(1, to - from)), peak }
  }, seconds)
}

test('the built-in sample loads into a buffer', async ({ page }) => {
  await boot(page)
  await expect(page.locator('[data-testid=buffer]')).toContainText('nothing loaded')

  await page.click('[data-testid=load]')

  // Frames, channels and a sample rate all come back from the decode, so a
  // readout with a real duration is evidence the browser decoded it rather than
  // that a fetch returned 200.
  await expect(page.locator('[data-testid=buffer]')).toContainText('buf ', { timeout: 20_000 })
  await expect(page.locator('[data-testid=sample-error]')).toHaveCount(0)

  expect(await bufferSeconds(page)).toBeGreaterThan(0.1)
})

test('it sounds once looped', async ({ page }) => {
  await boot(page)
  await page.click('[data-testid=load]')
  await expect(page.locator('[data-testid=buffer]')).toContainText('buf ', { timeout: 20_000 })

  await page.click('[data-testid=play]')
  await expect(page.locator('[data-testid=buffer]')).toContainText('looping')

  const heard = await capture(page, 0.4)
  expect(heard.frames).toBeGreaterThan(0.3 * 48_000)
  expect(heard.rms).toBeGreaterThan(0.001)
  expect(heard.peak).toBeLessThan(0.99)
})

test('it is still sounding after the buffer has run out, which is what looping means', async ({
  page,
}) => {
  await boot(page)
  await page.click('[data-testid=load]')
  await expect(page.locator('[data-testid=buffer]')).toContainText('buf ', { timeout: 20_000 })

  const seconds = await bufferSeconds(page)
  await page.click('[data-testid=play]')

  // Past the end of the buffer, then measure. A one-shot player would have run
  // out and gone silent here, and PlayBuf's default is one-shot — so this is the
  // assertion that `loop: 1` is actually set and that nothing freed the synth.
  await page.waitForTimeout(seconds * 1000 + 400)

  const heard = await capture(page, 0.4)
  expect(
    heard.rms,
    `silent ${seconds.toFixed(2)}s in, so it played once rather than looping`,
  ).toBeGreaterThan(0.001)
})

test('stop frees the loop rather than leaving it running', async ({ page }) => {
  await boot(page)
  await page.click('[data-testid=load]')
  await expect(page.locator('[data-testid=buffer]')).toContainText('buf ', { timeout: 20_000 })

  await page.click('[data-testid=play]')
  await expect(page.locator('[data-testid=buffer]')).toContainText('looping')
  await page.click('[data-testid=stop]')

  // Past the release, which the contract defaults to 0.3s.
  await page.waitForTimeout(1200)

  const heard = await capture(page, 0.3)
  expect(heard.rms).toBeLessThan(0.001)

  // And the node is gone, not merely silent. A looping PlayBuf has no
  // doneAction, so if the envelope did not free it the voice count would stay up
  // and every load would leak one.
  await expect(page.locator('[data-testid=voices]')).toContainText('0 voices')
})

test('rate reaches the loop while it sounds', async ({ page }) => {
  await boot(page)
  await page.click('[data-testid=load]')
  await expect(page.locator('[data-testid=buffer]')).toContainText('buf ', { timeout: 20_000 })
  await page.click('[data-testid=play]')

  // The generated control surface is the thing under test as much as the synth:
  // every range on this page comes from the def's contract, so a slider existing
  // at all is the contract having been read.
  const rate = page.getByRole('slider', { name: 'rate' })
  await expect(rate).toBeVisible()

  // The slider works in 0..1 and maps through the spec, so this is a position
  // rather than a rate — which is the normalisation that lets a touch position
  // or a MIDI CC drive the same control.
  const before = await rate.inputValue()
  await rate.fill('0.9')
  expect(await rate.inputValue()).not.toBe(before)

  // Still sounding after the change, which is what distinguishes a /n_set on the
  // live node from a restart.
  await expect(page.locator('[data-testid=buffer]')).toContainText('looping')
  const heard = await capture(page, 0.3)
  expect(heard.rms).toBeGreaterThan(0.001)
})

test('the store index is served, and shapes the list', async ({ page }) => {
  const response = await page.request.get('/samples/index.json')

  // 200 with a samples array whether or not a store exists. The page treats a
  // 404 and an empty store the same way, so the contract worth pinning is that
  // the URL answers at all — it is the one thing a new handle_path block breaks.
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { samples: unknown }
  expect(Array.isArray(body.samples)).toBe(true)

  await boot(page)

  // The built-in is always last and always labelled, so an empty store cannot
  // read as a working one.
  const options = await page.locator('[data-testid=sample-select] option').allInnerTexts()
  expect(options.at(-1)).toContain('built in')
  expect(options).toHaveLength((body.samples as unknown[]).length + 1)
})
