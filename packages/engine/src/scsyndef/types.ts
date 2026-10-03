/** Calculation rate, as encoded in the binary. */
export type UGenRate = 0 | 1 | 2 | 3

export const RATE_NAMES: Readonly<Record<UGenRate, string>> = Object.freeze({
  0: 'scalar',
  1: 'control',
  2: 'audio',
  3: 'demand',
})

export interface SynthDefParam {
  name: string
  /** Index into the def's parameter-value array. */
  index: number
  /** The value the synth starts with when the caller sends nothing. */
  default: number
}

export interface SynthDefUGen {
  className: string
  rate: UGenRate
  numInputs: number
  numOutputs: number
  specialIndex: number
}

export interface SynthDefVariant {
  name: string
  values: number[]
}

export interface SynthDef {
  name: string
  params: SynthDefParam[]
  ugens: SynthDefUGen[]
  variants: SynthDefVariant[]
  constants: number[]
  /** Only present in format 3, which prefixes each def with its own length. */
  declaredByteLength?: number
  /**
   * Format 3 only: bytes inside the declared length that no known field
   * accounts for. Non-zero means the writer emitted a section this parser does
   * not understand — harmless, because the length prefix lets us step over it,
   * but worth surfacing rather than discarding silently.
   */
  trailingBytes?: number
}

export interface SynthDefFile {
  /** 1 (int16 counts), 2 (int32 counts), or 3 (int32 counts + per-def length). */
  version: 1 | 2 | 3
  defs: SynthDef[]
  /**
   * Bytes read. A healthy file consumes exactly its own length; anything less
   * means trailing data, which is how a truncated or mangled copy shows up.
   */
  bytesConsumed: number
}

/** Parse failure carrying the byte offset, so a bad file names its own problem. */
export class SynthDefParseError extends Error {
  override readonly name = 'SynthDefParseError'

  readonly offset: number
  readonly context: string | undefined

  constructor(message: string, offset: number, context?: string) {
    super(context ? `${message} at byte ${offset} (${context})` : `${message} at byte ${offset}`)
    this.offset = offset
    this.context = context
  }
}
