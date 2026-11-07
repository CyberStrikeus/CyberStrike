# Selected retained JavaScript observations

Tracks #4190 under #4027. Base:
`85eac7b92bac39bf2da6c00ebf6ba1b11b4c8d1f`. Initial working version:
`f70b8c0bc512094938e817c083921e69aaacfcbe`; the final version additionally
supports opt-in property-name discovery. Exact source hashes, all measured
attempts and compact agent answers/operations are in the adjacent JSON record.

The analyst knows several application-relative metadata/native paths and needs
selected facts with their original identities and provenance. The previous
module-reference view excludes those kinds. A full feature trace answers a
broader relationship question; a real Joplin package trace exceeded the 10 MiB
reply limit twice in #4190. Exporting retained Evidence and projecting it locally
is a valid alternative, and is used as the completed baseline here.

## Contract and ownership

`inspect_analysis_view` / `rea inspect-analysis-view` accept
`view.kind: "javascript-facts"`. `where.paths` matches only original Evidence
artifact-path or source-range source strings; no filesystem lookup, normalization
or property/display-path fallback. Omission includes unknown locations; `[]`
matches none. Optional `where.kinds` selects original node kinds.

Required `property_keys` selects original observation properties; `[]` returns
identity and provenance only. Missing keys remain omitted, distinct from null.
`include_available_property_keys: true` lists sorted original property names for
returned rows without unselected values. It defaults to false. There is no
cross-observation merging or semantic inference. Each row preserves its node ID,
identity, observation ID, source-map reference and complete original Evidence.

A single scan retains only the requested page. Caller-selected offset/limit are
preserved; existing transport admission still applies. Coverage counts matching
observations, while shared application/semantic source coverage, unknown counts
and caller source selection describe the retained parent. Exhausting a page is
not a claim of globally complete analysis. Full Evidence remains exportable.
The domain projector and shared application service own both CLI/MCP behavior;
no new provider, executor, persistent cache or live-state freshness claim exists.

The dated measurements below requested the then-emitted derived package
`renderer` property. New analyses use `renderer_declarations` for source fields
and package `loads` edges for the selected candidate; use
`"renderer_declarations"` in place of `"renderer"` when repeating the fact query
against a new analysis. Historical retained Evidence and measurements remain
unchanged.

## Real input and reproduction

