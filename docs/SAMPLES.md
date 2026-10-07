# Samples

Audio is **not in the repo**. It is not source, it is large, and a file
committed once stays in the history for good. So it lives in a store outside the
checkout and is pushed to the VM by its own command.

## The store

A flat directory, by default a sibling of the repo:

```
~/Develop/SuperCollider/Projects/SS_Play-samples/
```

Point somewhere else with `SS_SAMPLES_DIR`, or `--from`:

```sh
SS_SAMPLES_DIR=/path/to/audio npm run samples
```

Flat, not nested. A sample's URL is `/samples/<filename>`, so a subdirectory
would put the store's own layout into every page's URLs — which works, and
quietly makes a local organising decision part of the site's public shape.

`wav flac mp3 ogg m4a opus` are sent; everything else is listed and left behind.
**aiff is the one that catches people**: SuperCollider reads it happily and
Chrome does not, so an aiff in the store is named as unsendable rather than
uploaded to fail at decode time.

## Pushing

```sh
npm run samples              # list what would go, send nothing
npm run samples -- --yes     # push
```

It **mirrors**: deleting a file locally removes it from the site on the next
push. That is what makes the local directory the source of truth rather than an
append-only pile nobody can prune.

After the files land it writes `/samples/index.json` from the server's own
directory listing — not from what was meant to be sent — so the index can never
describe a file that failed to transfer. Then it fetches one sample over https
and checks the status, because a file present on disk and unreachable over the
web is the failure worth catching.

## Where it lands

```
/srv/ssplay/samples/          ← the store, shared
/srv/ssplay/playground/<ts>/  ← a release
```

**Outside the release tree, deliberately.** Samples survive every deploy, are
never re-sent as part of one, and are not pruned when old releases are. A
release carrying a copy of audio that can run to hundreds of megabytes would be
hundreds of megabytes per release, three deep.

That is also why it is a separate command: the two things change on completely
different schedules.

Caddy serves it from a second root in the same site block, via `handle_path`,
which strips the prefix so `/samples/foo.wav` reads `foo.wav` from the store
root. **Same origin, deliberately** — a separate subdomain would drag in CORS,
CORP and a second certificate, and would make every sample a cross-origin
subresource under `COEP: require-corp`, which is the one thing this site's
isolation cannot tolerate.

Cached with `no-cache`, not `immutable`. The names are stable and the bytes
behind them are not: replacing a file and keeping its name is the entire point
of a store you push to, and an immutable header would leave a visitor hearing
last week's audio with no way to discover it.

Locally, `tools/serve.mjs` serves the same URL from the same store and
synthesises `index.json` per request, so the page behaves identically and the
e2e suite exercises the real URL shape rather than a fixture. A missing store is
normal, not an error — the index answers as an empty list.

## Loading one

`loadSample(bufnum, source)`, and the resolution rule is worth knowing because
getting it wrong produces a 404 at a URL with the base in it **twice**:

| source | resolved as |
|---|---|
| `/samples/x.wav` | used as given |
| `./x.wav` | used as given |
| `x.wav` | joined to `sampleBaseURL` → `<page>/vendor/supersonic/samples/x.wav` |

So store samples are absolute and a page's own staged samples are bare
filenames. The rule in the library is literally
`source.startsWith('/') || source.startsWith('./')`, which is narrower than
"contains a slash" — `vendor/supersonic/samples/x.flac` gets joined like any
other relative source, and asks for the base twice.

Buffer numbers come from `session.buffers` (`BufAllocator`) — the engine
validates `bufnum` against `numBuffers` but never allocates one, and a collision
overwrites a loaded sample rather than erroring.

## Size — the part that actually bites

**File size is the wrong metric.** What costs memory is
`duration × channels × sampleRate`, because a sample is decoded to float32
before it can sound. A 5MB FLAC and a 30MB WAV of the same recording cost
exactly the same once loaded.

Decoded size, at 48kHz:

| | per second | 10s | 30s | 60s |
|---|---|---|---|---|
| mono | 0.18MB | 1.8MB | 5.5MB | 11MB |
| stereo | 0.37MB | 3.7MB | 11MB | 22MB |

And then the measured part, which is worse than it looks. Loading a 44MB stereo
file (120s) cost:

