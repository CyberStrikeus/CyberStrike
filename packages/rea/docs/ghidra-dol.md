# GameCube DOL analysis through Ghidra

This lane imports 32-bit big-endian PowerPC GameCube/Wii DOL images through
Ghidra. It does not execute the image. DOL is a headerless format with no magic
number, so REA never detects it: the caller must select it explicitly.

Only the cached MEM1 window `0x80000000..0x81800000` is admitted. Wii MEM2
and uncached aliases are outside this lane.

Not covered: small-data anchors (`r2`/`r13`), REL, RPX, and IDA or Hopper
support. See [Not supported yet](#not-supported-yet).

## Select the format

CLI:

```bash
rea inspect /absolute/path/to/main.dol --target-format gamecube-dol --provider ghidra --json
rea function /absolute/path/to/main.dol 0x80003130 --target-format gamecube-dol --provider ghidra --json
```

MCP, with the existing `open_binary` tool:

```json
{
  "path": "/absolute/path/to/main.dol",
  "provider_id": "ghidra",
  "format": "gamecube-dol"
}
```

The architecture comes from the DOL header (`powerpc`). Do not pass
`architecture` with `gamecube-dol`; it is rejected. `entry_point` is optional,
and if given it must equal the header entry.

Omitting `format` never imports a file as a DOL. Detection does not run for DOL.

## What the import does

REA reads the 256-byte DOL header at admission. It checks every section's file
range and load address. It records BSS/data overlaps and computes the exact
uninitialized BSS gaps once. Malformed headers are refused before Ghidra starts.

Ghidra then runs in two steps:

1. The standard `BinaryLoader` maps the whole file at base `0x0`, with
   `-processor` and `-cspec` taken from the language selection below.
2. The pre-script `bridge/ghidra/ReaGhidraPrepareDol.java` reads a section file
   that REA wrote from the parsed header, with versioned collection counts. It creates one initialized block per
   used text and data section at its load address, with file bytes from the
   section's file offset. The whole-file block is removed before the section
   blocks are created. Text is read-execute and data is read-write. It sets the
   entry point and labels the entry
   `__start`.

Sections that the header marks unused are not mapped. The 256-byte header and
any bytes between sections are not mapped either.

## BSS

A DOL has one BSS range, and it is not always disjoint from the data sections.
The domain parser computes the parts of BSS that no data section covers. Both
the pre-script and load-image attestation consume those parsed ranges. The
pre-script creates uninitialized read-write blocks only in those gaps. Where BSS overlaps a data slot, that slot
keeps its file bytes. Overlapping slot indexes are reported by the parser.

## Bound language

The default language is `PowerPC:BE:32:default` with compiler spec `default`,
which ships with Ghidra. The load-image attestation checks the language Ghidra
reports, not only the requested one.

### Optional Gekko/Broadway override

`REA_GHIDRA_LANGUAGE_ID=PowerPC:BE:32:Gekko_Broadway` selects the Gekko/Broadway
variant. The language is not in stock Ghidra. It comes from the GameCubeLoader
extension, by Cuyler, licensed under Apache-2.0. The extension ships
`ppc_gekko_broadway.ldefs` under its `data/languages` directory and must be
installed in the Ghidra installation's `Ghidra/Extensions` directory. The stock
lane never requires it.

Any other language id must start with `PowerPC:BE:32:`. Other languages are
refused with a specific constraint.

## Paired-single limitation

The stock `PowerPC:BE:32:default` language does not decode the paired-single
instructions that Gekko and Broadway add. Those words decode as bad or undefined
instructions. Use the Gekko override to decode them.

## Verification

The source-owned fixture is built from `tests/conformance/c/ppc.c`,
`tests/conformance/c/dol.c`, `tests/conformance/ghidra/ppc-probe.S` and the
linker script `tests/conformance/ghidra/dol-fixture.ld`. It is converted to a DOL
by `tests/conformance/ghidra/dol-fixture.mjs`. Its text is at `0x80003100`, and
its single BSS range overlaps data slot 1 and leaves a gap. The fixture is
never executed. The real GameCube or Wii game images are never used.

```bash
GHIDRA_INSTALL_DIR=/absolute/path/to/ghidra npm run verify:ghidra:dol
```

The lane needs the same toolchain as the PowerPC ELF lane: `REA_PPC_CLANG`,
`REA_PPC_READELF` and LLD. An independent DOL header reader and GNU readelf
(run on the source ELF) check the section table, file bytes, entry and BSS gap
before Ghidra starts. The checks never use REA's parser.

After import, the lane checks the load-image attestation (`verified`), the
bound language, the `__start` entry procedure, a direct call to the leaf
function, decompilation, and bytes at the data, tail, marker and BSS-gap
addresses. It also checks CLI identity.

The Gekko pass runs only when `PowerPC:BE:32:Gekko_Broadway` is in the Ghidra
installation's language catalog, the same catalog REA uses to admit
`REA_GHIDRA_LANGUAGE_ID`. A language that exists only in a user extension under
`~/Library/ghidra` is not admitted, so the lane prints
`skipped: PowerPC:BE:32:Gekko_Broadway (not in the Ghidra installation catalog that REA admits); stock lane still verified`
and still succeeds on the stock checks.

The ELF lane (`npm run verify:ghidra:ppc`) is separate. See
[PowerPC ELF analysis through Ghidra](ghidra-ppc.md).

## Not supported yet

- Small-data anchors: `r2` and `r13` are not seeded from the DOL header.
- REL (relocatable modules) and RPX (Wii U) are not admitted.
- IDA and Hopper refuse `gamecube-dol`. Ghidra is the only provider.
- Disc images (ISO/GCM) are not supported. Pass an extracted DOL file.