Use the official [Joplin v3.7.21 Linux AppImage](https://github.com/laurent22/joplin/releases/download/v3.7.21/Joplin-3.7.21.AppImage).
Acquisition and exact selective 7z extraction are documented in
[native handoff verification](javascript-native-handoff-identity-2026-10-15.md#real-input-and-scope).
Asset SHA-256:
`5d202dcaca31e14206826aa3f04125e7c218dbc3dc3d98479d811efbd6b856c1`.
ASAR: 233,575,014 bytes, SHA-256
`767df409b18effe60421fbefcca873de237c7e813eac744ecdeebbc5e825a33a`.
Stage all three native companions as in that procedure; the other 43 unpacked
entries remain unstaged. No downloadable app or large Evidence is archived.

The five selected sources are `ElectronAppWrapper.js`, its `.map`, `index.html`,
`package.json` and `node_modules/keytar/build/Release/keytar.node`. Inventory
covers 6,324 files; whole-application analysis remains partial. Normal processing
retains package `@joplin/app-desktop` / `3.7.21`; keytar's observed physical bytes
hash to `0700016bcd761cbe02d275f2046c7cc42f39f730a50d66e3d3307aa9d413373a`.
That digest does not establish runtime execution. Deliberate `analysis_timeout_ms:1`
retains native identity and unavailable `not-started` phases for
`parse-local-source-map`, `parse-html-script-references`, and `parse-package-json`.
Missing source-map original content is distinct from failure to parse the map.

After pinned Node/npm installation, `npm ci` and `npm run build:cached`:

```sh
query='{"kind":"javascript-facts","where":{"paths":["ElectronAppWrapper.js.map","index.html","package.json","node_modules/keytar/build/Release/keytar.node"]},"property_keys":["path","bytes","file_kind","text_status","parse_status","json_parse_status","availability","operation","analysis_status","limitation","name","version","main","renderer"],"offset":0,"limit":64}'
for mode in export view; do
  node scripts/verify/javascript/retained-facts.mjs \
    --artifact "$input_root/cases/available/app.asar" --mode "$mode" \
    --query "$query" --rounds 3 \
    --source-path ElectronAppWrapper.js \
    --source-path ElectronAppWrapper.js.map --source-path index.html \
    --source-path package.json \
    --source-path node_modules/keytar/build/Release/keytar.node
done
```

Add `--analysis-timeout-ms 1` to both modes for the interruption control,
`--cli-parity` to view mode for exact complete Evidence comparison, and
`--tokenizer-python /absolute/python-with-tiktoken-0.12.0` for BPE projections.
For field discovery, use `property_keys: []` and
`include_available_property_keys: true` in both modes. The export baseline runs
the recorded independent selector as an owned shell/Node caller program; it does
not import the production projector. Later export samples reuse the same
immutable export. View samples precede diagnostic export and CLI verification.

All costly commands run serially with the preserved
[resource observer](https://github.com/morluto/rea/blob/b3bdabab694af1f9801eff7caf75001b92314a58/experiments/analysis-efficiency/resource-run.py)
using `--memory-gib 8 --observe-payload-exit`: one CPU, 8 GiB hard limit,
6 GiB early stop, no swap, 192 tasks; Node heap 2 GiB, `UV_THREADPOOL_SIZE=1`,
`GOMAXPROCS=1`, `GOMEMLIMIT=3GiB`. Observer hashes and cleanup receipts are in JSON.
Memory is peak process-family cgroup memory including file cache. At-answer
counters include observer/startup, before repeat/parity/tokenization work; final
external receipts include that verification work and are explicitly measured at
payload exit while the observer remains alive, not final whole-scope counters.

## Costs and interpretation

The original completed normal baseline retrieved the selected facts in 2.981 s
(first export plus projection), versus 0.157 s for the initial view; warm reads
were 1.475/1.146 s versus 0.056/0.046 s. Both returned the same 12 observations,
properties, original Evidence and parent coverage. The 1 ms interruption control
returned the same 11 observations. CLI/MCP complete view Evidence matched exactly.
The earlier slow baseline interruption run is preserved, rather than discarded.

This is **not an established token improvement**. Counting selected input
contracts, preparation, requests and structured replies, normal baseline BPE was
8,887 versus 17,289 for the initial view. The existing general view contract and
Evidence wrapper cost more than the caller code saved. Counting the full
name/description/input-schema catalog instead gives 188,206 versus 189,954.
These are `cl100k_base` counts, not billing or model context measurements; output
schemas, exec schema and host rendering are unmeasured. Final same-backend
controls and optional-discovery measurements are recorded separately in JSON.

Actual Codex CLI trials use the runnable
[agent harness](https://github.com/morluto/rea/blob/42e1a17d6e6c0487f17be0bae248553c4caba7f7/experiments/analysis-efficiency/javascript-facts-agent.mjs),
installed CLI 0.161.0, requested alias `gpt-5.6-terra` / high, unchanged questions
per pair, and fresh processes/MCP. Restricted baseline tools are analysis and
export; candidate adds the existing `inspect_analysis_view`. Both can reach the
same backend information through export. Shell projection is allowed only on
retained exports; target execution, raw ASAR shell inspection, downloads,
repository investigation and other agents are forbidden in both.

```sh
node experiments/analysis-efficiency/javascript-facts-agent.mjs \
  --repository /absolute/rea --artifact "$input_root/cases/available/app.asar" \
  --arm view --task direct --output /absolute/new-result-directory
```

Run each `direct`, `partial`, `negative` task with both `export` and `view` arms,
serially under the same resource observer. The negative task tests the claim
that a static byte digest establishes native execution. Existing normal auth is
used with `--ignore-user-config`; no credential copying or HOME/CODEX_HOME
mutation. The installed CLI requires `code_mode_host: true` for all dispatch;
that frontend setting is identical in both arms and is not a new REA executor.
Experimental `code_mode` / `code_mode_only` remain disabled. MCP tool allowlists
and per-tool settings use the [official Codex configuration](https://developers.openai.com/codex/mcp).
Historical harness patches preserve the invalid disabled-host attempt and the
initial working harness; the former is excluded as a harness failure.

Initial direct baseline: 332.9 s, 741,744 cumulative input tokens, 17 operations;
initial candidate: 182.2 s, 405,267 input tokens, 10 operations. The candidate
still exported, guessed several property names, and gave a qualified phase
answer that mixed missing original content with processing gaps. The follow-up
with opt-in field-name discovery used it correctly but still exported: 343.1 s,
835,185 input tokens and 17 operations. Its normal phase answer was correct.
All attempts remain recorded; selecting only the better initial candidate would
misrepresent the result. Cumulative input includes repeated cached context and
is not peak context. Requested model alias does not prove the underlying model;
USD, peak context, model scheduling and cache effects are unmeasured.

The capability is useful as a precise, bounded retained-data interface for
clients that know their question. These small agent trials do not justify a
universal recommendation, a token-saving claim, or production code mode.
Property discovery is opt-in because even field-name metadata costs context.
No cross-platform/live-browser/native-provider compatibility is established by
these static Linux Joplin checks.

## Validation and retained failures

The final focused source set has 85 passing cases across four files, including
public MCP real-filesystem selection/paging/null/identity semantics, portable vs
retained complete Evidence parity, advertised SDK schema validation, malformed
selectors, literal artifact/source-range/URL distinctions, unknown locations,
empty filters and opt-in names without large unselected values. Distinct SDK
schema/presentation checks, full static/docs gates and real final controls are
listed with their final executed results in JSON.

Initial test fixtures incorrectly encoded invalid artifact/unknown locations and
omitted a required partial-graph limitation; these were fixture failures, not
product reproductions, and were corrected without relaxing the domain contract.
The initial static gate found two unreferenced verifier files; a real npm
verification entrypoint fixed discoverability without ignores. Later full V1
static/docs and 16 SDK schema/presentation tests passed. The final-version gates
are recorded separately; prior checks are not substituted for them.

## All actual agent attempts

One valid trial per surface/task/version; no aggregate success rate or causal speedup.
Resource columns cover the whole payload, including cleanup.

| Task / interface / version |  Wall s |      CPU s | Peak cgroup B | Cumulative input / cached | Operations |
| -------------------------- | ------: | ---------: | ------------: | ------------------------: | ---------: |
| direct-export-host (v1)    | 332.921 | 141.004989 | 1,750,212,608 |         741,744 / 675,072 |         17 |
| direct-view-host (v1)      | 182.183 |  58.726775 | 1,976,950,784 |         405,267 / 353,024 |         10 |
| direct-view-discovery (v2) | 343.080 | 151.271793 | 1,808,695,296 |         835,185 / 766,464 |         17 |
| partial-export (v2)        | 170.297 |  67.062935 | 1,807,712,256 |         412,200 / 346,624 |         12 |
| partial-view (v2)          | 192.489 | 100.813091 | 1,175,404,544 |         256,075 / 214,528 |          4 |
| negative-view (v2)         |  93.970 |  42.553715 | 1,869,479,936 |         188,514 / 148,736 |          5 |
| negative-export (v2)       | 132.727 |  53.359974 | 1,801,166,848 |         269,529 / 229,632 |          8 |

The partial candidate returned exact retained phase entries using four MCP calls,
without export or shell. It used less input context but more CPU and wall time
than the corresponding export baseline. Both negative-task arms preserved runtime
execution as unknown; the candidate still exported once. The one invalid
disabled-host attempt (37.679 s / 5.070758 CPU s / 880,414,720 B) is preserved
as a harness failure, with unavailable operation counts.

Use the [specific artifact oracle](https://github.com/morluto/rea/blob/42e1a17d6e6c0487f17be0bae248553c4caba7f7/experiments/analysis-efficiency/javascript-facts-grade.py) on the compact JSON:

```sh
python3 experiments/analysis-efficiency/javascript-facts-grade.py \
  docs/verification/javascript-retained-facts-2026-10-15.json
```

It checks actual receipt IDs, caller selection/deadline, exact native facts and
processing entries. Its coverage check recognizes a partial declaration rather
than validating arbitrary prose. Read the preserved original answers and
qualifications: some trials cite a correct physical-byte observation plus an
ASAR-entry observation outside the named native node. The initial candidate
also mixed true missing original content with unavailable processing phases.
The API itself preserves node/observation pairs; these are qualified agent
composition outcomes, not a claim of product provenance corruption.

Pre-integration V2 source validation passed: full `npm run check`, generated metadata/docs
checks, five documentation consistency cases, test discovery, and 18 MCP cases
(two expanded facts cases plus 16 SDK schema/presentation cases). Together with
the unchanged 83 domain/application/MCP cases passed on V2, this establishes
101 distinct focused cases across six files. The final combined gate took
182.620 s wall / 182.170929 s CPU / 4,288,471,040 B peak cgroup memory, with no
OOM and verified cleanup. Exact command and receipts are in JSON. That pre-integration
runtime tree matches the V2 agent-trial runtime tree exactly; formatting and
added validation did not change that built backend.

## All pre-integration scripted workflows

Each row uses a fresh MCP process; warm samples reuse its retained parent or export.
The first-answer wall clock includes input hashing/catalog/preparation; CPU and memory
are scope counters at that answer, before repeat/diagnostic/CLI/tokenization work.

| Run                      | First retrieval ms |   Warm retrieval ms | First-answer wall s | CPU s at answer | Peak B at answer | Selected / full-catalog structured BPE |
| ------------------------ | -----------------: | ------------------: | ------------------: | --------------: | ---------------: | -------------------------------------: |
| baseline-export-control  |           2980.631 | 1474.954 / 1146.062 |              46.429 |       46.473136 |    2,021,326,848 |                        8,887 / 188,206 |
| baseline-export-timeout  |           6882.206 | 4004.294 / 3943.480 |              99.212 |       77.790901 |    1,962,766,336 |                        6,300 / 185,619 |
| initial-view-control     |            157.188 |     56.020 / 45.719 |              40.802 |       41.025768 |    1,516,302,336 |                       17,289 / 189,954 |
| initial-view-timeout     |            145.577 |     55.958 / 38.476 |              39.705 |       39.915172 |    1,533,857,792 |                       14,601 / 187,266 |
| final-export-control     |           2930.118 | 1208.993 / 1255.474 |              45.338 |       45.409611 |    1,754,632,192 |                        8,928 / 188,805 |
| final-view-control       |            160.185 |     49.180 / 44.121 |              41.925 |       42.154669 |    1,327,824,896 |                       17,393 / 190,058 |
| final-export-timeout     |           2664.126 | 1158.068 / 1170.790 |              42.200 |       42.291057 |    2,010,955,776 |                        6,341 / 186,218 |
| final-view-timeout       |            154.183 |     65.214 / 44.951 |              39.734 |       39.963850 |    1,438,531,584 |                       14,707 / 187,372 |
| discovery-export-control |           2704.045 | 1290.199 / 1157.228 |              45.407 |       45.484008 |    2,030,903,296 |                        9,049 / 188,926 |
| discovery-view-control   |            167.756 |     55.904 / 52.628 |              42.266 |       42.491752 |    1,309,347,840 |                       17,467 / 190,132 |

All ten workflows passed their independent export oracle. Known-field normal pairs
return the same 12 observations; interrupted pairs return the same 11. Opt-in
field-discovery pairs return the same original property names for 12 observations
without selected values. All four measured view workflows passed exact complete
CLI/MCP Evidence parity (initial normal/timeout and final normal/timeout), and
the final discovery view passed it too. Canonical selected-answer digests agree
across corresponding export/view pairs; raw serialization digests may differ by
JSON property order. Final runtime/source and payload cleanup receipts are in JSON.

Final normal selected-contract cost is 8,928 BPE for export/projection versus
17,393 for the view. The full catalog projection is identical between final
arms; view Evidence wrapping still adds cost. Faster retrieval is useful, but
fewer bytes/calls alone cannot establish lower whole-agent tokens or latency.

After the final documentation clarification and measurement tables, generated
docs/checks passed again (including five consistency cases). Duplicate scanning
and TODO checks passed; final runner/grader syntax and all three historical
harness reconstructions were verified against their recorded SHA-256 values.
No tech-debt markers were introduced. These final audit receipts are retained
separately from backend task performance.

## Main integration on 2026-10-15

The measured V2 checkpoint is
`d32547f9ac7769049a8ee6fbc8a27abcb2285a54`. Main advanced during the trials;
merge `5f0b1fa47ffdf25b3775d87c2e07aea6cff26f31` integrates pinned current main
`2202e3f0ba556d40cc6e598df1ecbdf1eda56c13`, including independent semantic
value/lifecycle fixes. Historical cohorts remain valid for their pinned backend,
not measurements of the later integrated backend. Integrated normal/interruption
export/view controls and the complete focused/static/docs gates are recorded
separately below and in JSON when executed. No agent pilot rerun or universal
token/latency benefit is inferred from that source update.

Integrated checks passed: all **101 focused cases in six files**, full static
checks, generated docs/metadata, five consistency cases and test discovery.
The combined gate took **247.955 s wall / 247.425940 s CPU / 4,303,970,304 B**
peak cgroup memory; no OOM and verified cleanup.

| Integrated run            | First retrieval ms |             Warm ms | First-answer wall s | CPU s at answer | Peak B at answer | Structured selected / full-catalog BPE |
| ------------------------- | -----------------: | ------------------: | ------------------: | --------------: | ---------------: | -------------------------------------: |
| integrated-export-control |           3231.861 | 1224.159 / 1155.725 |              45.631 |       45.728169 |    1,959,448,576 |                        8,936 / 188,813 |
| integrated-view-control   |            148.705 |     45.964 / 37.995 |              41.674 |       41.896616 |    1,527,902,208 |                       17,393 / 190,058 |
| integrated-export-timeout |           2503.346 | 1159.864 / 1232.282 |              41.260 |       41.350087 |    1,963,479,040 |                        6,341 / 186,218 |
| integrated-view-timeout   |            138.893 |     53.395 / 35.014 |              37.307 |       37.530088 |    1,483,386,880 |                       14,707 / 187,372 |

All four integrated controls passed their independent export oracle; both view
cases passed exact complete CLI/MCP Evidence parity. Normal/timeout selected
facts and source coverage also match the V2 checkpoints. Temporary export paths
can change a few request BPE tokens; exact requests are measured, not normalized.
The new runtime contains 1,633 JS files, tree SHA-256
`6a5763452c1522a782e531e6dda227ea10140f9f9d52148fc1602a6ecf3cea5a`
under the explicit compact sorted path/hash algorithm in JSON. Agent-trial
runtime pins remain separate. These controls do not justify a causal speedup
or whole-agent token claim.

## Review: experiment metadata and failure ownership

Greptile review on `7238fd080` found two valid runner defects: a hardcoded CLI
version, and a `finally` error which hid command/diagnostic failures. The runner
now probes `codex --version` through the existing owned-command boundary before
starting an agent, and records the observed output in successful/failed trials.
Probe failure or empty output stops the trial. The local real-command smoke
returned `codex-cli 0.161.0`; historical trials retain their original metadata.

Cleanup retains the original `OwnedCommandFailure` or diagnostic-write aggregate,
its cleanupResult/resources, the unresolved cleanup owner and private workspace.
Shared `withVerifierCleanup` combines a separate root-cleanup failure with
the primary error. Snapshot diagnostics use actual retained/observed byte counts,
not nonexistent stream `truncated` fields. Signal handlers remain installed
through final cleanup; late cancellation preserves completed trial data and
returns typed cancellation. Success is printed after finalization.

Eight deterministic cases exercise the real experiment entrypoint, production
private-root creation/removal and `OwnedCommandFailure`, with controlled command
and cleanup outcomes: observed version, failed/empty version, retained owner,
recording failure, root cleanup failure, ordinary timeout, nonzero exit and late
cleanup-time cancellation. No model, application or orphan process is launched
by these cases. The baseline exposed the original errors; an intermediate failed
assertion assumed Node omitted `[Error]` when printing the class and was corrected
to check the original class/message independently. All attempts remain in JSON.

The final eight cases passed, followed by the complete Python suite (35 bridge
plus71 experiment cases:106 total, including the eight new cases). Full static,
docs/five consistency and test-discovery checks passed again; all four historical
harness patches reconstruct their recorded hashes. At that review-fix checkpoint, the backend remained the integrated 1,633-file
tree above; no model trial or real-app analysis was rerun for those runner-only
corrections. The following lifecycle integration is a separate backend version.
The fourteen historical real-app answers retain their original versions.

```sh
python3 -m unittest discover -s experiments/analysis-efficiency \
  -p test_javascript_facts_agent.py -v
npm run test:python
```

## Lifecycle-main integration on 2026-10-16

Upstream #4274 merged as `1b97b0f3707b1cf78ac98bd4ae81638b33cc286f`.
Merge `2ca63f4d9f2e489ce3b5cbccdc204ad0be39551c` integrates it without
changing the retained-facts implementation. Locked dependencies were reinstalled.
The current runtime contains **1,645 JS files**, compact sorted path/hash tree
`311fd78c7ca4717e56253413bc2725097929e0d6656efca69c9b3646a65ca348`.
The JSON preserves both earlier runtime/source manifests and all historical
trials. No model trials were rerun.

Full static, generated docs/metadata, five documentation-consistency cases,
test discovery and all **106 Python cases** passed. The initial combined command
returned exit 1: **113 focused cases passed and one contract-order fixture hit its
20-second subprocess budget**. It took 483.978 s wall / 386.555153 s CPU /
5,169,971,200 B peak cgroup memory, with no OOM and verified cleanup. An isolated
CPU-15 retry also failed at that deadline. These attempts remain failures in JSON.
The original unmodified test then passed on one CPU 10 in 11.446 s, retaining its
20-second deadline; its complete wrapper took 13.545 s wall / 13.272853 s CPU /
920,023,040 B peak. Thus **114 distinct focused cases across seven files passed
across the documented invocations**, including the previously failing ADB case.
This does not describe the initial combined command as successful.

Four fresh controls use the same one-CPU/8-GiB wrapper, explicitly selecting CPU
10 because CPU 15 was observed fully busy while this task was idle. Memory
includes file cache. First-answer counters precede diagnostic exports, repeated
queries, CLI parity and tokenization; external scope receipts include that extra
verification. Caches and host scheduling remain uncontrolled.

| Lifecycle run            | First retrieval ms |             Warm ms | First-answer wall s | CPU s at answer | Peak B at answer | Structured selected / full-catalog BPE |
| ------------------------ | -----------------: | ------------------: | ------------------: | --------------: | ---------------: | -------------------------------------: |
| lifecycle-export-control |           4241.377 | 2195.294 / 1405.121 |              49.404 |       48.700591 |    2,240,831,488 |                        8,947 / 188,824 |
| lifecycle-view-control   |            152.862 |     47.474 / 40.375 |              44.715 |       44.709653 |    1,540,792,320 |                       17,421 / 190,086 |
| lifecycle-export-timeout |           2543.698 | 1243.063 / 1074.366 |              45.964 |       45.802632 |    1,986,072,576 |                        6,341 / 186,218 |
| lifecycle-view-timeout   |            151.242 |     89.234 / 35.575 |              43.033 |       42.952115 |    1,498,869,760 |                       14,707 / 187,372 |

All four passed the independent current-runtime export oracle. Both view cases
passed exact complete CLI/MCP Evidence parity. Normal results retain the same
12 original observations and their complete per-row Evidence. Their parent
Evidence changes with `semantic_unknown_count` 41,161 → 41,162; the additional
unknown was not individually isolated. Both current workflows report the same
current coverage, rather than projecting the historical count. Interrupted
results retain the same complete 11-row answer, parent and coverage as before.
There are now 18 version-labelled manual workflows and nine complete view
CLI/MCP parity controls. Historical agent measurements do not become claims
about this newer backend.

The normal selected structured task still costs more BPE for the view
(17,421 versus 8,947), while its first retrieval is smaller in this cohort
(152.862 versus 4,241.377 ms). No causal speedup, portable equivalence or universal
token benefit follows from these single-cohort measurements.

Final `check:fast`, `docs:check` and five consistency cases passed again:
43.728 s wall / 41.873577 s CPU / 814,235,648 B peak. All 16 authored source
hashes and the measured runtime tree still match.

### Default-client compilation diagnostic

The pinned SDK client 2.3.1 builds its output-validator index by compiling every
cached `tools/list` output schema on the first `callTool`. A CPU profile and
read-only instrumentation located the fixture delay there; PNG comparison and
cleanup were not the expensive stages. The completed default-client fixture
passed the original catalog and response assertions: 207 tool schemas and 16
named responses. This replay does not turn either timed-out Vitest run into a
pass. No SDK, production code, fixture, or test deadline was changed.

A separately built main-only worktree at `1b97b0f37` also compiles the complete
catalog. Its fixture took 11.598 s wall / 11.262708 s CPU; the candidate diagnostic
took 24.899 s wall / 12.364085 s CPU. CPU-15 saturation, different transient
scheduling and warm caches prevent a causal wall-time comparison. The
`inspect_analysis_view` output schema grows from 128229 to 137174 compact UTF-8
bytes; that additional client work remains a cost of the additive contract.
The sampled profile attributes substantial wall samples to SDK AJV compilation
and GC; these samples are not CPU-time attribution. Raw catalogs and CPU profiles
are reproducible diagnostics and are not archived. Their hashes and compact
results remain in JSON.

Reproduce the profile against either pinned checkout after its locked install
and runtime build, within the resource wrapper above:

```sh
node --cpu-prof --cpu-prof-dir=/tmp/rea-contract-profile \
  tests/fixtures/contractPresentation.mjs reversed > /tmp/rea-contract-result.json
```

To identify individual compilations on the pinned SDK, preload this diagnostic
from an ignored checkout-local `.cache/contract-compile-probe.mjs`:

```javascript
import { Client } from "@modelcontextprotocol/client";
const compile = Client.prototype._compileOutputValidator;
Client.prototype._compileOutputValidator = function (tool) {
  const started = performance.now();
  try {
    return compile.call(this, tool);
  } finally {
    console.error(
      JSON.stringify({
        name: tool.name,
        compile_ms: performance.now() - started,
      }),
    );
  }
};
```

```sh
node --import ./.cache/contract-compile-probe.mjs \
  tests/fixtures/contractPresentation.mjs reversed > /tmp/rea-contract-result.json
```

This private SDK hook is diagnostic-only and version-specific. It is not a REA
execution surface or a proposed SDK fork. A client can separately evaluate the
public per-call `toolDefinition` option without reducing catalog completeness
or changing backend authority; no such client change was made here.
