# Implementation plan

1. **Bodiless writes.** The manifest accumulator tracks, per write group, whether every response was empty, and keeps
   the group when one succeeded.
2. **Omitted fields.** The write simulation records required fields its successful reads show missing, and the
   extracted state's views drop them.
3. **Projected reads.** Item planning sets aside unlocated projected reads and the view records their ordinals; the gate
   skips them, and serving replays projected calls to such a view.
4. **Sequences.** A values helper reads a digit-group value as an integer and fills the next one into its mask; the
   write rules, the gate and serving number sequences through it.
5. **Schema, tests and docs.** The view schema, manifest, gate, serving and unit tests, and the manifest, capture,
   state-view and state-writes docs.
