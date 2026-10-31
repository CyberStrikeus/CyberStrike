# JavaScript assignment influence verification — 2026-10-24

PR #6206 answers which retained inputs can influence a reassignment. It links
reads to binding/property writes, retains both compound operands, and keeps
conditional inputs and resulting values uncertain. It does not evaluate
arithmetic or prove execution order.

## Source and ownership

The comparison baseline is `b25895f9522a3432f0c2f9dfd2fc3e819510298f`, the original
assignment feature integrated with main `a062529b`. The corrected runtime is
`3224acae383501c5559c43ef521220406f3fee5d`. This compares two implementations
that both answer the ordinary fixtures; main without the feature cannot answer
all reassignment questions and is not a completed equivalent baseline.

The parser now retains nullable computed-key source ranges on callable facts.
The shared graph owner lookup excludes those ranges from the method while
retaining the method's full source identity. Domain traversal and graph lookup
reuse the same computed-method predicate. Parameter defaults and method bodies
keep method ownership; callbacks nested inside a key keep their own ownership.
The strict worker schema carries the parsed field across processes. Graph
consumers do not reparse the source or special-case assignment owners.

Assignment collection uses the shared cooperative traversal (a checkpoint every
1,024 visited nodes). Per-projection read/write range indexes reuse retained
nodes and have the immutable file projection's lifetime; no cache was added.

## Executed correctness checks

- Three new object/class/enclosing-function computed-key cases fail before the
  ownership fix (11 pass / 3 fail) and pass afterward. Parameter defaults and
  nested deferred callbacks are covered. The final assignment file has **15
  passing cases**, including an assignment genuinely owned by a callback inside
  a computed key.
- Removing the assignment owner filter temporarily makes both deferred-callback
  negatives fail (12 pass / 2 fail in that control). Candidate traversal is
  explicitly enabled and the graph is checked for erroneous assignment edges.
  The production file was restored before further verification.
- Full `npm run check` passed after integrating main `1a48a820` at
  `0fbd13b77b15c6906138eaac232456d3a2141ac5`. The initial 14-file run
  had **295 pass / 1 fail**: graph construction/scope/destructuring, semantic
  analysis, worker schema/transfer/budgets, 24 cancellation cases, and the
  production CLI fixture workflow.
- That remaining `projects literal seeds and static object flow` assertion
  expects 3 matches but receives 4 on both this feature and exact main
  `1a48a820208880c0cc383d196c7ed96d35479412`; the diagnostics match after checkout
  path normalization. The historical failed assertion is not counted as passing in that run.
- The CLI test executes analyze plus default and candidate-expanded traces for
  declaration, variable, property, compound and computed-key fixtures. It
  verifies the intended write and reachable return through the public commands.
  Full documentation and test-discovery checks passed.
  No target code is executed. MCP runtime delivery and other platforms were
  not newly verified for this change.

## Later integration and verification

The integration with main `1c07bee5b6262a537758e8bfa235e90d99e35d71`
produces the same tree as actual CI merge `49527572db7de2dfb260344f8c69c74f7b466423`.
Full `npm run check` and **all 296** selected feature/worker/CLI/cancellation
checks pass on that tree. Upstream changes repair the earlier literal-seed
assertion recorded above.

A cancelled shard also exposed a stale introductory-description assertion in
`analysisViewMcp.test.ts`. It prevented the oversized native discovery workflow
from running. Removing that unrelated catalog/prose precheck preserves the
metadata filters, 6 MiB retained-dossier discovery, paging and advertised-schema
checks; **all 22** tests in the file pass. The unchanged original case fails
before this cleanup. Full static checks pass with the revised test.

Separately, the CI source lane's 14 failures reproduce on both exact main and
its actual merge (each 167 pass / 14 fail across 181 checks). Twelve shared-child
failures have matching diagnostics; two 2-second timing assertions fail on main
as well. Failure multisets match after normalizing checkout paths and the
elapsed number only; timing measurements themselves are retained, not claimed
equal. These independent main failures are recorded rather than reported green.
Performance costs of this later integration were not remeasured.

The isolation audit also found that the headroom mock test added in #5660 was
incorrectly placed in the shared services project. It and the existing MCP
cancellation mock now live in `tests/process-global/`, as the established test
policy requires. All original budget, cancellation, retained-fact and subsequent
request assertions remain. The cancellation fixture holds the selected progress
boundary until an ordered client ping acknowledges delivery of its cancellation;
cleanup releases the gate even on failure. The fixture checks that this gate was
actually used. All **18** headroom, SDK-cancellation, progress and project-policy
checks pass. Bypassing the fixture's producer gate makes **both** cancellation
cases fail; restoring it preserves the passing results. An earlier two-file
preload control passed and does not prove import order caused the CI failure.
No CI speedup or new real-provider verification is claimed for these test moves.

## Completed task comparison

Each task starts two fresh production CLI processes: analyze the same source
folder, save its complete Evidence, then trace forward from literal `0.001`
with candidate edges enabled. The source oracle expects 1 or 32 reachable
returns. The 32-function fixture contains 96 syntactic assignments and retains
128 assignment relations, 386 nodes, 481 relations and 192 unknowns; its
ambiguity remains visible. All six semantic answers per fixture compare equal,
including identities, provenance contexts, unknowns and coverage. Only the
retained parent Evidence identity/link fields are excluded from equality.

Three pairs per fixture alternate before/after order. These are fresh process
runs and repeated filesystem-cache runs, not warm analysis-cache hits. OS file
caches were not flushed; the host was shared. Medians:

