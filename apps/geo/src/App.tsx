import { useCallback, useEffect, useRef, useState } from 'react'
import { HeldVoice } from '@ss/engine'
import { useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader, SourceFooter } from '@ss/ui'
import {
  ARRIVED_M,
  GOOD_FIX_M,
  Track,
  distance,
  fromLocal,
  levelDb,
  nearness,
  pickTarget,
  toLocal,
  type LatLon,
  type Local,
} from './geo.ts'

/**
 * A place near you, found by ear.
 *
 * The phone's position is tracked from the Geolocation API, a spot 5–20m away
 * is chosen once the fix is good enough to mean anything, and a drone grows
 * louder and brighter as the distance closes. The screen says how far, not
 * which way: the sound is the guide.
 */

/**
 * What the browser is asked for.
 *
 * `enableHighAccuracy` is what turns on the GNSS receiver rather than settling
 * for Wi-Fi and cell towers, which are tens of metres out — larger than the
 * whole game. `maximumAge: 0` refuses a cached fix from before the walk began.
 */
const WATCH: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 }

type Phase = 'off' | 'asking' | 'locating' | 'seeking' | 'arrived' | 'denied' | 'unavailable'

interface Reading {
  /** The latest fix's own 95% radius, as the browser reported it. */
  accuracy: number
  /** The tracker's 95% radius, after filtering. */
  held: number
  fixes: number
  you: Local
  target: Local | null
  /** The same spot as a coordinate, for the e2e spec to walk to. */
  goal: LatLon | null
  metres: number | null
  start: number | null
}

/** Two voices, a slightly flat fifth apart, so they beat slowly against each other. */
const VOICES = [
  { freq: 110, pan: -0.3 },
  { freq: 110 * 1.4973, pan: 0.3 },
]
/** Each voice's share of the level, so the pair together peak where one would. */
const SHARE = 0.6

/** The filter opens as you close in: dark and distant at the start, warm and present on arrival. */
const DARKEST_HZ = 320
const BRIGHTEST_HZ = 1500

/**
 * How the level follows the distance, in seconds.
 *
 * A fix arrives about once a second and each one moves the target level in a
 * step. Gliding over a little longer than that turns the steps into a swell.
 */
const GLIDE_S = 1.5
const TICK_MS = 50
const SILENT_DB = -90

const dbamp = (db: number) => 10 ** (db / 20)

