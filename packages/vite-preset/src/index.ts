import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'
import headers from '../../../infra/headers.json' with { type: 'json' }
import { VENDOR_DIR, vendorPlugin } from './vendor.ts'

export { VENDOR_DIR, stageVendor, vendorPlugin } from './vendor.ts'

/** Where the engine is served from, for resolveEngineUrls({ base }). */
export const ENGINE_BASE = `/${VENDOR_DIR}/`

export const DOCUMENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  ...headers.document,
})

// Each declared sample is copied into the app's own bundle, so a page that asks
// for the whole 35MB library multiplies that across every release on the VM.
// Pages use a handful; wanting dozens means the page should load them on demand.
export const MAX_SAMPLES_PER_APP = 32

export interface SSAppOptions {
  /** Workspace directory name under apps/, and the deploy target name. */
  name: string
  /** Logical SynthDef names this page loads. */
  synthdefs?: string[]
  /** Sample filenames this page loads. */
  samples?: string[]
  /** Dev server port. Defaults to 3000. */
  port?: number
  /** The app's own directory. Defaults to the directory of its vite config. */
  appDir?: string
}

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

export function defineSSApp(options: SSAppOptions): UserConfig {
  const { name, synthdefs = [], samples = [], port = 3000 } = options
  const appDir = options.appDir ?? join(repoRoot, 'apps', name)

  if (samples.length > MAX_SAMPLES_PER_APP) {
    throw new Error(
      `App "${name}" declares ${samples.length} samples, over the ${MAX_SAMPLES_PER_APP} limit. ` +
        `Samples are copied into this app's bundle and into every release on the server. ` +
        `Load the long tail on demand instead of declaring it.`,
    )
  }

  return defineConfig({
    plugins: [vendorPlugin({ appDir, synthdefs, samples }), react(), tailwind()],

    build: {
      target: 'es2022',
      sourcemap: true,
    },

    // Injected rather than imported. Browser code must never import from this
    // package: doing so pulls fs, path and the whole bundler into the client
    // bundle, which fails as "stream did not contain valid UTF-8".
    define: {
      __SS_ENGINE_BASE__: JSON.stringify(ENGINE_BASE),
      __SS_APP_NAME__: JSON.stringify(name),
    },

    // Identical header sets on both servers, from infra/headers.json, so that
    // `vite dev`, `vite preview` and Caddy cannot disagree about whether the
    // page is cross-origin isolated. Without isolation SharedArrayBuffer is
    // gone, SuperSonic silently drops to its slower transport, and audio
    // capture stops working — see docs/CROSS_ORIGIN.md.
    server: {
      port,
      headers: { ...DOCUMENT_HEADERS },
      fs: { allow: [repoRoot] },
    },

    preview: {
      port: port + 1173,
      headers: { ...DOCUMENT_HEADERS },
    },

    optimizeDeps: {
      include: ['supersonic-scsynth'],
      // The AGPL core is fetched at runtime from the vendor directory, never
      // imported. Bundling it would break the worklet and blur the licence
      // boundary at the same time.
      exclude: ['supersonic-scsynth-core', '@ss/engine', '@ss/react', '@ss/ui'],
    },
  })
}