| | memory growth |
|---|---|
| into a fresh buffer | **~180MB** |
| into a buffer already used | **~68MB** |

Four loads into four buffers took the tab from 77MB to **797MB**. Four loads of
the same file into *one* buffer reached **349MB**.

So reckon on **four times the decoded size** for a first load, and note what
that implies: a second of 48kHz stereo audio costs roughly **1.5MB of browser
memory**.

### None of it is ever released

`/b_free` returns nothing — measured at 797MB before and 797MB after freeing all
four buffers. Overwriting a buffer returns nothing either; it is merely cheaper
than claiming a new one.

**So the budget is per page visit, not per loaded sample.** Auditioning ten
samples costs all ten, whatever you free and whatever you overwrite. The only
levers are loading fewer and loading smaller.

Which is why `/sample/` claims one buffer and reuses it: not tidiness, but the
difference between auditioning a few files and being killed on the third.

### A working limit

The engine already takes 77MB before a single sample, and iOS Safari is where
allocations get refused. Against that:

| | |
|---|---|
| per sample | **≤ 10s stereo**, or ≤ 20s mono |
| total per page visit | **≤ 30s of audio** (~11MB decoded, ~45MB of memory) |
| as a file-size proxy | ≤ 2MB each, ≤ 5MB total |

Three things that halve it, in order of how little you lose:

1. **Mono.** These instruments pan in the synth anyway, so a stereo source is
   usually two copies of a decision already being made elsewhere.
2. **Trim hard.** A loop needs the loop, not the tail.

**Lowering the file's sample rate does nothing.** `decodeAudioData` resamples to
the AudioContext's rate, so a 24kHz file becomes the same number of 48kHz
samples as a 48kHz one. An earlier version of this page recommended it as a way
to halve memory; it is not. Duration and channels are the only two levers.

The push warns above 25MB per file. It does not refuse — it is your store and
your bandwidth — but above that it is worth knowing that one file will cost more
than the whole engine.

## Making a sampled library fit

Trimming is the obvious lever and it is rarely the first one. Two others come before it, both
subtractions that cost nothing audible, and on the dulcimer they together turned **322 seconds and
~433MB into 27 seconds and ~36MB**.

### Ship only what the lookup can reach

A multisample instrument picks a buffer per note, usually by nearest pitch. The set of notes a
pattern can *produce* is finite and computable — pool crossed with octaves — so the set of samples
it can ever *select* is computable too. Everything else is loaded, held for the life of the page,
and unreachable.

| | library | distinct pitches | notes the pattern reaches | ever selected |
|---|---|---|---|---|
| dulcimer | 26 files | 13 | 16 | **9** |
| marimba | 18 files | 18 | 13 | **10** |
| piano | 6 files | 6 | 16 | 6 |

Two separate causes, and they are worth telling apart.

**Round-robin takes** — the dulcimer ships two recordings of each pitch, and `minItem` returns the
first match, so one of each pair already never sounds. That alone halves it, 26 to 13, before any
argument about range.

**Spacing against range** — a pattern that reaches thirteen notes needs at most thirteen samples, and
fewer when two notes share a nearest neighbour. The marimba has no duplicate takes at all; its
eighteen are eighteen pitches, and the pattern simply cannot reach eight of them. The piano shows the
other end: six samples an octave apart, all six reachable, nothing to drop.

**Check it, do not judge it.** Both pages have a unit test that runs the lookup over the full pitch
list and the shipped one for every reachable note, asserting the same sample and the same shift —
plus that each omitted pitch is one the *full* library never selects either. That turns "I think
these nine are enough" into something that fails if it stops being true.

### Trim to the envelope, not to taste

A voice cannot play more of a buffer than its envelope holds open. Work out the longest the envelope
can last and cut there:

```
dulcimer:  attack 0.4   + sustain ≤0.2  + release 2.0  = 2.6s
marimba:   attack 0.004 + sustain ≤0.4  + release 2.2  = 2.6s
```

Against files averaging **12.4s** and **1.8s** respectively. The dulcimer was loading ten seconds
per file it could not play; the marimba barely benefits, which is itself the useful finding.

