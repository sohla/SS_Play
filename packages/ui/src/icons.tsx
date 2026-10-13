import type { ReactNode } from 'react'

/**
 * One icon per page, drawn from what that page actually does.
 *
 * Each is a reading of the page's SynthDef and its mapping rather than a
 * decoration: the envelope `thrum` really uses, the subdivisions `kit` really
 * cuts, the nine-against-sixteen that `suz` really drifts through. Which is the
 * only way a set of fifteen small marks stays distinguishable — they differ
 * because the instruments differ, not because someone needed fifteen ideas.
 *
 * ## Why they live here and not in each page
 *
 * Pages are silos and this is the one thing that cannot be. The landing page
 * renders every page's icon, so it has to reach them all — and it already
 * reaches every page's title, path and blurb through `infra/sites.json`. An icon
 * keyed by app name is the same dependency that is already there, not a new one.
 *
 * `packages/ui/test/icons.test.ts` asserts that `sites.json` and this map agree
 * in both directions, so adding a page without an icon, or leaving an icon
 * behind after deleting a page, is a failing test rather than a silent gap.
 *
 * ## The drawing rules
 *
 * A 24×24 box, `currentColor`, stroke only, 1.5 units wide. `currentColor`
 * matters: the landing page is grey-on-dark and the instrument pages are
 * AirKit's yellow-on-black, and one set has to read on both without knowing
 * which it is in.
 */
