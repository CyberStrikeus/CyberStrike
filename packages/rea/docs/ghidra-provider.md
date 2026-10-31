# Ghidra provider semantics

REA imports one target into an ephemeral Ghidra database. Linux/macOS support
read-only analysis and atomic function-name/entry-comment edits; Windows P0 is
read-only. GUI controls and persistent database mutation are unavailable.
Executable bytes remain unchanged.

Use [installation](installation.md#ghidra) for supported hosts, prerequisites,
configuration, startup deadlines, resource controls, and cleanup recovery.
[Linux Ghidra launches](installation.md#linux-owned-process-prerequisite) also
require a procps-compatible `ps` on REA's `PATH` for process ownership checks.
[Windows P0](windows-ghidra-p0.md) has its own admission and lifecycle boundary;
[NativeAOT observations](ghidra-nativeaot.md) include a built-in read-only PE
snapshot parser and a separate optional annotation extension. Check the
[release boundary](installation.md#released-package-and-main) when using npm.

See [import language and analysis seeds](installation.md#ghidra-import-language-and-analysis-seeds)
to override the header-detected language or seed analysis. An override that conflicts with a fixed raw, DOS, PSP, MIPS, RISC-V or GameCube DOL import
is a configuration error naming the conflicting settings. It does not make an
otherwise admitted target unsupported; REA preserves the requested settings.
An inaccessible language
catalog remains a read failure; it does not prove that a configured language is
undefined. Installation `application.properties` has a fixed 1 MiB read allowance
with no runtime override. The failure retains that allowance and directs recovery
at the selected installation metadata.

Retained process diagnostics can report termination by `SIGKILL`; the signal alone
cannot establish an OOM kill. REA gives neutral recovery guidance and preserves the
signal. Confirm resource causes from process output or host/container records;
operation-scoped JVM `OutOfMemoryError` observations retain their separate resource
classification. Automatic kernel or cgroup OOM attribution is not implemented.

After the authenticated startup handshake, rejected inputs (`invalid_request`,
`not_found`, `ambiguous`, an invalid function name, or an address without one
exact file offset) use
`diagnostics.diagnostic_scope: "request"` when their active output checkpoint is
available. They preserve the active request's
`failure_output`, target/profile identity and runtime/log coordinates, while
omitting cumulative launcher stdout/stderr and launch-support output. Startup,
process, protocol and other remote failures retain full session diagnostics.
The Ghidra client still owns its bounded cumulative output; this projection does
not clear it or alter session readiness. Log paths refer to the owned ephemeral
runtime and are removed by normal cleanup.

Provider selection and profile identity follow
[MCP contracts](mcp-contracts.md#identity-and-discovery). One deep
provider stays bound to the target; runtime failure never selects another
provider automatically. The contracts below describe Ghidra observations,
not equivalence with another engine's pseudocode or analysis database.

## Request payload ceiling

Ghidra requests use `REA_BRIDGE_MAX_REQUEST_BYTES`: default 16 MiB, with a
configurable range of 7,464–536,870,887 bytes. REA measures UTF-8 JSON, including
escaping, before allocating the serialized request or sending it. The framing
newline is excluded. An oversized request returns `resource_constraint` with
the effective setting, its source, and the exact payload byte count.

Set the value in the environment that starts REA, then restart REA to apply it.
This setting is enforced by the REA client; the Java bridge has no corresponding
request ceiling.

## Admitted inventory semantics

| Concern          | Ghidra contract                                                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program identity | One `analyzeHeadless` import produces exactly one Program; `list_documents` therefore returns exactly one name.                                                                                                                                                                                 |
| Addresses        | Default memory uses lowercase `0x` hexadecimal. Non-default and external spaces use `<percent-encoded-space>:0x<hex>` and remain round-trippable. The handshake commits image base and default address-space name.                                                                              |
| Symbols          | `list_names` includes address-bearing memory and external symbols, including dynamic symbols, while excluding variable and no-address namespace records. Each item reports primary, dynamic, external, symbol type, and source facts.                                                           |
| Procedures       | Both non-external and external functions are listed. A local thunk remains distinct from its resolved target; exact and qualified name lookup fails on ambiguity rather than guessing.                                                                                                          |
| Strings          | Only Ghidra-defined string `Data` is observed. Items report charset, byte length, and whether a required null terminator is missing. The API cannot distinguish a present terminator from fixed/Pascal layouts when no terminator is missing, so that state is named `present_or_not_required`. |
| Memory           | Memory-block end addresses are exclusive. Read/write/execute, initialization, overlay, address space, and image base are direct Ghidra observations.                                                                                                                                            |
| Inventory        | Procedure, symbol, and string listings plus searches return the complete matching collection in one response; callers do not provide offsets or result-count limits.                                                                                                                            |
| Search           | Literal and Java-regex searches return every match in the immutable provider-defined inventory; string search does not cover every text sequence in artifact bytes. Search waits for a reply or caller cancellation; there are no caller-supplied offsets or result-count limits.               |
| Analysis state   | The socket is exposed only after default auto-analysis completes. Established operations wait for their reply or caller cancellation; there is no fixed response-size ceiling.                                                                                                                  |

String-search completeness applies only to Ghidra-defined string `Data`. Packed
or undefined literals, including Rust strings, may be absent; an empty result
does not prove text is absent. Both list and search Evidence carry this
limitation. When an address is known, use `read_bytes` and `xrefs` to inspect
bytes and references.

## PE debug-symbol coverage

The post-analysis handshake reports Ghidra's PDB Program Information attributes:
the referenced file, GUID, hexadecimal age, legacy signature, version, and
`PDB Loaded` state. Absent attributes remain null. PE Evidence carries a
limitation when a PDB reference is present but Ghidra reports it as not loaded,
or its load state is unknown. A bridge without this report leaves PDB coverage
unknown. A reported loaded state is a Ghidra observation, not an independent
PDB identity or complete symbol-coverage attestation, and retains an inline
coverage caveat. Handshake PDB strings share a 4096 UTF-16-unit serialization
budget (at most 24 KiB after JSON escaping); whole attributes that do not fit
are omitted with an explicit resource limitation, rather than truncated.

Original names and types may be missing even when auto-analysis completes.
An empty name search does not establish that a function is absent; use
`list_procedures` and address-based analysis to inspect recovered functions.
REA imports a private executable copy and does not admit a caller-selected
PDB companion. This reporting does not search symbol servers, copy a sibling
PDB, or change analyzer settings.

## Loaded addresses and file offsets

Ghidra computes overview procedure and string counts from the same inventories
used by `list_procedures` and `list_strings`, without transporting those rows
solely to count them. Counts include external functions and only Ghidra-defined
strings; they do not establish discovery of unidentified functions or undefined
string bytes. Complete inventories remain available through the list tools.
Overview reuse follows the target/profile snapshot lifetime and is invalidated
by session metadata edits.

`rea analyze <path> --provider ghidra --json` and MCP `binary_overview` report
the observed loaded `image_base` in `normalized_result`. They retain each
segment's reported `image_base` and `address_space`. A provider that does not
report a base, or whose segments disagree, omits the overview field, following
the existing contract on main. REA does not substitute zero or the first
segment's address. All reported bases and address spaces remain visible in the
complete segment inventory, including conflicting observations.

`function` and most MCP procedure selectors use procedure names or
provider analysis addresses. Ghidra `decompile` / MCP `procedure_pseudo_code`
also accept source-file byte offsets. Existing symbols and analysis addresses
take precedence; a `0x`-prefixed number that resolves to no procedure falls back
to its observed source mapping. Use `--file-offset=0x...` on the CLI or
`procedure: "file-offset:0x..."` through MCP to select file coordinates explicitly.
Multiple mapping candidates fail as ambiguous rather than selecting a bank or
address space. A successful conversion retains the file offset, mapped address
and procedure entry in raw Evidence and `locations`.

If an offset maps to loaded target bytes but no procedure starts at or contains
the mapped address, the failure preserves both the original file offset and
analysis address. This differs from an unmapped offset and does not recommend
retrying the same offset syntax.
If the function resolves but the backend fails or cancels decompilation, the
failure retains the selector, mapped address and procedure entry without
changing the backend failure code.

Both mapping directions require a complete original `FileBytes` source whose
SHA-256 matches the admitted target. Auxiliary files and partial source objects
remain visible in the load-image inventory but do not establish offsets in the
original target. Ghidra's object-local offsets are not silently treated as
original-file coordinates. Original-source identity is checked once per source
object per session; analysis-memory edits do not change the original bytes.

ELF virtual addresses and file offsets are
different coordinates. Ghidra can rebase a PIE ELF during import: in the
source-owned verification fixture, ELF entry `0x1013` becomes Ghidra procedure
`0x101013` with image base `0x100000`. That example is not a general conversion
rule.

Use `list_procedures` to select an observed procedure address. To relate file
bytes to loaded memory, call MCP `inspect_native_load_image` or:

```sh
rea search <path> . --kind procedures --mode regex --provider ghidra --json
rea inspect-native-load-image <path> --provider ghidra --json
rea decompile <path> <observed-procedure-address> --provider ghidra --json
rea decompile <path> --file-offset=0x1013 --provider ghidra --json
rea address-to-file-offset <path> <observed-procedure-address> --provider ghidra --json
```

The load-image result preserves source-file indexes, file offsets, address
spaces, and inclusive mapping ranges. Follow the mapping for the selected
source file and region; adding `image_base` to an arbitrary file offset is not
valid. For a linear byte-addressed, file-backed mapping, a file offset `F` in
`[mapping.file_offset, mapping.file_offset + mapping.length)` maps to
`mapping.start + (F - mapping.file_offset)` in the reported `address_space`.
If several mappings cover the same file offset, keep those candidates distinct
and select the procedure from the observed inventory. Uninitialized regions may
have no file backing. ELF mappings are observed
without independent format-specific load-image verification, as the result's
status and limitations state.

For large relocation inventories, select MCP `inspect_native_load_image` with
`detail: "summary"`. It returns verification state, observed identity and counts,
while retaining complete Evidence. Use `normalized_result.parent_evidence_id`
with `inspect_analysis_view` and a view such as:

```json
{
  "kind": "native-load-image",
  "collection": "relocations",
  "offset": 0,
  "limit": 32,
  "fields": ["address", "status", "type"]
}
```

Collections are `source_files`, `mappings`, `relocations`, `entry_points`,
`entry_context`, `checks` and DOL `sections`. Optional
`indices` select original row indices before paging; empty indices select none.
Fields are collection-specific. Relocation defaults omit byte payloads; check defaults omit potentially large `expected`/`observed` inventories. Request those fields explicitly when needed. Other collections default to all fields. Metadata recovery remains counted and retained in complete parent Evidence.
Parent Evidence, collection and `source_index` identify a row, including same-address
relocation alternatives. Null counts or rows mean unrecorded or inapplicable;
they never establish an empty observation. Exhausting a page does not upgrade
unsupported verification or runtime coverage. Pages query immutable retained
facts without reopening the target or repeating Ghidra work.
Each page carries the source's structured `verification_status` independently
of its page coverage.

CLI summary delivery requires a complete Evidence bundle:

```sh
rea inspect-native-load-image <path> --provider ghidra --detail summary --evidence_output /new/load-image.json --json
```

Read selected pages later through `inspect-analysis-view` using the returned
parent ID and an `evidence-file` source pointing to that bundle. Complete
delivery remains the default in both adapters.

An unsuccessful numeric procedure lookup reports the current Ghidra image base
and gives the CLI commands above alongside the corresponding MCP operations.
Repeat any target-format, architecture, and entry-point options used to open the
target. Other procedure operations keep their analysis-address semantics;
file-offset fallback applies only to decompilation.

Overview workflow revision 3 binds this output to snapshot identity. Older
serialized overview Evidence remains readable; it is not replayed as a current
overview merely because its source artifact is unchanged.

## Admitted function-analysis semantics

Concurrent callers share one startup while retaining independent cancellation.
Only the final departing caller abandons startup and waits for its cleanup.
New attempts wait for that cleanup; failed cleanup retains its original error
and owned directories until a successful close. Closing the provider reports a
provider-state failure to live callers rather than cancelling their signals.

Configured analysis extensions and seeds use owned file reads during profile
resolution and launch snapshots. A changed read extent or descriptor state
refuses the commitment. Failed source or snapshot descriptor closes remain
owned and block new admission until cleanup succeeds; the physical failure
and exact cancellation reason remain available. Provider shutdown joins all
profile stages before retrying their retained descriptors.

| Concern                 | Ghidra contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decompiler lifetime     | One persistent `DecompInterface` is opened for the imported Program and disposed during bridge shutdown. Native decompilation has no fixed per-function deadline unless the launch setting `REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS` or runtime override `ghidra.decompile_timeout_seconds` sets one; a decompile that reaches it fails only that request with `remote_code` `decompile_timed_out`, the Program and session stay open, and the next decompile uses a fresh decompiler process. External functions or functions without bodies return `null`; cancellation and native failure remain distinct.                 |
| Serialization           | A FIFO sends one Program request at a time. Caller cancellation removes queued work promptly and is passed to active socket waits. This is an adapter safety commitment, not a claim that every Ghidra API is thread-safe.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Function identity       | Every function result carries the entry address and Ghidra FunctionManager classification for external, thunk, and resolved thunk target. These are observations, not proof that unresolved targetless calls have been recovered.                                                                                                                                                                                                                                                                                                                                                                                          |
| Assembly and pseudocode | Assembly is complete Ghidra Listing text; pseudocode is Ghidra decompiler output. Neither is original source, and cross-provider comparison never treats Hopper and Ghidra text as equal or unequal semantic facts.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Instruction fast path   | `read_function_instructions` returns every raw Listing instruction for the requested function without invoking the decompiler or whole-program name/string inventories.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Calls and references    | Callers/callees contain only resolved functions. Reference edges preserve exact ReferenceManager type and call/jump/data/read/write/indirect/computed/conditional/terminal/external facts. Targetless computed flow remains unknown. Synthetic entry-point references without actionable memory sources are omitted explicitly.                                                                                                                                                                                                                                                                                            |
| CFG                     | Dossiers use `BasicBlockModel` and retain only non-call successors inside the function body. CFG topology is address-normalized for comparison; provider-specific block construction remains a declared difference.                                                                                                                                                                                                                                                                                                                                                                                                        |
| P-code value flow       | Function dossiers include up to 3,000 high-p-code operations, at most 64 inputs per operation, and 12,000 def-use edges. Results identify memory reads/writes, branches, and calls by p-code opcode, and mark decompiler-dead operations. Large results report truncation, an omitted-operation lower bound, and known omitted-input/edge counts. The dossier is an intra-function graph; `trace_native_values` composes derived parameter/argument and return/output dependencies across resolved calls. It does not resolve memory aliasing, call side effects, runtime behavior, persistent state, or business meaning. |
| Result extent           | Function instruction scans and native API boundary observations remain complete. P-code flow is the explicit bounded exception; its count fields distinguish exact retained counts from lower-bound or known-omitted counts. Caller cancellation and provider failures remain distinct.                                                                                                                                                                                                                                                                                                                                    |

Runtime updates apply to newly accepted operations on the existing Program.
They preserve accepted budgets and do not clear cleanup blockers or change the
client deadline. Transient decompile timeout failures remain uncached so the
same function can be retried after raising the limit. See the
[settings design](design/limits-and-recovery.md) for snapshots, precedence,
and provider integration.

Function extents and instruction completeness refer to Ghidra's analyzed body.
An inferred no-return call can terminate that body before subsequent bytes.
Pseudocode, assembly, procedure info, instruction windows, incoming and outgoing
references, callee and caller reads, and dossiers report observed terminal call sites in Evidence limitations,
including resolved callee names, addresses, and FunctionManager flags when
available. On x86-32, the same views also report the exact Borland/Delphi-style
FS exception-registration pattern when its handler address falls outside the
function body. This is a static registration observation; it does not establish
handler execution or change the body. Instruction windows and dossiers also
retain these warnings in their result limitations. An unresolved callee or
unestablished terminal-flow basis remains explicit. These observations qualify
the analysis; they do not prove that a no-return flag is incorrect or recover
excluded code. Analysis profiles version this observation contract so older
snapshots cannot replay unqualified results.

On non-Windows hosts, the ephemeral import repair clears no-return flags on the
known returning external ABI names `malloc`, `__tls_get_addr`, `memcpy`, `memset`,
`strlen`, and `__errno_location`. This relies on their expected ABI behavior;
external implementations are not inspected. The repair re-disassembles affected
terminal calls and refits their owning functions, preserving independent function
entries. If a recovered caller reveals a decoded return, its propagated no-return
flag and affected callers are repaired in the same pass. Unknown imports and
genuine no-return imports keep their flags. Analysis profiles version this repair
so snapshots produced before it are not reused. Windows P0 does not run it.

`npm run verify:ghidra` compiles the versioned C oracle into debug and stripped
host-native targets (x86-64/AArch64 ELF on Linux or Mach-O on macOS), plus a native
DWARF 4 type-layout object. It proves the admitted operations, external functions, resolved thunks, exports, stripped-name
behavior, direct and targetless indirect calls, typed references, strings/xrefs,
multi-block CFG, bounded p-code def-use/effect links, semantic enhanced workflows, cancellation, startup deadlines,
serialized concurrency, malformed-target rejection, profile identity, and
process/project cleanup against real Ghidra 12.1.4. Unit fixtures separately
cover startup deadlines, process exit, queued cancellation, and malformed wire
output.

`npm run verify:ghidra:cross-format` adds AArch64 ELF, x86-64 PE, and x86-64
Mach-O target coverage. It requires `clang`, LLD, and `lld-link`; set
`REA_CLANG`, `REA_LLD`, or `REA_LLD_LINK` to select them. The verifier checks
these tools before compilation. Keeping this matrix separate lets Linux
host/provider acceptance run with only the host compiler.

`npm run verify:ghidra:windows` checks source-owned native x86-64 PE applications;
`-- --x86`, `-- --arm`, or `-- --arm64` selects another target architecture;
`-- --dll` selects DLLs. Choose one architecture and optionally combine it with
`--dll`. These static fixtures contain source-owned encoded instructions; they
are not compiler-produced programs. See the [Windows verification scope](windows-ghidra-p0.md#native-authority-and-target-identity)
for real-provider coverage and exclusions.
These lanes check all 27 read-only operations, target/snapshot/import SHA-256 linkage,
and project, endpoint, process, and runtime cleanup. The independent native
lane checks DACLs, handle admission, cancellation, and Job Object lifecycle.
`npm run verify:ghidra:windows:package` packs and installs REA into an isolated
prefix, then checks ordinary-user CLI/MCP operations against canonical contracts.
It accepts the same architecture and DLL flags and verifies the selected PE role
in the analysis profile.
All lanes require matching native controls; package startup alone establishes
only package compatibility.

## Masked byte search

`search_bytes` (`rea search-bytes PATH '48 8B ?? ?? 89' --provider ghidra`)
searches initialized analyzed memory, including loader fixups. Supply hexadecimal
byte pairs, with `??` for any byte. An optional equal-length hexadecimal `mask`
selects bits: `pattern: "a0"`, `mask: "f0"` matches bytes from `a0` through `af`.
Wildcards remain unconstrained even with an explicit mask. At least one bit
must be constrained.

Optional `start` and `end` addresses are inclusive and select one address space.
A match must end at or before `end`, so `end` set inside a match excludes it.
Without bounds, loaded memory blocks are eligible, in Ghidra address order.
Blocks that are not loaded (file parts such as `.symtab`) and overlay blocks are
listed in `searched.skipped_not_loaded` and are not searched; pass `start` or
`end` in their address space to search them.
Overlapping matches are included; matches never cross block boundaries.
Each match reports its address, segment, unique source file offset (or null),
and containing procedure (or null).

Pages default to 100 matches and accept 1 to 1000. Pass `next_cursor` as `cursor`
with the same target, profile, pattern, mask and bounds to continue. `complete`
means no further matches remain. `searched.blocks` and `searched.bytes` describe
the inclusive memory ranges examined for this page, including lookahead for the
next match. Coverage can overlap between pages; do not sum it as unique memory.
`searched.skipped_uninitialized` lists eligible uninitialized blocks on every
page. These blocks are never searched. Cancellation returns a typed error,
discards the active Ghidra database, and does not return a successful partial page.
Hopper byte search remains unavailable until its implementation is verified.

MIPS16 shared-image admission requires examined dynamic REL declarations.
RELR dynamic tags or nonempty `SHT_RELR` sections leave relocation coverage
unavailable and the profile unsupported; REA does not infer an empty relocation
set from the absence of REL declarations. RELR loader semantics have not been
verified for this lane.
