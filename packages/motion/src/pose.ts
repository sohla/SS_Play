/**
 * Device orientation as something a synth can be driven by.
 *
 * `alpha`, `beta` and `gamma` are Euler angles, and Euler angles have a hole in
 * them. As the phone approaches vertical — beta near ±90°, which is exactly how
 * you hold a phone to look at it — the yaw and roll axes line up and become
 * degenerate: alpha and gamma trade places and jump by up to 180° for a
 * movement of a degree or two. Driving a filter from that is a lurch, and the
 * cause is invisible in the numbers because each one looks plausible alone.
 *
 * So the angles are converted to a quaternion once, and every control is
 * derived from that instead. Quaternions have no such hole.
 */
export type Quaternion = readonly [x: number, y: number, z: number, w: number]

const RAD = Math.PI / 180

/**
 * The W3C device orientation quaternion: intrinsic Z-X'-Y'' by alpha, beta,
 * gamma. The axis order is not interchangeable — swapping two of them gives a
 * rotation that looks right while the phone is flat and wrong everywhere else.
 */
export function quaternionFromEuler(alpha: number, beta: number, gamma: number): Quaternion {
  const z = alpha * RAD * 0.5
  const x = beta * RAD * 0.5
  const y = gamma * RAD * 0.5

  const cX = Math.cos(x)
  const cY = Math.cos(y)
  const cZ = Math.cos(z)
  const sX = Math.sin(x)
  const sY = Math.sin(y)
  const sZ = Math.sin(z)

  return [
    sX * cY * cZ - cX * sY * sZ,
    cX * sY * cZ + sX * cY * sZ,
    cX * cY * sZ + sX * sY * cZ,
    cX * cY * cZ - sX * sY * sZ,
  ]
}

/** Rotate a vector from world space into the device's own frame. */
function intoDeviceFrame(q: Quaternion, v: readonly [number, number, number]) {
  // The conjugate, because q maps device space to world space and this goes the
  // other way.
  const [qx, qy, qz, qw] = [-q[0], -q[1], -q[2], q[3]]
  const [vx, vy, vz] = v

  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)

  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ] as const
}

export interface Pose {
  /** Tilt left/right, -1 to 1. Roll. */
  roll: number
  /** Tilt forward/back, -1 to 1. Pitch: 1 is the phone stood upright. */
  pitch: number
  /** Which way the screen faces: 1 flat and up, -1 flat and down. */
  facing: number
  /** Heading, 0 to 1 around the full circle. Yaw. */
  yaw: number
}

/**
 * Tilt from where gravity points in the device's own frame, rather than from
 * the Euler angles directly.
 *
 * Gravity is a direction, and a direction has no discontinuities — which is the
 * whole reason for the detour through a quaternion. Tilting the phone through
 * vertical passes through this smoothly, where beta would flip sign.
 */
export function poseFrom(q: Quaternion): Pose {
  const [gx, gy, gz] = intoDeviceFrame(q, [0, 0, -1])

  // The device's own "up the screen" axis, in world space, flattened onto the
  // horizontal plane. Taking the heading this way stays continuous while the
  // phone is upright, which is when a compass-style yaw is least reliable.
  const [ux, uy] = heading(q)

  // gy and gz are negated so the signs read the way the gesture does: pitch
  // rises as the phone is stood up, and facing is positive when the screen is
  // looking at you. Gravity points the other way on both axes, which is correct
  // and the opposite of what anyone expects a control to do.
  return {
    roll: clamp(gx),
    pitch: clamp(-gy),
    facing: clamp(-gz),
    // atan2 returns -π..π; shifted to 0..1 so it is a control value rather than
    // an angle, and wraps rather than clamping.
    yaw: (Math.atan2(ux, uy) / (2 * Math.PI) + 0.5) % 1,
  }
}

/** The device's +Y axis (up the screen) expressed in world space. */
function heading(q: Quaternion): readonly [number, number] {
  const [x, y, z, w] = q
  return [2 * (x * y + w * z), 1 - 2 * (x * x + z * z)]
}

const clamp = (value: number) => Math.min(1, Math.max(-1, value))

/** 0..1, where 0 is one end of the travel and 1 the other. */
export const unipolar = (value: number) => (clamp(value) + 1) / 2

/**
 * A one-pole smoother.
 *
 * The sensors are noisy at rest — a phone on a table reports a degree or two of
 * jitter — and feeding that straight to a filter cutoff is audible as a hiss of
 * movement. The coefficient is per update rather than per second because the
 * event rate is whatever the device feels like giving.
 */
export function smooth(previous: number, next: number, coefficient = 0.15) {
  return previous + (next - previous) * coefficient
}
