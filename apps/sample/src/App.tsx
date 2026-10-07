import { useCallback, useEffect, useRef, useState } from 'react'
import { ctl, i, initialValues, type Session, type SynthDefContract } from '@ss/engine'
import { useSession, useSuperSonic } from '@ss/react'
import { BootGate, EngineFooter, PageHeader, SynthDefControls } from '@ss/ui'
import { BUILTIN, readStore, sizeOf, type Sample } from './samples.ts'

const DEF = 'ssp_loop'

interface Loaded {
  sample: Sample
  bufnum: number
  frames: number
  channels: number
  sampleRate: number
}

export function App() {
  const { status, boot, probe } = useSuperSonic()
  const session = useSession()

  const [samples, setSamples] = useState<Sample[]>([BUILTIN])
  const [storeReachable, setStoreReachable] = useState<boolean | null>(null)
  const [chosen, setChosen] = useState<Sample>(BUILTIN)

  const [contract, setContract] = useState<SynthDefContract | null>(null)
  const [values, setValues] = useState<Record<string, number>>({})

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The sounding node, in a ref rather than state: it is an identifier to send
  // to, not something the view renders, and a re-render per /n_set would be a
  // re-render per slider frame.
  const node = useRef<number | null>(null)
  // Claimed once and reused. See the note in load() for why this matters more
  // than it looks like it should.
  const buffer = useRef<number | null>(null)
  const [playing, setPlaying] = useState(false)

  const booted = status.phase === 'ready' || status.phase === 'degraded'

  // The store, read once. Not gated on boot: what is available to load is a
  // property of the server, and showing it before the engine starts is the
  // difference between an empty page and one you can read.
  useEffect(() => {
    let cancelled = false
    readStore()
      .then(({ samples: found, reachable }) => {
        if (cancelled) return
        setStoreReachable(reachable)
        setSamples([...found, BUILTIN])
      })
      .catch(() => {
        if (!cancelled) setStoreReachable(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The control surface comes from the def's own contract, so no range for rate,
  // cutoff or release is written in this file.
  useEffect(() => {
    let cancelled = false
    fetch(`vendor/supersonic/synthdefs/${DEF}.contract.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: SynthDefContract | null) => {
        if (cancelled || !body) return
        setContract(body)
        setValues(initialValues(body))
      })
      .catch(() => {
        // A page that cannot read the contract can still load and loop; it just
        // gets no sliders. Not worth an error banner.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const stop = useCallback(
    (live: Session) => {
      if (node.current === null) return
      live.sonic.send('/n_set', node.current, 'gate', i(0))
      node.current = null
      setPlaying(false)
    },
    [],
  )

  const load = useCallback(async () => {
    if (!session || working) return
    setWorking(true)
    setError(null)
    try {
      stop(session)

      // One buffer, reused for every load.
      //
      // Buffer *numbers* are cheap — there are 1024 — but the memory behind one
      // is not, and none of it ever comes back. Measured on this page: loading a
      // 44MB stereo file costs about 180MB of browser memory into a fresh
      // buffer and about 68MB into one already used, and neither `/b_free` nor
      // overwriting the buffer returns a single byte. Four loads into four
      // buffers reached 797MB; four into one reached 349MB.
      //
      // So reuse is not a tidiness preference, it is the difference between a
      // page you can audition a few samples on and one that is killed on the
      // third. The voice is stopped above, which is what makes overwriting safe
      // — loading over a buffer a synth is still reading gives a click or
      // silence depending on timing.
      const bufnum = buffer.current ?? session.buffers.alloc()
      buffer.current = bufnum
      const result = await session.sonic.loadSample(bufnum, chosen.url)

      setLoaded({
        sample: chosen,
        bufnum,
        frames: result.numFrames ?? 0,
        channels: result.numChannels ?? 0,
        sampleRate: result.sampleRate ?? 0,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setLoaded(null)
    } finally {
      setWorking(false)
    }
  }, [session, chosen, working, stop])

  const play = useCallback(() => {
    if (!session || !loaded) return
    stop(session)

    const id = session.sonic.nextNodeId()
    session.sonic.send(
      '/s_new',
      DEF,
      i(id),
      i(0),
      i(0),
      ...ctl({ ...values, bufnum: i(loaded.bufnum) }),
    )
    node.current = id
    setPlaying(true)
  }, [session, loaded, values, stop])

  // Moving a slider while it loops reaches the sounding node, which is the
  // whole point of a held voice: no restart, no click, no re-trigger.
  const change = useCallback(
    (name: string, value: number) => {
      setValues((previous) => ({ ...previous, [name]: value }))
      if (session && node.current !== null) {
        session.sonic.send('/n_set', node.current, ...ctl({ [name]: value }))
      }
    },
    [session],
  )

  // Leaving the page with a loop running would otherwise keep it running: a
  // looping PlayBuf has no doneAction and nothing else ever frees it.
  useEffect(() => {
    if (!session) return
    return () => stop(session)
  }, [session, stop])

  const seconds = loaded && loaded.sampleRate > 0 ? loaded.frames / loaded.sampleRate : 0

  return (
    <main className="flex min-h-dvh flex-col bg-canvas text-neutral-200">
      <PageHeader title="sample" />

      <div className="pad-safe-x mx-auto flex w-full max-w-md flex-1 flex-col gap-5 pt-6">
        <p className="text-sm text-neutral-500">
          Load an audio file into a buffer and loop it. Rate is a multiplier, so 0.5 is an octave
          down and a negative value runs it backwards. Every control reaches the loop while it
          sounds.
        </p>

        <BootGate
          phase={status.phase}
          error={status.error}
          degradedReason={status.degradedReason}
          sabUnavailable={probe.sabUnavailable}
          onBoot={boot}
        />

        {storeReachable === false ? (
          <p className="rounded border border-neutral-800 bg-surface p-3 text-sm text-neutral-500">
            No sample store is being served, so only the built-in is listed. Put audio in the store
            and run <code className="text-neutral-400">npm run samples -- --yes</code>.
          </p>
        ) : null}

        {storeReachable === true && samples.length === 1 ? (
          <p className="rounded border border-neutral-800 bg-surface p-3 text-sm text-neutral-500">
            The store is being served and is empty. Only the built-in is listed.
          </p>
        ) : null}

        {booted ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-xs text-neutral-500">sample</span>
              <select
                data-testid="sample-select"
                className="min-w-0 rounded border border-neutral-800 bg-surface px-3 py-3 font-mono text-sm text-neutral-200"
                value={chosen.url}
                onChange={(event) => {
                  const next = samples.find((one) => one.url === event.target.value)
                  if (next) setChosen(next)
                }}
              >
                {samples.map((one) => (
                  <option key={one.url} value={one.url}>
                    {one.label} — {sizeOf(one.bytes)}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                data-testid="load"
                className="min-h-11 flex-1 rounded border border-neutral-700 bg-surface px-3 text-sm text-neutral-200 disabled:opacity-40"
                onClick={() => void load()}
                disabled={working}
              >
                {working ? 'loading…' : 'load'}
              </button>
              <button
                type="button"
                data-testid="play"
                className="min-h-11 flex-1 rounded border border-sky-800 bg-sky-950/40 px-3 text-sm text-sky-300 disabled:opacity-40"
                onClick={play}
                disabled={!loaded || playing}
              >
                loop
              </button>
              <button
                type="button"
                data-testid="stop"
                className="min-h-11 flex-1 rounded border border-neutral-700 bg-surface px-3 text-sm text-neutral-200 disabled:opacity-40"
                onClick={() => session && stop(session)}
                disabled={!playing}
              >
                stop
              </button>
            </div>

            {error ? (
              <p
                data-testid="sample-error"
                className="rounded border border-red-900 bg-red-950/40 p-3 font-mono text-xs text-red-300"
              >
                {error}
              </p>
            ) : null}

            <div
              data-testid="buffer"
              className={`rounded border p-3 font-mono text-xs ${
                playing
                  ? 'border-sky-900 bg-sky-950/30 text-sky-300'
                  : 'border-neutral-800 bg-surface text-neutral-600'
              }`}
            >
              {loaded
                ? `buf ${loaded.bufnum} · ${seconds.toFixed(2)}s · ${loaded.channels}ch · ${(
                    loaded.sampleRate / 1000
                  ).toFixed(1)}kHz${playing ? ' · looping' : ''}`
                : 'nothing loaded'}
            </div>

            {contract ? (
              <SynthDefControls contract={contract} values={values} onChange={change} />
            ) : null}
          </>
        ) : null}

        <div className="mt-auto" />
      </div>

      {booted ? <EngineFooter /> : null}
    </main>
  )
}
