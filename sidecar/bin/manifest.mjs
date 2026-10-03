#!/usr/bin/env node
// Describe the compiled defs and gate their promotion into dist/.
//
//   node bin/manifest.mjs             describe out/, diff against dist/, fail on drift
//   node bin/manifest.mjs --promote   copy out/ into dist/ and write the manifest
//
// dist/ is committed so the web build and CI never need SuperCollider. That
// only works if promotion is deliberate, hence the diff gate: a changed
// synthdef shows up as a reviewable sha256 rather than as a silent rebuild.

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSynthDefFile } from '@ss/engine/scsyndef'

const sidecar = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(sidecar, 'out')
const distDir = join(sidecar, 'dist')
const promote = process.argv.includes('--promote')

const listDefs = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.scsyndef'))
        .sort()
    : []

function describe(dir, filename) {
  const bytes = new Uint8Array(readFileSync(join(dir, filename)))
  const file = parseSynthDefFile(bytes)

  if (file.bytesConsumed !== bytes.length) {
    throw new Error(
      `${filename}: parser consumed ${file.bytesConsumed} of ${bytes.length} bytes — ` +
        `the file has trailing data this build does not understand`,
    )
  }
  if (file.defs.length !== 1) {
    throw new Error(`${filename}: expected exactly one def, found ${file.defs.length}`)
  }

  const def = file.defs[0]
  return {
    name: def.name,
    file: filename,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    formatVersion: file.version,
    params: def.params.map(({ name, index, default: value }) => ({ name, index, default: value })),
    ugens: [...new Set(def.ugens.map((u) => u.className))].sort(),
  }
}

const files = listDefs(outDir)
if (files.length === 0) {
  console.error('No .scsyndef files in sidecar/out/. Run `npm run sc:build` first.')
  process.exit(1)
}

const entries = files.map((filename) => describe(outDir, filename))

for (const entry of entries) {
  if (entry.name !== entry.file.replace(/\.scsyndef$/, '')) {
    throw new Error(`${entry.file}: embedded name is "${entry.name}"`)
  }
}

const manifest = {
  scVersion: readFileSync(join(outDir, 'sc-version.txt'), 'utf8')
    .split('\n')
    .find((line) => line.startsWith('SSP_VERSION'))
    ?.replace('SSP_VERSION ', '')
    .trim(),
  defs: entries,
}

const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`
const distManifest = join(distDir, 'manifest.json')

if (promote) {
  mkdirSync(distDir, { recursive: true })
  for (const entry of entries) copyFileSync(join(outDir, entry.file), join(distDir, entry.file))
  writeFileSync(distManifest, manifestJson)
  console.log(`promoted ${entries.length} def(s) into sidecar/dist/`)
  process.exit(0)
}

if (!existsSync(distManifest)) {
  console.error('sidecar/dist/manifest.json does not exist. Run `npm run sc:promote`.')
  process.exit(1)
}

if (readFileSync(distManifest, 'utf8') !== manifestJson) {
  const before = JSON.parse(readFileSync(distManifest, 'utf8'))
  const byName = new Map(before.defs.map((d) => [d.name, d]))

  console.error('sidecar/dist/ is out of date with sidecar/out/:')
  if (before.scVersion !== manifest.scVersion) {
    console.error(`  SuperCollider ${before.scVersion} -> ${manifest.scVersion}`)
  }
  for (const entry of entries) {
    const previous = byName.get(entry.name)
    if (!previous) console.error(`  + ${entry.name}`)
    else if (previous.sha256 !== entry.sha256) {
      console.error(`  ~ ${entry.name}  ${previous.sha256.slice(0, 12)} -> ${entry.sha256.slice(0, 12)}`)
    }
    byName.delete(entry.name)
  }
  for (const name of byName.keys()) console.error(`  - ${name}`)

  console.error('\nReview the change, then run `npm run sc:promote`.')
  process.exit(1)
}

console.log(`sidecar/dist/ is up to date (${entries.length} def(s))`)
