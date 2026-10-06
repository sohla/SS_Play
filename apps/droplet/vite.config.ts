import { defineSSApp } from '@ss/vite-preset'

// Three authored defs — the voice, the reverb and the clock that sequences
// them — all staged by the sidecar.
export default defineSSApp({
  name: 'droplet',
  basePath: '/droplet/',
  port: 3010,
})
