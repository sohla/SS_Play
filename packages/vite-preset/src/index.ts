import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import tailwind from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'
import headers from '../../../infra/headers.json' with { type: 'json' }
import { VENDOR_DIR, vendorPlugin } from './vendor.ts'

export { VENDOR_DIR, stageVendor, vendorPlugin } from './vendor.ts'

/**
 * Where the engine is served from, for resolveEngineUrls({ base }).
 *
 * The pages share one origin and sit under their own path prefixes, so this is
 * relative to the page rather than to the host. Each page stages its own copy:
 * one shared tree would be a cross-directory reference that the dev server,
 * the assembled build and Caddy would each have to be taught separately.
 */
export const engineBase = (basePath: string) => `${basePath}${VENDOR_DIR}/`

export const DOCUMENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  ...headers.document,
})

// Each declared sample is copied into the app's own bundle, so a page that asks
// for the whole 35MB library multiplies that across every release on the VM.
// Pages use a handful; wanting dozens means the page should load them on demand.
export const MAX_SAMPLES_PER_APP = 32

/**
 * TLS for testing on a physical device over the LAN, enabled with SS_LAN=1.
 *
 * Plain http://localhost is already a secure context, so the normal loop needs
 * no certificate. A phone reaching the Mac by IP is not localhost, and without
 * a secure context there is no AudioWorklet, no SharedArrayBuffer and no
 * DeviceMotion — and iOS additionally wants a chain it trusts, not merely a
 * certificate. Hence mkcert rather than a self-signed pair.
 */
function lanServerOptions(repoRoot: string) {
  if (!process.env['SS_LAN']) return {}

  const dir = join(repoRoot, 'infra', 'certs')
  const key = join(dir, 'lan-key.pem')
  const cert = join(dir, 'lan.pem')

  if (!existsSync(key) || !existsSync(cert)) {
    throw new Error(
      `SS_LAN is set but no certificate was found in infra/certs/.\n` +
        `Generate one for this machine's LAN address:\n` +
        `  mkcert -install\n` +
        `  mkdir -p infra/certs && cd infra/certs\n` +
        `  mkcert -key-file lan-key.pem -cert-file lan.pem localhost 127.0.0.1 <your-lan-ip>\n` +
        `See docs/CROSS_ORIGIN.md.`,
    )
  }

  return { host: true, https: { key: readFileSync(key), cert: readFileSync(cert) } }
}

export interface SSAppOptions {
  /** Workspace directory name under apps/, and the deploy target name. */
  name: string
  /**
   * URL prefix this page is served from, with both slashes: '/playground/'.
   * Defaults to '/' for the landing page. Must match the page's `path` in
   * infra/sites.json, which is what Caddy and the assembled build use.
   */
  basePath?: string
  /** Logical SynthDef names, or 'all' for the whole vendored library. */
  synthdefs?: string[] | 'all'
  /** Sample filenames this page loads. */
  samples?: string[]
  /**
   * Whether this page runs an engine. Defaults to true. The landing page sets
   * it false: the runtime is 1.8MB of wasm before any SynthDef, and a page of
   * links would otherwise serve all of it to every visitor.
   */
  engine?: boolean
  /** Dev server port. Defaults to 3000. */
  port?: number
  /** The app's own directory. Defaults to the directory of its vite config. */
  appDir?: string
}

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

export function defineSSApp(options: SSAppOptions): UserConfig {
  const { name, synthdefs = [], samples = [], port = 3000, basePath = '/', engine = true } = options
  const appDir = options.appDir ?? join(repoRoot, 'apps', name)

  if (!engine && (options.synthdefs !== undefined || samples.length > 0)) {
    throw new Error(
      `App "${name}" sets engine: false but declares synthdefs or samples. ` +
        `Nothing would load them, so one of the two is a mistake.`,
    )
  }

  if (!basePath.startsWith('/') || !basePath.endsWith('/')) {
    throw new Error(
      `App "${name}" has basePath "${basePath}". It needs a leading and trailing slash ` +
        `("/playground/"), because Vite joins it to asset URLs by concatenation — so this ` +
        `would silently produce "${basePath}assets/index.js".`,
    )
  }

  if (samples.length > MAX_SAMPLES_PER_APP) {
    throw new Error(
      `App "${name}" declares ${samples.length} samples, over the ${MAX_SAMPLES_PER_APP} limit. ` +
        `Samples are copied into this app's bundle and into every release on the server. ` +
        `Load the long tail on demand instead of declaring it.`,
    )
  }

  return defineConfig({
    base: basePath,

    plugins: [vendorPlugin({ appDir, synthdefs, samples, engine }), react(), tailwind()],

    build: {
      target: 'es2022',
      sourcemap: true,
    },

    // Injected rather than imported. Browser code must never import from this
    // package: doing so pulls fs, path and the whole bundler into the client
    // bundle, which fails as "stream did not contain valid UTF-8".
    define: {
      __SS_ENGINE_BASE__: JSON.stringify(engineBase(basePath)),
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
      ...lanServerOptions(repoRoot),
    },

    preview: {
      port: port + 1173,
      headers: { ...DOCUMENT_HEADERS },
      ...lanServerOptions(repoRoot),
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
