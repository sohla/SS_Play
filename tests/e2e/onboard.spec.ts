import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

const ONE = sites.pages.find((page) => page.app === 'onboard-one')!.path
const TWO = sites.pages.find((page) => page.app === 'onboard-two')!.path

/**
 * What the microphone hears in Version A: three seconds of quiet room noise at
 * about -50dB, then a 660Hz tone at about -14dB, near the chime's own pitch, looped. The quiet
 * step measures the noise; the tone step must then see the tone clear the
 * 15dB margin. A headless phone cannot hear its own speaker, so the file plays
 * the part of the room and the speaker both.
 */
function roomThenTone(): Buffer {
  const rate = 48_000
  const frames = rate * 13
  const data = Buffer.alloc(frames * 2)
  let seed = 1
  for (let n = 0; n < frames; n++) {
    seed = (seed * 16807) % 2147483647
    const noise = (seed / 2147483647 - 0.5) * 2 * 0.003
    const tone = n > rate * 3 ? Math.sin((2 * Math.PI * 660 * n) / rate) * 0.2 : 0
    data.writeInt16LE(Math.round((noise + tone) * 32767), n * 2)
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
const wav = join(dir, 'room-then-tone.wav')
writeFileSync(wav, roomThenTone())

test.use({
  launchOptions: {
    args: [
      '--mute-audio',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
    ],
  },
  // Chrome now has DeviceOrientationEvent.requestPermission too, answered from
  // these: without them it says "denied" and the motion step shows its fix.
  permissions: ['microphone', 'accelerometer', 'gyroscope'],
})

/** Headless Chrome has no voice; this one starts, waits a moment, and ends. */
function fakeVoice() {
  class FakeUtterance {
    text: string
    voice: unknown = null
    lang = ''
    volume = 1
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(text: string) {
      this.text = text
    }
  }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance })
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      getVoices: () => [],
      cancel() {},
      speak(utterance: FakeUtterance) {
        setTimeout(() => utterance.onstart?.(), 50)
        setTimeout(() => utterance.onend?.(), 1200)
      },
    },
  })
}

async function open(page: Page, path: string) {
  await page.addInitScript(fakeVoice)
  await page.goto(path)
}

const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' })

async function shake(page: Page) {
  await page.evaluate(() => {
    const timer = setInterval(() => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 10, gamma: 10 }))
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: 14, y: 14, z: 14 } }))
    }, 40)
    setTimeout(() => clearInterval(timer), 2500)
  })
}

const result = (page: Page, name: string) => page.locator(`[data-testid=result-${name}]`)

test('version B: start to ready with everything passed', async ({ page }) => {
  await open(page, TWO)
  await expect(page.locator('[data-testid=progress]')).toHaveText('Step 1 of 6')
  await button(page, 'Start').click()
  await button(page, 'Next').click()
  await button(page, 'Volume is full').click()

  await button(page, 'Play').click()
  await button(page, 'Yes, I hear it').click()
  await button(page, 'Play').click()
  await button(page, 'Yes').click()

  await button(page, 'Allow motion').click()
  await shake(page)

  await expect(page.getByRole('heading', { name: /You’re ready/ })).toBeVisible({ timeout: 15_000 })
  await expect(result(page, 'Sound')).toHaveText('✓ Passed')
  await expect(result(page, 'Voice')).toHaveText('✓ Passed')
  await expect(result(page, 'Motion')).toHaveText('✓ Passed')
})

test('version B: two Nos bring a facilitator, and skipping shows as skipped', async ({ page }) => {
  await open(page, TWO)
  await button(page, 'Start').click()
  await button(page, 'Next').click()
  await button(page, 'Volume is full').click()

  await button(page, 'Play').click()
  await button(page, 'No').click()
  await expect(page.locator('[data-testid=fixes]')).toContainText('Turn off Bluetooth')
  await expect(page.locator('[data-testid=facilitator]')).toHaveCount(0)

  await button(page, 'Play').click()
  await button(page, 'No').click()
  await expect(page.locator('[data-testid=facilitator]')).toHaveText('Ask a facilitator')
  await button(page, 'Continue without this').click()

  await button(page, 'Continue without the voice').click()
  await button(page, 'Skip movement').click()

  await expect(result(page, 'Sound')).toHaveText('Skipped')
  await expect(result(page, 'Voice')).toHaveText('Skipped')
  await expect(result(page, 'Motion')).toHaveText('Skipped')
})

