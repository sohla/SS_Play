import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import {
  DEFAULT_CONTROLS,
  PLOT_LABELS,
  RANGES,
  SILENCE_BELOW,
  amplitudeOf,
  curveReads,
  decayReads,
  mapThrum,
  plotOf,
  regimeOf,
  type Controls,
} from './mapping.ts'

/**
 * One layer, one synth, one `held` voice.
 *
 * No conductor and no clock. The retrigger is an `Impulse` inside the graph,
 * which is the only place it can be: the rate runs to 90Hz, where an OSC round
 * trip is the same order as the interval between events, so the rate the hand
 * asked for and the rate the skin received would be different numbers.
 *
 * The three defs this replaced — a Demand clock, a tap voice and a two-layer bed
 * — are deleted. Their structure was never what was wrong.
 */
const INSTRUMENT = [{ kind: 'held' as const, def: 'ssp_thrum', initial: { intensity: 0 } }]

export function App() {
  /**
   * Both, for the reason `sensitivity` inside `MotionInstrument` is both.
   *
   * The state drives the sliders. The ref is what `map` reads, because `map` is
   * in the sending effect's dependency list — a callback that changed identity
   * on every slider frame would tear down and re-arm the 30Hz loop mid-drag.
   */
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS)
  const live = useRef<Controls>(DEFAULT_CONTROLS)

  const set = useCallback(<K extends keyof Controls>(key: K, value: Controls[K]) => {
    // The ref first. The loop reads it and must not wait for a render.
    live.current = { ...live.current, [key]: value }
    setControls(live.current)
  }, [])

  const map = useCallback(
    (motion: Motion, sensitivity: number) => mapThrum(motion, sensitivity, live.current),
    [],
  )
  const plot = useCallback(
    (motion: Motion, sensitivity: number) => plotOf(motion, sensitivity, live.current),
    [],
  )

  /**
   * Keep telling the shell a sensor exists, for as long as free run is on.
   *
   * `MotionInstrument` sends nothing until `motion.live` is true, and that guard
   * is right: without it every page would play on load from a resting pose and
   * never stop on a machine with nothing to tilt. But free run is the user
   * saying *play now, I am holding this still*, and on a desktop no orientation
   * event ever arrives — so without this the mode would silently do nothing on
   * the machine most likely to be used to try it.
   *
   * An interval rather than one event on mount, because the shell only starts
   * listening once it has booted and this component cannot see when that
   * happened. Repeating is self-healing and costs nothing.
   *
   * It overwrites the real orientation on a phone, which is harmless: in free
   * run nothing reads orientation. The interval stops when free run does.
   *
   * Page-local on purpose. The guard is correct and nineteen other pages depend
   * on it, so the page that wants an exception is the page that should carry it.
   */
  useEffect(() => {
    if (!controls.freeRun) return
    const wake = () => {
      try {
        if (typeof DeviceOrientationEvent !== 'function') return
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 0, gamma: 0 }),
        )
      } catch {
        // Nothing to do. Free run works as soon as the device reports once.
      }
    }
    wake()
    const timer = setInterval(wake, 1000)
    return () => clearInterval(timer)
  }, [controls.freeRun])

  return (
    <MotionInstrument
      title="thrum"
      blurb={
        <>
          One haptic pulse: a <strong>transient</strong> you hear and a{' '}
          <strong>decaying tone</strong> you feel, near 250Hz where skin is most sensitive and a
          phone speaker has stopped radiating and started shaking. It is already running — every
          parameter below has a default from the literature and a range around it, because the one
          thing the research cannot tell you is what <em>your</em> hand on <em>your</em> phone can
          feel. Hold it loose in a palm, volume up, nothing between it and your skin.
        </>
      }
      instrument={INSTRUMENT}
      map={map}
      silenceBelow={SILENCE_BELOW}
      plot={plot}
      plotLabels={PLOT_LABELS}
      plotMin={0}
      plotMax={1}
      controls={<Panel controls={controls} set={set} />}
    />
  )
}

interface PanelProps {
  controls: Controls
  set: <K extends keyof Controls>(key: K, value: Controls[K]) => void
}

/**
 * The nine parameters, grouped by what they decide.
 *
 * Ordered so the two that most often explain "I cannot feel anything" come
 * first: how long the pulse lasts, and how hard it is driven.
 */
