import { defineSSApp } from '@ss/vite-preset'
import { SYNTHS } from './src/synths.ts'

export default defineSSApp({
  name: 'memory',
  basePath: '/memory/',
  port: 3060,
  // Sonic Pi's only: the sidecar's `ssp_*` defs always ship.
  synthdefs: SYNTHS.map((synth) => synth.def).filter((def) => !def.startsWith('ssp_')),
})
