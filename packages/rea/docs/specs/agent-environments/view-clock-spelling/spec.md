# Spell a written clock as each view spells it

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

Some applications spell one instant differently by view. Mealie's recipe reads end timestamps in `Z`
(`2026-10-21T17:06:13.710410Z`) and its recipe list in `+00:00`. The state keeps each view's own values for the entities
it recorded, so those render as recorded, but a created or updated entity has only the values the write showed. A list
read after a create therefore rendered the new recipe's clocks in the item spelling. The write gate saw a contradiction
and left the create unserved, and serving would have listed the wrong spelling.

## Behaviour

- **Learning.** While checking that an item or list view reproduces its recordings, the gate compares each recorded
  object's clock fields with the entity's stored values. A field whose recorded value always names the same instant in
  one other spelling gets that spelling in the view's optional `clock_formats`. A field the view also shows as stored, or
  spells two ways, counting values that name another instant, gets none. A spelling has at most nine fraction digits.
  Instant equality includes all recorded fraction digits, not just milliseconds; offset changes and trailing zeros
  alone do not change the instant. The clock parser owns this precision and rendering reuses its parsed facts.
- **Bounds.** Each field retains at most one matching and one other-instant spelling, or a permanent mixed marker
  for either category. Rejected formats do not accumulate. The existing projection budget covers the learner's maps,
  keys, formats and returned view members before retention; exhaustion keeps the existing typed resource refusal.
  Preliminary list-query probes do not learn or retain clock state; only the final admitted view does.
- **Rendering.** A stored value the view never recorded, such as one a write made, is rendered in the view's spelling:
  its wall clock in the view's zone, under the view's separator, with its own fraction digits padded with zeros to the
  view's width. No digit is dropped, so a width learned from whole seconds does not cut a later value's fraction. An
  epoch spelling is computed from the instant.

The gate and serving render through the same function, so a served create lists with the list's spelling and reads back
with the item's. `data/get` returns the stored values.

## Acceptance

- The pilot recording's Mealie create is served on the list-query stack.
- Over the 50 published captures, one view learns a spelling (Mealie's recipe list), and every write verdict is unchanged.
- Every served write tool of the 50 captures still applies.
