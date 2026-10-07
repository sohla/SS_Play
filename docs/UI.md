# The React layer

`@ss/react` owns the engine and the stores around it. `@ss/ui` is the component kit. Pages compose
them and add their own content.

```tsx
<SuperSonicProvider base={__SS_ENGINE_BASE__} synthdefs={['sonic-pi-beep']}>
  <App />
</SuperSonicProvider>
```

## The provider does not boot

An AudioContext needs a user gesture, so booting is something a button calls. A provider that
booted itself would work on a reload and fail on a fresh load — the worst kind of intermittent.

`boot()` is idempotent and concurrent-safe: two fast clicks boot one engine.

The context value is created once and never replaced, so the context itself causes no renders.
Everything that changes goes through an external store.

## Hooks

| Hook | Re-renders on | |
|---|---|---|
| `useSuperSonic()` | status changes | phase, mode, errors, `boot()`, the pre-boot probe |
| `useMetrics()` | a metric changing, ≤10 Hz | engine counters |
| `useNodeTree()` | the tree's own version moving, ≤2 Hz | the server's nodes |
| `useOscLog()` | a coalesced frame, ≤10 Hz | the tail of the OSC stream |
| `useOscTap(address, fn)` | **nothing** | raw messages, for a canvas or a ref |
| `useSession()` | nothing | the live session, for callbacks |

Each subscribes independently, so a panel that is not mounted costs no polling and no renders.

## The one rule

**No hook may call `setState` from an OSC event handler.**

`in` and `out` can run at audio rate. `useOscTap` exists for that case and re-renders nothing —
drive a canvas, write a ref, update a Web Audio param. `useOscLog` is the only hook that re-renders
on traffic, and it earns it: messages land in a preallocated ring written entirely outside React,
and the version bump is coalesced to one animation frame then throttled. A 500-message burst
produces at most two renders of one component, which `packages/react/test/stores.test.ts` asserts.

## Why the stores look the way they do

**Status** holds a frozen object and replaces it only on a real change. `useSyncExternalStore`
compares with `Object.is` and will loop forever if handed a fresh object on every read.

**Metrics** snapshots a **version number**, not the values. The poller mutates one object in place
and bumps the version only when something actually changed, so a tick that moves nothing costs no
render and no allocation. Components read the values through `metricsOf`.

**The tree** is polled because nothing announces a change, but it carries its own version counter,
so an idle page re-renders nothing even though the poll continues.

## Generated controls

`<SynthDefControls>` draws a page's whole control surface from the SynthDef's contract. **No range
is written in TypeScript.** Bounds, curve and step come from the spec the def declares, resolved to
numbers by the sidecar build:

```tsx
<SynthDefControls contract={def.contract} values={values} onChange={set} />
```

Sliders work in 0..1 and map through the spec with `mapSpec` / `unmapSpec`, which is the
normalisation worth having — a MIDI CC or a touch position feeds the same path. `isDiscrete` says
whether to draw a fader or a stepper, because SuperCollider's `Select.ar` truncates toward zero and
a fractional index silently picks the wrong branch.

Clicking the value lets you type one. A slider over an exponential range cannot be nudged to
exactly 440, and hunting for a specific cutoff by dragging is miserable. Typed values are **clamped**
to the control's range rather than refused — entering a large number means "as high as it goes" —
and Escape abandons the edit, so a half-typed number never reaches a synth that is currently
sounding.

`frozen` and `supplied` controls are listed without a fader, so it is clear why they have none
rather than looking broken. So are parameters whose range no rule recognised, marked `no range`.

The vendored defs carry no metadata, so their contracts are **inferred** from Sonic Pi's naming
conventions at build time and marked as such — the page says so above the controls. A range derived
from a convention is useful, and it is not the same thing as a range someone chose for a reason.
Parameters no rule recognised show their value with no control at all; see
[UNKNOWN-PARAMS.md](UNKNOWN-PARAMS.md).

