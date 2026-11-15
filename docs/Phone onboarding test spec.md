# Phone onboarding test: spec

Nov 14, 2026 · @Steph Ohara

## Goal and scope

This is a test of phone onboarding on its own. The aim is to find out how reliably a phone can be made ready to play sound: sound coming from the speaker at a usable level, motion allowed and the screen awake. It is tested with about ten people per run, first on Wednesday 18 November at 6:00pm and 7:00pm, with rehearsals on Monday and Tuesday.

In scope: the written steps, the sound checks, the permissions, the group index and the ready screen. Nothing after the ready screen is part of this test.

There are two versions to compare. Version A uses the microphone to check sound levels. Version B never opens the microphone and relies on what the person reports. Both assume Safari on iPhone and Chrome on Android.

## Principles

Every screen asks for one thing, in plain words, and says what the person will hear or feel.

- One action per screen. The button is the only thing that moves the person on.
- Written steps lead and sound confirms, so nobody needs to hear anything to understand what to do.
- Tap targets are at least 44px and text at least 16px, which matches the repo's own mobile rules (iOS zooms in on anything smaller).
- Every step shows a tick when passed and a plain fix when it fails. A failed step never dead-ends: the person can retry, ask for help or continue without sound.
- Each permission prompt comes from a tap, after a sentence saying why it is coming. iOS only allows the motion prompt from a tap.
- The page can't change the phone's volume, and on iPhones it can't choose where sound goes. It asks, then checks.

## Group index

Everyone opens the same plain link. The page generates a group index of 0, 1 or 2 when it loads and keeps it for the session, so a refresh doesn't change it.

| Index | Colour | Symbol and name |
| --- | --- | --- |
| 0 | To choose | Circle |
| 1 | To choose | Square |
| 2 | To choose | Triangle |

The group's colour fills the top of every screen with its symbol and name, so the person always sees which group they are in. The symbol is there so the groups still differ for colour-blind people.

## Flow at a glance

&#91;embedded content: onboarding flow · Version A and Version B, 7 and 6 steps\]

Both versions start the same way and finish at the same motion step. In Version A, a refused microphone drops the person into Version B's tone check.

## Version A: with the microphone

The phone plays a soft tone and listens to its own speaker, so the person turns the volume up until a bar crosses a line. No one has to judge loudness by ear. Seven steps, about two minutes.

1. **Start.** Shows the group symbol and name. "Hello, Circle. Let's get your phone ready. It takes about two minutes." Button: Start. This tap starts the audio engine and unlocks the narrator's voice on iPhone. No permission prompt yet.
2. **Put the sound on the speaker.** Written steps only. "Turn off Bluetooth and unplug any headphones. iPhone: switch silent mode off. Turn the volume up to about three-quarters." The page shows the iPhone line or the Android line, not both. On Android it reads: "Press a volume button and check the media volume." Button: Next.
3. **Allow the microphone.** "To check your speaker is loud enough, the page listens for a short sound that it plays itself. It keeps only the loudness, nothing is recorded or sent." Button: Allow microphone. If refused, the page offers "Continue without the microphone" and carries on as Version B from its step 3.
4. **Quiet first.** "Stay quiet for a moment." The page measures the room's noise for two seconds.
5. **Tone check.** "You'll hear a soft pulsing tone. Turn your volume up until the bar passes the line." The tone repeats about once a second while the person adjusts the volume, and the bar updates live. The step passes when the bar stays over the line for two pulses in a row. Never times out.
6. **Voice check.** "Now you'll hear the narrator." The narrator says: "Hello. This is the narrator." The step passes if the microphone level rises above the room's noise while it speaks. If it doesn't, ask "Did you hear a voice?" with Yes and No. The narrator's voice comes through the phone's own speech system, not the audio engine, so it needs its own check.
7. **Allow motion, then shake.** "Next, your phone feels movement." Button: Allow motion. Then "Shake your phone gently." The step passes when motion is detected within 10 seconds, and the screen flashes a colour once so the person sees the phone responded.

Then the screen keeps itself awake and goes to the ready screen.

**Pass rule for the tone check.** The tone must be a set number of decibels above the room's noise level. Start at 15 dB and tune it in rehearsal, because phones differ.

**Microphone settings.** For this check, echo cancellation, noise suppression and automatic gain are all off. Echo cancellation would remove the phone's own tone, and automatic gain would hide how loud it really is. The page must not record or transmit audio, only follow its level.

**Screen awake.** Requested automatically after the last step, and re-requested whenever the page comes back to the front.

## Version B: without the microphone

The microphone is never requested. The person judges the sound and answers yes or no, so it is faster to build and gentler, and it can't catch a phone whose sound is going to headphones. Six steps, about two minutes.

1. **Start.** Same as Version A.
2. **Put the sound on the speaker.** Same as Version A.
3. **Tone check.** "Press Play. You'll hear a soft tone. Hold your phone at arm's length: can you hear it clearly from the phone's speaker, not from headphones?" Buttons: Play, Yes, I hear it, and No. The tone repeats while the person adjusts the volume.
4. **Voice check.** "Press Play. You'll hear the narrator say hello. Did you hear a voice from the speaker?" Buttons: Play, Yes, No.
5. **Allow motion, then shake.** Same as step 7 of Version A.
6. **Keep the screen awake.** Same as Version A, then the ready screen.

