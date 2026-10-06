import { chromium } from '@playwright/test'
const b = await chromium.launch({ channel: 'chrome', args: ['--mute-audio'] })
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const p = await ctx.newPage()
  const pages = ['/touch/', '/imu/', '/droplet/', '/suz/', '/beast/', '/moog/', '/pluck/']

  const measure = () => p.evaluate(async () => {
    if (!performance.measureUserAgentSpecificMemory) return null
    const r = await performance.measureUserAgentSpecificMemory()
    const byType = {}
    for (const b of r.breakdown) {
      const k = (b.types || []).join('+') || 'other'
      byType[k] = (byType[k] || 0) + b.bytes
    }
    return { total: Math.round(r.bytes / 1e6), byType: Object.fromEntries(
      Object.entries(byType).filter(([, v]) => v > 1e6).map(([k, v]) => [k, Math.round(v / 1e6)])) }
  })

  console.log('crossOriginIsolated + measureUserAgentSpecificMemory available?')
  await p.goto('http://localhost:4173/touch/')
  console.log(await p.evaluate(() => ({ coi: crossOriginIsolated, api: typeof performance.measureUserAgentSpecificMemory })))

  for (let round = 0; round < 2; round++) {
    for (const path of pages) {
      await p.goto('http://localhost:4173' + path)
      await p.click('button:has-text("Start audio")').catch(() => {})
      await p.waitForTimeout(1600)
      const m = await measure()
      console.log(`${round}${path}`.padEnd(13), m ? `${String(m.total).padStart(4)} MB  ${JSON.stringify(m.byType)}` : 'unavailable')
    }
  }
} finally { await b.close() }
