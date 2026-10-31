# Kuna: reuse before adding machinery

Read this reference for concrete examples of the skill's decisions. The records
below concern static Linux analysis with caller-supplied Kuna. They do not
establish parity with another provider or a general advantage for Code Mode,
atomic tools, or any particular orchestration design.

## Exact-address lookup: a measured, narrow improvement

[PR #4695](https://github.com/morluto/rea/pull/4695) reused the validated string
inventory's numeric address order. Previously, each `list_strings(address)`
filtered all cached facts. The owner now performs a binary lower-bound lookup
and returns every encoding at that address: O(log n + matches), without a
second retained lookup index.

The owning implementation is
[`KunaStringInventory.ts`](../../../../src/kuna/KunaStringInventory.ts), consumed
by [`KunaStringQueries.ts`](../../../../src/kuna/KunaStringQueries.ts). Inspect
their current versions before adapting the example. Numeric u64 addresses,
same-address encodings, duplicate rejection, source digests, caller selection,
and the existing session lifetime were part of the contract. Full listings and
literal/regex searches kept their semantics. An attempted removal of the
duplicate-detection set was dropped: no stable memory benefit was established,
and it delayed malformed-input rejection.

### Recorded workload and results

The benchmark used unmodified Kuna 1.833 and LLVM 16 on Linux x86-64, with
602,544 string facts. Baseline was `be0b2d138`; the final feature was
`5f564962da0e1b17f00a68a74a312539f0209a01`, subsequently integrated in
`c6b62754b095a134d6d67877508fa34311a2eda2`. These are historical observations,
not a benchmark of every subsequent main revision.

The same production stdio MCP task discovered the catalog, opened the binary,
made one cold selected read and 28 warm exact reads, checked retained Evidence,
and closed the session. Five selected addresses and two absent selectors were
read four times. A native filtered scan selected the strings; an independent
ELF load-header mapping checked the source bytes and terminators. Returned
facts, source linkage, target digests, and cleanup were checked.

Three alternating fresh sessions per implementation used one CPU, a 4 GiB
process-family hard limit, a 3 GiB early stop, and no swap. OS file caches were
warm. Whole-harness costs include the independent native oracle, hashing,
catalog/client work, and correctness checks.

| Median                                   |     Before |      After |
| ---------------------------------------- | ---------: | ---------: |
| 28 warm exact MCP reads                  |   495.2 ms |    90.8 ms |
| Cold selected MCP read                   |    11.30 s |    11.01 s |
| Whole harness elapsed                    |    28.24 s |    27.43 s |
| Whole process-family CPU                 |    27.71 s |    26.89 s |
| Kernel family peak, including file cache | 2237.6 MiB | 2240.6 MiB |

Warm totals ranged from 491.7–544.3 ms before to 84.8–99.5 ms after: about
5.5 times faster at this phase. Cold/whole-task timing and memory overlapped;
no stable improvement in those costs was established. One small SQLite pair
(7,985 facts) measured 20 warm reads at 88.6 → 80.5 ms and the whole harness at
13.68 → 13.94 s. The large-inventory lookup benefit does not generalize to a
whole-task speedup on small inputs.

Catalog hashes, call counts, and normalized facts were unchanged. A
`cl100k_base` estimate over one pass of raw catalog JSON, arguments, and replies
was about 846,000 tokens in both lanes, with about 802,562 from the catalog.
This was transport serialization, not rendered model context or actual usage;
client discovery, prompts, replay, and protocol framing were unmeasured.
**No token reduction or improved agent investigation outcome was established.**

Pinned target SHA-256:
`f62d254b7f2bf42df8c8b07d46ee3bb4c2cafeca436b2e6bc6ccbe4581f58f40`.
Pinned engine SHA-256:
`d858918b0766435cd96b999a77f2d5a31a0cc4f07256421c883b5b9dc4dd58e4`.
All six normalized-result sequence digests were
`4d2f90269da8568984090b20274163c4a7c2a0538aab63530bd2fe44840a0bba`.
Selected byte agreement does not prove native discovery completeness; missing
strings and relationships can remain unknown.

## Other transferable changes and their limits

- [Cached string inventory and search, #4095](https://github.com/morluto/rea/pull/4095):
  share validated facts across queries in a defined session. Audit key inputs
  and lifetime before extending reuse across targets or engine revisions.
- [Shared single-function work, #4045](https://github.com/morluto/rea/pull/4045)
  and [repeat-request reuse, #4169](https://github.com/morluto/rea/pull/4169):
  avoid duplicate native work while retaining per-caller cancellation and
  cleanup ownership. A query count alone cannot reveal duplicate subprocesses.
- [Streamed strings, #4318](https://github.com/morluto/rea/pull/4318)
  and [streamed call graph, #4329](https://github.com/morluto/rea/pull/4329):
  remove fixed aggregate transport-buffer failures through incremental parsing.
  Streaming transport does not bound every retained object or final reply.
  These links establish changes; no numerical speedup is asserted here.

Typed reference facts, native string-query projection, and shared native byte
reads remained experimental at the 2026-10-17 checkpoint
`65f2f9a22bc892f61d2b00f9a4611124f57d4bff` on
`experiment/atomic-codemode-20261016`. Some experiments used a patched native
engine. Check current integration and bring-your-own engine capabilities before
proposing them; a working experiment is not a stock-provider guarantee.

## Applying the reasoning elsewhere

For another provider or format, inspect its actual representation and native
capabilities before borrowing the implementation. Existing numeric ordering
may support range reads; an on-disk native query may avoid materializing an
inventory; an immutable parse may support several views. Measure the relevant
alternative rather than requiring every provider to use Kuna's cached array.

For live observations, immutable artifact caching rules are insufficient:
validate the process/session identity and freshness required by the caller.
For compact replies, preserve access to source Evidence and report examined
coverage; projection must not silently turn an unresolved edge into no edge.
For batching, test mixed successes and failures and measure the entire task,
including discovery, extra calls, native work, and serialization.
