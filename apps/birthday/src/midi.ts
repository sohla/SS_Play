/**
 * A Standard MIDI File reader, just wide enough for a melody.
 *
 * Notes, tempo, time signature and key signature — everything else is skipped by
 * its length. No dependency: the format is forty years old, the subset is a page,
 * and a parser that only ever runs on the build machine has no business in the
 * client's lockfile.
 */

export interface MidiNote {
  /** Onset in ticks from the start of the file. */
  tick: number
  /** Length in ticks. */
  ticks: number
  midi: number
  velocity: number
}

export interface MidiSong {
  /** Ticks per quarter note. */
  ppq: number
  /** Quarter notes per minute, from the first tempo event. 120 if there is none. */
  bpm: number
  /** Beats per bar and the beat's note value, e.g. 3 and 4. */
  meter: [number, number]
  /** Sharps (positive) or flats (negative), and whether it is minor. */
  key: { accidentals: number; minor: boolean }
  /** Every note in every track, sorted by onset. */
  notes: MidiNote[]
}

class Reader {
  at = 0
  readonly bytes: Uint8Array

  // Not a parameter property: Node's type stripping rejects them, and the
  // generator in tools/ runs this file under plain `node`.
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  u8() {
    const byte = this.bytes[this.at++]
    if (byte === undefined) throw new RangeError('MIDI file ends mid-event')
    return byte
  }

  u16() {
    return (this.u8() << 8) | this.u8()
  }

  u32() {
    return ((this.u16() << 16) >>> 0) + this.u16()
  }

  /** MIDI's variable-length quantity: seven bits a byte, high bit means "more". */
  vlq() {
    let value = 0
    for (;;) {
      const byte = this.u8()
      value = value * 128 + (byte & 0x7f)
      if (!(byte & 0x80)) return value
    }
  }

  ascii(length: number) {
    return String.fromCharCode(...this.bytes.subarray(this.at, (this.at += length)))
  }
}

export function parseMidi(bytes: Uint8Array): MidiSong {
  const r = new Reader(bytes)
  if (r.ascii(4) !== 'MThd') throw new Error('Not a MIDI file: no MThd header')
  const headerLength = r.u32()
  r.u16() // format: 0 and 1 read the same once every track is merged
  const tracks = r.u16()
  const division = r.u16()
  if (division & 0x8000) throw new Error('SMPTE time division is not supported')
  r.at += headerLength - 6

  const song: MidiSong = {
    ppq: division,
    bpm: 120,
    meter: [4, 4],
    key: { accidentals: 0, minor: false },
    notes: [],
  }
  let tempoSeen = false

  for (let t = 0; t < tracks; t++) {
    if (r.ascii(4) !== 'MTrk') throw new Error(`Track ${t} has no MTrk header`)
    const end = r.u32() + r.at
    let tick = 0
    let status = 0
    /** Sounding notes by channel and pitch, waiting for their note-off. */
    const open = new Map<number, { tick: number; velocity: number }>()

    const close = (channel: number, midi: number) => {
      const started = open.get(channel * 128 + midi)
      if (!started) return
      open.delete(channel * 128 + midi)
      song.notes.push({ tick: started.tick, ticks: tick - started.tick, midi, velocity: started.velocity })
    }

    while (r.at < end) {
      tick += r.vlq()
      let byte = r.u8()

      if (byte === 0xff) {
        const type = r.u8()
        const length = r.vlq()
        const from = r.at
        if (type === 0x51 && !tempoSeen) {
          const usPerBeat = (r.u8() << 16) | (r.u8() << 8) | r.u8()
          song.bpm = 60_000_000 / usPerBeat
          tempoSeen = true
        } else if (type === 0x58) {
          song.meter = [r.u8(), 2 ** r.u8()]
        } else if (type === 0x59) {
          const sf = r.u8()
          song.key = { accidentals: sf > 127 ? sf - 256 : sf, minor: r.u8() === 1 }
        }
        r.at = from + length
        continue
      }

      if (byte === 0xf0 || byte === 0xf7) {
        r.at += r.vlq()
        continue
      }

      // Running status: a data byte where a status byte should be repeats the last one.
      if (byte & 0x80) status = byte
      else r.at -= 1
      byte = status

      const kind = byte & 0xf0
      const channel = byte & 0x0f
      if (kind === 0x90 || kind === 0x80) {
        const midi = r.u8()
        const velocity = r.u8()
        close(channel, midi)
        // A note-on at velocity zero is a note-off, which is how LilyPond writes them.
        if (kind === 0x90 && velocity > 0) open.set(channel * 128 + midi, { tick, velocity })
      } else if (kind === 0xc0 || kind === 0xd0) {
        r.u8()
      } else {
        r.u8()
        r.u8()
      }
    }
    r.at = end
  }

  song.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi)
  return song
}
