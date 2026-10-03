import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { SynthDefParseError, parseSynthDefFile } from '../src/scsyndef/index.ts'

// The binary-contract tier. No browser, no SuperCollider — just the parser
// against every compiled def that ships, which is the strongest corpus
// available: 131 files spanning all three format versions, produced by the
// real compiler rather than by hand.

const require = createRequire(import.meta.url)
const corpusDir = join(
  require.resolve('supersonic-scsynth-synthdefs/package.json'),
  '..',
  'synthdefs',
)

// Shipped corrupt in supersonic-scsynth-synthdefs@0.88.0, and excluded from the
// must-parse set rather than silently tolerated. See the "known bad" block at
// the bottom, which pins the exact corruption so an upstream fix is noticed.
const KNOWN_BAD = new Set(['sonic-pi-mixout.scsyndef'])

const allFiles = readdirSync(corpusDir)
  .filter((name) => name.endsWith('.scsyndef'))
  .sort()

const files = allFiles.filter((name) => !KNOWN_BAD.has(name))

const read = (name: string) => new Uint8Array(readFileSync(join(corpusDir, name)))

describe('corpus', () => {
  it('is present and large enough to be worth asserting against', () => {
    expect(files.length).toBeGreaterThanOrEqual(129)
  })

  it('covers all three format versions', () => {
    const versions = new Set(files.map((name) => parseSynthDefFile(read(name)).version))
    expect([...versions].sort()).toEqual([1, 2, 3])
  })
})

describe.each(files)('%s', (name) => {
  const bytes = read(name)
  const parsed = parseSynthDefFile(bytes)

  it('consumes the file exactly', () => {
    // The property that matters most. Short of the end means trailing bytes we
    // did not understand; a truncated or text-mangled copy shows up here and
    // nowhere else until it fails opaquely in the browser.
    expect(parsed.bytesConsumed).toBe(bytes.length)
  })

  it('declares exactly one def whose name matches the filename', () => {
    expect(parsed.defs).toHaveLength(1)
    expect(parsed.defs[0]?.name).toBe(basename(name, '.scsyndef'))
  })

  it('has at least one ugen', () => {
    expect(parsed.defs[0]?.ugens.length).toBeGreaterThan(0)
  })

  it('resolves every parameter to a declared default', () => {
    for (const param of parsed.defs[0]?.params ?? []) {
      expect(param.name, param.name).not.toBe('')
      expect(Number.isFinite(param.default), param.name).toBe(true)
    }
  })

  it('names every ugen class', () => {
    for (const ugen of parsed.defs[0]?.ugens ?? []) {
      expect(ugen.className).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/)
      expect(ugen.rate).toBeGreaterThanOrEqual(0)
      expect(ugen.rate).toBeLessThanOrEqual(3)
    }
  })
})

