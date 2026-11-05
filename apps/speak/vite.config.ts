import { defineSSApp } from '@ss/vite-preset'

export default defineSSApp({
  name: 'speak',
  basePath: '/speak/',
  port: 3056,
  // Sonic Pi's bells, vendored with the engine: struck, self-freeing, and
  // nothing to author for a page whose subject is the voice.
  synthdefs: ['sonic-pi-pretty_bell', 'sonic-pi-dull_bell'],
})
