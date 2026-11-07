# Verification

Verified base: bf1eeee9 (fetched main).

Executed on the implementation worktree after `npm ci` and `npm run
build:cached`; every check below ran as written in this pass, after the last
source change.

- `npm run check:fast`: typecheck and lint passed.
- `npm run format:check`: passed.
- `npx knip`: passed (exit 0).
- `npm run jscpd`: 3.40% duplicated lines over 3331 files, under the 3.5%
  gate; no clone involves a file this change adds.
- `npm run scan:todos`: passed.
- `npm run docs:check`: the built documentation checks and the README
  consistency conformance test (5 tests) passed.
- `npx vitest run --project domain --project services`: 338 files, 5830 tests
  passed, 5 pre-existing skips.
- `npm run test:focused --` the analysis-view MCP and CLI boundaries, the
  environment serve and export CLI boundaries, the environment serve MCP
  boundary, the compact input-schema MCP budget, the analysis-detail and
  advertised-input-example contracts and the qlog acceptance test: 9 files, 68
  tests passed, 1 pre-existing skip.

Real captures (outside the test suite): the built view ran through the
application service on 44 recorded captures (39 HAR, 5 browser scenario) with
all three template rules, in 7 to 46 ms each. 42 produced a state: 568 types,
2,213 entities, 2 documents, and 710 of 1,258 read tools state-backed (211
item, 497 list, 2 document views). The other read tools are recorded views:
306 not entities (singletons, configuration and computed views), 129 without
an identity field, 32 with unusable bodies (most are Nomad bodies with
integers beyond exact native conversion), 31 lists and 7 items that do not
reproduce, 26 without an initial recording, 12 query `POST`s and 5 documents
read under several queries. The two browser-scenario captures that did not
produce a state are refused inline with `resource_constraint`, as the
environment manifest view refuses them on unchanged main.

Not covered here: serving tool calls from the state, the AgentEnv data plane
and write effects, which are later increments.

## Linux follow-up (2026-10-20)

Node 24.18.0 / npm 11.16.0, with the author's `47f8a27a9` main integration
preserved and main `d72021b0d` integrated. Eight regression cases failed across
two pre-fix runs: membership additions/removals across a write, field presence,
sparse field observations, and compact compound totals. The fixes compare
membership before selecting latest recordings, retain each field's observation
across sparse reads, and recognize `totalcount`/`itemcount`. API-base grouping
appends to its owned arrays; identity intersection uses a set and skips the
first response's self-intersection.

Executed checks:

- Relevant domain, application and contract suites: 39 files, 493 passed,
  3 existing skips. Includes empty/stable lists, query variants, field additions
  and removals, sparse reads, identity proof and deferred document paths.
- Broader compiled CLI/MCP/environment, compact schema and qlog acceptance:
  7 files, 65 passed, 1 existing skip. After the final state fixes, both selected
  compiled state CLI/MCP cases passed again (36 other cases deselected).
- Final serial static/build/artifact gate: 11 tasks passed. Typecheck, lint,
  format, knip, package metadata and runtime/catalog generation all ran.
- Final documentation/catalog/format validation: 9 tasks passed; architecture
  guards passed across 1,602 source files; README consistency: 5 tests passed.

Real Gitea 28.2.0 used an isolated SQLite database. An owned Node fetch HAR
recorder captured actual API exchanges, omitting transport credentials:

- Three exchanges: empty repository search, creation through `/user/repos`,
  then the same search. On exactly the same authenticated Evidence, pre-fix
  `29e745923` published one created repository as initial state; the final
  source publishes none and keeps the search recorded with `fields-differ`.
- Eleven exchanges: initial issue list/details and topics, PATCH, PUT and
  DELETE, then subsequent reads. The state keeps the two original issues
  before ordinal 4 and the original topics document at ordinal 3. File CLI and
  default stdio MCP agree; six HTTP SDK replays reproduce original responses.
- Actual Chromium `capture_browser_scenario`: two transactions, eight events,
  zero dropped. The state uses record order, extracts one issue, and keeps list
  and item plans; file CLI and default stdio MCP agree. The earlier 12.6 MB
  real browser capture also projects, keeping oversized bodies recorded with
  `body-unusable` rather than parsing them into state. Owned servers and browser
  processes were stopped.

### Resource and performance measurements

