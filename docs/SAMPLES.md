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
2. **Lower the sample rate.** 24kHz halves it again and is often inaudible on
   percussion and texture.
3. **Trim hard.** A loop needs the loop, not the tail.

The push warns above 25MB per file. It does not refuse — it is your store and
your bandwidth — but above that it is worth knowing that one file will cost more
than the whole engine.

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
