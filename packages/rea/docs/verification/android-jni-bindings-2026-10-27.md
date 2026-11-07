# Static Android JNI verification, 2026-10-27

Issue #6403 asks which bundled native functions could implement original DEX
native declarations. The implementation reads immutable APK bytes, preserving
declarations, library occurrences, exported/table candidates and selected
per-ABI bindings as independently queryable facts. No target, library,
`JNI_OnLoad` or `RegisterNatives` code was executed.

## Revisions and independent oracles

The full qualification and alternating delivery measurements below use
implementation `4a1839de6f091ade19e82557874c358ed34b8e36`, based on main
`03f17cf41d3c844f9383d7792d9b1a14330d0bb2`. Subsequent merge
`e8a8a50725cd384ae38ce66a94bafdaba1138108` incorporates main
`d6f88becd531cabafca1d968b89cf7fc77a80041`; its browser input-presentation and
SQLite test changes are separate from JNI analysis. Post-merge confirmation is
recorded below. The native parser's built SHA-256 is
`3bf0a2c342f1c404f5861b7c913f7f1b931f740a8c808b518474fc8de20821d5`.

Linux x86-64, Node 24.22.1/npm 11.16.0 and JDK 21.0.12.1 qualified the workflows.
JADX MCP 0.7.1 remains the supplied unmodified JAR, SHA-256
`6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75`.
The REA metadata bridge is version 9. JNI declarations use the JAR's existing
dexlib2 reader before decompiler deduplication, with no `load_apk` call.

