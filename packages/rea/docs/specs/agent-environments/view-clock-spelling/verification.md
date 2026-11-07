# Verification

Executed on macOS with Node v22.23.1 on this branch with the write-plan branch's head `45a5c8b9` merged in. The pilot recordings
were made against live applications on six disposable Linux VMs, each restored from a snapshot first.

## Gates

- `npm run build:cached`, `npm run check:fast` (typecheck and lint, no warnings in the changed files),
  `npm run format:check`, `npx knip`, `npm run scan:todos`, `npm run docs:check`, `npm run verify:test-discovery` and
  `npm run mcp-catalog:check`: passed.
- `npm run jscpd`: 3.43% duplicated lines over 3753 files.
- `npx vitest run --project domain --project services`: 7755 passed, 5 pre-existing skips.
- `npm run test:prepare`, then `npm run test:focused --` the environment serve and export CLI boundaries, the serve
  and served-writes MCP boundaries, the analysis-view CLI and MCP boundaries, the compact input schema boundary and
  tool schema validity: 8 files, 79 passed.

## Tests

- Gate: a list that spells clocks `+00:00` where item reads spell `Z` learns both spellings, the item view learns none,
  and a create read back by both is served; a create whose clock has a fraction is served where the list's spelling was
  learned from whole seconds; a list that spells a field both ways, at the stored instant or another, learns nothing.
- Serving: a served create lists with the list's spelling and reads back with the item's.
- Unit: re-spelling keeps a value's fraction digits at any offset and across a date change, pads them to the format's
  width without dropping any, and formats an epoch spelling from the instant; an epoch value's milliseconds become
  fraction digits.
- Schema: a view clock spelling wider than nine fraction digits is refused.
- The gate and serving tests fail on `264ce410`, the write-plan head they were written on.

## Pilot recordings

Mealie's recipe reads spell clocks `Z` and its recipe list `+00:00`. On this branch alone the list line the create is
read back on keeps its recorded members, so the create stays unserved; per-line list membership and list queries
(#5787, #5800) answer that line from the state. Built on the list-query stack (#5800 with #5699 merged):

- Mealie's `post_recipes` goes from `contradicted` to served, and Mealie's held-out sessions agree on 298 of 310 steps,
  up from 294.
- With the assigned-values branch (#6136) too, all three Mealie write tools are served, at 302 of 310.
- The other five applications are unchanged.

## Published captures

- Over the 50 published captures, one view learns a spelling: Mealie's recipe list (`dateUpdated`, `createdAt`,
  `updatedAt`). Every write verdict is unchanged.
- The served smoke applies all 31 served write tools.
