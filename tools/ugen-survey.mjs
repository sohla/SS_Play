#!/usr/bin/env node
// Ask a real engine which SynthDefs it can actually load.
//
//   npm run survey
//
// The UGens a browser build supports are whatever it was compiled with, and
// nothing documents that list. Guessing produces a whitelist that is wrong in
// both directions: it rejects defs that work and admits defs that fail at
// /d_recv with an opaque error. So load all 131 and write down what happened.
//
// Output: docs/UGEN-SURVEY.json and a short summary on stdout.

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseURL = process.env['SS_BASE_URL'] ?? 'http://localhost:4173'

const manifest = JSON.parse(
  readFileSync(join(repoRoot, 'apps/playground/public/vendor/supersonic/manifest.json'), 'utf8'),
)
const names = manifest.synthdefs
if (!Array.isArray(names) || names.length === 0) {
  console.error('No synthdefs staged. Run `npm run build` first.')
  process.exit(1)
}

let server = null
if (!process.env['SS_BASE_URL']) {
  server = spawn('npm', ['run', 'preview'], { cwd: repoRoot, stdio: 'ignore' })
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

const browser = await chromium.launch({ channel: 'chrome', args: ['--mute-audio'] })
const page = await browser.newPage()

await page.goto(`${baseURL}/?debug=1`)
await page.click('button:has-text("Boot scsynth")')
await page.waitForSelector('text=achieved transport', { timeout: 30_000 })

const mode = await page.evaluate(() => window.__ss.mode)
if (mode !== 'sab') {
  console.error(`Engine booted on ${mode}, not sab. Survey aborted — fix isolation first.`)
  await browser.close()
  process.exit(1)
}

console.log(`Loading ${names.length} synthdefs into a real engine…\n`)

const results = await page.evaluate(async (defNames) => {
  const sonic = window.__ss.sonic
  const out = []

  // loadSynthDef fetches the bytes and calls send('/d_recv', ...), which is
  // synchronous and returns void — so awaiting it proves only that the file
  // was fetched and dispatched. scsynth reports acceptance asynchronously as
  // /done and refusal as /fail, so those are what actually have to be read.
  const failures = []
  const unsubscribe = sonic.on('in', (msg) => {
    if (msg[0] === '/fail') failures.push(msg.slice(1).join(' '))
  })

  for (const name of defNames) {
    const before = failures.length
    let fetchError = null

    try {
      await sonic.loadSynthDef(name)
    } catch (error) {
      fetchError = String(error?.message ?? error)
    }

    // /sync resolves only once every prior async command has completed, so any
    // /fail caused by this /d_recv has arrived by the time it returns.
    try {
      await sonic.sync()
    } catch (error) {
      fetchError ??= `sync failed: ${String(error?.message ?? error)}`
    }

    const reported = failures.slice(before)
    out.push({
      name,
      ok: fetchError === null && reported.length === 0,
      ...(fetchError ? { error: fetchError } : {}),
      ...(reported.length > 0 ? { error: reported.join('; ') } : {}),
    })
  }

  unsubscribe()
  return out
}, names)

await browser.close()
server?.kill()

const failed = results.filter((r) => !r.ok)
const loaded = results.filter((r) => r.ok)

// The UGens present in every def that loaded are, empirically, supported.
const { parseSynthDefFile } = await import('@ss/engine/scsyndef')
const vendorDir = join(repoRoot, 'apps/playground/public/vendor/supersonic/synthdefs')

const supported = new Set()
const unproven = new Map()

for (const result of results) {
  let ugens
  try {
    const bytes = new Uint8Array(readFileSync(join(vendorDir, `${result.name}.scsyndef`)))
    ugens = [...new Set(parseSynthDefFile(bytes).defs.flatMap((d) => d.ugens.map((u) => u.className)))]
  } catch {
    continue // unparseable files are a separate problem, already pinned by tests
  }

  if (result.ok) for (const ugen of ugens) supported.add(ugen)
  else for (const ugen of ugens) unproven.set(ugen, [...(unproven.get(ugen) ?? []), result.name])
}

// A UGen only counts as suspect if no def that loaded contains it.
const suspect = [...unproven.entries()]
  .filter(([ugen]) => !supported.has(ugen))
  .map(([ugen, defs]) => ({ ugen, seenIn: defs }))
  .sort((a, b) => a.ugen.localeCompare(b.ugen))

const report = {
  engine: 'supersonic-scsynth@0.88.0',
  totals: { tried: results.length, loaded: loaded.length, failed: failed.length },
  supportedUGens: [...supported].sort(),
  suspectUGens: suspect,
  failures: failed.map(({ name, error }) => ({ name, error })),
}

writeFileSync(join(repoRoot, 'docs/UGEN-SURVEY.json'), `${JSON.stringify(report, null, 2)}\n`)

console.log(`loaded   ${loaded.length}/${results.length}`)
console.log(`failed   ${failed.length}`)
for (const { name, error } of failed) console.log(`   ${name}: ${error.split('\n')[0]}`)
console.log(`\nsupported UGen classes: ${supported.size}`)
if (suspect.length > 0) {
  console.log(`unsupported (appear only in defs that failed):`)
  for (const { ugen, seenIn } of suspect) console.log(`   ${ugen} — ${seenIn.join(', ')}`)
}
console.log(`\nwrote docs/UGEN-SURVEY.json`)
