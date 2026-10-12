import { useCallback, useEffect, useRef, useState } from 'react'
import { GridConductor, stepAt, wallClockMs } from '@ss/engine'
import { useSampleSet, useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader, SourceFooter } from '@ss/ui'
import {
  BAR_MS,
  KICK,
  HAT,
  LIBRARY,
  SNARE,
  STEPS_PER_BAR,
  STEP_MS,
  barOf,
  beatOf,
  eventsForStep,
  stepInBar,
  type Drums,
} from './rhythm.ts'

/**
 * A rhythm every device plays in step, with nothing exchanged between them.
 *
 * The grid is `floor(wallClock / 125ms)` anchored at the Unix epoch, so the same
 * instant is the same step index everywhere. See `GridConductor` for the
 * mechanism and `rhythm.ts` for why the pattern is as plain as it is.
 */
export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const { samples, progress, error } = useSampleSet([...LIBRARY])

  const booted = status.phase === 'ready' || status.phase === 'degraded'

  const conductor = useRef<GridConductor | null>(null)
  const [readout, setReadout] = useState(() => ({ step: 0, spawned: 0, skipped: 0 }))

  /** Coarse, and honest about it — see `useServerSkew`. */
  const skew = useServerSkew()

  /**
   * The buffers, by role.
   *
   * `useSampleSet` returns them in the order requested, but matched by name
   * rather than by index: a set that silently reordered would swap the kick and
   * the hat, which sounds like a different pattern rather than like a bug.
   */
  const drums: Drums | null = samples
    ? {
        kick: samples.find((s) => s.name === KICK)?.bufnum ?? 0,
        snare: samples.find((s) => s.name === SNARE)?.bufnum ?? 0,
        hat: samples.find((s) => s.name === HAT)?.bufnum ?? 0,
      }
    : null

  // Read by the scheduler, which runs off a timer and must not wait for a
  // render to see the buffers arrive.
  const live = useRef<Drums | null>(null)
  live.current = drums

  useEffect(() => {
    const engine = session()
    if (!booted || !engine || !drums || conductor.current) return

    const grid = new GridConductor({
      session: engine,
      stepMs: STEP_MS,
      eventsFor: (step) => eventsForStep(step, live.current),
    })
    grid.start()
    conductor.current = grid

    return () => {
      grid.dispose()
      conductor.current = null
    }
    // `drums` is an object literal, so it is a new reference every render.
    // Depending on it would tear the scheduler down and rebuild it on each one;
    // what matters is only whether the buffers have arrived at all.
  }, [booted, session, drums !== null])

  // The readout, at 20Hz. Deliberately not the audio path: nothing here is
  // allowed to affect what sounds, so a slow render can misreport the step
  // count but can never move a drum hit.
  useEffect(() => {
    if (!booted) return
    const tick = () => {
      const grid = conductor.current
      setReadout({
        step: stepAt(wallClockMs(), STEP_MS),
        spawned: grid?.spawned ?? 0,
        skipped: grid?.skipped ?? 0,
      })
    }
    tick()
    const timer = setInterval(tick, 50)
    return () => clearInterval(timer)
  }, [booted])

  const start = useCallback(() => boot(), [boot])

  const inBar = stepInBar(readout.step)
  const beat = beatOf(readout.step)
  const phaseMs = wallClockMs() % BAR_MS

  return (
    <main className="ak flex min-h-dvh flex-col">
      <PageHeader title="sync" />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        <p className="ak-label text-sm">
          The same rhythm on every device, from the clock alone &mdash; no master, no server, nothing
          exchanged. Each one plays step{' '}
          <code className="ak-accent">floor(time / 125ms)</code> of a grid anchored at the Unix
          epoch, so agreeing about the time is the whole of agreeing about the beat. Open it on two
          phones at once; if they drift, the numbers below say which of the three reasons it is.
        </p>

        <BootGate
          phase={status.phase}
          error={status.error}
          degradedReason={status.degradedReason}
          sabUnavailable={probe.sabUnavailable}
          onBoot={start}
        />

        {booted && !drums ? (
          <p
            data-testid="loading"
            className={
              error
                ? 'rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300'
                : 'ss-waiting ak-panel rounded border p-3 text-sm'
            }
          >
            {error
              ? `Could not load ${error}`
              : `Loading three drums — ${progress.done} of ${progress.total}.`}
          </p>
        ) : null}

        {booted && drums ? (
          <>
            {/* The fastest read there is: two phones side by side, flashing
                together. It works from across a room, where two step counters
                do not. */}
            <div className="flex gap-2" data-testid="beats">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  data-testid={`beat-${n}`}
                  data-lit={beat === n ? 'yes' : 'no'}
                  className={`h-16 flex-1 rounded border font-mono text-xs leading-[4rem] text-center ${
                    beat === n ? 'ak-live' : 'ak-panel ak-label'
                  }`}
                >
                  {n}
                </div>
              ))}
            </div>

            <dl className="ak-label grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">
              {/* The number to compare across devices. Same step at the same
                  moment means the grids agree and anything audible is latency. */}
              <Row name="step" value={String(readout.step)} />
              <Row name="bar" value={String(barOf(readout.step))} />
              <Row name="in bar" value={`${inBar} of ${STEPS_PER_BAR}`} />
              <Row name="bar phase" value={`${phaseMs.toFixed(0)}ms`} />
              <Row name="hits sent" value={String(readout.spawned)} />
              {/* Not a clock problem. A main thread that stalled drops steps,
                  which sounds exactly like being out of time and is not. */}
              <Row name="skipped" value={String(readout.skipped)} />
              <Row name="clock anchor" value={`${Math.round(performance.timeOrigin)}`} />
              <Row name="server Δ" value={skew} />
            </dl>

            <p className="ak-label font-mono text-[11px]">
              If two devices show the <strong className="ak-accent">same step</strong> but sound
              apart, the clocks agree and the difference is output latency &mdash; read the footer.
              A rising <strong className="ak-accent">skipped</strong> is a stalled main thread, not a
              clock. A <strong className="ak-accent">server Δ</strong> past a second means that
              device's clock is simply wrong.
            </p>
          </>
        ) : null}

        <div className="mt-auto" />
      </div>

      {booted ? <EngineFooter /> : null}

      {/* Outside the boot gate: the AGPL source link is a licence obligation and
          an unbooted page is still a conveyed copy of the bundled client. */}
      <SourceFooter />
    </main>
  )
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-[var(--ak-line)] py-0.5">
      <dt>{name}</dt>
      <dd className="ak-accent" data-testid={`value-${name}`}>
        {value}
      </dd>
    </div>
  )
}

