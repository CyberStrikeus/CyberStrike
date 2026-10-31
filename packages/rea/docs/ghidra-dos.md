# DOS MZ and COM analysis with Ghidra

REA can analyze DOS MZ executables and explicitly selected COM images through the bring-your-own Ghidra adapter.
The Linux x64 and macOS arm64 verification lanes exercise actual 16-bit disassembly and
decompilation through the CLI and stdio MCP. Provider admission accepts Ghidra
12.x (>=12.1) and that installation's declared JDK range. The verification lane uses
Ghidra 12.1.4 and JDK 21; no DOS emulator or cross-compiler is required.

## Open and inspect

```bash
rea inspect /absolute/path/to/legacy.exe --provider ghidra --json
rea search /absolute/path/to/legacy.exe entry --kind procedures --provider ghidra --json
rea instructions /absolute/path/to/legacy.exe entry --provider ghidra --json
rea function /absolute/path/to/legacy.exe entry --provider ghidra --json
rea inspect-native-load-image /absolute/path/to/legacy.exe --provider ghidra --json
rea read-bytes /absolute/path/to/legacy.exe 0x10000 --length 16 --provider ghidra --json
rea address-to-file-offset /absolute/path/to/legacy.exe 0x10000 --provider ghidra --json
```

Use an observed procedure name or address from discovery when the target does
not name its entry function `entry`. MCP uses `open_binary`, `list_procedures`,
`procedure_info`, `read_function_instructions`, and `analyze_function` with the
same admitted target and provider semantics.

The DOS MZ parser validates page counts, initialized module length, header and
relocation-table bounds, relocation destinations, and the initialized entry
point using the available structural bytes and actual file length. It reports
those DOS facts separately from Windows-header evidence. A recognized PE
signature remains PE; recognized NE, LE, and LX headers are explicitly
unsupported. A nonzero Windows-header pointer without a recognized signature
usually remains an unresolved candidate, even when the DOS structure validates:
automatic target selection fails closed and reports both observations. When a
nonempty relocation table ends inside a complete DOS header, the remaining
header bytes belong to DOS padding; a nonzero dword there is not a Windows
declaration. An unread signature beyond the current probe is requested before
that padding rule applies. This avoids manufacturing a Windows header from
original DOS padding while preserving rejection of damaged Windows
declarations.
Inventory classification is a bounded-prefix format hint; it returns `unknown`
for an unresolved candidate or when its prefix cannot establish the format.
That result is distinct from complete DOS validation and does not decide target
admission.

Ghidra imports a private target snapshot with `MzLoader`, language
`x86:LE:16:Real Mode`, and compiler specification `default`. These settings,
the fixed Ghidra load segment `0x1000`, and the linear address convention are
committed in the analysis profile. The handshake rejects language or compiler
drift. Closing the session deletes the temporary project and snapshot.

The profile also commits `function_body_evidence: complete-inclusive-ranges-v1`,
so snapshots from older length-only Ghidra results do not satisfy the current
profile.

## Headerless COM images

COM has no identifying header. Select its interpretation explicitly; neither the
`.com` suffix nor arbitrary unrecognized bytes are enough to admit it.

```bash
rea inspect /absolute/path/to/legacy.com --target-format dos-com --provider ghidra --json
rea function /absolute/path/to/legacy.com 0x10100 --target-format dos-com --provider ghidra --json
rea inspect-native-load-image /absolute/path/to/legacy.com --target-format dos-com --provider ghidra --json
```

```json
{
  "name": "open_binary",
  "arguments": {
    "path": "/absolute/path/to/legacy.com",
    "format": "dos-com",
    "provider_id": "ghidra"
  }
}
```

The caller's interpretation applies to the complete file, even if its filename
suggests another format. Files must contain 1..65280 bytes: the 64 KiB COM segment
minus the 256-byte PSP prefix. Ghidra uses `BinaryLoader` with real-mode language
and maps file offset zero at `1000:0100` (linear `0x10100`). A packaged pre-analysis
script seeds the entry function and CS/DS/ES/SS context `0x1000`. These settings
and the preparation policy are committed in the analysis profile; a failed
preparation prevents the resident bridge from serving results.

Load-image verification checks all original and modified file bytes, complete
source mapping/memory digests, absence of relocations, entry and measured register
context. The context is imposed for analysis, not observed from execution. PSP
memory, initial stack contents/SP, DOS interrupts and PC-98 devices are not
modeled. COM has no MZ header, relocation table or appended-overlay model; all
selected bytes belong to its analysis module. The original file stays unchanged.

## Addresses and function extent

Returned default-space addresses are linear byte coordinates. A Ghidra
segment:offset address has linear value `segment * 16 + offset`; multiple
segment aliases can identify the same byte. REA accepts the returned linear
address for subsequent lookups and leaves instruction decoding context with
Ghidra. These coordinates are analysis load addresses, not file offsets or
observations of a running DOS system.

