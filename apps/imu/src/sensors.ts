import { poseFrom, quaternionFromEuler, smooth, type Pose } from './pose.ts'

export interface Motion extends Pose {
  /** 0..1 from linear acceleration, gravity already removed. Decays on its own. */
  shake: number
  /** False until an event has actually arrived, which is not the same as permitted. */
  live: boolean
  /** Whether the device reports linear acceleration separately from gravity. */
  hasAcceleration: boolean
}

export const RESTING: Motion = {
  roll: 0,
  pitch: 0,
  facing: 1,
  yaw: 0,
  shake: 0,
  live: false,
  hasAcceleration: false,
}

type Permission = 'unsupported' | 'prompt' | 'granted' | 'denied'

type PermissionCapable = { requestPermission?: () => Promise<'granted' | 'denied'> }

/**
 * Ask for the sensors, from inside a user gesture.
 *
 * iOS 13 and later gate both events behind `requestPermission`, and it must be
 * called synchronously from a tap — not from an effect, not after an await. It
 * also needs a secure context, which is why `npm run dev:lan` exists with
 * mkcert rather than plain HTTP over the LAN.
 *
 * Everywhere else the call does not exist and the events simply arrive, so a
 * missing `requestPermission` is the normal case rather than a failure.
 */
export async function requestMotion(): Promise<Permission> {
  if (typeof DeviceOrientationEvent === 'undefined') return 'unsupported'

  const orientation = DeviceOrientationEvent as unknown as PermissionCapable
  const motion =
    typeof DeviceMotionEvent === 'undefined'
      ? undefined
      : (DeviceMotionEvent as unknown as PermissionCapable)

  if (typeof orientation.requestPermission !== 'function') return 'granted'

  try {
    const [first, second] = await Promise.all([
      orientation.requestPermission(),
      typeof motion?.requestPermission === 'function'
        ? motion.requestPermission()
        : Promise.resolve('granted' as const),
    ])
    return first === 'granted' && second === 'granted' ? 'granted' : 'denied'
  } catch {
    // Throws when called outside a user gesture, which is a programming error
    // rather than a refusal — but it reaches the user as the same dead page.
    return 'denied'
  }
}

export interface MotionWatchOptions {
  /** Called at sensor rate, roughly 60Hz. Never put React state behind this. */
  onMotion(motion: Motion): void
}

/**
 * Subscribe to orientation and acceleration, smoothed, as one reading.
 *
 * The two events are separate and arrive at different rates, so the latest of
 * each is held and merged — rather than waiting for them to coincide, which
 * they never do.
 */
export function watchMotion({ onMotion }: MotionWatchOptions): () => void {
  let current: Motion = { ...RESTING }

  const onOrientation = (event: DeviceOrientationEvent) => {
    const { alpha, beta, gamma } = event
    if (alpha === null || beta === null || gamma === null) return

    const pose = poseFrom(quaternionFromEuler(alpha, beta, gamma))

    current = {
      ...current,
      live: true,
      roll: smooth(current.roll, pose.roll),
      pitch: smooth(current.pitch, pose.pitch),
      facing: smooth(current.facing, pose.facing),
      // Not smoothed the same way: yaw wraps, so interpolating across the seam
      // would sweep the long way round the circle rather than stepping over it.
      yaw: Math.abs(pose.yaw - current.yaw) > 0.5 ? pose.yaw : smooth(current.yaw, pose.yaw),
    }

    onMotion(current)
  }

  const onDeviceMotion = (event: DeviceMotionEvent) => {
    const a = event.acceleration
    // `acceleration` is null on devices that cannot separate gravity out;
    // accelerationIncludingGravity is always there but sits at 1g at rest, so
    // it cannot be used for this without an estimate of which way down is.
    if (!a || (a.x === null && a.y === null && a.z === null)) return

    const magnitude = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0)

    current = {
      ...current,
      hasAcceleration: true,
      // Rises immediately and falls slowly: a shake is a transient, and a
      // symmetric smoother would swallow it before it reached the synth.
      shake: Math.max(Math.min(magnitude / 12, 1), current.shake * 0.92),
    }

    onMotion(current)
  }

  window.addEventListener('deviceorientation', onOrientation)
  window.addEventListener('devicemotion', onDeviceMotion)

  return () => {
    window.removeEventListener('deviceorientation', onOrientation)
    window.removeEventListener('devicemotion', onDeviceMotion)
  }
}
