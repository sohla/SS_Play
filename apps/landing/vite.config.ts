import { defineSSApp } from '@ss/vite-preset'

// engine: false is the whole point of this page's config. It lists the others
// and boots nothing, so the 1.8MB SuperSonic runtime is not staged into it —
// otherwise every visitor downloads a wasm scsynth to read three links.
export default defineSSApp({
  name: 'landing',
  basePath: '/',
  engine: false,
  port: 3002,
})