export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const booted = status.phase === 'ready' || status.phase === 'degraded'

  const [phase, setPhase] = useState<Phase>('off')
  const [problem, setProblem] = useState('')
  const [reading, setReading] = useState<Reading | null>(null)

  const watch = useRef<number | null>(null)
  const origin = useRef<LatLon | null>(null)
  const track = useRef(new Track())
  const target = useRef<Local | null>(null)
  const start = useRef<number | null>(null)
  const arrived = useRef(false)

  const choose = useCallback(() => {
    const here = track.current.position
    if (!here) return
    const offset = pickTarget()
    target.current = { east: here.east + offset.east, north: here.north + offset.north }
    start.current = Math.hypot(offset.east, offset.north)
    arrived.current = false
    setPhase('seeking')
  }, [])

  const onFix = useCallback(
    (position: GeolocationPosition) => {
      const fix = { lat: position.coords.latitude, lon: position.coords.longitude }
      const home = (origin.current ??= fix)
      const accuracy = position.coords.accuracy
      const you = track.current.update(toLocal(home, fix), accuracy, position.timestamp)

      if (!target.current && accuracy <= GOOD_FIX_M) choose()

      const metres = target.current ? distance(you, target.current) : null
      if (metres !== null && !arrived.current && metres <= ARRIVED_M) {
        arrived.current = true
        setPhase('arrived')
      }
      setPhase((was) => (was === 'asking' ? 'locating' : was))
      setProblem('')
      setReading((last) => ({
        accuracy,
        held: track.current.sigma * 2.45,
        fixes: (last?.fixes ?? 0) + 1,
        you,
        target: target.current,
        goal: target.current ? fromLocal(home, target.current) : null,
        metres,
        start: start.current,
      }))
    },
    [choose],
  )

  /**
   * One tap does both. The AudioContext needs a gesture, and Safari only shows
   * the location prompt for one, so the watch starts here rather than after boot.
   */
  const begin = useCallback(() => {
    if (!navigator.geolocation || !window.isSecureContext) {
      setPhase('unavailable')
    } else {
      setPhase('asking')
      watch.current = navigator.geolocation.watchPosition(
        onFix,
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            setPhase('denied')
            return
          }
          // A slow or lost fix is not the end — under trees, between
          // buildings — and the watch carries on by itself. Say so and wait.
          setPhase((was) => (was === 'asking' ? 'locating' : was))
          setProblem(
            error.code === error.TIMEOUT
              ? 'No fix for 30 seconds. Still trying.'
              : `No position right now${error.message ? ` (${error.message})` : ''}. Still trying.`,
          )
        },
        WATCH,
      )
    }
    boot()
  }, [boot, onFix])

  useEffect(
    () => () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current)
    },
    [],
  )

  // A locked screen suspends the page, and with it the sound and the fixes.
  // Walking with a phone is exactly when screens lock.
  const started = phase !== 'off'
  useEffect(() => {
    if (!started || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    const hold = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock.request('screen').then(
        (granted) => (lock = granted),
        () => {},
      )
    }
    hold()
    document.addEventListener('visibilitychange', hold)
    return () => {
      document.removeEventListener('visibilitychange', hold)
      void lock?.release()
    }
  }, [started])

  // The drone. The distance changes once a second, so this reads it from refs
  // on its own clock and glides, rather than re-rendering anything per tick.
  useEffect(() => {
    const engine = session()
    if (!booted || !engine) return

    const voices = VOICES.map(
      ({ freq, pan }) =>
        new HeldVoice({
          session: engine,
          def: 'ssp_mb_drone',
          initial: { amp: 0, freq, pan, ffreq: DARKEST_HZ, attack: 3, release: 2, lag: 0.5 },
        }),
    )

    let db = SILENT_DB
    let near = 0
    let sentDb = NaN
    let sentNear = NaN
    const step = 1 - Math.exp(-TICK_MS / 1000 / GLIDE_S)
    const timer = setInterval(() => {
      const you = track.current.position
      const there = target.current
      const from = start.current
      const metres = you && there ? distance(you, there) : null
      const goalDb = metres !== null && from !== null ? levelDb(metres, from) : SILENT_DB
      const goalNear = metres !== null && from !== null ? nearness(metres, from) : 0
      db += (goalDb - db) * step
      near += (goalNear - near) * step
      if (Math.abs(db - sentDb) < 0.05 && Math.abs(near - sentNear) < 0.002) return
      sentDb = db
      sentNear = near
      const ffreq = DARKEST_HZ * (BRIGHTEST_HZ / DARKEST_HZ) ** near
      for (const voice of voices) voice.set({ amp: dbamp(db) * SHARE, ffreq })
    }, TICK_MS)

    return () => {
      clearInterval(timer)
      for (const voice of voices) voice.dispose()
    }
  }, [booted, session])

  const live = phase === 'locating' || phase === 'seeking' || phase === 'arrived'

  return (
    <main className="ak flex min-h-dvh flex-col">
      <PageHeader title="geo" />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        <p className="ak-label text-sm">
          A spot 5&ndash;20 metres from you, chosen at random. A drone grows louder and warmer as
          you close in. Go outside: indoors the phone can&rsquo;t tell where it is to better than
          tens of metres. Starting asks the browser for your location.
        </p>

        <BootGate
          phase={status.phase}
          error={status.error}
          degradedReason={status.degradedReason}
          sabUnavailable={probe.sabUnavailable}
          onBoot={begin}
        />

        {phase === 'asking' ? (
          <p className="ss-waiting ak-panel rounded border p-3 text-sm" data-testid="geo-status">
            Waiting for the browser&rsquo;s location prompt.
          </p>
        ) : null}

        {phase === 'denied' ? (
          <p
            className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300"
            data-testid="geo-status"
          >
            Location access was refused. Allow it for this site in the browser&rsquo;s settings,
            then reload. On iPhone, Precise Location must be on as well.
          </p>
        ) : null}

        {phase === 'unavailable' ? (
          <p
            className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300"
            data-testid="geo-status"
          >
            This browser offers no location here. It needs HTTPS and a recent browser.
          </p>
        ) : null}

        {live ? <Readout reading={reading} phase={phase} problem={problem} onPick={choose} /> : null}

        <div className="mt-auto" />
      </div>

      {booted ? <EngineFooter /> : null}
      <SourceFooter />
    </main>
  )
}

