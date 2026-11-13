import { useCallback, useEffect, useRef, useState } from 'react'
import { HeldVoice } from '@ss/engine'
import { requestMotion, watchMotion, RESTING, type Motion } from '@ss/motion'
import { useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader, SourceFooter } from '@ss/ui'
import { smoothHeading, watchCompass, type CompassSource } from './compass.ts'
import {
  ARRIVED_M,
  bearing,
  closeness,
  distance,
  droneFrom,
  facing,
  pickTarget,
  toLocal,
  track,
  type LatLon,
  type Point,
  type Reading,
  type Track,
} from './geo.ts'

/**
 * Location and heading as inputs: a target 10–30m away, and a drone that
 * settles as you walk to it. The page's other job is to show every number the
 * phone offers, and how good each one is, so it is clear what can be composed
 * with. See `geo.ts` for the maths and its limits.
 */

/** A target is picked once a fix is this good, or after `PICK_AFTER_MS` with the best so far. */
const GOOD_FIX_M = 20
const PICK_AFTER_MS = 15_000

type Located = 'off' | 'asking' | 'live' | 'denied' | 'unavailable' | 'failed'

interface Fix {
  lat: number
  lon: number
  accuracy: number
  altitude: number | null
  altitudeAccuracy: number | null
  speed: number | null
  course: number | null
  at: number
}

interface Shown {
  fix: Fix | null
  fixes: number
  interval: number | null
  heading: number | null
  source: CompassSource | null
  motion: Motion
  reading: Reading | null
  estimate: number | null
}

const NOTHING: Shown = {
  fix: null,
  fixes: 0,
  interval: null,
  heading: null,
  source: null,
  motion: RESTING,
  reading: null,
  estimate: null,
}

