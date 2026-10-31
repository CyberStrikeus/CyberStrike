# Verification

Verified base: 18aa9af2b2c26fd114113dd39528a91224801840 (fetched main).

Executed on the implementation worktree after `npm ci`, `npm run build` and
`npm run test:prepare`; every check below ran as written in this pass. The
built-group projects and the built-CLI checks ran against a `dist/` rebuilt
after the last source change.

- `npm run check:fast`: typecheck and lint passed (2 tasks successful).
- `npm run format` then `npm run format:check`: all 4028 matched files use the
  correct format.
- `npx knip`: ok (exit 0, no unused files, exports or dependencies reported).
- `npm run check:ci:tasks`: typecheck, lint:built (3730 files, 0 errors), format:check, knip,
  metadata:check, jscpd (3.35% duplicated lines over 3140 files and 2581
  clones, under the 3.5% gate) and the tech-debt marker scan passed (8 tasks,
  3 replayed from this worktree's cache).
- `npm run docs:check`: the six built documentation checks and the README
  consistency conformance test (5 tests) passed; no tracked generated file
  changed.
- `npx vitest run --project domain --project services` (full source group):
  312 files, 5412 tests passed, 3 pre-existing skips.
- `npx vitest run --project cli-boundary` (full project): 111 files; 659 tests passed, 2
  pre-existing skips, 8 failed in three files that drive no analysis-view
  command (`closedStdout`, `commandFinalizationCancellation`,
  `javascriptApplicationJsonOutput`). Re-run in isolation on this worktree the
  three WASM interrupt cases and the four JavaScript JSON-output cases passed
  and only `closedStdout` "stops quietly when the reader closes during streamed
  JSON" (`inspect-sqlite-database`) exited 1 instead of 141. The same three
  files run on a clean export of 18aa9af2 (`git archive`, fresh `npm ci`,
  `npm run build`, `npm run test:prepare`, nothing from this slice) reproduced
  exactly that one failure and passed the other 16, so none of the eight is
  attributable to this slice and none was changed here.
- `npx vitest run --project mcp-boundary` (full project): 153 files passed, 2
  pre-existing file skips; 901 tests passed, 7 pre-existing skips, no failures.
- `npx vitest run --project acceptance` (full project): 123 files passed, 1
  pre-existing file skip; 608 tests passed, 13 pre-existing skips, no failures.
- Built CLI end-to-end on the 28-record Grafana-shaped capture:
  `inspect-web-network-capture ... har --format json` then
  `inspect-analysis-view` with `environment-manifest`, with and without the
  three opt-in rules, and with `api-surface`, twice each. Without rules the 22
  tool templates plus the 3 primary-origin exclusions equal the 25 api-surface
  groups on that origin and every `path_template` equals its
  `api_surface_template`; with rules `/api/dashboards/uid/{uid}`,
  `/api/folders/{uid}` (observed values `fg1jo91e57e2ob` and `general`, records
  12 and 13), `/api/plugins/{plugin_id}/settings` and
  `/api/datasources/uid/{uid}/health` appear across 19 tools with 13 templated
  groups; `normalized_result` and `evidence_id` are identical across the two
  runs of each view; records carry only pointer keys; no recorded body or query
  value appears; three unknowns and `view_digest` are present; confidence is
  `inferred` with authority `historical-reference`.
- Built CLI on the same capture extended with `GET /api/teams/search` and
  `GET /api/teams/mine` (30 records), all three rules selected:
  `/api/teams/{numeric}` keeps observed value `1` only and `get_teams_search`
  and `get_teams_mine` stay their own tools; 21 tools, 13 templated groups.

## Independent review

Findings repaired at their owning boundary:

1. A `__proto__` key in a recorded JSON body became a prototype rather than an
   own property, and the schema clone then dropped it silently. The manifest
   accumulator builds body shapes with `Object.fromEntries`, omits that key and
   states the omission as a limitation; a domain regression covers it.
2. The contract example carried a readonly tuple that the mutable JSON example
   type rejects; the example keeps a literal-typed mutable tuple.
3. Folding a literal sibling into an already templated position took the parts
   of the earliest group, so a literal recorded before the token kept its
   literal, dropped the parameter and claimed the token's record under a
   template it does not match. `mergeGroups` now takes the templated group as
   the shape for parts while the earliest group still names
   `api_surface_template`, `body_shape` and record order; a domain regression
   with the literal recorded first covers it.
4. The request-body parse accepted `text/plain` and `text/markdown` bodies; it
   accepts only `application/json` and `application/*+json`, and the capture
   guide states the earliest-record rule; a domain test covers both media
   types.
5. A repeated entry in `template_rules` was accepted, echoed and hashed into
   `view_digest` while the accumulator deduplicated it; the request schema
   refuses repeats with `template_rules must not repeat a rule`.
6. The sibling-variance fold-in absorbed a non-conforming literal into a
   parameter produced by one of the four format rules, so `/api/teams/mine`
   became an observed value of `/api/teams/{numeric}` and the published rule no
   longer described every observed value. Fold-in is restricted to parameters
   produced by the opt-in rules; literal siblings of a format-rule parameter
   stay their own tools or merge among themselves under `sibling-variance`
   only when identifier-like. A domain test with `/api/teams/1`,
   `/api/teams/2`, `/api/teams/search` and `/api/teams/mine`, the capture
   guide and the spec state the rule; the built-CLI check above exercises it.

## Hosted lane

- `real-web-network-captures` (hosted ubuntu-24.04, workflow run
  https://github.com/earakely-scale/rea/actions/runs/39097105064 on the fork
  at 2d95597f) passed with the manifest block of
  `scripts/verify-web-network-captures.mjs` executed against the lane's
  producer and mitmproxy captures. The first run at 61d35369 failed only in
  that block: the refusal check stringified the whole MCP result, so the
  declared `[` literal matched the result envelope; the follow-up compares the
  parsed refusal as the api-surface branch does.

## Scope and measurement limits

macOS `/usr/bin/time -l`, command accounting only: `npm run check:fast`
reported 5.23 seconds elapsed, 24.20 user and 2.92 system seconds, and
4449140736 bytes maximum RSS; `npm run format` 0.74 seconds elapsed, 4.14
user and 0.73 system seconds, and 223363072 bytes maximum RSS;
`npm run format:check` 0.66 seconds elapsed, 4.03 user and 0.61 system
seconds, and 218759168 bytes maximum RSS; the full source group reported
25.10 seconds elapsed, 67.26 user and 2.72 system seconds, and 2659172352
bytes maximum RSS; `npx knip` 3.68 seconds elapsed, 5.24 user and 0.70 system
seconds, and 865599488 bytes maximum RSS; `npm run check:ci:tasks` 4.65
seconds elapsed, 15.03 user and 4.36 system seconds, and 843333632 bytes
maximum RSS; `npm run docs:check` 3.61 seconds elapsed, 3.81 user and 0.99
system seconds, and 289472512 bytes maximum RSS; the full `cli-boundary`
project 425.66 seconds elapsed, 703.52 user and 206.77 system seconds, and
630456320 bytes maximum RSS; the full `mcp-boundary` project 164.19 seconds
elapsed, 302.85 user and 47.08 system seconds, and 4457529344 bytes maximum
RSS; the full `acceptance` project 960.25 seconds elapsed, 1520.91 user and
520.68 system seconds, and 800063488 bytes maximum RSS. `npx knip` ran while
the `cli-boundary` project was executing, and the clean 18aa9af2 export's
`npm ci`, build and test preparation overlapped the `mcp-boundary` and
`acceptance` runs, so those elapsed figures include host contention. Token usage and full process-family peak are
unmeasured. Local real-tool verification ran on macOS arm64; the hosted Linux lane result is recorded above.

## Automated review findings on the PR (2026-10-18)

Codex and Greptile left seven inline findings on morluto/rea#4954 at
b6d18d23; each was checked against the code and addressed in one follow-up
commit, with a regression test where the behaviour is observable:

- Body shapes walked nested values (both reviewers, P1): `#bodyShape` passed
  the text to `inferJsonShape`, whose per-node path copies grow with the square
  of depth, so a small deeply nested body could exceed the budget it had
  reserved. The reader now parses once and reads top-level key types from the
  parsed object; a test feeds a 2,500-level nested body and gets the four
  top-level types back.
- Literal route parts were not admitted (Codex, P2): a path of many short
  literal segments materialized one part object per segment without a charge.
  Every route part is now charged before the group is created; a test shows a
  5,000-segment path refused under a 1 MiB budget while a 100-segment path is
  retained.
- `sibling-variance` rebuilt a key over the whole route at every position
  (Greptile, P1): routes longer than 32 segments are no longer compared, the
  manifest states it in a limitation, and a test shows two 39-segment siblings
  left unmerged beside a merged short pair.
- `after-uid-literal` templated stop words (Greptile, P1): the rule now skips
  them; a test keeps `/api/items/uid/search` literal beside
  `/api/items/uid/{uid}`.
- Tool-name suffixes restarted at 2 on every collision (Greptile, P2): the
  registry keeps the next suffix per base; a test projects 300 dotted literals
  into `get_item` and `get_item_2` through `get_item_300`.
- An exclusion row could lose its templated flag when two groups printed the
  same row (Codex, P2): the flag is now the logical or of both. The scenario
  needs a literal segment spelled `{numeric}`, which the WHATWG URL parser
  percent-encodes in recorded paths, so no capture reaches it; the one-line
  defence is kept without a test.

Checks after the change: `oxfmt --check .` clean; `tsc --noEmit` clean;
`npm run lint` and `verify:module-boundaries` clean (the complexity warnings
on `#append` predate the change); `npx knip` no findings; `npm run jscpd`
3.35 % duplicated lines; `scan:todos` none; `verify:test-discovery` 1,580
files once; `vitest run` over the view, accumulator, JSON-shape and contract
example tests 32 passed in 4 files; `vitest run` over the service, CLI and
MCP boundary tests for analysis views 73 passed in 3 files.

A sixth automated finding (Codex) was addressed after the collaborator's
merge of main: `sibling-variance` merged a whole bucket when any one literal
carried a digit, so `/api/items/mine` could be folded into `{item_id}`. The
rule now partitions the bucket and merges only the identifier-like siblings
(each with a digit or colon, or three or more hyphenated names under a plural
literal), leaving the other literals as their own tools; with the rule alone
the fixture therefore keeps `/api/folders/general` and
`/api/folders/fg1jo91e57e2ob` separate, while all three rules still fold
`general` into `/api/folders/{uid}` through the opaque-token parameter. Tests:
the new partition case and the updated single-rule table.

Follow-up mixed-cohort regressions reproduced two omissions on `dd87f54e`
with main `8307ea37`: two coded siblings prevented three qualifying hyphenated
siblings from joining the parameter, and one coded sibling was omitted when
three hyphenated siblings merged. Eligibility now belongs to one Set that
combines both qualifying cohorts before the minimum group size is checked.
The consumer reuses that Set and materializes its merge order once. Three
cases cover both omissions and preserve the three-hyphen minimum when only
two hyphenated siblings accompany coded identifiers; `mine` and `search`
remain literal and every source record remains represented.