test('the group survives a reload', async ({ page }) => {
  await open(page, TWO)
  const group = await page.locator('[data-testid=group]').getAttribute('data-group')
  expect(['0', '1', '2']).toContain(group)
  for (let n = 0; n < 3; n++) {
    await page.reload()
    await expect(page.locator('[data-testid=group]')).toHaveAttribute('data-group', group!)
  }
})

test('version A: the microphone measures the tone, then the voice', async ({ page }) => {
  await open(page, ONE)
  await expect(page.locator('[data-testid=progress]')).toHaveText('Step 1 of 8')
  await button(page, 'Start').click()
  await button(page, 'Next').click()
  await button(page, 'Volume is full').click()
  await button(page, 'Allow microphone').click()

  // Quiet, then the tone: the fake microphone's tone clears the margin on its
  // own, so this step passes without anyone touching anything.
  await expect(page.getByRole('heading', { name: 'Tone check' })).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-testid=tick]')).toHaveText(/Loud enough/, { timeout: 15_000 })

  // The voice step: measured while the narrator speaks, over the room.
  await expect(page.getByRole('heading', { name: 'Voice check' })).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[data-testid=tick]')).toHaveText(/Voice heard/, { timeout: 10_000 })

  await button(page, 'Allow motion').click()
  await shake(page)
  await expect(result(page, 'Sound')).toHaveText('✓ Passed', { timeout: 15_000 })
  await expect(result(page, 'Voice')).toHaveText('✓ Passed')
  await expect(result(page, 'Motion')).toHaveText('✓ Passed')
})

test('version A: a refused microphone carries on as version B', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
  })
  await open(page, ONE)
  await button(page, 'Start').click()
  await button(page, 'Next').click()
  await button(page, 'Volume is full').click()
  await button(page, 'Allow microphone').click()
  await button(page, 'Continue without the microphone').click()

  await expect(page.locator('[data-testid=progress]')).toHaveText('Step 5 of 7')
  await expect(button(page, 'Play')).toBeVisible()
  await expect(page.getByText('not from headphones')).toBeVisible()
})

test('the chime rings and decays, loud without clipping', async ({ page }) => {
  await open(page, `${TWO}?debug=1`)
  await button(page, 'Start').click()
  await button(page, 'Next').click()
  await expect(page.getByRole('heading', { name: 'Turn the volume up full' })).toBeVisible()
  // The screen comes before the engine has finished booting.
  await page.waitForFunction(() => '__ss' in window, null, { timeout: 30_000 })

  // The volume step chimes once a second. Read the output envelope across a
  // few chimes: a sharp start, then most of it gone well before the next one.
  const envelope = await page.evaluate(async () => {
    const session = (window as unknown as { __ss?: { sonic: { audioContext: AudioContext; node: AudioNode } } }).__ss
    if (!session) return null
    const analyser = session.sonic.audioContext.createAnalyser()
    analyser.fftSize = 1024
    session.sonic.node.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    const levels: number[] = []
    const end = performance.now() + 3000
    while (performance.now() < end) {
      analyser.getFloatTimeDomainData(samples)
      let peak = 0
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
      levels.push(peak)
      await new Promise((done) => setTimeout(done, 10))
    }
    return levels
  })
  expect(envelope).not.toBeNull()
  const loudest = Math.max(...envelope!)
  const quietest = Math.min(...envelope!.slice(20))
  expect(loudest).toBeGreaterThan(0.2)
  expect(loudest).toBeLessThan(0.99)
  // Decays: between chimes it falls well below its peak, rather than holding
  // like the old beep.
  expect(quietest).toBeLessThan(loudest * 0.5)
})
