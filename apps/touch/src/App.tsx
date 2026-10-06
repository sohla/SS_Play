import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mapSpec, unmapSpec, type ControlSpec, type SynthDefContract } from '@ss/engine'
import { useSuperSonic } from '@ss/react'
import { BootGate } from '@ss/ui'
import { NOTE_NAMES, SCALES, midiToFreq, noteName, stripHue, stripNotes, type ScaleName } from './scale.ts'
import { DEF, Voices, type VoiceParams } from './voices.ts'

const SCALE_NAMES = Object.keys(SCALES) as ScaleName[]

/** The controls the surface exposes. The rest of the contract stays at its defaults. */
const SHOWN = ['cutoff', 'rq', 'detune', 'release']

export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const [contract, setContract] = useState<SynthDefContract | null>(null)

  const [root, setRoot] = useState(0)
  const [scale, setScale] = useState<ScaleName>('pentatonic')
  const [params, setParams] = useState<VoiceParams | null>(null)
  const [lit, setLit] = useState<number[]>([])

  const surface = useRef<HTMLDivElement>(null)
  const voices = useRef<Voices | null>(null)

  const notes = useMemo(() => stripNotes(root, scale), [root, scale])
  const booted = status.phase === 'ready' || status.phase === 'degraded'

  useEffect(() => {
    fetch(`${__SS_ENGINE_BASE__}synthdefs/${DEF}.contract.json`)
      .then((response) => response.json())
      .then((loaded: SynthDefContract) => {
        setContract(loaded)
        setParams(Object.fromEntries(loaded.specs.map((spec) => [spec.name, spec.default])))
      })
      .catch(() => setContract(null))
  }, [])

  useEffect(() => {
    const live = session()
    if (booted && live && !voices.current) voices.current = new Voices(live)
  }, [booted, session])

  // A finger still down when the page is hidden never gets its pointerup, and
  // SuperSonic suspends the engine on visibilitychange — so the note would be
  // waiting, sounding, when you came back.
  useEffect(() => {
    const release = () => {
      if (document.visibilityState === 'hidden') {
        voices.current?.stopAll()
        setLit([])
      }
    }
    document.addEventListener('visibilitychange', release)
    return () => document.removeEventListener('visibilitychange', release)
  }, [])

  /** Strip index, amplitude and pan from a point on the surface. */
  const read = useCallback(
    (clientX: number, clientY: number) => {
      const box = surface.current?.getBoundingClientRect()
      if (!box) return null

      const x = Math.min(Math.max((clientX - box.left) / box.width, 0), 0.9999)
      const y = Math.min(Math.max((clientY - box.top) / box.height, 0), 1)
      const strip = Math.floor(x * notes.length)

      return {
        strip,
        // Up is louder. Squared so the quiet end has travel: amplitude is
        // perceived roughly logarithmically, and a linear map puts every useful
        // level in the top third of the strip.
        amp: (1 - y) ** 2 * 0.8,
        pan: x * 2 - 1,
      }
    },
    [notes.length],
  )

  const onDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const live = voices.current
      const point = read(event.clientX, event.clientY)
      if (!live || !point || !params) return

      // Capture on the surface, not the strip: a finger that slides off the
      // element it started on would otherwise stop sending moves, and the note
      // would stick.
      event.currentTarget.setPointerCapture(event.pointerId)

      const note = notes[point.strip]
      if (note === undefined) return

      live.start(event.pointerId, point.strip, midiToFreq(note), point.amp, point.pan, params)
      setLit(live.activeStrips)
    },
    [notes, params, read],
  )

  const onMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const live = voices.current
      const point = read(event.clientX, event.clientY)
      if (!live || !point) return

      const note = notes[point.strip]
      if (note === undefined) return

      // Fires at pointer rate per finger. It re-renders only when the lit strip
      // actually changes, never for a change in amplitude.
      if (live.move(event.pointerId, point.strip, midiToFreq(note), point.amp, point.pan)) {
        setLit(live.activeStrips)
      }
    },
    [notes, read],
  )

  const onUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const live = voices.current
    if (live?.stop(event.pointerId)) setLit(live.activeStrips)
  }, [])

  const setParam = useCallback((name: string, value: number) => {
    setParams((current) => (current ? { ...current, [name]: value } : current))
    voices.current?.setParam(name, value)
  }, [])

  return (
    <main className="flex h-dvh flex-col bg-canvas text-neutral-200">
      {!booted ? (
        <div className="flex flex-1 flex-col justify-center px-6">
          <h1 className="text-lg font-semibold tracking-tight">touch</h1>
          <p className="mb-6 mt-1 text-sm text-neutral-500">
            A strip per note. Press anywhere to sound it, slide up for louder, use as many fingers
            as you have.
          </p>
          <BootGate
            phase={status.phase}
            error={status.error}
            degradedReason={status.degradedReason}
            sabUnavailable={probe.sabUnavailable}
            onBoot={boot}
          />
          <a href="/" className="mt-8 text-xs text-neutral-600 underline decoration-dotted">
            ← playground
          </a>
        </div>
      ) : (
        <>
          <div
            ref={surface}
            data-testid="surface"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            // touch-action none, scoped to this element: without it the browser
            // claims a vertical drag for scrolling and the note dies mid-slide.
            // On body it would break scrolling everywhere.
            className="flex min-h-0 flex-1 touch-none select-none"
          >
            {notes.map((note, index) => (
              <div
                key={`${note}-${index}`}
                data-testid={`strip-${index}`}
                className="relative flex-1 border-r border-black/20 transition-[filter] duration-75 last:border-r-0"
                style={{
                  backgroundColor: `hsl(${stripHue(index, notes.length)} 70% ${lit.includes(index) ? 78 : 58}%)`,
                  filter: lit.includes(index) ? 'brightness(1.25)' : undefined,
                }}
              >
                <span className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[10px] font-medium text-black/50">
                  {noteName(note)}
                </span>
              </div>
            ))}
          </div>

          <div className="pad-safe flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-neutral-800 pt-2">
            <Picker label="root" value={String(root)} onChange={(next) => setRoot(Number(next))}>
              {NOTE_NAMES.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </Picker>

            <Picker
              label="scale"
              value={scale}
              onChange={(next) => setScale(next as ScaleName)}
            >
              {SCALE_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Picker>

            {contract && params
              ? contract.specs
                  .filter((spec) => SHOWN.includes(spec.name))
                  .map((spec) => (
                    <Knob
                      key={spec.name}
                      spec={spec}
                      value={params[spec.name] ?? spec.default}
                      onChange={(value) => setParam(spec.name, value)}
                    />
                  ))
              : null}
          </div>
        </>
      )}
    </main>
  )
}

function Picker({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange(value: string): void
  children: React.ReactNode
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded border border-neutral-700 bg-neutral-900 px-2 text-neutral-200"
      >
        {children}
      </select>
    </label>
  )
}

/**
 * A slider over one spec from the SynthDef's own contract.
 *
 * Works in 0..1 and maps through the spec, so the range and curve are the ones
 * declared beside the UGen graph rather than numbers written again here.
 */
function Knob({
  spec,
  value,
  onChange,
}: {
  spec: ControlSpec
  value: number
  onChange(value: number): void
}) {
  return (
    <label className="flex min-w-36 flex-1 items-center gap-2 text-xs text-neutral-500">
      <span className="w-14 shrink-0 font-mono">{spec.name}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={unmapSpec(spec, value)}
        onChange={(event) => onChange(mapSpec(spec, Number(event.target.value)))}
        aria-label={spec.name}
        className="ss-range min-w-0 flex-1"
      />
    </label>
  )
}
