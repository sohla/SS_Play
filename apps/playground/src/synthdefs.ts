import { parseSynthDefFile, type SynthDefContract, type SynthDefParam } from '@ss/engine'

export interface VendorManifest {
  /** Every def staged into this app. */
  synthdefs: string[]
  /** Authored here, so their contracts are declared rather than inferred. */
  authored: string[]
  /** Vendored, with a contract inferred from naming conventions. */
  inferred: string[]
  samples: string[]
}

export interface LoadedDef {
  name: string
  params: SynthDefParam[]
  ugens: string[]
  /** Declared for authored defs, inferred for vendored ones. */
  contract: SynthDefContract | null
}

const base = __SS_ENGINE_BASE__

export async function fetchManifest(): Promise<VendorManifest> {
  const response = await fetch(`${base}manifest.json`)
  if (!response.ok) throw new Error(`manifest.json: HTTP ${response.status}`)
  return (await response.json()) as VendorManifest
}

/**
 * Read a def's parameters straight out of its compiled binary.
 *
 * Works for every def, including the 131 vendored ones that carry no contract —
 * the names and defaults are in the file itself. What the binary cannot tell
 * you is a *range*, which is exactly what the contract adds.
 */
export async function fetchDef(name: string): Promise<LoadedDef> {
  const binary = await fetch(`${base}synthdefs/${name}.scsyndef`)
  if (!binary.ok) throw new Error(`${name}.scsyndef: HTTP ${binary.status}`)

  const parsed = parseSynthDefFile(new Uint8Array(await binary.arrayBuffer()))
  const def = parsed.defs[0]
  if (!def) throw new Error(`${name}.scsyndef declares no SynthDef`)

  // Every def staged into the app has a contract now: authored ones declare
  // theirs, vendored ones get one inferred at build time.
  let contract: SynthDefContract | null = null
  const response = await fetch(`${base}synthdefs/${name}.contract.json`)
  if (response.ok) contract = (await response.json()) as SynthDefContract

  return {
    name: def.name,
    params: def.params,
    ugens: [...new Set(def.ugens.map((u) => u.className))].sort(),
    contract,
  }
}
