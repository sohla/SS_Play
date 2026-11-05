# chorus

Devices in one room that call, listen for each other's calls, and slowly fall into step — with
nothing exchanged but sound. Open `/chorus/` on a few phones.

## The model: Kuramoto, for pulses

Kuramoto's oscillators see each other's phase continuously: dθᵢ/dt = ωᵢ + K/N Σ sin(θⱼ − θᵢ).
Fireflies and crickets do not. They get a brief pulse and nothing between, which is the
**pulse-coupled oscillator** (Mirollo & Strogatz, 1990). Each device runs a phase φ from 0 to 1
and calls at 1. Hearing another call at phase φ moves it by

    Δφ = −ε · sin(2πφ)

which is Kuramoto's coupling term evaluated at the one instant the other oscillator is known —
when it calls. Late in the cycle the other is ahead, so call sooner; early, wait.

Phase coupling alone locks devices of different natural tempo at a fixed lag, so each correction
also nudges the **period** (Ermentrout, 1991, after the *Pteroptyx malaccae* firefly). The group
converges on a tempo, not only a phase.

**Delay is the hard part.** Between scheduling a call and detecting one there is output latency,
input latency and the detector's own length — tens to a couple of hundred milliseconds on phones.
Uncorrected, delay pulls pulse-coupled oscillators into anti-phase; firefly-inspired sensor
networks hit the same problem with radio (Werner-Allen et al., 2005). Here each device **hears
itself**: its own call returns at a fixed delay, which both identifies the echo (ignored) and
corrects everyone else's calls back to when they were made. That assumes the other device's
speaker latency is close to this one's; where it is not, the pair settles about that far apart.

The delay is measured while each call is moved at random by up to ±25% of a period. Our echo
returns at the same delay wherever the call lands; a neighbour's does not. Without the jitter, two
devices of near-equal tempo hold a near-constant offset long enough to pass as an echo, and a
device that believes it couples to itself. Once measured, the delay is fixed for the session.

`apps/chorus/src/chorus.ts` is the whole model, in plain numbers; its tests simulate rooms of two
to five devices with differing latencies. They converge in roughly 15 seconds to 3 minutes,
typically two, to within the 12ms window inside which a neighbour cannot be told from our echo.

## The call: a down-slur

A 5kHz → 2.5kHz exponential sweep over 80ms, Hann-enveloped — a bird's "tsee-oo".

- **A sweep, not a held tone.** A tone is the same at every instant, so a listener can only say
  roughly when it was. A sweep passes each frequency once, which is why bats and acoustic ranging
  between phones (BeepBeep, Peng et al., 2007) use them.
- **2.5–5kHz** is where a phone speaker is loudest and an ear most sensitive, clear of speech.
- An insect-style chirp — pulses of one carrier, ~4.5kHz like a cricket — was the alternative. It
  is easier to synthesise and worse to time, and anything steady near its carrier triggers it.

## The listener: spectrogram template matching

The browser build of scsynth has no `Convolution` UGens, so a true matched filter is out. What it
does have is enough for the method bioacoustics uses to find a species' call in long field
recordings (spectrogram correlation — Mellinger & Clark, 2000; the monitoR package):

1. Eight `BPF` bands (rq 0.05) at points along the sweep, each through `Amplitude`.
2. Each band delayed by how much earlier the sweep reaches it, so for the real call all eight peak
   at one instant.
3. A call is counted when at least 6 of 8 bands are within -14dB of the loudest **at the same
   instant**, and that peak stands 4× above its own slowly-tracked background.
4. Then deaf for 50ms, so a room's reflections count once.

Probed in the engine, ten of each: a broadband 30ms burst, a held 3.5kHz tone and the same sweep
upward produce no detections; the call produces 9–10, and a slower, narrower slur (4.5 → 2.7kHz
over 120ms) all 10 — which is what lets a person whistle along. The first version averaged band
levels against their backgrounds instead of counting coincident bands, and fired on all of these.

Detections carry a sample counter (`Phasor`, wrapped at 2²²), so their timing is exact however
late the OSC message arrives.

## Microphone

Echo cancellation, noise suppression and AGC are all **off** — the opposite of `/mic/`. Echo
cancellation would remove our own call, which is how a device learns its delay; the other two
reshape exactly the short tonal sound the detector is built for.

## Testing

`?loopback=1` listens to the page's own output instead of the microphone; `&voices=N` runs N
callers in one tab. The e2e suite uses it to prove calibration, coupling and the detector's
specificity. It cannot prove a call carries across a real room, or what an iPhone does to its
speaker once the mic is open — that needs phones.
