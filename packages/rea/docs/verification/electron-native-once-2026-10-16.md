# Native Electron once dispatch — 2026-10-16

#4593 was reported by review of #4562, but its source was already in main from
#4389. The initial report was explicitly source-only; subsequent paired controls
confirmed the bug. This change delegates `once` creation, firing and callable
selection to the actual runtime and observes only established callback entry.
CLI and MCP continue to share the same hook, event model, projection and retained
Evidence. No new tool, schema, execution authority or analysis cache is introduced.

## Paired native controls

The baseline is `709b5cbdc15aa757f89c38ecd12e5a47710747a6`. Final source is
`4ebd0f60e860daa57a7033c6e77ea7f5f4b8ac97`, including the two review-gap fixes below. Earlier source cohort
`c0b52b5408fa97013798e6ecee885ccac08e7356` contains the fix; the final cleanup
commit is `e60c4a1098321ed2a7f564ae35909a31d707694f`, which removes the obsolete fifth helper argument and
unreachable copied call/apply dispatch branches after inspecting every caller.
The pre-review gap-owner follow-up is `7f05f476c52498adba41d943ead1a86e7216ca76`. The adjacent JSON preserves
source hashes and separate measurement cohorts, including the initial 93-row prefix.
The final review JSONL contains 117 paired rows (39 inputs × 3 runtimes). The
earlier 96-row JSONL remains unchanged, including its initial 93-row prefix. Both
comparisons have identical native
control facts in each before/after pair. Regenerable binaries, apps, profiles
and multi-MB raw captures are excluded from Git.

| Actual engine                                              | Cases | Baseline behavioral differences | Fixed differences |
| ---------------------------------------------------------- | ----: | ------------------------------: | ----------------: |
| Node 24.18.0 (pinned)                                      |    39 |                               4 |                 0 |
| Official Node 24.21.0                                      |    39 |                              16 |                 0 |
| Generic Electron 44.7.0 embedded Node 24.21.0, run as Node |    39 |                              16 |                 0 |

The original 21-case reproduction found 0/9/9 differences respectively. The
pre-review 32-case cohort found 1/13/13. The final 39-case suite adds readonly
callback methods, emitter method invariants, native metadata writes, failure
recovery and non-callable callback methods. The extra pinned-runtime difference is registration
metadata ordering. On the newer runtimes, opaque callback methods can suppress
callbacks under the old hook although native dispatch executes them. The pinned
runtime also catches false invocation records when an opaque method legitimately
skips the callback. The added regression fails on the baseline for that false fact.

These are **controlled producer cases with a minimal Electron module**, including
the actual embedded Node binary, not a real GUI application's natural callback
loss. Native traces, receiver checks, failures and remaining listeners are compared
exactly. Expected property reads are derived from each runtime rather than copied
from one Node implementation. The custom-apply guard still checks its original
Arguments representation when the runtime actually invokes that method.

## Ownership and uncertainty

Native once wrappers keep their public callback identity and descriptor attributes.
The registration receiver forwards methods/getters to the original emitter and
supports readonly method descriptors. A private callable receives an actual
Arguments frame, avoiding application Array species/iterators when recording.
Metadata recognition and admission share one bounded descriptor lookup.

An application-selected opaque call/apply can bypass observation; a bounded
`custom-call`/`custom-apply` gap replaces invented invocation facts. Opaque native
metadata writes or registration lookups keep the exact original callback/native
operation and emit `once-metadata` gaps. The temporary unobserved scope is restored
even if registration throws. The 39-case suite checks this recovery, including a native alias that bypasses
patched `on`; the once owner retains the observation gap for that path. #4513 raw
recording-wrapper mutation remains explicitly unfixed.

Review found two missing failure facts: a decorator can register through an
unhooked alias and then throw, and a runtime can read a non-callable call/apply
property before dispatch fails. Both new regressions fail on the pre-review
source. The once owner now finalizes its missing gap in `finally`, after restoring
the scope; the callable metadata owner records a failed gap while preserving the
exact non-callable value. Error identity and native callback behavior are retained.

