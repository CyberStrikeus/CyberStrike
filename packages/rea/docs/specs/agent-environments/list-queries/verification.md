# Verification

## Maintainer integration, 2026-10-22

Review of `62a9adf6c` found one attributable retry-coverage defect: a successful
insertion-order retry returned only a boolean, so confirmation and pending-write
cleanup still used the failed query page's covered entities. Two deterministic
guards failed (2 failures/82 passes): an unseen update was falsely confirmed,
and a later actual item read could no longer confirm it. The retry now returns
its successful `CheckOutcome`; guards, targets, exercised writes, interference,
placement and cleanup use that result. No duplicate post-retry analysis is added.
All 623 adjacent source tests, three 161-test stability runs, 8 compiled served
workflow boundaries, pinned static/build/docs/9 README checks and native public
pagination pass. Independent targeted Codex source review reports no definite
remaining defect. Public sample: 20.19s wall/28.63s CPU/490.31MiB sampled family
RSS, no observed descendants left. Earlier CI `39776472358` passed on `62a9adf6c`,
but cannot replace CI for the subsequent correction. Live application-write
fidelity remains unverified; the failed-candidate policy already in main is
unchanged, not a newly qualified rollback guarantee.

Representation cross-check found and reproduced one further stale counter on
`1c9bb2e7`: canonical string total `"3"` remained `"3"` after removing an entity
(one failure, 42 passes). Query-total interpretation now has one shared owner for
inference and rendering, preserving number versus canonical decimal-string type.
Unknown, padded, nonintegral or unsafe representations stay unmodeled/recorded;
no display convention is guessed. The updated 621-test source batch and pinned
typecheck/lint pass. The 102 query/write tests pass three consecutive runs, as do
build, docs/9 README, format and native held-out pagination. Independent targeted
Codex source review found no definite remaining format defect. This later public
run took 20.13s wall/28.72s CPU/492.53MiB sampled family RSS, all observed children
exited; it must not be hidden by the earlier faster runs or called a speedup.
Historical counts below are pinned to their stated heads.

Latest-main integration: main advanced to `e93e3b1e7` (APK signing declarations).
Merged it without dropping that feature; the sole conflict was the shared tool
description, resolved from main with only the existing list-query clause added.
The integrated tree passes all 619 adjacent source tests, pinned typecheck/lint,
build, docs/9 README checks and format validation. All 80 CLI/MCP/schema boundaries
also passed on `02ff6304d` before this main merge. An interleaved pre-merge docs
attempt saw stale generated skill output, and format saw the temporary conflict;
both attempts are retained and the completed integration checks pass. They are
not attributed to a defect in main. Fresh-head CI and compiled schema verification
remain necessary. Earlier CI run `39773075218` succeeded on `665ec74c6`, not on
the subsequent corrections or integration.

Independent read-only Codex review of `665ec74c6` found one additional omission
case: intersecting query-total names discarded a valid total when another envelope
omitted it. A new service guard failed on that head (one failure, 41 passes).
The producer now gathers supported totals and rejects actual contradictory counts,
not absent members; the existing projection guard preserves omission. The updated
527-test adjacent batch passes, including deleting a locally loaded entity and
observing the remaining total, plus an explicit contradictory-count control.
This review was source-derived until the regression was run; no live application
mutation was used. The original 618-test/80-boundary counts below describe the
prior reviewed head, not a newly invented final-head run.

The historical contributor runs below are not newly executed checks. This integration
uses main `2c3dd946d` and contributor head `30e90fc64`, retaining main's zero-position
whole-list guard and shared path decoder. New deterministic guards reproduced five
failures before correction: unsupported search syntax, identical repeated constraints,
stale query-only counts, and ambiguous empty-page membership. They now pass. Related
cleanup gives decoded single-valued queries one owner, preserves per-envelope counter
omission, and uses safe numeric precision instead of a nine-digit paging limit.

Executed with pinned Node 24.18.0/npm 11.16.0 on Linux: 526 adjacent source tests,
92 catalog/schema/server source tests, 80 public CLI/MCP/schema boundary tests, and 9 README
checks; typecheck/lint, runtime build, docs and format checks passed. Compilation is
not evidence of live deep-provider behavior. The 99 query/write regressions also
passed three consecutive runs; reordered constraints and equivalent encodings are
covered without weakening conflicting-value or whole-page assertions.

Real-data oracle: five read-only GitHub labels observations, including a repeated
complete collection to check snapshot stability. Only three requests enter the HAR;
the native `per_page=3&page=2` response is held out. CLI and MCP views agree; serving
returns the exact three native label facts with Evidence, and reordered query names
and three warm reads agree. Main needs replay plus a full-list read/client slice;
the query model needs one read. Structured replies total 13,282 versus 1,383 bytes;
catalog discovery is 1,057 versus 1,090 bytes after provenance clarification.

