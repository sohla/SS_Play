import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

const path = sites.pages.find((page) => page.app === 'mic')!.path

/**
 * E4 then A4, held 2.5s each, on a loop. Sines, so there is only one partial to
 * find. Two notes rather than one because the first version of the follower
 * froze on its first reading — a single held note cannot tell that apart from
 * following.
 */
const NOTES = [329.63, 440]
const HOLD_S = 2.5

/** A mono 16-bit WAV of the notes in turn, for Chrome to play as the microphone. */
function sineWav(freqs: number[], seconds: number, rate = 48_000): Buffer {
  const each = seconds * rate
  const frames = each * freqs.length
  const data = Buffer.alloc(frames * 2)
  let phase = 0
  for (let n = 0; n < frames; n++) {
    phase += (2 * Math.PI * freqs[Math.floor(n / each)]!) / rate
    data.writeInt16LE(Math.round(Math.sin(phase) * 0.5 * 32767), n * 2)
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
const wav = join(dir, 'sung-e4-a4.wav')
writeFileSync(wav, sineWav(NOTES, HOLD_S))

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

test('the drone follows the sung pitch, an octave down', async ({ page }) => {
  await page.goto(`${path}?debug=1`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=mic-pitch]').waitFor({ timeout: 30_000 })

  await expect
    .poll(() => page.locator('[data-testid=mic-pitch]').innerText(), { timeout: 10_000 })
    .toMatch(/^(E4 3(29|30)|A4 44[01]) Hz → [EA]3$/)

  // What the drone is actually told — its freq is mapped to bus 1 — read until
  // both notes have been followed, an octave down.
  const followed = await page.evaluate(
    async ({ notes }) => {
      const session = (
        window as unknown as {
          __ss: {
            sonic: { send(...args: unknown[]): void }
            dispatcher: { on(address: string, handler: (message: unknown[]) => void): () => void }
          }
        }
      ).__ss
      const read = () =>
        new Promise<number>((resolve) => {
          const off = session.dispatcher.on('/c_set', (message) => {
            off()
            resolve(message[2] as number)
          })
          session.sonic.send('/c_get', { type: 'int', value: 1 })
        })
      const hit = notes.map(() => false)
      const end = performance.now() + 12_000
      while (performance.now() < end && hit.includes(false)) {
        const value = await read()
        // Pitch's resolution on a pure sine is well under a semitone (~2%).
        notes.forEach((note, n) => {
          if (Math.abs(value / (note / 2) - 1) < 0.02) hit[n] = true
        })
        await new Promise((done) => setTimeout(done, 100))
      }
      return hit
    },
    { notes: NOTES },
  )
  expect(followed, 'the drone did not follow both notes').toEqual([true, true])
})
