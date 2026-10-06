import { defineConfig } from '@playwright/test'

// Set SS_BASE_URL to run the same specs against a deployed page instead of a
// local preview build. The isolation spec is the one that matters there: a
// dropped header in production is invisible by every other means.
const baseURL = process.env['SS_BASE_URL'] ?? 'http://localhost:4173'

export default defineConfig({
  testDir: 'tests/e2e',

  // One AudioContext per machine. Audio tests cannot share a browser without
  // interfering, and a flaky audio suite gets disabled, which loses the only
  // real verification this project has.
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',

  use: {
    baseURL,
    // Drives the installed Chrome rather than a downloaded Chromium: it is the
    // engine's primary target and costs no disk.
    channel: 'chrome',
    // Mutes the output device. Capture taps the worklet upstream of the
    // device, so this does not affect what the audio assertions see.
    launchOptions: { args: ['--mute-audio'] },
  },

  webServer: process.env['SS_BASE_URL']
    ? undefined
    : {
        // tools/serve.mjs over the assembled tree, not `vite preview` over a
        // single app. The pages share an origin and sit under their own path
        // prefixes, so a one-app server cannot represent what ships: the
        // landing page's links would 404 and no test would touch a real page
        // path. It also sends the headers from infra/headers.json, so what the
        // suite checks is what Caddy will serve.
        command: 'npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env['CI'],
        timeout: 60_000,
      },
})
