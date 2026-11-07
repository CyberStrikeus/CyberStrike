# IL2CPP generic-instance verification, 2026-10-24

## Scope and pinned implementation

PR #5785 adds opt-in static generic-method instance linking to the existing
IL2CPP reader and exposes retained instances and issues to CLI/MCP views and
existing Ghidra seed generation. No target is executed. The feature supports
metadata 27/29/31 with a static CodeRegistration and the existing 64-bit,
little-endian native image owner. Generic decoding for metadata 24/39 and builds
without static registration remains explicitly unsupported; this does not remove
ordinary metadata decoding for those versions.

Executed source pin: `11b84c9566027da423f2c7c3752ae2e87f0fdbb7`.
It includes main through `d87e73f2db50be72d33a4b3c7199af35518b441c` via
`2718a3c775fb1a80e84066acc0f973e4ffd0e000`; `219ff0b9290e3a6c7c99d40182832b9bbcf4e7e7`
removes two unrelated formatting differences. This report and the query-choice
paragraph are documentation-only changes after the measured source pin.

## Correctness and review ownership

The contributor already corrected both earlier review findings: summaries retain
an issue count rather than the issue array, and `generic_method_issues` owns
selected/paged issue details; method generic containers are read on demand from
the shared record-layout owner. No per-method generic-container vector is built
when generic instances are disabled. Tests inspect the actual link-fact columns,
retained views, historical omissions, malformed references, budgets and stable
input identity. These are verification of the contributor's changes, not a new
implementation of those fixes.

A further producing-boundary defect was reproduced: unreadable method-spec bytes
became the sentinel `-1`, conflating unavailable data with a recorded negative
index. The corrected producer preserves `method: null` when unreadable and keeps
an actual recorded `-1`. The named-instance contract requires a known method;
unknown unnamed rows retain null and cannot match a method-index selector.
The producer regression fails before correction (112 pass, one fail).
An intermediate new view expectation omitted an existing parsed offset; that test
expectation was corrected without changing the product contract.

All **285 selected checks pass** after the correction, covering native registration,
metadata containers, generic resolution, domain views, public CLI and actual
production-stdio MCP with advertised schemas. The complete task takes 164.798 s,
149.772 CPU s and 2,441.5 MiB sampled peak process-family RSS. Type/lint,
full formatting and generated-document checks also pass at that source pin.
An earlier integrated selection passed all 280 existing checks before adding the
five new unreadable/index-contract cases. No simulated provider establishes Unity
runtime dispatch, and no real Ghidra import of generated seeds was executed.

## Completed MCP query comparison

Analyst question: obtain instance/issue counts and states, the first two instance
identities and RVAs, and the first duplicate-spec issue, retaining both input
artifact identities. Two authored version-31 inputs each contain three instances
and two issues: one code row and two unknown duplicate-spec rows. The long case
uses a 4,096-character type name; these are authored format fixtures, not binaries
produced by Unity.

| Artifact               | Bytes | SHA-256                                                                 |
| ---------------------- | ----: | ----------------------------------------------------------------------- |
| Small metadata         | 1,176 | `743ef4841be52734a349d9094fff971a8161ba35e9644d393c5803f84f71dc7b6cd7b` |
| Long-name metadata     | 5,273 | `031d4e1f08219d7da4ff3fc459f8791a7e8c041234a156358361a3d3a7b6cd27`      |
| Both native ELF inputs | 5,072 | `a6bf6e29397a389ae50f251b4167983b62cf1d9812c9108f6a17965eaa821259`      |

`complete` makes one inspection call with complete detail. `paged` makes a summary
inspection followed by two retained views: two selected instance rows/fields and
one issue. Three alternating pairs per input give **12 completed tasks**. Every
answer agrees on the requested facts and identities; file digests are unchanged.
Complete and paged Evidence objects are different workflows, so full Evidence/ID
equality is not claimed. The actual SDK-converted output schemas validate with
Ajv 2020. Two earlier probes used a different input-schema profile and are excluded
from the paired results.

All runs use pinned Node 24.22.1, npm 11.16.0, the same locked dependencies, two
allowed CPUs, a 2 GiB Node heap and production stdio with the default schema
profiles. Every task starts a fresh SDK client and server. OS/file caches were
primed by probes; persistent compilation-cache state was not isolated. Client and
server startup, lazy schema validation, RPC trace writing and final file hashing
are included in elapsed/CPU/memory costs. The first small pair was substantially
slower; no cause is assigned and those completed runs remain in the ranges.