One CPU and one worker. Process-family RSS sums were sampled every 50 ms and
may count shared pages twice. Final source suites: 39.669 s wall / 39.486 CPU s /
898.42 MiB peak; broader boundaries: 270.171 s / 267.136 CPU s / 2,130.78 MiB;
final static/build: 199.683 s / 199.523 CPU s / 4,689.07 MiB; final live HAR
workflow: 22.836 s / 19.880 CPU s / 1,072.43 MiB; actual browser-state workflow:
12.734 s / 10.941 CPU s / 1,549.80 MiB. The qlog acceptance lane intentionally
exhausts an isolated decoder heap and verifies that MCP remains usable; no
workspace OOM occurred.

The first follow-up benchmark used pre-fix `29e745923` and `6ad63bcc2`, the same
completed Evidence files, Node and CPU affinity. One fresh process per revision,
with a first call and two warm repeats; filesystem caches were not cleared.
Complete normalized output digests matched for both synthetic projection tasks.

| Work                                            | Before: first / warm (ms) | After: first / warm (ms) |
| ----------------------------------------------- | ------------------------- | ------------------------ |
| Group 8,000 templates (helper only)             | 320.08 / 81.01–81.46      | 11.89 / 3.88–4.33        |
| File-to-state projection, 2,000 collections     | 1,321.57 / 732.00–939.57  | 1,268.76 / 781.34–811.05 |
| File-to-state projection, one 15,001-field item | 657.05 / 494.82–501.19    | 377.78 / 347.62–380.87   |

Combined benchmark processes, including imports, three helper calls, six
projections and the live-capture comparison: before 6.536 s wall / 6.496 CPU s /
370.82 MiB peak; after 5.077 s / 5.056 CPU s / 386.53 MiB. Grouping and wide
identity inference improved; the 2,000-collection projection has overlapping
warm timings, and peak memory did not decrease. These few runs do not establish
a general speedup. Model token usage was not measured; no model-task scoring
was run. Initial external probe attempts had incorrect CLI positional arguments
and assumed coverage counted records rather than grouped tools; those driver
errors were corrected before the successful complete runs.

No new macOS/Windows runtime, state serving, AgentEnv data-plane or write-effects
claim is made. A type first observed only after an unrelated-root write may
still lack the earlier observation needed to detect its effect. Item-shaped
and delete-only document paths remain recorded, as specified.

## Post-merge write-cutoff follow-up

Base `3fca2e0ca` includes #5319 and the validated immutable-capture reuse from
#5349. The remaining review finding was repeated write-root parsing for each
read type and again during output assembly. One admitted prefix/wildcard index
now owns parsed write roots, with per-projection positive/negative cutoff
caching. Backed type membership is collected once, replacing another plan scan.
The old linear matcher is removed. Prefix, parameter, redacted-root and timeline
semantics are preserved; no cross-request cache or new authority is introduced.

- Source checks: 41 files, 508 passed, 3 existing skips, including independent
  matching-oracle and 12,000-segment iterative-lookup checks.
- Serial static/build/artifact gate: 11 tasks passed, 197.356 s wall /
  197.195 CPU s / 4,744.92 MiB peak process-family RSS.
- Both selected compiled state CLI/MCP cases passed after rebuilding.
- Live Gitea HAR workflows and fresh actual Chromium capture passed again:
  initial values, recorded fallbacks, CLI/default stdio parity and six exact
  HTTP replays. HAR workflow: 22.834 s wall / 19.623 CPU s / 1,067.36 MiB;
  browser workflow: 22.858 s / 20.912 CPU s / 1,546.59 MiB. Owned processes stopped.

The same completed Evidence with 1,000 collection reads and 1,000 unrelated
writes was projected before and after on one CPU. Two larger full-HAR inputs
(3,000/4,000 total records) were refused by the existing 96 MiB admission budget;
the limit was retained. One fresh process per revision, first call plus one
warm repeat, filesystem caches not cleared:

| Complete file-to-state projection                        | Main before         | Follow-up           |
| -------------------------------------------------------- | ------------------- | ------------------- |
| First call wall / CPU (ms)                               | 1,727.89 / 1,727.36 | 1,244.82 / 1,244.05 |
| Warm call wall / CPU (ms)                                | 1,300.84 / 1,300.42 | 624.01 / 623.89     |
| Process wall / CPU (s), including imports and both calls | 4.690 / 4.363       | 3.370 / 3.062       |
| Sampled process-family peak RSS (MiB)                    | 365.84              | 360.03              |

Parent Evidence IDs and complete normalized output digests were identical.
RSS sampling is every 50 ms, includes descendants and can double-count shared
pages; these few runs do not establish a general memory reduction. Model token
usage remains unmeasured. No workspace OOM occurred.
