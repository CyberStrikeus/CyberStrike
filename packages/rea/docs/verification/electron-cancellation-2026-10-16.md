# Electron cancellation verification, 2026-10-16

[#4388](https://github.com/morluto/rea/issues/4388), existing
[#4387](https://github.com/morluto/rea/pull/4387), umbrella
[#4027](https://github.com/morluto/rea/issues/4027).

The cancellation boundaries and retained cancellation cause are verified below.
The complete real Linux Joplin workflow remains **partial or failed** because
process ownership/cleanup cannot be verified. Publishing a typed reply, exiting
the CLI, and cleaning up its application are separate observations.

## Source and deterministic regressions

Latest-main control is `fe2a398dd9ab290ba6cb3411403d319cec8d07a2`.
The existing reviewed PR head `af732dd8` was integrated with that main in
`3b094802a`. Its initial 47 focused cases passed. An unrelated compact-catalog
test hit its unchanged 10-second CI deadline; an unchanged-source job retry
passed. The original failed execution remains in CI history.

Real CLI verification exposed an introduced regression: the PR replaced an
already observed cancellation with success after the final snapshot. A later
cleanup failure then lost the cancellation category and caller reason. Two
deterministic cases reproduced this for process and transport cleanup: 20 old
cases passed and both new cases failed. Main's public reply retained category
`cancelled`; the reviewed PR returned `execution_failure` for the same kind of
cancelled wait plus incomplete cleanup.

Fix `73d4a712b` records cancellation before finalization and uses one constructor
for the early and late partial-capture errors. Cleanup failure keeps precedence,
its diagnostics and the earlier cancellation cause. Cancellation first observed
during cleanup retains the existing precedence. The fix changes the producing
outcome; no CLI/MCP projection repair or ownership-policy exception was added.

All **49 focused cases in three files** passed after the fix. Full static checks
passed: six tasks plus architecture guards. Documentation checks also passed
(six tasks, including two cached, plus five README consistency cases). One intermediate build rejected an
over-narrowed `aborted === true` comparison; the original truthiness pattern
resolved that TypeScript error before the passing build. Recorded catalog
metadata is byte-identical to main. No new tool, schema, cache or normal-case
result field was added.

## Real application observations

The unchanged official Joplin 3.7.21 ASAR is 233,575,014 bytes, SHA-256
`767df409b18effe60421fbefcca873de237c7e813eac744ecdeebbc5e825a33a`.
Acquisition is linked in the [original Joplin verification](javascript-native-handoff-identity-2026-10-15.md).
Its complete unpacked native files/assets accompany it. These trials use the
actual application with **generic Electron 44.7.0**, fresh profiles and Xvfb.
They exercise startup/cancellation, not a completed Joplin business workflow.

Frozen verifier revision `279aa29a7` records source/runtime hashes before the
final probes. The controlled cases hold a REA-side Playwright reply while the
real application runs. They do not establish a naturally occurring Joplin stall.

| Controlled condition                        | Observed result                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Main: first-window reply stays pending      | Still pending 20.001 s after cancellation; verifier watchdog fails                                     |
| Fixed: same pending first-window reply      | Cancellation returned in 5.658 s; cancelled action retained                                            |
| Fixed: initial snapshot reply stays pending | Cancellation returned in 5.335 s; no invented partial snapshot                                         |
| Fixed: final snapshot reply stays pending   | Cancellation returned in 10.262 s; five-second cancellation grace expiry and initial snapshot retained |

Every fixed case preserves the `cancelled` category. Every real case still has
unverified provider cleanup and a nonzero verifier exit; these are cancellation
phase proofs, not complete runtime passes. The known Linux ownership gap is
tracked in [#4282](https://github.com/morluto/rea/issues/4282). Ownership was not
inferred from process names, PIDs or executable paths to make these tests pass.

The public CLI trials send SIGTERM after actual Joplin startup logging. Main
and the fixed version both publish `cleanup_incomplete` with category `cancelled`
and a cancelled action. The fixed reply was observed about 5.268 s after SIGTERM
(50 ms polling resolution). Both fail the verifier's 20-second first-signal exit
deadline and require a second, explicitly recorded recovery signal. The resulting
143 exit is not proof that the first signal completed cleanup.

The official packaged Joplin executable also passed static fuse admission, but
its initial Inspector evaluation failed with a destroyed execution context before
the cancellation condition was reached. Those attempts remain failed diagnostics;
they establish no bundled-runtime compatibility or cancellation result.

## Costs, limits and reproducibility

Costly operations run serially on one CPU 10 with an 8 GiB hard limit, 6 GiB
early stop, no swap and 192 tasks. The passing static gate used 153.534 s wall,
152.274161 family CPU seconds and 6,442,016,768 peak cgroup bytes. It reported
no OOM and verified payload cleanup. Cgroup memory includes file cache, not RSS.
Other trials' exact counters and failures are preserved in the
[compact record](electron-cancellation-2026-10-16.json).

Payload-exit counters are collected while the observer remains alive and are
not final whole-scope counters. Some failed probes retain live app/Xvfb processes
at that point. Every recorded scope was independently confirmed inactive/dead
after the external owner stopped it. That recovery does not establish successful
provider cleanup.

OS/build caches are uncontrolled. A timed-out baseline and a partial fixed
workflow do not establish a completed-task speedup. Live event sets also differ,
so reply-size differences do not establish token savings. Model billing, peak
agent context and complete host/tool-schema token costs are unmeasured. Historical
diagnostic helper hashes were not captured at execution; the record marks that
gap instead of assigning the later frozen hash to earlier runs.

Build each pinned checkout, then run under the existing
[resource observer](https://github.com/morluto/rea/blob/42e1a17d6e6c0487f17be0bae248553c4caba7f7/experiments/analysis-efficiency/resource-counters.md)
and a private Xvfb instance. The shared verifier supports all four named cases:

```sh
node experiments/analysis-efficiency/electron-cancellation.mjs \
  --runtime-root /absolute/pinned-checkout \
  --executable /absolute/electron-44.7.0/electron \
  --application /absolute/Joplin/resources/app.asar \
  --profile-root /absolute/temporary-profile-parent --case window-wait
```

Use `initial-state`, `final-state` or `normal-wait` for the other boundaries.
The public CLI probe has no injected stalled reply:

```sh
python3 experiments/analysis-efficiency/joplin-cli-cancellation.py \
  --node /absolute/node-24.18.0/bin/node --runtime-root /absolute/pinned-checkout \
  --executable /absolute/electron-44.7.0/electron \
  --application /absolute/Joplin/resources/app.asar \
  --profile-root /absolute/temporary-profile-parent
```

The scripts return failure rather than claiming complete cleanup when the real
owned app remains unresolved. App binaries, extracted runtimes/profiles and raw
large output are regenerable and are not committed. No macOS, Windows, full
Joplin GUI or live-model success is claimed.

## Review follow-up: verifier exit semantics

Review of `beb4a47db` found a verifier false pass: the shared probe could exit
successfully once its main process had exited even though provider cleanup was
still unverified. The CLI probe also accepted `cleanup_incomplete`. Those are
verifier bugs; they do not invalidate the recorded failed Joplin trials above.

Revision `227217ac3` requires verified provider cleanup in both probes and the
public `cancelled` category in the CLI. Six controlled oracle cases cover an
exited main process with incomplete cleanup, complete cleanup, transport failure
after process cleanup, and a wrong public category. Both old scripts fail these
regressions; the fixed scripts pass all six. These cases substitute provider/CLI
replies and do **not** establish real-provider compatibility or performance.

The fixed, frozen scripts were then rerun on the same real Joplin artifact. The
shared window-wait probe retained cancellation in 5.577 s and explicitly failed
because cleanup remained unverified. The public CLI retained category `cancelled`
and a cancelled action, published its reply about 6.335 s after SIGTERM, and
again failed the first-signal exit deadline. Both verifiers exited nonzero; their
externally owned scopes were stopped separately. Production source and the
earlier historical records are unchanged. The compact record appends these
observations under `review_followup`.

Run the controlled oracle regressions separately from the real-app commands:

```sh
python3 experiments/analysis-efficiency/electron-cancellation-oracles.py \
  --node /absolute/node-24.18.0/bin/node
```
