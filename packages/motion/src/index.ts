export {
  poseFrom,
  quaternionFromEuler,
  smooth,
  unipolar,
  type Pose,
  type Quaternion,
} from './pose.ts'

export { fold, lincurve, linexp } from './scmath.ts'

export {
  requestMotion,
  watchMotion,
  RESTING,
  type Motion,
  type MotionWatchOptions,
} from './sensors.ts'
