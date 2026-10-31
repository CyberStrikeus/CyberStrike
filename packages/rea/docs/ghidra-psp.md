# PSP static ELF analysis through Ghidra

This specialization builds on [generic MIPS support](ghidra-mips.md) for
[#1330](https://github.com/morluto/rea/issues/1330). It reuses REA's existing
CLI/MCP, Ghidra bridge, Evidence and snapshot workflows. Allegrex instructions,
PSP loading and calling conventions remain owned by
[ghidra-allegrex](https://github.com/kotcrab/ghidra-allegrex).

## Initial boundary

The initial profile is limited to Linux x64, little-endian ELF32 `ET_EXEC`,
`EM_MIPS` and the PSPSDK declaration `e_flags=0x10a23001`. Those bits declare
MIPS II, Allegrex, EABI32 and NOREORDER; they are not proof of every instruction's
semantics. The profile also requires an inspected version-0 MIPS ABI flags
record declaring ISA level 2/revision 0, 32-bit GPR and CPR1, no CPR2,
single-precision hard float (`fpAbi=2`), no ISA extension or ASEs,
`flags1=1` and `flags2=0`. These are the declarations independently reported by
PSPDEV v20261001's GNU readelf 2.44 and its 24-byte section dump. Missing,
uninspected, contradictory and other producer declarations are refused.
The PSP profile is not an exception to the generic MIPS32r2/o32 policy; that
separate gate is unchanged. Profile revision v2 records this corrected boundary.

PRX, relocatable/shared images, PBP/ISO/CSO containers, runtime emulation and live
code overlays are outside this first profile. Other hosts and flag combinations
are not silently admitted. File names do not identify a PSP target.

## Bring your own compatible extension

Install the extension in the selected Ghidra distribution at
`$GHIDRA_INSTALL_DIR/Ghidra/Extensions/ghidra-allegrex`, with its
`Module.manifest`, `extension.properties`, language files and loader JARs.
User-home installations are not searched because REA uses an isolated analysis
home. REA never downloads, installs, rebuilds or vendors the extension.

The published compatibility experiment used Ghidra **12.1.3**, extension
**v21.4**, PSPDEV **v20261001** and JDK 21. New public-provider results must be
reported separately from that historical bridge experiment. The extension's
`version` property declares its compatible **Ghidra version**, not its release
tag; the property must match the selected installation. Other same-version
builds are not described as independently verified merely because they pass
this metadata check. A malformed or unloadable extension still fails real import.

REA fingerprints installed extension files before resolving the analysis
profile and checks that identity again immediately before launch. Symlinks,
nonregular files, missing components and incompatible metadata are refused.
Inspection is bounded to 1,024 entries, 16 directory levels and 64 MiB, with
streamed file hashing and 64 KiB properties. Rebuilds or content changes yield a
different profile; an old snapshot is not silently reused with the new profile.
This is content identity, not a signature or a sandbox for installed code.
Do not modify the Ghidra installation while a session is running.

## Ordinary public interfaces

```bash
rea analyze /absolute/path/to/psp.elf --provider ghidra --json
rea function /absolute/path/to/psp.elf function_name --provider ghidra --json
```

MCP uses `open_binary` with an absolute path and `provider_id: "ghidra"`, then
ordinary inventory and function operations. The loader is explicitly
`PspElfLoader`, language `Allegrex:LE:32:default`, compiler `default`. The
handshake must confirm the language and compiler before serving observations.
Missing prerequisites return `PSP_EXTENSION_UNAVAILABLE` with an installation
remedy; no provider fallback or automatic installation occurs.

Evidence retains the `mips` architecture family and its PSP-specific profile,
including extension content identity. It also carries the VFPU and static-only
limitations. The extension does not model VFPU prefix effects completely;
nonempty decompiled code is not proof of correct vector behavior. Existing
session-local metadata editing does not change executable bytes or turn a
snapshot into a persistent Ghidra project.

## Verification

Use the existing real MIPS verifier with its PSP option. Required tools are
caller-supplied `make`, `psp-config`, `psp-gcc`, `psp-readelf`, `psp-objdump`,
`PSPDEV`, `GHIDRA_INSTALL_DIR` and a compatible `JAVA_HOME`.

```bash
npm run build:cached
node scripts/verify-real-ghidra-mips.mjs --psp
# In a disposable installation without Allegrex, test actual public refusals:
node scripts/verify-real-ghidra-mips.mjs --psp-missing-extension
# Generic MIPS must remain generic with Allegrex installed:
npm run verify:ghidra:mips
```

The generic verifier also checks that a section-truncated firmware copy is
refused when the target is opened. That check runs only in generic mode; the
PSP report explicitly records carved-PSP coverage as not run.

The maintained PSP fixture builds from `tests/conformance/psp/`, never executes,
and is independent of commercial game data. PSP GNU tools supply ELF/ABI,
raw ABI-record, symbol and encoding observations; REA's parsed target and saved
snapshot must agree with the independent ABI declaration. Public CLI/MCP must
recover known functions, a direct
call, the immediate `0x1234`, BITREV, a global word and a marker. The verifier
checks observed loader/language, original bytes, Evidence, snapshot reopening,
and an A-B-A target switch with different global contents at the same address.
A snapshot for A must not open B. Cleanup must finish before success is reported.

These checks are selected static facts, not full behavioral equivalence, VFPU
semantics or arbitrary PSP compatibility. Independently published PSP binaries
are supplemental calibration targets after payload classification and license
review; unsupported PRX/PBP must not count as a successful static-ELF case.
