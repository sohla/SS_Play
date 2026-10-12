import { defineSSApp } from '@ss/vite-preset'

// Plays `ssp_kit`, which the sidecar stages regardless, and three samples from
// the shared store. No vendored defs and nothing staged per-page.
export default defineSSApp({ name: 'sync', basePath: '/sync/', port: 3050 })
