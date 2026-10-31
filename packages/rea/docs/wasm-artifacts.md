# Offline WebAssembly artifacts

`inspect_wasm_artifact` / `inspect-wasm-artifact` inspects explicitly selected
local WASM bytes using caller-supplied WABT 1.0.42. No active binary target is
required. REA does not install tools or fetch artifacts and does not execute WASM.

`open_binary` is not the WASM inspection route. A recognized WASM v1 header
returns `target_unavailable` with category `unsupported_target` and constraint
`wasm_requires_static_inspection`, including the selected path in a valid
`inspect_wasm_artifact` call. Use that target-free tool or
`rea inspect-wasm-artifact <path> --format json` with the toolchain below.
Check `binary_session` for configured capability availability. A recognized
header is not validation of the complete module; missing WABT is reported
separately as an unavailable capability, not as missing native engine support.

The recognized WASM header is checked before automatic database routing from a
.hop filename. Renaming a module to .hop therefore keeps the static-inspection
diagnostic. An explicit database selection or raw/COM format selection retains
the caller's requested interpretation; ordinary .hop database routing is unchanged.

Set `REA_WABT_BIN_DIRECTORY` to an absolute directory containing executable
`wasm-validate`, `wasm-objdump` and `wasm2wat` (with `.exe` on Windows). Missing
executables, unsupported banners and inaccessible tools produce actionable
unavailable diagnostics. Capability discovery reports configured availability;
execution validates tool files and version banners. Host process-ownership and
private-workspace controls must also be available. The real-tool profile has
been exercised on macOS arm64; other hosts require their own verification.

Configuration failures do not establish anything about the selected WASM bytes.
For a rejected version probe, `details.diagnostics` identifies the executable,
tool, expected version and configuration key; `details.captured_output` preserves
its actual stdout and stderr, including empty banners or warnings. Fix the
reported directory, executable access or release rather than changing the module
or repeating an unchanged call. All three tools must report 1.0.42 on stdout with
empty stderr. For CLI calls, set the environment before the next invocation. For
MCP, change the server's launch environment and restart/reconnect that server;
exporting a variable in a different shell does not update a running server.
REA never installs tools or relaxes version admission to recover.

```bash
REA_WABT_BIN_DIRECTORY=/absolute/wabt/bin rea inspect-wasm-artifact \
  /artifacts/module.wasm --glue_paths /artifacts/glue.js \
  --candidate_paths /artifacts/other/module.wasm --format json
```

Equivalent MCP input:

```json
{
  "name": "inspect_wasm_artifact",
  "arguments": {
    "path": "/artifacts/module.wasm",
    "glue_paths": ["/artifacts/glue.js"],
    "candidate_paths": ["/artifacts/other/module.wasm"]
  }
}
```

Each selected regular file is read through the existing stable artifact reader;
symlinks, changing files and files over 8 MiB fail closed. An oversized input
returns `resource_constraint` with resource `file-size` and its fixed byte
allowance in `reported_limits.maximum_input_bytes`; retrying the unchanged file
does not raise that allowance. WASM bytes are copied
into a private workspace as read-only `module.wasm`; its digest is rechecked
before and after each tool. WABT validates with
`wasm-validate --enable-all --ignore-custom-section-errors`, reports sections
through `wasm-objdump -h -x`, and decodes through
`wasm2wat --enable-all --ignore-custom-section-errors`. The result retains
selected byte SHA-256 and size, section payload ranges, full header/detail output
(including module-name preambles), exact import/export WAT forms, decoded WAT
and its UTF-8 SHA-256. Producer format drift and invalid or truncated modules
are failures, with validation diagnostics and partial Evidence retaining
selected byte identity and tool provenance.
If inspection stops after selected files were read, partial Evidence also keeps
the completed candidate file identities and glue parse observations. A stable
read remains observed when descriptor finalization later fails; cleanup still
requires retry. Partial Evidence for a glue read whose finalization fails
before decoding retains its digest with `not-performed` parse status. Invalid
UTF-8 retains the digest with failed parse status. Neither case invents
references, and a failed file read contributes no invented facts.
These independent observations do not establish that the selected WASM module is
valid: partial results state whether WABT validation is unknown, rejected the
module, or succeeded before a later inspection failure.
CLI errors include this partial Evidence inline. MCP errors can return its
`retained-evidence` reference in `details.partial_observation`; use
`get_evidence_bundle` with `detail: "complete"` to retrieve the matching record.