See [SYNTHDEFS.md](SYNTHDEFS.md#the-parameter-contract) for the contract itself, and
[SIDECAR.md](SIDECAR.md) for where it comes from.

## Loading a def before playing it

Only the defs named on the provider are loaded at boot. Playing any other one gets
`/fail "SynthDef not found"`, which presents as a note that simply never sounds — so the browser
loads a def when you select it. Worth remembering for any page that picks defs at runtime.

## Components

| | |
|---|---|
| `BootGate` | the gesture, plus the degraded banner and the boot error |
| `SynthDefControls` | a control surface generated from a contract |
| `MetricsPanel` | a fixed set of engine metrics |
| `OscLog` | the tail of the OSC stream, both directions |
| `NodeTree` | the server's nodes, with a warning when the count only climbs |
| `SourceFooter` | the AGPL source link every page must carry |

`BootGate` and `SourceFooter` are in the shared kit specifically because every page needs them and
none should write them twice — the source link is a licence obligation, not decoration.

## The three shapes an instrument takes

`MotionInstrument` takes an `Instrument`, or an array of them, and there are exactly three kinds.
Which one a page needs is decided by one question — **does the pattern's shape change while it
plays?** — not by preference.

### `held`

One synth, opened at boot, played by moving its controls. No events, no allocation, no way to exhaust
`maxNodes`.

```tsx
{ kind: 'held', def: 'ssp_gendy', initial: { gate: 1, amp: 0 } }
```

Right whenever the instrument is continuous: a drone, a texture, a filter being swept. `gendy`,
`leaves` and `pluck` are this.

### `conductor`

The pattern is a **Demand graph in the server**. A clock synth runs it and reports each event with
`SendReply`; the dispatcher spawns a voice per report.

```tsx
{
  kind: 'conductor',
  clock: 'ssp_suz_clock',
  voice: 'ssp_suz',
  address: '/ssp_suz',
  controls: ([freq]) => ({ freq: freq ?? 440 }),
  sustainS: ([, dur]) => dur,
}
```

`controls` and `sustainS` both read the `SendReply` arguments, so the clock decides the note *and*
how long to hold it — the values arrive together and cannot disagree.

Keeps perfect time, because it *is* the audio clock — a JavaScript timer's jitter cannot reach it.
Right for a fixed sequence. `suz`, `beast` and `moog` are this.

Two things it cannot do: allocate a node (hence the report-and-spawn), and read a value that changes
the pattern's *structure*. And a clock must send a sustain time for every event, because an `adsr`
only frees when its gate falls — without it every note holds a node forever, which surfaces as
`maxNodes` exhaustion partway through a performance.

### `client`

The pattern runs in **JavaScript** and each event is scheduled ahead with an OSC bundle timetag.

```tsx
{ kind: 'client', nextEvent }
```

Slower to reason about, and the only option when the pattern's shape changes at runtime. The case
that forces it is `Pswitch(list, Pkey(\divIdx))`: three streams switching on one live index, which
have to agree about which bar they are in. As three independent Demand streams reading the same bus
they drift apart on any bar where the hand moved; here it is one counter and a lookup.

Timing is bought back with timetags rather than lost: a bundle asked for 400ms ahead sounds 400ms
ahead. The timer decides *when to post*, never when to play. The lookahead — 120ms — is the one
number that matters: too short and a stalled main thread leaves a gap, too long and the phone's
movement stops reaching the sound because events are already committed.

`multibeat`, `trainmelody`, `kit`, `piano`, `dulcimer` and `marimba` are this.

### Mixing them

A page may use several — `multibeat` is a `client` sequence over a `held` drone. The shell starts and
stops `client` conductors from the mapped level; `held` voices get every control continuously; and
`conductor` clocks get `dur` and `level`.

### Pages that are none of these

`droplet`, `imu`, `touch`, `playground` and `sample` do not use `MotionInstrument` at all. The first
two predate it and roll the shell by hand; the last three are genuinely different — a multitouch
surface, a def browser, and a loader.

`droplet` is worth knowing about because it is `conductor`-shaped and hand-rolled: its own `Shower`
class drives a Demand clock and spawns voices, written before `Conductor` existed. It also picks its
own private bus — `FX_BUS = 8`, with a comment reasoning about headroom — where `dulcimer` uses
`session.firstPrivateBus`, which resolves to 4. Two answers to one question in the same codebase,
which is the kind of drift this project usually keeps in a single file. Both work; neither is wrong;
they should be the same thing.

### Bar-scoped and event-scoped

Porting a `Pbind` to a `client` conductor means knowing which keys move per bar and which per note,
and getting it backwards is audible without looking like a bug:

- **`Pswitch(…, Pkey(\divIdx))` is bar-scoped.** It embeds a whole sub-pattern before re-reading the
  index, so a subdivision change lands on the beat rather than halfway through one.
- **Every other Pbind key is event-scoped.** A Pbind advances all of its streams once per event. So
  `\octave, Pseq([4, 3, 2].stutter(2), inf)` moves on every *note* — at six steps a single bar walks
  all three octaves.

The `dulcimer` shipped with the second one wrong, holding an octave per bar. Both it and `marimba`
now have unit tests pinning it.
