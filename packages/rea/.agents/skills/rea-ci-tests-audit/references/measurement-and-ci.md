# Measurement and CI checks

## Equivalent completed work

Record the source/workflow SHA, command, test identities and counts, skips,
assertions or output contract, exit status, coverage scope and thresholds,
toolchain/provider versions, host resources, and prepared artifacts. Inspect
both the child result and its report: a profiling wrapper may exit successfully
after the measured command failed. Focused tests can pass while global coverage
thresholds fail; describe both rather than calling the command green.

Measure wall time, user/system CPU, and peak process-family memory for relevant
completed tasks. Parent-only RSS misses workers and their children. On Linux,
summed RSS can double-count shared pages; report RSS/PSS semantics, sampling
interval, missing samples, and observed cleanup limits. Use equivalent host
tools elsewhere. State unknown costs, including agent tokens; fewer log bytes
alone prove neither fewer tokens nor faster tests.

Separate cold execution, warm build/file caches, and warm runtime caches.
Use repeated or alternating runs when variance affects the decision, with
enough observations to distinguish the proposed benefit from noise. Keep
workload, instrumentation, and host conditions comparable; record interference.
A run with fewer tests, early rejection, lost coverage, or a different runner
does not prove suite acceleration. CI-wide claims need end-to-end measurements,
not an extrapolation from one improved family.

## Workflow, caches, and shared artifacts

Trace each reused result from producer to consumers and identify its lifetime.
Check key/input coverage against the actual file inventory and result-affecting
configuration, environment, generated data, tool versions, and host state.
Exercise an affected input change to prove invalidation; exercise an irrelevant
change to support reuse where useful. Cache deterministic preparation and
static analysis only when their inputs fully describe the result.

Verify downloaded artifacts match the expected revision, platform, runtime,
and schema. Check restore misses, failed/partial producers, stale reports,
removed output files, and consumers after producer failures. Shared writers
need output ownership or locks; tests need isolated state, not an unnecessary
global lock. Worker counts do not bound children spawned within each test.
Preserve intentionally concurrent scenarios while bounding unrelated batches.

Check matrix expansion and all job pages before saying CI passed. Inspect
required gates after failed, cancelled, and skipped dependencies. `always()`
alone does not preserve failures; inspect the aggregation logic. Test/report
uploads should retain available diagnostics after failure, while absent or
malformed required results must fail closed. Do not demand an optional report
from a lane intentionally excluded by the selector.

## Runner waits and console noise

Use per-job and per-step timestamps where available. Workflow creation to job
start includes dependencies and other delays; it is not necessarily runner
queue time. Identify when the job became eligible before attributing waits to
runner capacity. If eligibility/queue timestamps are unavailable, report the
combined delay and unknown split. Compare equivalent lanes and runner types
across enough runs; a single busy runner is not a workflow regression.

For console reductions, retain checker exit codes, actionable errors, useful
summary counts, and complete machine-readable artifacts. Verify authored code
remains in the actual checker inventory when excluding generated outputs.
Introduce an authored error as a control; it must still fail. An ignore pattern
can hide real source as well as noise. Show that cached reports are restored,
stale successful reports cannot mask current failures, and report parse errors
remain failures. Measure readability or byte reduction separately from runtime.
