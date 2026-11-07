# Verification

Verified commit: 3c2a8db2, this increment on top of the environment-export increment (481c9883).

## Gates

Run on macOS 26.5.1 with Node 22.23.1 on that tree:

- `npx tsc --noEmit`: no errors.
- `oxfmt --check`: all files formatted. `oxlint` on the changed files: no new findings.
  `npm run verify:module-boundaries`: 2133 files checked.
- `npm run jscpd`: 3.35% duplicated lines, unchanged. `npm run scan:todos`: none.
  `npm run mcp-catalog:check`: passed. `npx knip`: one unresolved import that predates
  this change (`#javascript-analysis-worker`).
- `npm run test:prepare`, then vitest over `src/domain/analysisView`, `src/application`,
  `src/contracts`, `src/server/environment`, `tests/conformance` and the analysis-view,
  environment-serve, environment-export and browser-scenario boundary tests: 1946 tests in
  157 files, 1941 passed, 5 skipped, 0 failed.

## Real browser captures

`npm pack` of this commit (`rea-agents-6.7.0.tgz`) was installed on Ubuntu 24.04 amd64 hosts
(8 vCPU, 32 GB) with Chromium 155.0.8059.79 at `/snap/bin/chromium`, Node 24, Docker and
`agentenv-framework` 0.9.1334. Every capture below is `rea capture-browser-scenario` output;
no HAR was recorded, scoped or edited.

### Fixture

A loopback fixture served a page that lists photos from `/api/photos`, three PNG thumbnails, and
a form that POSTs JSON to `/api/albums`. The scenario waited for the list, opened
`/api/photos/1..3` with `goto`, filled and submitted the form.

- Capture: 14 transactions, 70 events, 0 dropped, authority `controlled-replay`.
- `environment-manifest`: `parent_operation` `capture_browser_scenario`, origin
  `http://127.0.0.1:3199`, confidence `inferred`. Tools `get_photos` (records 1, 9),
  `get_photos_by_id` (`{numeric}` id, records 5, 6, 7) and `post_albums` (record 13, body shape
  `title: string`). The page and the three PNGs were excluded as `ui-page-or-asset`.
- `environment-serve`: `get_photos_by_id {id: "3"}` returned the recorded JSON with
  `record_ordinal` 7 and `exact_match` true.
- The POST's response body was missing: the scenario ended at the action that sent it, the
  transaction was still unfinished, and the observer does not read bodies of unfinished
  responses. The manifest stated "1 of 14 scenario transactions retained no response body" and
  `post_albums` replayed status 201 with no body. Ending the scenario with a 1.5 s
  `wait_for_timeout` finished all 14 transactions and retained the body.
- `environment-export` of that capture wrote a README naming the browser scenario capture and the
  scenario definition's SHA-256; `agent-env run <bundle> --task smoke` passed in 30.4 s.

### Five applications

Each environment ran manifest, export, the bundle's smoke task and 6 to 12 generated retrieval
tasks, with one run per task for two models through the Hugging Face router.

| Application                  | Capture                                                            | Actions | Transactions | Tools (rules / none) | Smoke  | Retrieval tasks | gpt-oss-120b | GLM-5.3-Flash |
| ---------------------------- | ------------------------------------------------------------------ | ------- | ------------ | -------------------- | ------ | --------------- | ------------ | ------------- |
| PhotoPrism 261007            | self-hosted, no login (public mode)                                | 55      | 277          | 13 / 28              | passed | 10              | 10/10        | 10/10         |
| Lychee 6.10.4                | self-hosted, session cookie seeded from a declared secret          | 152     | 134          | 15 / 27              | passed | 12              | 11/12        | 12/12         |
| Pinry 2.1.13                 | self-hosted, session and CSRF cookies seeded from declared secrets | 148     | 568          | 12 / 12              | passed | 6               | 6/6          | 6/6           |
| Art Institute of Chicago API | public, `goto` per URL                                             | 52      | 26           | 11 / 12              | passed | 12              | 11/12        | 12/12         |
| Library of Congress JSON API | public, `goto` per URL                                             | 55      | 29           | 11 / 11              | passed | 12              | 11/12        | 12/12         |

Every scenario step completed and no capture dropped events. Each self-hosted capture includes
one create, one edit and one delete made through the application's own forms; all three became
tools with their recorded statuses, including a 204 DELETE without a content type. Declared
secrets did not appear in any capture; where the application echoed a declared value in a
response body (PhotoPrism's session reply, Pinry's owner token) the capture held the redaction
marker instead.

Two other targets were tried and replaced. The Met Collection API projected 3 tools: its data
paths are `/departments`, `/objects/{id}` and a search, and numeric object ids merge into one
tool. The NASA Image and Video Library projected 16 tools, but its Collection+JSON bodies nest
record fields deeper than the task generator reads, so no tasks could be derived.

## Observed limits

These were observed during the runs and are outside this increment:

- A scenario's last action can lose its response body unless the scenario ends with a wait
  (above).
- Large asset bodies count against the analysis-view budget. One Pinry capture at
  `max_network_body_bytes` 262144 held 12.5 MB of Evidence, mostly CSS and JavaScript reloaded
  on 33 page loads, and the manifest view returned `resource_constraint`. A 20,000-byte body
  limit kept it within budget. Scenarios have no per-origin or per-media-type body selection.