**The weak point.** Someone with Bluetooth headphones connected will hear the tone and tap Yes. The wording "from the phone's speaker, not from headphones" is there for that reason, but some phones will still pass wrongly. A facilitator should listen to the room during the lobby for quiet phones.

**If someone taps No on either check,** show the fix list from "When something fails" and let them play the sound again.

## When something fails

Shown when a check fails or someone taps No. Each fix is one line, and the person can play the sound again straight after.

| What the person sees | Likely cause | On-screen fix |
| --- | --- | --- |
| Hears nothing | iPhone silent mode, or media volume at zero | "iPhone: flip the switch on the side so no orange shows. Then press the volume-up button." Android: "Press a volume button and raise the media volume." |
| Hears it in headphones, or nothing at all | Bluetooth headphones or speaker connected | "Turn off Bluetooth, or take your headphones off and disconnect them." |
| Sound is faint | Volume too low | "Turn the volume up until the bar passes the line." (Version B: "until it is clearly loud.") |
| Microphone refused | Prompt declined | "No problem. Continue without the microphone." The page carries on as Version B. |
| Microphone blocked and no prompt appears | Permission denied earlier in the browser | "Open the page's site settings and allow the microphone, or continue without it." |
| Motion not detected | Prompt declined or motion access off | "Tap Allow motion again. If nothing appears, check the browser's site settings." Always offers "Skip movement". |
| Voice not heard | Speech muted or volume low | "Turn the volume up and press Play again." Always offers "Continue without the voice". |

After two failed tries on any step the page shows "Ask a facilitator" next to "Continue without this".

## Ready screen

Shown once every step has passed or been skipped. It has five parts:

- The group colour, symbol and name, large.
- "You're ready." with a tick.
- A short list of what passed: Sound, Voice, Motion. A skipped step shows "Skipped" in plain words.
- "Keep this screen open and your phone awake."

The screen stays awake while it is showing.

## iOS and Android differences

Items marked "confirm Monday" have not been verified on a real phone yet.

| Topic | iPhone (Safari) | Android (Chrome) |
| --- | --- | --- |
| Silent mode | A switch on the side can mute sound from a web page. The instruction shows "no orange". Confirm Monday whether the tone and the voice are both muted. | No silent switch. Media volume is separate from ringer volume. |
| Volume | Volume buttons change media volume only while the page is playing sound, so start the tone first. | Volume buttons may change ringer volume until sound is playing. Say "media volume". |
| Bluetooth | The page can't choose where sound goes. Ask for Bluetooth to be switched off. | Same. Ask for Bluetooth to be switched off. |
| Microphone prompt | Shown from a tap. Safari asks again each visit unless the person allows it for the site. | Shown from a tap and remembered for the site. |
| Microphone and speaker | Opening the microphone can move sound to the earpiece. Confirm Monday. Version A's tone check will show this as a failure. | Usually stays on the speaker. Confirm Monday. |
| Motion prompt | Required, and only from a tap. A refusal usually needs the site's settings or a reload to ask again. | No prompt. Motion simply works, so the step is a shake test only. |
| Voice | Must be unlocked by the Start tap. Confirm Monday that it plays with silent mode on. | Starts once the page has had a tap. Voices differ by phone. |
| Screen awake | Wake lock should work. Confirm Monday. | Wake lock works in Chrome. |
| Page in the background | Audio and motion stop when the screen locks or the person switches app. | Same, but less strict. |

## Accessibility

- Nothing depends on sound alone. Every sound has a written line beside it, and every check has a visual result (the bar, a tick or a cross).
- Anyone who can't hear the tone or the voice can choose "Continue without sound" and still finish.
- Every colour is paired with a symbol and a name.
- The only flash is one colour change in the shake step, well under three flashes a second.
- Text is at least 16px, tap targets at least 44px, and contrast is high enough to read outdoors.
- Buttons and status changes work with VoiceOver and TalkBack: each tick or failure is announced as text.
- Written steps never disappear on a timer.

## Open questions and tests

To settle on Monday and Tuesday with real phones, at least two iPhones and two Android phones, some with Bluetooth headphones paired.

- [ ] iPhone silent switch on: do the tone and the narrator's voice still play?
- [ ] iPhone with the microphone open: does sound move to the earpiece, and does Version A's tone check catch it?
- [ ] Bluetooth headphones connected: does the tone go to them, and does each version catch it?
- [ ] Tone check threshold: is 15 dB above the room's noise right on both platforms?
- [ ] Motion: does a refusal on iPhone recover without a reload?
- [ ] Wake lock: does the screen stay awake on each phone?
- [ ] Time: do people finish each version in about two minutes?
- [ ] Which version do people pass more reliably, and which leaves fewer silent phones?
- [ ] Group index: do ten people get a spread across 0, 1 and 2, and does it matter if they don't?
