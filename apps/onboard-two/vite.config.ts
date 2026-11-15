import { defineSSApp } from '@ss/vite-preset'
import { synthdefsOf } from '../../packages/onboard/src/cues.ts'
import { instruments } from '../../packages/onboard/src/score.ts'

export default defineSSApp({
  name: 'onboard-two',
  basePath: '/onboard-two/',
  port: 3059,
  // Whatever the score's instruments use; the sidecar's `ssp_*` defs ship anyway.
  synthdefs: synthdefsOf(instruments).filter((def) => !def.startsWith('ssp_')),
})
