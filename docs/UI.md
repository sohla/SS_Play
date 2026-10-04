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

`frozen` and `supplied` controls are listed without a fader, so it is clear why they have none
rather than looking broken.

A def with **no** contract — any of the 131 vendored ones — shows its names and defaults, read out
of the compiled binary by the parser, and says plainly that it has no ranges. Inventing bounds
would be worse than showing none, and the contrast is the argument for the contract made visible.

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
