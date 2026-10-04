import { expect, test } from '@playwright/test'
import { bootForCapture, captureNote } from './audio.ts'

// The only tests that assert the engine made the *right* sound rather than
// that it reported success. Everything else in the suite would pass just as
// well if the graph never reached an output.
//
// Thresholds are deliberately wide bands, never exact values. Relaxing one
// requires a comment giving the physical reason — without that, a failure here
// is reporting a real bug.

test.beforeEach(async ({ page }) => {
  await bootForCapture(page)

  // startCapture is SAB-only, so a page that quietly fell back to postMessage
  // would return empty buffers and every assertion below would be about
  // nothing at all.
  const mode = await page.evaluate(() => (window as unknown as { __ss: { mode: string } }).__ss.mode)
  expect(mode, 'audio capture requires the SAB transport').toBe('sab')
})

test('a sine produces energy, headroom, and its own frequency', async ({ page }) => {
  const result = await captureNote(page, {
    name: 'ssp_sine',
    controls: { freq: 440, amp: 0.3, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 },
    gated: true,
    probeHz: 440,
  })

  expect(result.fails).toEqual([])
  expect(result.frames).toBeGreaterThan(0)
  expect(result.nonFinite).toBe(0)

  // Energy: catches silence, and catches a gain bug the other way.
  expect(result.rms).toBeGreaterThan(0.01)
  expect(result.rms).toBeLessThan(1)

  // Headroom: catches inaudibly quiet, and catches clipping.
  expect(result.peak).toBeGreaterThan(0.05)
  expect(result.peak).toBeLessThan(0.99)

  // Spectrum: the one that distinguishes "made a sound" from "made the right
  // sound". A wrong default or a swapped argument produces noise or the wrong
  // pitch, both of which pass the two assertions above.
  expect(result.magAtProbe).toBeGreaterThan(result.magOffProbe * 10)

  // A sine centred by Pan2 should not drift the output off zero.
  expect(Math.abs(result.dc)).toBeLessThan(0.05)
})

test('the measured frequency follows the requested one', async ({ page }) => {
  // Stronger than asserting one pitch: it rules out a def that happens to emit
  // a fixed tone regardless of what it was asked for.
  const low = await captureNote(page, {
    name: 'ssp_sine',
    controls: { freq: 220, amp: 0.3, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 },
    gated: true,
    probeHz: 220,
  })

  const high = await captureNote(page, {
    name: 'ssp_sine',
    controls: { freq: 880, amp: 0.3, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 },
    gated: true,
    probeHz: 880,
  })

  expect(low.magAtProbe).toBeGreaterThan(low.magOffProbe * 10)
  expect(high.magAtProbe).toBeGreaterThan(high.magOffProbe * 10)
})

test('amplitude tracks the amp control', async ({ page }) => {
  const quiet = await captureNote(page, {
    name: 'ssp_sine',
    controls: { freq: 440, amp: 0.1, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 },
    gated: true,
  })

  const loud = await captureNote(page, {
    name: 'ssp_sine',
    controls: { freq: 440, amp: 0.6, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 },
    gated: true,
  })

  // A ratio, not absolute levels: what matters is that the control does
  // something monotonic, not that it hits a particular number.
  expect(loud.rms).toBeGreaterThan(quiet.rms * 2)
})

test('filtered noise is broadband, not tonal', async ({ page }) => {
  // The contrast case. Without it, "there is energy at 440 Hz" proves little,
  // since noise has energy everywhere — this is what makes the sine's spectral
  // assertion mean something.
  const result = await captureNote(page, {
    name: 'ssp_noise',
    controls: {
      cutoff: 4000,
      rq: 0.8,
      amp: 0.3,
      attack: 0.01,
      decay: 0.05,
      susLevel: 0.9,
      release: 0.05,
    },
    gated: true,
    probeHz: 440,
  })

  expect(result.fails).toEqual([])
  expect(result.rms).toBeGreaterThan(0.01)
  expect(result.nonFinite).toBe(0)

  // No single frequency should dominate the way it does for a sine.
  expect(result.magAtProbe).toBeLessThan(result.magOffProbe * 10)
})

