# PE import inventory verification — 2026-10-24

The analyst task is to list a local PE's standard and delay imports, keep source
locations and partial facts, and obtain a pefile-compatible imphash only when
the retained standard import sequence supports it. CLI and MCP use the same
application service and static parser. Targets are read without execution.

## Revisions and ownership

- Original PR: `0b65cbcfe2bf78a808d41e12fa5aee9c0fc93da4`.
- Main integration and mapping index: `336f83cbb08dcc02a2d4c932f9c82f2c7b83554e`.
- Measured baseline: `073e2612e783dc38d3603cd7dcc9dc721c0d9412`, the preceding
  integration with provider identity imports and artifact-failure classification
  repaired so the runtime builds. The measured candidate uses the same provider.
- Measured candidate: `105f4ea66ebc82e559fe1000aabe75ced3024a41`.

`readPeImage` owns machine, image base, directories, alignments and declared raw
section pointers. The import parser consumes those facts rather than reading the
PE header again or substituting a missing base with zero. The shared mapping
index preserves canonical ambiguous/unmapped failures and adjacent mappings.
Its construction is O(n log n), with O(log n) nonempty range queries; both normal
and failed lookups avoid a linear fallback. Indexed and canonical CString reads
share one implementation and can reconstruct strings across physical sections.
These structures belong to one parse, with no cross-request cache or invalidation.

