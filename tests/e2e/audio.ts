import { PLAYGROUND } from './pages.ts'
import type { Page } from '@playwright/test'

export interface CaptureRequest {
  /** SynthDef name. Loaded before playing, since only boot-time defs exist. */
  name: string
  /** Control values. Plain numbers are sent as floats, which is what controls want. */
  controls?: Record<string, number>
  /** Whether to release a gate. A gated def otherwise never frees its node. */
  gated?: boolean
  /** Seconds of audio to capture. The engine's buffer holds 1s. */
  durationS?: number
  /** Frequency to measure energy at, for a tonal def. */
  probeHz?: number
}

export interface CaptureResult {
  frames: number
  sampleRate: number
  channels: number
  /** Over the trimmed middle of the capture. */
  rms: number
  peak: number
  dc: number
  nonFinite: number
  /** Goertzel magnitude at probeHz, and at probeHz * 1.5 as a control. */
  magAtProbe: number
  magOffProbe: number
  fails: string[]
}

/**
 * Play one note and measure what came out.
 *
 * Everything runs inside the page: `stopCapture` hands back 40k+ floats, and
 * moving those over CDP is slow and occasionally truncates. Only scalars cross
 * the boundary.
 *
 * Synchronisation is on OSC and on the capture's own frame counter, never on a
 * timer. Sleep-based audio tests are the single largest source of flakiness in
 * a suite like this, and a flaky suite gets retried, then skipped, then the
 * project has no audio verification at all.
 */
export async function captureNote(page: Page, request: CaptureRequest): Promise<CaptureResult> {
  return page.evaluate(async (req) => {
    const session = (window as unknown as { __ss: Record<string, never> }).__ss as never as {
      mode: string
      sonic: {
        on(event: string, cb: (message: unknown[]) => void): () => void
        sync(): Promise<void>
        loadSynthDef(name: string): Promise<unknown>
        nextNodeId(): number
        send(address: string, ...args: unknown[]): void
        startCapture(): void
        stopCapture(): {
          sampleRate: number
          channels: number
          frames: number
          left: Float32Array
          right: Float32Array | null
        }
        getCaptureFrames(): number
      }
      dispatcher: {
        waitForNodeEnd(id: number, options?: { timeoutMs?: number }): Promise<unknown>
      }
    }

    const durationS = req.durationS ?? 0.4
    const float = (value: number) => ({ type: 'float' as const, value })

    const fails: string[] = []
    const offFail = session.sonic.on('in', (message) => {
      if (message[0] === '/fail') fails.push(message.slice(1).join(' '))
    })

    // Only the defs named at boot are loaded. Playing any other one fails as
    // /fail "SynthDef not found", which looks exactly like silence.
    await session.sonic.loadSynthDef(req.name)
    await session.sonic.sync()

    const controls = Object.entries(req.controls ?? {}).flatMap(([key, value]) => [
      key,
      float(value),
    ])

    session.sonic.startCapture()

    const nodeId = session.sonic.nextNodeId()
    const ended = session.dispatcher.waitForNodeEnd(nodeId, { timeoutMs: 10_000 })
    session.sonic.send('/s_new', req.name, nodeId, 0, 0, ...controls)

    // Wait on the capture's own frame counter rather than a clock: this is the
    // only legitimate "let it sound" wait, and it is self-correcting.
    const wanted = durationS * 48_000
    const deadline = performance.now() + 8_000
    while (session.sonic.getCaptureFrames() < wanted && performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }

    if (req.gated) session.sonic.send('/n_set', nodeId, 'gate', { type: 'int', value: 0 })
    await ended.catch(() => undefined)

    const capture = session.sonic.stopCapture()
    offFail()

    // Trim to the middle 60%: the edges are the attack and release ramps, and
    // including them would make every threshold a statement about envelope
    // shape rather than about the sound.
    const start = Math.floor(capture.frames * 0.2)
    const end = Math.floor(capture.frames * 0.8)
    const span = Math.max(1, end - start)

    let peak = 0
    let sumSquares = 0
    let sum = 0
    let nonFinite = 0

    for (let i = start; i < end; i++) {
      const value = capture.left[i] ?? 0
      if (!Number.isFinite(value)) {
        nonFinite++
        continue
      }
      const magnitude = Math.abs(value)
      if (magnitude > peak) peak = magnitude
      sumSquares += value * value
      sum += value
    }

    // Goertzel: the energy at one frequency, without an FFT library.
    const goertzel = (hz: number) => {
      const coeff = 2 * Math.cos((2 * Math.PI * hz) / capture.sampleRate)
      let s1 = 0
      let s2 = 0
      for (let i = start; i < end; i++) {
        const s0 = (capture.left[i] ?? 0) + coeff * s1 - s2
        s2 = s1
        s1 = s0
      }
      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2
      return Math.sqrt(Math.max(0, power)) / span
    }

    const probe = req.probeHz ?? 0

    return {
      frames: capture.frames,
      sampleRate: capture.sampleRate,
      channels: capture.channels,
      rms: Math.sqrt(sumSquares / span),
      peak,
      dc: sum / span,
      nonFinite,
      magAtProbe: probe ? goertzel(probe) : 0,
      // A frequency the signal should not contain, as the control for the
      // measurement: without it "there is energy at 440" proves nothing,
      // because broadband noise has energy everywhere.
      magOffProbe: probe ? goertzel(probe * 1.5) : 0,
      fails,
    }
  }, request)
}

/** Boot the engine with the debug handle the capture helper drives. */
export async function bootForCapture(page: Page): Promise<void> {
  await page.goto(`${PLAYGROUND}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.getByRole('heading', { name: 'SynthDefs' }).waitFor({ timeout: 30_000 })
}
