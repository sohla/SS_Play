import {
  SynthDefParseError,
  type SynthDef,
  type SynthDefFile,
  type SynthDefParam,
  type SynthDefUGen,
  type SynthDefVariant,
  type UGenRate,
} from './types'

const MAGIC = 0x53436766 // 'SCgf'

class Reader {
  offset = 0
  private readonly view: DataView

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  private need(count: number, what: string) {
    if (this.offset + count > this.view.byteLength) {
      throw new SynthDefParseError(
        `Unexpected end of file reading ${what}: wanted ${count} byte${count === 1 ? '' : 's'}, ` +
          `${this.view.byteLength - this.offset} remain`,
        this.offset,
        what,
      )
    }
  }

  u8(what: string): number {
    this.need(1, what)
    return this.view.getUint8(this.offset++)
  }

  i16(what: string): number {
    this.need(2, what)
    const value = this.view.getInt16(this.offset)
    this.offset += 2
    return value
  }

  i32(what: string): number {
    this.need(4, what)
    const value = this.view.getInt32(this.offset)
    this.offset += 4
    return value
  }

  f32(what: string): number {
    this.need(4, what)
    const value = this.view.getFloat32(this.offset)
    this.offset += 4
    return value
  }

  /** Pascal string: one length byte then that many UTF-8 bytes. */
  pstring(what: string): string {
    const length = this.u8(`${what} length`)
    this.need(length, what)
    const text = new TextDecoder().decode(this.bytes.subarray(this.offset, this.offset + length))
    this.offset += length
    return text
  }
}

// The only structural difference between format 1 and 2: every count and index
// widened from int16 to int32. Format 3 keeps 2's widths and adds a per-def
// byte length.
function readIndex(reader: Reader, version: number, what: string): number {
  return version === 1 ? reader.i16(what) : reader.i32(what)
}

function readCount(reader: Reader, version: number, what: string): number {
  const value = readIndex(reader, version, what)
  if (value < 0) {
    throw new SynthDefParseError(`Negative count for ${what}: ${value}`, reader.offset, what)
  }
  return value
}

function parseDef(reader: Reader, version: 1 | 2 | 3): SynthDef {
  const defStart = reader.offset
  const declaredByteLength = version >= 3 ? reader.i32('def byte length') : undefined

  const name = reader.pstring('def name')
  const count = (what: string) => readCount(reader, version, what)

  const constants: number[] = []
  for (let i = count('constant count'); i > 0; i--) constants.push(reader.f32('constant'))

  const paramValues: number[] = []
  for (let i = count('parameter value count'); i > 0; i--) {
    paramValues.push(reader.f32('parameter value'))
  }

  const params: SynthDefParam[] = []
  for (let i = count('parameter name count'); i > 0; i--) {
    const paramName = reader.pstring('parameter name')
    const index = count('parameter index')
    const value = paramValues[index]
    if (value === undefined) {
      throw new SynthDefParseError(
        `Parameter "${paramName}" points at value index ${index}, but only ` +
          `${paramValues.length} value${paramValues.length === 1 ? '' : 's'} were declared`,
        reader.offset,
        name,
      )
    }
    params.push({ name: paramName, index, default: value })
  }

  const ugens: SynthDefUGen[] = []
  for (let i = count('ugen count'); i > 0; i--) {
    const className = reader.pstring('ugen class name')
    const rate = reader.u8('ugen rate') as UGenRate
    const numInputs = count('ugen input count')
    const numOutputs = count('ugen output count')
    const specialIndex = reader.i16('ugen special index')

    // Inputs and outputs are skipped rather than retained: the graph wiring is
    // not something any consumer here needs, and holding it would multiply the
    // memory cost of parsing a corpus by a large factor for no use.
    //
    // These are signed indices, not counts. A source of -1 means the input is a
    // constant, and the paired value indexes the constants array instead of a
    // ugen output — so rejecting negatives here rejects most real files.
    for (let input = numInputs; input > 0; input--) {
      readIndex(reader, version, 'ugen input source')
      readIndex(reader, version, 'ugen input index')
    }
    for (let output = numOutputs; output > 0; output--) reader.u8('ugen output rate')

    ugens.push({ className, rate, numInputs, numOutputs, specialIndex })
  }

  const variants: SynthDefVariant[] = []
  for (let i = reader.i16('variant count'); i > 0; i--) {
    const variantName = reader.pstring('variant name')
    const values: number[] = []
    for (let v = paramValues.length; v > 0; v--) values.push(reader.f32('variant value'))
    variants.push({ name: variantName, values })
  }

  // Format 3 prefixes each def with its own byte length, measured from the
  // prefix itself. That exists so a reader can step over sections it does not
  // understand, so use it rather than assuming the def ends where our fields
  // run out — supersonic-scsynth-synthdefs@0.88.0 emits 16 trailing bytes per
  // def that 0.66 did not, and honouring the length absorbs that instead of
  // reporting the file as having trailing garbage.
  let trailingBytes = 0
  if (declaredByteLength !== undefined) {
    const end = defStart + declaredByteLength
    if (end < reader.offset) {
      throw new SynthDefParseError(
        `Def "${name}" declares ${declaredByteLength} bytes but its fields ran ` +
          `${reader.offset - end} past that`,
        reader.offset,
        name,
      )
    }
    trailingBytes = end - reader.offset
    reader.offset = end
  }

  return {
    name,
    params,
    ugens,
    variants,
    constants,
    ...(declaredByteLength === undefined ? {} : { declaredByteLength, trailingBytes }),
  }
}

/**
 * Parse a compiled SuperCollider SynthDef file.
 *
 * Handles all three formats found in the wild: 1 (int16 counts), 2 (int32
 * counts), and 3 (as 2, plus an int32 byte length before each def).
 */
export function parseSynthDefFile(input: Uint8Array | ArrayBuffer): SynthDefFile {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const reader = new Reader(bytes)

  const magic = reader.i32('magic')
  if (magic !== MAGIC) {
    throw new SynthDefParseError(
      `Not a SynthDef file: expected magic "SCgf", got ${JSON.stringify(
        new TextDecoder().decode(bytes.subarray(0, 4)),
      )}`,
      0,
      'magic',
    )
  }

  const version = reader.i32('format version')
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new SynthDefParseError(`Unsupported SynthDef format version ${version}`, 4, 'version')
  }

  const defs: SynthDef[] = []
  for (let i = reader.i16('def count'); i > 0; i--) defs.push(parseDef(reader, version))

  return { version, defs, bytesConsumed: reader.offset }
}
