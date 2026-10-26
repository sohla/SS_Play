import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GridConductor, wallClockMs } from '@ss/engine'
import { requestMotion, watchMotion } from '@ss/motion'
import { useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, SourceFooter } from '@ss/ui'
import {
  AT_REST,
  COUNT,
  WORLD,
  flockOf,
  grainsForStep,
  particlesAt,
  perturb,
  wrap,
  type Local,
  type View,
} from './flock.ts'

/** 8 grains a second at most per voice slot. Slow enough that a cloud stays a cloud. */
const STEP_MS = 125

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/**
 * Where this device looks, kept across reloads so a phone stays in its place.
 *
 * `?slot=x,y` overrides it for testing two windows on one machine. The default
 * is drawn from the middle of the world rather than all of it: the sub-flocks
 * wander about a third of the way out, and a window at the edge would sit in
 * silence for minutes.
 */
function findSlot(): { x: number; y: number } {
  const given = new URLSearchParams(location.search).get('slot')?.split(',').map(Number)
  if (given && given.length === 2 && given.every(Number.isFinite)) {
    return { x: given[0]!, y: given[1]! }
  }

  try {
    const kept = localStorage.getItem('flock-slot')
    if (kept) return JSON.parse(kept) as { x: number; y: number }
  } catch {
    // Private windows and blocked storage throw; the slot is then per-load.
  }

  const slot = {
    x: WORLD / 2 + (Math.random() - 0.5) * 3.2,
    y: WORLD / 2 + (Math.random() - 0.5) * 3.2,
  }
  try {
    localStorage.setItem('flock-slot', JSON.stringify(slot))
  } catch {
    // Not worth reporting.
  }
  return slot
}

const HUES = [32, 170, 205, 330] as const

/**
 * A herd of particles that is the same herd on every device.
 *
 * Sound and picture both come from `flock.ts`; this file only draws, listens to
 * the phone, and hands the scheduler a window. Open it on two screens with
 * different `?slot=` values to watch one flock cross from one to the other, or
 * with `?view=all` to see the whole world, which is what a projector would show.
 */
