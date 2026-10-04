import { createRequire } from 'node:module'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { parseSynthDefFile } from '@ss/engine/scsyndef'
import type { Plugin } from 'vite'
import { inferContract } from './infer-contract.ts'

/** Path under an app's public/ that the engine is staged into. */
export const VENDOR_DIR = 'vendor/supersonic'

const require = createRequire(import.meta.url)

/**
 * Locate an installed package's root directory.
 *
 * `require.resolve('<pkg>/package.json')` is the obvious way and fails for
 * supersonic-scsynth, whose `exports` map does not list package.json — the same
 * restriction that hides its typings. Fall back to resolving the entry point
 * and walking up to the directory that owns it.
 */
function packageRoot(name: string): string {
  try {
    return dirname(require.resolve(`${name}/package.json`))
  } catch {
    let dir = dirname(require.resolve(name))
    for (let depth = 0; depth < 5; depth++) {
      if (existsSync(join(dir, 'package.json'))) return dir
      dir = dirname(dir)
    }
    throw new Error(`Could not locate the package root for "${name}"`)
  }
}

export interface StageVendorOptions {
  /** The app directory, e.g. apps/playground. */
  appDir: string
  /**
   * Logical SynthDef names this page loads, without the .scsyndef suffix.
   * `'all'` stages the whole vendored library — 131 defs at ~656KB, which is
   * small enough to be worth it for a page that browses them.
   */
  synthdefs?: string[] | 'all'
  /** Sample filenames this page loads, with extension. */
  samples?: string[]
}

export interface StageVendorResult {
  dir: string
  synthdefs: string[]
  samples: string[]
}

/**
 * Stage the engine runtime into the app's public directory.
 *
 * The layout matters: SuperSonic resolves SynthDef names against
 * `synthdefBaseURL`, which `resolveEngineUrls` derives as `<base>synthdefs/`.
 * Putting them anywhere else fails with an opaque exception rather than a 404.
 *
 * The AGPL core is copied rather than imported, so it is never bundled — both
 * because the worklet has to be fetched as a separate file, and to keep the
 * licence boundary visible. Both LICENSE files travel with it.
 */
export function stageVendor(options: StageVendorOptions): StageVendorResult {
  const { appDir, samples = [] } = options

  const synthdefSource = join(packageRoot('supersonic-scsynth-synthdefs'), 'synthdefs')
  const synthdefs =
    options.synthdefs === 'all'
      ? readdirSync(synthdefSource)
          .filter((name) => name.endsWith('.scsyndef'))
          .map((name) => name.replace(/\.scsyndef$/, ''))
          .sort()
      : (options.synthdefs ?? [])

  const core = packageRoot('supersonic-scsynth-core')
  const client = packageRoot('supersonic-scsynth')
  const target = join(appDir, 'public', VENDOR_DIR)

  rmSync(target, { recursive: true, force: true })
  mkdirSync(join(target, 'workers'), { recursive: true })

  // wasm/ and the worklet come from the core package.
  cpSync(join(core, 'wasm'), join(target, 'wasm'), { recursive: true })
  cpSync(
    join(core, 'workers', 'clockwork_audio_worklet.js'),
    join(target, 'workers', 'clockwork_audio_worklet.js'),
  )

  // The two SAB-mode workers come from the client package.
  for (const worker of ['osc_in_worker.js', 'osc_out_log_sab_worker.js']) {
    cpSync(join(client, 'dist', 'workers', worker), join(target, 'workers', worker))
  }

  cpSync(join(core, 'LICENSE'), join(target, 'LICENSE-supersonic-scsynth-core'))
  cpSync(join(client, 'LICENSE'), join(target, 'LICENSE-supersonic-scsynth'))

  // copyNamed deals in filenames; the manifest deals in logical names, because
  // that is what loadSynthDef and the page's URLs use. Mixing the two produced
  // `<name>.scsyndef.scsyndef` requests.
  copyNamed({
    from: synthdefSource,
    to: join(target, 'synthdefs'),
    names: synthdefs.map((name) => `${name}.scsyndef`),
    kind: 'SynthDef',
  })

  // The sidecar's own defs ship alongside the vendored library, with their
  // parameter contracts. Those contracts are what let a page build its control
  // surface without anyone writing a range in TypeScript.
  const sidecarDist = join(appDir, '..', '..', 'sidecar', 'dist')
  const authored: string[] = []

  if (existsSync(sidecarDist)) {
    mkdirSync(join(target, 'synthdefs'), { recursive: true })
    for (const file of readdirSync(sidecarDist)) {
      if (!file.endsWith('.scsyndef') && !file.endsWith('.contract.json')) continue
      cpSync(join(sidecarDist, file), join(target, 'synthdefs', file))
      if (file.endsWith('.scsyndef')) authored.push(file.replace(/\.scsyndef$/, ''))
    }
  }

  const stagedSamples =
    samples.length === 0
      ? []
      : copyNamed({
          from: join(packageRoot('supersonic-scsynth-samples'), 'samples'),
          to: join(target, 'samples'),
          names: samples,
          kind: 'sample',
        })

  // Every def the browser can select needs a contract, or it gets no controls.
  // Authored defs bring their own; the vendored ones get one inferred from
  // Sonic Pi's naming conventions, clearly marked as such.
  const inferred = inferContracts(join(target, 'synthdefs'), authored)

  writeFileSync(
    join(target, 'manifest.json'),
    `${JSON.stringify(
      {
        synthdefs: [...synthdefs, ...authored].sort(),
        authored: authored.sort(),
        inferred: inferred.sort(),
        samples,
      },
      null,
      2,
    )}\n`,
  )

  return {
    dir: target,
    synthdefs: [...synthdefs, ...authored],
    samples: stagedSamples,
  }
}

