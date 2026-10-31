<div id="native-ui-and-dispatch-investigation"></div>

# Native binary investigation

Use a native provider to discover functions, inspect instructions and pseudocode,
follow references, and examine database types. Static resources and runtime
observation complement that analysis when they answer a specific question.

`inspect_macho` reports build platforms from the selected slice. Legacy
`LC_VERSION_MIN_IPHONEOS`, `LC_VERSION_MIN_TVOS` and
`LC_VERSION_MIN_WATCHOS` commands are interpreted with the Mach-O CPU type, so
Intel slices report simulator platforms while device CPU slices keep the
device platform. A chained-import row ending in `+0x...` is ambiguous in
dyld's text output: it may be an addend or part of a literal symbol name. REA
keeps the full expression in `raw_name`, sets `name` and `addend` to null, and
marks `name_status: "ambiguous"`; it does not synthesize a symbol identity.
Each import and export `name` is the exact symbol-table spelling, such as
`_main`; `runtime_name` is the derived name LLDB and `dlsym` use, such as `main`,
and is null when `name` is null. See [native call observation](#native-call-observation) for
breakpoint names.

## Start with a function

Choose an installed provider from [setup](installation.md#hopper). For Ghidra:

```bash
rea inspect /absolute/path/to/program --provider ghidra --json
rea search /absolute/path/to/program entry --kind procedures --provider ghidra --json
```

Select an exact name or address from the returned inventory, then use it with
`rea function PATH PROCEDURE --provider ghidra --json` for a function dossier,
`rea instructions` for assembly, or `rea decompile` for pseudocode. Do not assume
that every target names its entry function `entry`. MCP uses `open_binary` and
focused tools such as `list_procedures` and `analyze_function` on the same session.

| Question                                                     | Section                                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Which instructions, calls, references, or types are present? | [Native primitives](#native-instruction-call-and-type-primitives)                      |
| How can I select a name beginning with a dash?               | [CLI selectors](#exact-cli-selectors)                                                  |
| What static path connects these functions?                   | [Bounded traces](#bounded-static-traces)                                               |
| Which UI resources or dispatch metadata are present?         | [Static inspection](#static-inspection)                                                |
| What did the declared runtime scenario observe?              | [Desktop](#native-desktop-observation) or [call observation](#native-call-observation) |
| What can this provider and host establish?                   | [Provider boundaries](#provider-and-verification-boundaries)                           |

## Exact CLI selectors

`function`, `instructions` and `decompile` accept `--procedure=<name-or-address>`;
`xrefs` accepts `--address=<name-or-address>`. `search` accepts `--pattern=<text>`
and `trace` accepts `--query=<text>`. These alternatives preserve names and text
that begin with a dash, including Objective-C names such as
`rea function ./app '--procedure=-[REAWidget delegate]' --provider hopper --format json`.
Use the equals form when the value resembles a CLI flag, for example
`rea trace ./app --query=--help --provider hopper --format json`.
The existing positional forms remain available. Missing selectors and conflicting
positional/named values fail before analysis starts; identical selections agree.

## Native instruction, call and type primitives

Ghidra supplies three exact-object operations:

Ghidra accepts hexadecimal addresses with or without a `0x` prefix, in either
letter case, and explicit address-space coordinates such as `EXTERNAL:0x1`.
Results use canonical lowercase hexadecimal offsets. For a procedure identifier,
an explicit `0x` or address-space prefix selects an address; otherwise an exact
database symbol name takes precedence over a bare hexadecimal address. Thus a
function renamed to `dead` remains selectable by name. Use the names returned
by the inventory, including their namespaces and any platform symbol prefix.
Ghidra also accepts secondary symbols at a function entry, such as an imported
`_main` label. A label inside a function is not a procedure-name selector; use
its address when selecting the containing function.
Overloads can share a fully qualified name; ambiguity errors return every
matching entry address so the caller can select the intended function directly.

`resolve_containing_procedure` also resolves an exact external entry. Its empty
body remains explicit; nearby external addresses do not inherit that identity.

Ghidra function references cover the complete function-body AddressSet and its
exact entry, including references into instruction interiors and references
from embedded data. Addresses inside an enclosing span but outside the owned
body are excluded. `procedure_references` returns internal and external edges;
`analyze_function` omits incoming edges whose sources belong to the same function.
The reference collector's semantics participate in the analysis profile, so
older snapshots cannot replay the former incomplete results under this profile.

Ghidra regex searches use Java Pattern semantics. If compiling or matching a
pattern exhausts the engine's stack, REA returns a resource constraint and
preserves the active database and annotations. Retry in literal mode or simplify
the regex; successful literal searches retain complete matching strings.
Cancelling an active request terminates the ephemeral database and discards its
annotations. REA retains the selected target and imports the original artifact
again on the next Ghidra query.

Opening the same target and profile again retains the live database, including
annotations. It does not make those edits eligible for an immutable snapshot.
Snapshot closes drain earlier provider requests before saving and keep later
requests waiting until the save and close finish. A concurrent successful edit
therefore rejects the snapshot save and leaves the edited session open.
After metadata edits, snapshot saves and imports remain unavailable in that
session. Use `export_evidence_bundle` to retain the observations, close without
`snapshot_path`, and reopen the target before importing or saving a snapshot.

Hopper executable opens use an owned private image verified against the digest
selected by `open_binary`. The ordinary ELF/PE path and configured loader overrides
copy the whole source; default Mach-O opens retain their selected-image checks.
A changed source fails before the launcher reads it. The bridge binds its Hopper document to that private
loaded path, while Evidence retains the selected original artifact identity. Hopper
database opens retain their separate database semantics. Real Hopper conformance for ordinary
copies and loader overrides remains unverified by the source regression tests.

Ghidra checks its private import copy against the artifact digest selected by
`open_binary`. If the source changes before that copy is acquired, the query
reports `artifact_changed` with the selected path and both digests. Reopen the
stable target to acquire its current identity. An already imported database
continues to describe its captured bytes even if the original path is changed
or removed; this identity failure does not mark the Ghidra installation unavailable.
On Linux and macOS, an unreadable source reports `access_denied`; a removed or
nonregular replacement reports `artifact_changed`. Source copying is cancellable
and never replaces an existing private snapshot.

```bash
rea inspect-native-instruction <binary> <address> --provider ghidra
rea resolve-native-call-targets <binary> <call-site> --provider ghidra
rea inspect-native-data-type <binary> --type /MyStruct --provider ghidra
rea inspect-native-data-type <binary> --address <typed-data-address> --provider ghidra
```

Instruction facts include bytes, length, decoder text, ordered register/scalar/
address tokens, typed references and flow destinations. Mid-instruction, data,
outside-memory and unlisted addresses have separate outcomes. For Ghidra,
`not-in-listing` means the address is in memory without a listed instruction or
defined data. REA does not attempt a decode there: the memory may be uninitialized
or contain valid instructions. Older Evidence may report `undecodable` for this
same ambiguous case; it does not establish that a decode failed. Effective
memory base/index/displacement roles remain unavailable. Ghidra reports its program
language variant in `mode`; other providers retain their own mode label. Ghidra
MIPS results additionally expose `decoder_context`
with the observed `ISA_MODE` register at the queried address and its provider
source. A null value is unavailable, not mode zero; an empty array reports no
available context register, and omission preserves older captures or providers
that do not expose this facet. The context is an analysis observation, not proof
of a runtime processor state.

`inspect_native_instruction` also returns `incoming_references` to the exact
queried address, including data, interior-instruction and unlisted addresses.
Ghidra enumerates its ReferenceManager, excludes synthetic entry-point
references, and returns deterministic source-address ordering while retaining
distinct operand references from the same source. `[]` means that enumeration
found no references; omission or `null` means this facet is unavailable in an
older capture or another provider. Empty static references do not prove that
the address is unused at runtime. The existing `references` field still holds
outgoing instruction references, and `xrefs` still returns bare source addresses.
The Ghidra analysis profile versions this incoming-reference coverage. Reopen
the target without an older snapshot and save a fresh snapshot to acquire it;
the older snapshot's Evidence bundle remains readable with this facet unavailable.

Compact incoming, outgoing instruction and call-target references preserve the source
address, operand index, DATA/READ/WRITE classification, primary status, provider
`provenance`, and reference `source` (for Ghidra: `analysis`, `default`, `imported`
or `user_defined`). Primary status reports the provider's chosen reference; it
does not establish literal addressing. Analyzer-inferred indexed targets remain
static references, not observed runtime reads or writes. Older evidence may omit
the additive fields, and null or omitted facts mean unavailable rather than false.

Ghidra distinguishes a return using decoded instruction p-code's `RETURN`
operation. `flow.classification_evidence` preserves the Listing flow type and
the observed return evidence; mnemonic spelling alone is not the classifier.
Other terminal or trap flows retain the provider's classification, and this
inspection does not change function extents or prove a calling convention.
The analysis profile commits this decoder behavior. Snapshots from the earlier
profile produce a profile mismatch rather than replaying the former generic
terminal result. The old snapshot's `evidence_bundle` remains valid retained
Evidence: copy that object to a separate JSON file and use `rea evidence-import`
to validate it. Run analysis without the old snapshot and save a fresh one
under the current profile. Other providers and older captures may omit the
classification evidence field.

Call resolution reports direct, resolved indirect, ambiguous, unresolved and
non-call outcomes from static call references. It does not establish runtime
execution or classify Objective-C/Swift/vtable/closure mechanisms from names.

`batch_decompile` keeps each caller-selected symbol or address in `items[].address`.
The separate `procedure` field reports the canonical entry and the provider's
observed entry label. An interior address therefore remains visible without
being mistaken for the function entry. Identity failures are reported as
`procedure.status: "unknown"`; label failures leave a null name and `name_error`.
Neither failure discards usable pseudocode, and names are not parsed from it.
A provider answer without pseudocode is an error item that keeps that
observation's own `limitations`, so a reason the provider reported for that
entry, such as a Kuna export failure or a missing body, stays with the item.
Null pseudocode is `capability_unavailable`; empty or non-text pseudocode is
`unreadable_output`. Provider failures keep their typed error. Successful items
do not repeat limitations; the batch Evidence aggregates every observation's
limitations by provider and operation.
Resolved entries also appear in the composed Evidence locations. New batch
Evidence commits the revised workflow profile; retained historical Evidence
remains valid. This tool
has no dedicated CLI command; the existing `decompile` command remains the
single-procedure CLI operation.

Each batch schedules one provider read at a time, but has no shared input-count
or aggregate retained-output allowance. It retains every requested row and full
pseudocode body through Evidence construction. The MCP response budget checks
complete delivery afterward; it does not bound provider work or retained batch
state. Select small explicit batches when using this workflow. A general batch
admission/output policy, including completed per-item facts when capacity is
exhausted, remains unresolved.

`decompile_all` (`rea decompile-all <target> --output <directory>`) writes one
pseudocode file per analyzed function and returns only a manifest: counts, the
output directory, capped failure reasons, provider identity, and the
analysis-profile digest. The manifest and `decompile-index.json` do not contain
pseudocode. Each file records the provider name, canonical address, inclusive
body ranges when `procedure_info` supplies them, and the `procedure_info` and
pseudocode limitations for that function. Header values are abbreviated to
2,000 characters per value and the joined limitation line to 4,000 characters;
the index retains the complete selected names, addresses, provider facts and
caveats. Failure details retain at most 32 rows within 2,048 JSON-encoded
UTF-8 bytes; names may be omitted to keep complete addresses and reasons. The
index retains every failure and its complete observed name.
Each function's `decompile-index.json` record, whatever its status, keeps the
complete limitations of the observations it used. The returned Evidence keeps
at most eight first-observed distinct per-function provider limitations within an 8,000-byte JSON-encoded UTF-8 text budget and counts omitted observations. Repeated omitted text is counted per observation, not as a distinct caveat. This summary does not retain every omitted string in memory. A fresh output directory must not already exist. `--resume`
continues an export for the same target SHA-256, provider, analysis profile,
and layout; it requires the directory to exist, and an export without a known
target or profile digest cannot be resumed. Resume skips files whose bytes still match the last write the journal
recorded, even after a later read failure, tries
functions it has not attempted before retrying recorded failures, ignores a
journal line torn by an interrupted write, and never overwrites a conflicting
file. File reservations compare ASCII paths without case, so distinct address
spaces remain distinct on case-insensitive filesystems. A resumed journal with
conflicting reservations is refused. One function's decompiler error or deadline is counted and does not stop
the others. A function that `procedure_info` classifies as external, such as an
import, is counted as `external` and recorded with that status and the body
fact as observed. It gets no file, no pseudocode is requested, and a resume
skips it. A function whose classification is unknown is decompiled as usual;
a provider that returns null pseudocode for it is reported as `no_pseudocode`. Inventory rows without an address are counted in the limitations. `--layout dwarf`
reports that compilation-unit paths are unavailable and still names files by
address. Filters are a case-sensitive name substring, a case-sensitive name
prefix, an inclusive address range (including uppercase hexadecimal input), and a positive safe-integer attempt limit. The limit does not allocate space in proportion to its value. Cancellation leaves
files already written in place. One run at a time holds an output directory,
identified by its device and inode, through export finalization and any retained cleanup retry; another
run on the same directory is refused with the holder's process ID, and a
crashed run can be recovered by the next run. Failed descriptor or staging cleanup remains owned by the session; close the target to retry it. Initialization cleanup preserves unexpected entries rather than recursively removing the directory. Resume hashes existing files in bounded chunks, and index generation reuses committed journal facts already held by the export owner. After five consecutive functions whose files
could not be written or read, for example on a full disk, the export stops with
an error instead of decompiling the rest. Files and records already committed
stay, `decompile-index.json` is still written, and a later resume continues.

Type inspection selects one exact database pathname or typed data address.
Struct/union fields, enums, pointers, arrays, typedefs, size, alignment, packing
and bitfields retain database authority. Child types use exact IDs for further
inspection, including recursive layouts. Source/debug authority and flexible
array semantics are not inferred. The real lane uses a native DWARF 4 object
with a struct containing a union, enum and recursive pointer; a stripped linked
binary may have no corresponding recovered layout.

Ghidra serializes at most 20,000 fields or enum members per inspected type.
Check `total_fields` and `truncated` before treating the returned layout as
complete. These fields describe omissions from the response, independently of
whether Ghidra recovered the original source layout.

### Hopper analysis behavior

Cursor navigation returns the observed object start when Hopper snaps an interior
address; adjacent-object navigation rejects unmapped inputs and document ends.
Native API text rejects NUL characters and unpaired Unicode surrogates before
annotation changes. Renames preserve unselected label owners; use a batch with
all affected addresses to move or swap existing labels explicitly. Every rename
destination must be mapped, and native symbol names must fit Hopper's 1024 UTF-16
code-unit limit. Oversized names fail before any batch edits; bookmarks and
literal string results are not subject to that symbol-name limit. Rename success
requires exact final readback. New bookmarks must point into mapped memory;
existing legacy bookmarks outside it can still be removed.
String results read each native typed object's complete bytes, retain the original
provider display in `provider_value`, and report its encoding, byte length, and
termination. `encoding_status: inferred` distinguishes REA's decoding from an
observed source encoding. Hopper can split long literals into adjacent
unterminated objects; search matches each object's decoded bytes independently.
Undecodable objects retain native display text with `decoding.available: false`
and a reason, so one uncertain object does not block unrelated inspections.
Function dossiers and `trace_feature` string matches retain this same string
evidence, including decoding uncertainty; procedure matches keep their own
named observation fields without invented string qualifications. Tracing keeps
same-address search alternatives, including different string encodings, in their
original search order and shares one reference read per target address within
the call. Reference rows are emitted once per target address, preserving any
duplicates in the provider's observation. Native call edges retain
Hopper's partial `CallReference` classification and exact endpoints; detailed
reference flags remain unavailable rather than being invented. Caller and callee
procedure inventories come from independent Hopper APIs; REA retains observed
relationships but reports their completeness as unknown. In particular, a resolved
tail call observed in one direction does not prove that the reverse inventory is
complete. An empty Hopper inventory cannot establish that no such call exists.
No whole-binary reverse scan is performed.
Regex searches use ECMAScript Unicode syntax in a cancellable worker with a
matching deadline and a worker old-generation heap. Deadline or cancellation
stops matching while leaving the Hopper API available. The deadline is
`REA_REGEX_MATCHING_DEADLINE_MS`, a positive decimal integer from 1 to
2147483647 ms. Unset uses 5000 ms. A larger value is refused because Node
schedules a delay past that signed 32-bit bound as 1 ms. Invalid values are
configuration errors and do not fall back to the default. The setting is read
from the environment that starts REA; changing that environment needs a restart.
In MCP, `regex.matching_deadline_ms` overrides the deadline for newly accepted
searches without restarting REA. A deadline failure names the effective
milliseconds, known source, default, and maximum. The worker old-generation heap
does not raise it. IDA and Kuna use these same regex controls; Ghidra's Java
matcher does not. The worker
heap request is `REA_REGEX_WORKER_HEAP_REQUEST_MIB`, a decimal integer from
7 to 16384 MiB. Unset uses 128 MiB. A request below 7 MiB aborts the worker
during startup, and a larger value is refused. Invalid values are
configuration errors and do not fall back to 128. The setting is read from
the environment that starts REA, while MCP `regex.worker_heap_request_mib`
can override it for workers belonging to newly accepted searches. Use
`update_analysis_settings` for either runtime control; accepted work keeps its
budget. See the [settings design](design/limits-and-recovery.md).
A heap failure names the effective request, known source, default, floor, and
maximum. A positive Node.js
`--max-old-space-size` on the process that starts
REA, including `NODE_OPTIONS`, overrides that request and sets the effective
heap. `--max-old-space-size-percentage` takes precedence over that flag in
either order. REA does not turn the percentage into a MiB, so the effective
heap stays unestablished instead of the worker heap request or the absolute flag.
The reported `NODE_OPTIONS` value is the process initial environment when that
block can be read. A later edit to the environment is not the value Node
applied, and an unreadable initial value leaves the effective heap
unestablished. The launch Node options are the initial command line on Linux
when that buffer still has a program entry, not a later edit to
`process.execArgv`. A preload can clear that array after V8 has applied the
flags. Setting `process.title` or `--title` overwrites the command line, so a
buffer without a program entry leaves the effective heap unestablished.
`--env-file` or `--env-file-if-exists` can supply `NODE_OPTIONS`
when the initial environment has none. That file is not part of the initial
environment block, so the effective heap stays unestablished instead of the
worker heap request. An initial `NODE_OPTIONS` is still used, because Node does
not let the file replace it. A positive `--max-heap-size`, including the
underscore form and launch `NODE_OPTIONS` on Node versions that allow it,
sets the total heap rather than the old generation and can be lower than the
worker heap request. The effective old generation stays unestablished while that
value is in effect. A zero or empty value clears it.
`--experimental-config-file` or `--experimental-default-config-file` can set
`nodeOptions`, including a heap percentage, from a file that is not read
back. The effective heap stays unestablished when either flag is present,
including when an absolute `--max-old-space-size` is also on the command
line or in the recovered `NODE_OPTIONS`. Node accepts the config path as
`=` or the next argument.
Literal mode retains Python Unicode full case folding, which can expand a
character into a sequence: for example, `ss` matches `ß`. This differs from
REA's Unicode simple case folding used by other native search providers and
Hopper regex mode.

## Bounded static traces

Hopper caller queries, incoming procedure references and function dossiers
reconcile reported reverse relationships with forward call observations. Each
standalone query or composed workflow scans the current document in pages of at
most 64 procedures and retains at most 4 MiB of encoded scan results. A composed
workflow reuses its own index and clears it when the workflow finishes. The
default cooperative scan budget is
2,000 ms; set `REA_HOPPER_CALLER_SCAN_BUDGET_MS` to a positive integer number of
milliseconds before starting REA to change it. The default limits additional
work on the serial Hopper bridge; larger documents may need a higher setting.
Results report the examined procedure count and any budget interruption.
An individual page, native caller list, and target instruction list each have
a 512 KiB encoded allowance. Hitting one reports the incomplete observation.
Cancellation is checked between pages, but cannot interrupt a Hopper API call
already executing; Hopper's native API itself materializes its reference arrays
before REA can bound their copies. Hopper exposes no document revision token, so scans are not
reused across workflows and coverage and consistency during a live scan remain
unknown even when every procedure was examined.
Hopper observations are re-observed rather than replayed from snapshots because
the provider has no document revision token. Safe observations may still be
retained as Evidence.

`trace_native_ui_action` / `rea trace-native-ui-action <target> <seed>` accepts
one authored selector/object ID, native symbol or exact function address. It
joins UI wiring to uniquely matched class/selector implementations and follows
bounded typed call references. Direct references, resolved indirect references,
ambiguous candidates, inferred untyped provider callees and targetless call
sites remain distinct. A static route does not establish runtime reachability.
Swift/closure dispatch requires resolved static references; unavailable ABI
forms remain unknown.

Incomplete reference kinds do not discard known typed calls or partial
provider call references. A `provider_call` with `observed` resolution retains
the provider-reported call site and endpoint without claiming generic direct,
indirect or Objective-C dispatch semantics. Its `call_reference` evidence
preserves the original endpoints, classification, raw provider type and
provenance, even when the target node is a containing procedure. Hopper's
`none`, `unknown`, `direct` and `objective_c` labels stay provider-scoped;
unknown numeric types remain available in the raw type field. Target-only
callee fallback uses `provider_call` with `inferred` resolution.

Callee fallback adds inferred targets while each retained route keeps its
original provider and call site. If enumeration fails, known routes remain alongside an unresolved
failure; cancellation still terminates the request. A node-limit omission keeps
the route's known relation while marking its target unresolved. Distinct call
sites to the same omitted target retain separate evidence.
Reports sharing a call site and containing target procedure retain all their
original endpoint evidence on the shared graph edge. Different reported
relations retain separate edges, independent of enumeration order.

Session discovery describes two automatic source routes for this trace:
`authored_ui_dispatch` needs Interface Builder decoding and dispatch metadata;
`native_seed_call_trace` needs native address resolution, dispatch metadata and
a call reader. Metadata can come from direct inspection or `list_names`;
the call reader can supply typed `procedure_references` or inferred
`procedure_callees`. An authored UI-to-handler edge remains useful without
call expansion, and native-seed tracing can proceed without UI decoding.
These routes add no request option or default mode, so discovery omits
`default_mode_available`. Availability describes source prerequisites;
the result reports the query's actual matches, coverage and failures.

`trace_native_values` / `rea trace-native-values <binary> <procedure> --provider
 ghidra` composes high-p-code def-use graphs across statically resolved calls.
Logical CALL arguments bind to recovered parameter ordinals; recovered RETURN
values bind to CALL outputs. These edges are decompiler-derived. Constants,
operators, LOAD/STORE and branch operands are included inline. Alias effects,
persistent state, RNG roles, missing/variadic bindings and ambiguous destinations
remain unknown. Budgets control depth, decompilations, call-site resolutions,
nodes and edges. Node payloads are bounded to 8 MiB and serialized results to
32 MiB. Pagination returns edges whose source is on the node page and preserves
stable IDs for endpoints outside that page.

Within one value trace, each exact procedure selector is attempted at most once,
including failed analyses. A failed seed returns the provider's original typed
failure and corrective guidance; it cannot establish a trace or target identity.
Failures while expanding a validated seed remain unknown observations and do not
establish canonical function identity. A successful seed without a native def-use
model still returns its procedure and an explicit coverage unknown. A new trace
can retry failed selectors.

Paging and traversal completeness are separate facts. `page_truncated` means the
page omits retained nodes, and the edges they source, before `offset` or after
`next_offset`. Every page repeats `traversal`: `complete`, or `truncated` with
`reasons` naming each observed cause: the `max_depth`, `max_functions`,
`max_call_sites`, `max_nodes` or `max_edges` budget, the fixed
`node_payload_bytes` allowance, `provider_pcode_truncated`, or
`ambiguous_call_candidates`. Each cause also has a located unknown. A budget is
reported only after it rejects work, so an exactly filled budget is not
truncation; a depth or candidate limit is reported only when no other path
analyzes or queues that destination. `total_nodes` and `total_edges` count
retained rows. `truncated` remains true for either kind of omission. Failed
analyses and unresolved calls stay in `unknowns` and do not truncate the
traversal. Each page reruns analysis; pages are not pinned to one snapshot
across session edits.

The raw Java `is_dead` flag can remain set after Ghidra decodes a live block;
`block_membership` reports actual syntax-tree membership separately.

The provider dossier itself retains up to 3,000 p-code operations, 64 inputs per
operation and 12,000 def-use edges, with explicit omitted counts. A `STORE`
may describe stack memory and does not itself prove persistent state.

Jump-table evidence keeps numeric `mappings`, explicit `default_targets`, and
backing `data_sources` separate. A null case value denotes an unresolved
case, never a known default. Ghidra pairs typed case/default tokens with the
recovered block entry and its unique indirect dispatch predecessor; it does
not zip unequal label and destination arrays. Shared case bodies retain each
label. Negative numeric tokens are checked against their encoded magnitude;
nonliteral, ambiguous, or nonexact JSON integer labels remain unknown.
Unknown-label diagnostics retain the token text, encoded unsigned magnitude,
target and dispatch so callers can inspect the original observations.
Decompiler load-table metadata supplies observed entry sizes and counts
without assigning every backing table to each mapping. These observations
describe the decompiler's recovered switch, not guaranteed original source.
Legacy records without `default_targets` normalize to an empty array and
retain their existing unresolved mappings.

AArch64 jump-table recovery additionally verifies byte and halfword relative
forms from unsigned bounds, register definitions, table loads, branch bases,
scaled ADD/BR instructions and the recovered target set. It reads exactly the
proven count and preserves unknowns for other forms. Real ELF and host ARM64
Mach-O fixtures check each case against source-owned return values.

## Static inspection

Thin Mach-O admission and each admitted FAT slice walk declared load-command headers, checking
width-specific alignment, command sizes and exact `ncmds`/`sizeofcmds` agreement
before opening a provider. Headers beyond the initial probe use another
4096-byte window; admission skips command payloads. Native image readers use
the same framing owner and perform their own payload checks. This validation
does not add a global command-table byte cap.

Native target admission checks Mach-O slice headers before assigning FAT
identity. A shared `CAFEBABE` prefix whose declarations do not identify Mach-O
images receives the generic unsupported-format refusal, including JVM class
files larger than the bounded admission probe. This does not identify a partial
prefix as a validated JVM class. For files sharing `CAFEBABE`, target admission
checks complete JVM framing within the same 16 MiB class identity bound as the
Mach-O image reader. A complete class remains unsupported even if its constant
pool resembles a known FAT CPU declaration. Above that bound, an ambiguous
malformed FAT interpretation remains unresolved. Malformed recognized FAT
declarations retain their format-specific reasons.

`inspect_artifact` and `extract_artifact` retain universal Mach-O slices under
their exact `lipo` names, including 32-bit ARM implementations such as `armv7`,
`armv7s`, and `armv7k`. These names are reconciled with the FAT CPU subtype;
the structural reader's `arm` family label alone does not identify a slice.
Available CPU type, subtype/capability bits, byte range, and alignment remain
checked against the source bytes. Inventory records source ranges and hashes, and
extraction copies those ranges without running the target. This does not
expand any analysis provider's supported architectures.
Malformed successful `lipo` output reports a format failure with its parse
diagnostic.
Apple lipo's hidden ARM64 compatibility row is retained separately from the
raw `nfat_arch` count and admitted only from its extra FAT table slot when its
in-range Mach-O header matches the row. `list_architectures` preserves the
per-row `hidden` marker from lipo output. Mach-O image and Electron fuse
inspection include the row in architecture selection while retaining that
marker in their reported slices.

`inspect_plist.format` describes the selected source, not plutil's conversion
format. Sources explicitly identified as XML, binary or JSON retain those
labels. For generic text, a bounded source-prefix probe recognizes leading XML
markup, including UTF-8 and BOM-marked UTF-16 sources. Unidentified text and
OpenStep plists, including a data-only value such as `<deadbeef>`, report
`unknown` even when plutil decodes their values through an XML conversion.

Plist inspection reads bounded original bytes through an owned file descriptor.
Binary and UTF-8/BOM-marked UTF-16 XML sources decode directly, retaining scalar
facts without a mandatory `plutil` conversion. UTF-8 JSON containers also decode
directly when their number facts need no further classification; explicitly
identified JSON sources can have scalar roots. Unidentified primitive text keeps
its existing conversion route, so OpenStep `123` remains a string. OpenStep,
unsupported XML encodings such as UTF-32 and declared legacy encodings, and JSON
numbers requiring XML type facts retain the `plutil` route. Invalid UTF-8 and
encoding-declaration mismatches remain explicit failures. Direct-source
provenance records `file` without claiming conversion; conversion limitations
and invocations appear only when conversion actually ran.
XML sources must also pass native format validation, with native refusals retaining
their diagnostics and successful validation recorded in provenance. Original
unknown scalar text, reasons and limitations survive successful validation;
output-budget omissions remain omissions.

Source input is limited to 64 MiB. Binary and direct XML decoding reserve an
estimated 64 MiB decode budget before parsing; this is not a hard process-memory
bound. The XML estimate charges every element and every text, comment or CDATA
node of the decoder's DOM at a measured upper bound, so a plist made of many
small elements reaches it at a few MiB of source. JSON decode memory has not
been measured and has no equivalent decode estimate. A refused input reports non-retryable `resource_constraint` with
`reported_limits.maximum_input_bytes` or `maximum_decoded_bytes` as applicable.
Ordinary direct-source decoding has a ceiling of 998 source nesting levels,
derived from the existing 1000-level JSON result capacity by reserving one level
for typed scalar fields and one for the result's `value` field. Deeper input reports
`resource_constraint` with `reported_limits.maximum_nesting_depth: 998` and names
the fixed nesting allowance. XML admission also requires native validation, which
can refuse input below this decoding ceiling. Compatibility conversions can
likewise encounter an earlier native utility refusal; both retain native
diagnostics. Archive and Interface Builder decoding retain their separate
128-level allowance. Worker limits and host memory do not raise these fixed
allowances, and the unchanged request fails the same way.

A plist explicitly selected through the path input or as the active plist target
reports an unreadable or malformed selection as `invalid_request`. A missing or
unreadable default plist of another target reports `capability_unavailable`.
Permission failures remain `access_denied`; output and cleanup failures retain
their own error categories.

Selected plist paths preserve filesystem resolution, including `..` after a
directory symlink and trailing directory separators. Resource-only bundle
sessions resolve relative selections from the bundle root with the same path
semantics as executable sessions; the reported source path retains those
selected segments.

A conversion refusal includes plutil's diagnostic from either output stream.
`details.captured_output` retains bounded stdout/stderr excerpts, observed byte
totals and exit status. `truncated: true` means those excerpts are incomplete.

A dSYM companion that `dyld_info` refuses for an unbacked text section reports
`unsupported_target`, retaining the exact diagnostic and directing inspection
to the linked Mach-O. This classification requires both the recognized native
refusal and an independently parsed dSYM Mach header; other tool failures keep
their failure outcome.

Observed `dyld_info` diagnostics include `unknown mh.filetype 4` and
`unknown filetype 4` for `MH_CORE`, and the corresponding `3` spellings for
`MH_FVMLIB`. These refusals report `unsupported_target` when the independently
parsed Mach header confirms the reported file type. The error retains the exact
native diagnostic and recommends a linked Mach-O executable or relocatable
object. This classifies the selected target's refusal; it does not establish
support for core-dump analysis, historical FVMLIB layouts, or unobserved native
diagnostic spellings. Unknown or contradictory header values and signalled
commands remain failures.

`inspect_macho` reads load-command framing and fields from the selected Mach-O
bytes. It does not use line-delimited tool output to decide where a command,
section, or embedded string begins. Names whose bytes are not valid UTF-8 have
a null text value and retain their original bytes as lowercase hexadecimal in
`name_bytes_hex`, `segment_bytes_hex`, or `path_bytes_hex`; fixed-width names
stop at the first NUL, and command paths exclude their NUL terminator. Older
retained Evidence may omit the byte fields. Large binary sizes and offsets that
cannot be represented as safe JSON integers retain an exact hexadecimal field;
the corresponding numeric field is null. A section alignment too large to
represent in bytes retains `alignment_exponent` instead.

Unknown or partially decoded commands retain their selected-slice-relative
offset and size. Their unexamined fields are described in load-command coverage
limitations; an exhaustive command inventory does not by itself establish that
every payload field was decoded. `inspect_macho.selected_architecture` identifies the exact selected lipo slice
and its `container_file_offset` in the input file. A thin Mach-O has a known
offset of zero; an unknown universal-slice offset stays null. The Evidence
subject format describes the input container: `mach-o-universal` for FAT files,
including those with one slice. The normalized result also reports the container
in `format`; `selected_architecture` identifies the selected Mach-O image.
Architecture `file_offset` values are container-relative. Entrypoint, segment
and section `file_offset` values retain their source meaning and are relative
to the selected Mach-O slice. Decoded load-command fields retain their original
values. Repeated fields, such as each `LC_BUILD_VERSION` tool, are keyed
`name #n` in order. Each decoded `LC_LINKER_OPTION` string is keyed `string #n`
and checked against the declared `count`. Evidence locations map the LC_MAIN entrypoint and nonempty file-backed segment
ranges to container offsets by adding the observed slice offset. Zero-fill
segments do not produce file ranges. When the selected slice's container offset
is unknown, those mapped locations are omitted with an explicit limitation;
architecture inventory locations remain available.

`inspect_macho.encryption` reports the `LC_ENCRYPTION_INFO(_64)` state of every
slice, not only the selected one. It decodes only the FAT table, slice headers
and load commands. Like every Mach-O container read, a `0xcafebabe` input of at
most 16 MiB is first read whole to rule out a JVM class file, so that read
includes code bytes; larger inputs and thin images read only the structures
above. A slice is `encrypted` when its single encryption command has a nonzero
`cryptid`, `not-encrypted` when `cryptid` is zero, and `absent` only when every
load command was read and none was an encryption command. A command whose width
or `cmdsize` contradicts the image, more than one such command, or a range past
the slice is `malformed`; a slice whose commands could not be fully read is
`malformed` or `unknown` with a reason, keeping any commands seen before the
failure. A slice with more than two encryption commands keeps the first two
and states the count in its reason. Range mapping in all slices shares one
budget of segment and section records (16,384, a sixteenth of the native
output budget); a slice past it keeps its status and reports its mapping as
`unknown` with that reason. Framing caps retained segment commands before decoding.
Only a successful mapping consumes the shared allowance; failed mappings leave
it available to later slices. Each slice's `range` is end-exclusive in slice and input-file
coordinates and maps to file-backed segment fragments, VM addresses and the
overlapping nonempty sections; bytes outside every segment remain unmapped
fragments. A segment with no VM size keeps its file bytes as fragments with
null VM addresses, and a segment whose file size exceeds its VM size or whose
VM range leaves the address space makes the mapping `unknown` with a reason
while the slice keeps its encryption status. `architecture` is the lipo name of the record at the same offset,
size and CPU identity, and is null when no single record matches. A ciphertext
range adds a limitation naming its input-file bytes, because disassembly,
decompilation, strings and references derived from them do not describe
program code. Encryption is read through the same regular-file descriptor
that `inspect_macho` binds for its load-command reads, whose SHA-256 must match
the session target before and after the native tools run, or the call reports
`artifact_changed`. A target that cannot be opened, or a symlinked, non-regular
or changing target, fails the call instead of reporting tool facts without an
encryption status.

Hopper's `address_to_file_offset` combines the native image-relative mapping with
original-file coordinates only after checking the source against the session's
SHA-256. FAT tables and embedded Mach-O headers come from that same hashing pass.
A changed or nonregular source reports `artifact_changed`; an unreadable or
missing source reports its access or filesystem failure. Those errors retain the native offset,
loaded header and provider source path in `details.partial_observation`, with the
original-file coordinate explicitly unavailable. Restore the original bytes or
reopen the changed executable to obtain verified coordinates. Snapshot replay
remains historical evidence for its recorded artifact identity.

A selected Hopper database's digest identifies the database rather than its
original executable. Original-file mapping is unavailable for that selection;
native mapping facts remain in partial evidence, and `read_bytes` still reads
the loaded database. Open the original executable to verify source coordinates.

Native Xcode command execution uses shared process supervision with a 60-second
deadline and a 64 MiB aggregate stdout/stderr budget. Timeout, cancellation,
stream failure, and output exhaustion retain the captured output, exit details,
and cleanup outcome in the error result. Truncated output is never parsed as a
complete observation.

- `trace_dylib_resolution` / `rea trace-dylib-resolution <app-or-mach-o>`
  parses Mach-O load commands in TypeScript and follows dyld's path expansion
  for every executable in an app bundle, or for one Mach-O within its directory.
  It reports each `@rpath`, `@loader_path` and `@executable_path` candidate with
  its outcome. Paths outside the analyzed root, including shared-cache system
  libraries, stay undetermined. See
  [Apple application analysis](apple-application-analysis.md#dylib-load-resolution).
  ARM64 slice labels distinguish `arm64v8`, `arm64e`, and `arm64e.x1` while
  retaining raw CPU subtype and capability bits. The `arm64` and `arm64e`
  request filters select their respective families; a shared family label
  does not establish dependency compatibility across different subtypes.
  Executable-root discovery preserves traversal uncertainty, including
  undecodable filenames and skipped symlinks, as partial coverage. Known
  executable roots remain available; unexamined names and symlink targets
  cannot establish an empty root set or the absence of other roots.
  A dependency symlink whose target is not valid UTF-8 is undetermined, with
  its stored target bytes in the limitation and partial coverage; a selected
  root crossing such a symlink is refused with the same bytes in its diagnostic.
- `inspect_asset_catalog` / `rea inspect-asset-catalog <app>` reads compiled
  `Assets.car` metadata through macOS `assetutil --info`. Catalog digests, raw
  rendition fields, pagination and exact UI resource-name matches are returned.
  `inventory_coverage` describes traversal of source entries and remains
  `unknown` when the reader cannot represent a filename. Represented symlinks
  are inventoried but their targets remain uninspected, with a limitation.
  `catalog_coverage` and `resource_key_coverage` separately describe examined
  catalog metadata and the UI join; an unmatched key cannot establish absence
  when either source is incomplete. Resource wrappers retain their serialized
  class and authored runtime class, including AppKit `NSCustomResource` names.
  Invalid producer JSON and subprocess failures retain captured output with
  their typed failure reason and selected catalog path. A complete normal
  assetutil exit declaring that exact catalog path `is not a valid AssetCatalog`,
  or its observed `Undefined error: 0` / `invalid file` rejection, reports an
  invalid-artifact failure. Other tool failures retain their own
  classification; unrecognized diagnostics do not establish malformed bytes.
  Catalog-reader cleanup retains the primary
  integrity, utility or cancellation failure and its cleanup resources; the
  provider retains catalog, Interface Builder and keyed-archive readers until
  cleanup is confirmed. A catalog failure also retains cleanup failures from
  its parallel Interface Builder join. Image extraction and undocumented rendition
  interpretation are unsupported.
- `inspect_keyed_archive` / `rea inspect-keyed-archive <plist>` reads XML or
  binary Foundation keyed archives without instantiating classes. For an active
  app, provide its relative archive path as the second CLI argument or MCP
  `path`. Results retain original `$objects` indices, named `$top` roots,
  shared/cyclic references, class descriptors, raw serialized fields and
  malformed/unresolved/nil references. Missing fields stay absent; unknown
  classes are preserved. Select `root`, `offset` and `limit` explicitly.
  Binary references retain their serialized type-8 UID identity; ordinary
  dictionaries with `UID` or `CF$UID` keys remain authored data. XML uses
  Foundation's single numeric `CF$UID` dictionary convention for references;
  a numeric `UID` dictionary remains authored data. Reference identity follows
  the parsed format, rather than the displayed key alone. Object `kind`
  describes the decoded archive value: data, dates and numbers
  remain `scalar` when their JSON value uses a `$plist_type` wrapper. An actual
  dictionary with the same fields remains `dictionary`.
  XML must be well-formed. Data literals use
  [CoreFoundation's raw ASCII quartet rules](https://github.com/swiftlang/swift-corelibs-foundation/blob/384ff680be7c7445fee6ce0c55e9ae11a46e07c5/Sources/CoreFoundation/CFPropertyList.c#L1588):
  non-alphabet ASCII characters are ignored and an incomplete final quartet
  emits no bytes. Character references retain their source spelling for data
  decoding. Non-ASCII content, child markup and self-closing `<data/>` are format
  failures; explicit `<data></data>` represents empty data.
  Each XML dictionary key must have a following value element; a final key
  without one is malformed. An explicit empty string remains a value.
  Binary UID payloads may use nonminimal byte widths. REA normalizes them only
  in a private decoder copy; archive digests still identify the original bytes.
  Positive binary-plist offset and object-reference table widths are read from
  the source; nonstandard widths are normalized only in that private copy for
  the pinned decoder. [Foundation's table checks](https://github.com/swiftlang/swift-corelibs-foundation/blob/swift-6.2.3-RELEASE/Sources/CoreFoundation/CFBinaryPList.c#L759-L789)
  accept positive widths subject to extent/reference bounds, and its
  [sized-integer reader](https://github.com/swiftlang/swift-corelibs-foundation/blob/swift-6.2.3-RELEASE/Sources/CoreFoundation/CFBinaryPList.c#L707-L730)
  handles non-power sizes. Widths over eight bytes follow its unsigned 64-bit
  accumulator semantics.
  UID values above JavaScript's exact integer range return an unsupported-target
  outcome instead of rounded reference identities.
  UID 0 cannot distinguish conditional nil from ordinary nil. Limits are
  64 MiB of input, 200,000 objects/references and 128 nesting levels.
  XML, OpenStep and binary dictionary entries retain their source keys,
  including `__proto__`, through archive projection and CLI/MCP results.
  XML key names combine their text and CDATA segments without trimming or
  expanding literal CDATA entities. The original archive digest is preserved.
  Symbol fallback accepts complete Objective-C class/metaclass symbol leaves,
  including qualified names. Pointer/string labels that merely contain a class
  marker do not establish classes. Provider namespace method labels are not
  interpreted as Objective-C declarations; class definition versus import origin
  remains unsupported coverage rather than an inferred classification.

- `decode_interface_builder` / `rea decode-interface-builder <app>` reads
  compiled storyboard and nib resources into objects, outlets, actions,
  connections and controller/class names. A full app graph is often several
  megabytes (XLD.app: 6.7 MB, about 2M tokens, which also exceeds the default
  MCP response budget), so MCP callers should pass `detail: "summary"`. The
  summary keeps every decoded document and node/edge/coverage counts and
  retains the complete Evidence; page rows with `inspect_analysis_view`
  `view: {kind: "interface-builder", collection: "nodes", document:
  "Contents/Resources/Base.lproj/MainMenu.nib", offset: 0, limit: 64}`.
  `document` selects rows whose evidence names that exact
  `documents[].relative_path` (nodes and edges only); `source_truncated` keeps
  graph incompleteness visible on every page. `verify:interface-builder` compiles
  a source-owned AppKit XIB with `ibtool`. Storyboards require an installed
  iOS platform; unsupported archive forms remain explicit.
  XML plist archives accept UTF-8 and BOM-marked UTF-16 in either byte order.
  App bundle `Info.plist` executable resolution uses the same decoder as keyed
  archives and Interface Builder. The decoder consumes an initial
  BOM and rejects malformed byte sequences, unsupported encoding declarations,
  and declarations that disagree with the detected encoding. It never substitutes
  UTF-8 for a declared encoding it cannot process. Archive and evidence digests
  still identify the original serialized bytes. Bundle resolution reports
  malformed bytes and unsupported encodings against the original plist path
  before looking up the executable. Interface Builder decoding
  accepts recognized NSKeyedArchiver or ibtool document structures and native
  NIBArchive records; an ordinary plist renamed `.nib` remains undecoded with
  partial `archive_decode` coverage. An explicitly empty ibtool object document
  remains a recognized empty document. The decoder limits aggregate input
  archives to 32 MiB.
  Before decoding, it also bounds the serialized structure: expanded binary
  plist references, NIB table records, XML elements and text, plus their
  projected representations must fit the 256 MiB aggregate decode budget.
  NIB string values, data, property names and class names are charged at each
  projected JSON occurrence, including when the archive reuses one source
  value. Binary plist data projection also accounts for the temporary byte
  copy made by the pinned decoder projection. These are format-derived
  representation reservations, not exact heap measurements or a process-wide
  heap ceiling.
  Archives beyond either aggregate budget are omitted with their paths and an
  explicitly partial `archive_decode` facet; previously decoded documents and
  their identities remain available.
  The same facet is partial when source traversal cannot represent a filename
  or an archive-shaped symlink was skipped. Unknown filename coverage has no
  invented document count; known skipped nib and storyboard links are counted
  as omitted. A readable empty bundle can report complete zero-document
  coverage. Source I/O and identity failures retain their acquisition error
  instead of being labeled invalid archive content. Rejected plist decodes
  release their representation reservation for later documents.
  Repeated NIBArchive fields retain all serialized values in order. Array
  outlet connections resolve each serialized member and retain the collection
  object ID and member position on the outlet observation. NIB hierarchy uses
  recognized child fields, reverse `NSSuperview` links and window content links.
  AppKit registry pairs with a resolvable `NSRoot` owner establish top-level
  membership; other registry associations alone do not establish visual
  parentage and leave hierarchy coverage partial. Known non-view cell ownership
  and control-view backreferences remain raw facts. Conflicting explicit parents
  remain unknown rather than choosing an archive-order winner. Retained objects
  keep their decoded fields; uncertain registry diagnostics retain the source
  registry, child and value IDs. Missing, malformed or repeated registry
  declarations also qualify hierarchy coverage.
  `NSString` objects with the [recognized `NS.bytes` representation](https://github.com/swiftlang/swift-corelibs-foundation/blob/main/Sources/Foundation/NSString.swift#L201-L215) are decoded
  as UTF-8 without substituting malformed bytes. A failed conversion retains
  the source string object ID and `nibValues.NS.bytes` base64 data; dependent
  authored classes, titles and selectors remain unknown, and object, class,
  connection and archive-decode coverage is partial. Other decoded objects and
  connections remain available. Genuine U+FFFD and leading U+FEFF characters in
  valid UTF-8 retain their identity; opaque data fields are not interpreted as
  strings. This does not establish support for other NSString representations.
  Embedded `UINib` archive data remains retained and undecoded; affected
  object, connection, class and hierarchy coverage is partial. Recognized
  `UIStoryboardShowSegueTemplate` source records similarly qualify connection
  coverage until their navigation semantics are decoded.

- `inspect_native_dispatch_metadata` /
  `rea inspect-native-dispatch-metadata <app-or-binary>` prefers a validated macOS Mach-O byte reader. It decodes
  64-bit little-endian Objective-C class/metaclass records, superclass pointers,
  absolute/relative method entries, ivar offsets/sizes/alignment and protocol
  declarations. It also decodes Swift nominal type declarations, simple Swift
  conformances, static synchronous witness slots, signed-relative pointers and
  non-generic, non-resilient class vtable descriptors. Records include exact virtual addresses/file offsets and
  artifact evidence. Vtable indexes are metadata word offsets; witness indexes
  start after the conformance header. Names unavailable in metadata remain null.
  The selected Mach-O header must match the requested CPU family for both thin
  files and universal slices before metadata decoding. CPU subtypes and
  capability bits remain source facts; an `arm64` request may select an
  `arm64e` image under the existing slice preference policy.
  Objective-C class, protocol and category lists require eight-byte entries;
  Swift type and conformance sections require four-byte entries. Misaligned
  section lengths and unsupported non-PowerPC big-endian CPU declarations return
  `unsupported_target` with the selected path and precise reason. Recovery
  selects a well-formed or supported artifact and reopens that target.
  The byte reader holds the whole selected file in memory, so it admits files up
  to 64 MiB / 67108864 bytes by default. Select a larger budget with
  `max_input_bytes` (CLI `--max-input-bytes`), at most 1 GiB / 1073741824
  bytes. The whole file counts, including every slice of a universal Mach-O.
  Results record `input_admission` with the effective budget, its source
  (`default` or `caller`) and the bytes retained. A refusal names the observed
  file size, the effective budget and its source, and either the budget to
  select or, above 1 GiB, a deep analysis provider.
  `swift_decls` lists each `__swift5_types` nominal type descriptor, which
  survives stripping: `kind` (`class`, `struct`, `enum`, or `actor` from the
  class actor flag), the descriptor's own `name`, `module`, `qualified_name`
  (`Outer.Inner`), `generic`, the metadata `accessor_address`, the descriptor
  `location`, and evidence citing its `__swift5_types` record.
  Private and local types set `anonymous_context` because their anonymous
  context is omitted from `qualified_name`. When a parent context cannot be
  resolved, such as an extension of a type named only by a mangled name, a
  missing module, or a cyclic chain, `qualified_name` is null and the entry is
  partial with a reason. Access level, superclass, conformances, and fields are
  not reported by this facet. The `swift_declarations` coverage counters count
  examined type records and fully decoded declarations. Class vtable recovery
  reads the same descriptors, so an unreadable type record also keeps
  `swift_class_vtable_descriptors` partial.
  Nominal declarations, conformance type and protocol references, and class
  vtables share one snapshot-scoped name/context reader. Conformance `type_name`,
  `protocol_name`, and dispatch `owner` retain enclosing named types;
  conformances carry the known module.
  Unresolved parents preserve the leaf name and a partial identity reason,
  while independently readable witness implementations remain available.
  Protocol instance properties use the same property-list reader as classes.
  Unreadable instance properties and unimplemented class-property lists keep
  the protocol's methods and record with partial protocol coverage.
  The `swift_class_vtable_descriptors` coverage counters count examined vtable
  slots and successfully decoded slots, rather than type-section entries.
  The `objc_class_method_ivar_metadata` counters count admitted class and
  metaclass objects and successfully decoded objects.
  Pointers are decoded through the image's fixups:
  - `LC_DYLD_CHAINED_FIXUPS` rebases and binds, including the authenticated
    arm64e formats;
  - legacy `LC_DYLD_INFO` rebase and bind opcodes.

  [dyld symbol names are byte strings](https://github.com/apple-oss-distributions/dyld/blob/dyld-1330/mach_o/BindOpcodes.cpp#L203-L208),
  compared with [`strcmp`](https://github.com/apple-oss-distributions/dyld/blob/dyld-1330/mach_o/BindOpcodes.cpp#L42-L56).
  Dependent library install names likewise originate as
  [load-command byte strings](https://github.com/apple-oss-distributions/dyld/blob/dyld-1330/mach_o/Header.cpp#L1278-L1298)
  and are [compared byte for byte](https://github.com/apple-oss-distributions/dyld/blob/dyld-1330/dyld/DyldAPIs.cpp#L607-L618).
  When a symbol or applicable library name has no lossless UTF-8 text
  projection, the affected binding remains unresolved and pointer-fixup
  coverage is partial; later readable bindings and other metadata survive.
  The internal fixup reader retains the exact name bytes and parsed binding
  fields, while public Objective-C and Swift results retain the unresolved
  reason instead of publishing a guessed symbol, library or class name. A literal
  U+FFFD or leading BOM in valid UTF-8 remains part of the name. Legacy
  weak-bind lookup has no library-name scope, so an opaque dependency name
  does not prevent decoding an otherwise readable weak binding.

  A Swift conformance whose type or protocol reference is an external bind
  keeps its name as `null` and carries the raw dyld identity in
  `type_binding` or `protocol_binding`; that record and its facet coverage are
  partial. Consumers of this output must handle nullable conformance names
  and use the typed binding fields instead of substituting a symbol as a
  display name. Indirect relative-pointer records also retain their binding
  identity. A decoded rebase to virtual address zero remains an address; only
  an unfixed zero in a nullable ABI field is treated as null. Incomplete or
  conflicting fixup streams keep affected pointers unresolved; coverage reports
  parsing and resource limits while retaining validated prefix facts.
  Conformance records preserve the raw three-bit `type_reference_kind`. Kinds
  0 and 1 identify direct and indirect nominal descriptors; kind 2 preserves
  the inline Objective-C class name and its source location. Kind 3 preserves
  an imported class binding or the local class-object address when available,
  but class metadata/name recovery requiring the Objective-C runtime remains
  partial. Unknown kinds retain the raw kind and reference location without
  being treated as absent or assigned a guessed type name.

  So an external superclass resolves from its `_OBJC_CLASS_$_` bind (for
  example `NSObject`). The `pointer_fixups` coverage facet names the mechanism.
  Class properties preserve each encoded attribute as a raw `{name, value}`
  pair, including commas inside C++ template arguments in the `T` type, for
  example `{ name: "N", value: "" }`, and report atomicity on the
  property: `N` means `nonatomic`; a complete typed attribute string without
  `N` means the Objective-C default `atomic`;
  missing or incomplete attribute metadata leaves `atomicity` and any
  unestablished read-only value null. A type attribute whose quoted class name
  never closes is incomplete and marks `objc_properties_categories` partial
  with `property_attributes_incomplete`. A property record that cannot be
  decoded, such as one with an empty or unmapped name, is reported as
  `property_decode_failed` at its entry address while sibling properties are
  retained. `is_meta_class`, `is_root_class`, and
  `ivar_count` are also nullable when the selected provider exposes only symbol
  names. Class implementation methods have null `is_required` and `is_optional`
  fields because those facts apply to protocol declarations; decoded protocol
  method lists retain their observed required/optional values. Class properties
  and `__objc_catlist` categories are also decoded. Categories record the
  extended class, local or external, plus
  their methods, protocols and properties; category methods appear as
  implementations with a `category`. A category whose class reference is null,
  or is bound to a symbol other than `_OBJC_CLASS_$_`, such as the `_$s…CN`
  metadata symbol of another module's Swift class, keeps a null class, and
  `objc_properties_categories` coverage names that reference. Swift
  field-offset globals that are only
  initialized at runtime stay unresolved. Generic, resilient, async and
  coroutine tables, and inherited overrides, have explicit unsupported or
  partial coverage. Other providers retain the
  existing symbol-based inventory with its narrower coverage.
  Symbols without a reported location remain in that inventory: Swift symbol
  `address` and Objective-C `implementation_address` are null. An empty provider
  address is retained as `reported_address` in the symbol's evidence, whose
  location also remains unknown. Nonempty provider address syntax is preserved.

  Session discovery reports this workflow available when the bound provider
  offers direct metadata inspection or a `list_names` symbol inventory. The
  workflow tries direct metadata first and uses the symbol fallback only when
  that operation is unavailable; runtime failures remain failures rather than
  being replaced by symbol-only results.

`get_objc_classes` keeps names from the provider inventory. It coalesces rows
only when their exact selected-image pointer slots decode to the same class
import, including its binding stream, raw library ordinal, resolved library, weak status, and addend. A literal filter is
applied to the original names before that join; if the filter selects only an
alias, the output keeps that exact row. `identity_coverage` distinguishes a
complete selected-inventory scan from partial, unsupported, and unknown cases.
Recognized Mach-O formats outside the native metadata reader's support retain
the provider's class labels with unknown import identity; malformed headers and
read failures remain errors.
The join also requires matching whole-artifact digests and matching provider-
owned selected-image facts: container, byte range, full raw CPU type/subtype,
and FAT table digest when present. A missing or overridden loader selection
remains unknown; the result describes agreement on the selected artifact image,
not an atomic observation of a running process or whole-program class coverage.

## Native desktop observation

`observe_native_ui` captures one explicitly selected existing PID/window ID.
Screenshots use a selected-window ScreenCaptureKit
filter on macOS 14+; accessibility reads stay within that window. Missing Screen
Recording/Accessibility permissions produce actionable errors without broad
capture or automatic permission prompts. Executable bytes and process launch
time guard against a different target or PID reuse. AX selection requires one
unique geometry match; ambiguity fails closed.

Accessibility node values preserve strings, finite numbers and booleans as their
original JSON scalar types. Values that JSON cannot represent faithfully,
including unsafe integers, negative zero and non-finite numbers, remain null
with a path-specific gap and incomplete capture coverage. Null alone does not
establish that an accessibility value was successfully read or absent.

An initial PID or window mismatch is `invalid_request` on `pid` or
`window_id` and leaves provider availability intact. An unavailable executable
URL or unresolved executable path leaves identity unknown and reports
`capability_unavailable`. Identity or window loss
after the initial capture remains an observation failure with collected facts.
Permission and other helper failures retain their specific remediation text.

`capture_native_ui_scenario` takes AX child-index paths for press, increment/
decrement scrolling and text-value entry, or bounded waits. No global event
injection is used. Unsupported AX actions fail explicitly. The result preserves
ordered before/after captures and gaps; an action may have occurred before a
post-action capture fails. Application state is left as-is; REA does not attempt
to restore it. Failed or cancelled scenarios return a typed error with the
collected report in `partial_observation`, including ordered step outcomes.
Cancellation preserves the caller's reason and remains observable through helper
cleanup. A later abort does not replace an earlier helper or output failure.
Cleanup failures retain their runtime owner until a confirmed cleanup retry.

Scenarios accept caller-selected action lists and accessibility node counts.
One wait step stays capped at 180000 ms. That cap has no runtime override.
The operation deadline is `native_ui_deadline_ms` (omitted means 180000 ms)
and does not raise the wait-step cap. The complete scenario result has a
64 MiB output budget. Screenshots are scaled to
at most 2,048 pixels and captured only for the selected window. REA compiles one
owned helper per scenario, removes its temporary compiler cache and stops its
helper on cancellation. It does not launch or own the selected application. UI
actions may change application data or trigger network activity.

## Native call observation

`observe_native_calls` / `rea observe-native-calls <app-or-mach-o> <input-json>`
launches the active Mach-O as a new, owned process under LLDB. It stops at
caller-selected entries, records them and continues:

- functions by exact symbol name, optionally limited to one image;
- Objective-C methods by selector, optionally limited to one class and to
  instance or class methods.

LLDB discovery uses a separate 60000 ms `xcrun` deadline with no runtime
override. Discovery timeouts report `provider_timeout` and retain timeout
recovery, captured diagnostics and cleanup state. Output-budget and I/O failures
retain their own error categories; only actual discovery unavailability reports
missing LLDB. `duration_ms` controls the later target observation window.

```sh
rea observe-native-calls /Applications/Example.app '{"breakpoints":[{"kind":"objc-method","class_name":"NSURLSession","selector":"dataTaskWithRequest:completionHandler:"},{"kind":"function","name":"open","module":"libsystem_kernel.dylib"}],"duration_ms":5000,"backtrace_frames":4}' --json
```

Function names select LLDB runtime symbols. On Darwin, the Mach-O symbol table
spells language-level symbols with one leading underscore, which LLDB and `dlsym`
omit: `_main` is `main`, C++ `__ZN3rea3addEii` is `_ZN3rea3addEii`, and Swift
`_$s…` is `$s…`. Names without that underscore, such as `-[Class selector]`, are
unchanged. `inspect_macho` keeps each export and import `name` exactly as the
symbol table spells it and derives its `runtime_name`; pass `runtime_name` as the
breakpoint `name`. `observe_native_calls` preserves the exact selected name; it
does not remove underscores or translate static names, so `_main` selects a
different runtime symbol. Use `{"kind":"function","name":"main","module":"Example"}`
to limit that runtime symbol to the executable image named `Example`, then inspect
the reported locations and image paths. Omitting `module` deliberately matches
every loaded image, including system libraries. A match outside the executable is
valid for that request and does not by itself make coverage partial. Event and
location `symbol` values are LLDB display names, which are demangled for C++ and
Swift; join them to `inspect_macho` through `breakpoint_index` and the request
`name`, or through `file_address` and the export `address`.

Each event is an observation: thread, image, symbol, load and file address,
the raw integer argument registers, optional caller frames and, for an
Objective-C method, the selector read from `_cmd` and the receiver's dynamic
class. Breakpoints stop at the symbol itself, so the registers hold the ABI
arguments. The receiver class comes from LLDB's Objective-C runtime reader
without running target code; no expression is evaluated, and REA never
attaches to a process it did not launch.

The run ends when the process exits, `max_events` entries are recorded,
`duration_ms` elapses, or the aggregate trace resource budget is exhausted.
Bounded termination reports partial coverage. REA checks process termination
using a launch-time OS start identity; if ownership or cleanup cannot be
verified, the result or error preserves that uncertainty. The result reports:
Launch errors keep the fact that LLDB created a process separate from whether
it remains alive. An exited `SBProcess` is reported as exited only after LLDB
confirms that state; unresolved ownership remains retained for cleanup retry.
An invalid process returned by `Launch`, including a rejected working directory,
reports explicit no-process creation. With no target PID or other retained
resource, REA releases that runtime and admits the next observation.
Cancellation observed while output and Evidence are finalized returns partial
cancellation Evidence, even if the target has already exited.

- the outcome, exit status and captured stdout/stderr (1 MiB kept per stream
  while excess bytes are drained and counted without growing capture files).
  Each stream reports `complete`; when draining could not finish, its byte
  count is an observed lower bound and truncation is explicit;
- caller-selected arguments, working directory, and environment overrides, including literal JSON environment names such as `__proto__`;
- `selected_file_sha256` and LLDB module identity observations. These checks do
  not pin the executable against concurrent mutation; `loaded_image_sha256`
  remains unknown;
- signal or exception stops;
- every breakpoint's resolved locations; a breakpoint that matched no loaded
  code makes coverage partial;
- limitations.

The bridge limits retained event JSON to 8 MiB and caller frames to 65,536
across the run. It checks admission before retaining another complete event;
`resource-limit` reports which observations could not be completed without
silently changing the requested event or frame settings.
Resolved breakpoint locations have a separate aggregate 8 MiB metadata budget.
If their details exceed it, `location_count` retains the full observed match
count, coverage is partial, and `breakpoint_locations_truncated` is true. This
post-run metadata limit does not imply that the target was killed.

Accepted entries and signal stops are also flushed to a bounded 8 MiB journal.
If cancellation, timeout, capture failure, or a later bridge error prevents a
full result, the error retains this evidence in `details.partial_observation`
with partial coverage. Available output prefixes remain inline; their byte
counts are observed lower bounds when final drain counters are unavailable.
The original failure classification and cleanup uncertainty remain separate.
An interrupted journal row is ignored with an explicit limitation.
If the trace completed before cancellation or runtime-directory cleanup failed,
the retained observation also keeps its exit status, termination proof, launch
identity, breakpoint results and final stream counters. Those fields remain
absent when the interrupted producer did not report them; partial coverage alone
does not mean that every retained fact is incomplete.

Only entries are observed: return values, floating-point and stack arguments,
and inlined or `objc_direct` calls are not. The target runs with the current
user's permissions and may change files, show UI or use the network.

Debugging must be allowed for the user (Developer Tools access). A
hardened-runtime target without `com.apple.security.get-task-allow` cannot be
debugged; `inspect_signature` reports the signature's `hardened_runtime` value
and its `entitlements`, including `com.apple.security.get-task-allow` when it
is present. A denied trace reports the `debugger-attach-denied` reason.

## Provider and verification boundaries

Install a Ghidra 12.x (>=12.1) release and the 64-bit full JDK it declares, then configure REA to
use them. Ghidra analysis supports Linux x64/arm64 and macOS x64/arm64; each installation requires
the matching native decompiler. Experimental Windows x64 P0 admits native
x86, x86-64, ARMNT (Thumb-2) and ARM64 PE applications and DLLs, plus explicitly selected
[raw NMOS 6502 images](raw-binary.md#nmos-6502) with a caller-supplied load address,
on fixed local NTFS volumes. Other raw CPU families remain unsupported on Windows.
The boundary uses bundled Job Object ownership, protected runtime DACLs, and
handle-based path admission. See [Windows Ghidra P0](windows-ghidra-p0.md) and
[issue #527](https://github.com/morluto/rea/issues/527).
On Linux and macOS, `annotate_native_function` atomically edits a function name
and entry comments in the ephemeral database, returning refreshed analysis
without changing executable bytes. Annotation text must contain no NUL or
unpaired Unicode surrogate; a rejection identifies the field and UTF-16 index
and leaves every annotation unchanged. CRLF, supplementary Unicode characters,
and combining characters are preserved. Windows P0 remains read-only. Ghidra has no
GUI authority, and REA never falls back automatically to Hopper.
For a before-and-after `compare_functions` in MCP, call `analyze_function`
before and after the edit while the session remains open; the annotation Evidence
itself is not an `analyze_function` input. If comparing after close, export the
needed Evidence before closing and import it into the later session. A one-shot
CLI annotation returns its edited dossier before its temporary session is
discarded; a later CLI invocation with the same fresh-import settings starts from
the original executable. Comparison preserves correspondence across renames
when authenticated artifact identity, architecture and provider-owned mapping
and slice commitments establish the same canonical entry. The result reports
`matched`, `method: "same-entry"` and `entry_address`; name and exact-text changes
remain separate dimensions. Equal numeric addresses without applicable coordinate
commitments do not establish same-entry correspondence. Inspect the retained
source Evidence and coverage when correspondence remains ambiguous.
To aggregate already-retained comparison results, pass their exact IDs to
`find_changed_behavior`, for example:

```javascript
await call("find_changed_behavior", {
  comparisons: comparisons.map(({ evidence_id }) => ({
    kind: "retained-evidence",
    evidence_id,
  })),
});
```

These IDs select comparison Evidence, not function dossiers or summary views.
Complete inline comparisons remain accepted and can be mixed with references.
The current server must retain the comparisons and their original source closure;
import the complete source bundle after a session handoff. Missing or damaged
records are explicit failures. A missing required retained record reports its exact
`evidence_id` with `details.reference_scope: "retained-closure"`. Import the
originating bundle with its linked sources, or re-create those observations in the
current investigation, before retrying; resending the inline comparison alone
does not restore its closure. Aggregating static differences does not establish
observed runtime change.

`set_address_name` and `set_addresses_names` give Ghidra sessions the same
compact naming results as Hopper: a local function entry renames that function,
and any other mapped address, such as a global, receives a new or renamed primary
label. A batch decides every address from the names held before it: addresses
that request the same name in one namespace, or a name another selected address
holds, are rejected without applying them, so JSON member order never selects a
winner. Every other address applies separately, and each address reports one
success boolean. `raw_result.failures` gives each failed address's canonical
address and reason. A contested name appears once in `raw_result.conflicts`,
with its namespace, requesting addresses and holding addresses, and conflict
failures refer to it by index. To move a label between
addresses, rename its holder first and assign the name in a later call. Use
them to name many globals and helpers cheaply; use
`annotate_native_function` when you also want comments and a refreshed dossier.
Ghidra name edits preserve the existing namespace. Supply either a leaf name
such as `renamed` or a fully qualified name in that namespace, such as
`alpha::renamed`. The returned qualified name can be reused as an idempotent
rename input. Edits retain the existing namespace; other namespace-like text
remains literal leaf-name text. A qualified name with an empty leaf is rejected
before any comment or name is changed.

- `npm run verify:ghidra`: host-native debug/stripped targets, native type layout,
  instruction/call facts, value dependencies and process/project cleanup.
- `npm run verify:ghidra:aarch64-jump-table`: optimized ELF and byte/halfword
  relative tables, plus ARM64 Mach-O on an ARM64 macOS host.
- `npm run verify:apple-dispatch`: source-built Objective-C protocols, classes,
  properties and categories, and Swift conformances and vtables. Each is linked
  with legacy `LC_DYLD_INFO` and with chained fixups (and as arm64e on Apple
  silicon), then repeated after stripping local symbols.
- `npm run verify:native-ui`: one source-owned fixture window, successful
  selected-window capture and actions, changed-target rejection, and cleanup.
  Missing OS permissions fail this lane.
- `npm run verify:native-ui:permissions`: permits a permission-denial result and
  reports `positive_e2e: false` when capture is denied. That result verifies the
  OS permission boundary, not successful UI capture or actions.

macOS ARM64 is the real host verified during this implementation. Admission of
macOS Intel does not claim an Intel verification run. Unsupported metadata and
unresolved runtime/value semantics remain visible in results.

Signature inspection requests the selected architecture explicitly for identity,
hashes, designated requirements, entitlements and runtime flags. For universal
inputs, other slices receive signing-state probes; their detailed metadata is
not included in the selected result, and coverage states that boundary. The
digest-verified temporary snapshot writes to the filesystem; discovery declares
that effect even though the selected artifact is unchanged.

## Interface Builder hierarchy coverage

Bundle archive selection preserves directory traversal uncertainty, including
filenames that cannot be decoded as UTF-8. These names are not guessed or
counted as known archive omissions. Recognized symlinked `.nib` entries are
not followed; they retain their paths and reader limitations as counted archive
omissions. Either gap makes `archive_decode` partial and the graph truncated
while preserving decoded documents. Its `examined` count remains actual decode
attempts. `archive_object_decode` separately reports whether archive selection
and decoding examined the object sources; hierarchy-only and connection-only
unknowns do not make that facet partial. Asset-catalog resource-key joins use
this source coverage together with document and object projection coverage.
Incomplete hierarchy or synthetic hierarchy-node limits alone do not qualify
otherwise complete resource-key joins; omitted archives or resource objects do.
Archive omission reasons are counted independently of the bounded path samples.
A UID outside the exact supported range reports `unsupported_uid_exact_range`,
not budget exhaustion. Mixed source failures report `multiple_archive_decode_causes`;
limitations retain omission counts by cause even when individual paths exceed
the reporting allowance.

UI dispatch joins use the authored receiver's class independently of its
presentation kind (controller, view, control or another object). An unresolved
action receiver remains an examined, unresolved dispatch relationship and makes
`ui_to_objc_dispatch` partial. Graph object limits retain their own cause in
connection coverage, rather than being attributed to a connection budget.

A document's `hierarchy_complete` flag follows its own hierarchy coverage.
If graph limits omit a hierarchy source or destination, or prevent a hierarchy
edge or traversal from being retained, that document reports partial hierarchy
coverage. Retained unresolved edges remain in the graph and do not add to the
omitted-edge count. Coverage is evaluated separately for each document.

A keyed-archive hierarchy UID without an object-table entry marks the hierarchy
as partial while preserving decoded objects and known links. UID 0 remains
archived nil and does not count as a missing reference. Archive and evidence
digests identify the original serialized bytes.

## Keyed archive integer precision

The archive reader observes XML number element types and binary number markers.
XML values and their number facts are interpreted together from the validated
DOM and its original scalar source spans. Hexadecimal `<integer>` text, including
an optional sign, retains its value;
`<real>` text and CDATA segments are combined without inferring text from nested
elements. Real character references expand outside CDATA; integer and date
literals use raw source text.
Integers beyond the exact range of a JSON number are reported with the original
decimal text as `{ "$plist_type": "integer", "decimal": "<exact digits>" }` when
that source value can be associated unambiguously. Integral real values remain
numbers. Colliding integer/real values, unclassified numbers, and malformed UID
markers remain decoded with an explicit precision limitation. The limitation
also counts observed unsafe integer literals, including observations outside the
selected object page. Incomplete supplemental metadata produces an explicit
precision note without rejecting an archive accepted by the byte decoder.
Malformed XML scalar content becomes an explicit unknown rather than a prefix
number, guessed timestamp, or tag-only boolean. These unknowns do not disable
exact association for unrelated observed numbers. Nonnumeric
`UID` and `CF$UID` dictionary values remain ordinary data and are projected
recursively; numeric reference markers retain their original representation.

Value projection preserves serialized node kinds, IDs, references and pagination.
Exact and ambiguous value counts describe emitted root/object value instances;
a root and an object may contain the same value. Archive digests identify the
original bytes.

Interface Builder's XML and binary plist archives use the same number metadata
and exact-decimal representation for emitted node attributes. Projection follows
object and connection classification, so archive IDs, UID links and graph counts
keep their meaning. Precision limitations name the source document. Unsafe
integer-literal counts cover the archive, including fields not emitted as node
attributes; exact and ambiguous projection counts cover emitted attribute values.
Integral reals stay numbers, and ambiguous or incompletely observed values retain
explicit precision limitations. Before plist decoding, the existing aggregate
decode budget reserves estimated room for number metadata and attribute
projection; these estimates are not a hard process-memory bound. Keyed-archive
object identities always come from their original `$objects` table indices.
Authored `objectID`, `object-id`, `archiveUID` and `id` fields remain ordinary
object data and do not change inventory, reference, connector or hierarchy
identity. This changes keyed-archive graph IDs that previously used authored
`objectID` or `object-id` values: `interface_builder_object_id` and linked node
IDs now use the decimal table UID, while the authored values remain in attributes.
For example, an authored `objectID: "2"` on table entry 1 now identifies object
`"1"`; its graph node ends in `object:["1"]`. Nonkeyed ibtool dictionary IDs
and native NIBArchive IDs keep their existing source-specific meaning.
Connector endpoints require encoded UID references to archived objects; strings
and dictionaries that merely resemble resolved reference stubs do not establish
identity. Inline hierarchy dictionaries have no table identity and count as
omitted references, while independently referenced children remain available.
The UID identity rule follows the
[Foundation unarchiver's table lookup](https://github.com/swiftlang/swift-corelibs-foundation/blob/28249ced079d8e7ec03b821c039bf9868738c3fc/Sources/Foundation/NSKeyedUnarchiver.swift#L213-L223).
UIKit keyed nibs select their explicitly named
`UINibTopLevelObjectsKey` collection; generic `root` is used when that named key
is absent. Unsupported or dangling named roots remain incomplete rather than
falling back to another collection. The key spelling follows the independent
[WinObjC UINib reader](https://github.com/microsoft/WinObjC/blob/94f6b5bfdc09d945e30607b56124b6f94a5b9d7b/Frameworks/UIKit/UINib.mm#L104-L109).

NIBArchive float32 and float64 values retain non-finite values and negative zero
through projection as the same typed real wrappers used for plist values; per-document limitations
count those values. NIBArchive nil remains JSON null.

Dates are reported as `{ "$plist_type": "date", "iso8601": "<timestamp>" }`.
XML dates require a complete UTC spelling with fixed two-digit month, day and
time fields; short, negative and extended years are interpreted as UTC year
fields within JavaScript's date range. Unsupported calendar fields (including
leap seconds) and out-of-range dates remain explicit unknowns. REA does not
emulate CoreFoundation's normalization of overflowing calendar fields. Invalid
dates returned by other decoders retain `{ "$plist_type": "date", "iso8601": null }`
with a counted limitation. `inspect_plist` and Interface Builder decoding use
the same projection. Binary plist decoding refuses a reachable date whose marker
is not `0x33`; date and numeric payloads must end before the offset table.
Valid overlapping object records retain their independent source values. A valid `0x33` date is
reported with an ISO-8601 timestamp only when its float64 seconds are exactly
the canonical encoding of that millisecond instant. Any other finite binary
date uses `{ "$plist_type": "date", "iso8601": null }` and the counted
limitation; the archive bytes remain the source of the instant.

A negative-zero real is reported as `{ "$plist_type": "real", "value": "-0" }`
because a JSON number cannot carry the sign of zero. `inspect_plist` and
`inspect_keyed_archive` count these values in a limitation, and Interface
Builder node attributes use the same value. Positive zero and integer zero,
including an `<integer>-0</integer>` literal, remain the number `0`.

Known non-finite reals are reported as
`{ "$plist_type": "real", "value": "nan" | "+infinity" | "-infinity" }`.
These are canonical numeric labels, not a claim about original source spelling.
Binary IEEE reals retain NaN versus signed infinity; NaN payload bits and sign
are not represented in the JSON value, and the original bytes remain the source
for those details. XML CFPropertyList literals (`nan`, `+infinity`, `-infinity`,
`infinity`, `inf`, `+inf`, `-inf`, case-insensitively) decode to the same known
values. Case and aliases normalize; original archive bytes retain source text.

XML scalars whose identity cannot be established use
`{ "$plist_type": "unknown", "element": "integer" | "real" | "date" | "true" | "false", "literal": "<original content>", "reason": "invalid-literal" | "unsupported-markup" | "unrepresentable" }`.
A counted limitation accompanies these wrappers. Literal content retains its
original entity spelling, markup and line endings. Whole XML documents must
still pass strict well-formedness checks. Empty integer, real and date elements
are unknown scalars; boolean elements must be empty. Complete decimal/exponent
reals and signed decimal/hexadecimal integers accept their respective native
leading whitespace but reject trailing text. Arbitrary-precision integers
remain an intentional REA extension beyond CoreFoundation's integer range.
Finite real spellings that overflow the numeric representation remain unknown,
rather than becoming observed infinities. Known non-finite and unresolved scalar
values have separate counts. This replaces the former prefix-number and
incomplete-metadata fallback for malformed XML numeric content. Native
`inspect_plist` uses the same projection for plutil's XML conversion.

## Locate a byte signature

Use `search_bytes` after opening a target with Ghidra to locate a known constant
or instruction sequence. For example, `{"pattern":"48 8B ?? ?? 89","limit":100}`
returns ordered addresses with segments, source file offsets and containing
procedures. The CLI equivalent is
`rea search-bytes ./program '48 8B ?? ?? 89' --provider ghidra`.
Use `start`/`end` to constrain the inclusive address window, and continue with
`next_cursor` until `complete` is true. Inspect `searched` for page coverage and
skipped uninitialized blocks. A missing match does not establish absence from
uninitialized memory or across block boundaries. See
[Ghidra byte search](ghidra-provider.md#masked-byte-search) for mask and coverage
semantics. This query never executes or modifies target bytes.

Exact-name xref lookup reports distinct candidate addresses as an input ambiguity;
inventory order cannot select one silently. Duplicate rows at one address remain
a singular match, and a missing name remains an unresolved observation.

Hopper procedure names must identify a procedure entry. A non-entry symbol returns
an input diagnostic with its coordinate and containing procedure; an explicit
numeric address still selects its containing procedure. Use
`resolve_containing_procedure` to request containment directly. IDA and Hopper
reject reserved `file-offset:` selectors before name lookup; source-file offset
selection belongs to the Ghidra import mapping.

Native function names carry observed symbol metadata where available. Ghidra uses
its function symbol's source and dynamic flags; Hopper and IDA leave origin
unknown because this adapter has no verified origin API. Comparison and matching
cannot use unknown labels as cross-artifact identity, even when their spelling
looks meaningful. Original labels remain in Evidence. This qualification does not
change address equality in a known common native coordinate context.
