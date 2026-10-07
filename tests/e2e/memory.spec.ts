import { expect, test } from '@playwright/test'

/**
 * Giving the engine back when a page is left.
 *
 * Each boot is around 70MB of WebAssembly, none of it in the JS heap, and the
 * per-tab budget on a phone is a small multiple of that. So leaving a page has to
 * actually release it — and the first attempt at this measured flat memory across
 * thirteen navigations on a desktop while an iPhone still ran out of memory after
 * leaving a sampled page for another one.
 *
 * The thing the desktop measurement missed is the back/forward cache. A page held
 * there keeps everything it had, and `pagehide` was originally chosen over
 * `unload` partly to stay *eligible* for it. So the fix is in two parts, and both
 * are asserted here: the AudioContext is closed synchronously on `pagehide`,
 * because it owns the worklet where the memory lives and `dispose()` is a promise
 * that `pagehide` gives no time to finish; and a page restored from that cache
 * reloads itself, because otherwise it comes back looking alive with a closed
 * context behind it.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

test.setTimeout(240_000)

test('leaving a page closes its AudioContext', async ({ page }) => {
  await page.goto('/marimba/?debug=1')
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=playing]').waitFor({ timeout: 40_000 })

  // Watch for the close from inside the page, since after navigation the old
  // context is unreachable.
  const closed = await page.evaluate(async () => {
    const ss = (window as unknown as { __ss: { sonic: { audioContext: AudioContext | null } } }).__ss
    const ctx = ss.sonic.audioContext
    const before = ctx?.state ?? 'none'
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
    await new Promise((r) => setTimeout(r, 300))
    return { before, after: ctx?.state ?? 'none' }
  })
  console.log(`CONTEXT ${closed.before} -> ${closed.after}`)
  expect(closed.after).toBe('closed')
})

test('a restored page reloads rather than showing a dead instrument', async ({ page }) => {
  await page.goto('/marimba/?debug=1')
  await page.getByRole('button', { name: 'Start audio' }).click()
  await page.locator('[data-testid=playing]').waitFor({ timeout: 40_000 })

  // A marker that only survives if the document does not reload.
  await page.evaluate(() => {
    ;(window as unknown as Record<string, unknown>)['__survived'] = true
  })

  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  )
  await page.waitForTimeout(2000)

  const survived = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__survived'] === true,
  )
  console.log(`RESTORE document survived (should be false): ${survived}`)
  expect(survived, 'the restored page did not reload').toBe(false)
})

test('a normal pageshow does not reload', async ({ page }) => {
  await page.goto('/marimba/?debug=1')
  await page.evaluate(() => {
    ;(window as unknown as Record<string, unknown>)['__survived'] = true
  })
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })),
  )
  await page.waitForTimeout(1000)

  const survived = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__survived'] === true,
  )
  console.log(`FIRST LOAD document survived (should be true): ${survived}`)
  expect(survived, 'an ordinary pageshow reloaded the page').toBe(true)
})
