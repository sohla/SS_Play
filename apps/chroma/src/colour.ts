/**
 * The screen's colour: a new one on each accent, never fewer than a third of a
 * second apart.
 *
 * ## Why the cap
 *
 * A full-screen colour change is a flash, and at the dense level the phrase
 * accents faster than three times a second. Three flashes a second is the
 * WCAG 2.3.1 general and red-flash threshold — the range up to about 30Hz is
 * where photosensitive seizures are provoked — so an accent that arrives sooner
 * than `MIN_GAP_MS` after the last change still sounds, but leaves the colour
 * where it is.
 *
 * ## Why the jump
 *
 * Each hue is 100° to 260° round the wheel from the one before — at least 100°
 * either way — so every change reads as a shift rather than a drift. The jump
 * varies, so it does not settle into flipping between two complements.
 * Saturation and lightness stay high and nearly fixed — vibrant is the brief,
 * and holding lightness level keeps each change a change of hue rather than a
 * pulse of brightness.
 */
export const MIN_GAP_MS = 1000 / 3

export interface Colour {
  hue: number
  saturation: number
  lightness: number
}

export const FIRST: Colour = { hue: 330, saturation: 95, lightness: 52 }

/** 0..1 from an integer. Deterministic so a test can step through changes. */
function unit(n: number, salt: number): number {
  let x = Math.imul((n % 65536) ^ Math.imul(Math.floor(n / 65536) % 65536, 0x27d4eb2d), 0x9e3779b1)
  x = Math.imul(x ^ Math.imul(salt + 1, 0x85ebca6b) ^ (x >>> 15), 0x2c1b3c6d)
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296
}

/** The colour after `previous`, for the accent at `tick`. */
export function nextColour(previous: Colour, tick: number): Colour {
  return {
    hue: (previous.hue + 100 + unit(tick, 0) * 160) % 360,
    saturation: 85 + unit(tick, 1) * 15,
    lightness: 48 + unit(tick, 2) * 8,
  }
}

export function css({ hue, saturation, lightness }: Colour): string {
  return `hsl(${hue.toFixed(1)} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}%)`
}

/** The signed distance between two hues, -180..180. */
export function hueStep(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}
