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
| `Plotter` | AirKit's scrolling plot: fifty frames of a page's `~plot`, every series overlaid |
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

`multibeat`, `trainmelody`, `kit`, `piano`, `dulcimer`, `marimba` and `combo` are this.

### Mixing them

A page may use several — `multibeat` is a `client` sequence over a `held` drone. The shell starts and
stops `client` conductors from the mapped level; `held` voices get every control continuously; and
`conductor` clocks get `dur` and `level`.

`combo` is three `client` sequences on one two-second bar, and **that single level test is what keeps
them in phase**: every `client` instrument is started and stopped together, so three independent
schedulers begin on the same tick. After that it is arithmetic — each layer's step divides the bar
and the others (kit at 2, 4 or 8 per bar, bass at 1 or 2, melody at 4 or 8, all powers of two off
2.0s), so nothing drifts. `tests/e2e/combo.spec.ts` asserts the division rather than trusting it.
Three schedulers that merely *started* together would be three machines within a minute.

### Pages that are none of these

`droplet`, `imu`, `touch`, `playground` and `sample` do not use `MotionInstrument` at all. The first
two predate it and roll the shell by hand; the last three are genuinely different — a multitouch
surface, a def browser, and a loader.

`droplet` and `imu` **do** now carry the plotter, sensitivity and the palette — wired by hand into
their own shells rather than inherited. They are the two places where any change to the shell has to
be made twice, which is the cost of their predating it.

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

## The plotter

A port of AirKit's `code3.0/plotterView.scd`. Fifty frames of history, newest on the right, every
series overlaid on one set of axes — `superpose = true` in the original — sampled at **33Hz**,
because AirKit yields `0.03` between frames with the comment *"this has a big impact on CPU use"*.
That rate is a measured choice there, so it is kept here. Fifty frames at 33Hz is about a second and
a half of history, which is what gives the traces their shape.

A page opts in by passing `plot`:

```tsx
<MotionInstrument
  plot={plotOf}               // (motion, sensitivity) => number[]
  plotMin={-1} plotMax={1}    // ~plotMin / ~plotMax
  plotLabels={PLOT_LABELS}    // what each series is, in colour order
  …
/>
```

**Why this readout and not a row of bars.** The values are whatever the page's `~plot` returns — the
numbers the mapping actually feeds its curves, not the raw sensor angles. A gesture that does nothing
is visible here and invisible in the angles. And a single position cannot show it: the plot is the
difference between *that number is 0.3* and *that number has been 0.3 for a second and a half no
matter what I do*.

