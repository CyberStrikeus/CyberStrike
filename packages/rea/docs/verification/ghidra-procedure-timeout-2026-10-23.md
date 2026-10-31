# Ghidra per-procedure deadline verification — 2026-10-23

The completed MCP task attempts pseudocode for a complex function under an
approximately one-second budget, then obtains pseudocode for a small function.
Two rounds use one client connection. Before the feature, the caller cancels
its slow request; afterwards Ghidra enforces the configured native decompile
limit and returns a typed timeout while keeping the session.

## Source and artifact

Baseline main: `9e6c6241d7e595c6f3e90d23f30f3d43bc8c9527`.
Original PR head: `cb754c9258de3bd6a2c9da1bf71da63085a49288`.
The maintenance integration preserves main's centralized startup and environment
owners. The measured feature source is `5a10db4b2`; the natural timeout probe
ran on `043110b85bc5e1af9f3c7de2856733885c67046c`, before the subsequent recovery
wording and client deadline guidance changes.

The generated Linux x86-64 ELF shared library has 3000 volatile-state branches,
contains `rea_slow` and `rea_small`, and is 174,840 bytes.
Source SHA-256: `f99074876faae8e18e45265dab007b6fcc396fe909d57efab72adc8925a960c7`.
Binary SHA-256: `9c49d2eef9c2083f6f66f38de4ed0ee1bac17ca5b73dc8f3a90d9ba62a8d1d5d`.
The benchmark regenerated the verifier's C recipe and checked both hashes
against the original natural probe. Compilation used existing `cc -shared
-fPIC -O0`. The target was never executed, and its bytes remained unchanged.
Fixture preparation is separate from the analysis task (1.215 s elapsed,
1.127 s waited CPU); both variants analyze the same prepared artifact.

Both variants used existing Ghidra 12.1.4, Temurin JDK 21.0.12.1+1, Node
24.22.1 and the locked dependencies. The upstream analysis-profile digest is
`ae80ece8c83379eddabbdf379bbffca5da84c7df7fa7c159f45fa810468f85d9`.

## Real behavior and identity

The natural provider probe used the authenticated loopback TCP bridge. With
`REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS=1`, `analyze_function` returned a live
partial dossier with 45,007 assembly lines and
9,001 basic blocks. Pseudocode, native API and native value flow were
unavailable. A separate pseudocode request returned `provider_timeout`, with
canonical `retryable: true` and the setting/limit in its explanation. The next
small function decompiled successfully. Fresh authenticated pings before and
after retained the same owner-generated per-launch run ID; this probe does
not accept a caller-fixed launch ID. Cleanup and unchanged target bytes were
verified. The probe took 56.832 s elapsed, 86.017 s waited CPU and 1426.7 MiB
sampled family RSS.

The public CLI command `rea function slow-decompile.so --procedure 0x1010f9
--provider ghidra --format json` also exited zero with the same 45,007 assembly
lines and 9,001 basic blocks, and explicit unavailable decompiler facets.
It preserved the target digest and completed in 61.776 s elapsed, 89.656 s
waited CPU, with 2169.9 MiB sampled family RSS. The complete JSON was
25,929,463 bytes; this is a full-evidence CLI output, without a compact-output
claim. A standalone CLI invocation closes its own session when done.

The public MCP benchmark used production `scripts/rea.mjs mcp` and the pinned
SDK. The baseline's caller deadline armed after the request was written. The
native limit starts inside Ghidra's decompiler, so these are approximate,
phase-specific one-second budgets rather than identical timer locations.
Both slow attempts failed under their budget. The following small pseudocode
was identical across variants and both rounds (64 UTF-8 bytes, SHA-256
`c947ff22cab1ffef9b962b12d82e12d0e5f5e2a6c5634a2ed5ea3c353e1d5807`).

Before the feature, the next request automatically re-imported the target;
the driver did not force close/open when that request succeeded. Two JVM
changes were observed. Afterwards both rounds retained one JVM. These
observations combine descendant membership with the existing process-start
identity primitive; PID and executable path alone are not used as identity
proof or authority to signal processes.

## Completed-task measurements

| Scope                                 |   Baseline |    Feature |
| ------------------------------------- | ---------: | ---------: |
| Cold bounded attempt + small function |   76.207 s |    1.540 s |
| Warm bounded attempt + small function |   73.275 s |    1.380 s |
| Full verifier elapsed                 |  237.602 s |   95.388 s |
| Full waited process-family CPU        |  232.779 s |   90.945 s |
| Sampled family peak RSS               | 2051.3 MiB | 2008.8 MiB |
| Full task estimated tokens            |    983,317 |    989,913 |