Core validation remains authoritative when an optional custom section cannot
be interpreted. WABT warning output is preserved in `custom_section_warnings`;
`debug_name_metadata` reports whether the optional name section was absent,
fully interpreted, uninterpretable, or unknown. WABT custom-section warnings
whose section attribution is unknown prevent a complete debug-name claim, even
when module names were decoded. They do not establish that the name section is
malformed. Exact warnings retain their producing tool and text. Older portable
reports retain their original strict command profile; missing metadata coverage
is `unknown` and missing warning history is `null`. Decoded WAT retains readable
custom sections; WABT omits a section whose name is invalid UTF-8. In that case
REA verifies the selected bytes, retains the section range and exact producer
diagnostic, and leaves its identity and debug-name coverage unknown. An uninterpretable name section leaves complete
debug-name coverage unknown. Module names decoded before a later metadata
failure remain available for exact objdump framing, including names containing
newlines or NUL; those partial observations do not establish complete optional
metadata.

The tool profile preserves upstream release/source identity, resolved executable
paths, executable digests, exact banners and arguments. Executable digests are
checked again after each command. Caller-supplied tools are trusted programs;
version and digest recording are not publisher authentication or an OS sandbox.
Each WABT version/analysis command defaults to a 30,000 ms deadline. Set optional
MCP `command_timeout_ms`, or CLI `--command-timeout-ms <milliseconds>`, to select a
positive integer up to 2,147,483,647 ms (the runtime timer range) for that call.
The selected deadline is retained as `tool_profile.timeout_ms` and, when supplied,
in Evidence parameters. It applies separately to each command, not the whole
inspection, file admission or cleanup. The MCP client must allow time for all
commands, file checks, cleanup and delivery. A provider timeout reports the
actual selected deadline and these recovery controls; increasing only the client
deadline does not change the provider budget. No server restart is required to
change this per-call setting. Resolve incomplete cleanup before another attempt.