/**
 * How far this device's clock is from the server's, to the nearest second.
 *
 * Coarse on purpose, because coarse is all that is available. An HTTP `Date`
 * header has one-second resolution and this site is static files behind Caddy —
 * there is no endpoint to run an NTP handshake against, and inventing one would
 * mean server-side code in a project whose whole shape is "serve bytes".
 *
 * So this catches the failure that actually happens and ruins everything — a
 * device whose clock is wrong by seconds or minutes, which no amount of audio
 * scheduling can rescue — and says nothing about the tens of milliseconds that
 * separate two well-synced phones. Labelled `±1s` so it cannot be mistaken for
 * a measurement of the thing being tested.
 *
 * The round trip is halved out of the comparison, which is the one correction
 * worth making: without it a slow connection reads as a wrong clock.
 */
function useServerSkew(): string {
  const [skew, setSkew] = useState('…')

  useEffect(() => {
    let cancelled = false

    const probe = async () => {
      try {
        const sent = wallClockMs()
        const response = await fetch(`${location.pathname}?t=${Date.now()}`, { cache: 'no-store' })
        const received = wallClockMs()

        const header = response.headers.get('date')
        if (!header) {
          if (!cancelled) setSkew('no Date header')
          return
        }

        // Compare the server's second against the local instant halfway through
        // the round trip, which is the best estimate of when the server read its
        // own clock.
        const midpoint = sent + (received - sent) / 2
        const delta = midpoint - Date.parse(header)

        if (cancelled) return
        setSkew(`${delta >= 0 ? '+' : ''}${(delta / 1000).toFixed(1)}s ±1s`)
      } catch {
        if (!cancelled) setSkew('unreachable')
      }
    }

    void probe()
    // Once a minute. It is a sanity check, not a servo — nothing here steers the
    // grid from it, because a correction applied to a playing rhythm is a jump.
    const timer = setInterval(() => void probe(), 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return skew
}
