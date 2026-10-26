import { defineSSApp } from '@ss/vite-preset'

// Plays `ssp_sine`, which the sidecar stages regardless. Nothing vendored and no samples.
export default defineSSApp({ name: 'flock', basePath: '/flock/', port: 3052 })
