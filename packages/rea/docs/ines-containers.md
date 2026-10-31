# Classic iNES container inspection

REA recognizes classic iNES from the `NES` + `0x1a` byte signature, independently
of the file extension. This read-only container inspection uses portable
Node.js file reads; it needs neither Ghidra nor an emulator.

```bash
rea inspect-artifact ./cartridge.nes --json
rea extract-artifact ./cartridge.nes --json
```

Through MCP, call `open_binary` with the local path, then `inspect_artifact`.
Use `extract_artifact` to materialize the regions in the fresh directory named
by its result. The caller owns that successful extraction directory.

## Header and file regions

Inspection returns `container-header` and `reconstruction` observations inline.
The single inventory Evidence under `substeps[].evidence.normalized_result`
contains the complete graph and an `ines` object:

- `ines.header`: original 16-byte `header_hex`, PRG/CHR file-unit counts, mapper,
  raw flags 6/7, trainer and battery flags, and the declared mirroring mode.
- `occurrences[]`: each region's path, `source_location.offset` and
  `source_location.length` in the original container. Follow `artifact_id` to
  the node's observed SHA-256 and byte count.
- `ines.reconstruction`: ordered region paths, concatenated byte count,
  SHA-256 and `verified: true`. REA accumulates the concatenation digest during
  the same physical-order region scan that produces node hashes, then compares
  it with the original whole-file digest. Final source freshness is also checked.
  No reconstructed file is written during inspection.

Regions are `header.bin`, optional `trainer.bin` (512 bytes),
`prg/000.bin` onward (16 KiB each), `chr/000.bin` onward (8 KiB each), and
optional `trailing.bin`. Every input byte is retained, including unused header
fields and uninterpreted trailing data. Zero CHR-ROM units create no CHR region;
REA does not fabricate CHR-RAM contents.

After extraction, concatenate the materialized files in
`ines.reconstruction.region_order` from the inspection inventory. Their bytes
reproduce the input exactly. Graph path order is lexical and is not physical
file order; use the explicit region order or source offsets.

## Supported boundary

This increment supports classic iNES with a complete 16-byte header, nonzero
PRG count, complete declared trainer/PRG/CHR payload, and zero reserved bytes
12–15. Dirty legacy headers are refused because their upper mapper bits are
ambiguous; REA does not silently repair them. NES 2.0 and UNIF signatures,
unsupported header variants and truncated payloads are explicitly refused.
An arbitrary file named `.nes` is not admitted as iNES.

The PRG/CHR units describe file storage, not mapper bank sizes or CPU windows.
The mapper number and flags are header declarations, not proof of cartridge
hardware or runtime behavior. Bank switching, 6502/65816 disassembly, emulator
sessions and interpretation of console-specific trailing data remain outside
this lane. Raw-binary Ghidra analysis is a separate workflow. This container
increment addresses the first milestone of [#2072](https://github.com/morluto/rea/issues/2072);
the related [#1641](https://github.com/morluto/rea/issues/1641) tracks 6502/65816
native analysis with explicit load addresses and provider limitations. Extracted
PRG units still need caller-selected CPU windows before static code analysis;
their physical file offsets do not establish those addresses.

Source-owned byte fixtures verify original offsets and hashes, extraction and
byte-exact reconstruction, CLI/stdio MCP parity, malformed/unsupported inputs,
failed target-switch recovery, cancellation and source identity. These checks
do not establish emulator behavior or compatibility with every historical ROM.
The portable CLI/stdio MCP acceptance and source-identity checks run in Linux
and macOS CI. The same workflows have also been executed on native Windows x64.

Format references: [iNES](https://www.nesdev.org/wiki/INES) and
[NES 2.0](https://www.nesdev.org/wiki/NES_2.0).