Offsets that Ghidra would truncate to a different address are rejected before
reading or annotating a function. This also applies to explicit or encoded
address-space names; leading zeros preserve the numeric offset.

`procedure_info` and function dossiers include `body` evidence:

```json
{
  "available": true,
  "provenance": "ghidra-function-body-address-set",
  "ranges": [
    { "start": "0x10000", "end": "0x1000d" },
    { "start": "0x10060", "end": "0x10065" }
  ],
  "total_bytes": 20,
  "span_bytes": 102,
  "non_contiguous": true,
  "contains_entry": true
}
```

Each end is **inclusive**. `total_bytes` counts the complete observed
AddressSet; `span_bytes` measures its enclosing span and is null across address
spaces. Gaps and shared tails must not be treated as owned bytes. This is
Ghidra's database observation, not a proof of original source ownership or
exhaustive code discovery. Providers that do not report complete ranges return
`available: false` and an explicit reason.

## Loaded-image evidence

`inspect_native_load_image` independently checks the immutable session snapshot
against the loaded Ghidra Program. It measures complete original and modified
FileBytes digests, every source mapping and its memory digest, relocation records
(including multiplicity), and external entry points. It verifies MZ header and
module partitions, relocation fixups and linear coordinates rather than relying
on the imported executable SHA alone.

Expected DOS relocation records retain each fixup's pre-application bytes and
applied value. Their memory-byte windows come from the final relocated image,
including changes made by later overlapping fixups.

The result is `verified`, `mismatch`, or `unsupported`. Every check retains its
expected and observed values. A memory-digest mismatch identifies the source
range's file offset and analysis address; it does not locate the first differing
byte inside that range. Mapping ends are **inclusive**, unlike the exclusive ends
from `list_segments`. Appended overlays remain in source-file identity and are
excluded from initialized module coverage. Uninitialized allocations are reported;
their contents and DOS runtime semantics are not verified. Independent verification
also covers explicit [raw-binary imports](raw-binary.md); other formats return
`unsupported` with measured observations.

MZ verification retains the initialized image described by the header's page
count and streams appended overlay bytes into the complete original and modified
source digests. Overlay size does not increase the retained image allocation.

`read_bytes` returns initialized provider memory, including loader fixups; an
unmapped or uninitialized byte ends the read with an explicit returned length and
`complete: false`. `address_to_file_offset` uses the provider's source mapping;
unmapped, uninitialized and ambiguous mappings fail explicitly. A relocated word
can differ from the original file word even when its source offset is known.

## Coverage boundaries

Static decompilation does not execute the target or emulate BIOS, DOS
interrupts, device ports, or self-modifying code. PC-98 hardware behavior and
recovered calling conventions can remain uncertain; provider pseudocode and
diagnostics are retained for analyst review.

For a packed executable, importing the original can analyze its unpacking
stub. Analyze a separately prepared unpacked copy to inspect the original
program's recovered code. Retain both artifact digests and the transformation
evidence; REA never silently replaces the admitted target. Appended overlays
are separate from the initialized MZ module. Headerless COM requires the
[explicit COM interpretation](#headerless-com-images); REA does not guess it
from the filename or unrecognized bytes. DOS extenders without an admitted
MZ real-mode entry remain outside this import boundary.

DOS MZ is available through Ghidra, with no Hopper support claim. It is outside
the Windows native PE P0 boundary. macOS x64 DOS verification remains unverified.

## Real verification

```bash
npm run verify:ghidra:dos
```

The lane generates a small public fixture from source at runtime. It verifies
16-bit instruction bytes, a near call, a segment-relocated far call, actual
decompilation, disjoint function ranges, stable CLI/MCP observations, unchanged
input bytes, and session/process cleanup. It does not require external
executable fixtures, an emulator, or an existing analysis database.

Provider p-code representations can contain process-specific address-space selector
tokens. The lane preserves those reported values and compares stable dossier
observations rather than asserting cross-process identity of raw p-code.

## Function annotations

`annotate_native_function` changes the name and/or comments at one exact local function entry, verifies readback, and returns a refreshed dossier. This is useful when recording recovered DOS function roles; it does not claim original-source names. Name writes preserve the existing namespace; readback returns the fully qualified name used by function inventories. Regular comments map to Ghidra PRE comments and inline comments to EOL comments. Empty text clears a comment; omitted fields preserve it. The whole edit rolls back if a setter, readback or analysis fails.

```json
{
  "procedure": "0x10100",
  "name": "entry",
  "comment": "Recovered startup role",
  "inline_comment": "Inspect segment setup"
}
```

```bash
rea annotate-native-function /local/program.com 0x10100 --target-format dos-com --provider ghidra --name entry --comment 'Recovered startup role' --json
```

The CLI returns the updated analysis before closing its isolated session. MCP edits remain visible to later reads until `close_binary`. Original bytes remain unchanged, database edits are discarded on close, and immutable analysis snapshots are invalidated after edits. This operation does not save a Ghidra project, change ABI/types/body ranges, patch instructions, or emulate a DOS runtime. Windows P0 does not admit it.
