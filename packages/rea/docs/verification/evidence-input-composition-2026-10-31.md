# Evidence input composition verification

The shared declaration and request resolver cover 20 individual-Evidence
composition tools. Artifact file sources, analysis views and environment export
keep their explicit source owners. Catalog conformance checks those boundaries
and rejects undeclared record inputs or unsupported source containers.

This record accompanies [#8293](https://github.com/morluto/rea/issues/8293) and
the real Ghidra input-capacity regression
[#8281](https://github.com/morluto/rea/issues/8281).
The [machine-readable receipt](evidence-input-composition-2026-10-31.json)
retains all fourteen model attempts, artifact identities, oracle provenance,
tool profiles, actual usage, resource measurements and limitations. It also
records the thirteen subsequent scripted public-transport attempts below.

## Runtime and measurement scope

Tests used Node 24.22.1 and local Codex CLI 0.165.0, explicitly requesting
`gpt-6.1-terra` with reasoning `high`. This identifies the requested alias;
the resolved server model is not inferred. Both dirty candidate builds were
based on `23de10bb2849cdce8ddbe70504aa7cc57de75a98`. Their complete built-file
fingerprints are recorded in the receipt. The later build includes the shared
reference-format hint and authenticated source/type-boundary corrections.
Subsequent cleanup reused the existing pure semantic-query input schema and
moved SDK tests into their boundary project. Full and compact catalog bytes
remained identical to the later model build; 22 affected checks were rerun.

Heavy tasks ran serially in owned Linux scopes: one CPU, 4 GiB hard memory,
3 GiB early stop, no swap and at most 192 tasks. CPU and peak memory are kernel
process-family counters at payload exit while the observer remains alive;
they are not final whole-scope counters. Cleanup was verified for every model
attempt and CLI phase. No OOM event occurred.

Each model task starts a fresh MCP process and isolated client profile. Native
tasks start a fresh Ghidra database, then reuse its two retained dossiers.
System/filesystem caches were not cleared; cold filesystem costs are unmeasured.
Initial primary tasks used the complete catalog. Later scoped tasks are labeled
`diagnostic/catalog-selection`; their different tools, guidance and selected
facts prevent a controlled speed or token comparison.

## Real application results

| Domain           | Real artifact                                          | Reviewed outcome                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native           | Installed jq ELF, real Ghidra 12.1.4                   | Each selected function analyzed once; complete parent references supported a direct one-hop path and function comparison. Independent `objdump` corroborated the selected call. Nonexhaustive frontier and behavioral uncertainty remained visible.                                         |
| Managed          | Shipped NuGet.CommandLine.XPlat.dll, assembly 6.11.2.1 | Artifact/member parent references projected a managed graph. The existing distinct-Evidence rule refused self-comparison. Digest, MVID, owner/token and selected CIL facts matched an independent metadata reader; its parser warnings limit that oracle's scope.                           |
| JavaScript       | Obsidian 1.14.4 ASAR                                   | Partial: the producer hit its existing 300-second per-source timeout. The retained parent still supported a semantic trace. A bidirectional feature trace exceeded 10 MiB and had no supported retained summary. Tracked separately in [#8296](https://github.com/morluto/rea/issues/8296). |
| JavaScript       | Shipped agent-browser 0.27.0 CLI entrypoint            | The final scoped task analyzed the exact selected source once, then reused its parent for feature and semantic traces. Independent source facts confirmed builtin imports/call locations. Unselected sources remained unknown; directory and file digests were distinguished.               |
| WASM             | Shipped VS Code Tree-sitter CSS module                 | One real WABT inspection supplied retained references for export comparison and a portable bundle. An independent raw WASM reader confirmed seven imports, three exports and `tree_sitter_css: () -> i32`. Static interface equality did not imply runtime compatibility.                   |
| Artifact / Apple | Rectangle 2.0.4 release ZIP                            | One retained inventory supported Apple projection and artifact comparison. Independent ZIP and Mach-O observations corroborated paths/content. Symlink metadata gaps remained unknown.                                                                                                      |
| Android          | NewPipe 0.29.1 release APK                             | One retained inventory supported Android projection. Independent ZIP observations confirmed manifest, three DEX files and four ABI library members/digests. JNI path-pair hypotheses stayed inferred.                                                                                       |
| Harmony          | Shark 1.0.8 release APP and its real inner HAP         | Both retained inventories supported Harmony projection. Separate ZIP/JSON checks preserved outer ZIP, APP and HAP identities, Stage/Ark/resource path observations and shallow APP coverage. Signature naming was not treated as cryptographic verification.                                |
| Process          | Two controlled real jq CLI captures                    | Authentic captures were imported and compared by references, then their retained comparison was aggregated. MCP output deep-equaled the existing inline CLI result. Terminal change, settlement differences, filesystem/process unknowns and source closure were preserved.                 |

The first supplemental agent-browser model task wandered into unrelated
inventory tools and failed to perform the requested producer analysis. It was
stopped and retained as an interrupted failure, including cumulative usage as
a lower bound. The successful later scoped task does not erase that attempt.
The missing-reference task produced its expected typed failure without opening
a target, repeating a request or inventing Evidence.

## Actual model task costs

Input counts include schemas, accumulated context, extra calls and retries.
Cached input is a subset of total input. Reasoning is included in output;
its separate subset is retained in JSON. These are completed task costs, not
serialized-byte estimates. The initial partial/interrupted attempts and their
costs also remain in the receipt.

| Later task                     | Calls / failed | Input tokens | Cached input | Output tokens | Task elapsed (s) | Family CPU (s) |    Peak bytes |
| ------------------------------ | -------------: | -----------: | -----------: | ------------: | ---------------: | -------------: | ------------: |
| jq, complete catalog           |         11 / 0 |      599,933 |      535,424 |         1,894 |           80.931 |      38.326466 | 1,269,936,128 |
| agent-browser, scoped          |         12 / 1 |      619,589 |      563,712 |         2,519 |           54.521 |       9.472096 |   903,847,936 |
| NewPipe, scoped                |          5 / 0 |      179,635 |      150,528 |         1,750 |           40.835 |      10.080132 |   704,409,600 |
| Shark APP, scoped              |          6 / 0 |      221,571 |      197,376 |         1,339 |           32.437 |       6.377128 |   560,021,504 |
| Shark HAP, scoped              |          5 / 0 |      184,452 |      152,576 |         1,212 |           31.108 |       6.012587 |   580,714,496 |
| WASM plus export, scoped       |          4 / 0 |      161,702 |      141,056 |         1,033 |           32.320 |       9.036127 |   700,076,032 |
| Imported process chain, scoped |          3 / 0 |       89,101 |       73,984 |           725 |           26.911 |       5.575060 |   531,283,968 |

The later jq task made no malformed reference calls, while the initial task
omitted the required `kind` twice. It selected a different callee and made three
guidance calls; its longer elapsed time and different facts preclude attributing
a general improvement to the new hint.

## Equivalent portable CLI comparison

The actual WASM model task exported a 13,925,066-byte authenticated bundle.
Both fresh CLI processes selected its same complete inspection parent and
compared exports against that parent. Their 3,732-byte outputs were byte-identical
and deep-equal to the model's MCP comparison:
`ev_b32346965c153a067abff9698aeba1ccbace34c78ac2071ac18311250b68c6da`.
Bundle, selected source and runtime hashes stayed unchanged. Neither CLI arm
started a decoder or reanalyzed the module.

| Input                              | Request bytes | Elapsed including scope (s) | Family CPU (s) |  Peak bytes |
| ---------------------------------- | ------------: | --------------------------: | -------------: | ----------: |
| Complete inline pair               |    27,823,017 |                       2.832 |       2.612440 | 370,515,968 |
| Retained pair plus selected bundle |           261 |                       2.632 |       2.385397 | 310,009,856 |

The reference arm still reads/authenticates the existing bundle. This single
ordered pair ran inline first with shared uncontrolled host caches. It establishes
equivalent completed results and records observed costs; it does not establish
a general speedup. Common upstream inspection/export costs appear in the model
table. Preparation additionally cost 1.119 s / 0.875255 CPU s / 316,796,928 peak
bytes; verification cost 0.518 s / 0.282755 CPU s / 42,881,024 peak bytes.
The optional tokenizer was unavailable, so request-token savings are unmeasured.
Request bytes are not presented as model tokens.

## Fresh-connection public transport matrix

The real transport matrix completed all nine supported domain lanes on built revision `7e10c1cc9` (`63746cf7b340358ac5ce609761ea3198ae3a62e24df52f62ed5be16893940021`). It used public stdio MCP and CLI, real artifacts and authentic exported Evidence; no model or fixture provider ran.

| Lane        | Attempts | Scope seconds, all attempts | CPU seconds, all attempts | Max kernel peak MiB | CLI calls, including negatives |
| ----------- | -------: | --------------------------: | ------------------------: | ------------------: | -----------------------------: |
| native      |        1 |                      35.915 |                 34.674174 |              927.99 |                              0 |
| javascript  |        3 |                      34.324 |                 33.094918 |              658.91 |                              8 |
| managed     |        2 |                      37.341 |                 36.221694 |              694.65 |                              9 |
| android     |        1 |                      20.208 |                 19.569397 |              696.40 |                              4 |
| harmony-app |        1 |                      16.714 |                 15.950327 |              495.68 |                              4 |
| harmony-hap |        1 |                      16.294 |                 15.886932 |              508.47 |                              4 |
| apple       |        1 |                      25.453 |                 24.824482 |              642.90 |                              8 |
| wasm        |        2 |                      22.648 |                 22.027649 |              791.67 |                              4 |
| process     |        1 |                       9.056 |                  8.586552 |              472.58 |                              2 |

Producer/export costs from the failed JS/managed harness attempts are included. Three harness assumptions and one actual SDK transport-capacity failure are retained individually. Every payload cleanup and kernel observation verified; no OOM or increased allowance.

Fresh imported references match complete CLI inline and selected-bundle outputs where those command contracts support them. Small APP/process/correlation inputs also match admitted MCP inline. Larger MCP inline forms hit the unchanged 1024-element guard. Native and selected managed-member comparisons have no equivalent Evidence-input CLI form; process accepts two complete capture files, and artifact comparison uses explicit evidence-file selectors.

The 27,823,016-byte WASM inline arguments exceeded the default 10,485,760-byte stdio frame buffer and closed the connection before application admission. The resumed attempt reused the same authentic bundle: fresh MCP references and both supported complete CLI forms agree. No WABT replay or limit increase.

Process capture comparison and behavior aggregation preserve changed/unknown facts. Correlation with genuine native comparison Evidence remains unknown with one unresolved branch under an explicit noncausal hypothesis.

These are scripted transport-task costs with uncontrolled caches, not a before/after benchmark or model-token measurement. Earlier WASM inspection/process capture costs are linked in the prior verification report. Later source-only diagnostic fixes have separate focused validation.

The accompanying JSON retains all thirteen attempts, exact kernel counters,
source/result identities and hashes, CLI arm receipts, failures and limits.
These scripted costs do not add to the model-token table.

## Review follow-up

An additional local terra/high source-only review found that the refactored
process CLI read later selected files before authenticating the first capture.
The shared owner now exposes authenticated source facts and their comparison;
CLI authenticates each source before reading the next, while MCP uses the same
readers and comparator. Two public CLI regressions cover invalid left/right
records with missing later files. The original real captures were compared
again without target execution and retained the exact comparison Evidence ID.

Greptile found a fixed-server WASM regression: caller-supplied complete inputs
incorrectly required a recorder. Shared retention now explicitly recognizes
caller-owned inputs. Provider-produced sources still require a recorder;
available recorders, their rejections and cancellation sources remain honored.
A fixture-backed public fixed-server MCP regression and ownership/cancellation
checks cover that distinction. These follow-up regressions are not additional
real-provider measurements. The related nine-file run passed 103 checks;
subsequent schema cleanup and CLI checks passed ten more selected checks.
Type, lint, Knip and architecture/module-boundary checks were repeated.

The fourteen application-analysis attempts above are separate from source-only
review; that CLI review did not report usable model-token counts. Its cleanup
was verified, with 57.860 s task elapsed, 4.720926 s family CPU and 427,364,352
peak bytes. Existing captured model measurements remain tied to their recorded
runtime fingerprints, preceding these review corrections.

The additional seven-file boundary run passed 161 checks after the CLI's JSON
parser was corrected to keep public command names in malformed-input diagnostics.
It includes 17 fixed-server cases for six JavaScript and three mobile consumers,
direct inline analysis views, missing references, wrong source roles, summary
retention and default input admission. These use complete authored fixtures;
they do not substitute for the real-artifact matrix. The run included a runtime
build and cost 154.106 s / 153.592029 CPU s / 1,884,516,352 peak bytes. Subsequent
type, touched-file lint and module checks passed, with no OOM or cleanup gap.

Native function and process workflows send malformed complete source records to
the canonical Evidence owner after resource admission. Schema or identity failures return
`evidence_integrity_mismatch` in both MCP schema profiles, including the original
`relationship_coverage` diagnostics. Other workflows preserve their format-owner
error projections. The directional-coverage regression still
checks every malformed case and the advertised full schema. Invalid request
envelopes and reference grammar remain request errors; no duplicate source parse
was introduced solely to reproduce the former SDK error classification.

A later review reported a possible null-source dereference in reconciliation.
On `70db1e816`, the public request has no identity refinement; source authentication
runs before identity-only validation. A public fixed-server MCP probe passed two
valid controls and rejected 24 malformed source cases across full/compact profiles
with structured `invalid_request` and accurate paths. Both complete schemas also
rejected each of twelve cases without throwing. No provider ran. Cleanup was
verified: 3.334 s elapsed, 3.155635 CPU s and 287,404,032 peak bytes, with no OOM.
This authored-fixture probe disproves the reported path on that revision;
it does not establish real passive-runtime behavior. No production change was
needed for that finding. The accompanying JSON records its observations.

CI later exposed the corresponding process-depth assertion against the old SDK
error envelope. Its regression now checks the canonical integrity error while
preserving the public left-source, `parameters` and exact nesting-limit diagnostic.
A normal comparison must still succeed afterward and provider startup is forbidden.
The iterative JSON depth guard still rejects before recursive cloning or hashing;
no second source parser was added. Runtime code was unchanged. Six related MCP
files passed 104 checks, including source identity, native/process diagnostics,
investigation composition and session lifecycle: 64.384 s elapsed, 64.066692 CPU s
and 1,476,808,704 peak bytes. Cleanup was verified with no OOM.

A retained-closure acceptance assertion also assumed that a complete inline
comparison must already exist in the ledger. The shared workflow intentionally
uses that supplied record: a missing dependency is reported for inline input,
while an unresolved selector reports the comparison itself. Both still require
the full referenced closure. Importing the originating bundle restores both
forms to complete, equal Evidence. Five relevant acceptance files passed 17
checks, covering default-budget aggregation, artifact coverage, replay and public
local contracts: 123.152 s elapsed, 121.276327 CPU s and 1,466,314,752 peak bytes.
Cleanup was verified with no OOM; runtime code was unchanged.

The HTTP admission-edge regression now checks the same source-owner semantics.
An admitted array of 1,019 malformed carriers fails at its first source, while
1,020 carriers exceed the unchanged 1,024-element envelope allowance. Responses
were 703 and 824 bytes, respectively; both stayed below 4 KiB and the server kept
serving. The shared resolver additionally preserves `input_path` on owner errors
when absent. Original error identity, owner diagnostics and existing paths remain
intact, with no second source parse. The rebuilt nine-file gate passed 75 checks,
including all 41 ADB CLI cases, resolver, native references and HTTP/stdio admission:
98.459 s elapsed, 98.133579 CPU s and 1,605,656,576 peak bytes; cleanup verified,
no OOM.

CI also terminated one unchanged ADB CLI child at its helper's existing 20-second
deadline. Two isolated exact 17-extra CLI probes returned the expected argument
validation failure in 1.970 s with a fresh Node compile cache and 1.170 s reusing
it. Neither ran ADB or reached a device; the 20-second deadline was unchanged.
Both local scopes cleaned up with no OOM. The rebuilt full ADB CLI file passed,
including that case in 1.597 s. The CI delay was not reproduced; these observations
do not establish baseline flakiness or a controlled before/after startup result.

After the diagnostic change, the untouched genuine jq/Ghidra bundle was imported
again into a fresh target-free stdio server. Call path, function comparison and
native matching returned complete public values equal to their original matrix
goldens, including IDs, provenance, coverage and unknowns. Seven calls included
no producer, target opening or Ghidra execution. The built runtime fingerprint
was `1bcdcd29df3b90f2cfa61aad29d647dbfb22176d0bca880c7a537507fdeab271`;
source bundle and runtime stayed unchanged. The replay cost 5.543 s / 5.263196 CPU s
/ 447,791,104 peak bytes, with verified cleanup and no OOM. This is an additional
scripted replay, separate from the thirteen-attempt matrix and fourteen model
attempts. Its full receipt and the timeout probes are included in JSON.

## Regression and coverage limits

The focused regression run passed 508 checks covering source integrity, exact
IDs, mixed/optional/nested selections, default constraints, converted full and
compact SDK schemas, source closure, caller choices, CLI bundle immutability,
capacity admission and late cancellation/source retention. SDK boundary tests
are kept in the MCP boundary project; pure declaration checks stay in contracts.

Full-library lint exceeded the local early-stop limit even with one worker.
The same selected 6,105 files were checked in sequential batches of 400;
peak family memory was 741,650,432 bytes. Two new test grouping errors were
corrected and those files rerun. Failed lint/driver attempts remain in local
receipts. Process-driver path/ANSI oracle corrections reused the original
authentic captures.

No real Hopper, IDA, Windows capture, Android device, Harmony runtime, passive
browser reconciliation or managed/native runtime equivalence is established
by these tests. There is no controlled main-versus-candidate model cohort,
no cold filesystem measurement and no claim that every provider facet was
independently verified.