Token estimates use tokenx 1.3.0 on every reserialized JSON-RPC request,
notification, catalog and reply, counting both text and structured carriers.
They are estimates of transmitted payloads, **not billed tokens or measured model
context**. Transport framing, stderr, fixture generation, token-estimation CPU,
prompts, agent reasoning and model-specific conversion are outside this measure.
The full catalog is 222 tools and estimates 1,003,790 tokens, including advertised
output schemas. Its name/description/input-schema subset alone estimates 72,079
tokens (259,949 UTF-8 bytes); neither establishes what a particular agent sends to
its model. The catalog is unchanged across these query workflows.

| Input / workflow | Calls | Entire RPC token estimate | Tool-result estimate | Elapsed s, median (range) | CPU s, median (range)  | Peak family RSS MiB, median (range) |
| ---------------- | ----: | ------------------------: | -------------------: | ------------------------- | ---------------------- | ----------------------------------- |
| Small / complete |     1 |                 1,012,270 |                7,582 | 20.216 (19.957–39.633)    | 19.992 (19.186–36.537) | 946.1 (927.5–947.8)                 |
| Small / paged    |     3 |                 1,018,217 |               13,317 | 25.325 (24.214–37.530)    | 24.853 (24.471–36.119) | 1,072.7 (1,066.3–1,222.9)           |
| Long / complete  |     1 |                 1,025,889 |               21,201 | 19.211 (17.895–20.017)    | 19.762 (19.351–20.314) | 935.7 (934.2–941.8)                 |
| Long / paged     |     3 |                 1,018,217 |               13,317 | 23.724 (23.712–26.661)    | 23.907 (23.097–24.567) | 1,108.8 (1,093.8–1,123.2)           |

Paging increases the small-task estimate by 5,947 (0.59%). For the long case it
saves 7,672 (0.75% of the whole RPC estimate), while using more calls, CPU and
memory and taking longer. The 37.2% reduction in long-case tool-result estimates
is not a whole-task/context reduction. There is no general performance win here;
choose complete output for small questions spanning both collections and selected
pages when irrelevant retained text would otherwise dominate. The measured data
does not qualify large real tables or the opt-out allocation savings numerically.

CPU is waited-child accounting. Family RSS sums recursively observed processes
at 50 ms intervals; it may double-count shared pages and miss short-lived children.
It is not a cgroup memory high-water mark. Host load and primed file caches limit
comparability; no statistical speedup is asserted.

## Real-artifact limitations

The contributor reports two private, self-built Unity 2022.3.62f3 Android arm64
version-31 builds (ordinary and identical-code folding), compared in both
directions with Il2CppDumper: 5,329 instance rows, 5,285 code, 44 no-body and no
issues, using 16-byte table rows. Native hashes are
`580ba23b41b9470bff8ec1a06edf06294221d9b363afba3b7337632a5cef2415` and
`9a0708bdbbc579f183856d3b633a16429558cd58db9863b05acbc6dcc8ae51ce`;
metadata is `2eb6338d81a68dffd34234d26ec1bf82c3e00c435e4d14f349ba03acc8e48b70`.
The oracle's Il2CppDumper version was not recorded. Those samples are not
redistributed and this maintenance run **did not reproduce that comparison**.
Other historical contributor platform checks were not rerun. Metadata 27/29 and
the new unreadable/negative-index cases have authored boundary coverage only.
No authentic Unity artifact, game execution, real target dispatch or Ghidra import
is qualified by the 12 query tasks above.

## Final integration repeat

Final executed source pin `7fdb5a29885ce05ec9181a609a37bf008b94e5df`
incorporates main `98ec00f4068bab894639d0d1d83ac0bfc428bcbf` and the author's
later cleanup `3dd803b81ccfb6b75afaa8c616693e8c4e7183d1`, preserving both authors'
changes. All **285** selected checks pass again: 183.057 s
elapsed, 187.472 CPU s and
2,583.3 MiB sampled peak process-family
RSS. Type/lint, full formatting and generated-document checks pass. This is a
completed validation cost with primed file caches, not a speed comparison.
The 12 paired query measurements remain pinned to the earlier source revision
and are not re-labelled as measurements of this integration repeat. The final
report update changes documentation only.
