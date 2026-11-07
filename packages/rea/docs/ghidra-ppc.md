# PowerPC ELF analysis through Ghidra

This lane extends native ELF analysis to 32-bit big-endian PowerPC; it does
not execute PowerPC code. It is the first milestone of
[#1741](https://github.com/morluto/rea/issues/1741). GameCube/Wii DOL
executables are covered by [GameCube DOL analysis](ghidra-dol.md). PPC64 and other
PowerPC variants remain separate follow-ups.

## Admission boundary

ELF `EM_PPC` (20) is retained as the provider-neutral `powerpc` family. The
target also retains class, byte order, `e_type` and raw `e_flags`. Recognition
does not mean every provider or PowerPC variant is supported. `EM_PPC64` (21)
is not recognized as this family.

The Ghidra lane admits ELF32 `ET_EXEC`, big endian. ELF64, little-endian,
relocatable and shared objects are refused with a specific unsupported
constraint. `EF_PPC_EMB` declares an embedded variant and is refused; the
remaining `e_flags` bits only declare relocation conventions and do not change
instruction decoding.

## Bound language

Ghidra's ELF loader selects `PowerPC:BE:32:e500:default` for a plain `EM_PPC`
header with `e_flags` 0. e500 is the embedded Book-E variant whose SPE unit
replaces the classic floating-point unit, so it misinterprets ordinary
750-family code. Nothing in the header distinguishes the two.

The lane therefore imports with `PowerPC:BE:32:default` and compiler spec
`default`, commits that choice in the analysis profile as
`language_selection: "provider-pinned-v1"`, and checks the language Ghidra
reports after import. A different language set through
`REA_GHIDRA_LANGUAGE_ID` (and optionally `REA_GHIDRA_COMPILER_SPEC_ID`)
replaces the lane default and is admitted against the installed language
catalog as usual; for example `PowerPC:BE:32:e500` for genuine e500 code.

PowerPC header facts are committed in the analysis profile so interpretation
changes invalidate profile-bound snapshots. The support-lane identity is
versioned independently of file identity. Evidence, lifecycle outputs and saved
snapshots preserve the `powerpc` family. Hopper and IDA adapters do not
implicitly gain PowerPC support. Windows Ghidra P0 remains PE x86/x86-64 only.

## Use

With a caller-installed Ghidra and compatible JDK on a supported Linux/macOS host:

```bash
rea analyze /absolute/path/to/ppc.elf --provider ghidra --json
rea function /absolute/path/to/ppc.elf function_name --provider ghidra --json
```

MCP uses the existing tools, including `open_binary` with an absolute path and
`provider_id: "ghidra"`. No PowerPC-specific tool catalog or emulator is
introduced.

## Verification

The source-owned freestanding fixture is `tests/conformance/c/ppc.c`. The
optional cross-target lane requires a caller-supplied Clang with the PowerPC
target, LLD, GNU `readelf`, Ghidra and its compatible JDK; ordinary host-native
checks do not acquire these tools. `REA_PPC_CLANG` selects Clang and
`REA_PPC_READELF` selects GNU readelf (for example
`/opt/homebrew/opt/binutils/bin/readelf` on macOS). These are test-time
prerequisites, not REA runtime providers.

```bash
GHIDRA_INSTALL_DIR=/absolute/path/to/ghidra npm run verify:ghidra:ppc
```

The lane compiles the fixture for a 750-family core (`-mcpu=750`) and never
executes it. GNU readelf independently supplies header facts and symbol
addresses, compared with the production REA target resolver before provider
startup. Its version, bounded command output and selected tool path are
retained in the verification report. The parser deliberately recognizes only
this fixture's GNU output, rejecting missing, ambiguous or unexpected fields
rather than substituting defaults.

Existing public MCP operations check Ghidra's **observed** language and
compiler specification and loaded-file hashes; an e500 import fails the lane.
The source-owned `ppc-probe.S` supplies fixed `addi` and conditional-branch
encodings: verification checks bytes, length, immediate and direct destination,
independent of decompiler variable names. Global and string bytes are checked at
independently reported symbol addresses.

CLI/MCP discovery and decompilation, direct calls, target/profile/Evidence
identity, snapshot round-trip and final process cleanup remain covered.
Pseudocode presence is a liveness check, not proof of semantic equivalence.
Instruction decoding and reader agreement do not establish runtime or complete
floating-point semantics. Parser/profile tests are narrower checks, not
substitutes for this real-provider run. Report the actual lanes run and leave
unexecuted verification pending.
