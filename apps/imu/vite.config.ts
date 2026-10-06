import { defineSSApp } from '@ss/vite-preset'

// One authored voice, ssp_drone, which the sidecar stages regardless.
export default defineSSApp({
  name: 'imu',
  basePath: '/imu/',
  port: 3008,
})