- Image responses outside an API path are excluded as UI assets, so their bytes are replayable
  only when an API path serves them (PhotoPrism's `/api/v1/t/...` tiles became tools).
- With the default `max_total_event_allocation_bytes`, one PhotoPrism capture dropped its last
  68 transactions, including all three writes, while the command exited 0; 64 MiB dropped none.
- Actions have no default deadline: two runs waited on a locator for 277 s and 7.5 min until
  cancelled. Every scenario above sets `timeout_ms` on its actions.
- A redirect is its own transaction; Django's trailing-slash 301 produced a second tool
  (`get_pins_by_id` and `get_pins_by_id_2`) for one resource.

## Linux followup verification (2026-10-19)

The original PR was merged with current main `7a0c47bfa`, after #4955, #4975
and #4999 merged. The export filesystem ownership, mode, tarball, cleanup and
caller-path fixes from main are retained. Default MCP remains stdio.

The retained-parent projection previously decoded every request body before
per-record budget checks. It now reserves copied/transformed text through the
shared admission owner before schema validation or decoding, including retained
parents. Replay projection omits request text used only for body-shape inference;
response bytes still undergo the producer schema's integrity validation. The
intermediate projected-array copy and unused capture wrapper were removed.
Windows test inventories normalize filesystem separators to the portable bundle
path representation. CI selects the agentenv lane for the new projection and its
shared admission dependencies.

Executed on Linux x64, Node 24.18.0 / npm 11.16.0, Chrome for Testing
156.0.8078.4:

- `turbo run typecheck lint:built format:check docs:check:built knip artifacts:skills artifacts:mcp-catalog --concurrency=1 --summarize`: eleven tasks passed, one cached, 210.023 s elapsed / 209.860 s CPU / 4562.07 MiB peak process-family RSS. This first complete gate preceded the final lint cleanup and CI-selection additions; later checks are reported on the PR.
- Initial source verification passed 111 tests in 13 files, including HAR/manifest regressions, scenario loading/replay/export and new capacity/replay-mode tests. CI-selection verification passed 235 cases.
- Real public CLI capture of the source-owned interactive browser network site: ten transactions, fifty events, two tools, no dropped events. Its POST response replayed twice through the official HTTP SDK with exact body/status/Evidence ordinal and untrusted-content provenance. Declared secrets and transport credentials were excluded; the ordinary selected `password` field value remained in retained body bytes.
- Real public CLI capture of three live GitHub API responses in Chromium, without a HAR: three transactions, fifteen events, three tools, no dropped events. Every response replayed twice through the HTTP SDK with exact body/status/Evidence/provenance. Explicit navigation waits let response-body capture settle. Complete two-scenario capture/projection/serve task: **22.527 s / 16.678 s CPU / 1397.93 MiB** peak process-family RSS, including owned browser processes. Both listeners exited 143 and newly owned browser profiles were gone.
- The same two actual captures produced identical manifest results through CLI and official SDK **stdio** MCP, with HTTP environment variables present: **2.795 s / 2.778 s CPU / 476.67 MiB**. This verifies adapter parity and default transport independently of explicit environment HTTP.

The first local probe mistakenly searched base64 body content for plaintext; its
assertion was corrected to inspect decoded retained bytes. A later SDK probe
initially imported stdio transport from the SDK root instead of its documented
subpath; the corrected probe passed. An early live navigation also reported one
`body-read-failed` response, which the projection preserved as unavailable. No
browser-provider behavior was changed; the successful run used explicit waits.
These earlier attempts are not counted as passing runs.

A matched retained-scenario projection comparison bundles the original helper
from `3aae3579e` and the followup helper, supplies the same 72,771-byte capture
with three JSON writes, and completes one cold plus 100 warm full manifest
projections. Both outputs have the same SHA-256
`990ac431670374ff68c77a20d77985f626e4681bb0e2f491e5af18f45ce79991`.
Before/after process totals: **0.970/0.876 s elapsed, 0.934/0.865 s CPU,
184.89/184.39 MiB** RSS. First task: **17.378/13.073 ms**; 100 warm tasks:
**261.419/236.131 ms**. Single samples do not establish a speed or memory
improvement. Bundle preparation is excluded; process totals include fixture
startup. CLI, provider and transport costs are excluded from this comparison.

Heavy work is serialized on one CPU with one test worker. RSS sums sampled
process descendants every 50 ms and can double-count shared pages. Agent token
usage is unmeasured. These followups do not rerun the author's five application
reconstruction/model tasks, nor establish Windows or macOS behavior. Historical
response replay does not reconstruct application state.

A retained-parent counterexample used a 128 KiB projection budget and one 16 KiB JSON request: the original helper admitted it and decoded once; the repaired helper returned `AnalysisResourceConstraintError` with zero UTF-8 decodes. The test intentionally uses a small budget without inducing an OOM. Final targeted verification passed 242 tests (including 235 CI-selection cases): 41.042 s / 40.666 s CPU / 644.37 MiB peak process-family RSS.

The broader d2416ca54 regression run passed 657 tests in 47 files plus ten product-catalog cases (295.763 s / 293.370 s CPU / 1921.69 MiB family RSS; catalog checked separately). The author then pushed 655e62334 with redaction/body-budget documentation and withheld-empty-body behavior. That commit was retained; the followup counts bodiless/redacted observations against represented transactions, preserving the complete request ordinals. The related source run passed 145 tests in 14 files (9.793 s / 9.618 s CPU / 688.66 MiB). Docker execution was held at this author-update checkpoint, so no earlier bundle is attributed to the new source. Final committed checks and actual scenario-container/framework results are reported on the PR.
