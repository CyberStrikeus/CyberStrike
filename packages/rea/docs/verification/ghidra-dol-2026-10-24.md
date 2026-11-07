# GameCube DOL verification, 2026-10-24

This records additional verification of [PR #6240](https://github.com/morluto/rea/pull/6240).
The lane explicitly imports a static 32-bit big-endian PowerPC DOL through the
existing POSIX Ghidra provider. It does not execute the target. Admission covers
cached MEM1 (`0x80000000..0x81800000`); Wii MEM2, uncached aliases, REL/RPX,
r2/r13 recovery and platform-specific instructions are outside this verification.
No automatic DOL detection or new provider is introduced.

## Sources and corrections

The measured feature-source pin is `7f892827610d8e0f14993c577ac48ba8ac1f7ea2`.
The comparison baseline is `2961f06776dcb73818980a2a5d6886a4fec1e521`.
Both include main `3ce311757dd8ac444c8297b2871464536f93816d`, the contributor's
DOL work and the shared inventory/caller/cleanup corrections below. Their
production difference is the BSS ownership and qualified-address correction;
this is not a comparison against main without DOL support. Contributor head
`29b4608459a2a2c4d838135a569d3e5e7727a30e` is retained in the final ancestry.

- A real Ghidra capture showed `symbol` provenance in both procedure inventories.
  The shared strict decoder rejected that existing bridge field, including on
  the inspected main implementation. The decoder now accepts the named optional
  symbol contract for both inventories; two captured-row controls fail before
  and pass after. The shared boundary selection passes all 23 checks.
- The verifier must request `analyze_function` / CLI function `detail: complete`
  after the earlier summary-default change. It now uses the shared cleanup owner
  for connection failures, mixed cleanup outcomes and final lineage checks.
  The MCP scenario also uses the existing application harness. The Go fixture
  narrows its ELF subject instead of asserting an incompatible union type.
- The header parser owns BSS gap derivation. Original data-slot order remains
  intact; a sorted private range list derives at most 12 gaps. The private v2
  plan declares section/gap counts, including zero gaps. Java applies these
  exact ranges instead of recomputing them; attestation uses the same parsed
  facts. The 1,272-byte wire bound follows the 18-slot/12-gap uint32 format.
  The profile version changes to invalidate older interpretation identities.
- Attestation reuses the domain address parser for qualified coordinates.
  Foreign-space uninitialized observations remain observable without becoming
  MEM1 BSS; foreign-space file mappings produce a mismatch. Both added controls
  fail against the previous implementation instead of throwing on valid syntax.

The suspected entry-label problem was not reproduced: real Ghidra reported
`__start` at the header entry, with `USER_DEFINED` symbol provenance from the
pre-script. That is an imported analysis label, not an original DOL symbol.
No entry naming change was made.

## Tools and artifact

Executed on Linux x64 with Node 24.22.1, npm 11.16.0, two allowed CPUs, a 2 GiB
Node heap and a 1 GiB Ghidra JVM heap. Verification-only tools were extracted
under a temporary directory; no unrelated software or user configuration was
installed or changed.

| Tool archive          | Source                                                                                           | SHA-256                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Ghidra 12.1.4         | [NSA release](https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.1.4_build) | `ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db` |
| Temurin JDK 21.0.13+9 | [Adoptium release](https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.13%2B9)  | `d7f5d5cf865a2902b70ff549b97586a7d3f234e016f041ab447ea740c7d66d1c` |
| lld-14 1:14.0.6-12    | Debian bookworm package, downloaded and extracted                                                | `3b77ab0cc30bbba9e874ba57cabc090116ed52d5eebaa043cf1e1412c4523a99` |

The host compiler was Clang 14.0.6. Its existing user `ld.lld` wrapper delegated
to an x86-only linker, so the verifier selected the extracted real LLD by an
explicit compiler wrapper; the user wrapper was left intact.

The source-owned fixture is compiled from the shipped C, assembly and linker
script, then converted to DOL. Independent GNU readelf symbols/program headers
and a separate DOL header reader establish section addresses, file bytes, entry,
data and the uncovered BSS interval `[0x80013008,0x80013030)` (40 bytes).
Data slot 1 overlaps the declared BSS and remains initialized.

- DOL SHA-256: `42490c9b86ad0b5034063f65a3feeec554f583cb21ed95f4248f2a7571120f3d`.
- Persistent query ELF SHA-256: `1ae89c6a4b0e3b9c8d3415e4b4a7e3f83d3a310c3b40aa60abd333dd35d4f963`.
- Both fresh verifier builds produce that same DOL digest. Their debug-bearing
  source ELFs differ by worktree, and are not claimed byte-identical.

## Real-provider verification

`node scripts/verify-real-ghidra-dol.mjs` exits 0 at both source pins using stock
`PowerPC:BE:32:default`. It exercises public CLI and MCP open/session, load-image
attestation, entry and leaf inventory, the direct call, complete decompilation,
global/tail/marker reads, uninitialized BSS reads, close and cleanup. Both report
verified lineage with zero live owned descendants at the final observation.
This does not establish that no children existed earlier.

The Gekko/Broadway language is absent from the installed catalog, so its optional
pass is skipped. Windows, this session's macOS runtime, commercial GameCube/Wii
images, other DOL layouts and console runtime behavior are unverified. The
contributor's earlier macOS/commercial-image evidence remains their evidence;
it was not rerun here.

Earlier unsuccessful attempts are retained as failures: the host linker wrapper
failed before import; then the real inventory exposed the `symbol` decoder
mismatch; after that fix, the old verifier interpreted summary delivery as a
complete dossier. None counts as a completed performance baseline. The two
successful stock CLI/MCP runs took 135.025 s / 106.206 CPU s / 1,387.105 MiB
sampled peak family RSS before, and 65.520 s / 75.296 CPU s / 1,451.117 MiB after.
These ordered runs had different cache history; they do not establish a speedup.

## Completed query-task costs

The analyst task asks for artifact identity, provider/language binding, verified
section/BSS mapping, entry and leaf, the direct call, complete decompilation and
four byte reads. Each fresh actual stdio SDK session discovers the full catalog,
performs 11 tool calls (8 distinct operations), validates used advertised input
and output JSON Schemas with Ajv 2020, validates each structured reply, closes
and checks lineage. All six tasks pass. All requested answer facts, including
mapping observations, pseudocode, byte results and limitations, are identical;
input DOL/ELF digests remain unchanged. The v2 analysis-profile identity changes,
so complete Evidence objects and Evidence IDs are not claimed identical.

Three pairs ran in order before/after, after/before, before/after. Each task
includes SDK/server/JVM startup, independent readelf/header checks, lazy schema
compilation, result validation, trace writing and cleanup. OS/file caches were
primed by validation runs. Compilation-cache history was not isolated; these
are fresh-process runs with warm files, not controlled cold-cache runs.
Tool acquisition, initial builds, token-estimator CPU, transport framing,
stderr, prompts and actual model-specific tool conversion are excluded.

| Task     | Elapsed s |  CPU s | Sampled peak family RSS MiB | Estimated whole-task tokens |
| -------- | --------: | -----: | --------------------------: | --------------------------: |
| 1-before |    44.031 | 55.081 |                    2069.961 |                   1,136,010 |
| 1-after  |    53.769 | 53.543 |                    1810.133 |                   1,135,994 |
| 2-before |    99.072 | 95.836 |                    1979.152 |                   1,136,010 |
| 2-after  |    62.052 | 72.321 |                    1921.480 |                   1,135,994 |
| 3-before |   100.541 | 97.175 |                    1675.352 |                   1,136,010 |
| 3-after  |    65.932 | 60.857 |                    1758.359 |                   1,135,994 |

These are tokenx 1.3.0 estimates over all 27 reserialized JSON-RPC messages per
task, including both text and structured content. They are not billed tokens
or a measurement of model context. The catalog alone contributes 1,031,590
estimated tokens in the full RPC envelope (223 tools). Its separate
name/description/inputSchema subset is 261,284 bytes / 72,459 estimated tokens;
this is not an observed agent tool conversion. Tool-result estimates are
103,162 before and 103,146 after; requests and other protocol add 1,258.
A 16-token difference in the whole task does not establish useful context
savings. Complete retained Evidence remains accessible.

Observed before medians: 99.072 s elapsed, 95.836 CPU s, 1979.152 MiB sampled peak family RSS.

Observed after medians: 62.052 s elapsed, 60.857 CPU s, 1810.133 MiB sampled peak family RSS.

The ranges overlap and startup dominates; three pairs with unisolated caches
on a shared host do not attribute these timing differences to the BSS change
or establish a general performance gain. Controlled cold-cache costs and large
commercial-image costs remain unmeasured. The structural improvement is one
bounded interpretation of at most 18 sections and 12 gaps, without repeated
range subtraction or whole-file parsing at the header boundary.

The SDK receive budget was explicitly 64 MiB. The sampler observes recursive
process-family RSS every 50 ms; it can miss short-lived peaks and double-count
shared pages. CPU is wait-accounted process-family time. Neither metric is a
claim about exclusive physical memory or production-agent costs.

## Source and workflow checks

- Final source: `check:fast`, full `format:check`, cached runtime/skill build and
  **326 passing checks / 3 skipped Windows runtime checks** across 22 exact files.
  Coverage includes DOL CLI/MCP schemas, target admission, load-image tampering,
  header malformation/slot ordering, BSS gaps, launcher arguments, provider
  decline, raw/DOS/PowerPC compatibility, inventory decoding and cleanup owners.
- An earlier selection had 325 pass / 1 MCP 30-second timeout / 3 skip. The
  unchanged MCP case passed alone at the original deadline; the final complete
  22-file selection then passes all 326 without increasing that deadline.
- Documentation and full formatting are checked again after this report.
  Simulated-provider scenarios do not add real Windows, Hopper or IDA coverage.

While preparing the final PR, main independently failed a release-test typecheck
([main job](https://github.com/morluto/rea/actions/runs/40079461941/job/120829870149))
and JavaScript worker startup
([main job](https://github.com/morluto/rea/actions/runs/40079461941/job/120829870212)).
These are recorded baseline failures, not successful checks or automatic
exemptions for unrelated future failures. The published head's CI must be
assessed separately before any authorized bypass.

## Final integration after main's ownership update

Source `a853c0c0ee5ea5eb66924c2c0235b223ae9d87b0` integrates main
`d9660eb03271d0ce1859cf8720ca460701dd3322`. The only conflict was the packaged
Windows verifier: main's new command/workspace owner is retained exactly, with
one additional `ReaGhidraPrepareDol.java` caller-directory collision fixture.
No previous resource-owner implementation is restored.

The combined snapshot `e267d92d7af33681620548d584e3d60622ec7abd`
(tree `5dd561143b516ae4ae5983fe8250608329f4cee6`) includes that source and
Android head `e65ba83fa319dd34eaebce7d93d78d4e67cf8458`, in addition to the
merged IPS and IL2CPP work. **1,062 checks pass, 4 skip, none fail** across the
four features and the newly changed process/package owners. Skips cover three
Windows launcher scenarios and the platform-specific adjacent-npm scenario.
The cached build passes. `check:fast` fails only at main's already recorded
`releaseProposal.test.ts:378` `includeFiles` type error; it is not reported as
passing. Standalone lint, full formatting and documentation are checked again
on the integrated DOL source after this report.

The same combined snapshot also reruns the real stock Ghidra CLI/MCP DOL lane
successfully after the process-owner changes: 111.490 s elapsed,
98.176 CPU s,
1448.965 MiB sampled peak family RSS.
Section/BSS mapping, entry/callee, decompilation, bytes, unchanged DOL identity
and final verified empty lineage pass. Gekko remains unavailable and skipped.
The six paired query costs above retain their original source pins; the new
ownership implementation was not rebenchmarked as a six-task series.

Android subsequently merges as `f2fa7f648de3dfbac5de69f3c091a54ffd571015` on
that same main parent. Its CI built report has 14,251 passing / 220 skipped
tests; the source worker and release-test failures match main. That is context
for the combined snapshot, not the CI outcome of the newly published DOL head.

## Procedure-search contract verification

Source `95e4cdfa53b049855f0d2b68b0741dada41d3e68` replaces the remaining inline public
`search_procedures` row definition with `nativeInventoryRowsSchemas.names`, the
same owner used by complete native name/procedure inventories and retained
views. The bridge decoder already preserved `symbol`; the old public schema
rejected it. The previous all-five-tools test stripped symbol facts from its
search fixture and therefore missed that consumer boundary.

The test now replays both real captured rows (generated `FUN_80003100` and the
pre-script's `__start`) with their source metadata. Before the fix, the standard
SDK raises `Structured content does not match the tool's output schema` for
the extra fields. After it, all **42** selected decoder, inventory-view, MCP,
semantic-schema and DOL-session checks pass, covering complete, summary and
retained-page delivery. The superseded inline row definition is removed;
public search and list consumers share the domain row owner. Standalone lint,
full formatting and cached build pass. Source checking reports only the same
main release-test `includeFiles` error.

A fresh real stock-Ghidra SDK task adds a matching `search_procedures` call to
the earlier analyst question. The result keeps both rows' symbol metadata,
passes the actual advertised SDK/Ajv schemas, and agrees with the list result.
All earlier requested mapping, byte, pseudocode, limitation and input-identity
facts remain equal. Final process lineage is verified with no live descendants.
This adds real search coverage; the earlier six paired tasks did not exercise
public procedure search.

The first fresh task stops during Java readiness cleanup, before DOL import:
Java exits 0 and its JDK 21 facts parse, but an observed process's ownership
environment returns EACCES. Both recorded candidate PIDs are subsequently
absent before a fresh session is attempted. The fresh session completes.
Ownership checks remain enforced; no persistent cause was isolated, and the
first attempt remains a failure. The row-schema correction is not claimed to
fix that process-retirement observation.

The completed analyst task includes that failed attempt and retry:

| Attempt            | Outcome                       | Calls | Elapsed s | Accounted CPU s | Sampled peak family RSS MiB | Estimated RPC tokens |
| ------------------ | ----------------------------- | ----: | --------: | --------------: | --------------------------: | -------------------: |
| search-final       | Java readiness cleanup failed |     1 |    31.447 |          26.352 |                    1352.637 |            1,053,096 |
| search-final-retry | passed                        |    12 |    77.911 |          91.108 |                    2039.742 |            1,139,433 |

Measured invocations total **109.358 s**,
**117.460 CPU s**, **2,192,529 estimated
RPC tokens**, 13 calls and 36 messages. The largest sampled
family RSS is 2039.742 MiB. Both catalog discoveries and
the error reply are counted. The receipt-write span approximates
180.355 s including intervening diagnostics;
diagnostic/model tokens and CPU, prompts, stderr, transport framing and actual
model-specific tool conversion remain unmeasured. Each catalog has 223 tools;
its input subset remains 72,459 estimated tokens / 261,284 bytes per attempt.
The successful attempt makes 12 calls; it is a different task from the earlier
11-call pairs and does not establish a performance gain. Tokenx 1.3.0 estimates
and the sampler limitations above still apply.

Full formatting and documentation are checked again after this addendum.
