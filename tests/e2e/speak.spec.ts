import { expect, test, type Page } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

const path = sites.pages.find((page) => page.app === 'speak')!.path

/**
 * A stand-in for the browser's voice.
 *
 * Headless Chrome has no speech engine, so `speechSynthesis` either reports no
 * voices or never starts. This one behaves like an on-device voice — a start,
 * a word event every 60ms, then an end — which is enough to prove the part
 * this page owns: hooks reaching scsynth as bells, on the program's schedule.
 * What a real voice sounds like, and how late it really is, needs a device.
 */
function fakeVoice() {
  class FakeUtterance {
    text: string
    voice: unknown = null
    lang = ''
    volume = 1
    onstart: (() => void) | null = null
    onboundary: ((event: { name: string; charIndex: number }) => void) | null = null
    onend: (() => void) | null = null
    onerror: ((event: { error: string }) => void) | null = null
    constructor(text: string) {
      this.text = text
    }
  }
  const voice = { name: 'Test voice', lang: 'en-US', localService: true, voiceURI: 'test', default: true }
  const queue: FakeUtterance[] = []
  let busy = false
  const next = () => {
    const utterance = queue.shift()
    if (!utterance) {
      busy = false
      return
    }
    busy = true
    setTimeout(() => {
      utterance.onstart?.()
      const starts = [...utterance.text.matchAll(/\S+/g)].map((match) => match.index!)
      starts.forEach((charIndex, n) =>
        setTimeout(() => utterance.onboundary?.({ name: 'word', charIndex }), 60 * (n + 1)),
      )
      setTimeout(() => {
        utterance.onend?.()
        next()
      }, 60 * (starts.length + 1))
    }, 40)
  }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance })
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      getVoices: () => [voice],
      addEventListener() {},
      removeEventListener() {},
      speak(utterance: FakeUtterance) {
        queue.push(utterance)
        if (!busy) next()
      },
      cancel() {
        queue.length = 0
      },
    },
  })
}

async function boot(page: Page, from: number) {
  await page.addInitScript(fakeVoice)
  await page.goto(`${path}?debug=1&from=${from}`)
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=timeline]').waitFor({ timeout: 30_000 })
}

const entries = (page: Page) => page.locator('[data-testid=log] li').allInnerTexts()

/** The loudest the engine's output gets over `ms`. */
function outputPeak(page: Page, ms: number) {
  return page.evaluate(async (duration) => {
    const session = (window as unknown as { __ss: { sonic: { audioContext: AudioContext; node: AudioNode } } }).__ss
    const analyser = session.sonic.audioContext.createAnalyser()
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

test('the count runs one to ten, a second apart, with a bell on each', async ({ page }) => {
  await boot(page, 0)
  const peak = outputPeak(page, 4000)

  await expect
    .poll(async () => (await entries(page)).filter((row) => row.includes('count')).length, {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(10)

  const counts = (await entries(page)).filter((row) => row.includes('count')).reverse()
  expect(counts.slice(0, 10).map((row) => row.match(/count\s+(\d+)/)?.[1])).toEqual(
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  )
  expect(await peak, 'the count rang no bells').toBeGreaterThan(0.01)
})

test('a block of lines rings start, a tinkle per word, and end', async ({ page }) => {
  await boot(page, 15)

  // The log keeps the latest 14 rows, and a block is dozens of word events, so
  // look for each kind as it goes past rather than all of them at the end.
  const seen = new Set<string>()
  let words = 0
  await expect
    .poll(
      async () => {
        for (const row of await entries(page)) {
          const kind = row.match(/\b(start|word|end)\b/)?.[1]
          if (kind) seen.add(kind)
          if (kind === 'word') words += 1
        }
        return [...seen].sort().join(',')
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toBe('end,start,word')
  expect(words).toBeGreaterThan(3)
  // The fake voice sends word events, so the page must not claim otherwise.
  await expect(page.locator('[data-testid=no-words]')).toHaveCount(0)
})
