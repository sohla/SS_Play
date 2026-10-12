import { defineSSApp } from '@ss/vite-preset'

export default defineSSApp({
  name: 'touch',
  basePath: '/touch/',
  port: 3006,
  // This page plays one authored voice, `ssp_touch`, which the sidecar stages
  // regardless. The two vendored defs and the sample below are **not for the
  // page** — they are the audio-test fixture, and they are here because this is
  // `ENGINE_HOST` in `tests/e2e/pages.ts`.
  //
  // The def browser used to carry them with `synthdefs: 'all'` — 131 defs,
  // ~656KB — which it could justify by being a def browser. This page cannot, so
  // only what the suite actually loads is named: `basic_stereo_player` for "a
  // sample loads, decodes and plays" and `fx_reverb` for "an effect reads a
  // private bus". Every other audio test uses authored defs.
  //
  // ~215KB of test payload on a user-facing page, and that is the wrong shape.
  // It is here because the fixture has to live *somewhere* and the suite has no
  // host of its own yet; the fix is for `tools/serve.mjs` to serve a fixture
  // page so nothing test-only ships to a visitor at all.
  synthdefs: ['sonic-pi-basic_stereo_player', 'sonic-pi-fx_reverb'],
  samples: ['loop_amen.flac'],
})
