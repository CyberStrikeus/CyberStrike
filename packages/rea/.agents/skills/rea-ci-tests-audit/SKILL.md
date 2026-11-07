---
name: rea-ci-tests-audit
description: Audit REA CI and test suites for correctness, fixture drift, false passes, and measured performance; use for suite or workflow investigations and efficiency changes, rather than ordinary feature testing or a single test failure.
---

# REA CI and tests audit

Establish which checks still catch real regressions and which costs can be
removed without losing that protection. The outcome may be a verified fix,
an evidence-backed recommendation, or an explicit decision to stop.

Follow the checkout's `AGENTS.md`, [testing guide](../../../docs/testing.md),
and [contribution rules](../../../CONTRIBUTING.md). Use their current commands
and pinned toolchain, rather than commands remembered from an earlier audit.
Preserve the requested scope: investigation alone does not authorize edits;
this skill does not grant permission to publish issues, push, or merge. Existing
user authorization still applies. Keep audit notes and raw results outside the
tracked tree, normally in a task-specific `/tmp` directory.

## Establish the executed baseline

Fetch when the user asks for latest main. Pin the baseline SHA and inspected
workflow revision; use an isolated worktree when changing or comparing code.
Do not modify another task's checkout. Record dirty changes and the exact
command, toolchain, host, selected tests, instrumentation, and prerequisites.
An old run is evidence for its executed revision, even if main advances.

Trace workflow triggers, changed-path selection, job dependencies, reusable
actions, package scripts, test discovery, artifact producers, and report gates
through to the commands that actually execute. Include scripts, generated data,
runtime registration, and subprocess boundaries missing from import graphs.
Check positive and negative selection paths: required files must be discovered
once per intended test configuration; deliberate platform/configuration repeats
are separate coverage. A missing explicit test or missing required report must
not turn green. Optional lanes may skip; preserve their stated prerequisites.

Use existing timing and failure artifacts to select suspicious families. Run
relevant checks to establish a baseline; reserve a full local suite for broad
CI diagnosis or uncertainty that focused checks cannot resolve. Do not rebuild
or rerun an unchanged complete suite after every documentation edit.

## Prove the failure or protection

For each candidate, state the expected observable behavior and its owner,
then construct the smallest reproduction against production behavior. Follow
the producer and affected consumers before deciding where to fix it.

- For drift, compare fixtures with current admission requirements, protocol
  replies, named contracts, tool versions, and actual public entrypoints. A
  plausible-looking mock can fail before the behavior its test claims to cover.
  Search the whole affected fixture family, including other version strings.
  Preserve intentionally malformed fixtures and test their intended rejection.
- For a suspicious green test, perturb the relevant behavior in an isolated
  copy or inject a controlled failure. Verify that the existing assertion or
  gate detects it. A test may merely repeat its mock, import abandoned code,
  or hide a subprocess/checker failure. Restore mutations after the experiment.
- For shared setup or pruning, map distinct assertions to their retained
  scenarios. Preserve malformed inputs, cancellation, cleanup failure,
  permissions, capacity, identity, and meaningful concurrency interactions.
  A faster run that skips a case or weakens its oracle is not an improvement.
- For provider coverage, separate fake-producer, boundary, and actual-engine
  evidence. Inspect named skips and prerequisites; fixtures do not establish
  real Ghidra, LLDB, browser, or other provider behavior.

Classify findings as reproduced defects, supported costs, hypotheses, or
unavailable evidence. Record the baseline command, observed output/exit status,
expected result, affected scope, and competing explanation. A failure on main
may be pre-existing; that does not by itself make it irrelevant to a CI audit.
Attribute PR failures using the executed revision and a clean baseline, not
just their resemblance to a previous failure. Retry only to test a specific
transient explanation; retain the original failure and stop when repetition
adds no evidence. A passing retry does not establish a root cause or a fix.

## Assess efficiency without losing the gate

Read [measurement and CI checks](references/measurement-and-ci.md) when
investigating slowness, caching, runner waits, shared artifacts, or log noise.
Compare equivalent completed work before claiming a speedup. Distinguish
setup/build time, test execution, coverage instrumentation, dependency waits,
and runner scheduling; state which costs remain unmeasured.

Prefer removing proven duplicate preparation, reusing immutable setup, and
reducing repeated subprocess work before shrinking correctness coverage.
Preserve independent sessions where lifecycle or concurrency is the oracle.
Keep live tests fresh; a cached previous pass cannot validate current host,
installed provider contents, permissions, or external state.

## Fix, verify, and hand off within scope

If implementation is authorized, make the smallest structural change at the
owning boundary and add a regression that fails on the baseline for the right
reason. Retest affected consumers and meaningful negative paths; verify cache
invalidation or discovery when those mechanisms change. Read the installed
Turbo documentation before changing its configuration or commands.

Run the repository's applicable checks and inspect complete current-head CI
results before an authorized merge. Preserve required coverage and discovery
gates. Do not suppress a failure, add blanket retries, raise timeouts, or delete
distinct assertions solely to make CI green. Changes to these controls need
their own demonstrated reason and retained failure detection.

Report each confirmed issue with exact revision, reproduction, consequence,
proposed correction, and validation limits. Report performance with workload
and measurements, not just a percentage. Use English issue/PR records when
requested; follow the user's assignment, commit identity, review, and merge
preferences without assuming them for other users. Open ready-for-review PRs
only when that lifecycle is authorized. Resolve necessary review findings and
check final main against the tested tree after merging.

Stop when the authorized work is verified, remaining benefits are unproven,
or further changes would trade correctness for speculative speed. List genuine
uncertainties without turning them into additional optimization rounds.