test('a lowpass cutoff removes high end', async ({ page }) => {
  const open = await captureNote(page, {
    name: 'ssp_noise',
    controls: { cutoff: 10_000, rq: 0.9, amp: 0.3, attack: 0.01, susLevel: 0.9, release: 0.05 },
    gated: true,
    probeHz: 6000,
  })

  const closed = await captureNote(page, {
    name: 'ssp_noise',
    controls: { cutoff: 200, rq: 0.9, amp: 0.3, attack: 0.01, susLevel: 0.9, release: 0.05 },
    gated: true,
    probeHz: 6000,
  })

  // Measures the filter doing its job rather than merely being present.
  expect(closed.magAtProbe).toBeLessThan(open.magAtProbe)
})

test('silence is distinguishable from sound', async ({ page }) => {
  // Proves the measurement can come back empty, so a passing run above means
  // the engine produced something rather than the harness always reporting it.
  const silent = await captureNote(page, {
    name: 'ssp_sine',
    controls: { freq: 440, amp: 0, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 },
    gated: true,
    probeHz: 440,
  })

  expect(silent.rms).toBeLessThan(0.0001)
  expect(silent.peak).toBeLessThan(0.0001)
})

test('a sample loads, decodes, and plays', async ({ page }) => {
  // Exercises the paths the synth tests do not touch at all: loadSample, the
  // buffer allocator, and the browser's own FLAC decoder — SuperSonic hands
  // the bytes to decodeAudioData, so format support is Chrome's, not scsynth's.
  const result = await page.evaluate(async () => {
    const session = (window as unknown as { __ss: Record<string, never> }).__ss as never as {
      sonic: {
        on(event: string, cb: (message: unknown[]) => void): () => void
        sync(): Promise<void>
        loadSynthDef(name: string): Promise<unknown>
        loadSample(bufnum: number, source: string): Promise<{ numFrames: number; sampleRate: number; numChannels: number }>
        nextNodeId(): number
        send(address: string, ...args: unknown[]): void
        startCapture(): void
        stopCapture(): { frames: number; left: Float32Array }
        getCaptureFrames(): number
      }
      buffers: { alloc(): number }
    }

    const fails: string[] = []
    const offFail = session.sonic.on('in', (message) => {
      if (message[0] === '/fail') fails.push(message.slice(1).join(' '))
    })

    const float = (value: number) => ({ type: 'float' as const, value })

    await session.sonic.loadSynthDef('sonic-pi-basic_stereo_player')
    const bufnum = session.buffers.alloc()
    const info = await session.sonic.loadSample(bufnum, 'loop_amen.flac')
    await session.sonic.sync()

    session.sonic.startCapture()
    const nodeId = session.sonic.nextNodeId()
    session.sonic.send(
      '/s_new',
      'sonic-pi-basic_stereo_player',
      nodeId,
      0,
      0,
      'buf',
      float(bufnum),
      'amp',
      float(0.5),
      'attack',
      float(0.001),
      'sustain',
      float(0.4),
      'release',
      float(0.01),
    )

    const deadline = performance.now() + 8000
    while (session.sonic.getCaptureFrames() < 0.3 * 48_000 && performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }

    const capture = session.sonic.stopCapture()
    offFail()

    const start = Math.floor(capture.frames * 0.2)
    const end = Math.floor(capture.frames * 0.8)
    let peak = 0
    let sumSquares = 0
    for (let i = start; i < end; i++) {
      const value = capture.left[i] ?? 0
      peak = Math.max(peak, Math.abs(value))
      sumSquares += value * value
    }

    return {
      fails,
      bufnum,
      numFrames: info.numFrames,
      sampleRate: info.sampleRate,
      numChannels: info.numChannels,
      rms: Math.sqrt(sumSquares / Math.max(1, end - start)),
      peak,
    }
  })

  expect(result.fails).toEqual([])

  // The decode itself: a FLAC that failed to decode would give zero frames and
  // the player would be silent for a reason nothing else here would explain.
  expect(result.numFrames).toBeGreaterThan(10_000)
  expect(result.sampleRate).toBeGreaterThan(0)
  expect(result.numChannels).toBeGreaterThanOrEqual(1)

  // Allocated from the pool rather than hardcoded, which is what stops two
  // loads silently overwriting each other.
  expect(result.bufnum).toBeGreaterThanOrEqual(0)

  expect(result.rms).toBeGreaterThan(0.01)
  expect(result.peak).toBeGreaterThan(0.05)
  expect(result.peak).toBeLessThan(0.99)
})
