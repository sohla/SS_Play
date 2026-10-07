import { useEffect, useRef } from 'react'

/**
 * AirKit's trace colours, in AirKit's order.
 *
 * `[yellow, magenta, cyan, red, green, blue]` from `plotterView.scd`, and the
 * order is not decoration — every p-file carries a `// [yellow, magenta, cyan]`
 * comment above its `~plot` body naming which expression is which colour. Change
 * the order and a decade of those comments becomes wrong.
 */
export const PLOT_COLOURS = [
  '#ffff00',
  '#ff00ff',
  '#00ffff',
  '#ff0000',
  '#00ff00',
  '#0000ff',
] as const

/** Frames of history, as `plotterView.scd` keeps. */
export const PLOT_FRAMES = 50

/**
 * How often a frame is taken.
 *
 * AirKit yields 0.03 between frames, with the comment "this has a big impact on
 * CPU use" — so 33Hz is a measured choice there rather than an arbitrary one, and
 * it is kept. At 50 frames that makes the window about a second and a half of
 * history, which is what gives the traces their shape.
 */
const SAMPLE_HZ = 33

export interface PlotterProps {
  /**
   * The page's `~plot`, called at frame rate.
   *
   * Polled rather than pushed, exactly as AirKit's Routine polls it. Returning a
   * different number of values between calls is tolerated — a `~plot` body that
   * switches between expressions mid-session is a normal thing to do while
   * tuning.
   */
  sample: () => number[]
  /** `~plotMin` / `~plotMax`. */
  min?: number
  max?: number
  /**
   * What each series is, in colour order. Shown as a legend.
   *
   * AirKit has no legend — the colour order lives in a comment in the p-file, and
   * you learn it. On a page someone opens once, a legend is the difference
   * between a plot that means something and three wiggling lines.
   */
  labels?: string[]
  /** Stop sampling and show a flat line, as AirKit does when a device is disabled. */
  idle?: boolean
  height?: number
}

/**
 * A port of AirKit's `plotterView`.
 *
 * Fifty frames of history, newest on the right, every series overlaid on one set
 * of axes — `superpose = true` in the original. The values are whatever the
 * page's `~plot` returns, which is the point of it: these are the numbers the
 * mapping actually feeds its curves, so a gesture that does nothing is visible
 * here and invisible in the raw sensor angles.
 *
 * Canvas, and no React state at all. The rule in this project is that nothing
 * re-renders from a high-rate source, and 33 frames a second of `setState` would
 * be exactly that. The ring buffer is written and the canvas is drawn inside one
 * interval; React renders this component once.
 */
export function Plotter({
  sample,
  min = -1,
  max = 1,
  labels = [],
  idle = false,
  height = 132,
}: PlotterProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null)

  // Written by the sampler, read by the draw. A ref rather than state, and a
  // plain array of arrays rather than one flat buffer — the series count can
  // change between frames, so a fixed-width buffer would need a reshape on every
  // change for no gain at fifty frames.
  const history = useRef<number[][]>([])

  // The latest `sample` without re-arming the interval. The page passes an
  // arrow function, so its identity changes every render.
  const latest = useRef(sample)
  latest.current = sample

  const bounds = useRef({ min, max, idle })
  bounds.current = { min, max, idle }

  useEffect(() => {
    const element = canvas.current
    if (!element) return

    const context = element.getContext('2d')
    if (!context) return

    let stopped = false

    const draw = () => {
      const ratio = window.devicePixelRatio || 1
      const width = element.clientWidth
      const tall = element.clientHeight

      // Resized only when it has actually changed: assigning width or height
      // clears the canvas, so doing it every frame would also be doing the
      // clear twice.
      if (element.width !== Math.round(width * ratio)) {
        element.width = Math.round(width * ratio)
        element.height = Math.round(tall * ratio)
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, tall)

      context.fillStyle = '#000000'
      context.fillRect(0, 0, width, tall)

      const { min: low, max: high } = bounds.current
      const span = high - low || 1
      const y = (value: number) => tall - ((value - low) / span) * tall

      // Grey grid, as the original sets gridColorX and gridColorY. Quarters,
      // with the zero line brighter because on a -1..1 plot it is the one line
      // that means something.
      context.lineWidth = 1
      for (let n = 0; n <= 4; n++) {
        const at = (tall / 4) * n
        context.strokeStyle = '#333333'
        context.beginPath()
        context.moveTo(0, at + 0.5)
        context.lineTo(width, at + 0.5)
        context.stroke()
      }
      if (low < 0 && high > 0) {
        context.strokeStyle = '#666666'
        context.beginPath()
        context.moveTo(0, y(0) + 0.5)
        context.lineTo(width, y(0) + 0.5)
        context.stroke()
      }

      const frames = history.current
      if (frames.length > 1) {
        const series = Math.max(...frames.map((frame) => frame.length))
        const step = width / (PLOT_FRAMES - 1)

        for (let index = 0; index < series; index++) {
          context.strokeStyle = PLOT_COLOURS[index % PLOT_COLOURS.length] as string
          context.lineWidth = 1.5
          context.beginPath()

          let started = false
          // Oldest on the left: the buffer has newest first, as AirKit's
          // addFirst leaves it, so it is read backwards to draw forwards.
          for (let frame = frames.length - 1; frame >= 0; frame--) {
            const value = (frames[frame] as number[])[index]
            if (value === undefined || !Number.isFinite(value)) continue

            const at = width - (frames.length - 1 - frame) * step
            const height = y(Math.min(Math.max(value, low), high))
            if (started) context.lineTo(at, height)
            else {
              context.moveTo(at, height)
              started = true
            }
          }
          context.stroke()
        }
      }
    }

    const tick = () => {
      if (stopped) return

      if (bounds.current.idle) {
        // A flat line rather than a frozen one, which is what AirKit shows for a
        // disabled device — `plotter.value = [0]!50`. A plot holding its last
        // shape looks like a live instrument that has stopped responding.
        history.current = []
      } else {
        try {
          history.current.unshift(latest.current())
        } catch {
          // A `~plot` body that throws should not take the page with it. Being
          // edited while running is the normal case for one of these.
          history.current.unshift([])
        }
        if (history.current.length > PLOT_FRAMES) history.current.pop()
      }

      draw()
    }

    const timer = setInterval(tick, 1000 / SAMPLE_HZ)
    tick()

    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  return (
    <div>
      <canvas
        ref={canvas}
        data-testid="plotter"
        className="block w-full rounded border border-neutral-800 bg-black"
        style={{ height: `${height}px` }}
      />
      {labels.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-neutral-500">
          {labels.map((label, index) => (
            <li key={label} className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: PLOT_COLOURS[index % PLOT_COLOURS.length] }}
              />
              {label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
