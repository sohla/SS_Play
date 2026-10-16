import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HAPPY_BIRTHDAY } from '../src/happy-birthday.ts'
import { chordsPerBar, scaleOf, soundingAt } from '../src/harmony.ts'
import { RESTING_GESTURE, type Gesture } from '../src/mapping.ts'
import { parseMidi } from '../src/midi.ts'
import { patternFrom } from '../src/pattern.ts'
import { descantAt, freshDescant, melodyAt, midiToFreq, positionOf } from '../src/song.ts'

const MIDI = readFileSync(new URL('../midi/happy-birthday.mid', import.meta.url))
const P = HAPPY_BIRTHDAY
const CHORDS = chordsPerBar(P)
const freqToMidi = (freq: number) => Math.round(69 + 12 * Math.log2(freq / 440))

describe('the MIDI file becomes the pattern', () => {
  it('reads the file the page was generated from', () => {
    const song = parseMidi(MIDI)
    expect(song.meter).toEqual([3, 4])
    expect(song.key).toEqual({ accidentals: -1, minor: false })
    expect(song.bpm).toBeCloseTo(130, 2)
    expect(song.notes).toHaveLength(26)
  })

  it('matches the committed pattern — rerun `npm run pattern` if this fails', () => {
    expect(patternFrom(parseMidi(MIDI))).toEqual(P)
  })

  it('puts "Hap-py" before the bar line, not on it', () => {
    // LilyPond writes the pickup from tick zero. Read naively the song starts on
    // a downbeat and every strong beat lands a beat early.
    const bar = (n: number) =>
      P.notes.filter((note) => Math.floor(note.step / P.stepsPerBar) === n).map((note) => note.midi)
    expect(bar(1)).toEqual([62, 60, 65]) // birth-day to: D C F
    expect(bar(2)).toEqual([64, 60, 60]) // you, Hap-py: E C C
    // The final "you", then the pickup back to the top: the loop has no gap.
    expect(bar(0)).toEqual([65, 60, 60])
  })

  it('is in F major, eight bars of 3/4', () => {
    expect(P.tonic).toBe(5)
    expect(P.loopSteps).toBe(8 * 12)
  })
})

describe('the harmony comes from the melody', () => {
  it('finds the textbook progression', () => {
    // Loop bar 0 is the last bar of the song, so in sung order this reads
    // I | I V V I I IV I.
    expect(CHORDS.map((chord) => chord.name)).toEqual(['I', 'I', 'V', 'V', 'I', 'I', 'IV', 'I'])
  })
})

describe('the melody loops', () => {
  it('plays every note exactly once per pass, and again on the next', () => {
    for (const pass of [0, 1, 14_000_000]) {
      const played = []
      for (let k = 0; k < P.loopSteps; k++) played.push(...melodyAt(P, pass * P.loopSteps + k))
      expect(played.map((event) => freqToMidi(event.controls.freq as number))).toEqual(
        P.notes.map((note) => note.midi),
      )
    }
  })
})

/** Run the descant over several passes of the loop with a fixed gesture. */
function run(gesture: Partial<Gesture>, passes = 3) {
  const state = freshDescant()
  const live = { ...RESTING_GESTURE, ...gesture }
  const notes: { position: number; midi: number }[] = []
  for (let step = 0; step < P.loopSteps * passes; step++) {
    live.accent = false
    for (const event of descantAt(P, CHORDS, step, live, state)) {
      notes.push({ position: positionOf(P, step), midi: freqToMidi(event.controls.freq as number) })
    }
  }
  return notes
}

describe('the descant fits the tune', () => {
  const top = Math.max(...P.notes.map((note) => note.midi))

  it('is silent while the phone is still', () => {
    expect(run({ energy: 0 })).toHaveLength(0)
  })

  it('quickens with energy: quarters, then eighths, then sixteenths', () => {
    const count = (energy: number) => run({ energy, span: 1 }, 1).length
    expect(count(0.1)).toBeLessThan(count(0.5))
    expect(count(0.5)).toBeLessThan(count(0.95))
    expect(count(0.95)).toBe(P.loopSteps)
  })

  for (const gesture of [
    { energy: 0.1, span: 0, lean: 0 },
    { energy: 0.5, span: 0.5, lean: 1 },
    { energy: 0.95, span: 1, lean: -1 },
  ]) {
    describe(`at ${JSON.stringify(gesture)}`, () => {
      const notes = run(gesture)

      it('stays above the melody', () => {
        for (const note of notes) expect(note.midi).toBeGreaterThan(top)
      })

      it('plays chord tones on the beat and scale tones between', () => {
        const scale = scaleOf(P)
        for (const note of notes) {
          const chord = CHORDS[Math.floor(note.position / P.stepsPerBar)]!
          if (note.position % P.stepsPerBeat === 0) expect(chord.tones).toContain(note.midi % 12)
          else expect(scale).toContain(note.midi % 12)
        }
      })

      it('never sits a semitone from the note the melody is sounding', () => {
        for (const note of notes) {
          const melody = soundingAt(P, note.position)
          if (!melody) continue
          const interval = (((note.midi - melody.midi) % 12) + 12) % 12
          expect([1, 11]).not.toContain(interval)
        }
      })
    })
  }

  it('climbs higher as the phone turns', () => {
    const highest = (span: number) => Math.max(...run({ energy: 0.95, span }).map((n) => n.midi))
    expect(highest(1)).toBeGreaterThan(highest(0))
  })

  it('spends an accent on one note, an octave up', () => {
    const state = freshDescant()
    const live = { ...RESTING_GESTURE, energy: 0.95, accent: true }
    const [first] = descantAt(P, CHORDS, 0, live, state)
    expect(first?.controls.freq).toBeCloseTo(midiToFreq(state.last + 12), 6)
    expect(live.accent).toBe(false)
  })
})