| Completed task                                          | Wall seconds | CPU seconds | Sampled family RSS MiB |
| ------------------------------------------------------- | -----------: | ----------: | ---------------------: |
| Main public workflow                                    |        10.01 |       15.46 |                 490.16 |
| Candidate public workflow, before catalog clarification |        10.33 |       16.19 |                 495.90 |
| Main plus actual Codex task                             |        31.55 |       22.56 |                 958.68 |
| Candidate plus Codex, original catalog                  |        31.09 |       18.77 |               1,006.82 |
| Candidate plus Codex, clarified catalog                 |        27.65 |       19.56 |                 952.25 |
| 526-test source batch                                   |         8.75 |       20.64 |               1,513.68 |

RSS is a 500 ms PID/start-identity process-family sample, not a kernel peak or hard
cap. Fresh runtime processes are separate from three later warm calls; OS/dependency
caches and host load are uncontrolled. No speedup or cache claim follows from these
single runs. All observed descendants exited. Node heap allowance was 2 GiB, 1 GiB
for runtime/model children; no ambient environment was persisted.

Actual Codex CLI (`gpt-6.1-sol`) returned correct IDs, names, Evidence and local/not-live
semantics in all three sessions. Main used two calls and 94,649 input tokens
(66,816 cached), 246 output. Candidate initially still made two calls: 79,752 input
(59,904 cached), 284 output. After clarifying that `state.source`, not
`replay.exact_match`, identifies computed answers, the unchanged prompt used one
call: 53,308 input (46,848 cached), 205 output. These are whole-session usage,
including common runner context, not reply-byte token estimates or a universal
agent-efficiency guarantee. Raw prompts, traces, exits and measurements were retained
locally, including intermediate failed test/typecheck attempts.

No GitHub mutation, live-application write fidelity, full fifty-capture census,
exhaustive search-language support or real deep-provider qualification was performed
in this integration. Unchanged-main create-response and ignored-write-query findings
are tracked separately in #6262 and are not claimed repaired by this PR.

Verified commit: 6db41d29 (this branch before this file, with #5787 and the write-plan branch's head `fe8ab584` merged in). Executed on macOS with Node v22.23.1 (the repository pins 24.18.0 in `.nvmrc`, which was
not installed); the probes were recorded against the live applications on six disposable Linux VMs.

## Gates

- `npm run build:cached`, `npm run check:fast` (typecheck and lint), `npm run format:check`, `npx knip`,
  `npm run scan:todos`, `npm run docs:check`, `npm run verify:test-discovery` and `npm run mcp-catalog:check`: passed.
- `npm run jscpd`: 3.44% duplicated lines over 3650 files, under the 3.5% gate.
- `npx vitest run --project domain --project services`: 7630 passed, 5 pre-existing skips.
- `npm run test:prepare`, then `npm run test:focused --` the environment serve and export CLI boundaries, the serve
  and served-writes MCP boundaries, the analysis-view CLI and MCP boundaries, the compact input schema boundary and
  tool schema validity: 8 files, 78 passed.

New tests: `environmentStateListQuery` (9 unit tests: each role found from a line, including filters on arrays and
object ids, search that leaves out URLs, sort spellings and nulls, paging by offset and by page, inert values, a filter
that excludes nothing kept inert, merging lines and refusals), one domain test in `environmentStateWrites` (a tool
recorded whole, filtered, searched, sorted and with a flag learns all four, and a create the filter later lists is
confirmed) and one serving test in `environmentStateWriteAnswer` (after a served create, new filter, search and sort
values list it; an unrecorded inert value replays).

## Fifty published captures

The environment-state view ran over the 50 published captures with each manifest's template rules, on builds with and
without this change (both with the prefix-variance branch merged, which some manifests need).

- 161 list views in 37 environments learn a query, and 223 checked lines are now answered by evaluating it. Roles
  learned: 27 filters, 37 searches, 35 sorts, 26 directions, 66 limits, 32 offsets, 25 page parameters and 220 inert
  parameters (each valid only for its recorded values).
- No other view changed shape and every write verdict is unchanged (31 served write tools).

## Six environments against their applications

The six environments of the fidelity comparison (NetBox, Komga, Mealie, n8n, Shlink, self-hosted Sentry) were compared
with their applications by `environment-compare`, with and without this change, on the comparison's probes and the
held-out sessions recorded since: NetBox 98.5%, Komga 91.5%, Mealie 94.0%, n8n 71.6%, Shlink 87.1% and Sentry 24.5%,
unchanged. Those probes repeat the capture's own query values, which recorded members already answer, so they cannot
show this change.

New held-out probes were therefore recorded against Komga and Mealie, the two applications whose list views learned
queries a new value can exercise, each restored from its snapshot first. After the capture's read-only prefix (so the
driver learns the application's ids), each learned query was called with values no recording used: other search terms
and filter values drawn from the seeded entities, the other sort direction, a page size of 1 and the second page.

| Application | Query calls | Exact before | Exact after | Right entities in the right order, before | After |
| ----------- | ----------: | -----------: | ----------: | ----------------------------------------: | ----: |
| Mealie      |          38 |            2 |          17 |                                         2 |    38 |
| Komga       |           9 |            0 |           0 |                                         0 |     8 |

