import { parseSynthDefFile, type SynthDefContract, type SynthDefParam } from '@ss/engine'

export interface VendorManifest {
  /** Every def staged into this app. */
  synthdefs: string[]
  /** The subset authored here, which are the ones carrying a contract. */
  authored: string[]
  samples: string[]
}

export interface LoadedDef {
  name: string
  params: SynthDefParam[]
  ugens: string[]
  /** Only authored defs declare one. */
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
export async function fetchDef(name: string, authored: boolean): Promise<LoadedDef> {
  const binary = await fetch(`${base}synthdefs/${name}.scsyndef`)
  if (!binary.ok) throw new Error(`${name}.scsyndef: HTTP ${binary.status}`)

  const parsed = parseSynthDefFile(new Uint8Array(await binary.arrayBuffer()))
  const def = parsed.defs[0]
  if (!def) throw new Error(`${name}.scsyndef declares no SynthDef`)

  let contract: SynthDefContract | null = null
  if (authored) {
    const response = await fetch(`${base}synthdefs/${name}.contract.json`)
    if (response.ok) contract = (await response.json()) as SynthDefContract
  }

  return {
    name: def.name,
    params: def.params,
    ugens: [...new Set(def.ugens.map((u) => u.className))].sort(),
    contract,
  }
}