Two short-lived proxies are used for an observable once registration. Metadata
remains weakly retained, and existing event/serialization budgets remain in force.
The added registration cost was not isolated; no speed or token improvement is
claimed. The saved producer comparison is a correctness experiment, not a whole
application performance benchmark. Its runner reports differences instead of
exiting unsuccessfully for an expected bad baseline; the regression tests assert
that fixed behavior matches native behavior and observation claims are truthful.

## Real application verification

Unchanged Joplin Desktop 3.7.21 ASAR and explicit generic Electron 44.7.0 run the
shipped welcome note/1075×666 PNG → actual resource context menu → app bridge →
blocked reveal workflow. The image stays visible, page errors remain empty,
reveal events increase 0→1, and the shared retained capture contains the exact
event. Both staged hook files are hashed against the selected source before launch.
No synthetic application IPC channels or replacement app callbacks are added.

The argv shim is an explicit test adapter for the still-failing standard startup
#2974. **Overall provider cleanup remains failed (#4282)** and the verifier exits
nonzero. External scope teardown is not provider cleanup. The first frozen real
pipeline takes 17.680 s; observed payload-exit CPU 16.272793 s and peak 1,395,253,248 B
have an extra descendant, so complete-family observation is **unverified**. The
cleanup cohort is recorded separately. The pre-review 32-case source repeats the real
operation successfully, but overall cleanup still fails: 18.074 s pipeline, observed
CPU 17.011774 s / peak 1,422,839,808 B; complete-family measurement remains unverified. No completed public CLI/MCP workflow,
real Windows/macOS run, natural app callback-loss reproduction or full check:pr
is claimed.

The final review source repeats the same real operation: 18.353 s pipeline,
observed CPU 17.098599 s / peak 1,387,556,864 B; complete-family measurement remains
unverified and overall provider cleanup fails. An earlier trial failed to initialize
the display because the provider environment omits XAUTHORITY. That launch is
preserved separately; the fresh final trial uses local Xvfb with `-nolisten tcp -ac`,
not a production provider change.

Frozen local validation: 75 hook cases on both Node versions; 5 projection + 8 MCP
cases on the unchanged shared contracts; static checks pass (final 118.946 s wall / 117.752622 s CPU / 4,282,826,752 B
cgroup peak, verified payload-exit family observation). The pinned final run uses
`test:focused`; an attempted `test:local` invocation was rejected before tests ran
and is recorded as not executed. See JSON for exact
commands/cohorts, failed candidate attempts, source pins and measured resources.
Failures include the Array-species frame, readonly receiver invariants, metadata
setter identity, on-getter ordering, a lint/interoperability correction and helper
preparation failures. They are not relabeled as results from the final source.

All heavy work runs serially with CPU 10/quota 1, 8 GiB hard/6 GiB early/no swap/192 tasks.
Counters are captured at payload exit with the observer alive, not final whole-scope
counters; cgroup peak includes file cache. Each final Joplin run has a new private
configuration mount. Filesystem/runtime/build caches are warm; cold-system and
warm-repeat costs are unmeasured. Agent/billed tokens and public reply/context
costs are unmeasured. The broad internal error capture size is not an agent-token
measurement. All owned scopes are checked inactive/dead independently.

## Reproduce the producer comparison

Use the pinned project toolchain and explicitly provided alternate runtimes.
The alternate Node 24.21 archive is checked against [official checksums](https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt);
its archive/binary hashes are recorded. No global toolchain is upgraded.

```sh
python3 experiments/analysis-efficiency/electron-once-runtimes.py \
  --hook-root /absolute/checkout-to-measure \
  --node /absolute/pinned-node \
  --node /absolute/node24.21 \
  --electron /absolute/generic-electron44.7 \
  --output /absolute/owned-output
```

Run this under the recorded resource wrapper. For a baseline comparison, use a
clean checkout of 709b5cbd as hook-root while keeping the same current oracle/runner.
The runner retains full JSON and prints a compact summary. The real Joplin recipe
is in [the shell verifier record](electron-shell-sync-2026-10-16.md); select the
current runtime-root. That workflow must remain nonzero while cleanup fails.
