# Haptics from a speaker

What `/thrum/` is built on. Kept as its own page because none of it is specific to
that instrument: these are properties of a phone and of a hand, and any page that
wants to be felt rather than heard runs into the same five numbers.

The short version, for anyone who only wants the constraints:

| | |
|---|---|
| **250Hz** | the frequency skin is most sensitive to — not 40Hz |
| **25–30ms** | the duration at which a tap stops being a tap |
| **~1 second** | how long that same channel keeps summating energy, so short = hard to feel |
| **~800Hz** | the speaker's cutoff, below which drive becomes motion rather than sound |
| **~0.4mm** | the travel every layer is competing for |

The second and third fight each other, and that fight is the whole design
problem — see [the trade-off](#and-it-is-a-trade-off-not-a-ceiling--corrected-by-a-hand).

## The mechanism is the speaker's weakness

A microspeaker resonates somewhere around 800Hz–1kHz — a 1cm³ enclosure has an
F3 near 800Hz — and its output falls **12dB/octave** below that. The usual
conclusion is "a phone has no bass", and it stops there.

The useful half of the same fact: **below cutoff the diaphragm's excursion goes
roughly constant while radiated level falls as f².** At constant SPL, excursion
rises as 1/f² — halve the frequency and you need four times the travel — and
under the cutoff there is no more travel to give, so what happens instead is that
the level drops and the movement does not.

The drive is not lost. It stops becoming sound and starts becoming **motion**.

So the sub-cutoff band is not the band a phone is bad at. It is the band where a
phone is a vibrator rather than a speaker, and a page that wants to be felt
should work the speaker there deliberately rather than treat it as a region to
high-pass away.

The hard floor is **excursion, not frequency**. Maximum diaphragm travel is
around 0.4mm and gets smaller as phones get thinner. Under about 100Hz the
diaphragm has run out before it has done anything, so that content is distortion
bought with headroom the felt band needed — which is why `ssp_thrum_bed` carries
a `guard` high-pass and why it is specced so it cannot be raised far enough to
eat the carrier it protects.

## 250Hz, and why the obvious answer is wrong

The instinct for anything felt is to go as low as possible. It is wrong twice.

Vibrotactile detection threshold for glabrous skin is a **U-shaped curve with its
minimum at 250Hz** — Verrillo's result, and the shape holds across contactor
sizes. That is the Pacinian channel's maximum, nominally 250–300Hz and useful
from 200 to 400Hz, where the hand resolves displacements on the order of
nanometres. Skin responds from roughly 20Hz to 1kHz, but nowhere near equally.

So at 40Hz the skin is an order of magnitude less sensitive **and** the speaker is
out of travel. Both arguments point the same way and neither is the one people
reach for first.

250Hz is simultaneously the most-felt frequency available and comfortably inside
the band the diaphragm still moves through. That coincidence is not something
this project arranged — it is why purpose-built phone actuators resonate in the
low hundreds of Hz, with reported figures running from about 100Hz to 235Hz
rather than down where a subwoofer lives.

## Length decides category; pitch does not

A vibrotactile burst stops being felt as a discrete pulse and starts being felt
as a continuous vibration at about **25–30ms**, and the threshold is
**near-constant from 40Hz to 590Hz**.

That constancy is the interesting part, because it is the opposite of hearing,
where a higher frequency needs less time to establish a pitch. In cycles the
tactile threshold is wildly uneven — 1.13 cycles at 40Hz, 7.5 at 250Hz, 16.6 at
590Hz — which is another way of saying the skin is timing the event rather than
counting its periods.

The design consequence looks blunt: **what makes something feel like a tap is
its length.** A 40ms version of exactly the same graph is a buzz.

### And it is a trade-off, not a ceiling — corrected by a hand

The first version of `/thrum/` read that as a cap and specced `decay` to top out
at 0.025 on both voices, with the unit suite asserting it at every sensitivity.
It was reported unfeelable: *"the short glitches are so short i don't feel like i
can feel them."*

The reason is the other half of the same literature, and it points the opposite
way. **The Pacinian channel summates energy over time up to about one second** —
detection threshold falls as duration rises — and temporal summation happens in
*that channel only*, not in the two slower ones. Which is the channel 250Hz was
chosen to address. So the page put its carrier where skin is most sensitive and
then made its taps the duration where that same channel is least sensitive.

It was made worse by driving `decay` from the gesture: shaking harder *shortened*
the burst, so the harder you felt for a tap the less there was to find.

**A burst crisp enough to be unambiguously a tap is close to the least detectable
thing this transducer can make.** Crispness and detectability trade against each
other; the exchange rate depends on the speaker, the case and the hand; and
nothing here can pick the point. So `decay` now spans 3ms to 400ms — both sides
of the boundary — the gesture no longer touches it, and the page puts it on a
slider that names which side you are on (`tap` / `edge` / `buzz`).

The general form, worth carrying to anything else built on numbers like these: a
threshold from the literature tells you where a percept *changes category*. It
does not tell you that one side of it is the side you want.

## Settled by a hand: the channel wants sustained energy

Everything above is published and everything below is measured, and where the
two disagree the measurement wins.

`/thrum/` went through a three-layer version, a nine-parameter version, and
finally a single pulse with its whole shape on sliders. Someone then found
settings that worked on a real phone, and **three of the six are nowhere near
where the literature points**:

| | found | the literature's instinct |
|---|---|---|
| `decay` | **91ms** | under 25ms, so it reads as a discrete tap |
| `attack` | **14.5ms** | a fraction of a millisecond, so it has an edge |
| `curve` | **+4, "held"** | negative, decaying like a struck object |

Read together they say one thing, and it is the thing Pacinian temporal
summation predicts rather than anything the category research suggests: **this
channel wants sustained energy, not a sharp event.** Detection threshold falls as
duration rises, up to about a second, so a long slow-rising plateau is far more
detectable than a crisp tap — and a crisp tap through a phone speaker is simply
not felt. 250Hz was confirmed; the envelope was not.

The transferable form, which cost three rebuilds to learn: **a threshold from the
literature tells you where a percept changes name. It does not tell you that the
side with the better name is the side you can reach.** The 25-30ms boundary is
real and the crisp side of it was unreachable on this transducer the whole time.

The rate range was narrowed to 0.5-6Hz afterwards, keeping the page inside the
countable-events regime on purpose. Flutter and fusion are reachable percepts and
not what this instrument is for.

## Three channels, which is where the layered versions came from

Kept because the channels are real and the next thing built on them will need
them, even though `/thrum/` is now one layer. Each one is a **rate** regime:

| channel | rate | felt as |
|---|---|---|
| SA-I | ≤ ~6.3Hz | separate, countable events |
| RA-I (Meissner) | 16–32Hz | a rhythmic flutter |
| RA-II (Pacinian) | 35–500Hz | one smooth continuous vibration |

Between them are two transitions worth building an instrument around. The
**critical segregation rate** is the rate below which the pulses of a periodic
stimulus can still be told apart as separate events; above it they fuse into
flutter, and past roughly 50–80Hz the flutter smooths out entirely.

Which means a page can have **one real axis** — how often something happens —
and crossing a boundary on it changes what the hand is holding without changing
pitch or level. `/thrum/` puts that axis on rotation, because it is the gesture
you can hold: a boundary you can cross but not sit on is a glitch rather than a
control.

## What follows for the DSP

Five rules, each of which is one of the above read backwards.

**1. Split every event in two.** A felt signal and a heard signal are not the
same signal and should not be the same band. In `ssp_thrum_tap` a 250Hz body does
the feeling and a 2.5kHz click does the hearing — the body is below the cutoff
where it barely radiates, the click is above it where the speaker is efficient
and the skin is not. Without the click an event is felt and cannot be placed in
time; without the body it is heard and not felt.

**2. Clipping is a feature.** Harmonics of a 250Hz body land at 500Hz and 750Hz,
which is where the speaker starts to radiate — so `softclip` transposes energy
out of the felt region into the heard one. A clean limiter in the same place
makes a hard tap *quieter* without making it any less felt, which is backwards.

**3. Mono, in phase, always.** Two speakers, one chassis. Anything panned,
widened or phase-inverted between the sides cancels **mechanically** before it
cancels acoustically, and the loss falls hardest on the low end — the only part
being felt. Stereo is a cost with no return on a page whose output is a
vibration.

**4. Excursion is zero-sum, so layers that share it share an output stage.**
Three layers are three claims on the same 0.4mm. Two limiters each seeing half
the signal will both report headroom while the pair clips, so the layers that
run continuously are one SynthDef with one limiter that sees their sum. The tap
layer sits outside it deliberately, because a tap has to be able to take
priority — it does that by **ducking** the bed through its master `amp`, which
keeps "what the gesture asked for" and "what the travel allowed" as two separate
numbers.

**5. A resonator is the actuator you do not have.** An LRA is a mass on a spring,
so what it does when asked for a tap is a damped sinusoid. An oscillator times a
short envelope is the same shape with an amplitude you can predict, which matters
when the limit being managed is a physical excursion rather than a loudness.

## Rates that cannot cross to JavaScript

Worth stating separately because it decided the page's architecture, and it is
not a haptics fact — it is a consequence of one.

The `conductor` shape sends each event to the browser and back
([UI.md](UI.md#conductor)). At the tap layer's rates — under 6Hz — the round trip
is a few milliseconds against an interval of hundreds, and what the Demand graph
buys is exactness for events that are individually felt.

At the flutter layer's rates it inverts. By 90Hz the interval is ~11ms, the same
order as the round trip, so the rate the hand asked for and the rate the skin
received would be different numbers. Any layer above roughly 20Hz has to be a
pulse train **inside** the graph. `ssp_thrum_bed` puts its accents on a demand
sequence the train pulls itself, which keeps the pattern server-side with no OSC
traffic at all.

**The rate decides the mechanism.** It is the same rule as
[the three instrument shapes](UI.md#the-three-shapes-an-instrument-takes), with a
ceiling attached.

## What none of this establishes

**That any of it is felt.** Everything above is physics and published
psychophysics, and the test suite proves the engine renders the result without
clipping. Neither says that a particular phone in a particular hand produces a
sensation, and that is the only claim that matters.

**Four reports in, and they rebuilt the page twice.** The short taps could not be
felt; the layers were not the problem; the pulse's own shape was baked in. What
is left is one pulse with nine controls and a set of defaults that came off a
hand — see [the section above](#settled-by-a-hand-the-channel-wants-sustained-energy).

Still unverified as of 2026-10-11:

- Whether the found defaults travel to another phone, or whether they describe
  one speaker in one palm. Nothing here can tell the difference yet.
- How much of what reaches the hand is the diaphragm versus the chassis it is
  mounted in. 250Hz was confirmed by hand, but not against its neighbours.
- Amplitude modulation — depth and rate on the carrier — is the one studied
  dimension this page does not expose. It is the roughness/texture axis, and the
  obvious next thing to add if the envelope controls turn out to be enough.
- Whether the three layers are distinguishable by touch, or whether they collapse
  into one buzz with a tremolo. The research says the channels are separate; it
  does not say this transducer can address them separately.
- Whether `guard`'s default of 120Hz is right for any real device. It is the one
  control here that is genuinely device-dependent and was set by argument.
- Whether the plotter's 33Hz canvas costs anything on a phone. The rate was
  chosen for SuperCollider's CPU, not for a mobile compositor.

The honest summary is that this page is a well-founded hypothesis with a green
test suite, and the next thing it needs is a hand rather than another assertion.
