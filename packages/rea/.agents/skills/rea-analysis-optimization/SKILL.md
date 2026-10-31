---
name: rea-analysis-optimization
description: Optimize REA providers and shared analysis workflows for agent context, latency, CPU, and memory while preserving correctness and Evidence. Use for analysis bottlenecks and cache or query design; CI/test-suite optimization belongs to rea-ci-tests-audit.
---

# REA analysis optimization

Find a concrete source of unnecessary work, change it at its owner, and verify
equivalent completed investigations. A useful outcome can also be a measured
decision to leave an implementation alone.

Follow the checkout's [performance priorities](../../../AGENTS.md#performance),
[tool design](../../../docs/tool-design.md), and
[testing guide](../../../docs/testing.md). This skill supplies an optimization
workflow, not additional permission to execute targets, publish, or merge.
Use the current contracts, provider prerequisites, and user authorization.

Reserve performance measurements for changes that target performance or have a
concrete regression concern. Routine cleanup uses correctness checks and does
not require this optimization workflow or synthetic benchmarks merely because
helper calls, imports, or representations change.

Read [the Kuna case study](references/kuna-case-study.md) when selecting a
reuse strategy or interpreting a benchmark. Its pinned observations illustrate
tradeoffs; they are not current-provider guarantees or universal speedups.

## Pin the question and the correctness oracle

Describe the analyst's completed task, including the facts and relationships
needed to answer it, requested detail, source access, and meaningful unknowns.
Choose a representative real artifact and a small or empty case. Record the
baseline revision, target digest, engine identity, options, host, and entrypoint.
Use a separate checkout for changes without disturbing other work.

Establish an oracle independent of the changed implementation: source-built
fixture expectations, independently mapped file bytes, or a native producer
paired with checks of its interpretation. Comparing two wrappers around the
same faulty decoder does not establish correctness. Preserve address widths,
same-address alternatives, unresolved endpoints, coverage, and source linkage.
An empty result proves absence only within the actually examined scope.

## Locate the earliest unnecessary work

Trace one public CLI or MCP task through shared application code to its producer.
Measure relevant phases: admission and identity checks, native analysis,
decoding, lookup, projection, serialization, Evidence retention, and cleanup.
Include catalog discovery and extra calls when they affect the completed task.

Use the evidence to choose the smallest structural correction:

| Observed cost                     | Candidate correction                                       | Condition to establish                                                               |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Repeated scans of validated facts | Reuse existing order or lookup structure                   | The owner establishes ordering and identity; every matching alternative survives     |
| Repeated equivalent engine work   | Share a validated result or in-flight producer             | Inputs, freshness, lifetime, and per-caller outcomes remain explicit                 |
| Full reports for selected facts   | Push selection or projection to the earliest capable owner | Required facts and evidence remain reachable; examined coverage is reported          |
| Large temporary transport buffers | Decode incrementally or use bounded source reads           | Validate the whole admitted document; retained facts and copies still consume memory |
| Many repeated homogeneous reads   | Share admission, decoding, or batch work                   | Preserve item identity, order where required, and individual failures                |

Do not introduce an index, generic cache, batch endpoint, or orchestration layer
without identifying the work it removes and its maintenance/resource cost.
Projection after materializing a full report may reduce output while leaving
analysis time and peak memory unchanged. Fix missing or incorrect facts before
benchmarking an alternative composition against a better-covered workflow.

## Keep one interpretation and a defined reuse lifetime

Let the producer boundary validate and normalize facts once. Consumers query
that representation through the shared CLI/MCP implementation; adapters should
not rebuild relationships or independently reinterpret raw reports. Keep lookup
identity separate from display formatting. Reuse contracts when their intent
matches, honoring requested detail and complete Evidence access.

For every cache or shared producer, state its key, owner, invalidation, retained
size, and lifetime. Account for result-affecting target bytes, engine contents,
analysis options, architecture/load mapping, and parser/schema versions where
they affect reuse. Validate live state before calling a cached observation
current. Cache a refusal only when it is deterministic for that validated key;
malformed, partial, transient, or cancelled attempts need explicit retry policy.

One cancelled waiter must not invalidate a successful peer. Preserve producer
failure context and each caller's cancellation reason. Retain ownership and
capacity charges until shared work and cleanup settle; preserve completed
observations when cleanup fails. Exercise invalidation, concurrent consumers,
last-waiter cancellation, close, and cleanup retry when those paths change.

Bound the process family and retained state, not just a parent heap or worker
count. Account for decoding and serialization expansion before allocation.
Choose CPU, memory, concurrency, and disk limits from the host and workload;
stop before OOM and verify owned cleanup. A guard-stopped task is incomplete.
Do not replace a transport buffer cap with an unbounded retained inventory or
hide partial results behind a success status.

## Compare completed tasks and limit the claim

Run the affected real public workflow before and after with equivalent inputs,
results, coverage, and Evidence semantics. Include small inputs so setup costs
and regressions are visible. Distinguish fresh sessions, warm runtime caches,
and OS file caches. Alternate or repeat runs when variance affects the decision.
Choose meaningful boundary regressions for cases the actual engine cannot
reliably reproduce; a fake engine does not qualify a real provider.

Report task outcome, relevant phase timings, total elapsed and CPU time, peak
process-family memory and its accounting method, resource stops, and cleanup.
Check the payload exit status as well as the profiler's. Keep failed attempts
and identify unmeasured costs; a passing retry does not explain a failure.

For token claims, count schemas/discovery, arguments, replies, retries, and
continuations needed to finish the task. Label tokenizer estimates separately
from actual model usage and record the client/catalog behavior. Smaller JSON
alone establishes neither fewer model tokens nor better investigation quality.
Do not claim a complex-software advantage without completed representative
investigations and comparable correctness/coverage.

Finish with the bottleneck, owning change, preserved semantics, executed
checks, before/after measurements, and remaining limits. Keep any integration
record current with its tested revision and distinguish merged production work
from experiment-only code. Stop when the demonstrated bottleneck is resolved
or further benefit remains speculative.
