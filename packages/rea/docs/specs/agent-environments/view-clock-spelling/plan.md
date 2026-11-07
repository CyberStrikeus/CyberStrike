# Implementation plan

1. **Re-spelling.** A values helper spells a clock in another format: its wall clock in the format's zone, with its own
   fraction digits padded to the format's width.
2. **Learning.** The gate notes, per view, the spelling of each clock field that differs from the stored value, while it
   checks the view's recordings; the view gains `clock_formats` when any field always differs.
3. **Rendering.** Entity rendering spells a stored value in the view's spelling when the view has no value of its own.
4. **Schema, tests and docs.** The view schema, gate, serving and unit tests, and the state-view docs.
