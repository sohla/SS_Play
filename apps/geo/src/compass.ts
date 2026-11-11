/**
 * Which way the phone points, in degrees from north.
 *
 * `@ss/motion`'s yaw is relative — on iOS, zero is wherever the phone happened
 * to face when the page loaded — which is right for gestures and useless for
 * "is the target that way". A heading needs the platform's absolute source:
 *
 * - **iOS** puts `webkitCompassHeading` on every `deviceorientation` event:
 *   degrees from magnetic north, already tilt-compensated.
 * - **Android Chrome** fires `deviceorientationabsolute`, whose `alpha` is
 *   measured counter-clockwise from north, so the heading is `360 − alpha`.
 *   Best with the phone held flat or upright in portrait.
 *
 * Magnetic, not true, north — the difference is the local declination, about
 * 11° in Melbourne. Close enough for "roughly that way"; worth knowing before
 * composing anything that depends on it.
 */
export type CompassSource = 'ios' | 'android'

export function watchCompass(onHeading: (degrees: number, source: CompassSource) => void): () => void {
  const fromIos = (event: DeviceOrientationEvent) => {
    const heading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
      .webkitCompassHeading
    if (typeof heading === 'number' && Number.isFinite(heading)) onHeading(heading, 'ios')
  }
  const fromAndroid = (event: DeviceOrientationEvent) => {
    if (event.alpha === null) return
    onHeading((360 - event.alpha) % 360, 'android')
  }

  addEventListener('deviceorientation', fromIos)
  addEventListener('deviceorientationabsolute', fromAndroid as EventListener)
  return () => {
    removeEventListener('deviceorientation', fromIos)
    removeEventListener('deviceorientationabsolute', fromAndroid as EventListener)
  }
}

/**
 * Smoothing for an angle, which cannot be averaged as a number: 359° and 1° are
 * two degrees apart, not 358. Blend the unit vectors instead.
 */
export function smoothHeading(previous: number | null, next: number, amount = 0.2): number {
  if (previous === null) return next
  const rad = Math.PI / 180
  const x = (1 - amount) * Math.cos(previous * rad) + amount * Math.cos(next * rad)
  const y = (1 - amount) * Math.sin(previous * rad) + amount * Math.sin(next * rad)
  return ((Math.atan2(y, x) / rad) % 360 + 360) % 360
}