Then allow for rate. A sample pitched *up* is consumed faster than real time, so the audio needed is
`envelope × midiratio(largest upward shift)` — 2.6 × `midiratio(2)` = 2.92s for both, cut at 3.0s
with a 60ms fade so the cut is not a click.

This is why "trimming a hammered dulcimer's ring removes the instrument" was wrong when I first said
it: the ring past 2.6 seconds was never reaching the output.

### Only then, mono

Halves memory and changes the sound. Worth considering on mallet instruments that get panned in the
synth anyway, where a stereo source is largely a second copy of a decision made elsewhere.

**Not the sample rate**, though — `decodeAudioData` resamples to the context's rate, so a 24kHz file
decodes to exactly as many samples as a 48kHz one. Duration and channels are the only two levers
that exist.

### And the hard wall: 4MB of decoded audio per page

Separate from the memory budget above, and much tighter. The host-to-guest channel is a 4MB ring
buffer, and `loadSample` resolving means the audio is *queued* for the engine rather than consumed by
it. A loop that queues faster than the engine drains fills the ring, and a write with nowhere to go
waits forever instead of failing.

Desktop Chrome keeps up and never shows it — a 1MB inbox still loads 3.7MB of audio without
complaint. An iPhone did not:

| page | decoded at 48kHz | result |
|---|---|---|
| `/kit/` | 2.47MB | loads |
| `/piano/` | 3.68MB | loads |
| `/marimba/` | 6.78MB | **stalled at 3 of 10** |
| `/dulcimer/` | 9.89MB | **stalled at 3 of 9** |

Both stalls land exactly where cumulative decoded audio crosses 4MB. Four observations, one
threshold.

`loadSampleSet` now awaits `sonic.sync()` between loads, which is a round trip and so cannot return
until everything queued ahead of it has been processed — precisely "the channel has drained". It
costs nothing measurable: nine samples in about a second including boot.

Raising `inboxSize` would also work and is the wrong fix: a bigger ring buys slack on the device
that is already refusing the engine's 70MB allocation.

Note the **48kHz**, not the file's rate. A 44.1kHz file is resampled on decode, so it costs 8.8% more
than its own duration suggests.

## The pages

| page | samples | audio | memory | shape |
|---|---|---|---|---|
| `/sample/` | 1 at a time | — | ~13MB | loads any file, loops it |
| `/kit/` | 12 | 13.5s mono | ~9MB | 3-way subdivision, kick on the downbeat |
| `/piano/` | 6 | 10.0s | ~13MB | nearest-sample, stretched up to 11 semitones |
| `/dulcimer/` | 9 | 27.0s | ~36MB | 3-way subdivision, fx tail on a private bus |
| `/marimba/` | 10 | 18.5s | ~24MB | 4-way subdivision, octave walks per event |

### One buffer per page, reused

Every one of these claims a buffer set once at boot and never reloads. The `/sample/` page, which
*does* reload, reuses a single buffer — because nothing is ever released and a fresh buffer costs
about 2.6× what an overwrite does.

### Bar-scoped and event-scoped keys

Three of these pages run a `Pswitch` on a live index, and porting one means knowing which keys move
per bar and which per note. Getting it backwards is audible and does not look like a bug:

- **`Pswitch(…, Pkey(\divIdx))` is bar-scoped** — it embeds a whole sub-pattern before re-reading
  the index, so a subdivision change lands on the beat rather than halfway through one.
- **Every other Pbind key is event-scoped.** A Pbind advances all of its streams once per event. So
  `\octave, Pseq([4, 3, 2].stutter(2), inf)` moves on every *note*, and at six steps a single bar
  walks all three octaves.

The dulcimer shipped with the second one wrong — one octave per bar instead of per note, which
flattened a figure that descends two octaves inside a bar into one that descends across six. Both
pages now have a test pinning it.

## The page

`/sample/` loads a file into a buffer and loops it with `ssp_loop` — `PlayBuf`
with `loop: 1` and `doneAction: 0`, because a looping player must never free its
own synth: the gate is what ends it. Its whole control surface is generated from
the def's contract, so no range for rate, cutoff or release is written in the
page.

It ships one built-in sample so it does something on a machine that has never
pushed a store, and the built-in is labelled rather than hidden — an unlabelled
one sitting in the list would read as proof the store is working when it is
empty.
