# CLI and Evidence

Use the CLI for a direct inspection or a script. It uses the same application
workflows and evidence contracts as REA's MCP server. Each CLI invocation is a
separate process; save results when you want to use them in a later command.
For a pinned, noninteractive workflow with retained reports, see
[static analysis in GitHub Actions](ci-analysis.md).

## Run a command

After [installing REA](installation.md), use `rea`. You can also run a command
without a global installation:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Use an extracted application directory or an ASAR as the target. Static
JavaScript analysis returns the application graph and Evidence directly.
Generic `rea analyze PATH` selects this workflow for directories and `.asar`
files when neither `--provider` nor `--snapshot` is supplied. See
[JavaScript artifact reconstruction](javascript-artifact-reconstruction.md)
for results, integrity checks and coverage.

The complete application Evidence can be hundreds of megabytes for a real
application. When an agent or a person reads the result, save it to a file and
project a summary, a module page or one module from the saved Evidence:

```bash
rea analyze-javascript-application /absolute/path/to/app --json > app-evidence.json
jq -c '{source: {kind: "inline", evidence: .}, view: {kind: "summary"}}' app-evidence.json > app-view.json
rea inspect-analysis-view app-view.json
```

The request can also name the saved file instead of embedding it:
`{"source": {"kind": "evidence-file", "path": "app-evidence.json"}, "view": {"kind": "summary"}}`.
The CLI resolves a relative path against the working directory; MCP clients
pass an absolute path. REA reads and authenticates the file, then projects it
like retained Evidence, so a large file is bounded by the file reader rather
than charged as inline input.

Local file inspection commands reject empty paths and NUL bytes before resolving
relative inputs, auxiliary files or output destinations. An empty string never
selects the working directory; use an explicit `.` when selecting that directory
is supported by the command.

For example, a 334 MB Obsidian application Evidence file yields a summary view
of about 10 KB. Replace the view with
`{"kind": "page", "collection": "modules", "offset": 0, "limit": 32}` for a
module page. See
[JavaScript application workflows](javascript-application-workflows.md) for
views, feature traces and comparisons that take the same saved Evidence.

Add `--timings` to a command to write one JSON timing record to stderr. For
example, `rea inspect-elf-notes program --json --timings > result.json` keeps
stdout as a parseable result and writes
`{"rea_timings":{"version":1,"command_ms":42}}` to stderr. `command_ms`
measures CLI command dispatch and result delivery; it is not provider-only or
analysis-only time. The flag is off by default, and the record omits stages
that REA did not measure. Root version reporting does not dispatch a command
and has no command timing record.

## JSON Lines record output

Use `--format jsonl` to consume row-oriented results one record per line:

```bash
cat > observations-view.json <<'JSON'
{"source":{"kind":"evidence-file","path":"app-evidence.json"},"view":{"kind":"javascript-facts","property_keys":[],"offset":0,"limit":32}}
JSON
rea inspect-analysis-view observations-view.json --format jsonl > observations.jsonl
```

This request selects up to 32 observation identities and their provenance,
without observation property values.

This changes JSONL object-collection framing. Scripts that need one complete
report or a scalar field should use `--format json`. For a full application
graph, first project a supported analysis view rather than selecting an
arbitrary nested graph array.

A top-level array emits its elements in source order. An object must have one
clear `rows`, `items`, `records`, or `occurrences` array, directly or under
`page`. Evidence uses the same boundaries inside `normalized_result`.
Any other selection is refused before a record is written, including an
arbitrary report, a scalar, a nested array elsewhere, and a columnar object such
as the `inspect-sqlite-database --table` `normalized_result.rows`
(`{columns, values}`). The refusal is the caller error `invalid_request`
(`invalid_input`) and names the selection and its observed shape; the analysis
itself succeeded, so use `--format json` for the complete document. If several
collections exist, select one with `--filter-output`, for example
`normalized_result.rows` for an analysis view.

Object collections finish with a control record:

```json
{
  "$rea": "jsonl/v1",
  "type": "metadata",
  "records": {
    "path": ["normalized_result", "rows"],
    "emitted": 2,
    "source": 10,
    "filter": "normalized_result.rows[0,2]"
  },
  "context": {
    "evidence_id": "ev_…",
    "normalized_result": {
      "coverage": {
        "status": "page",
        "examined": 10,
        "total": 100,
        "next_offset": 10,
        "exhausted": false
      }
    }
  }
}
```

This abbreviated example illustrates framing. The actual `context` preserves
all non-row fields, including Evidence subject, provider, authority, confidence,
locations, links, limitations, parent/view digests, pagination and coverage.
With `--full-output`, it also retains the command envelope and its metadata.
A data filter selects row fields/slices while this context remains available;
excluded peer record collections and unselected Evidence `raw_result` are not
restored. An explicitly selected `raw_result` remains selected. Retain the
original Evidence for complete observations.

`records.emitted` and `records.source` count the selected output and its source
array; they do not assert analysis completeness. Source coverage and unknowns
retain their original meaning. Existing row identities and indices remain
unchanged unless your field selection excludes them. Empty object collections
still emit metadata; an empty top-level array emits no lines. Bare top-level
arrays have no synthetic coverage record.

Command and output-validation failures emit `{"$rea":"jsonl/v1","type":"error","ok":false,"result":…}`
and retain the original diagnostic payload. SDK validation/sentinel errors use
the SDK's exit status rather than guessing from data fields. `$rea` is reserved
at the top level of a data record, so control records are unambiguous; collisions
are refused before rows are written. Nested `$rea` values are ordinary data.
A missing final metadata record or nonzero exit can indicate an interrupted
export; do not treat already emitted rows as a complete result.

`--token-count` estimates this exact representation, including metadata, one
line at a time. Errors remain error records even with token counting enabled.
Token windows cannot preserve JSON Lines and are rejected. JSON encoding and
stdout writes are incremental, including large escaped strings; this is output
streaming over a completed result, not incremental analysis. The analysis still
needs its normal resources. A single record must fit the runtime string limit
for token estimation; remove `--token-count` to stream a larger record.

Standalone version and MCP doctor diagnostics remain single JSON documents
in JSON Lines mode. Incur's streaming generator events and successful sentinel
responses retain their SDK protocol. MCP application results and Evidence
contracts are unchanged.

## Shell completion

The CLI includes optional shell completion. Run `rea completions --help` to
see the available shells and their setup commands. For Bash, load the hook
into the current shell:

```bash
eval "$(rea completions bash)"
```

For zsh, initialize completion before loading the hook. If your shell already
runs `compinit`, place the hook after that existing initialization:

```zsh
autoload -Uz compinit
compinit
eval "$(rea completions zsh)"
```

The Bash hook supports macOS system Bash 3.2. It uses optional completion
features when the shell provides them and falls back to portable registration.
Completion includes standard global options and the active command's options;
`rea mcp ` offers only `add` and `doctor`. Output-option values remain data when
resolving the command scope.

For future interactive non-login Bash sessions, add the command to
`~/.bashrc`. Interactive login Bash sessions read the first available file in
`~/.bash_profile`, `~/.bash_login`, and `~/.profile`; add the command to the
file your shell reads, or have that file source `~/.bashrc`. Remove the command
from the startup file to stop loading completion, and run `complete -r rea` to
remove the registration from the current shell. These are manual, opt-in
steps.
Completion is a discovery aid; use `rea COMMAND --help` to confirm the
available options and subcommands.

## Managed assemblies (.NET)

