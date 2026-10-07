import { expect, test } from '@playwright/test'
test.setTimeout(300_000)
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const shake = (page: import('@playwright/test').Page, ms: number, force: number) =>
  page.evaluate(([d, f]) => {
    const tick = setInterval(() => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 15, gamma: 10 }))
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', {
        acceleration: { x: f as number, y: f as number, z: f as number },
        rotationRate: { alpha: 120, beta: 90, gamma: 60 } }))
    }, 16)
    setTimeout(() => clearInterval(tick), d as number)
  }, [ms, force] as const)

for (const app of ['marimba', 'suz', 'pluck']) {
  test(`${app} sensitivity changes the mapping`, async ({ page }) => {
    await page.goto(`/${app}/?debug=1`)
    await page.getByRole('button', { name: 'Start audio' }).click()
    await page.locator('[data-testid=sensitivity]').waitFor({ timeout: 40_000 })

    const read = async () => (await page.locator('dl').innerText()).replace(/\n/g, ' | ')

    // A gentle, fixed gesture at two sensitivities. Lower = saturates sooner, so
    // the same movement must read as more.
    await page.locator('[data-testid=sensitivity]').fill('1')
    await shake(page, 2500, 2); await page.waitForTimeout(700)
    const dull = await read()

    await page.locator('[data-testid=sensitivity]').fill('0.1')
    await shake(page, 2500, 2); await page.waitForTimeout(700)
    const hot = await read()

    console.log(`${app} sens=1.00  ${dull}`)
    console.log(`${app} sens=0.10  ${hot}`)
    expect(hot).not.toBe(dull)
  })
}