const SHAPES: Record<string, ReactNode> = {
  /**
   * `sync` — four quarters on an absolute grid.
   *
   * The downbeat is taller because the grid is anchored: step 0 of a bar is a
   * particular instant rather than whenever you started. The dot is the one
   * every device agrees on.
   */
  sync: (
    <>
      <path d="M3 19h18" />
      <path d="M5 19V8M11 19v-5M17 19v-5" />
      <circle cx="5" cy="5" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),

  /**
   * `thrum` — the pulse envelope a hand chose, and the transient on top of it.
   *
   * 14.5ms of rise, a held plateau, then a drop: curve +4, which is the
   * opposite end from a struck decay and the shape that turned out to be
   * feelable. The spike is the 2.5kHz transient that makes a felt event
   * placeable in time.
   */
  thrum: (
    <>
      <path d="M3 19c3 0 2-9 5-9h7c3 0 2 9 5 9" />
      <path d="M8 10V3" />
    </>
  ),

  /**
   * `combo` — three layers dividing one bar: 2, 4 and 8 to the bar.
   *
   * The rows are the kit, the bass and the melody, and the counts are the
   * subdivisions each can take. They are drawn to a common width because the
   * bar is common — that is the whole claim the page makes.
   */
  combo: (
    <>
      <path d="M3 5v4M13 5v4" />
      <path d="M3 11v4M9 11v4M15 11v4M21 11v4" />
      <path d="M3 17v4M7 17v4M11 17v4M15 17v4M19 17v4" />
    </>
  ),

  /**
   * `marimba` — struck bars, and the octave that walks up per note.
   *
   * Heights ascend because the octave moves on every event rather than every
   * bar, so a figure climbs through the bar instead of sitting in one register.
   */
  marimba: (
    <>
      <path d="M4 20v-4M8.8 20v-7M13.6 20v-10M18.4 20v-13" />
      <path d="M2 20h20" opacity="0.35" />
      <circle cx="18.4" cy="5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),

  /**
   * `dulcimer` — a hammered string walking *down* three octaves, with a tail.
   *
   * Three strings of shortening length for the descent, and the curve is the
   * reverb on a private bus — the one page here with an fx send.
   */
  dulcimer: (
    <>
      <path d="M3 6h17M3 11h12M3 16h7" />
      <path d="M3 21c6 0 9-2 11-5" opacity="0.5" />
      <circle cx="20" cy="6" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),

  /**
   * `piano` — six samples, one per octave, stretched to reach the rest.
   *
   * Keys, and the arrow is the nearest-sample lookup: a buffer pulled up to
   * eleven semitones away from where it was recorded.
   */
  piano: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="1" />
      <path d="M8.25 6v13M13.5 6v13" />
      <rect x="6.6" y="6" width="3.3" height="7.5" fill="currentColor" stroke="none" />
      <rect x="11.9" y="6" width="3.3" height="7.5" fill="currentColor" stroke="none" />
      <rect x="17.2" y="6" width="3.3" height="7.5" fill="currentColor" stroke="none" />
    </>
  ),

  /**
   * `kit` — a half-second bar cut into two, four or eight.
   *
   * A ruler, because that is exactly what the mapping is: moving changes how
   * finely the bar is divided and never how fast it runs. Tick depth is the
   * division — one long, two medium, four short.
   */
  kit: (
    <>
      <path d="M3 8h18" />
      <path d="M12 8v11" />
      <path d="M7.5 8v7M16.5 8v7" />
      <path d="M5.25 8v4M9.75 8v4M14.25 8v4M18.75 8v4" />
    </>
  ),

  /**
   * `beast` — five against four against seven.
   *
   * Three rings, three dash counts. Concentric because they share a start and
   * nothing else: the cycle only closes again after 140 steps.
   */
  beast: (
    <>
      <path d="M12 2.5a9.5 9.5 0 1 1-6.7 2.8" />
      <path d="M12 5.5a6.5 6.5 0 1 1-6.5 6.5" />
      <path d="M12 8.5a3.5 3.5 0 0 1 3.5 3.5" />
      <circle cx="5.3" cy="5.3" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),

  /**
   * `suz` — nine notes against a sixteen-step octave, drifting.
   *
   * Two rings, nine marks and sixteen, and the two radial lines are the drift:
   * they start together and only meet again every 144 events, which is the
   * piece rather than a side effect.
   */
  suz: (
    <>
      <path d="M3 8h18M3 16h18" opacity="0.3" />
      <path d="M3 6v4M9 6v4M15 6v4M21 6v4" />
      <path d="M3 14v4M6.6 14v4M10.2 14v4M13.8 14v4M17.4 14v4M21 14v4" />
      <circle cx="3" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),

  /**
   * `moog` — three detuned oscillators into a resonant lowpass.
   *
   * The curve is the filter: flat, a resonant peak, then a steep rolloff. The
   * three dots are the oscillators feeding it, which is where the beating that
   * stops a long note sitting still comes from.
   */
  moog: (
    <>
      <path d="M3 17h7l3.5-9 2 9 5-1" />
      <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="7.6" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="11.2" cy="6" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),

  /**
   * `pluck` — a string knocked to pitch.
   *
   * The displacement is where it is struck and the dotted continuation is the
   * ring: one voice, held open, played entirely by moving its controls.
   */
  pluck: (
    <>
      <path d="M3 12h4l2-5 2 10 1.5-5h2" />
      <path d="M17 12h4" strokeDasharray="1.6 2.4" />
      <circle cx="9" cy="7" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),

  /**
   * `trainmelody` — a five-note figure, and the filter swept against resonance.
   *
   * The dots are the figure and the arc is the roll: a sweep that moves the
   * cutoff and the resonance together, which is why it is one curve.
   */
  trainmelody: (
    <>
      <circle cx="4" cy="16" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="13" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="13" cy="15" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="21" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M3 21c5 0 13-3 18-14" opacity="0.5" />
    </>
  ),

  /**
   * `multibeat` — a bar cut into one, two or four, over a drone.
   *
   * The straight line underneath is the held voice: this is the page that runs
   * a client sequence *over* a continuous one, so the divisions sit on top of
   * something that never stops.
   */
  multibeat: (
    <>
      <path d="M3 7h18" />
      <path d="M3 7v6M12 7v6" />
      <path d="M7.5 7v4M16.5 7v4" />
      <path d="M3 18h18" opacity="0.6" />
    </>
  ),

  /**
   * `droplet` — drops, and the tails a flick lengthens.
   *
   * Hold the phone flat and they fall; stand it upright and they stop. The
   * trailing lines are the release, which is the one thing acceleration
   * controls here.
   */
  droplet: (
    <>
      <path d="M8 13c0-2.5 2.5-4 2.5-7C10.5 9 13 10.5 13 13a2.5 2.5 0 0 1-5 0Z" />
      <path d="M10.5 16v5" strokeDasharray="1.6 2.2" />
      <path d="M18 8c0-1.6 1.6-2.6 1.6-4.5C19.6 5.4 21.2 6.4 21.2 8a1.6 1.6 0 0 1-3.2 0Z" opacity="0.55" />
      <path d="M19.6 10v3.5" strokeDasharray="1.4 2" opacity="0.55" />
    </>
  ),

  /**
   * `touch` — a strip per note, and as many fingers as you have.
   *
   * Two dots at different heights, because sliding up a strip is the volume: the
   * only page here played by position rather than by motion.
   */
  touch: (
    <>
      <path d="M4 4v16M9.3 4v16M14.6 4v16M20 4v16" opacity="0.45" />
      <circle cx="9.3" cy="9" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="20" cy="15" r="2.1" fill="currentColor" stroke="none" />
    </>
  ),
}

/** Every app this module can draw. Compared against `sites.json` by a test. */
export const ICON_APPS: readonly string[] = Object.freeze(Object.keys(SHAPES))

/** Whether an app has an icon, without rendering one. */
export function hasPageIcon(app: string): boolean {
  return app in SHAPES
}

export interface PageIconProps {
  /** The app name from `infra/sites.json`, which is also `__SS_APP_NAME__`. */
  app: string
  className?: string
}

/**
 * A page's icon, or nothing.
 *
 * Returns `null` for an unknown app rather than throwing or drawing a
 * placeholder: a page that ships without an icon should look plain, not broken.
 * The test is what stops it staying that way.
 */
export function PageIcon({ app, className = 'h-5 w-5' }: PageIconProps) {
  const shapes = SHAPES[app]
  if (!shapes) return null

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      // Decorative in both places it appears: the landing page puts it beside
      // the page's own name and the header puts it beside the title, so a label
      // here would be read out twice.
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-testid={`icon-${app}`}
    >
      {shapes}
    </svg>
  )
}