The full task includes catalog discovery, open/inventory, both rounds and
close. Both variants made eight recorded SDK calls, including tools/list.
The baseline also emitted two cancellation notifications. All 221 tools remain;
only the descriptions of `batch_decompile` and `decompile_all` changed, to
explain serialization and whole-call deadlines. Input/output schemas stayed
identical. Catalog estimates were 974,158 → 974,222 tokens.

Estimated context increased **0.67%**. The timeout now returns canonical
provider diagnostics, including captured startup stdout/stderr, instead of
only a serialized SDK cancellation error. The current shared diagnostic
projection remains a context cost. These measurements establish session reuse
and avoided re-imports, rather than token reduction.

Counts use tokenx 1.3.0 on actual tool arguments and complete SDK results,
including textual/structured projections, the observed serialized cancellation
error and actual cancellation notifications. They are heuristic estimates,
not model-specific BPE or actual model usage. Handshake framing, prompts,
reasoning and subsequent evidence inspection are unmeasured.

Cold/warm denote task rounds inside one client. Baseline cancellation loses
provider reuse. Filesystem/JDK caches were not flushed and the baseline ran
first. Initial open/inventory was 84.615 → 89.631 s.
Host load, compilation caches and runtime startup vary; this single-artifact
pair does not establish a general latency, CPU or RSS speedup. Full metrics
include SDK, token estimation and passive identity verification overhead.

Runs were restricted to two CPU cores, a 2 GiB Node heap and a 1 GiB configured
Java heap, with 6 GiB sampled family RSS, 300 sampled CPU seconds and 600 elapsed
seconds as verifier stop conditions. CPU is waited child usage for the complete
run. RSS is sampled every 50 ms, can double-count shared pages and can miss
short peaks. These guards are not kernel memory limits. Both completed runs
exited zero without a resource stop. Detailed phase samples use independent
timers and can differ slightly from the outer peak.

## Bounds, caller deadlines and lifecycle

