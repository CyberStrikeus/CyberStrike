# Optional NativeAOT metadata recovery

REA has a built-in read-only snapshot parser for x64 PE targets with .NET 8 RTR
9.1 metadata. It parses the exact admitted Ghidra session snapshot and uses an
in-memory overlay for rehydrated metadata; it does not define Ghidra DataTypes,
labels, functions, or memory bytes. The hydration semantics are adapted from
[Washi1337/ghidra-nativeaot](https://github.com/Washi1337/ghidra-nativeaot) at
`effeb734fc570c32650f88b159608979dc7b423e` (MIT), cross-checked against
.NET's `MethodTable.h` at runtime commit
`a3b2d40328be0be3f8dd43f0e5cc925b8827b044` (MIT). The required notice ships in
[`licenses/nativeaot-parser-MIT.txt`](../licenses/nativeaot-parser-MIT.txt).

The optional headless Ghidra adapter remains available for database annotations
and broader recovery. It uses the same pinned upstream commit as an opt-in
submodule and is a separate, more capable workflow.

The parser currently handles x64 PE32+ and RTR 9.1, including bounded
DEHYDRATED_DATA processing, MethodTable relationships, virtual slots, and
frozen strings. Other RTR versions and PE architectures are reported as
unsupported or partial. The matching .NET 8.0.22 fixture is source-built.

On a Windows host, Windows Ghidra P0 runs the parser without a JAR. Metadata,
MethodTable relationships, virtual slots and frozen strings come from the
parser report, and `analyze_function` decompiles slot targets. Tools that read
the Ghidra database do not see rehydrated bytes (see below), because only the
optional adapter writes them into the database and Windows Ghidra P0 has no
database mutation authority. A PE/CLI or ReadyToRun
assembly should use `inspect_managed_artifact`; it is not NativeAOT.

## Build and configure

Bring your own supported Ghidra/JDK installation. This developer build needs
existing `git`, `javac` and `jar`; it does not invoke Gradle, download toolchains,
or change host configuration:

```sh
git submodule update --init third_party/ghidra-nativeaot
npm run build:ghidra:nativeaot
export REA_GHIDRA_NATIVEAOT_JAR="$PWD/_reference/nativeaot-integration/extension/rea-ghidra-nativeaot.jar"
```

The build requires a clean pinned upstream checkout, compiles unchanged upstream
Java plus the REA facade, uses a fresh classes directory, and writes the JAR and
build manifest under ignored `_reference/`. `REA_NATIVEAOT_BUILD_ROOT` can select
another local output directory; `REA_NATIVEAOT_SOURCE` can select an equivalent
clean pinned source checkout. Neither output nor compiled fixture belongs in Git
or the npm package. An installed REA accepts an existing explicitly supplied JAR.

REA commits the actual JAR SHA-256 into the analysis profile, copies identical
bytes into the owned runtime, rechecks the digest before loading, and closes the
classloader/project on session close. Profiles cannot enable code absent from
explicit local configuration. JARs execute within Ghidra; supply a build you trust.
The producer's reported source revision is build metadata, not an attestation of
arbitrary caller-supplied bytes. The bounded loader accepts regular JARs up to
8 MiB to limit startup artifact memory; this does not truncate analysis results.

## Use existing tools

Open the executable with provider `ghidra`. For an x64 PE, `inspect_native_load_image`
returns `observations.metadata_recovery` inline from the captured source snapshot,
including the RTR header, MethodTable addresses, frozen strings, derived overlay
identity, and examined/recovered counts. Its enclosing `unsupported` load-image
status means independent PE load-image verification was not performed; it does
not mean the metadata parser failed or the executable failed to load. Without
the optional adapter, each recovered type's `type` is `null`, because no Ghidra
DataType exists; select it by `address`.

Pass a returned MethodTable address to `inspect_native_data_type`. A direct PE
query also derives the snapshot metadata from the authenticated Ghidra session
handshake, so it does not require a preceding load-image call. In a persistent
MCP session, load-image followed by type inspection reuses that same derivation.
The bridge resolves the caller's address spelling once; metadata lookup uses
its canonical default-space identity. Bare hexadecimal, prefixed hexadecimal,
and encoded default-space selectors therefore select the same MethodTable.
Other address spaces and unresolved identities are not matched by offset alone.
Metadata already supplied by the engine is retained without reading or deriving
an additional source snapshot.
The database result remains `unavailable` when Ghidra has no DataType at that
address; its `metadata_recovery.source` is `read-only-derived-overlay` and
carries related type, interface, slot, and target observations. Generated
address identities do not claim original managed names. The parser does not
merge frozen literals into Ghidra's database string inventory: read them from
`metadata_recovery.frozen_strings`, not `search_strings`. Slot targets come
from the parser report; on Windows P0 without the adapter, a `read_bytes` of
a slot in the rehydrated region returns no bytes. The Linux adapter route
verifies a complete slot read and its target. Follow slot targets with `analyze_function` and ordinary
cross-references.

The built-in CLI path uses a MethodTable address returned by the parser or
another observation:

```sh
rea inspect-native-load-image ./NativeAotFixture --provider ghidra --json
rea inspect-native-data-type ./NativeAotFixture --address 0xMETHODTABLE_ADDRESS --provider ghidra --json
rea function ./NativeAotFixture 0xADDRESS --provider ghidra --json
```

The generated `/NativeAOT/...` category path belongs to the optional headless
adapter. Use `--type /NativeAOT/MethodTables/Class_ADDRESS_MT` only when that
adapter is configured and has created the corresponding Ghidra DataType.
Built-in PE analysis includes its parser contract and resource policy in the
Ghidra analysis profile; non-PE profiles do not include that contract.

## Evidence boundaries

The built-in parser uses an initialized non-executable PE signature scan and
requires a unique RTR 9.1 header and exactly one DEHYDRATED_DATA row. Rehydrated
bytes live only in a parser-owned overlay, identified by virtual address, size,
and SHA-256; the caller's source Buffer remains unchanged. Limits derive from
captured section extents and format field bounds. Separate resource policies
admit up to 128 MiB of captured PE bytes, 64 MiB-equivalent parser work, 64 MiB
of exact parser-owned overlay/index storage, and 4 MiB of serialized NativeAOT
report JSON. These are local parser limits, independent of MCP delivery; the
buffer counter does not claim to cap V8 heap or total process memory. Rows that
do not fit the report budget are omitted with explicit partial status and
coverage. Coverage counts describe the pointer scan, recovered MethodTables,
and frozen-string candidates examined, not every possible runtime type or
object. Cancellation is honored during snapshot I/O and checked immediately
before and after parsing; the synchronous parser call itself is bounded but
cannot be interrupted mid-call. Parser output never claims that a Ghidra
database type was defined.

RTR signature omission counts include every eligible section before the work
budget is spent, including later sections that were never visited. MethodTable
closure indexes each validated table's related pointer once and visits a work
queue for inheritance and interface reachability. Its temporary index and queue
consume the existing working-memory budget; the parser does not increase its
work limit. Candidate headers/counts are parsed once; unmapped table bodies are
rejected before charging table entries, and validation charges only each slot or
interface pointer actually examined. Declared counts and unvisited tails do not
become examined coverage. Discovery still must finish before claiming a unique System.Object
root, so a discovery budget stop can return zero recovered tables without
establishing their absence. Performance on the large bflat report has not been
measured. Indexed closure and candidate validation avoid separate repeated or
unperformed work, but do not establish that the fixed discovery budget admits
that artifact. Budget stops remain partial results with unknown type absence.

If captured snapshot bytes no longer match their admitted digest, the parser
retains both digests and the Ghidra owner reports `artifact_changed`, with the
captured byte count and admitted identity still available. Reopen acquisition
against a stable artifact; this is distinct from corrupted retained Evidence.

The optional adapter performs its annotations in an ephemeral Program
transaction. That workflow may change analysis-memory bytes, never the original
executable file. It is unavailable on Windows P0, which has no database
mutation authority.

REA preserves pre-recovery calling conventions and uses the loaded compiler
specification default for newly created methods. The upstream universal
`__thiscall` assignment is not treated as x64 ABI authority. Parameters and
method prototypes remain inferences; verify them against instructions/call sites.

Type relationships and System.Object/System.String identification use upstream
heuristics. Generated names are explicitly marked; original class/member names
and custom field layouts remain unknown. Pseudocode is recovered native logic,
not original C# source. Unsupported recovery reports its stage and reason; it
does not imply that ordinary native disassembly/decompilation is impossible.

## Verification

See [the dedicated lane](testing.md#optional-nativeaot-ghidra-analysis).
Fixtures are source-built benign .NET programs with inheritance, an interface,
virtual dispatch, representative arithmetic and frozen strings. Independent
compiler/linker symbols and raw directory bytes provide the oracle. Stripped
fixtures exercise heuristic detection. Tests do not execute the resulting
NativeAOT binaries. Fixture generation and adapter compilation are optional and
never prerequisites of ordinary native analysis or setup.

The real MCP lane runs only on a Linux x64 host with the adapter. The
Windows-host behavior above was checked manually over MCP on Windows 11 x64
(non-elevated, Ghidra 12.1.4, JDK 21, no JAR) with the source-built win-x64
symbols fixture. The format, RTR version and frozen strings matched the fixture
oracle; the derived MethodTable, its base type, its interface and a virtual
slot reaching the overridden method matched the linker map; and pseudocode was
readable. No CI lane repeats this check.
