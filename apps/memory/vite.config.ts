import { defineSSApp } from '@ss/vite-preset'
import { SYNTHS } from './src/synths.ts'

export default defineSSApp({
  name: 'memory',
  basePath: '/memory/',
  port: 3060,
  synthdefs: SYNTHS.map((synth) => synth.def),
})
