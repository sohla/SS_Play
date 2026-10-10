import { useCallback, useRef, useState } from 'react'
import { MotionInstrument } from '@ss/ui'
import type { Motion } from '@ss/motion'
import {
  DEFAULT_CONTROLS,
  PLOT_LABELS,
  RANGES,
  SILENCE_BELOW,
  type Controls,
  mapThrum,
  plotOf,
  pulseReads,
} from './mapping.ts'

/**
 * Three layers, two synths, and the split is not arbitrary.
 *
 * Layer one is a `conductor`: a demand sequence in the server reporting each tap
 * with `SendReply`, and a node spawned per report. Right for this layer and only
 * this layer, because at under 6Hz the events are individually felt — so what
 * the Demand graph buys is that a stalled main thread cannot smear them.
 *
 * Layers two and three are one `held` voice, and could not be conductors. Their
 * rates run to 90Hz, where the OSC round trip is the same order as the interval
 * between events: the rate the hand asked for and the rate the skin received
 * would be different numbers. They are a pulse train and a tone inside the
 * graph instead, with their accents on a demand sequence the train pulls itself
 * — a pattern in the server with no OSC traffic at all.
 *
 * They are one SynthDef rather than two because excursion is shared and so their
 * limiter has to be; see the note in `ssp_thrum_bed`.
 */
const INSTRUMENT = [
  {
    kind: 'conductor' as const,
    clock: 'ssp_thrum_clock',
    voice: 'ssp_thrum_tap',
    address: '/ssp_thrum',
    controls: ([freq, hard]: readonly number[]) => ({ freq: freq ?? 250, hard: hard ?? 0.6 }),
    // No `sustainS`. A tap is a fixed-length percussive envelope with
    // doneAction 2 — it frees itself, and there is nothing to hold. The gate
    // exists so the def is releasable like every other one here, not because
    // this page uses it.
  },
  { kind: 'held' as const, def: 'ssp_thrum_bed', initial: { flutAmp: 0, carAmp: 0 } },
]

export function App() {
  /**
   * Both, and for the reason `sensitivity` inside `MotionInstrument` is both.
   *
   * The state drives the sliders. The ref is what `map` reads, because `map` is
   * in the sending effect's dependency list — a callback that changed identity
   * on every slider frame would tear down and re-arm the 30Hz loop mid-drag.
   * So `map` closes over the ref and never changes.
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

  return (
    <MotionInstrument
      title="thrum"
      blurb={
        <>
          Sound aimed at the hand rather than the ear. Everything here sits near{' '}
          <strong>250Hz</strong>, where skin is most sensitive and a phone speaker has stopped
          radiating and started shaking. <strong>Shake</strong> for separate taps,{' '}
          <strong>turn</strong> to run the pulse rate up until they fuse into one buzz, and{' '}
          <strong>tilt</strong> to set the carrier underneath. Best felt with the phone loose in a
          palm, volume up, and nothing between it and your skin.
        </>
      }
      instrument={INSTRUMENT}
      map={map}
      silenceBelow={SILENCE_BELOW}
      plot={plot}
      plotLabels={PLOT_LABELS}
      // The three drives are 0..1, not bipolar. Left at -1..1 the traces would
      // all sit in the top half of the plot and waste half of it.
      plotMin={0}
      plotMax={1}
      controls={<Panel controls={controls} set={set} />}
    />
  )
}

/**
 * Tell the shell a sensor exists, so free run can actually sound.
 *
 * `MotionInstrument` sends nothing until `motion.live` is true, and that guard is
 * right: without it every page would play on load from a resting pose and never
 * stop on a machine with nothing to tilt. But it means free run — which is the
 * user saying *play now, I am holding this still* — would achieve nothing on a
 * desktop, where no orientation event ever arrives. On a phone they arrive
 * continuously and this is a no-op.
 *
 * One synthetic event, dispatched only on the way into free run. Deliberately
 * page-local rather than a change to the shared guard: the guard is correct and
 * nineteen other pages depend on it, so the page that wants an exception should
 * be the one carrying it.
 *
 * Wrapped because the constructor is not guaranteed everywhere, and a page that
 * throws here would lose its whole control panel over a convenience.
 */
function wakeTheShell() {
  try {
    if (typeof DeviceOrientationEvent !== 'function') return
    window.dispatchEvent(
      new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 0, gamma: 0 }),
    )
  } catch {
    // Nothing to do. Free run will work as soon as the device reports once.
  }
}

interface PanelProps {
  controls: Controls
  set: <K extends keyof Controls>(key: K, value: Controls[K]) => void
}

/**
 * What a hand needs that reading could not supply.
 *
 * Every other number on this page comes from published psychophysics. These do
 * not, because they depend on one speaker in one palm — and the first report
 * back was that the taps were too short to feel, which is a thing no amount of
 * reading would have produced.
 */
