import { defineSSApp } from '@ss/vite-preset'

// No vendored Sonic Pi defs and no samples: this page plays one authored voice,
// ssp_touch, which the sidecar stages regardless.
export default defineSSApp({
  name: 'touch',
  basePath: '/touch/',
  port: 3006,
})