`plot` is **polled by the plotter at frame rate**, so it must be cheap and must not touch React.
Canvas, and no React state at all — 33 `setState`s a second is precisely what [the one
rule](#the-one-rule) forbids. The ring buffer is written and the canvas drawn inside one interval;
the component renders once.

Three details that are ported rather than chosen:

- **The colour order is load-bearing.** `[yellow, magenta, cyan, red, green, blue]`. Every p-file
  carries a `// [yellow, magenta, cyan]` comment above its `~plot` body naming which expression is
  which colour — change the order and a decade of those comments becomes wrong.
  `tests/e2e/plotter.spec.ts` reads the colours back **off the canvas**, because a class Tailwind
  never generated still looks right in the markup.
- **Idle draws a flat line, not a frozen one**, matching AirKit's `plotter.value = [0]!50` for a
  disabled device. A plot holding its last shape looks like a live instrument that has stopped
  responding. Idle applies only before any sensor has spoken; a plot that keeps moving while nothing
  sounds is worth having, because it is how you find the threshold.
- **A `~plot` body that throws does not take the page with it**, and a changing series count between
  frames is tolerated. Being edited while running is the normal case for one of these.

AirKit has no legend — the colour order lives in a comment and you learn it. `plotLabels` exists
because on a page someone opens once, a legend is the difference between a plot that means something
and three wiggling lines. The labels come from the p-files' own colour comments.

### `shakeRaw` and `turnRaw` exist only to be plotted

`@ss/motion` reports `shake`/`turn` filtered and `shakeRaw`/`turnRaw` unfiltered. **Nothing maps from
the raw pair.** They are there because `[accelMass, accelMassFiltered]` is the commonest `~plot` body
in the personalities, and the pair *is* the diagnostic: the raw trace is what the hand did, the
filtered one is what the instrument heard, and the distance between them is the envelope's attack and
decay made visible. Either trace alone tells you neither.

### `Trace` is superseded, not removed

`Mapped.traces` draws the same values as single positions. Kept because the two pages without
`MotionInstrument` still render them, and because a page mid-port may have traces and no `plot` yet.
Given a `plot`, the shell shows the plotter *instead of* the bars — except on `imu`, which shows
both: seven mappings against six colours, and the bars name which axis drives what where a
three-item legend cannot.

## Sensitivity

AirKit's device param, 0..1, default **0.5**, and `map` now takes it as a second argument:

```tsx
map(motion: Motion, sensitivity: number): Mapped
```

In the personalities that read it, it scales a curve's *input span* — `lincurve(v, 0, 2.5 * sens, …)`
— which is the same function as scaling the input. So it is applied as **one line per mapping**, at
the point the reading is already being scaled to AirKit's range, rather than one change per curve.

**The factor is `0.5 / sens`, not `1 / sens`, and the test suite is why.** With the plain division
shipped first, AirKit's 0.5 default made every page twice as hot as the thing it was ported from, and
two gentle-versus-hard tests failed because the gentle gesture already saturated. The bounds in these
mappings came from personalities that have no `sens` at all, so those bounds *are* already the
effective ones — which makes 0.5 the neutral point by construction. Default behaviour is now
identical to before the port, with AirKit's range and direction.

**The word and the number point opposite ways.** A *smaller* value shrinks the span, so the
instrument saturates with less movement. That is AirKit's direction and it is kept rather than
quietly inverted: a value that means the same thing on both rigs is more use than one that reads
better on this one. The label says `AirKit's number: lower saturates sooner`.

The slider writes **a ref before it writes state**, because the 30Hz OSC loop reads the ref and must
not wait for a render to see a change.

### Where it may and may not be applied

Only on a **unipolar** span, because that is the only thing AirKit ever scales —
`lincurve(v, 0, TOP * sens, …)` starts at zero. Scaling a bipolar span has no obvious meaning, and
the hand-wired cases on `droplet` and `imu` are each a different shape:

| input | treatment | why |
|---|---|---|
| `shake`, a flick | scaled directly | genuinely 0..1 from zero |
| `roll`/`pitch` through `unipolar()`, centre at 0.5 | the **deviation from centre** is scaled | otherwise a flat phone stops reading mid-range, and the drone detunes itself when you put it down |
| absolute orientation on `droplet` | left alone | thirty degrees of tilt is thirty degrees whatever the knob says |
| `yaw`, a compass bearing | **skipped**, and the page says so | it wraps; sensitivity has no meaning on it |

`pluck` is the one page that keeps a direct multiply, because `pluck1.sc` really does have
`2.5 * sens` — one of only four personalities that reads the param at all. Its two inverted uses are
ported too. Everywhere else the control is an addition, applied where AirKit applies it in the files
that have it, and marked as such in the mapping.

## The AirKit palette

Taken from `code3.0/`: 28 uses of `Color.black`, 12 of `Color.yellow`, 12 of `Color.white`, 6 each of
`Color.grey` and `Color.gray(0.5)`. Black panels, grey labels, yellow as the one accent. **No blues**
— the sky tones the rest of this site uses are not in AirKit anywhere.

| utility | |
|---|---|
| `ak` | the scope: sets `--ak-*` and the page's background and text |
| `ak-panel` | black panel on a `--ak-line` border |
| `ak-label` | grey, for labels and secondary text |
| `ak-accent` | `#ffff00`, for values |
| `ak-live` | the sounding state, where this site previously used sky |

**Scoped to a class rather than changed in `@theme`**, because the landing page, the def browser and
the touch surface are not AirKit and should not become it. A page opts in by being a
`MotionInstrument`.

Yellow is `#ffff00` rather than an amber for two reasons: `Color.yellow` in SuperCollider is pure,
and against pure black an amber reads as brown — and it is also the plotter's first trace colour, so
the accent and the first series match by construction rather than by coincidence.

The `ss-waiting` loading stripes were a desaturated yellow at 8% alpha, which on the near-black
background read as grey rather than as yellow; they are `#ffff00` at 26% now. **Hardcoded rather than
`var(--ak-accent)`**, because that utility should not depend on being inside an `ak` scope — the
pending panel uses it, and a non-AirKit page could want it too.

> A selector that depends on the palette breaks every time the palette does. `imu.spec.ts` was
> picking a bar marker by `.bg-emerald-400` and this change would have broken it; it uses a
> `data-testid` now.