For a .NET PE/CLI assembly, inspect its identity and deployment form before
inspecting members. These commands read metadata and Common Intermediate
Language (CIL) without loading or executing the assembly and require no native
analysis engine:

```bash
rea inspect-managed-artifact /absolute/path/Assembly.dll --json
rea inspect-managed-members /absolute/path/Assembly.dll --json
rea inspect-managed-members /absolute/path/Assembly.dll --type Example.Parser --json
```

Replace `Example.Parser` with an exact `full_name` from the member inspection,
or a declaring type name you already know. Omit `--type` to inspect all members,
or repeat it to select several types.
Selection limits decoding to the selected types; member references remain an
assembly-wide inventory, so the output can still be large.

Select `--detail summary --evidence-bundle /absolute/path/members.json` to
receive identity, selection, coverage, limitations and collection counts while
saving the complete original Evidence in a new bundle. Summary requires that
explicit destination; existing files are preserved. Later
`inspect-analysis-view` calls can page the exact parent from the saved bundle
without reopening the assembly. See
[CLI summary and saved member rows](managed-code-analysis.md#cli-summary-and-saved-member-rows)
for the complete command sequence. Omitted or `--detail complete` retains the
full inline response.

Choose the workflow from the artifact's contents rather than its `.exe` or
`.dll` extension. The managed parser requires PE/CLI metadata; it does not
unpack .NET single-file hosts or decode IL2CPP. For the image, type and method
names in a Unity `global-metadata.dat`, use
[IL2CPP metadata](il2cpp-metadata.md). NativeAOT method bodies require native
analysis. See the [managed-code guide](managed-code-analysis.md)
for supported deployment forms, selection semantics, and coverage limits.

## SQLite snapshots

For a local database snapshot, use `rea inspect-sqlite-database PATH --json`.
Add `--table NAME --row-limit 20` to read a bounded sample from an ordinary
table. This command does not require a native analysis provider. See
[SQLite database snapshots](sqlite-databases.md) for database/WAL identity,
source-file handling and row-value semantics.

## Native analysis

Inspect embedded Go build metadata without installing Go or configuring a
disassembler:

```bash
rea inspect-go-binary /absolute/path/to/program --json
```

The shared CLI/MCP workflow reports compiler version, modules, replacements,
build settings, original bytes and SHA-256. See [Go binaries](go-binaries.md)
for supported containers and absent or malformed metadata.

Inspect a Godot PCK without running the game:

```sh
rea inspect-artifact game.pck --detail summary --evidence_output evidence.json --json
rea extract-artifact game.pck --json
```

Formats 2, 3 and 4 retain header, directory and integrity facts. Compact delivery
keeps complete Evidence in the requested bundle. See [Godot PCK](godot-pck.md)
for embedded packs, batch queries and unknown encrypted coverage.

Inspect a UnityFS AssetBundle without running Unity:

```sh
rea inspect-artifact content.bundle --detail summary --evidence_output evidence.json --json
rea extract-artifact content.bundle --json
```

Format versions 6 through 8 retain header, block and directory facts with
none/LZ4/LZ4HC block decompression. See [UnityFS](unityfs.md) for encryption
and LZMA coverage boundaries.

Inspect an ESP32-family app or bootloader image without esptool:

```sh
rea inspect-artifact firmware.bin --json
rea extract-artifact firmware.bin --json
```

The inventory lists each segment with its ESP-IDF load classification, the
checksum and SHA-256 results, the descriptor and any Secure Boot v2 signature
blocks. See [ESP images](esp-image.md) for recognition, coverage and refusals.

Inspect an ESP flash dump, or one read from a flash address other than 0:

```sh
rea inspect-artifact flash.bin --json
rea inspect-artifact dump.bin --target-format esp-flash-image --flash-offset 0x1000 --json
rea extract-artifact flash.bin --json
```

The inventory lists the bootloader, the partition table and each partition,
with ESP image facts for app partitions and the OTA records. See
[ESP flash images](esp-flash-image.md) for table location, inputs and limits.

Inspect a Node.js SEA carrier without running it:

```sh
rea inspect-artifact ./application --json
rea extract-artifact ./application --json
```

See [Node.js SEA](node-sea.md) for supported layouts, script and asset paths,
fuse observations, and the real-fixture verification lane.

Inventory and extract Intel HEX or S-record regions:

```sh
rea inspect-artifact ./firmware.hex --json
rea extract-artifact ./firmware.hex --json
```

See [Intel HEX and S-record images](hex-records.md) for recognition, region
names, metadata and limits.

Inspect and extract stored U-Boot legacy uImage payloads and components:

```sh
rea inspect-artifact ./firmware.bin --detail summary --evidence_output firmware.json --json
rea extract-artifact ./firmware.bin --json
```

See [U-Boot uImage](uimage.md) for verified CRCs, physical component ranges,
unknown names, resource limits and retained views. Compressed bytes stay stored.

`inspect-artifact` and `extract-artifact` also read ZIP members compressed with
Zstandard (standard method 93). They retain the shared ZIP CRC, declared-size,
overlap and archive expansion checks. The native streaming decoder keeps the
existing 128 MiB Zstandard window cap; frames requiring a larger window are
refused. Deprecated method 20 and other unregistered ZIP codecs remain unsupported.

Inventory and extract UF2 or DfuSe regions:

```sh
rea inspect-artifact ./firmware.uf2 --json
rea extract-artifact ./firmware.dfu --json
```

See [UF2 and DfuSe images](uf2-dfuse.md) for recognition, families, numbering,
the DfuSe suffix CRC and limits.

Inventory and extract U-Boot FIT images:

```sh
rea inspect-artifact ./boot.itb --json
rea extract-artifact ./boot.itb --json
```

See [U-Boot FIT images](fit-images.md) for recognition, data sources, hashes
and limits.

Inspect local model declarations without loading weights:

```bash
rea inspect-model-artifact /absolute/path/model.gguf --json
rea inspect-model-artifact /absolute/path/model.safetensors --hash full --json
```

Default hashing reads only headers and leaves full-file identity unknown.
`--hash full` streams the complete file for SHA-256. Both return typed metadata,
original tensor declarations and derived totals. MCP summaries retain complete
Evidence for filtered metadata, tensor and type-total pages; CLI compact delivery
uses `--detail summary --evidence_output FILE`. See [model files](model-artifacts.md).

Inspect Unity IL2CPP metadata names without Unity or a disassembler:

```bash
rea inspect-il2cpp-metadata /absolute/path/global-metadata.dat --json
```

The command decodes a version 24, 27, 29, 31 or 39 `global-metadata.dat` and reports assembly
images, type, method and member names, string literals, index ranges, header
sections and SHA-256. With `--binary PATH` it also reads the matching
`GameAssembly.dylib`, `GameAssembly.dll` or `libil2cpp.so` (never runs it) and
links each method to its code address; `--generic-instances` adds generic
method instances and `--ghidra-seeds PATH` then writes Ghidra function seeds. It does not decrypt metadata. MCP defaults to compact counts
with retained Evidence; query indexed rows with filters, batch indices and
selected fields. The CLI defaults to complete Evidence;
`--detail summary --evidence_output FILE` exports the full result to a new file
and returns a compact overview. See [IL2CPP metadata](il2cpp-metadata.md).

Inspect an embedded cargo-auditable Rust dependency list without installing
Rust or configuring a disassembler:

```bash
rea inspect-rust-binary /absolute/path/to/program --json
```

The same workflow reports package names, versions, sources, the root package,
dependency edges, and the section's file range. A missing `.dep-v0` section is
null metadata, not proof that the binary has no dependencies. See
[Rust binaries](rust-binaries.md).

Inspect a PE Authenticode certificate table without executing the image or
verifying signatures:

```bash
rea inspect-pe-certificates /absolute/path/to/application.exe --json
```

The workflow reports `WIN_CERTIFICATE` entries and, for PKCS#7 signedData,
embedded X.509 serial, issuer, subject, and validity fields. A missing security
directory is observed absence of that table. See
[PE Authenticode certificate tables](pe-certificates.md).

Inspect PE import and delay-load tables without executing the image:

```bash
rea inspect-pe-imports /absolute/path/to/application.exe --json
```

The workflow reports DLL names, named and ordinal functions, delay-load
descriptors, and a pefile-compatible import hash of the standard import table.
A missing import directory is observed absence of that table. See
[PE import and delay-load tables](pe-imports.md).

Inspect ELF PT_NOTE and SHT_NOTE tables without executing the image:

```bash
rea inspect-elf-notes /absolute/path/to/program --json
```

The workflow reports note owners, types, descriptor hashes, and GNU build-id
or ABI-tag fields when those descriptors match. A missing note table is
observed absence of those declarations. See [ELF note tables](elf-notes.md).

Inspect an Apple `.ips` crash report without executing a target:

```bash
rea inspect-apple-ips /absolute/path/to/report.ips --json
```

The workflow reports first-line metadata, process/exception/termination facts,
threads, usedImages, lossless integer registers, and documented crash classes
when `bug_type` is `"309"`. Other DiagnosticReports types return no crash
result. See [Apple IPS crash reports](apple-ips.md).
Inspect Linux kernel module metadata without executing the module or requiring
`modinfo`:

```bash
rea inspect-kernel-module /absolute/path/to/module.ko --json
```

The workflow reports ordered `.modinfo` keys (duplicate `alias` and `parm`
entries preserved), `__versions` symbol CRCs, presence of
`.gnu.linkonce.this_module` and `__ksymtab` sections, observed `.init.text`
and `.exit.text` sizes, and an appended signature trailer. `struct module` is
not decoded and the signature is not validated. Other ELF types are not
applicable. gzip, xz, and zstd containers are unsupported and name
`external_decompression` as the next probe: decompress with an external
utility, then inspect the decompressed file. See
[Linux kernel modules](kernel-modules.md).

Inspect a CPython 3.7–3.13 `.pyc` header and nested marshal code objects
without executing bytecode or installing Python:

```bash
rea inspect-python-pyc /absolute/path/to/module.pyc --json
```

The workflow reports the pinned CPython version for the magic, PEP 552 hash or
mtime/size fields, nested function names, and bytecode SHA-256. Bytecode is
not decompiled. See [CPython pyc inspection](python-pyc.md).

Inspect an Erlang BEAM file without executing bytecode:

```bash
rea inspect-erlang-beam /absolute/path/to/app.beam --json
```

The workflow reports IFF chunk names, atom tables, exports, imports, lambdas,
and the Code chunk header. Missing optional tables stay null. See
[Erlang BEAM files](erlang-beam.md).

Configure [Hopper or Ghidra](installation.md#hopper), the
[IDA adapter](ida-provider.md), or [Kuna](kuna-provider.md) before analyzing a
native target. Substitute
your target, search text and function name or address in these examples:

```bash
rea analyze /absolute/path/to/program --provider ghidra --json
rea search /absolute/path/to/program "search" --provider ghidra --json
rea function /absolute/path/to/program main --provider ghidra --json
rea decompile /absolute/path/to/program 0x1000 --provider ghidra --json
rea xrefs /absolute/path/to/program 0x1000 --provider ghidra --json
rea trace /absolute/path/to/program "search" --provider ghidra --json
```

`analyze` and `inspect` share the native overview workflow. `function` returns
a function dossier; `decompile` returns pseudocode. For assembly instructions
alone, use `rea instructions`. A macOS `.app` bundle can be supplied directly.

A complete dossier can reach several megabytes of value-flow and references.
`rea function ... --detail summary --evidence_output /absolute/path/dossier.json` returns the
compact summary and saves the complete dossier as an Evidence bundle, never
overwriting an existing file. Page that bundle without reanalysis by naming it
as an `inspect-analysis-view` source, selecting the summary's
`normalized_result.parent_evidence_id` when the bundle holds several records:
`{"source": {"kind": "evidence-file", "path": "/absolute/path/dossier.json", "evidence_id": "ev_…"}, "view": {"kind": "native", "facet": "pseudocode", "offset": 0, "limit": 4096}}`.
MCP `analyze_function` defaults to the same summary and retains the complete
dossier in the session for `inspect_analysis_view`.

Run `rea --help` or a command's `--help` for arguments and output options.
The [generated catalog](mcp-contracts.md#generated-catalog) lists all CLI commands and MCP
tools. Provider-specific target support is described in the
[native guide](native-investigation.md), [DOS guide](ghidra-dos.md),
[raw binary guide](raw-binary.md), [GameCube DOL guide](ghidra-dol.md), and
[Windows Ghidra guide](windows-ghidra-p0.md).

## Choose a provider

List the available providers and their supported operations:

```bash
rea providers --json
rea capabilities --json
```

These commands describe binary-session providers and auxiliary capabilities.
For the complete MCP surface, use the connected server's tool list and the
session's advertised availability; individual guides describe prerequisites.

With automatic selection, REA uses the single available provider that supports
the target. When several providers support it, select one explicitly:

```bash
rea analyze /absolute/path/to/program --provider hopper
```

Set `REA_ANALYSIS_PROVIDER` for a standing preference. An explicit `--provider`
overrides it. In MCP, pass `provider_id` to `open_binary`:

```json
{
  "path": "/absolute/path/to/program",
  "provider_id": "hopper"
}
```

The selected provider remains bound to the session until an explicit switch
or close. Provider failures are returned with their original reason. For an
`ambiguous` selection error, choose from `details.candidate_ids`; for
`provider_unavailable`, follow `message`, `remediation.action`, and the original
reasons in `details.rejections`. Each rejection names its `origin`: `availability`
entries describe local readiness failures, including missing configuration or an
invalid existing registration; they do not establish target support. `target`
entries record a refused kind, format, architecture, or role. An availability-only
message describes the recorded rejections without claiming that every provider
is unconfigured or that target support is known.
For Hopper, Ghidra, IDA, JADX, and Kuna, run
`rea doctor --provider ID --json` to diagnose the selected engine. Other adapters,
such as `pwntools-elf`, report their configuration requirements directly and are
not accepted by `doctor --provider`. See
[task readiness](installation.md#check-readiness-for-your-task) and
[provider selection](mcp-contracts.md#identity-and-discovery).

The session reports work still in progress through `analysis_activity`.
A client timeout can end its wait while the provider continues analyzing.
`cleanup_incomplete` identifies resources whose shutdown or removal could not
be verified. See [MCP contracts](mcp-contracts.md) for session lifecycle and
[Ghidra first-query deadlines](mcp-contracts.md#ghidra-first-query-deadlines-and-recovery)
for import, client timeouts and recovery.

If one-shot analysis fails and closing its session also fails, the original
error details remain inline and `details.cleanup_error` describes the later
close failure. Each diagnostic retains its own reported resources; the later
failure does not establish whether an earlier resource was released. Captured
output and partial observations remain in the original details.

## Save and reuse analysis snapshots

A snapshot retains successful analysis results for later queries. REA reuses
an exact result when the target bytes, operation, parameters, provider and
settings match. Mutations and cursor-dependent calls are excluded from the
cache. Snapshot files are local and use owner-only permissions.

One-shot binary CLI Evidence reports the exact path argument in `caller_input_path`,
including relative spelling and symlink aliases. Its subject identifies the
inspected artifact; `caller_input_path` does not change the Evidence ID or
snapshot query. A replay reports the current invocation's path while leaving
the saved Evidence unchanged. Provider inspections continue to include the
established `parameters.input_path` field.

Importing an Evidence bundle refreshes retained request and subject display metadata.
It preserves cached analysis results, including observations for other targets.
Snapshot bindings that use a replaced record retain its updated display path.

Dispatching a provider metadata write invalidates the active session's snapshot cache,
even if its reply fails: the provider may already have applied the write.
Close and reopen the target before importing or saving another snapshot.

Saved snapshots include only cache entries whose subject identifies the selected
target. Unbound observations and observations of child artifacts remain available
in the open session and its Evidence bundle; they are excluded from the target's
saved replay entries without changing their subjects.

Snapshots retain eligible target-scoped question histories in full, including
mutation Evidence recorded while another target was active. Observations and
related questions must still belong to the saved target. If those dependencies
cannot be retained, the entire history is excluded instead of reverting the
question to an earlier revision or disposition.

```bash
rea analyze /absolute/path/to/program --provider ghidra --snapshot /absolute/path/to/analysis/program.json
# Repeat the same query to reuse its saved result.
rea analyze /absolute/path/to/program --provider ghidra --snapshot /absolute/path/to/analysis/program.json
```

An exact CLI cache hit is normally read before starting a provider process.
On Windows, Ghidra first admits the selected source through its native snapshot
owner, so replay can start that provider.
In MCP, `open_binary` accepts `snapshot_path` to import a snapshot atomically
for its matching target; an MCP provider may still start before returning a
cached result. `close_binary` accepts `snapshot_path` and optional
`overwrite: true` to save before releasing provider resources. A failed save
leaves the session open so the caller can resolve the output failure.

If a selected snapshot's file descriptor cannot close, `open_binary` reports
`cleanup_incomplete`. `binary_session` reports `cleanup_pending` even when no
target opened. Retry `close_binary` to release the retained descriptor before
opening another target.

If a snapshot switch fails after the previous target was retired, restoration
keeps that target's analysis commitments with the replacement client. This
includes the native dispatch workflow profile on a profileless route, so its
existing snapshot and fresh observations retain the same provenance.

For native dispatch, the snapshot binding retains the reader profile; workflow
Evidence and `workflow_entries` retain the composed profile, which commits that
reader and the workflow's analysis caveats. Restoration preserves both profiles.

The MCP save receipt reports `primitive_entries`, `workflow_entries`, and
`evidence_records` separately. Zero primitive bindings can still accompany retained workflow
results and Evidence. These are cached observations, not a saved provider
database: only eligible exact queries can reuse a result, and new or live
queries can still require provider startup. The CLI uses the same snapshot
format and preserves these records when loading and updating it.

## Import, export and compare Evidence

Evidence records retain artifact identity, source locations, observations,
inferences and unresolved findings. Validate an existing bundle, export its
canonical form, or compare two supplied bundles:

```bash
rea evidence-import /absolute/path/to/evidence/bundle.json
rea evidence-export /absolute/path/to/evidence/bundle.json /absolute/path/to/evidence/canonical.json
rea compare /absolute/path/to/evidence/left.json /absolute/path/to/evidence/right.json
rea compare left.json right.json --record_pairs '[{"left_evidence_id":"ev_<left-sha256>","right_evidence_id":"ev_<right-sha256>"}]' --json
```

Migration: replace `rea compare-bundles` with `rea compare`; the former command
has been removed. The MCP tool remains `compare_bundles`.

`rea compare` compares records by Evidence identity and explicit pairs. It does
not read artifact contents: the inventories of two builds are unresolved
records, or one opaque change when you pair them. Use `compare-artifacts`,
described at the end of this section, to compare their contents.

`--record_pairs` supplies an explicit JSON array of observation pairs, matching
MCP `compare_bundles.record_pairs`. Pair IDs must exist on their named sides and
be one-to-one. Without pairs, one-sided membership remains unknown; REA does
not infer correspondence from position or display names.

Exports preserve an existing destination unless `--overwrite` is explicit.

Atomic Evidence output stages on the selected destination's filesystem. If the
OS pathname ceiling prevents its internal staging name, REA retries in a shorter
ancestor on that same filesystem and removes the unused stage. Existing output
protection still applies. A genuine pathname refusal uses `resource_constraint`
with `details.reason: path-limit` and `boundary: filesystem-path`.

For application traces and version comparisons, see
[JavaScript application workflows](javascript-application-workflows.md).
MCP [retained Evidence references](mcp-contracts.md#retained-application-evidence-inputs)
belong to one connection. Separate CLI calls can consume full saved records or
resolve exact retained IDs from an explicitly selected local bundle:

```bash
rea trace-application-feature request.json --evidence-bundle /absolute/path/evidence.json --json
```

Here `request.json` uses the same logical Evidence input as MCP, for example
`"application": {"kind":"retained-evidence","evidence_id":"ev_<64 lowercase hex characters>"}`.
Inline records and references may be mixed in the request's declared source
fields, including arrays and nested inputs. The bundle is read and authenticated
once for that command; no target is reopened, no producer is rerun, and no
record is selected by file order. Source identity, provenance, coverage and
partial or unknown facts agree with the complete inline form. When starting
from summary or inspection Evidence, select its
`normalized_result.parent_evidence_id` for a workflow requiring complete source
facts. Omit `--evidence-bundle` when all sources are inline.

The JSON workflow commands supporting this option are:

- `trace-application-feature`, `trace-javascript-semantics`,
  `compare-application-versions`, `compare-javascript-export-shapes`,
  `compare-source-to-bundle`, and `reconcile-javascript-runtime`.
- `import-managed-reconstruction`, `verify-managed-native-boundaries`, and
  `project-managed-application-graph`.
- `project-android-application-graph`, `project-apple-application-graph`, and
  `project-harmony-application-graph`.
- `compare-wasm-interfaces` and `inspect-analysis-view`.

For `inspect-analysis-view`, the request's source reference selects a parent
from the bundle for every supported view kind. Bundles exported from MCP work
for these commands. Its inline source form cannot also select a bundle.
A missing ID is refused with `details.reason: "missing"`;
supplying a bundle does not make incompatible Evidence valid for a workflow.
`compare-managed-members` keeps its two assembly paths, and
`compare-process-captures` keeps its two capture Evidence JSON paths. The bundle
option above selects an input; producer options that write a new bundle, such
as `inspect-managed-members --evidence-bundle`, retain their existing meaning.
File selectors remain available only on contracts that explicitly support them.

Compare two artifact inventories with `compare-artifacts`. It takes the same
`left` and `right` input as MCP `compare_artifacts`: complete Evidence, or an
`evidence-file` source with an optional `evidence_id` that selects one record
from a bundle. Relative paths resolve from the working directory:

```bash
rea inspect-artifact old.zip --json > old.json
rea inspect-artifact new.zip --json > new.json
rea compare-artifacts '{"left":{"kind":"evidence-file","path":"old.json"},"right":{"kind":"evidence-file","path":"new.json"}}' --json
```

A one-shot `compare-artifacts` command keeps no session Evidence, so it refuses a
`retained-evidence` source with `details.reason: "missing"`. Select the record
from a saved bundle instead.
For an artifact summary selected from a bundle, include its complete parent
inventory in the same bundle. The command resolves that parent from the
authenticated file records; a summary-only file cannot supply missing facts.

## Import historical source

Historical source inventories preserve exact filenames, including literal backslashes
on POSIX hosts. Relative import lookup uses the recorded source file's owning
directory and decodes URL percent escapes once; encoded slash, NUL and malformed
escapes remain unresolved. A decoded backslash remains part of a filename rather
than a directory separator. This inventory lookup does not claim that Node can
load that filename or apply Node's runtime file-URL admission policy.

Import an older source tree to compare with the current artifact:

```bash
rea import-reference-source /absolute/path/to/source
rea import-reference-source /absolute/path/to/source --detail summary --outline-depth 2 --json
```

The default (`--detail full`) returns the complete `HistoricalSourceGraph`.
Choose `--detail summary` for a `HistoricalSourceSummary` of that same committed
inventory: its `HistoricalSourceManifest` contains the semantic graph and root
digests, with provenance, VCS facts, languages, manifest paths, entry and
relationship counts, parse-failure counts, file/directory states, exclusions
and limitations. The summary is a presentation view, not a graph accepted by
source-to-bundle comparison; keep the full output for that workflow.

Known filesystem failures commit the operation, parsed errno, entry-relative
location and recovery guidance. Entry `local_diagnostics`, when present,
retains the exact host message, including local paths, outside the semantic
graph commitment. Equivalent permission failures therefore retain their manifest
identity after relocation while preserving original source diagnostics in full
output and visible summary outline entries. Other substantive limitations still
participate in the graph commitment.

An unreadable child directory remains a partial inventory entry. Directory-scoped
ignore policy is required before enumerating a directory that can be opened;
an unreadable or invalid policy still fails the import. Project negations cannot
override defaults or caller exclusions; caller patterns retain their own ordered
negations. Configured secret exclusions remain final.

`--outline-depth` requires `--detail summary` and accepts a nonnegative safe
integer. Depth 1 shows root children, depth 2 (the default) also shows their
children, and depth 0 omits all outline entries. Paths retain canonical Unicode
code-point order. `outline.omitted_entry_count` counts only inventoried entries
hidden by the chosen depth; it does not count unexamined children of excluded or
unreadable directories, or change `inventory_state`. Exclusions and source
limitations remain separate from this presentation omission.

`file_sizes.known_bytes` is the exact sum of known inventoried file sizes as
decimal text, so large sums cannot lose integer precision. Unknown sizes count
in `file_sizes.unknown_file_count`; excluded or unexamined paths are not included
in that total. A zero known-byte sum therefore does not establish an empty source
tree. Full output retains individual file hashes, relationships and parse-failure
diagnostics. Summary mode performs the same import and cleanup, then projects
the committed result without rereading source files. It reduces the selected
output, not the amount of source examined. A shallow tree or many exclusions can
still produce a large summary; depth 0 removes the outline but preserves the
other facts. No fixed output-size or runtime improvement is promised.

Import failures use the shared error contract (`code`, `category`, `message`,
`retryable`, and `remediation`). When reads completed before failure,
`details.diagnostics.partial` retains the reader facts, with file bytes as
arrays of byte values. Unresolved cleanup uses `cleanup_incomplete` and
retains the source failure and resource paths in `details`.

The import records hashes and metadata for the supplied files, separately
from observations of the current app. For a directory inside a Git checkout,
it records the HEAD of the nearest enclosing repository; whether the working
tree matches that commit remains unknown. Root selection follows filesystem
symlink/parent semantics before canonical identity is derived. It honors
`.gitignore` files at the selected root and in traversed child directories,
with patterns relative to their containing directory and deeper negations
applied only when the parent was not excluded. Matching uses the nearest
repository's local `core.ignorecase` setting (false when unset), including the
shared configuration of linked worktrees. Policy and Git metadata reads retain
their descriptor cleanup under the import's resource owner; unreadable policy
is a typed failure, not an empty policy. Above-root `.gitignore` files, global
excludes, `.git/info/exclude`, config includes and worktree-specific config are
not loaded. The import also applies default exclusions for common generated and dependency paths such
as `node_modules/`, `dist/`, and `*.log`. Pattern-based exclusions record the
matched pattern and whether it came from project, default, caller, or sensitive
path policy. Links into excluded paths retain their internal target metadata;
the exclusion explains why the target has no inventory entry, and the inventory
remains partial. Exclusions record `entry_kind` when the importer observed it;
older saved exclusions without that field have unknown kind. An excluded
ancestor proves an internal descendant only when its kind is `directory`.
Set `REA_REFERENCE_SECRET_PATTERNS_JSON` to a JSON array of ignore
patterns when you want to mark selected paths as sensitive; those patterns are
reported separately as configured-secret exclusions.

Re-import saved graphs whose pattern-based exclusions lack `pattern` before
using them in source-to-bundle comparisons.

Entries that change during an import retain an unavailable-entry diagnostic
alongside readable siblings. If enumeration of an already admitted root fails,
the graph keeps its observed children and records the root failure as a
top-level limitation. That partial inventory does not establish absence among
unexamined children. POSIX directory-entry bytes that are not valid UTF-8 cannot
be represented as graph paths; the containing directory (or root) is marked
unsupported, and REA does not access the entry through a replacement-character
name. Symlink targets are read as bytes too: a target that is not valid UTF-8
is retained as an unreadable symlink with its bytes reported in the limitation,
and is never resolved through a replacement-character path. Readable siblings
remain inventoried.

JavaScript and TypeScript import parsing requires valid UTF-8. Malformed source
bytes retain their original hashes and sizes with a decoding diagnostic; REA
does not infer module targets from replacement characters. Exact dynamic-import
strings, expression-free templates and runtime-transparent TypeScript wrappers
retain their targets; computed imports remain unknown. TypeScript import-equals
dependencies remain `requires` relationships whether or not they are exported.
Historical dependencies also include TypeScript import types (`import("./dep").T`
and `typeof import("./dep")`) and declarations inside ambient module bodies;
these source relationships do not assert runtime loading. Language labels retain
the conventional case-sensitive `.C` (C++) and `.M` (Objective-C++) suffixes.

REA derives historical CommonJS paths only when the selected loader and its
base are proven: this includes the exact
`createRequire(new URL("./file.cjs", import.meta.url))` form and
`require.resolve` with `{ paths: [__dirname] }`. Exact optional-call forms such
as `require.resolve?.("./dep.cjs")` use the same loader and mutation facts. The
nearest inventoried package manifest supplies `.js`/`.ts` package facts to the
shared parser; explicit filename modes take precedence. A known ES module has no
implicit CommonJS wrapper, including when a factory is derived from an unbound
`require`. An unreadable, excluded or malformed manifest, or package scope outside
the selected inventory, leaves otherwise unproven loader resolution unknown with
the requested specifier and a reason. A nearest manifest without a `type` field
uses the shared parser's JavaScript module-syntax facts. Unresolved TypeScript,
JSX compilation and declaration contexts do not establish runtime wrapper bases.
Other custom bases and search options remain partial with unknown resolution and
the literal requested specifier. Overwritten resolver methods retain that uncertainty; they are not
attributed to Node. `require.main` is a module object, so calling it does not
establish a loader reference. These relationships do not establish execution;
Node's [`require.resolve`](https://nodejs.org/docs/v24.22.1/api/modules.html#requireresolverequest-options)
performs lookup without loading the target. An excluded `package.json`
also leaves package-directory selection unknown rather than treating the
manifest as absent and applying an `index` fallback.

Import requests use URL pathname semantics: query and fragment remain request
identity, percent escapes decode exactly once for inventory lookup, and encoded
separators or malformed escapes retain an unresolved relationship and diagnostic.
URL-bearing relationships retain the authored `source_specifier` separately from
the inventoried `to` path; distinct query/fragment requests remain distinct even
when they name the same file. CommonJS requests retain literal filename semantics
for percent signs, query marks and fragments.

Historical-source import requires safe no-follow file opens on Linux or
macOS. Native Windows returns `unsupported_host`; use Linux REA inside WSL
or another supported host. See
[source-to-bundle comparison](javascript-application-workflows.md#historical-source-to-bundle-comparison)
for mapping identities, inferences and unknowns.

## Capture runtime behavior

Choose the guide for the target and intended interaction:

- [Browser observation](browser-observation.md): inspect a selected page through CDP.
- [Browser scenarios](browser-scenario-contract.md): run declared interactions and capture their results.
- [Electron observation](electron-observation.md): inspect an Electron renderer or capture an application scenario.
- [Electron fuses](electron-fuses.md): read packaged fuse bytes before expecting `--inspect` to reach an Electron main process.
- [Node/Electron Inspector](javascript-runtime-observation.md): record script locations and execution contexts.
- [Process capture](process-capture.md): run an executable and compare terminal, exit and filesystem observations.

Runtime requests name the target and actions. Launched targets run with your
user permissions; consult the chosen guide for host requirements and effects.

## Serve MCP over streamable HTTP

`rea mcp` speaks stdio to the client that launched it. To serve the same MCP
catalog over streamable HTTP for one local client, such as an agent environment
runtime, start the dispatcher entry with `--http`:

```sh
rea mcp --http --port 8765
```

`--host` and `--port` default to `MCP_HOST` and `MCP_PORT` from the environment,
then to `127.0.0.1` and an ephemeral port. A bind outside loopback requires
`MCP_ALLOWED_HOSTS` or `--allowed-hosts`, a comma-separated list of client host
names or IP addresses without URLs or ports.

Repeat `--allowed-hosts` to append names, or put multiple names in one
comma-separated value. All occurrences are validated together and deduplicated
after hostname normalization; the explicit list replaces `MCP_ALLOWED_HOSTS`.

For example:

```sh
rea mcp --http --host 0.0.0.0 --allowed-hosts 127.0.0.1,rea.lan
```

Requests with a different `Host` or browser `Origin` receive `403`; a missing
`Origin` is accepted. The announced client URL uses the bound hostname when
admitted, otherwise the first declared hostname, with the actual bound port.
It is written to stderr as one JSON log line (`"msg":"MCP transport listening"`) whatever `REA_LOG_LEVEL`
is set to; nothing is written to stdout. `rea mcp --http --help` lists the accepted options. The listener serves
one client at a time: a session ends with the client's `DELETE`, and a client
that connects while another session is open takes it over, so a client that
exited without ending its session needs no restart. The listener runs until
SIGINT or SIGTERM and does not stop when stdin closes. See
[transports](mcp-contracts.md#transports) for the session, `Host` header and
shutdown contract. Client registrations written by setup and the MCP registry
entry keep stdio.

## Serve an environment manifest

`rea environment-serve <manifest.json> --evidence <capture.json>
[--replay-only] [--host H] [--port N]` serves an environment manifest
projected by `inspect-analysis-view` as an agent environment: an MCP server at
`/mcp`, the environment card at `/.well-known/agent-env.json`, and a
`/agentenv` data plane. The manifest's `parent_evidence_id` must equal the
evidence file's `evidence_id`; otherwise the command refuses with
`invalid_request` before binding. Before binding it derives the
`environment-state` view of the capture with the manifest's `template_rules`,
as `inspect-analysis-view` would, and serves from it: read tools whose views
are state-backed answer from a live state, write tools are served only where
the capture's later reads confirmed their effect, and
`/agentenv` serves `data/reset`, `data/add` and `data/get`. When the state
cannot be derived, or its catalog exceeds the discovery reservation, it logs a
warning with the error code and message and serves replay; `--replay-only` serves replay without deriving. In replay every
manifest tool replays the retained capture records it cites and `/agentenv`
answers every method with JSON-RPC `-32601`. The stopped document's `state`
member is `{"served": true, "evidence_id": …}`,
`{"served": false, "reason": "replay-only"}` or
`{"served": false, "reason": "unavailable", "code": …, "message": …}`; see
[serve from the state](agent-environments.md#serve-from-the-state).

```sh
rea environment-serve manifest.json --evidence capture.json --port 8765
```

`--host` and `--port` resolve like `rea mcp --http`: flags, then `MCP_HOST` and
`MCP_PORT`, then `127.0.0.1` and an ephemeral port. A non-loopback bind requires
`MCP_ALLOWED_HOSTS` with the same hostname rules and Host/Origin gates as above.
`environment-serve` uses this environment setting; `--allowed-hosts` belongs to
`rea mcp --http`. For example:

```sh
MCP_ALLOWED_HOSTS=127.0.0.1,rea.lan rea environment-serve manifest.json --evidence capture.json --host 0.0.0.0
```

`ENVIRONMENT_NAME` renames
the served environment; set but blank, it is refused as `configuration_invalid`
like a blank `MCP_HOST`. The admitted client URL is written to stderr as one JSON log line
(`"msg":"MCP transport listening"`). See
[agent environments](agent-environments.md) for what the state and replay
return and do not establish.

## Build an environment bundle

`rea environment-build <capture> [dir] [--name <name>] [--template-rule <rule> ...]
[--format-rules-only] [--package-tarball <path>] [--capture-timeout-ms <ms>] [--dry-run]` builds the bundle
`environment-export` writes from one recorded capture: a `.har` file, which it
inspects as `inspect-web-network-capture` does, or capture Evidence JSON from
`inspect-web-network-capture` (HAR) or `capture-browser-scenario`. It projects
the environment manifest from the in-memory Evidence with the opt-in rules
`after-uid-literal`, `opaque-token`, `sibling-variance` and `prefix-variance`
unless `--template-rule` or `--format-rules-only` selects others, prepares the
state, and writes the bundle; every file is byte-identical to the three-step
path's when that path lists the same rules in the views' order and exports
under the build's name. A loopback or IP-literal capture is named after its file unless `--name`
is given. It prints one JSON report: the capture and manifest identities, the
state, a `coverage` summary of which tools answer from the state, which replay
and why each write is withheld with a hint, the files, warnings and the next
command. `--dry-run` writes nothing and may omit the directory.

```sh
rea environment-build grafana.har ./grafana --json
```

See [agent environments](agent-environments.md#build-a-bundle-in-one-step)
for the report, the hints and what the bundle ships.

## Export an environment bundle

`rea environment-export <manifest.json> --evidence <capture.json> <dir>
[--package-tarball <path>] [--name <override>]` writes the same manifest and
capture pair as a bundle folder the agentenv framework runs with
`agent-env run <dir>`. It reads each file once, authenticates and cross-checks
the pair with the same checks as `environment-serve`, checks the bundle name,
then prepares the state under that name as the bundle's server will at startup
to predict what the bundle serves (replay when the state is unavailable),
copies the bytes it authenticated, refuses to write into a directory that
exists and is not empty, and never overwrites a file.

```sh
rea environment-export manifest.json --evidence capture.json ./grafana-example --json
```

The folder holds a `README.md` with the bundle's provenance, an env folder
`envs/<name>/` with a `Dockerfile` that installs this exact `rea-agents`
version and serves the copied `manifest.json` and `evidence.json` (written
with mode `0600` on POSIX; Windows retains inherited ACLs) with
`environment-serve` (from the state by default), a Python verifier under
`artifacts/check_<name>/` that checks the served tool count and one served
answer, and the smoke task `tasks/smoke.json`. `--package-tarball` copies a packed `rea-agents`
tarball into the env folder and installs it instead of the registry package,
which is how the hosted lane proves a checkout rather than a release. `--name`
replaces the manifest's kebab-case name as the env folder and env id; a device
name Windows reserves (`con`, `nul`, `com1` and the like) is refused. The
command prints one JSON document listing the written files with their sizes,
the pinned package source, the served `tool_count`, and `state` in the shape
of the serve command's stopped document. See
[agent environments](agent-environments.md#export-a-bundle) for the folder
layout and what the smoke task checks.

## Compare an environment with its application

`rea environment-compare <manifest.json> --evidence <capture.json> --probe <probe.json> [--probe <probe.json> ...]`
compares the environment the pair serves with probe captures of the application it came from. Each probe is capture
Evidence of one call sequence recorded against the application after a reset; the environment's state is reset before
each probe, every request to the application's origin is answered as the served environment answers it, and the
answer is compared with the application's after ids are mapped and clocks and generated values are normalised. The command reads files only and
makes no network call. It prints the report and exits `0`, or prints a structured `invalid_request` error and exits `1`
for the same pair refusals as `environment-serve`, a probe that is not capture Evidence, or a browser probe captured
without response bodies, or without the request bodies its writes need. See
[agent environments](agent-environments.md#measure-fidelity-against-the-application) for the report.

```sh
rea environment-compare manifest.json --evidence capture.json --probe probe.json --json
```

## Report version and runtime

`rea --version` prints the package version. Add an output format to get the
version with the runtime and platform context that a support request needs:

Version reports do not initialize analysis providers. Invalid global settings
or output options still report their usual errors.

```bash
rea --version --json
```

```json
{
  "name": "rea-agents",
  "version": "6.7.0",
  "runtime": { "id": "node", "version": "24.22.1" },
  "platform": "linux",
  "architecture": "x64",
  "supported_runtime": {
    "range": "^22.23.4 || ^24.22.1 || >=26.12.1",
    "satisfied": true
  }
}
```

| Field                                | Meaning                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `name`, `version`                    | Published package name and version; `version` matches plain `--version`.                                       |
| `runtime.id`                         | `node` or `bun`.                                                                                               |
| `runtime.version`                    | Version of that runtime.                                                                                       |
| `runtime.node_compatibility_version` | Bun only: the Node.js version it reports compatibility with.                                                   |
| `platform`, `architecture`           | Node.js `process.platform` and `process.arch`, such as `linux` and `x64`.                                      |
| `supported_runtime.range`            | Supported Node.js range.                                                                                       |
| `supported_runtime.satisfied`        | Whether this runtime is supported, judged as `rea doctor` judges it; Bun by its Node.js compatibility version. |

The field names are stable. The report contains no paths, environment values,
user or host names, and it starts no provider and reads no target. `--format`
selects any CLI output format, such as `--format yaml`. JSON follows the usual
rule: indented on a terminal, compact when piped or redirected. `--help` still
takes precedence. With other output controls, `--version` keeps its existing
behavior: valid controls such as `--filter-output` or `--full-output` print the
plain version, and invalid combinations report the usual output-flag error,
such as `UNSUPPORTED_OUTPUT_COMBINATION` for `--json` with `--token-limit`. Use
`rea doctor` for provider and host readiness.

## Output and exit status

Commands reject surplus positional arguments before execution, including commands
that accept no positionals. Use `rea <command> --help` for the declared argument
shape; a final variadic argument continues to accept multiple values.

`rea mcp doctor --json` checks production MCP startup and reports child logs in
`diagnostics`. It drains stderr while retaining at most its first 64 KiB of raw
bytes as text, omitting a final UTF-8 code point if it crosses that byte limit.
`stderr_bytes` counts all observed bytes, including omitted output;
`stderr_truncated` indicates that output exceeded the retention limit. The same
diagnostics appear inside the report when `--full-output` is selected. Log
truncation alone does not change the diagnostic health or exit status.

The default terminal format is TOON. Use `--json` when saving results for a
JSON consumer. Valued output flags (`--format`, `--filter-output`,
`--token-limit`, `--token-offset`) accept `--flag value` or `--flag=value`; a
missing value fails with `MISSING_OUTPUT_VALUE` before the command runs.
Malformed format values and token windows fail with `INVALID_OUTPUT_VALUE` in the
selected structured format. Token limits and offsets must be nonnegative safe
integers; zero selects an empty window. These checks run before command execution. `--json` is indented on a terminal and compact when piped or
redirected, which keeps large results smaller for agents and scripts; pipe
through `jq .` for indented files. A formatting refusal exits nonzero even when
the underlying operation succeeded.

`--format md` escapes backslashes, pipes, and inline Markdown syntax in table
headers and cells so source text is displayed literally, and renders cell line
breaks as `<br>`. Underscores between letters or digits, as in `source_index`,
cannot form emphasis and stay unescaped. These are presentation changes; retained
Evidence and JSON output keep the original values. Nested objects and arrays
use JSON inside their owning Markdown cells, retaining the field names and
values instead of replacing them with an object label. Table widths are measured
iteratively, so an admitted row page is not limited by the JavaScript function
argument count.

Markdown refuses selected NUL characters and unpaired UTF-16 surrogates because
renderers or UTF-8 output would substitute them. TOON refuses selected unpaired
surrogates for the same UTF-8 reason. Use JSON or YAML to retain those values.
An authored replacement character and valid supplementary characters are not
treated as malformed.

`--format csv` and `--format tsv` export one selected row collection. Select an
exact array path with `--filter-output` and provide comma-separated direct
scalar columns with `--columns`; column order is the output column order:

```bash
rea inspect-analysis-view request.json --format csv \
  --filter-output normalized_result.rows --columns name,address
```

The first line is a REA metadata record,
`# rea-delimited-v1 <JSON>`. It carries the selected path, view request, limitations and unknowns,
coverage, source coverage and completeness, command, and duration. A metadata
value of `null` means that the selected row collection did not provide that
fact; it does not mean complete coverage. The following line is the header.
CSV records use CRLF line endings; TSV records use LF. Cells containing the
delimiter, quotes, or line breaks are quoted and embedded quotes are doubled.
Values are emitted as UTF-8 without Unicode normalization. Missing and `null`
cells are empty; booleans and finite numbers use their ordinary text forms.
String cells and headers that begin with spreadsheet formula syntax are refused
with a structured error; unpaired surrogates in selected cells or headers are
also refused. JSON retains those values unchanged.

Delimited output does not flatten nested Evidence or nested field values.
It returns a structured error and a nonzero status if the filter does not
select exactly one row array, a row is not an object, or a selected cell is
nested or formula-leading. JSON remains the complete canonical output; use it
to retain fields outside the selected columns or preserve exact formula-leading
text. Token counting and token windows are not
available for CSV/TSV because slicing would corrupt records or metadata.

`--filter-output` selects fields from successful command data. Classified failures
retain their complete typed diagnostic projection even when the selector matches
a field such as `code` or `message`, or names a missing field. `--full-output`
controls whether the outer `{ok, error, meta}` envelope is included.
Selected own JSON members, including `__proto__`, remain ordinary output data.

Sibling array slices that select different fields are combined by original row
index and emitted in source order, regardless of selector order. Selecting a
whole parent row keeps that row intact and takes precedence over narrower fields
selected from the same row. For example, `rows[0,2].name,rows[1,3].version`
combines both fields for overlapping rows, while `rows[0,2],rows[1,3].version`
retains rows 0 and 1 whole.

For `cutter-command`, `--json-output` requests command-specific JSON from
Cutter when available. This is separate from `--format json`, which selects the
CLI result representation; the global `--json` flag selects that same CLI
representation.

Cutter no longer accepts command-local `--json=true` or `--json=false`.
Replace these with `--json-output=true` or `--json-output=false`, respectively.
Combine `--json-output` with bare `--json` when both Cutter command output and
the CLI result should use JSON; either argument order is accepted.

| Status    | Meaning                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`       | The operation completed. Its result may include partial evidence, warnings or unresolved questions.                                                                                                                                                                                                                                                                                    |
| `1`       | The operation could not complete. Structured output identifies invalid input, permissions, cancellation, timeouts or another failure when available.                                                                                                                                                                                                                                   |
| `128 + N` | Signal-derived status. An unhandled signal may have ended the process, with the shell or runtime preserving the conventional status; a command may instead have handled the signal, waited for its operation and cleanup to settle, and assigned the same status (`130` for SIGINT, `143` for SIGTERM). In the handled case, it may also have printed a structured `cancelled` result. |

`rea mcp --http` is long-running and prints no structured result. It exits
`130` on SIGINT or `143` on SIGTERM after closing the listener, the session and
its providers, and `1` when that cleanup fails.

`rea environment-serve` is also long-running: it serves until SIGINT or
SIGTERM, closes the listener, then prints one structured
`{"status":"stopped", …}` document naming the URL, environment and tool count
and exits `130` or `143` through the shared cancellation handler below.
Refusals before binding (unreadable files, non-Evidence JSON, capture Evidence
in a format other than HAR, a manifest or state whose parent is not the
supplied evidence, an unbindable port) print a structured
error and exit `1`, as does a listener that fails after binding.
If shutdown fails, the command reports `cleanup_incomplete` with the retained
server resources. It preserves a primary listener diagnostic, or a
`shutdown_observation` naming the requested shutdown and its URL, environment,
tool count and Evidence identifiers. The successful `stopped` document is
returned only after cleanup is confirmed. The same in-process server owner
retains failed stages for retry; the CLI exposes no separate retry command.
`rea environment-build` is one-shot too: it prints its report and exits `0`,
or prints the refusing stage's structured error and exits `1`, writing nothing
when the refusal comes before the bundle is written. SIGINT cancels it with a
`cancelled` error; a cancellation before the bundle stage writes nothing.
`rea environment-export` is one-shot: it prints the written files and exits
`0`, or prints a structured `invalid_request` error and exits `1` for the same
pair refusals, a non-empty or file-occupied directory, a missing package
tarball or a name that is not a kebab-case label or is a Windows device name,
writing nothing in each case. A file occupying the destination is reported as
requiring a directory; identity-change diagnostics are reserved for admitted
paths that fail later identity checks. Host permission failures identify whether
input reading or bundle writing was denied and retain the reported path.
A write that fails after the first file (a permission, disk-space or
pathname-length failure on a later path) propagates as the host's failure,
naming its cause and, when it failed on one bundle file or the package
tarball, that file. A failure while syncing the finished folder names only its
cause. Either way the partial folder stays in place for inspection; remove it
before retrying, since the next attempt refuses the non-empty directory.

A `cancelled` result does not by itself determine the exit status; it depends on
the command's signal handling. Commands routed through the shared
`withCommandCancellation` handler in the CLI set status `130` for SIGINT or
`143` for SIGTERM after their operation settles. Current source registrations
use that handler for process capture and comparison (`capture-process`,
`compare-process-captures`), JavaScript application analysis (`analyze` when it
selects the JavaScript lane, and `analyze-javascript-application`), selected
browser, web and Electron commands (including `analyze-web-bundle`,
`observe-web-execution`, `capture-browser-scenario` and
`capture-electron-scenario`), and the platform and provider command families
for Android/ADB, Apktool/JEB/Flutter, firmware, PCAP and signal analysis,
WASM/EVM, Go/Rust and binary diagnostics, Frida instrumentation, the Cutter
command, objdump, Rizin and GDB, and the agent environment server
(`environment-serve`). The handler also wraps `doctor`,
`inspect-sqlite-database`, `recover-javascript-sources`,
`inspect-il2cpp-metadata`, and `inspect-desktop-application`. In these paths, a returned structured
`cancelled` result can be printed before the wrapper assigns the
signal-derived status. This describes the current source routing; it is not a
claim that every command or provider runtime has been independently exercised.

Commands with `--evidence_output` select their delivered view, then publish the
complete Evidence bundle atomically. Cancellation before publication leaves no
new file. A publication that has committed can win a later cancellation; the
`cancelled` result then keeps the written path and byte count under
`details.diagnostics.evidence_bundle`. If staging cleanup stays incomplete
after commit, the `cleanup_incomplete` error reports the same file as
`details.published_path` and `details.bytes`.

When the reader of piped output closes early, as `rea ... | head` does, the
CLI stops writing, prints no error and exits `141` (`128 + 13`, the status of a
SIGPIPE-terminated writer). The operation itself may have completed; only its
output was declined.

`inspect-artifact` also returns a structured cancelled result. Its logging
wrapper sits outside the cancellation handler and replaces the signal-derived
status with the analysis failure status, so it exits `1`. Setup has its own contract: cancellation exits `0`. Treat the
structured result and process status as separate signals when scripting
cancellation.

`setup --dry-run` returns `planned` and exits `0`; a cancelled setup also exits
`0`. Setup returns `1` for `needs_confirmation` or `needs_human`.
`doctor` returns `1` when required checks in its selected readiness scope fail;
unavailable optional providers remain informational for unrelated tasks.

Enable `pipefail` in a supporting shell so a downstream formatter preserves
REA's failure status:

```bash
set -o pipefail
rea inspect-artifact ./app.asar --json | jq . > inspection.json
```

`--token-count` reports a tokenx estimate for the selected emitted document,
including a requested full-output envelope and metadata. JSON uses the same
terminal indentation or compact piped representation as normal output; JSONL
uses its emitted line representation. The final newline is included (tokenx
assigns whitespace no tokens). This is an estimate, not a model tokenizer count.
Counting retains the existing bounded formatted-string allocation after capacity
admission; omit the flag to stream large JSON documents without materializing
the complete formatted text. Exhausted token windows display an empty range at
the total token count and have no next offset.

### `inspect-devicetree`

Inspect an explicit local FDT v16/v17 blob without execution or an external tool.
Returns header, reservations, node/property tree, derived standard values and
selected phandle references. See [devicetree inspection](devicetree.md) for
limits and retained-view pagination.

```bash
rea inspect-devicetree /artifacts/board.dtb --json
rea inspect-devicetree /artifacts/board.dtb --detail summary --evidence_output /artifacts/board-evidence.json --json
```

### PE TLS and load configuration

```sh
rea inspect-pe-load-config /absolute/path/to/application.exe --json
```

Reports TLS callbacks and size-covered load-config fields without execution.
Use `--max-callbacks` and `--max-file-bytes` to set read budgets. See
[PE TLS and load configuration](pe-load-config.md).

Bun standalone executables use the existing `inspect-artifact` and
`extract-artifact` commands to inventory and materialize embedded source,
sourcemaps and bytecode without running the executable. See
[Bun standalone executables](bun-standalone.md) for layout coverage and limits.