Every Mealie call now lists the entities the application lists, in its order, where 36 of them listed the recorded
members before: sorts in the other direction (9) and new recipe searches and category filters (6) now match exactly.
The calls that still differ, and 8 of Komga's 9, differ only in paging members of the envelope: `per_page`, `page`,
`total_pages` and `next`/`previous` (Komga's `pageable` and `totalPages`) keep the base line's values when a call asks
for another page size or page. One Komga search term matched more series than the learned `name`/`url` fields, since
Komga also searches fields the list does not show. Over the whole probe Mealie went from 133 to 148 of 171 steps.

## What a run found

The first census learned Komga's `unpaged=false` as a filter on a field that is false for every entity, so `true` would
have emptied the list. A filter that excludes nothing is now inert, and a parameter filters only where a line shows it
excluding something: 37 of the census's 64 filters became inert values this way. A `-name` sort value matched the field loosely before its sign was read, so it sorted ascending;
the sign is now read first.

## Review round

The branch merged the list-lines branch at de13b0c5, which carries the write-plan branch through 43d98ea9 and main
d8a9673f. The gate's line selection, moved here to `environmentStateCheckedLines.ts`, takes the newer rules there, and
serving answers a whole line's outgrown page from its recording before the query selection. It also fixed seven
findings Greptile raised on this branch:

- a sort of an emptied collection answers no entities;
- an empty or unmatched search term stays inert;
- the gate checks a read with new query values as serving answers it;
- a recorded-member line keeps its recorded totals in the gate;
- a line with more than 12 query parameters is left unexplained, bounding the search;
- `__proto__` and similar names stay the query's own members;
- case-only ties sort in state order.

Each new test fails on the previous head. The partial-page counter test from the list-lines branch now expects the
page, a query line here, to answer from the state with the state's total.

The census on this head, with the fidelity branch's compare command merged in as before, at first served 29 of 183
writes, two fewer than at d5a07e7a. Airbyte's `GET /sources?workspaceIds=…` names a workspace no line recorded, so the
gate now checked it on the other workspace's line, whose `next` link names that workspace. The read listed the right
sources, but with no write exercised the failure marked the create and patch before it as side effects, and tainted
the created source so the read after its delete went unchecked. A read on a line it did not name is now compared in
its own envelope, which a test that fails on the previous head covers. The census again serves 31 of 183, every
verdict as at d5a07e7a. Its 160 query views (161 before) differ from d5a07e7a only as the findings intend:

- empty search terms are inert in Keycloak, PhotoPrism's albums and labels, Tandoor's keywords and Umami;
- Gitea, Grafana and Tandoor's units drop a search term that matched no shown field, with the line that carried it
  (Tandoor's units keep no query);
- PhotoPrism's photo query leaves line 199 and its 17 parameters unexplained, and learns lines 225 and 226 instead;
- the list-lines merge adds Bookstack's `total` and Linkding's `count` counters.

The six environments compare as before: NetBox 472 of 479 steps, Komga 549/600, Mealie 422/449, n8n 199/278, Shlink
176/202 and Sentry 91/372.

A second review round merged the list-lines branch at c68c63be, which carries the write-plan branch through 6257de93:
an update's identity member never takes a rule and a page size of zero bounds nothing, fixing two findings Greptile
raised here against that branch's code, and the paging rules move to `environmentStatePaging.ts`, which this branch's
line selection now imports. It also fixed three findings in this branch's gate:

- a read with no query answered on a query line is checked against that line's recorded members, as serving lists
  them, rather than against every entity;
- a query read on a line it did not name counts as gone only what it listed, so it cannot confirm a delete of a book
  that line listed;
- a read whose query applies a sort no longer fixes a create's insert position, so a later whole list can still try
  another rule.

Each new test fails on the previous head. Over the 50 captures every view and write verdict is as on the previous head,
and the six environments compare exactly as before.

It then merged the list-lines branch at ed4b6dbb, which carries the write-plan branch through 466ed8b4: entities named
as serving names them, interference weighed per write, a zero page size bounding nothing only where a recording listed
items under it, and the other fixes of that branch's fifteenth round. Over the 50 captures every view and write verdict
is again as before, and the six environments compare exactly as before.

A third review round merged the list-lines branch at 8eea9f6d, which carries the write-plan branch through 7cef2fb2,
and fixed Greptile's finding on the second round's sort rule: a sorted read whose values tie shows the state's order
among them, so it still fixes a create's insert position, and a later whole list can no longer move the create where
that read showed otherwise. Its test fails on the previous head. Over the 50 captures every view and write verdict is
as before, and the six environments compare exactly as before. A follow-up narrowed it per entity: a sorted read fixes a create's position only when the
sort leaves the created entity itself tied, so a tie between other books no longer locks it. It also merged
the list-lines branch at 27dd6062, carrying the write-plan branch through 45a5c8b9.
