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
        // preview, not dev: this serves the real build with preview.headers,
        // which is what production will look like.
        command: 'npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env['CI'],
        timeout: 60_000,
      },
})