The positive whole-second maximum is 2,147,483. This follows Ghidra 12.1.4's
signed integer seconds-to-milliseconds conversion, rather than an arbitrary
day cap. [Pinned upstream implementation](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.4_build/Ghidra/Features/Decompiler/src/main/java/ghidra/app/decompiler/DecompileProcess.java#L562).
Configuration tests cover the last safe value and the first overflowing value.
A real MCP export/resume with that maximum succeeded on `/usr/bin/sha256sum`:
two files matched the baseline bytes, one verified file was skipped on resume,
and the target digest stayed unchanged. This validates acceptance and fast
operations under the maximum; it does not test a multi-day decompile or every
client's timer capacity.

The cap applies per native decompile. Static registration defaults can only
estimate startup + one decompile + headroom. Batch cardinality and other work
are unknown at configuration time; a finite static value cannot guarantee an
arbitrary bulk call. Doctor and both bulk-tool descriptions state that scope.
A two-item 600-second example with 330-second startup and 120-second headroom
needs an estimated 1650 seconds, plus any additional work. Existing positive
client deadlines, whether shorter or longer, remain caller choices. Tests
verify advice, unchanged 10/1800-second Codex selections and no file rewrite
or backup on an aligned registration. Work can be split, or selected with
`decompile_all` limit/resume. Caller cancellation still closes the session.

The queue retains the observed remote failure as primary when cancellation
also closes the session. One message owner interprets that fact across native
timeouts, ordinary decompiler failures and regex resource errors. Unconfirmed
cleanup does not promise immediate restart. The original projection fails five
of six new regression cases; all six pass after repair. Cleanup-owner and
cancellation-reason preservation are covered through the production queue.

## Main integration

Main `bcd18d289845051b0f0513e11bc1aefd3f766902` was merged for admission after
the paired measurements. The two conflicts preserve both the upstream
single-active-provider-read batch description and the new deadline guidance,
and both registration-test imports. The report's measured source remains
pinned above; this integration is not a repeat of the performance pair.

The first complete `npm run check` on this integration stopped at formatting
errors in six files, all byte-identical to that exact main: third-party
notices, JavaScript artifact graph findings, reconstruction journey findings,
IDA doctor source/CLI tests, and native UI MCP tests. Blob identities are
retained in the raw receipt. This full gate is not reported as passing.

## Review follow-up verification

The Java regex error factory now reports the engine failure, stage and caller
pattern without promising a session lifetime or prescribing recovery. The
provider's existing queue-aware continuation owner adds session state for
healthy, concurrently cancelled and cleanup-incomplete outcomes. The boundary
matrix now uses actual producer wording for all three failure families and
covers nine state combinations.

The timeout remediation distinguishes new Codex/Kimi registrations from
existing positive client deadlines, which setup preserves. It directs callers
to edit an existing deadline explicitly.

- Updated source/boundary tests: 235 passed; two unchanged main SIGKILL wording
  assertions still fail as reproduced on the exact base.
- Full `npm run check` passed on the review follow-up integrated with main
  `ba9c5bc6867272d02d2fcc9d5c7c2ea83f234067`.
- The real Ghidra producer probe passed 41 checks with complete cleanup,
  including the real regex factory's selector/stage and fact-only wording.
  This invokes the actual factory and is not a natural regex stack-overflow
  reproduction. The whole probe took 42.416 s elapsed, 55.326 s waited CPU and
  788.5 MiB sampled family RSS.
- Negative controls retained old production source at
  `b4e105a48c381f1f1f86e277f771edf98e37ea6a` with updated verification inputs.
  The deadline assertion fails on the old hint, and the corrected real Java
  control fails specifically at
  `regex_failure_leaves_lifecycle_to_provider`.
  The initial producer-control harness did not compile and is excluded from
  regression proof; the final control's assertion and complete diagnostics
  are retained separately.

The completed-task timing/context pair above was not repeated after these
wording changes or subsequent main integration. Those later costs are
unmeasured; the earlier estimates remain tied to their pinned source.

## Capability and traversal guidance follow-up

The static `analyze_function` capability previously described only completion
or caller cancellation. Its producing descriptor now names the optional
per-function setting and describes closure requests, leaving observed session
state to the queue-aware error owner. Every function response receives this
same capability; consumers do not reinterpret the setting.

The deadline advisory now covers multi-function workflows in general,
including `trace_native_values`. The trace's tool description and client,
installation and MCP guides explain that serial decompiles and other work need
a whole-call allowance; reducing `max_functions` selects less work without
changing existing positive client deadlines.

At source `7caac1fbc5833f145d9cc0f87efcb6ebf8c2efd6`, including main
`0785223582e5ecef4150e8bb736b9c6857703699`:

- The full `npm run check` passed after correcting one formatter mismatch in
  the advisory. The first attempt stopped at that mismatch and is retained.
- All 42 deadline/registration tests passed. Old production with updated test
  inputs fails both Ghidra traversal-advice cases; the Hopper control passes.
  Its built capability also fails the new setting-advertisement assertion.
- With the setting explicitly selected as one second, the real producer lane
  passed its 41 Java checks and verified that the real healthy provider's
  function limitations carry the new control policy. Cleanup completed.
  The complete lane took 32.263 s elapsed, 48.337 s waited CPU and 785.3 MiB
  sampled family RSS. Degraded behavior in this lane uses failure injection;
  this is not a fresh natural large-function timeout run.
- `npm run docs:check` passed.

The completed-task performance pair remains tied to its earlier pinned source;
these later capability/catalog wording costs were not measured by that pair.

## Verifier fixture budget

The optional branch-count override is bounded before source allocation by a
1 MiB generated-source budget and a conservative maximum line size, including
the longest safe-integer decimal representation. The resulting maximum is
11,272 branches; this bounds the line array, joined string and compiler input,
not a claim about Ghidra capacity or compilation memory. Existing command
supervision still bounds compilation time.

A direct generator check admitted 1, 3,000, 6,000 and 11,272 branches and rejected
zero, negative, fractional, billion-branch and maximum-safe-integer requests
before generation. The maximum generated 854,215 bytes. The 3,000-branch source
remains byte-identical to the measured fixture (SHA-256 `f99074876faae8e18e45265dab007b6fcc396fe909d57efab72adc8925a960c7`).
These checks do not repeat the real-provider measurements above.

## Validation and limits

- The initial selected source/boundary run passed 310 tests with 10 platform
  skips. After the related cancellation changes, all 174 provider/queue cases
  passed. Overlapping executions are not summed.
- Client deadline scope and registration tests passed 41 cases.
- The final pre-refresh source/boundary run passed 351 tests with 10 platform
  skips. The schema suite initially could not load its missing generated test
  metadata; after generation, all 15 SDK schema cases passed separately.
- The real Java producer probe passed 39 checks, including injected timeout
  state, unchanged listing facets, live snapshot policy, timeout explanations
  and recovery. This is injected failure verification on the real engine,
  separate from the natural timeout and public MCP observations.
- The natural Ghidra probe, public MCP paired task and real maximum-bound
  export/resume passed as described above.
- An additional real MCP batch probe requested the same slow entry twice
  under a sufficient explicit 600-second client deadline. Both items returned
  their own provider_timeout result; a following small function succeeded in
  the same observed JVM. The batch phase took 2.976 s. This covers two
  requested items, not two distinct slow functions or large-batch capacity.
  The separate full probe took 102.887 s elapsed and 145.300 s waited CPU.

Real-provider coverage is Linux x86-64 Ghidra 12.1.4. Windows, macOS, other
providers, universal performance and very large batch capacity remain
unverified by these runs. The original author's macOS report is separate
from this maintenance verification. Raw exchanges, complete error diagnostics,
process observations, scripts and resource receipts remain in
`/tmp/rea-maintenance-20261023/5662/`; generated binaries and provider projects
are not committed.