/**
 * Write a contract beside every vendored def that has none.
 *
 * Skips anything that fails to parse: the corrupt `sonic-pi-mixout` is already
 * pinned by the parser tests, and a contract for a file the engine cannot load
 * would be a control surface for something unplayable.
 */
function inferContracts(synthdefDir: string, authored: string[]): string[] {
  if (!existsSync(synthdefDir)) return []
  const written: string[] = []

  for (const file of readdirSync(synthdefDir)) {
    if (!file.endsWith('.scsyndef')) continue
    const name = file.replace(/\.scsyndef$/, '')
    if (authored.includes(name)) continue

    let params
    try {
      params = parseSynthDefFile(new Uint8Array(readFileSync(join(synthdefDir, file)))).defs[0]
        ?.params
    } catch {
      continue
    }
    if (!params) continue

    writeFileSync(
      join(synthdefDir, `${name}.contract.json`),
      `${JSON.stringify(inferContract(params, name), null, 2)}\n`,
    )
    written.push(name)
  }

  return written
}

function copyNamed(options: { from: string; to: string; names: string[]; kind: string }): string[] {
  const { from, to, names, kind } = options
  if (names.length === 0) return []

  mkdirSync(to, { recursive: true })
  const missing: string[] = []

  for (const name of names) {
    const source = join(from, name)
    if (!existsSync(source)) {
      missing.push(name)
      continue
    }
    cpSync(source, join(to, name))
  }

  if (missing.length > 0) {
    // Fail at build time rather than letting the page fetch a 404 and report
    // it as an opaque load error at runtime.
    throw new Error(
      `${kind}${missing.length === 1 ? '' : 's'} not found in ${from}:\n` +
        missing.map((name) => `  ${name}`).join('\n'),
    )
  }

  return names
}

/** Stages the vendor tree before dev and build, so it is never stale. */
export function vendorPlugin(options: StageVendorOptions): Plugin {
  return {
    name: 'ss-vendor',
    buildStart() {
      const result = stageVendor(options)
      this.info?.(
        `staged engine + ${result.synthdefs.length} synthdef(s) + ` +
          `${result.samples.length} sample(s) into ${VENDOR_DIR}`,
      )
    },
  }
}
