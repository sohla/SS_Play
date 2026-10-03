import { defineSSApp } from '@ss/vite-preset'

export default defineSSApp({
  name: 'playground',
  // The whole vendored library: 131 defs at ~656KB. Cheap enough to browse,
  // and it lets the UGen survey load every one of them in a real engine.
  synthdefs: 'all',
})
