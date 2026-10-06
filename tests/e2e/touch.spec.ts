import { expect, test } from '@playwright/test'
import { TOUCH } from './pages.ts'

// The touch surface is the first page whose whole point is the gesture, so the
// assertions drive real pointers rather than calling the engine directly.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

/** C3 — strip 0 with the default root of C. */
const C3_HZ = 440 * 2 ** ((48 - 69) / 12)

async function boot(page: import('@playwright/test').Page) {
  // ?debug=1 exposes the session as window.__ss, which is how the capture gets
  // at the audio without the page having to expose anything in production.
  await page.goto(`${TOUCH}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=surface]').waitFor({ timeout: 30_000 })
}

test('the whole instrument fits one screen', async ({ page }) => {
  await boot(page)

  // An instrument you have to scroll is one where a note dies because the
  // browser decided your gesture was a scroll.
  const box = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    docH: document.documentElement.scrollHeight,
    winW: window.innerWidth,
    winH: window.innerHeight,
  }))

  expect(box.docW).toBeLessThanOrEqual(box.winW + 1)
  expect(box.docH).toBeLessThanOrEqual(box.winH + 1)
})

test('a press sounds the note the strip is labelled with', async ({ page }) => {
  await boot(page)

  const surface = await page.locator('[data-testid=surface]').boundingBox()
  if (!surface) throw new Error('no surface')

  // Strip 0, high up so the amplitude is near its maximum.
  const x = surface.x + surface.width * 0.02
  const y = surface.y + surface.height * 0.15

  await page.evaluate(() => (window as never as { __ss: { sonic: { startCapture(): void } } }).__ss.sonic.startCapture())

  await page.mouse.move(x, y)
  await page.mouse.down()
  // Long enough to fill the capture buffer; the wait is on frames, not here.
  await page.waitForTimeout(400)

  const measured = await page.evaluate(async (probeHz) => {
    const sonic = (window as never as { __ss: { sonic: Record<string, never> } }).__ss.sonic as never as {
      getCaptureFrames(): number
      stopCapture(): { sampleRate: number; frames: number; left: Float32Array }
    }

    while (sonic.getCaptureFrames() < 8000) await new Promise((r) => setTimeout(r, 20))
    const capture = sonic.stopCapture()

    // Trim the edges: the attack ramp is not the steady state being measured.
    const from = Math.floor(capture.frames * 0.2)
    const to = Math.floor(capture.frames * 0.8)
    const span = to - from

    let sumSquares = 0
    let peak = 0
    for (let n = from; n < to; n++) {
      const sample = capture.left[n] as number
      sumSquares += sample * sample
      peak = Math.max(peak, Math.abs(sample))
    }

    // Goertzel: one frequency's magnitude without an FFT.
    const magAt = (hz: number) => {
      const k = (2 * Math.PI * hz) / capture.sampleRate
      const coeff = 2 * Math.cos(k)
      let s1 = 0
      let s2 = 0
      for (let n = from; n < to; n++) {
        const s0 = (capture.left[n] as number) + coeff * s1 - s2
        s2 = s1
        s1 = s0
      }
      return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / span
    }

    return { rms: Math.sqrt(sumSquares / span), peak, atNote: magAt(probeHz), offNote: magAt(probeHz * 1.5) }
  }, C3_HZ)

  await page.mouse.up()

  // Energy, headroom, and the right energy. The third is what separates "made a
  // sound" from "made the sound the strip claims".
  expect(measured.rms).toBeGreaterThan(0.005)
  expect(measured.peak).toBeGreaterThan(0.02)
  expect(measured.peak).toBeLessThan(0.99)
  expect(measured.atNote).toBeGreaterThan(measured.offNote * 4)
})

test('three fingers sound three notes at once', async ({ page }) => {
  await boot(page)

  const surface = await page.locator('[data-testid=surface]').boundingBox()
  if (!surface) throw new Error('no surface')

  // Playwright's touchscreen taps one point, so genuine multitouch goes through
  // CDP. This is the assertion the whole page exists for.
  const cdp = await page.context().newCDPSession(page)
  const y = surface.y + surface.height * 0.4
  const points = [0.1, 0.4, 0.7].map((fraction, id) => ({
    x: surface.x + surface.width * fraction,
    y,
    id,
  }))

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points })
  await expect(page.locator('[data-testid=surface] > div')).toHaveCount(11)

  const before = await nodeCount(page)
  expect(before).toBe(3)

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

  // Gate off starts the release; the envelope's doneAction frees the node. A
  // def that never freed would show up here as a count that only climbs, which
  // in a performance arrives as later notes silently failing.
  await expect.poll(() => nodeCount(page), { timeout: 10_000 }).toBe(0)
})

test('the scale selector changes the strips', async ({ page }) => {
  await boot(page)

  await expect(page.locator('[data-testid=surface] > div')).toHaveCount(11)
  await expect(page.getByText('C3', { exact: true })).toBeVisible()

  await page.selectOption('select >> nth=1', 'major')

  // Seven degrees over two octaves, plus the closing root.
  await expect(page.locator('[data-testid=surface] > div')).toHaveCount(15)
  await expect(page.getByText('F3', { exact: true })).toBeVisible()
})

/** Synths currently in the tree, which is one per held finger. */
async function nodeCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(async () => {
    const sonic = (window as never as { __ss: { sonic: Record<string, never> } }).__ss.sonic as never as {
      getTree(): Promise<{ nodeCount: number }>
    }
    const tree = await sonic.getTree()
    // The root group and the voice group are always there.
    return Math.max(0, tree.nodeCount - 2)
  })
}

test('the engine asks for a small output buffer and says what it got', async ({ page }) => {
  await boot(page)

  const context = await page.evaluate(() => {
    const sonic = (window as never as { __ss: { sonic: Record<string, never> } }).__ss.sonic as never as {
      audioContext: AudioContext
    }
    return {
      baseLatency: sonic.audioContext.baseLatency * 1000,
      sampleRate: sonic.audioContext.sampleRate,
    }
  })

  // SuperSonic asks for latencyHint 'interactive', which Chrome serves with a
  // 256-frame buffer — 5.8ms at 48kHz. createSession asks for 0 instead and
  // gets 128. The threshold is one frame above 128 frames' worth, so a
  // regression to 'interactive' fails rather than merely reading worse.
  const quantumMs = (128 / context.sampleRate) * 1000
  expect(context.baseLatency).toBeLessThan(quantumMs * 1.5)

  await expect(page.locator('[data-testid=latency]')).toContainText('ms out')
})

test('a press reaches the output within a render quantum or two', async ({ page }) => {
  await boot(page)

  const surface = await page.locator('[data-testid=surface]').boundingBox()
  if (!surface) throw new Error('no surface')

  await page.evaluate(() => {
    const sonic = (window as never as { __ss: { sonic: Record<string, never> } }).__ss.sonic as never as {
      startCapture(): void
      audioContext: AudioContext
    }
    sonic.startCapture()
    const stamp = { ctxAtStart: sonic.audioContext.currentTime, pressed: 0 }
    ;(window as never as { __t: unknown }).__t = stamp
    document.querySelector('[data-testid=surface]')?.addEventListener(
      'pointerdown',
      () => {
        stamp.pressed = sonic.audioContext.currentTime
      },
      { capture: true, once: true },
    )
  })

  await page.mouse.move(surface.x + surface.width * 0.5, surface.y + surface.height * 0.2)
  await page.mouse.down()
  await page.waitForTimeout(250)

  const onsetMs = await page.evaluate(() => {
    const sonic = (window as never as { __ss: { sonic: Record<string, never> } }).__ss.sonic as never as {
      stopCapture(): { sampleRate: number; frames: number; left: Float32Array }
    }
    const capture = sonic.stopCapture()
    const { ctxAtStart, pressed } = (window as never as { __t: { ctxAtStart: number; pressed: number } }).__t

    let peak = 0
    for (let n = 0; n < capture.frames; n++) peak = Math.max(peak, Math.abs(capture.left[n] as number))
    for (let n = 0; n < capture.frames; n++) {
      if (Math.abs(capture.left[n] as number) > peak * 0.02) {
        return (ctxAtStart + n / capture.sampleRate - pressed) * 1000
      }
    }
    return -1
  })

  await page.mouse.up()

  // Measured at 2.9ms, which is one 128-frame render quantum. 15ms is generous
  // enough to survive a loaded machine and still fail if a scheduler or a
  // lookahead ever gets between the press and the engine — which is the
  // regression worth catching, since it would be inaudible in a test that only
  // asked whether a sound happened.
  expect(onsetMs).toBeGreaterThan(0)
  expect(onsetMs).toBeLessThan(15)
})