To change the default across new MCP operations, set `wasm.command_timeout_ms`
through `update_analysis_settings`. An explicit `command_timeout_ms` still wins;
correct that argument if it caused the timeout. Runtime defaults do not insert
omitted arguments into Evidence parameters. See the
[settings design](design/limits-and-recovery.md#precedence-and-lifetime).

For example, `rea inspect-wasm-artifact /artifacts/module.wasm
--command-timeout-ms 60000 --format json` uses a 60-second per-command deadline;
the equivalent MCP input is `{"path":"/artifacts/module.wasm",
"command_timeout_ms":60000,"detail":"summary"}`. Summary delivery retains the
complete Evidence but does not reduce WABT analysis work.

The 8 MiB input allowance and 32 MiB combined command-output budget remain fixed;
increasing `command_timeout_ms`, host memory or the client deadline does not raise
them. Do not truncate required module bytes to fit. Select another suitable
complete artifact only if it answers the question, otherwise report the limit.
Inspection output past the budget fails with `resource_constraint`; an oversized
`--version` probe still reports `unreadable_output`. Both streams share the
budget, so a stream that starts after the other has filled it retains nothing.
The captured output keeps up to the first 4,096 bytes that each stream retained,
each stream's retained byte count, and the exit code and signal. Retained text
can end in U+FFFD where the budget cut a multi-byte character.

These excerpts bound the returned diagnostic text.
[PR #2117](https://github.com/morluto/rea/pull/2117) reports elapsed time, CPU
time, and peak process-family memory, including WABT children, for warm Linux
x64 WABT 1.0.42 CLI workflows; those costs did not change outside measurement
noise. Agent token usage and truly cold workflows remain
unmeasured. The underlying error cause still retains the full captured
subprocess snapshot, so the excerpt does not establish lower retained memory
or faster analysis.
All commands use existing owned-process cancellation and cleanup. Workspace
cleanup failures remain explicit errors with resource paths.

WAT is a decoded representation, not original source or proof of runtime
behavior. Custom annotations can preserve payloads, but WAT does not establish original
binary layout or round-trip byte identity. Original byte identity and objdump
output retain that distinction. Import/export forms retain exact escaped WAT names. Unescaped objdump display
names are not parsed as unambiguous identifiers.

Optional JavaScript glue uses the existing Babel parser and AST traversal. It
retains `.wasm` string literals and literal templates with source coordinates,
selected glue byte identity and parser status. Relative filesystem matches become
local path candidates. URLs, query/fragment variants and unmatched paths retain
basename candidates, including multiple matches, or remain unresolved. These are
literal associations, not proven data flow, runtime loading or URL-to-file
identity. Computed strings, aliases and dynamic imports require further evidence.
Candidates are caller-selected files; their identity does not imply validation.

Both CLI and MCP use the same typed port and application service. MCP publishes
SDK-compatible schemas and records Evidence for `get_evidence_bundle` readback.
See [WABT provenance](https://github.com/morluto/rea/blob/main/third_party/wabt/README.md) and
[testing](testing.md#offline-wasm-artifacts) for real-tool verification.

## Compare core-module interfaces

Inspection adds producer-owned typed `interface` facts while keeping exact WAT
import/export forms. Function/tag signatures resolve type indices; table/memory
limits, memory page size and global value type/mutability remain explicit.
Unadmitted types (including GC reference signatures) retain null signatures and
issues. Exact decoded names retain escapes, empty names, BOM and punctuation.
Internal WAT labels are display identifiers: a repeated label in a type or
function/table/memory/global/tag index space is ambiguous. Named references to
it retain null signatures or indices and an explicit issue; numeric references
and uniquely named definitions keep their own identity. Comparison treats an
unresolved signature as unknown, including in self-comparison. Inventory
completeness describes observed import/export entries, independently of type
resolution. This facet is absent in historical Evidence that did not examine
typed interfaces.

`compare_wasm_interfaces` accepts two complete `inspect_wasm_artifact` Evidence
records, or exact retained references in the current MCP session, and required
`scope: "imports" | "exports" | "both"`. It uses producer-owned typed facts
without rereading the artifact and needs no active WABT toolchain. CLI accepts
portable inline Evidence in one JSON document, or
resolves the same retained-reference inputs from an explicit saved bundle:

```bash
rea compare-wasm-interfaces comparison-input.json --evidence-bundle /absolute/path/evidence.json --json
```

```json
{
  "left": { "kind": "retained-evidence", "evidence_id": "ev_<left-digest>" },
  "right": { "kind": "retained-evidence", "evidence_id": "ev_<right-digest>" },
  "scope": "both"
}
```

Omit `--evidence-bundle` when the CLI input contains complete inline records.
Resolve summary delivery to its complete `normalized_result.parent_evidence_id`
before comparing. References preserve that exact source identity and coverage;
the bundle supplies no facts absent from the selected record.
Results retain both input Evidence IDs, artifact paths/digests/lengths and every
selected occurrence. Unique names are added, removed, changed or unchanged;
duplicate names and unsupported signatures are unknown. Incomplete or historical
inventories never establish absence. Imports group by module/name, exports by
name, so a change of kind is visible. Output ordering is deterministic.

Static type equality does not establish runtime compatibility, ABI compatibility
or linking success. Comparison covers core modules; WebAssembly components and
canonical ABI relationships belong to their separate inspection workflow.

After building, run `REA_WABT_BIN_DIRECTORY=/absolute/wabt/bin node
scripts/verify-wasm-interface-comparison.mjs` for original-module comparison
through the compiled CLI and stdio MCP. It uses owned fixtures and WABT 1.0.42;
no WASM module is instantiated or executed.

Glue parsing accepts Node-supported WASM source-phase imports, including
`import source module from "./module.wasm"` and
`await import.source("./module.wasm")`. Their string literals retain the same
coordinates and local candidate associations as ordinary import literals; these
are static source observations, without module instantiation or execution.