export function App() {
  const { status, boot, probe, session } = useSuperSonic()
  const booted = status.phase === 'ready' || status.phase === 'degraded'

  const overview = useMemo(() => new URLSearchParams(location.search).get('view') === 'all', [])
  const slot = useMemo(findSlot, [])

  const canvas = useRef<HTMLCanvasElement>(null)
  const local = useRef<Local>({ ...AT_REST })
  const view = useRef<View>({ cx: slot.x, cy: slot.y, halfW: 0.5, halfH: 1 })
  const conductor = useRef<GridConductor | null>(null)
  const [motion, setMotion] = useState<'off' | 'live' | 'denied' | 'unsupported'>('off')
  const [readout, setReadout] = useState({ seen: 0, grains: 0 })
  const seenNow = useRef(0)

  // ---- Sound -------------------------------------------------------------
  useEffect(() => {
    const engine = session()
    if (!booted || !engine || overview || conductor.current) return

    const grid = new GridConductor({
      session: engine,
      stepMs: STEP_MS,
      // Read through refs: the scheduler runs off a timer and must see the
      // latest window and the latest tilt without waiting for a render.
      eventsFor: (step) => grainsForStep(step, STEP_MS, view.current, local.current),
    })
    grid.start()
    conductor.current = grid

    return () => {
      grid.dispose()
      conductor.current = null
    }
  }, [booted, session, overview])

  // ---- The phone ---------------------------------------------------------
  const stopMotion = useRef<(() => void) | null>(null)

  const enableMotion = useCallback(() => {
    // Called from the tap that boots the engine, synchronously, because iOS
    // only grants the sensors from inside a gesture.
    void requestMotion().then((permission) => {
      if (permission !== 'granted') {
        setMotion(permission === 'unsupported' ? 'unsupported' : 'denied')
        return
      }

      // Hold the phone however is comfortable: the first reading becomes level.
      let level: { roll: number; pitch: number } | null = null

      stopMotion.current = watchMotion({
        onMotion: (m) => {
          if (!m.live) return
          level ??= { roll: m.roll, pitch: m.pitch }
          // Rolling right and standing the phone more upright both slide things
          // toward the lower right, so the well follows that.
          const tiltX = clamp((m.roll - level.roll) * 2.5, -1, 1)
          const tiltY = clamp((m.pitch - level.pitch) * 2.5, -1, 1)
          const lean = Math.hypot(tiltX, tiltY)
          Object.assign(local.current, {
            wellX: tiltX * 0.5,
            wellY: tiltY * 0.5,
            pull: clamp(lean * 1.5, 0, 1),
            shake: Math.max(m.shake, m.turn * 0.5),
          })
          setMotion('live')
        },
      })
    })
  }, [])

  useEffect(() => () => stopMotion.current?.(), [])

  // The same gestures with a pointer, so the page can be played and tested on a
  // laptop. A phone with live motion ignores it.
  useEffect(() => {
    let blast = 0
    const onMove = (event: PointerEvent) => {
      if (motion === 'live') return
      const px = (event.clientX - innerWidth / 2) / Math.min(innerWidth, innerHeight)
      const py = (event.clientY - innerHeight / 2) / Math.min(innerWidth, innerHeight)
      Object.assign(local.current, { wellX: px, wellY: py, pull: 1 })
    }
    const onDown = () => {
      if (motion !== 'live') blast = 1
    }
    const decay = setInterval(() => {
      if (motion === 'live') return
      blast *= 0.9
      local.current.shake = blast
    }, 30)
    addEventListener('pointermove', onMove)
    addEventListener('pointerdown', onDown)
    return () => {
      clearInterval(decay)
      removeEventListener('pointermove', onMove)
      removeEventListener('pointerdown', onDown)
    }
  }, [motion])

  // ---- Picture -----------------------------------------------------------
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return

    let frame = 0
    let width = 0
    let height = 0
    let dpr = 1

    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 2)
      width = el.clientWidth
      height = el.clientHeight
      el.width = Math.round(width * dpr)
      el.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#080c0d'
      ctx.fillRect(0, 0, width, height)
      const unit = Math.min(width, height)
      view.current = { cx: slot.x, cy: slot.y, halfW: width / unit / 2, halfH: height / unit / 2 }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)

    const now = new Float64Array(COUNT * 2)
    const next = new Float64Array(COUNT * 2)
    const a = new Float64Array(2)
    const b = new Float64Array(2)

    const draw = () => {
      const t = wallClockMs()
      particlesAt(t, now)
      particlesAt(t + 60, next)

      // A translucent wash rather than a clear: the motion leaves a trail, and
      // the trail is most of why a few hundred dots read as a herd.
      ctx.fillStyle = 'rgba(8, 12, 13, 0.2)'
      ctx.fillRect(0, 0, width, height)

      const unit = Math.min(width, height)
      const scale = overview ? unit / WORLD : unit
      const { halfW, halfH } = view.current
      let seen = 0

      for (let i = 0; i < COUNT; i++) {
        let sx: number
        let sy: number
        let tx: number
        let ty: number

        if (overview) {
          sx = width / 2 + (wrap(now[i * 2]! - WORLD / 2)) * scale
          sy = height / 2 + (wrap(now[i * 2 + 1]! - WORLD / 2)) * scale
          tx = width / 2 + (wrap(next[i * 2]! - WORLD / 2)) * scale
          ty = height / 2 + (wrap(next[i * 2 + 1]! - WORLD / 2)) * scale
        } else {
          perturb(wrap(now[i * 2]! - slot.x), wrap(now[i * 2 + 1]! - slot.y), local.current, a)
          perturb(wrap(next[i * 2]! - slot.x), wrap(next[i * 2 + 1]! - slot.y), local.current, b)
          if (Math.abs(a[0]!) > halfW + 0.05 || Math.abs(a[1]!) > halfH + 0.05) continue
          sx = width / 2 + a[0]! * scale
          sy = height / 2 + a[1]! * scale
          tx = width / 2 + b[0]! * scale
          ty = height / 2 + b[1]! * scale
          seen += 1
        }

        const hue = HUES[flockOf(i)]!
        ctx.strokeStyle = `hsla(${hue}, 60%, 72%, 0.85)`
        ctx.lineWidth = overview ? 1.2 : 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        // The stroke is where the particle will be shortly, so a slow one is a
        // dot and a fast one is a streak.
        ctx.lineTo(sx + (tx - sx) * 1.5, sy + (ty - sy) * 1.5)
        ctx.stroke()
      }

      seenNow.current = seen
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [overview, slot])

  // The readout, at 4Hz, and nowhere near the audio path.
  useEffect(() => {
    const timer = setInterval(
      () => setReadout({ seen: seenNow.current, grains: conductor.current?.spawned ?? 0 }),
      250,
    )
    return () => clearInterval(timer)
  }, [])

  const start = useCallback(() => {
    enableMotion()
    return boot()
  }, [enableMotion, boot])

  return (
    <main className="ak relative flex min-h-dvh flex-col overflow-hidden">
      <canvas
        ref={canvas}
        data-testid="flock-canvas"
        className="absolute inset-0 h-full w-full touch-none"
      />

      <div className="pointer-events-none relative z-10 flex min-h-dvh flex-col">
        <div className="pad-safe-x mx-auto flex w-full max-w-md flex-col gap-3 pt-4">
          {overview ? (
            <p className="ak-label font-mono text-[11px]">
              The whole world — {COUNT} particles in 4 flocks. Every phone is a window onto this.
            </p>
          ) : (
            <>
              <p className="ak-label text-sm">
                One herd, the same on every screen, from the clock alone. This device is one window
                onto it; the flock crosses to the next screen on its own. Tilt to pull it toward you,
                shake to scatter it.
              </p>
              <div className="pointer-events-auto">
                <BootGate
                  phase={status.phase}
                  error={status.error}
                  degradedReason={status.degradedReason}
                  sabUnavailable={probe.sabUnavailable}
                  onBoot={start}
                />
              </div>
              {booted ? (
                <p className="ak-label font-mono text-[11px]" data-testid="readout">
                  motion {motion} · {readout.seen} in view · {readout.grains} grains
                  {motion === 'denied' ? ' — allow motion in settings and reload' : ''}
                  {motion === 'unsupported' || motion === 'off' ? ' — pointer steers' : ''}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-auto pointer-events-auto">
          {booted && !overview ? <EngineFooter /> : null}
          <SourceFooter />
        </div>
      </div>
    </main>
  )
}
