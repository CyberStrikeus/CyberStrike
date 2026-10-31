# Verification

Executed on macOS with Node v22.23.1, one change at a time on the state-targets branch, over the 50 published
capture-built environments (each app's latest capture). The served smoke rebuilds each manifest with the tree under
test and applies every served write tool. The serving check answers every recorded read made before the capture's
first write through state serving and compares it with the recording; it reads no calls from the five
browser-scenario captures. The session replay answers every recorded call in order, writes included, through state
serving, reading records with REA's own capture parser, and compares the reads; it covers all 50 captures.

## Gates

- `npm run -s check:fast`, `npm run -s format:check`, `npx knip`, `npm run -s scan:todos`, `npm run -s docs:check`,
  `npm run -s verify:test-discovery` and `npm run -s mcp-catalog:check`: passed.
- `npm run jscpd`: 3.57% duplicated lines over 4235 files.
- `npx vitest run --project domain --project services`: 9545 passed, 6 pre-existing skips. The 10 failures (JavaScript
  Map endpoints, a returned invocation's alias graph, Frida cleanup) fail the same way on main.
- `npm run -s test:prepare`, then `npm run -s test:focused --` the environment serve and export CLI boundaries, the
  serve and served-writes MCP boundaries, the analysis-view CLI and MCP boundaries, the compact input schema boundary
  and tool schema validity: 8 files, 91 passed.

## Measurements

| Step                         | Served | No state target | State-backed read views | Reads before first write | Session reads  |
| ---------------------------- | ------ | --------------- | ----------------------- | ------------------------ | -------------- |
| state targets                | 62     | 59              | 1,151                   | 2,085 of 2,155           | 2,764 of 3,022 |
| blame and constant guard     | 63     | 59              | 1,151                   | 2,085 of 2,155           | 2,764 of 3,022 |
| update rules                 | 68     | 59              | 1,151                   | 2,085 of 2,155           | 2,763 of 3,022 |
| view order                   | 69     | 59              | 1,151                   | 2,085 of 2,155           | 2,763 of 3,022 |
| bulk writes and item actions | 71     | 48              | 1,151                   | 2,085 of 2,155           | 2,763 of 3,022 |
| per-response members         | 71     | 46              | 1,153                   | 2,087 of 2,162           | 2,766 of 3,031 |
| nested counters              | 71     | 46              | 1,153                   | 2,087 of 2,162           | 2,766 of 3,031 |
| created nested clocks        | 71     | 46              | 1,153                   | 2,087 of 2,162           | 2,766 of 3,031 |
| unshown writes refused       | 69     | 46              | 1,153                   | 2,087 of 2,162           | 2,766 of 3,031 |
| catalog values, atomic bulk  | 69     | 46              | 1,153                   | 2,087 of 2,162           | 2,766 of 3,031 |
| review fixes                 | 69     | 46              | 1,153                   | 2,087 of 2,162           | 2,766 of 3,031 |
| scoped envelopes, bulk rows  | 69     | 48              | 1,151                   | 2,085 of 2,155           | 2,763 of 3,022 |

All 187 write tools are counted at every step, and the served smoke applies every served write tool.

- **Scoped envelopes, bulk rows:** a shared envelope masks only members minted on every path, so Vault's identity entity
  and group item views, which matched one of four and one of three recorded reads from the state, replay their
  recordings, and Vault's entity update and delete lose their state target. Serving bulk responses that list each
  written entity changes no capture's verdict.
- **Review fixes:** literal bulk ids, per-entity bulk values, pinned bulk delete members, comparison ids per
  collection, echoed creation clocks, required held clocks, nested clocks checked against every call, learned sorts
  kept open to contrary reads and limited to the read's own entities, one query check per recorded call, guards
  relaxed only by successful calls with the exemplar's query, and slash-named counters. No tool's verdict and no
  session read changed; each fix has a test that fails without it.

- **Newly served:** Ghost's post create and update, Metabase's card create and update, n8n's workflow update,
  Navidrome's playlist create, and the NocoDB and Mailpit bulk deletes.
- **No longer served:** Gitea's issue update. Its create, update and read share one second, so the evidence cannot show
  the update stamping `updated_at`, and serving it left the clock as it was.
- **Refused that were briefly served on this branch:** EspoCRM's task update, for the same reason, with `modifiedById`
  absent from its create response.
- **Session reads:** one read is lost at Ghost #74, a 404 right after the served create whose delete the recording
  lacks; Vault #80 answers 404 after an unserved create, as a served read on an entity only a replayed write made does.
- Ghost's create and update accept only the recorded html, and Metabase's create only the recorded collection,
  display, type and query; the served catalog shows those values.

Every change had an independent review that rebuilt it and tried to refute it; the corrections they found are part of
the change. A final review of the whole branch found one wrongly served update (EspoCRM) and the hidden pinned values,
both fixed.

## Cost

Over the 50 captures, one Node v24.22.1 process per sweep builds the environment-state and environment-manifest views
of every capture (macOS arm64, warm medians of three runs; the cold first run is within 2% of them):

| Tree                    | Wall   | CPU    | Peak RSS | Environment-state view | Its results |
| ----------------------- | ------ | ------ | -------- | ---------------------- | ----------- |
| main `d87e73f2`         | 2.61 s | 3.41 s | 516 MiB  | 1,791 ms               | 3.69 MB     |
| state targets (`#6385`) | 2.96 s | 3.82 s | 540 MiB  | 2,093 ms               | 3.84 MB     |
| this branch             | 3.06 s | 4.07 s | 601 MiB  | 2,224 ms               | 3.85 MB     |

The write rules add 0.10 s wall, 0.25 s CPU and 61 MiB of peak memory to the sweep while serving 7 more write tools.
Agent tokens were not measured; the views' results grow by 0.3%.

## Not included

- Templating literal ids by value: an opt-in rule served Grafana's folder delete and Vault's policy delete, but both
  targets came from unserved writes, so serving them answered their own recorded calls wrongly.
- Completing a created entity from a later read: it served Bookstack's page create wrongly.
- Soft deletes, appended relation rows, rendered markup, reverse embeds, identity aliases and resource names.

## Linux integration and review corrections, 2026-10-24

The following is separate from the historical 50-capture measurements above.
Node 24.22.1, baseline `3ce311757`, reviewed implementation `352c0278d`:

- 1,236 selected source tests passed. Typecheck, built lint/module boundaries,
  format, knip, metadata, architecture guards and documentation checks passed.
- Seven review regression checks failed before correction and passed after it.
  Earlier structured update values now retain canonical equality digests within
  the history budget. A shared envelope masks only members independently proved
  minted on every concrete path. Empty advertised literals are widened while
  execution enforces their values, and pinned queries are optional so their
  execution defaults can run. Numeric and string bulk id arrays stay distinct.
- Nineteen compiled SDK/schema checks passed, including real HTTP MCP discovery,
  empty fixed values, omitted empty and nonempty queries, and unchanged state
  after refused writes. Live Gemini API execution was not performed.
- Four public datasets were downloaded at immutable Hugging Face revisions:
  NocoDB `d0f7e040`, Ghost `6d5b2d1c`, Metabase `fa2aa0fd`, and Mailpit
  `416b29be`, under `earakely-scale/*Env-REA`. Capture hashes, full calls,
  independent recorded JSON comparisons, runtime identities and resource
  receipts were retained locally. These were recorded real applications;
  the original applications were not re-recorded in this verification.

| Capture  | Eligible write tools before / after | Initial reads matching | Session reads matching |
| -------- | ----------------------------------- | ---------------------- | ---------------------- |
| NocoDB   | 0 / 3                               | 20 / 20                | 80 / 92                |
| Ghost    | 1 / 1                               | 19 / 20                | 72 / 88                |
| Metabase | 1 / 2                               | 19 / 22                | 99 / 122               |
| Mailpit  | 0 / 1                               | 51 / 52                | 51 / 56                |

Every previously matching read remains matching, record by record. Real CLI
listeners and the MCP SDK reproduce the shared application's outcomes. The
feature session applies six NocoDB mutations, one Ghost deletion and one
Metabase update; the baseline applies only the Ghost deletion. A `state`
answer with view `missing` is not counted as an applied write. Mailpit exchange
65 is refused because its target was introduced only by an unserved create.
Eligibility does not establish that every recorded write can run on the initial
state, and the remaining read mismatches are preserved coverage gaps.

Three alternating fresh producer sweeps over all four captures had median
wall/CPU/cgroup peak of 5.360 s / 4.263 s / 327.3 MiB before and
4.960 s / 4.357 s / 323.1 MiB after. Ranges overlap. One complete SDK session
per app/revision, 403 versus 413 calls, took 20.905 s / 19.039 s / 508.7 MiB
before and 23.426 s / 19.396 s / 462.8 MiB after; these are single observations
with different write coverage, not a speed or memory improvement claim.

Catalog estimates (`cl100k_base`) were 8,630 / 9,408 tokens for NocoDB,
11,355 / 11,355 for Ghost, 12,162 / 12,648 for Metabase and 2,955 / 3,138
for Mailpit. Arguments, instructions and text replies were also counted in
retained receipts; actual model usage, prompts and client rendering were not
measured. No token saving is claimed.

Processes were fresh, OS caches warm or uncontrolled, on a shared Linux host.
Each task used one CPU, a 3 GiB early stop / 4 GiB hard limit and zero swap.
All eight recorded-data task groups exited zero, verified payload cleanup,
and observed no OOM or limit events. Payload-exit counters were verified;
final whole-scope counters were unavailable. Downloads, builds and runtime
identity preparation are excluded from task measurements. The current
four-capture verification does not requalify the earlier 50-capture totals.

### Bulk-response follow-up qualification

The follow-up at `f4bc513dd` classifies every returned bulk element and checks
all recorded calls with the shared serving renderer. Nested parsed-body leases
retain their enclosing scratch charge. Literal JSON IDs never pass through a
synthetic URL. The author's subsequent bulk regressions and measurement note
were retained when integrating `a319ba1af`; their historical census does not
measure this follow-up.

A fresh four-capture producer sweep and real CLI/MCP replay retained every
previously matching read (109/114 initial, 302/358 session). NocoDB, Ghost and
Metabase plans and complete SDK calls equal `9942863b2`. Mailpit's text/plain
`ok` deletion acknowledgement is not parsed by the state JSON owner, so its
contents remain unknown and its write tool is now withheld as `body-unusable`.
The prior session already refused this deletion for a missing target; no
previously applied mutation was lost. Plain-text acknowledgement support remains
unverified rather than treating unknown contents as empty. The three other
captures retain the same eight applied mutations.

This qualification-only sweep took 5.857 s wall / 5.413 s CPU / 329.9 MiB peak;
the complete SDK replay took 23.264 s / 22.298 s / 474.0 MiB. These single
observations are not pooled with the earlier performance cohort. Payload cleanup
and payload-exit resource counters were verified, with no OOM/limit events;
final whole-scope counters and actual model token usage remain unmeasured.

## Review round on main `3d84215b`, 2026-10-24

Three automated review findings were fixed in `d0198389f` and `7c25ad4dc`: a create compares the other calls' request
bodies one at a time inside their parsing reservations, an echoed reference to a nested object stays pinned when the
plan cannot rebuild the object, and a sorted read view a later read contradicts is recorded and loses the
confirmations it gave. On macOS with Node v24.22.1 at `05566419e`, the static gates passed, `npx vitest run --project
domain --project services` passed (10,164, 6 skipped; the reference-lifetimes file whose worker crashes on main was
excluded) and the focused build, export, serve and analysis-view boundaries passed (10 files, 93). Over the same 50
captures every write plan, session replay and served read equals `0895c89bc`'s: 187 write tools with 68 served, 68 of
68 smoke calls, 1,151 views, and 2,085 of 2,155 initial and 2,763 of 3,022 session reads matching.
