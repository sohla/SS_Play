import { defineSSApp } from '@ss/vite-preset'

export default defineSSApp({
  name: 'playground',
  // The whole vendored library: 131 defs at ~656KB. Cheap enough to browse,
  // and it lets the UGen survey load every one of them in a real engine.
  synthdefs: 'all',
  // Two samples, not the whole 35MB library: enough to exercise loadSample,
  // the buffer allocator and the browser's FLAC decode in the audio tests.
  samples: ['loop_amen.flac', 'ambi_choir.flac'],
})
