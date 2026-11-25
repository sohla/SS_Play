import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

const path = sites.pages.find((page) => page.app === 'memory')!.path

/** A4 struck once a second: 200ms of a decaying sine, then silence. */
const EVERY_S = 1
const FREQ = 440

/** A mono 16-bit WAV of the strikes, for Chrome to play as the microphone. */
function strikesWav(seconds: number, rate = 48_000): Buffer {
  const frames = seconds * rate
  const data = Buffer.alloc(frames * 2)
  for (let n = 0; n < frames; n++) {
    const t = (n % (EVERY_S * rate)) / rate
    const sample = t < 0.2 ? Math.sin(2 * Math.PI * FREQ * t) * 0.5 * Math.exp(-t * 10) : 0
    data.writeInt16LE(Math.round(sample * 32767), n * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const dir = join(tmpdir(), 'ss-play-e2e')
mkdirSync(dir, { recursive: true })
const wav = join(dir, 'a4-strikes.wav')
writeFileSync(wav, strikesWav(10))

test.use({
  launchOptions: {
    args: [
      '--mute-audio',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
    ],
  },
  permissions: ['microphone'],
})

test('hears each strike once, a second apart, as A4, and remembers it', async ({ page }) => {
  await page.goto(`${path}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=memory]').waitFor({ timeout: 30_000 })

  const onsets = await page.evaluate(async () => {
    const session = (
      window as unknown as {
        __ss: {
          sonic: { audioContext: AudioContext }
          dispatcher: { on(address: string, handler: (message: unknown[]) => void): () => void }
        }
      }
    ).__ss
    const heard: number[][] = []
    const off = session.dispatcher.on('/ssp_onset', (message) => heard.push(message.slice(3) as number[]))
    await new Promise((done) => setTimeout(done, 5_500))
    off()
    return { heard, rate: session.sonic.audioContext.sampleRate }
  })

  // Five seconds of strikes is five onsets, give or take one at either edge.
  expect(onsets.heard.length).toBeGreaterThanOrEqual(4)
  expect(onsets.heard.length).toBeLessThanOrEqual(6)

  const frames = onsets.heard.map(([frame]) => frame!)
  for (let n = 1; n < frames.length; n++) {
    // The counter is sample-exact; the slack is the detector crossing its
    // threshold a sample or two apart on the same strike.
    expect((frames[n]! - frames[n - 1]!) / onsets.rate).toBeCloseTo(EVERY_S, 2)
  }
  for (const [, peak, freq, hasFreq] of onsets.heard) {
    expect(peak).toBeGreaterThan(0.1)
    expect(hasFreq).toBe(1)
    expect(Math.abs(freq! / FREQ - 1)).toBeLessThan(0.02)
  }

  await expect.poll(() => page.locator('[data-testid=notes]').innerText()).not.toBe('0')
})