function Panel({ controls, set }: PanelProps) {
  const slider = (
    name: string,
    key: keyof typeof RANGES,
    step: number,
    format: (value: number) => string,
    hint?: string,
  ) => (
    <Slider
      name={name}
      testId={key}
      value={controls[key]}
      range={RANGES[key]}
      step={step}
      format={format}
      {...(hint ? { hint } : {})}
      onChange={(next) => set(key, next)}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="ak-panel flex flex-col gap-3 rounded border p-3">
        <Toggle
          label="free run"
          hint="sound at these settings with the phone still. Off: shake drives intensity, turning drives rate"
          on={controls.freeRun}
          onChange={(next) => set('freeRun', next)}
        />
      </div>

      <Fieldset
        name="the envelope"
        note="The shape of one pulse, and the half that was baked in before."
      >
        {slider(
          'decay',
          'decay',
          0.001,
          (v) => `${(v * 1000).toFixed(0)}ms ${decayReads(v)}`,
          'how long the tone rings. Under ~25ms reads as a crisp tap and is near the least detectable thing available, because the Pacinian channel summates energy over about a second',
        )}
        {slider(
          'attack',
          'attack',
          0.0001,
          (v) => `${(v * 1000).toFixed(2)}ms`,
          'the onset. 0.1ms is a click; wind it up and the pulse swells in instead',
        )}
        {slider(
          'curve',
          'curve',
          0.1,
          (v) => `${v.toFixed(1)} ${curveReads(v)}`,
          'negative decays like a struck object, 0 is linear, positive holds then drops',
        )}
        {slider(
          'overdrive',
          'overdrive',
          0.1,
          (v) => `x${v.toFixed(1)}`,
          "a boost on the first 4ms only. Haptic driver ICs do this to overcome an actuator's inertia — a diaphragm has the same problem",
        )}
      </Fieldset>

      <Fieldset name="the two halves" note="A transient you hear, a tone you feel.">
        {slider(
          'transient',
          'transient',
          0.01,
          (v) => (v === 0 ? 'off' : v.toFixed(2)),
          'level of the impulse half. Off to feel the tone alone',
        )}
        {slider(
          'sharpness',
          'sharpness',
          0.01,
          (v) => v.toFixed(2),
          "Core Haptics calls this clickiness. It is the band the transient sits in, 400Hz to 6kHz",
        )}
      </Fieldset>

      <Fieldset name="the carrier" note="Frequency, rate and how hard it is driven.">
        {slider(
          'carrier',
          'carrier',
          1,
          (v) => `${v.toFixed(0)}Hz`,
          '250Hz is the most felt frequency on average, and an average is not a hand',
        )}
        {slider(
          'rate',
          'rate',
          0.1,
          (v) => `${v.toFixed(1)}Hz ${regimeOf(v)}`,
          'retriggers per second. Under ~6Hz they stay countable; 16-32Hz is a flutter; past ~80Hz they fuse',
        )}
        {slider(
          'intensity',
          'intensity',
          0.01,
          (v) => `${v.toFixed(2)} -> amp ${amplitudeOf(v).toFixed(2)}`,
          'corrected for perception: magnitude grows as amplitude^0.6 at 250Hz, so the slider is straight and the amplitude is not',
        )}
      </Fieldset>
    </div>
  )
}

interface FieldsetProps {
  name: string
  note: string
  children: ReactNode
}

function Fieldset({ name, note, children }: FieldsetProps) {
  return (
    <div className="ak-panel flex flex-col gap-3 rounded border p-3">
      <div>
        <div className="ak-accent font-mono text-xs">{name}</div>
        <div className="ak-label font-mono text-[11px]">{note}</div>
      </div>
      {children}
    </div>
  )
}

interface SliderProps {
  name: string
  testId?: string
  value: number
  range: { readonly min: number; readonly max: number }
  step: number
  format: (value: number) => string
  hint?: string
  onChange: (value: number) => void
}

function Slider({ name, testId, value, range, step, format, hint, onChange }: SliderProps) {
  return (
    <label className="flex flex-wrap items-center gap-x-3">
      <span className="ak-label font-mono text-xs sm:w-28">{name}</span>
      <input
        type="range"
        data-testid={`ctl-${testId ?? name}`}
        min={range.min}
        max={range.max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="ss-range order-3 basis-full sm:order-2 sm:min-w-0 sm:basis-auto sm:grow"
        aria-label={testId ?? name}
      />
      <span className="ak-accent ml-auto min-w-28 py-2 text-right font-mono text-xs sm:ml-0 sm:py-0">
        {format(value)}
      </span>
      {hint ? <span className="ak-label order-4 basis-full font-mono text-[11px]">{hint}</span> : null}
    </label>
  )
}

interface ToggleProps {
  label: string
  hint?: string
  on: boolean
  onChange: (on: boolean) => void
}

function Toggle({ label, hint, on, onChange }: ToggleProps) {
  return (
    <label className="flex flex-wrap items-center gap-x-3">
      {/* A checkbox rather than a styled div: focusable, reachable by a screen
          reader, and already 44px through ui.css's touch sizing. */}
      <input
        type="checkbox"
        data-testid={`ctl-${label.replace(/\s+/g, '-')}`}
        checked={on}
        onChange={(event) => onChange(event.target.checked)}
        className="h-11 w-11 shrink-0 accent-[var(--ak-accent)] sm:h-6 sm:w-6"
        aria-label={label}
      />
      <span className={`font-mono text-xs ${on ? 'ak-accent' : 'ak-label'}`}>{label}</span>
      {hint ? <span className="ak-label basis-full font-mono text-[11px]">{hint}</span> : null}
    </label>
  )
}
