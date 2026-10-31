# Semantic literal byte-budget verification

Tracks #3933 under #4027. All normalized semantic literals and configuration
defaults use the primitive owner. Its singleton path validates strings/nonfinite
numbers/negative zero without a Set, sorting or canonical-key serialization.
Each source analysis owns a bounded set of encountered limit classifications;
coverage consumes these observations after evaluation. This replaces a recursive
scan that only saw retained binding/return values. No persistent cache is added.

## Correctness and coverage

Public CLI and actual stdio MCP cases cover quoted strings, cooked templates,
equivalent concatenation, member receivers, a configuration-only expression
statement and a small exact control. Direct/default oversized values become
`resource-limit` unknowns with partial application coverage and
`javascript_semantic_primitive_bytes = 1048576`. Defaults carry
`value_resource_limit` inline and an unknown anchored to their config node.
Known null/false/zero/empty defaults remain exact. Original source/digests and
CLI/MCP identity parity are preserved.

Member and destructuring projections use the shared slot owner's tagged value.
An encountered limit stays visible even when a subsequent projection selects a
healthy sibling: the selected value remains exactly `7`, while file coverage is
partial. This avoids inferring completeness from the final retained values alone.
The duplicate raw default reader and superseded retained-value scan are removed.

Boundary controls admit 174,762 UTF-16 units (1,048,574 estimated JSON bytes)
and reject 174,763 (1,048,580 bytes). Actual arithmetic corrected the earlier
published 1,048,578 total; the unit-count boundary assertions were already correct.
The estimate counts six bytes per unit plus two quotes. It does not establish
actual ASCII JSON size above 1 MiB or an observed OOM.

The initial main baseline reproduced both public literal failures, with addition
and small controls passing. A mistaken optional-limit-array control was corrected
before the separate domain reproduction (2 failed/16 passed). Review head
`40b9d3c5` then reproduced the additional projection/default gaps (8 failed,
25 passed). The first review correction passed 65/66 focused tests; a doubling
chain now truthfully retains an additional encountered expression-depth limit,
so its byte-growth assertion was updated to allow other recorded limits.
Prior validation on the restored runtime: **66 focused tests** in five files and **932 semantic tests**
in 36 files, with overlapping domain coverage. The large-wire fixture retains
16 individually admitted values and at least the former aggregate UTF-16 payload,
plus complete CLI/MCP delivery, typed identities, empty strings and retained
tracing. Inputs regenerate from the tests.

## Endpoint identity compatibility

An attempted endpoint normalization at `5808872` passed its new local cases and real Obsidian control, but failed the existing CI endpoint-payload acceptance workflow (1 failed/1,573 passed/19 skipped in that shard). It violated the established full endpoint lookup/trace contract. This extension was reverted; endpoint values are lookup identities, outside the normalized primitive lattice. The original large endpoint is preserved. Corrected public validation passed **7/7** across two files; this adds one acceptance workflow to the previous 66-case focused selection (**67 distinct cases**, not one 67-case invocation). Its acceptance workflow now also normalizes that identical string as an exported primitive, requiring the typed value bound while endpoint lookup, both trace workflows and version comparison remain usable. Prior measurements and failed attempts remain in the JSON record. Production source is restored byte-identical to `38d263a`; the 932-test semantic run belongs to that state. Final full static and documentation gates (five consistency tests) passed after the compatibility correction.

## Real application control and costs

Official Obsidian 1.14.4 ASAR, selected `package.json` and `main.js`. Follow the
acquisition/digest and existing verifier command in
[module-reference verification](javascript-module-references-2026-10-15.md).
Use three alternating-order query pairs with CLI parity on each revision.
Application code is not executed.

The final correction retains the exact baseline full parent/view Evidence IDs,
23-row fact digest, source coverage and unknowns. Static `cl100k_base` task costs
remain 16,548 with selected name/description/inputSchema contracts, or 204,093
with the full catalog projection, for the reference workflow. Serial legacy
reads also keep their original costs. The query projection improvement belongs
to #4097; these are controls for semantic normalization and coverage.

| Complete real verifier |        Before | Final correction |
| ---------------------- | ------------: | ---------------: |
| Elapsed seconds        |        33.394 |           32.949 |
| CPU seconds            |     33.016802 |        32.559187 |
| Peak cgroup bytes      | 1,979,863,040 |    1,880,096,768 |

Includes initial analysis, both query arms, export, CLI parity and tokenizer.
One CPU, 8 GiB hard cap, 6 GiB early stop, no swap; cleanup verified and no OOM.
Memory includes charged file cache, not summed RSS. Counters are at payload exit
while the observer remains alive. Fresh MCP sessions do not establish OS-cold
cache conditions. Shared-host scheduling and filesystem/build warmness were
uncontrolled. This one before/after control establishes neither a speedup nor
an equivalence bound. Static BPE excludes annotations/output schemas, client
rendering/replay, reasoning and final answers; no hosted agent was run. Linux
static ASAR analysis was exercised, not live Electron or other platforms.

[Compact records, samples, source hashes and prior attempts](javascript-literal-byte-budget-2026-10-15.json)
preserve the initial incomplete correction separately from the final measurements.
No downloadable application or complete bundle is archived. Reproduce boundary
outcomes through the listed public tests and reuse the existing real verifier
and preserved 8 GiB observer linked above. Observer hashes and result-affecting
touched source hashes are pinned in the records.
