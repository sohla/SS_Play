import { useCallback, useEffect, useState } from 'react'
import { initialValues, loadSynthDefsChecked, type Session } from '@ss/engine'
import { SynthDefControls } from '@ss/ui'
import { fetchDef, type LoadedDef, type VendorManifest } from './synthdefs.ts'
import { playNote } from './play.ts'

export interface SynthDefBrowserProps {
  manifest: VendorManifest
  session: Session | null
}

export function SynthDefBrowser({ manifest, session }: SynthDefBrowserProps) {
  const [name, setName] = useState(manifest.authored[0] ?? manifest.synthdefs[0] ?? '')
  const [def, setDef] = useState<LoadedDef | null>(null)
  const [values, setValues] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [sounding, setSounding] = useState(false)

  useEffect(() => {
    if (!name) return
    let cancelled = false

    setDef(null)
    setError(null)

    const load = async () => {
      const loaded = await fetchDef(name)

      // Send it to the engine as well as reading it here. Only the defs named
      // at boot are loaded, so playing any other one would get a /fail
      // "SynthDef not found" that surfaces as a note that simply never sounds.
      if (session) await loadSynthDefsChecked(session.sonic as never, [name])

      if (cancelled) return
      setDef(loaded)
      setValues(
        loaded.contract
          ? initialValues(loaded.contract)
          : Object.fromEntries(loaded.params.map((p) => [p.name, p.default])),
      )
    }

    load().catch((cause: Error) => {
      if (!cancelled) setError(cause.message)
    })

    return () => {
      cancelled = true
    }
  }, [name, manifest.authored, session])

  const play = useCallback(async () => {
    if (!session || !def || sounding) return
    setSounding(true)
    try {
      await playNote(session, {
        name: def.name,
        values,
        gated: def.params.some((p) => p.name === 'gate'),
      })
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setSounding(false)
    }
  }, [def, session, sounding, values])

  const change = useCallback((control: string, value: number) => {
    setValues((previous) => ({ ...previous, [control]: value }))
  }, [])

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <select
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs"
        >
          <optgroup label={`authored (${manifest.authored.length})`}>
            {manifest.authored.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </optgroup>
          <optgroup label={`vendored (${manifest.synthdefs.length - manifest.authored.length})`}>
            {manifest.synthdefs
              .filter((entry) => !manifest.authored.includes(entry))
              .map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
          </optgroup>
        </select>

        <button
          type="button"
          onClick={play}
          disabled={!session || !def || sounding}
          className="rounded border border-emerald-700 bg-emerald-950 px-3 py-1 text-xs text-emerald-200 hover:border-emerald-500 disabled:opacity-40"
        >
          {sounding ? 'sounding…' : 'play'}
        </button>

        {def ? (
          <span className="font-mono text-xs text-neutral-600">
            {def.params.length} params · {def.ugens.length} ugen classes
          </span>
        ) : null}
      </div>

      {error ? <p className="text-xs text-rose-300">{error}</p> : null}

      {def?.contract ? (
        <>
          {def.contract.source === 'inferred' ? (
            <p className="text-xs text-amber-500/80">
              Ranges inferred from Sonic Pi's naming conventions, not declared by the def. Controls
              marked <span className="italic">no range</span> had no rule that recognised them.
            </p>
          ) : null}
          <SynthDefControls contract={def.contract} values={values} onChange={change} />
        </>
      ) : def ? (
        <ParamsWithoutRanges def={def} />
      ) : null}
    </section>
  )
}

/**
 * A def with no contract still has names and defaults in its binary — but no
 * ranges, so there is nothing honest to draw a fader against. Showing the
 * values rather than inventing bounds is the whole argument for the contract,
 * made visible.
 */
function ParamsWithoutRanges({ def }: { def: LoadedDef }) {
  return (
    <div className="flex flex-col">
      <p className="pb-2 text-xs text-neutral-500">
        No parameter contract — this def is vendored, not authored here. Names and defaults come
        from the compiled binary; ranges would have to be guessed, so there are no sliders.
      </p>
      <div className="grid max-h-64 grid-cols-2 gap-x-6 overflow-y-auto">
        {def.params.map((param) => (
          <div key={param.name} className="flex justify-between border-b border-neutral-900 py-0.5">
            <span className="font-mono text-xs text-neutral-400">{param.name}</span>
            <span className="font-mono text-xs text-neutral-500">{param.default}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