The genuine Android NDK r27d package is revision 27.3.13750724, clang/LLD 18.0.4.
Its official Linux ZIP is 663,956,036 bytes, publisher SHA-1
`22105e410cf29afcf163760cc95522b9fb981121`; observed SHA-256 is
`601246087a682d1944e1e16dd85bc6e49560fe8b6d61255be2829178c8ed15d9`.
Pins come from the [official repository manifest](https://dl.google.com/android/repository/repository2-3.xml).
The package was streamed, hashed and selectively extracted into a private task
cache, without installing or changing global tools. The selected compiler,
sysroot and four additional official libunwind archives total 319,933,537 bytes.
An initial link failure exposed those omitted archives; the corrected fixture
build passed in 4.606 seconds, CPU 6.026 seconds, peak family RSS 110.4 MiB.

[Committed source fixtures and reproduction](https://github.com/morluto/rea/blob/main/tests/fixtures/android/jni-bindings/README.md)
build native declarations, javac headers and two libraries for arm64-v8a,
armeabi-v7a, x86 and x86_64. Ordinary REL/RELA, RELR and Android packed APS2
variants include overloads, BMP/supplementary names, explicit Modified UTF-8,
`.data` and `.data.rel.ro` tables, repeated exports in two libraries, an
unmatched declaration and two classes sharing one registered pair. Source,
`javac -h`, independent DEX flag/index reads, readelf and a separate byte/relocation
oracle establish expected facts. Oracle SHA-256 is
`fa634493bc8559a80eda3b70f01d44550c2f06e176cfc2a7cc7e10794b1eb793`.

| Static APK           | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| Ordinary             | `c4eb50ef8bdecc6f56c454294c0c8f198fa51a4174d101dc720a849976546649` |
| RELR                 | `5a2ce56191f633575e87bd239702f988d0d1ad82795a203e13a4f907f8624658` |
| APS2                 | `d2f0d613bc8f22ed1a6435f13b5ae1f088e904216aa8a04dd70c27c5cb606778` |
| Conscrypt derivative | `5985c40d5a6b14b64c202c80335d851adb7e8a987e6154a1488a194253856385` |

The Conscrypt derivative packages the public Android 2.8.0 AAR's original
library bytes with its class files transformed by D8 8.0.40. It is a static
test container, not a vendor APK or a claimed launchable application. The AAR
SHA-256 is `752044c289bc98e2dcabc00a1f88ca158b3aa3f505b38f124552bf4b2a0902b1`.
The original-name DEX is used, not an R8-renamed DEX paired with unchanged JNI
strings. D8's missing platform-adapter dependency warning remains a qualification
limit; no full application linkage or signature verification is claimed.

## Executed correctness and Evidence checks

The built pure parser passed independent checks over 25 real libraries:
24 genuine NDK outputs plus Conscrypt arm64. All 33 golden table entries match
their strings, slot addresses/file offsets, relocated values, encodings,
function addresses and code offsets. Conscrypt yields 367 structural entries;
the requested `EVP_PKEY_new_RSA ([B[B[B[B[B[B[B[B)J` candidate is `0xfa11c`.
Its name/signature/function slots are `0x2ada68`, `0x2ada70`, `0x2ada78`,
with relocated values `0x749a8`, `0x7affa`, `0xfa11c`. This built-artifact
qualification took 0.684 seconds, CPU 0.736 seconds, peak family RSS 99.5 MiB.

Real SDK/stdio MCP and CLI checks independently validate:

- All 12 source native declarations across four ABIs, exact library digests,
  overloads, UTF-16 names and per-library alternatives. Ordinary/RELR return
  32 matched, 12 ambiguous and four unknown rows. The source-known unmatched
  method remains unknown because symbolic writes/NOBITS leave scanning partial.
- APS2 preserves 20 observed export matches, four ambiguous export rows and
  24 unknown rows. It explicitly reports unsupported table relocation encoding,
  retaining each selected library's reason even without a positive candidate.
- Class selection never hides the other class sharing a registered pair.
  All selected native declarations survive independently of available ABI rows;
  the no-library selection case is covered by a domain regression, not claimed
  as a separate real SDK artifact qualification.
- All four retained collections support exact fields, empty filters and batch
  ID retrieval. Parent-array `row_index` remains separate from raw DEX/ZIP
  source ordinals. Advertised converted schemas validate with the real SDK/Ajv.
- Complete portable parents preserve the same normalized facts through summary
  and CLI delivery. Ordinary and each Conscrypt cohort copy the source to an
  exclusively created owned file, inspect it, remove only that copy, then read
  retained summary, exact table slots, binding fields and a full export.
  Original fixture bytes remain unchanged. Post-removal success is observed;
  hidden internal engine activity is not directly instrumented by this harness.

The first three four-ABI cohorts execute 107 SDK calls and three cold CLI parity
checks. Each Conscrypt cohort adds 28 investigation calls, five separately
accounted retained-removal calls and one CLI parity check. Four alternating
Conscrypt cohorts preserve the same normalized fact digest:
`7e4738d2dd9e518277d5268ce5c334d9d25728198f66b2102cdc3411865f2d46`.

Raw parent transcripts show one native inventory RPC on the first investigation,
then only JVM-status RPCs on later main queries; normalized native facts remain
present. No JNI parent contains `load_apk`. Library reuse is owned by the same
immutable APK session; ABI/library selection replaces one scan, while class
and method selection reuses it. Fresh analysis admission still hashes current
caller APK bytes. Historical views never reopen them.

Type/lint/build and 396 tests across ten exact files pass together: native/domain
projection, producer parsing, real ZIP occurrence/cleanup boundaries, unchanged
JADX session/idle/cancellation behavior, public contracts and existing IL2CPP
decoding/ownership. The gate took 215.198 seconds, CPU 257.470 seconds, peak
family RSS 4396.1 MiB. A full real JDK/JADX metadata run additionally passed
native reads before any APK load, malformed/duplicate DEX and CRC negatives,
raw aliases, constants, absence facts, manifest identity and downstream CLI/MCP
bodies/direct-invoke parity from both DEX entries: 154.890 seconds, CPU 233.275
seconds, peak family RSS 984.8 MiB.

Finalization regressions retain already parsed library facts/digests in typed
partial observations before ZIP close. Caller/deadline-first cancellation,
failed close, blocked admission and retry preserve their first cause and exact
resource lease. Interrupted later libraries preserve earlier completed facts.
Stable table candidate identity uses physical pointer-slot address/file offset,
not inferred run grouping. Known ZIP size claims stay separate from verified
read size/hash.

## Completed-task costs

Earlier main cannot decode/register JNI tables with equivalent coverage, so
manual export lookup is not an equivalent before workflow. The controlled
comparison is complete versus summary delivery of the same new investigation,
same bytes, query, selected pages and proof export. Conscrypt trials alternate
summary/complete/summary/complete, each with one cold and one warm task.

Each fixture task has four investigations, 12 selected collection pages and a
proof export (17 calls). Each Conscrypt task has one investigation, the same
12 page checks and proof export (14 calls). Task time includes public calls and
local oracle checks; one-time startup/catalog, separate retained-removal
qualification, final cleanup and a cold CLI parity run are included in the
whole-process columns, not hidden in task timings. Ordinary includes removal
qualification; RELR/APS2 do not, so their whole-process costs are not a paired
performance comparison. All four Conscrypt cohorts use the same phase flags.

| Cohort               | Cold task s | Warm task s | Whole s |  CPU s | Peak family MiB | Warm text tokens | Warm SDK tokens |
| -------------------- | ----------: | ----------: | ------: | -----: | --------------: | ---------------: | --------------: |
| Ordinary             |      11.058 |       0.606 |  32.658 | 45.124 |          1215.7 |           58,319 |         401,681 |
| RELR                 |      12.140 |       0.797 |  29.122 | 38.375 |          1266.2 |           58,231 |         401,502 |
| APS2                 |      12.578 |       0.917 |  30.892 | 41.071 |          1268.0 |           50,900 |         386,634 |
| Conscrypt summary    |      11.237 |       0.444 |  33.999 | 46.953 |          1282.0 |           32,265 |         349,128 |
| Conscrypt complete   |      10.846 |       0.456 |  32.907 | 45.948 |          1398.3 |          224,954 |         737,723 |
| Conscrypt summary 2  |      19.205 |       1.200 |  57.545 | 77.644 |          1456.2 |           32,223 |         349,055 |
| Conscrypt complete 2 |      20.978 |       0.925 |  64.513 | 81.218 |          1502.0 |          224,526 |         736,950 |

Warm text estimates are about 85.7% lower for summary delivery. Cold text
estimates are 32,087/32,202 versus 247,593/247,912. SDK-inclusive warm estimates
are about 52.6% lower. Latency/CPU/peak-memory samples vary substantially and do
not establish a general improvement. Cold costs include the first generic
view-schema compilation in the client; subsequent tasks reuse it. Startup/
catalog alone ranges 2.692–4.955 seconds across these Conscrypt cohorts.

Token estimates use tiktoken 0.14.0/o200k_base. Every task counts its analyst
question, discovered input catalog once, arguments and all text replies,
including pages and export receipts. SDK totals additionally count output
schemas and structured-content duplication. Qualifications and CLI response
costs are reported separately by the cost script. Exported file contents are
verified locally and are not counted as model context unless actually returned
inline. Actual billing, hidden prompts, client rendering/pruning and OS cache
state are unmeasured.

### Latest-main confirmation

After merging main `d6f88becd` into `e8a8a5072`, type/lint/build and the eight
input-presentation/public-contract cases pass. The first direct schema-suite
invocation could not load its generated test catalog; `test:focused` supplied
the required artifacts and all 16 schema tests then passed (63.310 seconds,
CPU 72.830 seconds, peak family RSS 1943.5 MiB). No schema assertion was relaxed.

Fresh full Conscrypt SDK/CLI cohorts use the same proof, 12 pages and owned-copy
removal flags. Both retain the identical fact digest above:

| Delivery | Cold task s | Warm task s | Whole s |  CPU s | Peak family MiB | Warm text tokens | Warm SDK tokens |
| -------- | ----------: | ----------: | ------: | -----: | --------------: | ---------------: | --------------: |
| Summary  |      11.739 |       0.680 |  36.712 | 51.209 |          1395.1 |           31,932 |         348,522 |
| Complete |      11.161 |       0.459 |  34.692 | 48.319 |          1385.2 |          224,954 |         737,723 |

Summary text estimates remain about 85.8% lower. This pair does not show a
latency or peak-memory improvement. Each adds 33 SDK calls and one cold CLI
parity check, bringing the executed public qualification to 305 SDK calls and
nine CLI checks across the pinned cohorts.

`docs:check`, `format:check` and `docs:build` pass together: 44.365 seconds,
CPU 56.935 seconds, peak sampled family RSS 1300.6 MiB. Generated catalogs,
schemas, packaged skills and provider binaries remain uncommitted outputs.

All expensive checks use CPU affinity 0,1, bounded heaps and one active process
family, with an 8 GiB RSS guard and 4 GiB host-availability guard. Peak memory is
the sum of family RSS sampled every 100 ms: shared pages can be double-counted
and short peaks can be missed. No guard stop or OOM occurred.

### Default-summary delivery confirmation

The new MCP operation now defaults to retained `summary` when `detail` is omitted.
Explicit `complete` remains supported; the CLI retains its common explicit-detail
policy. The actual SDK regression verifies both modes, caller selectors and
reading an unselected declaration from the complete parent after source removal.
Type/lint/build and all five cases in that MCP boundary file pass: 80.012 seconds,
CPU 110.240 seconds, peak sampled family RSS 4747.6 MiB. An earlier attempt stopped
at the test-function length lint rule; the fixture helper was extracted before
this successful gate.

A fresh genuine Conscrypt workflow omits `detail` on JNI investigation calls and
passes 33 SDK calls, all 12 retained pages, proof export, one cold CLI parity
check and the separate owned-copy removal qualification. The same investigation
fact digest above is retained. Cold/warm task times are 15.608/0.481 seconds;
whole process-family time is 45.239 seconds, CPU 61.038 seconds, peak sampled RSS
1431.2 MiB. Warm text/SDK token estimates are 31,928/348,516 using the same cost
method. This adds a tenth CLI check and brings the successful public qualification
total to 338 SDK calls. Explicit-complete removal qualification remains separate
from the investigation task; default summaries do not discard the full parent.

Final `docs:check`, `format:check` and `docs:build` also pass: 77.269 seconds,
CPU 70.506 seconds, peak sampled family RSS 1191.1 MiB.

The updated harness adds `--omit-detail` (with `--detail summary`), SHA-256
`c2a5d090f32429c852e3c974083bb9c21a0dc6a608407687031f155a722b53d7`.
The earlier cohort tables use the original frozen harness below. Default-run
summary/catalog/call receipt SHA-256 values are respectively
`c10e4d702b9694b0ccc69926a4e1f688fa8dea33a3de2e2837ea15190a706b37`,
`0c36244f5ff788fabd5491144b0711e99ad211ce3c09e1812d1d4da5753624ac`, and
`e1f021f0a7a92f101a037a1467a3428b4c620482eb556d81501a5ea64226ab82`.

### Review corrections and final qualification

Four review findings were reproduced or confirmed at their producing boundaries:

- The shared relocation reader had charged every file-backed write against a
  sparse retention limit. Its single immutable decoder now streams writes;
  IL2CPP applies them to its existing private copy and retains only bounded
  unresolved/zero-fill state and a file-offset bitmap. JNI keeps its bounded
  sparse provenance index. The two actual IL2CPP registration-read regressions
  each include 65,537 extra file-backed relative writes (AArch64 and x86-64)
  and verify the original bytes remain unchanged.
- GNU version headers could replay shared auxiliary chains and names. The shared
  export owner now bounds total record visits from section bytes and the existing
  export-row allowance, caches decoded/failed string offsets within 16 MiB, and
  yields checkpoints through the same generator used by synchronous callers.
  Refusal retains exports with partial coverage and unknown version names.
  Both GNU table variants exercise 10,000 headers replaying 65,535 auxiliary
  records and a 65,535-byte name, verifying one decode and cooperative yields.
- A named mapped-string read-limit failure now distinguishes budget exhaustion
  from invalid text. JNI preserves later candidates, marks tables partial and
  projects absent candidates as unknown. Both long names and descriptors are
  covered. An additional actual JNI-consumer regression queues cancellation
  after GNU name decoding begins and stops before export-symbol decoding.
- The static verifier now requires the Conscrypt oracle only when expectations
  advertise it. Executed controls pass with 25 libraries/33 entries when present,
  and 24 libraries/32 entries for NDK-only expectations; an advertised missing
  oracle rejects with ENOENT and writes no success receipt.

Type/lint/build and 330 cases in 13 related domain, parser, archive, IL2CPP and
actual CLI/stdio MCP files pass together: 192.437 seconds, CPU 224.376 seconds,
peak sampled family RSS 4190.2 MiB. After adding the during-version cancellation
case, type/lint and all 38 JNI parser cases pass: 39.842 seconds, CPU 67.581
seconds, peak RSS 3928.0 MiB. These overlap earlier gates; counts are not summed
as unique tests.

The final built parser again passes the independent 25-library/33-entry oracle:
0.975 seconds, CPU 1.009 seconds, peak RSS 103.9 MiB. Built parser SHA-256 is
`7c0638751427b2b282b8e55bb21c95f6c3f05c246b0ea66a31d0280694f9ffeb`;
its receipt also fingerprints every shared parsing dependency. The fixed oracle
SHA-256 above is unchanged. Large-capacity IL2CPP verification uses valid producer
fixtures, not a newly qualified real IL2CPP application.

A fresh Conscrypt investigation qualification again passes 33 SDK calls,
12 pages, proof, a cold CLI check and owned-copy removal. Investigation facts
retain the same digest above. Cold/warm task times are 23.529/1.015 seconds;
whole time 66.284 seconds, CPU 77.940 seconds, peak RSS 1402.6 MiB. Warm text/SDK
estimates are 31,955/348,569. Host/time variation does not establish a general
latency improvement. Cumulative successful public qualification is now 371 SDK
calls and eleven CLI parity checks, across the explicitly separated revisions.
The final cohort summary/calls SHA-256 values are
`84df4f4ed97f6d1a931010db8e16420e5f06df371940ed9225eb99a7a7c01094` and
`2c22b89e5ec4b26f15f0e9c5f8fdfd4af8583ad0926ad32edb359ecd991cd7fd`;
its catalog hash matches the default-summary cohort. No resource guard or OOM
occurred. Final `docs:check`, `format:check` and `docs:build` pass in
38.602 seconds, CPU 49.448 seconds, peak sampled family RSS 1286.2 MiB.

## Reproduction and limitations

Build the runtime, generate the source fixtures using selected existing JDK,
NDK and D8 paths, then run the maintained
[pure parser verifier](https://github.com/morluto/rea/blob/main/tests/support/analysis-efficiency/android-jni-library.mjs)
against the built parser. The
[public workflow harness](https://github.com/morluto/rea/blob/main/tests/support/analysis-efficiency/android-jni.mjs)
accepts `--variant ordinary|relr|aps2|conscrypt`, `--detail complete|summary`,
`--proof --pages --cli` and optional `--retained-removal`, explicit selected
repository/artifact/JDK/JAR/oracle paths and a fresh output directory. Frozen
harness SHA-256:
`14836895659de0f161c479b2b013ec39d754d172fd9935898872ab9cb5937035`.
The [cost script](https://github.com/morluto/rea/blob/main/tests/support/analysis-efficiency/android-jni-costs.py)
consumes every case's catalog, calls and summary receipts, fingerprints them
and keeps qualification costs separate.

Initial source integration type/lint errors were corrected before qualification.
A first CLI verifier attempt incorrectly treated its summary wrapper as flat
Evidence; the CLI had written its valid bundle. The corrected harness saves raw
stdout/stderr before assertions and validates the unwrapped named contract.
One driver used the wrong Conscrypt derivative filename and failed before
analysis; corrected cohorts use the pinned file above. A direct schema-suite
invocation lacked generated test catalog metadata; artifact-aware verification
is recorded separately. These attempts are not counted as successful runs.

Only Linux/JDK21/JADX0.7.1 and the fixed genuine NDK variants/public Conscrypt
arm64 sample are qualified. Cross-ABI ELF fixtures do not establish real
Windows/macOS provider lifecycle, device/emulator operation or runtime JNI
registration. Existing IL2CPP regressions cover the shared relocation refactor;
no new real IL2CPP application qualification is claimed. Runtime-built tables,
obfuscated strings, unsupported encodings and missing split/runtime-loaded code
remain unknown. Byte digests identify artifacts, not authenticity or build
ownership.
