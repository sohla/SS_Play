import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      // Apps are mostly components, which the e2e suite covers. Pure logic in
      // an app — the IMU quaternion maths — belongs here, where it can be run
      // against a thousand orientations without a browser.
      'apps/*/test/**/*.test.ts',
    ],
    typecheck: {
      enabled: true,
      include: ['packages/*/test/**/*.test-d.ts'],
      tsconfig: './tsconfig.typecheck.json',
    },
  },
})