function Readout({
  reading,
  phase,
  problem,
  onPick,
}: {
  reading: Reading | null
  phase: Phase
  problem: string
  onPick: () => void
}) {
  const metres = reading?.metres ?? null
  return (
    <div className="flex flex-col gap-4" data-testid="geo-status" data-phase={phase}>
      <div className="ak-panel flex items-baseline justify-between rounded border p-4">
        <span className="ak-label text-sm">
          {phase === 'locating' ? 'finding you' : phase === 'arrived' ? 'found it' : 'to go'}
        </span>
        <span className="ak-accent font-mono text-4xl" data-testid="geo-distance">
          {metres === null ? '—' : `${metres.toFixed(1)} m`}
        </span>
      </div>

      {reading ? <Radar reading={reading} /> : null}

      <dl className="ak-label grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">
        <dt>fix accuracy</dt>
        <dd className="text-right" data-testid="geo-accuracy">
          {reading ? `±${reading.accuracy.toFixed(1)} m` : 'waiting'}
        </dd>
        <dt>after smoothing</dt>
        <dd className="text-right">{reading ? `±${reading.held.toFixed(1)} m` : '—'}</dd>
        <dt>fixes</dt>
        <dd className="text-right">{reading?.fixes ?? 0}</dd>
      </dl>

      {problem ? (
        <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          {problem}
        </p>
      ) : null}

      {phase === 'locating' ? (
        <p className="ss-waiting ak-panel rounded border p-3 text-sm">
          Waiting for a fix within ±{GOOD_FIX_M} m before choosing a spot. Open sky helps; so does
          standing still for a few seconds.
        </p>
      ) : null}

      <button
        type="button"
        className="ak-panel rounded border p-3 text-sm disabled:opacity-40"
        disabled={!reading}
        onClick={onPick}
      >
        {phase === 'locating' ? 'Choose a spot anyway' : 'Choose a new spot'}
      </button>
    </div>
  )
}

/**
 * Where you are, where the spot is, and how sure the phone is — north up.
 *
 * North up, not heading up: the page doesn't know which way the phone faces,
 * and the point is to listen rather than read a map. This is for seeing what
 * the fixes are doing.
 */
function Radar({ reading }: { reading: Reading }) {
  const { you, target, goal, held } = reading
  const reach = Math.max(10, reading.start ?? 0, reading.metres ?? 0, held) * 1.15
  const scale = 46 / reach
  const at = (point: Local) => ({
    x: (point.east - you.east) * scale,
    y: -(point.north - you.north) * scale,
  })
  const spot = target ? at(target) : null
  return (
    <svg
      viewBox="-50 -50 100 100"
      className="ak-panel mx-auto aspect-square w-2/3 rounded border"
      data-testid="geo-radar"
      data-target-lat={goal?.lat}
      data-target-lon={goal?.lon}
    >
      <circle r={46} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.4} />
      <text y={-41} textAnchor="middle" fontSize={5} fill="currentColor" fillOpacity={0.5}>
        N
      </text>
      <circle r={held * scale} fill="var(--ak-accent)" fillOpacity={0.12} />
      {spot ? (
        <>
          <circle
            cx={spot.x}
            cy={spot.y}
            r={ARRIVED_M * scale}
            fill="none"
            stroke="var(--ak-accent)"
            strokeWidth={0.6}
          />
          <circle cx={spot.x} cy={spot.y} r={1.2} fill="var(--ak-accent)" />
        </>
      ) : null}
      <circle r={1.6} fill="currentColor" />
    </svg>
  )
}