Derived ILT/IAT slots are checked against the 32-bit RVA space before a row is
returned. A malformed table preserves preceding valid rows and reports partial
coverage instead of failing the output schema. Named thunks are checked before
conversion from bigint, retaining the exact source hex when reserved high bits
are set. The format's named hint/name pointer uses 31 bits; see the
[Microsoft PE format specification](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format#import-lookup-table).

Early cancellation preserves the caller's reason before input validation in
PE imports and the two adjacent certificate/ELF-note services. Artifact failure
classification consumes the shared owner's origin facts and regular-file error
predicate; cleanup ownership and retry remain with `ArtifactResourceScope`.

## Independent oracle and regressions

The oracle is pefile **2024.8.26**, installed without dependencies into the
temporary verification directory. Its `pefile.py` SHA-256 is
`0d0eb68f0f169182613dc64b3ab50b20855508c1c1d2faafe8fccf23edb6a345`.
The release's upstream commit is
[`4b3b1e2e568a88d4f1897d694d684f23d9e270c4`](https://github.com/erocarrera/pefile/tree/4b3b1e2e568a88d4f1897d694d684f23d9e270c4).
All **696** copied ordinal names match its three complete maps: 425 oleaut32,
196 ws2_32 and 75 wsock32. Own-key lookup and `ord<decimal>` fallback are retained.
The upstream MIT license is preserved in `licenses/` and the notices inventory.

Independent byte fixtures establish these differences:

- A cross-section function name is `Function128` in native mappings; pefile
  reads `Functi`. A cross-section DLL name is `KERNEL32.dll` natively and
  `KERNEL32.d` in pefile. Complete native facts remain useful, while hashing them
  would produce a different valid-looking MD5.
- pefile stops after 2,048 section headers. With imports in section 2,049, native
  parsing retains both functions while pefile finds no import table.
- pefile also stops at a null section header or a section with at least three
  of its structural warnings. Native parsing can still see a later import table.

The candidate checks byte-mapping compatibility from the parsed owner facts,
including pointer/address normalization, section clipping and those stop rules.
Unproven geometry withholds only the hash, with an explicit reason. Delay-only
issues do not invalidate the standard table's hash. This is conservative
compatibility checking, not universal qualification of every unusual PE layout.

PE32/PE32+ IAT overflow and exact wide-thunk regressions fail on the old producer.
The three section-stop cases fail on the precursor before its stop guard was
added; the independent oracle sees no imports in each. All pass after correction.
Each of the three early-cancellation services fails its null-reason control
before the fix; afterward both null and caller-object identity are preserved.
The existing retained-text failure already propagates through its tagged error
and is not claimed as a newly fixed defect.

Executed checks at the candidate stages:

- **58** parser/mapping/image/cancellation checks pass. Randomized mapping
  comparisons use the canonical mapper as an independent semantic oracle.
- **172** selected domain/service/filesystem/CLI/MCP/artifact-lifecycle checks
  pass before the final section-stop guard; sets overlap and are not added.
- The final parser file passes after the stress fixture's header/section ranges
  are made disjoint. **5** public CLI cases then pass, including both IAT widths,
  a complete cross-section name, section-cap and null-section hash refusals.
- Full static gates pass after provider integration and after the compatibility
  guard. The initial missing artifact-failure API compile error was corrected.

The public CLI checks parse actual responses with the named output contract.
MCP tests exercise the real SDK and advertised schema. The artifact-consumer
suite covers physical read errors, cancellation, cleanup failure and retry with
the PE provider included. No deep native engine or Windows runtime was newly
qualified by these static-format checks.

## Shipped PE artifacts

The two launchers come from the official
[pip 24.0 wheel](https://files.pythonhosted.org/packages/8a/6a/19e9fe04fca059ccf770861c7d5721ab4c2aebc539889e97c7977528a53b/pip-24.0-py3-none-any.whl),
SHA-256 `ba0d021a166865d2265246961bec0152ff124de910c5cc39f1156ce3fa7c69dc`.
They were extracted as analysis artifacts, without installation or execution.

| Artifact |   Bytes | SHA-256                                                            | Oracle result                                             |
| -------- | ------: | ------------------------------------------------------------------ | --------------------------------------------------------- |
| t32.exe  |  97,792 | `6b4195e640a85ac32eb6f9628822a622057df1e459df7c17a12f97aeabc9415b` | 2 DLLs / 85 functions; `5e24f42b46c247f13d78f0f21a4a2bf7` |
| t64.exe  | 108,032 | `81a618f21cb87db9076134e70388b6e9cb7c2106739011b6a51772d22cae06b7` | 2 DLLs / 86 functions; `c51d659b4b1142d4af3795d09f1d63f7` |

For both launchers the ordered DLLs, names, ordinals, hints, IAT RVAs, machine,
bitness and imphash agree with pefile. The benchmark verifies the complete named
rows, not merely the function count or MD5.

## Completed-task costs

Three alternating pairs per fixture execute one fresh public CLI process:
`rea inspect-pe-imports PATH --json`. All **24** tasks complete. Complete Evidence
objects are equal across all six runs of each fixture, including provenance,
coverage, limitations, locations and identity; nothing is stripped for equality.
Artifact digests remain unchanged. The stress fixture contains 2,048 independent
sections and 2,048 functions, SHA-256
`0540676161eb7408805277a75e4d47e3d752732b6d5f294c59c8c670c7c1e905`.
The empty fixture is 3,072 bytes, SHA-256
`b32058d9121313554af54bc0aed762871d3d8eb5e2d9eeab6a365f0518c6f897`.

| Complete CLI task          | Estimated stdout + invocation tokens, before → after | Elapsed median s |  CPU median s | Sampled family RSS median MiB |
| -------------------------- | ---------------------------------------------------: | ---------------: | ------------: | ----------------------------: |
| No imports                 |                                            676 → 676 |    1.817 → 1.867 | 2.157 → 2.219 |                 364.6 → 369.9 |
| Shipped PE32               |                                        3,678 → 3,678 |    1.868 → 1.867 | 2.201 → 2.221 |                 365.2 → 366.4 |
| Shipped PE32+              |                                        3,715 → 3,715 |    1.868 → 1.868 | 2.238 → 2.220 |                 367.1 → 370.3 |
| 2,048 sections / functions |                                      70,342 → 70,342 |    1.969 → 2.069 | 2.413 → 2.482 |                 388.4 → 391.2 |

Tokens use tokenx 1.3.0 estimates after timing, not actual model usage. The task
uses known CLI commands without catalog/schema/help or continuation calls.
Prompts, model framing, rendering and client JSON parsing are unmeasured.
Node is 24.22.1 on Linux 6.1.0-54 x86-64, affinity CPUs 0–1, on a shared host.
Every process is fresh; OS caches were not flushed and had prior oracle reads.
There is no warm provider-cache measurement. Build/setup costs are separate.

Elapsed ranges overlap, and the 50 ms profiler poll quantizes short-task timing;
no speedup is claimed. The largest case's median increases about 0.10 s elapsed,
0.07 s CPU and 2.9 MiB RSS for the additional correctness checks. RSS is the
50 ms observed sum across descendants: shared pages may be counted twice and
short/unobserved processes missed. CPU accounts for waited children. No resource
stop occurred. The mapping index was already in the baseline, so these numbers
do not isolate its speedup or qualify a 65,535-section worst case.

## Main integration verification

Integration `a5a1f919e896488d0651e621f334efec84e9132f` includes main
`044c9705eadf62f7c47ddd42a0b2dc065b26b228`. The PE refinement is a type
intersection with main's new container union; runtime PE interpretation is
unchanged. The newly added Roman Urdu README receives the same PE imports link
as the canonical table. The full static gate passes; documentation/license
validation and test discovery pass after this link correction. The complete
selected parser/mapping/image/service/filesystem/CLI/MCP/lifecycle selection
passes **201** checks in 54.062 s (60.363 s waited-child CPU). Sets above overlap.
Later main-integration performance was not remeasured; the cost table remains
pinned to its recorded revisions. These tests use built-in static parsing, not
a simulated claim of deep-engine behavior.

## Additional RVA review and independent ordinal control

The pre-merge review found a real missing boundary: PE32+ virtual mappings could
carry descriptors, their terminator, or a DLL name beyond the 32-bit RVA end.
Five new controls fail before correction (four standard/delay directory cases
and one NUL beyond the RVA end). The producer now owns one RVA-span predicate
used by primitive reads and partial row admission. CString reads include only
bytes within that space. A name whose NUL is the final legal byte still passes.

An unexamined first descriptor retains the declared directory with zero consumed
locations and partial coverage. The schema represents that observation; the
service rejects an empty consumed-span list claimed as complete. Four public
CLI cases and the real MCP SDK/advertised AJV schema exercise both zero-span and
preceding-row outcomes. The expanded selected workflow passes **213** checks
in 71.408 s (71.595 s waited-child CPU). The full static gate passes. The earlier
cost table remains pinned to its revisions; these later RVA checks were not
included in that first measurement; the separate comparison below covers them.

The ordinal-mask suggestion was tested rather than applied: installed pefile
2024.8.26 itself uses `addr_of_data & 0x7FFFFFFF` in its ordinal corruption
heuristic, including PE32+. Independent images with both ILT/IAT words rewritten
produce these results:

| Raw PE32+ thunk    | pefile result                                               | Native result                          |
| ------------------ | ----------------------------------------------------------- | -------------------------------------- |
| `8000000100000001` | ordinal 1 + ExitProcess; `72d9cd67504bb3b9f29c37a226bf4331` | identical, complete raw thunk retained |
| `8000000000010001` | import table discarded; empty hash                          | hash withheld                          |
| `8000000000000001` | ordinal 1 + ExitProcess; `72d9cd67504bb3b9f29c37a226bf4331` | identical                              |

All three controls already pass before the RVA correction. Expanding the mask
to 63 payload bits would diverge from this pinned pefile behavior. The reason
text now specifies the low 31-bit payload; the raw thunk remains available, and
matching pefile does not claim loader validity for reserved bits.

## RVA-guard completed-task follow-up

To measure the final guard separately from other integration changes, repeat
three alternating pairs of the same four completed CLI tasks, now comparing
`a7406eca8137c9fae58a12cb8354f042047f5045` against
`feda57ae4ef420bc72e8e04393b75810da86cc3c` on their common main integration.
All **24** tasks complete. All complete Evidence objects match across each
fixture's six runs, and every ordered inventory field still matches the
independent pefile oracle. Artifact digests stay unchanged; stderr is empty.
The token estimator, invocation/discovery scope, process/cache conditions and
profiler limitations are the same as the earlier measurement.

| Complete CLI task          | Estimated stdout + invocation tokens, before → after | Elapsed median s |  CPU median s | Sampled family RSS median MiB |
| -------------------------- | ---------------------------------------------------: | ---------------: | ------------: | ----------------------------: |
| No imports                 |                                            676 → 676 |    2.220 → 2.019 | 2.383 → 2.382 |                 367.6 → 364.0 |
| Shipped PE32               |                                        3,678 → 3,678 |    1.918 → 1.918 | 2.253 → 2.203 |                 366.8 → 367.9 |
| Shipped PE32+              |                                        3,715 → 3,715 |    1.973 → 1.968 | 2.363 → 2.293 |                 368.9 → 369.3 |
| 2,048 sections / functions |                                      70,342 → 70,342 |    2.825 → 2.221 | 2.423 → 2.428 |                 382.9 → 389.0 |

No speedup is claimed. In the largest case, elapsed ranges are 2.019–3.085 s
before and 2.019–2.776 s after. CPU medians differ by about 0.004 s; sampled
RSS increases about 6.1 MiB (1.6%). Shared-host variance dominates the apparent
elapsed improvement. This validates the measured completed tasks, not a maximum
format-size or transport-buffer qualification. Later main changes remain
outside these pinned measurements.

## Coverage consistency

Three new service controls reject contradictory standard-import, delay-import,
and complete descriptor counts; all three fail before the correction. The
service now compares counts with the retained rows before issuing Evidence.
Partial results may still report more examined descriptors than retained DLLs,
as verified with an unsupported delay descriptor. Complete results must agree
and carry no issues. Existing function-count traversals are reused; the change
adds no further row scan. These validation checks postdate the pinned cost
measurements above.

The expanded selection passes **217** checks in 73.179 s (70.360 s
waited-child CPU), with a sampled process-family peak of 2,039.3 MiB. Full
`npm run check` passes. These counts overlap earlier selections. A subsequent
main integration at `7f70797b98c226009163358f91a9cfcedf03b390` includes the
upstream plist-fixture correction for the three unrelated native-provider
failures seen in CI run 40055148308.

## Descriptor mapping stops

A later review identified the same partial-result boundary when a descriptor's
uint32 RVA is legal but lacks a file mapping. Four controls (standard/delay,
first descriptor/after one row) all threw before correction. Both walks now
use one descriptor admission function: range failures and mapping failures
append explicit issues, then preserve the directory declaration, consumed
spans and preceding rows. Only mapping failures are caught; unrelated failures
continue to propagate. Standard-table failures withhold imphash; delay-table
failures preserve an independently complete standard hash.

The public CLI covers all four mapping-stop cases alongside the RVA cases.
The actual MCP SDK and advertised output schema cover an unmapped first
descriptor. These later validation changes are outside the pinned performance
comparisons above; no additional speed or maximum-size claim is made.

Final integration at main `7f70797b` passes **277** selected checks: the
expanded PE/shared lifecycle selection plus native-provider tests that cover
the upstream plist-fixture correction. This takes 126.978 s, 127.567 s
waited-child CPU and 2,061.9 MiB sampled process-family RSS. These are test
suite costs, not analyst-task costs. Full `npm run check`, `npm run docs:check`
and test discovery pass; discovery accounts for all 2,323 files exactly once.
