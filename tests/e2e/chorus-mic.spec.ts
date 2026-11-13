import { expect, test } from '@playwright/test'
import sites from '../../infra/sites.json' with { type: 'json' }

const path = sites.pages.find((page) => page.app === 'chorus')!.path

test.use({
  launchOptions: {
    args: ['--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['microphone'],
})

/**
 * The real microphone path, answered slowly — as a person does, reading the
 * prompt after the engine has already booted. The circle used to start its draw
 * loop on boot, find no canvas yet, and never look again: blank whenever the
 * prompt was answered after boot. Loopback never asks for the mic, which is
 * why the other specs could not see it.
 */
test('the circle draws even when the microphone is granted after boot', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = (constraints) =>
      new Promise((resolve, reject) => setTimeout(() => original(constraints).then(resolve, reject), 4000))
  })
  await page.goto(path)
  await page.getByRole('button', { name: 'Start audio' }).click()

  const circle = page.locator('[data-testid=chorus-circle]')
  await circle.waitFor({ timeout: 30_000 })

  // Something has been drawn: the ring at least, in any non-transparent pixel.
  await expect
    .poll(
      () =>
        circle.evaluate((element: HTMLCanvasElement) => {
          if (element.width === 0) return 0
          const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data
          let drawn = 0
          for (let at = 3; at < pixels.length; at += 4) if (pixels[at]! > 0) drawn += 1
          return drawn
        }),
      { timeout: 5000 },
    )
    .toBeGreaterThan(0)
})
