import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSynthDefFile } from '../src/scsyndef/index.ts'

// Guards the committed output of the sclang sidecar.
//
// sidecar/dist/ is committed precisely so the web build and CI never need
// SuperCollider installed — which only works if something checks that what was
// committed is internally consistent. These tests run anywhere Node runs.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const distDir = join(repoRoot, 'sidecar', 'dist')

interface Manifest {
  scVersion: string
  defs: {
    name: string
    file: string
    bytes: number
    sha256: string
    formatVersion: number
    params: { name: string; index: number; default: number }[]
    ugens: string[]
  }[]
}

const manifest = JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf8')) as Manifest
const files = readdirSync(distDir)
  .filter((name) => name.endsWith('.scsyndef'))
  .sort()

describe('the committed manifest', () => {
  it('records the SuperCollider that produced these bytes', () => {
    // A byte change with no source change is then attributable to a compiler
    // upgrade rather than a mystery.
    expect(manifest.scVersion).toMatch(/^\d+\.\d+/)
  })

  it('covers every committed file and no others', () => {
    expect(manifest.defs.map((d) => d.file).sort()).toEqual(files)
  })

  it('declares at least one def', () => {
    expect(manifest.defs.length).toBeGreaterThan(0)
  })
})

describe.each(manifest.defs.map((def) => [def.name, def] as const))('%s', (_name, def) => {
  const bytes = new Uint8Array(readFileSync(join(distDir, def.file)))

  it('matches the recorded hash', () => {
    // The promotion gate's whole premise: a changed synthdef is a reviewable
    // sha256 in the diff rather than a silent rebuild.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(def.sha256)
    expect(bytes.length).toBe(def.bytes)
  })

  it('parses with byte-exact consumption', () => {
    const file = parseSynthDefFile(bytes)
    expect(file.bytesConsumed).toBe(bytes.length)
    expect(file.version).toBe(def.formatVersion)
  })

  it('matches the manifest when re-parsed', () => {
    const parsed = parseSynthDefFile(bytes).defs[0]
    expect(parsed?.name).toBe(def.name)
    expect(parsed?.params).toEqual(def.params)
    expect([...new Set(parsed?.ugens.map((u) => u.className))].sort()).toEqual(def.ugens)
  })

  it('is namespaced so it cannot collide with a vendored def', () => {
    // The synthdefs package ships 131 sonic-pi-* defs into the same directory.
    expect(def.name).toMatch(/^ssp_/)
    expect(def.file).toBe(`${def.name}.scsyndef`)
  })

  it('declares out and amp, which every page addresses by name', () => {
    const names = def.params.map((p) => p.name)
    expect(names).toContain('out')
    expect(names).toContain('amp')
  })

  it('has finite defaults', () => {
    for (const param of def.params) {
      expect(Number.isFinite(param.default), param.name).toBe(true)
    }
  })
})
