// The control surface each def promises, in order.
//
// Pages address controls by name and the e2e suite sends them positionally, so
// a rename or a reorder is a silent break for every caller. Pinning the exact
// ordered list here turns that into a visible diff in review.
//
// Adding a control is a deliberate edit to this file, not an accident.
IdentityDictionary[
    \ssp_sine -> [\out, \freq, \amp, \pan, \attack, \sustain, \release],
    \ssp_noise -> [\out, \cutoff, \rq, \amp, \pan, \attack, \sustain, \release]
]
