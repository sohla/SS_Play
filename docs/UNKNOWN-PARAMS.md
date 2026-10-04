# Parameters still without a range

The vendored Sonic Pi defs carry no metadata, so their control ranges are inferred from naming
conventions — see [SYNTHDEFS.md](SYNTHDEFS.md#inferred-contracts). **93.3% of parameters are
covered.** These 148 names are not, so they appear in the UI as values with no control.

That is deliberate. A parameter with an invented range is worse than one with none: the slider
looks authoritative and is not.

## How to fix one

Add it to `param-ranges.json` at the repo root — data, not code:

```json
depth: [0, 1, linear, 0]
```

`[min, max, warp, step, units?]`. Warp is `linear`, `exponential`, `amp`, or a number for a
curve. Step is 0 for continuous, 1 for a stepper. An exponential range cannot include zero.

Then `npm run build`. Every def using that name picks it up.

## The list

Defaults are every distinct value seen across the defs that declare the parameter — often the best
clue to its range and units.

| parameter | defs | defaults seen | used by |
|---|---|---|---|
| `phase` | 9 | 0.25, 0.5, 1, 4 | fx_echo, fx_flanger, fx_ixi_techno, fx_panslicer, … |
| `phase_offset` | 8 | 0 | beep, fx_flanger, fx_ixi_techno, fx_panslicer, … |
| `mod_phase` | 6 | 0.25 | mod_dsaw, mod_fm, mod_pulse, mod_saw, … |
| `mod_phase_offset` | 6 | 0 | mod_dsaw, mod_fm, mod_pulse, mod_saw, … |
| `centre` | 4 | 100 | fx_bpf, fx_nbpf, fx_nrbpf, fx_rbpf |
| `depth` | 4 | 0.5, 1, 5 | fm, fx_flanger, fx_tremolo, mod_fm |
| `pitch` | 3 | 0 | fx_pitch_shift, mono_player, stereo_player |
| `pitch_dis` | 3 | 0 | fx_pitch_shift, mono_player, stereo_player |
| `room` | 3 | 0.6, 10, 70 | dark_ambience, fx_gverb, fx_reverb |
| `smooth` | 3 | 0 | fx_panslicer, fx_slicer, fx_wobble |
| `smooth_down` | 3 | 0 | fx_panslicer, fx_slicer, fx_wobble |
| `smooth_up` | 3 | 0 | fx_panslicer, fx_slicer, fx_wobble |
| `time_dis` | 3 | 0 | fx_pitch_shift, mono_player, stereo_player |
| `window_size` | 3 | 0.2 | fx_pitch_shift, mono_player, stereo_player |
| `divisor` | 2 | 2 | fm, mod_fm |
| `hpf_attack` | 2 | 0 | mono_player, stereo_player |
| `hpf_decay` | 2 | 0 | mono_player, stereo_player |
| `hpf_max` | 2 | -1 | mono_player, stereo_player |
| `hpf_release` | 2 | 0 | mono_player, stereo_player |
| `hpf_sustain` | 2 | -1 | mono_player, stereo_player |
| `lpf_attack` | 2 | 0 | mono_player, stereo_player |
| `lpf_decay` | 2 | 0 | mono_player, stereo_player |
| `lpf_min` | 2 | -1 | mono_player, stereo_player |
| `lpf_release` | 2 | 0 | mono_player, stereo_player |
| `lpf_sustain` | 2 | -1 | mono_player, stereo_player |
| `max_delay_time` | 2 | 0.125, 1 | fx_whammy, pluck |
| `max_phase` | 2 | 1, 2 | fx_echo, fx_ping_pong |
| `mode` | 2 | 0 | fx_sound_out, fx_sound_out_stereo |
| `note_resolution` | 2 | 0, 0.1 | chipbass, chiplead |
| `output` | 2 | 0 | fx_sound_out, fx_sound_out_stereo |
| `sub_amp` | 2 | 1 | fx_octaver, subpulse |
| `transpose` | 2 | 0, 12 | fx_autotuner, fx_whammy |
| `amp_max` | 1 | 1 | fx_slicer |
| `amp_min` | 1 | 0 | fx_slicer |
| `amp_scale` | 1 | 0.1 | rodeo |
| `amp-fudge` | 1 | 2.5 | hoover |
| `attenuation` | 1 | 1 | sc808_bassdrum |
| `bass` | 1 | 8 | organ_tonewheel |
| `bits` | 1 | 8 | fx_bitcrusher |
| `blockflute` | 1 | 0 | organ_tonewheel |
| `boost` | 1 | 8 | gabberkick |
| `buffer` | 1 | 0 | fx_record |
| `clickiness` | 1 | 0.1 | kalimba |
| `coef` | 1 | 0.3 | pluck |
| `cutoff_attack` | 1 | -1 | tb303 |
| `cutoff_decay` | 1 | -1 | tb303 |
| `cutoff_release` | 1 | -1 | tb303 |
| `cutoff_sustain` | 1 | -1 | tb303 |
| `db` | 1 | 0.6 | fx_band_eq |
| `delay` | 1 | 5 | fx_flanger |
| `deltime` | 1 | 0.05 | fx_whammy |
| `disable_wave` | 1 | 0 | zawa |
| `distort` | 1 | 0.5 | fx_distortion |
| `dpulse_width` | 1 | -1 | dpulse |
| `drive` | 1 | 2 | bass_highend |
| `dry` | 1 | 1 | fx_gverb |
| `dur` | 1 | 0.1 | test_offset_out |
| `filter` | 1 | 0 | fx_wobble |
| `force_mono` | 1 | 0 | mixer |
| `formant_ratio` | 1 | 1 | fx_autotuner |
| `freq_band` | 1 | 0 | chipnoise |
| `fundamental` | 1 | 8 | organ_tonewheel |
| `gain` | 1 | 5 | fx_krush |
| `gate` | 1 | 1 | rodeo |
| `grains_period` | 1 | 2 | fx_autotuner |
| `grainsize` | 1 | 0.075 | fx_whammy |
| `hard` | 1 | 0.5 | piano |
| `head_hpf` | 1 | 30 | sc808_snare |
| `high` | 1 | 0 | fx_eq |
| `high_note` | 1 | 104.9014 | fx_eq |
| `high_q` | 1 | 0.6 | fx_eq |
| `high_shelf` | 1 | 0 | fx_eq |
| `high_shelf_note` | 1 | 114.2326 | fx_eq |
| `high_shelf_slope` | 1 | 1 | fx_eq |
| `invert_flange` | 1 | 0 | fx_flanger |
| `invert_stereo` | 1 | 0 | mixer |
| `krunch` | 1 | 5 | fx_tanh |
| `larigot` | 1 | 0 | organ_tonewheel |
| `level` | 1 | 1 | fx_normaliser |
| `lfo_rate` | 1 | 0.4 | rhodey |
| `lfo_width` | 1 | 0.3 | rhodey |
| `low` | 1 | 0 | fx_eq |
| `low_note` | 1 | 59.2131 | fx_eq |
| `low_q` | 1 | 0.6 | fx_eq |
| `low_shelf` | 1 | 0 | fx_eq |
| `low_shelf_note` | 1 | 43.35 | fx_eq |
| `low_shelf_slope` | 1 | 1 | fx_eq |
| `max_delay` | 1 | 20 | fx_flanger |
| `max_formant_ratio` | 1 | 10 | fx_autotuner |
| `max_room` | 1 | -1 | fx_gverb |
| `mid` | 1 | 0 | fx_eq |
| `mid_note` | 1 | 83.2131 | fx_eq |
| `mid_q` | 1 | 0.6 | fx_eq |
| `min_freq` | 1 | 10 | fx_autotuner |
| `mod_amp` | 1 | 1 | fx_ring_mod |
| `mod_index` | 1 | 0.2 | rhodey |
| `nazard` | 1 | 0 | organ_tonewheel |
| `noise_amp` | 1 | 0.8 | pluck |
| `oct` | 1 | 8 | organ_tonewheel |
| `pan_max` | 1 | 1 | fx_panslicer |
| `pan_min` | 1 | -1 | fx_panslicer |
| `pan_start` | 1 | 1 | fx_ping_pong |
| `pluck_decay` | 1 | 30 | pluck |
| `pre_damp` | 1 | 0.5 | fx_gverb |
| `pre_limiter_max_frames` | 1 | 1024 | mixer |
| `pre_limiter_scope_num` | 1 | 31 | mixer |
| `quint` | 1 | 8 | organ_tonewheel |
| `range` | 1 | 24 | zawa |
| `response-id` | 1 | -1 | server-info |
| `retune` | 1 | 0 | fx_autotuner |
| `rev` | 1 | 1 | sc808_clap |
| `reverb_time` | 1 | 100 | dark_ambience |
| `ring` | 1 | 0.2 | dark_ambience |
| `rq` | 1 | 0.5 | rodeo |
| `rs_amplitude_depth` | 1 | 0.2 | organ_tonewheel |
| `rs_delay` | 1 | 0 | organ_tonewheel |
| `rs_freq` | 1 | 6.7 | organ_tonewheel |
| `rs_freq_var` | 1 | 0.1 | organ_tonewheel |
| `rs_onset` | 1 | 0 | organ_tonewheel |
| `rs_pan_depth` | 1 | 0.05 | organ_tonewheel |
| `rs_pitch_depth` | 1 | 0.008 | organ_tonewheel |
| `sample_rate` | 1 | 10000 | fx_bitcrusher |
| `sifflute` | 1 | 0 | organ_tonewheel |
| `slope_intermediate` | 1 | 69 | gabberkick |
| `slope_length1` | 1 | 0.015 | gabberkick |
| `slope_length2` | 1 | 0.1 | gabberkick |
| `slope_start` | 1 | 84 | gabberkick |
| `smoothness` | 1 | 0.1 | amp_stereo_monitor |
| `spread` | 1 | 0.5 | fx_gverb |
| `stereo_width` | 1 | 0 | piano |
| `strength` | 1 | 1 | fx_autotuner |
| `sub_detune` | 1 | -12 | subpulse |
| `subsub_amp` | 1 | 1 | fx_octaver |
| `super_amp` | 1 | 1 | fx_octaver |
| `tierce` | 1 | 0 | organ_tonewheel |
| `time_dispersion` | 1 | 0 | fx_autotuner |
| `tone` | 1 | 0.25 | sc808_cymbal |
| `use_chorus` | 1 | 0 | rodeo |
| `use_compressor` | 1 | 0 | rodeo |
| `velcurve` | 1 | 0.8 | piano |
| `vibrato_delay` | 1 | 0.5 | blade |
| `vibrato_depth` | 1 | 0.15 | blade |
| `vibrato_onset` | 1 | 0.1 | blade |
| `vibrato_rate` | 1 | 6 | blade |
| `voice` | 1 | 0 | fx_vowel |
| `vowel_sound` | 1 | 1 | fx_vowel |
| `width` | 1 | 0 | chiplead |
| `wipe` | 1 | 0.5 | fft_brickwall |
