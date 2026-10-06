import { defineSSApp } from '@ss/vite-preset'

// Deliberately the smallest thing that still boots a real engine: no vendored
// Sonic Pi defs and no samples. `synthdefs` names only the vendored library —
// the sidecar's own authored defs are staged regardless, so this page gets
// ssp_sine and its parameter contract without declaring anything.
//
// If a second page needed the playground's declarations to work, the preset
// would be carrying one page's assumptions rather than being a factory.
export default defineSSApp({
  name: 'scratch',
  basePath: '/scratch/',
  port: 3004,
})
