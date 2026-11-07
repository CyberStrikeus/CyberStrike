# Native directory decompilation verification — 2026-10-23

The [2026-10-26 follow-up](https://github.com/morluto/rea/blob/72454004772f826440c5e21002f4dd52b4ad43c0/experiments/analysis-efficiency/decompile-directory.md)
adds a 14,338-function real-provider capacity run, cross-session project reuse,
and a correction preserving historical source Evidence through shared workflows.

The completed analyst task is to export the bound provider's function inventory
as one local pseudocode file per non-external function, with names, body ranges,
provider/profile identity and the limitations of each used observation. The
agent receives a manifest rather than the pseudocode. A function decompilation
failure remains a recorded partial outcome and does not end the export.

## Artifact, provider and correctness

The real target was the installed ELF x86-64 `/usr/bin/sha256sum` (60,368 bytes),
SHA-256 `6cd7c6bfc81d645ba13b927e31651a1466092a28ed0bd2632e82f8b27882b25e`.
It was read and analyzed statically, never executed. Both variants used the
existing Ghidra 12.1.4 installation and JDK 21.0.12.1+1, Node 24.22.1, the locked
npm dependencies, `GHIDRA_HEADLESS_MAXMEM=1G` and
`GHIDRA_HEADLESS_JAVA_OPTIONS=-XX:ActiveProcessorCount=2`.
The upstream analysis-profile digest was
`ae80ece8c83379eddabbdf379bbffca5da84c7df7fa7c159f45fa810468f85d9`.

Baseline main was `5d2c8c2b78d2552da0e13a11d3e2678efb69810d`.
The feature branch integrates original PR head
`d3a207038cfc00d58a97b86b06af1368839bec99` on that base, with the maintenance
changes described below. The frozen integration is `c566cace04d24f8ccb3d54353ababf95b96c8830`,
including refreshed main `bded9c628de23643aab81f98959b6a473318a240`. The review fixes were verified on `d3e0e96821a09a447785d100f3d85139b6e77e96`. Each variant ran through the public production
`scripts/rea.mjs mcp` entrypoint and the installed MCP SDK client.

The baseline called `list_procedures`, then `procedure_info` for each addressed
entry and `procedure_pseudo_code` for each non-external entry. A local verifier
used the returned Evidence to materialize the same function files and retain an
index. It reused the feature's pure file-header renderer to keep file encoding
equal; baseline analysis itself used only the existing public primitive tools.
The existing `batch_decompile` item format does not retain per-function caveat
associations; its workflow limitations aggregate across items. It would not
provide equivalent per-function caveat provenance here, so the baseline uses
primitive observations. The feature called `decompile_all` once per output directory. Both retained the
complete MCP responses locally. A second export used a new output directory in
the same session. The feature additionally resumed the verified warm export.

Both cold and warm exports examined the same 298 provider inventory entries:
236 written, 61 external, one failed. Addresses, statuses, body ranges, function
names, pseudocode SHA-256 and complete emitted-file SHA-256 matched for every
entry in both rounds. The target's bytes stayed unchanged. This proves export
preservation of the provider's observed results; it does not establish that the
provider found every actual function or that its pseudocode is original source.

Ghidra failed at `0x10a510` with `Overlapping input varnodes`; the failure code
was `execution_failure`. The export still wrote 68 functions at later numeric
addresses. Resume skipped every successful/external entry and retried the one
failed entry without rewriting the successful files. Complete per-function
caveats stayed in the index, and no pseudocode was returned in the manifest.

## Measurements

| Completed workflow                             | Before: public primitives + local files | After: directory workflow |
| ---------------------------------------------- | --------------------------------------: | ------------------------: |
| Cold export: MCP calls                         |                                     536 |                         1 |
| Cold export: request + response token estimate |                               1,375,776 |                     3,800 |
| Cold export: elapsed                           |                                50.940 s |                  39.155 s |
| Cold export: sampled family RSS peak           |                              1754.5 MiB |                1709.3 MiB |
| Warm export: MCP calls                         |                                     536 |                         1 |
| Warm export: request + response token estimate |                               1,377,486 |                     3,800 |
| Warm export: elapsed                           |                                 8.566 s |                   8.058 s |
| Warm export: sampled family RSS peak           |                              1779.4 MiB |                1710.6 MiB |

The identical two-export task, including the full catalog discovery, open and
close, used **3,723,191 → 981,913 estimated tokens (73.63% fewer)**.
The extra verified-resume call is excluded from that comparison. The catalog
itself grew from 969,665 to
974,049 estimated tokens. All 220 existing tool definitions
were identical; only `decompile_all` was added. The per-export request/reply
reduction is about 99.72%; applying that percentage to the entire task would
overstate the benefit. A client which injects the entire catalog still pays its
large fixed context cost.

The full verifier process family took 85.697 → 62.034 s elapsed,
111.166 → 68.185 s waited CPU, and
1779.4 → 1713.7 MiB sampled peak RSS. The after run additionally includes
verified resume (0.266 s). These compare the retained baseline with the final review-fix run;
**no general CPU or elapsed-time speedup is claimed**. Earlier maintenance
trials ranged 50–83 s elapsed and 65–118 s CPU; they used earlier source
revisions and are retained separately. Full-run figures include SDK, verifier
formatting/hash checks and token estimation as well as REA and its provider.
Per-phase sampled CPU was 70.19 → 43.16 s cold and
6.15 → 4.42 s warm, subject to delayed child accounting. The
integration decision rests on equivalent results with far fewer agent-facing
calls and estimated context, plus bounded auxiliary accumulators.

Cold/warm here describe primitive analysis reuse inside one provider session.
Host filesystem caches were not flushed, and the baseline ran first. This is a
paired functional measurement, not a statistical speedup claim. Provider startup
and host load varied: the independent CLI runs below took longer than the MCP
runs. No claim is made about cold OS caches or other binaries.

Token counts use `tokenx` 1.3.0 estimates of actual tool arguments and complete
MCP call results, including both textual and structured projections. They are
not model-specific BPE counts or actual model usage. The completed-task total
also includes the actual `tools/list` response, open and close calls, and both
exports. MCP handshake framing, orchestrator prompts, reasoning, subsequent
agent reading of files and unknown model tokenizer costs are unmeasured.

Process-family RSS was sampled from `/proc` every 50 ms. Shared pages can be
counted more than once, and short peaks can be missed. Full-run CPU uses waited
child usage; per-phase CPU is a sampled `/proc` delta and can include delayed
accounting of exited descendants. Limits were two CPU cores, a 2 GiB V8 heap per
Node process, 1 GiB configured Java heap, 6 GiB sampled family RSS, 300 sampled
family CPU seconds and 600 elapsed seconds. These are verifier controls, not a
kernel memory limit. All reported completed runs exited zero without a resource
stop. No reduction in Java's analysis memory is claimed.

The first baseline verifier attempt stopped at the real per-function Ghidra
error because its harness initially required every primitive call to succeed.
It took 74.325 s elapsed and 101.569 s waited CPU, with no resource stop. The
completed baseline was corrected to retain that same failure and continue,
matching the requested partial-result semantics. The failed trial is retained
separately and is excluded from the paired completed-export table; no provider
fix or disappearance of that failure is claimed.

## Ownership, reuse and resource limits

The export owner parses a resumed journal once and updates its latest records
only after append and sync complete. The shared function-record schema owns
path/status validation for both journal and index; the append retains the
parsed snapshot, including nested fields, rather than the caller's mutable input. Index generation consumes those committed
facts instead of reading and parsing the whole journal again. Resume identity
covers target SHA-256, provider identity/version, analysis-profile digest and
layout. Unknown target/profile digests prevent resume. Files are checked afresh
with the shared stable-file hash owner and bounded reads, rather than trusting
an old checksum as current. `decompile_all` remains ineligible for snapshot
replay: filesystem publication must run for the actual request.

Journal descriptors, verified staging areas and the directory lease have one
cleanup owner. Failed close/removal retains that owner under the session; the
lease is released after child cleanup and initialization cleanup finish.
Initialization removes verified owned entries rather than recursively deleting
unexpected files. Function path reservations use case-folded ASCII lookup
keys while preserving the original address identity and chosen filename;
collisions receive a stable address digest suffix. Resume refuses conflicting
legacy reservations. These cases are exercised with the real filesystem on
Linux; a real Windows/macOS filesystem was not exercised.
A failed lease acquisition preserves even an empty directory
and reports its created path, because another holder may be preparing it.

The inline failure accumulator retains at most 32 rows within 2,048
JSON-encoded UTF-8 bytes. It omits display names before omitting complete
address/code/reason rows. Recent output-I/O diagnostics retain at most five
rows within the same byte budget. The index retains all complete function
records. Per-item caveat collection retains at most eight first-observed
provider/text groups within an 8,000-byte JSON-encoded UTF-8 text budget,
instead of retaining all distinct caveats to rank them.
Omitted observations are counted without retaining their text; this count is
not a distinct-caveat count. Complete caveats remain in the owning index.

Inventory and latest journal/index state still scale with the number of
functions and their retained metadata. Larger exports, long-running journal
histories and worst-case metadata expansion were not capacity-benchmarked;
this report makes no 100,000-function memory guarantee. The attempt limit is a
positive safe integer and does not allocate according to its numeric value.

## Validation

`npm run check` passed after the review fixes on `d3e0e9682`: type checking,
lint, formatting, dependency/metadata checks, module boundaries and architecture
guards. `npm run docs:check` also passed, including nine README conformance cases. After the main refresh, 226 tests passed across ten files, including the
four Ghidra profile suites and the six CLI/MCP/workflow/schema files. Earlier
Hopper lease and session-cleanup coverage below is additional; repeated tests
are not counted as new cases.

- The focused integration run passed 112 tests across 11 files; four
  macOS-specific real-Hopper startup cases were skipped on Linux. It includes
  public CLI/MCP behavior, actual SDK schema conversion/dialect/client checks,
  the shared lease extraction, session cleanup retry and descriptor ownership.
- After the final caveat/cleanup changes, 75 tests passed across the four
  affected files: 48 export cases, 20 workflow-Evidence cases, six filesystem
  ownership cases and one MCP caveat case. This adds five distinct cases to
  the earlier integration coverage; overlapping executions are not summed.
- Follow-up review coverage passed 72 tests across the workflow and MCP
  files, plus 22 filesystem/CLI/schema cases. This includes portable filename
  reservations, conflicting legacy
  journals, encoded caveat budgets and long failure names. Against the
  published pre-fix implementation, all three new regression cases failed;
  the complete SDK result for the long-name case was 485,937 bytes, above
  the 51,200-byte tool window. The repaired case retains useful failures
  inline and verifies complete names and caveats in the index.
- Original-PR controls reproduce the uppercase-input refusal, valid-journal
  initialization cleanup race, lost failed-close ownership, unexpected-file
  deletion, and the empty-root lease-acquisition race. These controls use the
  original production implementation, not the repaired one. An additional
  production selection control returns zero matching aliases before the fix
  and the selected alias after it. A separate negative control of the
  maintenance index-reuse change reproduced journal/index disagreement after
  mutation of the append input; retaining the parsed snapshot resolves it.
- Three real Ghidra CLI calls passed: uppercase address range plus limit 1
  wrote one of two functions; resume with limit 100001 skipped the verified
  file and wrote the other; an unmatched name selected zero and reported 298
  excluded inventory entries. Both output files matched the full MCP export.
  The CLI group took 166.128 s elapsed, 120.848 s waited CPU and 1257.0 MiB
  sampled peak family RSS, without a resource stop.

Raw measurements and verifier scripts remain in the maintainer workspace at
`/tmp/rea-maintenance-20261023/6170/`, including completed and failed attempts,
full MCP exchanges, all function outputs and equivalence checks. They are local
verification artifacts, not shipped provider projects or committed binaries.
Real-provider coverage here is Linux x86-64 Ghidra only. Hopper, IDA, Windows and macOS
were not exercised with real providers by this verification.

## CI attribution

The first maintenance CI run used synthetic merge
`798091d99f5c9f434d832981e0c8d28a5ec4aabc` and exact base
`9fd78a74f84a8e924bd58e7deaf5934bfb24f53c`. All 54 observed failing
assertions reproduced on both revisions with identical failure diagnostics
after normalizing only their checkout paths: 11 source cases and 43 built
cases. Forty built failures came from cancelled-shard logs and were absent
from the aggregate report; cancelled coverage is not claimed as executed.

The real-browser job also failed its stable-capture checkpoint. A bounded
checkpoint-only execution of the production verifier reproduced the same
`dom_structure: unchanged`, `scripts: unknown` result on exact base and
merge, with cleanup retained. Local Chromium was 155.0.8059.79 on Debian 12;
the CI Chrome version was not measured. This does not establish a passing
complete browser workflow. [The public CI attribution](https://github.com/morluto/rea/pull/6170#issuecomment-6373669748)
records the controls and separates these baseline failures from the three
actionable feature review findings fixed above.
