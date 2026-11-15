import { defineSSApp } from '@ss/vite-preset'

export default defineSSApp({
  name: 'onboard-two',
  basePath: '/onboard-two/',
  port: 3059,
  // The check chime: Sonic Pi's bell, vendored with the engine.
  synthdefs: ['sonic-pi-pretty_bell'],
})
