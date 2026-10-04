#!/usr/bin/env node
// Play what the audio tests measure, audibly, and print the measurements.
//
//   npm run listen
//
// The e2e suite runs with --mute-audio, so it proves the engine produced the
// right samples but never that anything reached a speaker. This plays the same
// notes with the sound on and shows each measurement beside it, so the numbers
// and what you hear can be checked against each other.

import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const baseURL = process.env.SS_BASE_URL ?? 'http://localhost:4173'

let server = null
if (!process.env.SS_BASE_URL) {
  server = spawn('npm', ['run', 'preview'], { stdio: 'ignore' })
  process.on('exit', () => server?.kill())
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(baseURL)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

// Headed and unmuted, which is the whole point.
const browser = await chromium.launch({ channel: 'chrome', headless: false })
const page = await browser.newPage()

await page.goto(`${baseURL}/?debug=1`)
await page.getByRole('button', { name: 'Start audio' }).click()
await page.getByRole('heading', { name: 'SynthDefs' }).waitFor({ timeout: 30_000 })

const mode = await page.evaluate(() => window.__ss.mode)
console.log(`\ntransport: ${mode}\n`)

const NOTES = [
  { label: '440 Hz sine', name: 'ssp_sine', probeHz: 440,
    controls: { freq: 440, amp: 0.3, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 } },
  { label: '220 Hz sine', name: 'ssp_sine', probeHz: 220,
    controls: { freq: 220, amp: 0.3, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 } },
  { label: '880 Hz sine', name: 'ssp_sine', probeHz: 880,
    controls: { freq: 880, amp: 0.3, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 } },
  { label: 'quiet sine (amp 0.1)', name: 'ssp_sine', probeHz: 440,
    controls: { freq: 440, amp: 0.1, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 } },
  { label: 'loud sine (amp 0.6)', name: 'ssp_sine', probeHz: 440,
    controls: { freq: 440, amp: 0.6, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 } },
  { label: 'silence (amp 0)', name: 'ssp_sine', probeHz: 440,
    controls: { freq: 440, amp: 0, attack: 0.01, decay: 0.05, susLevel: 0.9, release: 0.05 } },
  { label: 'noise, cutoff 10k', name: 'ssp_noise', probeHz: 6000,
    controls: { cutoff: 10000, rq: 0.9, amp: 0.3, attack: 0.01, susLevel: 0.9, release: 0.05 } },
  { label: 'noise, cutoff 200', name: 'ssp_noise', probeHz: 6000,
    controls: { cutoff: 200, rq: 0.9, amp: 0.3, attack: 0.01, susLevel: 0.9, release: 0.05 } },
]

const pad = (text, width) => String(text).padEnd(width)
console.log(`${pad('note', 22)}${pad('rms', 9)}${pad('peak', 9)}${pad('at probe', 11)}off probe`)
console.log('-'.repeat(60))

for (const note of NOTES) {
  const result = await page.evaluate(async (req) => {
    const s = window.__ss
    const f = (v) => ({ type: 'float', value: v })

    await s.sonic.loadSynthDef(req.name)
    await s.sonic.sync()

    const controls = Object.entries(req.controls).flatMap(([k, v]) => [k, f(v)])
    s.sonic.startCapture()

    const id = s.sonic.nextNodeId()
    const ended = s.dispatcher.waitForNodeEnd(id, { timeoutMs: 10000 })
    s.sonic.send('/s_new', req.name, id, 0, 0, ...controls)

    const deadline = performance.now() + 8000
    while (s.sonic.getCaptureFrames() < 0.4 * 48000 && performance.now() < deadline) {
      await new Promise((r) => requestAnimationFrame(r))
    }
    s.sonic.send('/n_set', id, 'gate', { type: 'int', value: 0 })
    await ended.catch(() => undefined)

    const cap = s.sonic.stopCapture()
    const from = Math.floor(cap.frames * 0.2)
    const to = Math.floor(cap.frames * 0.8)
    const span = Math.max(1, to - from)

    let peak = 0
    let sumSquares = 0
    for (let i = from; i < to; i++) {
      const v = cap.left[i] ?? 0
      peak = Math.max(peak, Math.abs(v))
      sumSquares += v * v
    }

    const goertzel = (hz) => {
      const k = 2 * Math.cos((2 * Math.PI * hz) / cap.sampleRate)
      let s1 = 0
      let s2 = 0
      for (let i = from; i < to; i++) {
        const s0 = (cap.left[i] ?? 0) + k * s1 - s2
        s2 = s1
        s1 = s0
      }
      return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / span
    }

    return {
      rms: Math.sqrt(sumSquares / span),
      peak,
      at: goertzel(req.probeHz),
      off: goertzel(req.probeHz * 1.5),
    }
  }, note)

  const n = (value) => value.toFixed(5)
  console.log(
    `${pad(note.label, 22)}${pad(n(result.rms), 9)}${pad(n(result.peak), 9)}` +
      `${pad(n(result.at), 11)}${n(result.off)}`,
  )

  // A gap between notes, so they are distinguishable by ear.
  await page.waitForTimeout(500)
}

console.log(`
What to listen for:
  - the three sines should step 440, down an octave, up two octaves
  - quiet and loud should differ clearly; silence should be silent
  - cutoff 10k should sound bright, cutoff 200 dull — same source either way

The numbers are what the e2e suite asserts on. If something sounds wrong while
its row looks right, that is a finding: it means the engine rendered correct
samples that did not reach the device.
`)

await browser.close()
server?.kill()