export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const booted = status.phase === 'ready' || status.phase === 'degraded'

  const [located, setLocated] = useState<Located>('off')
  const [problem, setProblem] = useState('')
  const [motionAllowed, setMotionAllowed] = useState(true)

  // Sensor state, written by sensor callbacks and read by timers: refs only.
  const origin = useRef<LatLon | null>(null)
  const estimate = useRef<Track | null>(null)
  const target = useRef<{ at: Point; start: number } | null>(null)
  const firstFixAt = useRef<number | null>(null)
  const lastFix = useRef<Fix | null>(null)
  const fixes = useRef({ count: 0, interval: null as number | null })
  const heading = useRef<{ degrees: number | null; source: CompassSource | null }>({
    degrees: null,
    source: null,
  })
  const motion = useRef<Motion>(RESTING)
  const watch = useRef<number | null>(null)

  const [shown, setShown] = useState<Shown>(NOTHING)

  const choose = useCallback(() => {
    if (!estimate.current) return
    const at = pickTarget(estimate.current.at)
    target.current = { at, start: distance(estimate.current.at, at) }
  }, [])

  /**
   * One tap for everything. iOS grants orientation only from a gesture, the
   * AudioContext needs one, and the location prompt is clearer arriving with
   * the tap that asked for it than at page load.
   */
  const start = useCallback(() => {
    // Safari 16.4+: declare this a playback page. iOS otherwise treats Web
    // Audio as "ambient" — muted by the silent switch, and quiet — and once
    // any page has opened the mic it can be left routed to the earpiece. This
    // page never records, so playback is honest, and it means the loudspeaker.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session) session.type = 'playback'

    void requestMotion().then((permission) => setMotionAllowed(permission !== 'denied'))

    if (!navigator.geolocation) {
      setLocated('unavailable')
    } else {
      setLocated('asking')
      watch.current = navigator.geolocation.watchPosition(
        (position) => {
          const { coords, timestamp } = position
          setLocated('live')

          const here = { lat: coords.latitude, lon: coords.longitude }
          origin.current ??= here
          firstFixAt.current ??= timestamp
          estimate.current = track(
            estimate.current,
            toLocal(origin.current, here),
            coords.accuracy,
            timestamp,
          )

          if (lastFix.current) fixes.current.interval = timestamp - lastFix.current.at
          fixes.current.count += 1
          lastFix.current = {
            ...here,
            accuracy: coords.accuracy,
            altitude: coords.altitude,
            altitudeAccuracy: coords.altitudeAccuracy,
            speed: coords.speed,
            course: coords.heading,
            at: timestamp,
          }

          const waited = timestamp - firstFixAt.current
          if (!target.current && (coords.accuracy <= GOOD_FIX_M || waited >= PICK_AFTER_MS)) choose()
        },
        (error) => {
          setLocated(error.code === error.PERMISSION_DENIED ? 'denied' : 'failed')
          setProblem(error.message)
        },
        // High accuracy is GPS rather than wi-fi: slower to the first fix and
        // heavier on the battery, and the only kind worth having at 10–30m.
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      )
    }

    boot()
  }, [boot, choose])

  useEffect(
    () => () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current)
    },
    [],
  )

  useEffect(() => {
    if (!booted) return
    const stopCompass = watchCompass((degrees, source) => {
      heading.current = { degrees: smoothHeading(heading.current.degrees, degrees), source }
    })
    const stopMotion = motionAllowed ? watchMotion({ onMotion: (next) => (motion.current = next) }) : () => {}
    return () => {
      stopCompass()
      stopMotion()
    }
  }, [booted, motionAllowed])

  const readingNow = useCallback((): Reading | null => {
    if (!estimate.current || !target.current) return null
    return {
      distance: distance(estimate.current.at, target.current.at),
      start: target.current.start,
      bearing: bearing(estimate.current.at, target.current.at),
      heading: heading.current.degrees,
    }
  }, [])

  // The drone, held for the life of the page and steered ten times a second.
  // It starts before there is a target, in its far-away state, so there is
  // something to hear while the first fix comes in.
  useEffect(() => {
    const engine = session()
    if (!booted || !engine) return
    const drone = new HeldVoice({ session: engine, def: 'ssp_geo_drone', initial: { amp: 0.07 } })
    const steering = setInterval(() => {
      const reading = readingNow()
      if (reading) drone.set({ ...droneFrom(reading) })
    }, 100)
    return () => {
      clearInterval(steering)
      drone.dispose()
    }
  }, [booted, session, readingNow])

  // The readout, at 4Hz.
  useEffect(() => {
    if (!booted) return
    const timer = setInterval(() => {
      setShown({
        fix: lastFix.current,
        fixes: fixes.current.count,
        interval: fixes.current.interval,
        heading: heading.current.degrees,
        source: heading.current.source,
        motion: motion.current,
        reading: readingNow(),
        estimate: estimate.current ? Math.sqrt(estimate.current.variance) : null,
      })
    }, 250)
    return () => clearInterval(timer)
  }, [booted, readingNow])

  // The map, per frame: you in the middle, the target where it is. Up is the
  // way the phone points when there is a compass, north when there is not.
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!booted) return
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    let frame = 0

    const draw = () => {
      const size = element.clientWidth
      const dpr = Math.min(devicePixelRatio || 1, 2)
      if (element.width !== Math.round(size * dpr)) element.width = element.height = Math.round(size * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, size, size)

      const centre = size / 2
      const here = estimate.current
      const goal = target.current
      const span = Math.max(40, goal && here ? 1.3 * distance(here.at, goal.at) : 0)
      const scale = (size * 0.45) / span
      const up = heading.current.degrees ?? 0
      const rad = Math.PI / 180

      /** Screen position of a point `metres` away on `bearingDeg`. */
      const place = (metres: number, bearingDeg: number) => {
        const angle = (bearingDeg - up) * rad
        return [centre + Math.sin(angle) * metres * scale, centre - Math.cos(angle) * metres * scale] as const
      }

      // Rings every 10m, and north.
      context.strokeStyle = '#222'
      context.lineWidth = 1
      for (let r = 10; r <= span; r += 10) {
        context.beginPath()
        context.arc(centre, centre, r * scale, 0, 2 * Math.PI)
        context.stroke()
      }
      const [nx, ny] = place(span * 0.95, 0)
      context.fillStyle = '#808080'
      context.font = '11px ui-monospace, monospace'
      context.textAlign = 'center'
      context.fillText('N', nx, ny + 4)

      if (here && lastFix.current) {
        // How unsure the phone says this fix is, and how unsure the filter is.
        context.fillStyle = 'rgba(0, 255, 255, 0.08)'
        context.beginPath()
        context.arc(centre, centre, lastFix.current.accuracy * scale, 0, 2 * Math.PI)
        context.fill()
        context.strokeStyle = 'rgba(0, 255, 255, 0.5)'
        context.beginPath()
        context.arc(centre, centre, Math.sqrt(here.variance) * scale, 0, 2 * Math.PI)
        context.stroke()
      }

      if (here && goal) {
        const d = distance(here.at, goal.at)
        const [tx, ty] = place(d, bearing(here.at, goal.at))
        context.fillStyle = d <= ARRIVED_M ? '#00ff00' : '#ff00ff'
        context.beginPath()
        context.arc(tx, ty, 7, 0, 2 * Math.PI)
        context.fill()
      }

      context.fillStyle = getComputedStyle(element).getPropertyValue('--ak-accent').trim() || '#ff0'
      context.beginPath()
      context.moveTo(centre, centre - 9)
      context.lineTo(centre - 6, centre + 6)
      context.lineTo(centre + 6, centre + 6)
      context.fill()

      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [booted])

  const { fix, reading } = shown
  const arrived = reading !== null && reading.distance <= ARRIVED_M
  const drone = reading ? droneFrom(reading) : null

  return (
    <main className="ak flex min-h-dvh flex-col">
      <PageHeader title="geo" />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        <p className="ak-label text-sm">
          Location as an instrument. Once the phone knows where it is, a target is placed 10&ndash;30
          metres away. Walk to it: the drone&rsquo;s fifth is out of tune at the start and settles to
          a still, pure interval as you arrive. Point the phone at the target and it opens up and
          leans toward it. Best outdoors &mdash; indoors, GPS is often too vague for 10&nbsp;metres
          to mean much, and the numbers below say so.
        </p>

        <BootGate
          phase={status.phase}
          error={status.error}
          degradedReason={status.degradedReason}
          sabUnavailable={probe.sabUnavailable}
          onBoot={start}
        />

        {located === 'asking' ? (
          <p className="ss-waiting ak-panel rounded border p-3 text-sm" data-testid="geo-status">
            Waiting for location. The first precise fix can take half a minute outdoors.
          </p>
        ) : null}
        {located === 'denied' ? (
          <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
            Location was refused. Allow it for this site in the browser&rsquo;s settings, then
            reload. On iPhone, Location Services for the browser must also be on in Settings.
          </p>
        ) : null}
        {located === 'unavailable' || located === 'failed' ? (
          <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            {located === 'unavailable'
              ? 'This browser offers no location.'
              : `No location yet: ${problem}`}
          </p>
        ) : null}

        {booted ? (
          <>
            <canvas ref={canvas} className="aspect-square w-full" data-testid="geo-map" />

            <div className="flex items-center justify-between gap-3">
              <p className="ak-accent font-mono text-sm" data-testid="geo-target">
                {reading
                  ? arrived
                    ? 'arrived'
                    : `${reading.distance.toFixed(1)} m at ${reading.bearing.toFixed(0)}°`
                  : 'no target yet'}
              </p>
              <button
                type="button"
                onClick={choose}
                disabled={!reading}
                className="ak-panel min-h-11 rounded border px-3 text-sm disabled:opacity-40"
              >
                new target
              </button>
            </div>

            <Section title="location">
              <Row wide name="lat, lon" value={fix ? `${fix.lat.toFixed(6)}, ${fix.lon.toFixed(6)}` : '—'} />
              <Row name="accuracy" value={fix ? `±${fix.accuracy.toFixed(0)} m` : '—'} />
              <Row name="filtered ±" value={shown.estimate !== null ? `${shown.estimate.toFixed(1)} m` : '—'} />
              <Row name="fixes" value={`${shown.fixes}${shown.interval ? ` · every ${(shown.interval / 1000).toFixed(1)}s` : ''}`} />
              <Row
                name="altitude"
                value={fix?.altitude != null ? `${fix.altitude.toFixed(0)} m ±${fix.altitudeAccuracy?.toFixed(0) ?? '?'}` : 'not given'}
              />
              <Row name="speed" value={fix?.speed != null ? `${fix.speed.toFixed(1)} m/s` : 'not given'} />
              <Row name="course" value={fix?.course != null && !Number.isNaN(fix.course) ? `${fix.course.toFixed(0)}°` : 'only when moving'} />
            </Section>

            <Section title="orientation">
              <Row name="compass" value={shown.heading !== null ? `${shown.heading.toFixed(0)}° (${shown.source})` : 'none'} />
              <Row name="pitch" value={shown.motion.live ? shown.motion.pitch.toFixed(2) : 'none'} />
              <Row name="roll" value={shown.motion.live ? shown.motion.roll.toFixed(2) : 'none'} />
              <Row name="shake" value={shown.motion.live ? shown.motion.shake.toFixed(2) : 'none'} />
            </Section>

            <Section title="drone">
              <Row name="closeness" value={reading ? `${(closeness(reading) * 100).toFixed(0)}%` : '—'} />
              <Row name="facing" value={reading && reading.heading !== null ? `${(facing(reading) * 100).toFixed(0)}%` : 'no compass'} />
              <Row name="fifth out by" value={drone ? `${drone.beat.toFixed(2)} Hz` : '—'} />
              <Row name="cutoff" value={drone ? `${drone.cutoff.toFixed(0)} Hz` : '—'} />
            </Section>
          </>
        ) : null}

        <div className="mt-auto" />
      </div>

      {booted ? <EngineFooter /> : null}
      <SourceFooter />
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="ak-label font-mono text-[11px] uppercase tracking-wide">{title}</h2>
      <dl className="ak-label grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">{children}</dl>
    </section>
  )
}

function Row({ name, value, wide = false }: { name: string; value: string; wide?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-2 border-b border-[var(--ak-line)] py-0.5 ${wide ? 'col-span-2' : ''}`}
    >
      <dt>{name}</dt>
      <dd className="ak-accent truncate text-right" data-testid={`value-${name.replace(/\W+/g, '-')}`}>
        {value}
      </dd>
    </div>
  )
}