function Panel({ controls, set }: PanelProps) {
  return (
    <div className="ak-panel flex flex-col gap-3 rounded border p-3">
      <p className="ak-label font-mono text-[11px]">
        What only a hand can settle. <strong className="ak-accent">free run</strong> first — a
        vibration is hard to judge while shaking the thing that makes it.
      </p>

      <Toggle
        label="free run"
        hint="sound at these settings with the phone held still"
        on={controls.freeRun}
        onChange={(next) => {
          set('freeRun', next)
          if (next) wakeTheShell()
        }}
      />

      <Slider
        name="pulse"
        value={controls.pulse}
        range={RANGES.pulse}
        step={0.001}
        format={(v) => `${(v * 1000).toFixed(0)}ms ${pulseReads(v)}`}
        hint="under ~25ms is a crisp tap and hard to feel; over it is easy to feel and not an event"
        onChange={(next) => set('pulse', next)}
      />

      <Slider
        name="drive"
        value={controls.drive}
        range={RANGES.drive}
        step={0.01}
        format={(v) => v.toFixed(2)}
        hint="level into both limiters — the other reason nothing arrives"
        onChange={(next) => set('drive', next)}
      />

      <Slider
        name="carrier"
        value={controls.carrier}
        range={RANGES.carrier}
        step={1}
        format={(v) => `${v.toFixed(0)}Hz`}
        hint="250Hz is the most-felt frequency on average; your hand and your phone are not average. Roll still offsets it ±35Hz"
        onChange={(next) => set('carrier', next)}
      />

      <Slider
        name="taps"
        value={controls.tapRate}
        range={RANGES.tapRate}
        step={0.1}
        format={(v) => `${v.toFixed(1)}/s`}
        disabled={!controls.freeRun}
        hint="free run only — otherwise shake sets it"
        onChange={(next) => set('tapRate', next)}
      />

      <Slider
        name="flutter"
        value={controls.flutter}
        range={RANGES.flutter}
        step={0.5}
        format={(v) => `${v.toFixed(1)}Hz`}
        disabled={!controls.freeRun}
        hint="free run only — otherwise turning sets it. 16-32Hz is the flutter band"
        onChange={(next) => set('flutter', next)}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="ak-label font-mono text-xs sm:w-28">solo by muting</span>
        <Toggle
          label="taps"
          testId="mute-taps"
          on={!controls.muteTaps}
          onChange={(next) => set('muteTaps', !next)}
          compact
        />
        <Toggle
          label="flutter"
          testId="mute-flutter"
          on={!controls.muteFlutter}
          onChange={(next) => set('muteFlutter', !next)}
          compact
        />
        <Toggle
          label="carrier"
          testId="mute-carrier"
          on={!controls.muteCarrier}
          onChange={(next) => set('muteCarrier', !next)}
          compact
        />
      </div>
    </div>
  )
}

interface SliderProps {
  name: string
  value: number
  range: { min: number; max: number }
  step: number
  format: (value: number) => string
  hint?: string
  disabled?: boolean
  onChange: (value: number) => void
}

function Slider({
  name,
  value,
  range,
  step,
  format,
  hint,
  disabled = false,
  onChange,
}: SliderProps) {
  return (
    <label className={`flex flex-wrap items-center gap-x-3 ${disabled ? 'opacity-40' : ''}`}>
      <span className="ak-label font-mono text-xs sm:w-28">{name}</span>
      <input
        type="range"
        data-testid={`ctl-${name}`}
        min={range.min}
        max={range.max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="ss-range order-3 basis-full sm:order-2 sm:min-w-0 sm:basis-auto sm:grow"
        aria-label={name}
      />
      <span className="ak-accent ml-auto min-w-24 py-2 text-right font-mono text-xs sm:ml-0 sm:py-0">
        {format(value)}
      </span>
      {hint ? (
        <span className="ak-label order-4 basis-full font-mono text-[11px]">{hint}</span>
      ) : null}
    </label>
  )
}

interface ToggleProps {
  label: string
  /**
   * Overrides the label-derived test id.
   *
   * Needed because three of the mutes are named after a layer that also has a
   * slider — `taps` and `flutter` both exist twice on this panel, and a shared
   * id made the e2e locator ambiguous rather than wrong, which is the harder
   * version to notice.
   */
  testId?: string
  hint?: string
  on: boolean
  compact?: boolean
  onChange: (on: boolean) => void
}

function Toggle({ label, testId, hint, on, compact = false, onChange }: ToggleProps) {
  return (
    <label className="flex flex-wrap items-center gap-x-3">
      {/* A checkbox rather than a styled div: it is focusable, it is reachable
          by a screen reader, and it is already 44px through ui.css's touch
          sizing. A pretty toggle that cannot be tabbed to is a regression. */}
      <input
        type="checkbox"
        data-testid={`ctl-${testId ?? label.replace(/\s+/g, '-')}`}
        checked={on}
        onChange={(event) => onChange(event.target.checked)}
        className="h-11 w-11 shrink-0 accent-[var(--ak-accent)] sm:h-6 sm:w-6"
        aria-label={label}
      />
      <span className={`font-mono text-xs ${on ? 'ak-accent' : 'ak-label'}`}>{label}</span>
      {hint && !compact ? (
        <span className="ak-label basis-full font-mono text-[11px]">{hint}</span>
      ) : null}
    </label>
  )
}