describe('across the corpus', () => {
  const parsed = files.map((name) => ({ name, file: parseSynthDefFile(read(name)) }))

  it('has no duplicate def names', () => {
    const names = parsed.map(({ file }) => file.defs[0]?.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('declares parameter indices densely, 0..n-1', () => {
    for (const { name, file } of parsed) {
      const indices = (file.defs[0]?.params ?? []).map((p) => p.index).sort((a, b) => a - b)
      expect(indices, name).toEqual(indices.map((_, i) => i))
    }
  })
})

describe('format extremes', () => {
  it('parses the widest graph', () => {
    // 164 ugens, ~13KB — the largest def in the corpus.
    const def = parseSynthDefFile(read('sonic-pi-fx_vowel.scsyndef')).defs[0]
    expect(def?.ugens.length).toBeGreaterThan(150)
  })

  it('parses the def with the most parameters', () => {
    const def = parseSynthDefFile(read('sonic-pi-mono_player.scsyndef')).defs[0]
    expect(def?.params.length).toBeGreaterThan(90)
  })

  it('reads the format 3 per-def length prefix', () => {
    // Only two files in the corpus use format 3. The prefix measures from
    // itself, so it plus the 10-byte header accounts for the whole file.
    const bytes = read('number.scsyndef')
    const file = parseSynthDefFile(bytes)
    expect(file.version).toBe(3)
    expect(file.defs[0]?.declaredByteLength).toBe(bytes.length - 10)
  })

  it('steps over the format 3 section this parser does not model', () => {
    // 0.88 emits 16 bytes per def that 0.66 did not, inside the declared
    // length. Honouring the prefix absorbs them; the count is surfaced rather
    // than hidden, so a future format change is visible here first.
    for (const name of ['number.scsyndef', 'u_cmd_test.scsyndef']) {
      const def = parseSynthDefFile(read(name)).defs[0]
      expect(def?.trailingBytes, name).toBe(16)
    }
  })

  it('leaves the format 3 fields off formats 1 and 2', () => {
    const def = parseSynthDefFile(read('sonic-pi-beep.scsyndef')).defs[0]
    expect(def?.declaredByteLength).toBe(undefined)
    expect(def?.trailingBytes).toBe(undefined)
  })
})

describe('known shapes', () => {
  it('reads sonic-pi-beep as written', () => {
    const def = parseSynthDefFile(read('sonic-pi-beep.scsyndef')).defs[0]

    expect(def?.params.slice(0, 5)).toEqual([
      { name: 'note', index: 0, default: 52 },
      { name: 'note_slide', index: 1, default: 0 },
      { name: 'note_slide_shape', index: 2, default: 1 },
      { name: 'note_slide_curve', index: 3, default: 0 },
      { name: 'amp', index: 4, default: 1 },
    ])

    const classes = def?.ugens.map((u) => u.className) ?? []
    expect(classes).toContain('SinOsc')
    expect(classes).toContain('EnvGen')
    expect(classes).toContain('Out')
  })
})

describe('malformed input', () => {
  const good = read('sonic-pi-beep.scsyndef')

  it('rejects a non-SynthDef file by magic', () => {
    expect(() => parseSynthDefFile(new TextEncoder().encode('not a synthdef at all'))).toThrow(
      SynthDefParseError,
    )
  })

  it('rejects an unknown format version', () => {
    const bytes = good.slice()
    new DataView(bytes.buffer).setInt32(4, 99)
    expect(() => parseSynthDefFile(bytes)).toThrow(/Unsupported SynthDef format version 99/)
  })

  it('throws a typed error with an offset for every truncation', () => {
    // Truncation is the realistic corruption: a partial copy, a build that
    // wrote half a file. It must never parse into a plausible-looking def.
    for (let cut = 1; cut < good.length; cut += 37) {
      let caught: unknown
      try {
        const parsed = parseSynthDefFile(good.subarray(0, cut))
        // Surviving is only acceptable if it reports reading less than it was
        // handed, which the contract test above would flag.
        expect(parsed.bytesConsumed, `cut ${cut}`).toBeLessThan(cut)
        continue
      } catch (error) {
        caught = error
      }

      expect(caught, `cut ${cut}`).toBeInstanceOf(SynthDefParseError)
      const error = caught as SynthDefParseError
      expect(error.offset, `cut ${cut}`).toBeGreaterThanOrEqual(0)
      expect(error.offset, `cut ${cut}`).toBeLessThanOrEqual(cut)
      expect(error.message, `cut ${cut}`).toMatch(/byte \d+/)
    }
  })

  it('does not throw a bare RangeError', () => {
    try {
      parseSynthDefFile(good.subarray(0, 24))
      expect.unreachable('truncated file should not parse')
    } catch (error) {
      expect(error).toBeInstanceOf(SynthDefParseError)
      expect(error).not.toBeInstanceOf(RangeError)
    }
  })
})

describe('known bad: sonic-pi-mixout.scsyndef', () => {
  // Corrupt as shipped in supersonic-scsynth-synthdefs@0.88.0. The def name
  // "sonic-pi-mixout" (15 chars) was written into a field whose length byte
  // says 14, so its final "t" (0x74) landed on the high byte of the int16
  // constant count — turning 11 constants into 29707 and derailing everything
  // after it. The rest of the file is laid out correctly for a 14-char name.
  //
  // sclang cannot read it either, so this is upstream, not us. These
  // assertions pin the exact corruption: when upstream fixes the file, they
  // fail and the entry comes out of KNOWN_BAD.
  const bytes = read('sonic-pi-mixout.scsyndef')

  it('is still in the corpus', () => {
    expect(allFiles).toContain('sonic-pi-mixout.scsyndef')
  })

  it('still has the single corrupt byte', () => {
    expect(bytes[10]).toBe(14) // name length byte
    expect(bytes[25]).toBe(0x74) // 't', overwriting the count's high byte
  })

  it('is rejected with a typed error rather than mis-parsed', () => {
    // The dangerous outcome would be parsing into a plausible-looking def.
    expect(() => parseSynthDefFile(bytes)).toThrow(SynthDefParseError)
  })

  it('parses cleanly once that byte is restored, which is what proves the cause', () => {
    const repaired = bytes.slice()
    repaired[25] = 0x00

    const file = parseSynthDefFile(repaired)
    expect(file.bytesConsumed).toBe(repaired.length)
    expect(file.defs[0]?.constants).toHaveLength(11)
    expect(file.defs[0]?.params).toHaveLength(24)
    expect(file.defs[0]?.ugens).toHaveLength(85)
    // Note the name is a byte short, because the file genuinely is.
    expect(file.defs[0]?.name).toBe('sonic-pi-mixou')
  })
})