| Task         | Runtime | CLI stdout token estimate | Elapsed s | Waited family CPU s | Sampled peak family RSS MiB |
| ------------ | ------- | ------------------------: | --------: | ------------------: | --------------------------: |
| 1 function   | before  |                    18,430 |     5.160 |               6.017 |                       497.1 |
| 1 function   | after   |                    18,431 |     4.809 |               5.696 |                       503.8 |
| 32 functions | before  |                   588,112 |     8.356 |               7.483 |                       557.2 |
| 32 functions | after   |                   588,112 |     6.277 |               7.784 |                       561.6 |

Output token estimates are effectively unchanged. They use pinned `tokenx
1.3.0` on **both complete CLI responses**, not model usage. The saved query file
repeats complete Evidence on disk: 13,440 / 402,585 additional estimated tokens
for the respective fixtures, unchanged in both runtimes. These are separate
file payload costs, not agent context usage. Known-command runs do not request
a help/schema/catalog. Invocation text, prompts, model framing and rendering
are unmeasured. Estimation runs after the timed task.

No speedup is claimed: small elapsed ranges are 4.857–6.328 s before and
4.756–6.426 s after; 32-function ranges are 5.719–9.262 s before and
5.871–10.679 s after. The latter CPU median increases by about 0.30 s (4.0%)
and peak-RSS median by about 4.5 MiB (0.8%). This is a correctness and
cooperative-cancellation change, with the measured cost retained explicitly.
These small source fixtures do not establish multi-megabyte application
performance. Later main integration costs were not remeasured.

## Reproduction and accounting

Linux, Node 24.22.1 / npm 11.16.0. Node processes use CPU affinity 0–1 and
2 GiB heaps. The observer samples recursive process-family RSS every 50 ms,
with observed 6 GiB RSS, 180-second CPU and 300-second wall stop thresholds.
All 12 tasks exit successfully without a resource stop and preserve source
bytes. Timings include both CLI invocations, JSON parsing, saved Evidence/query
writes and the source oracle. CPU is waited-descendant accounting. RSS sums
shared pages and may miss short-lived or unobserved descendant transitions;
it is not a kernel-enforced memory ceiling. Fixture hashes:

- `fixtures/small/main.js`: 4e69e2708b212d1659eb0372e4fb5942e00906b2e9b44b3fa3e1e54eddb13ecb; 94 source bytes.
- `fixtures/large/main.js`: faea1107b93c09fd2594049ddac60425d16ad7c2989a912377332fc84373dc68; 4,875 source bytes.

Small source: `const accel = 0.001; let speed = 6; export function update() { speed = accel; return speed; }`
followed by one newline. The other source starts with `const accel = 0.001;`
and a newline, then joins the following line for `i = 0..31` with newlines,
including a final newline:

```javascript
export function update{i}() { let speed = 6; const state = { speed: 6 }; speed = accel; state.speed = speed; state.speed += accel; return state.speed; }
```

For each pinned checkout, build with the locked toolchain, then invoke
`node scripts/rea.mjs analyze-javascript-application <same-folder> --format json --full-output`.
Save its envelope's `data` as the `application` in a query with
`seed: {kind: "literal", value: 0.001}`, `direction: "forward-influence"`,
`include_ambiguous_dynamic_edges: true`; run
`node scripts/rea.mjs trace-javascript-semantics <query.json> --format json --full-output`.
The task harness SHA-256 is `93a2b5908013bdaaa39cc1492a61fc159fc71874fc7dad51a74a57f9f5d6f346`.
Raw command receipts, stdout/stderr, equality checks and all 12 measurements
are retained in the local maintenance evidence directory; generated runtime,
large response files and local planning artifacts are not committed.

## Current-main integration follow-up

Integration `8f7b403a0b1349700a819eda373d3dcac0e6133f` includes main
`85e38ac199dff15e8c43343d9170db7e0e46d284`. Main independently corrected the
old discovery assertion and added mock-isolation path overrides. The merge
retains main's SDK JSON Schema validator and tool-name discovery check, updates
the isolation policy's two path assertions to the moved fixtures, and removes
now-obsolete project includes/excludes. No test is assigned twice.

The full static gate passed (63.836 s elapsed, 74.452 s waited-child CPU).
The expanded selection passed 526 checks, including all assignment/ownership,
worker, cancellation, 22 MCP view, headroom and 14 policy cases. The formerly
failing source/CLI baseline cases pass on this newer main integration.
One public assignment CLI case failed at process exit while this operator had
incorrectly allowed the static gate's runtime compilation and built tests to
overlap: its start was 34.664 s before gate completion. Its output did not retain
the subprocess diagnostic, so the specific subprocess failure is unknown; this
is not evidence of a main regression. After build completion, the complete
five-fixture public assignment CLI case passed in 34.220 s (41.792 s CPU).
The fixture now includes subprocess stderr and the fixture name in all exit
assertions. The failed attempt is retained and is not counted as a passing run.

Earlier head `4abe5509` CI run 40048477593 finished with 11 successful, 4 failed,
19 skipped and 3 cancelled jobs. All 7 failed/cancelled logs, including aggregation
gates, were inspected: 62 visible assertion markers were covered by exact-main
controls; no unknown markers or failures of the repaired fixtures remained.
The exact CI merge `3c8ed5cc` and its main parent `d81d6b67` reproduced both CLI
failures with identical failure-message multisets. The new public assignment CLI
passed on that CI merge. These controls apply to that executed revision; current
head CI must be assessed separately, especially because main has since repaired
several baseline cases. Cancelled jobs do not establish unexecuted coverage.
