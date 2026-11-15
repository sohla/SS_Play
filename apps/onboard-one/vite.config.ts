import { defineSSApp } from '@ss/vite-preset'

export default defineSSApp({
  name: 'onboard-one',
  basePath: '/onboard-one/',
  port: 3058,
  // The check chime: Sonic Pi's bell, vendored with the engine.
  synthdefs: ['sonic-pi-pretty_bell'],
})
