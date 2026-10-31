# RISC-V ELF analysis through Ghidra

This lane extends native ELF analysis for `EM_RISCV` targets. It does not
execute RISC-V code, emulate a boot sequence, or rehost firmware. It addresses
[#2063](https://github.com/morluto/rea/issues/2063) and follows the same
lane shape as [generic MIPS support](ghidra-mips.md).

## Admission boundary

ELF `EM_RISCV` (243) is retained as the provider-neutral `riscv` family. The
target also retains the raw ELF declarations that decide a lane: class, byte
order, `e_type`, `e_flags`, and the ISA string that `.riscv.attributes`
declares. Recognition does not mean every provider or RISC-V variant is
supported. Existing PE, managed and Mach-O architecture sets are unchanged.
Headerless inputs use the separate [raw-binary admission
boundary](raw-binary.md); raw RISC-V images are not supported.

The Ghidra lane admits little-endian `ET_EXEC` images with no `EF_RISCV_RVE`,
`EF_RISCV_TSO`, or any bit outside `EF_RISCV_RVC | EF_RISCV_FLOAT_ABI`, in one
of three lanes:

- ELF64 or ELF32 images that declare `EF_RISCV_FLOAT_ABI_DOUBLE` use Ghidra's
  stock double-float model unchanged. Their `.riscv.attributes` is not read for
  admission.
- ELF32 images that declare the soft-float ABI (`e_flags` float-ABI bits `0`,
  ilp32) use REA's [ilp32 calling-convention policy](#ilp32). They must also
  declare an RV32I base and only [decoded extensions](#isa-declarations) in
  `Tag_RISCV_arch`.

These are header declarations, not proof that every instruction conforms to
that ISA.

Provider selection returns the specific unsupported constraint rather than
guessing a compatible profile:

| Declaration                                                                | Outcome                                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Little-endian ELF64 `ET_EXEC`, double-float ABI                            | admitted, `RISCV:LE:64:default` + `gcc`, lane `elf64-exec-le-double-float-generic-v1`                                |
| Little-endian ELF32 `ET_EXEC`, double-float ABI                            | admitted, `RISCV:LE:32:default` + `gcc`, lane `elf32-exec-le-double-float-generic-v1`                                |
| Little-endian ELF32 `ET_EXEC`, soft-float ABI, decoded extensions only     | admitted, `RISCV:LE:32:default` + `gcc` with the `__rea_ilp32` prototype, lane `elf32-exec-le-soft-float-generic-v1` |
| ELF32 soft-float ABI without `Tag_RISCV_arch`, or with any other extension | refused; the reason names the extensions outside the decoded set                                                     |
| ELF32 single-float ABI (ilp32f)                                            | refused until its [written policy](#ilp32f) is implemented and verified                                              |
| ELF64 soft- or single-float ABI (lp64, lp64f), or the quad-float ABI       | refused; no verified calling-convention policy                                                                       |
| Big-endian                                                                 | refused; Ghidra 12.1.4 ships no big-endian RISC-V language                                                           |
| `ET_REL`, `ET_DYN`, other `e_type`                                         | refused with the declared value                                                                                      |
| `EF_RISCV_RVE`                                                             | refused; the embedded 16-register profile (x0–x15) needs its own processor specification                             |
| `EF_RISCV_TSO`                                                             | refused; the total-store-order memory model is unverified here                                                       |
| Reserved or newer `e_flags` bits                                           | refused with the offending bits named                                                                                |

`e_type` is the only load-shape declaration this lane reads. A fixed-address
`ET_EXEC` declaration does **not** establish static linkage: `PT_INTERP` and
dynamic dependencies are not inspected, and the session records that boundary as
a limitation rather than inferring a load model.

## Why the language is pinned

Ghidra's header-based selection is not reliable for RV32. The 12.1.4
`riscv.opinion` pins `variant="default"` for the 64-bit constraint and leaves the
32-bit constraint unpinned with the comment that the loader "must choose between
'default' and 'AndeStar' variants". Measured against the installed release tree:

| Fixture                                         | Ghidra auto-selection         |
| ----------------------------------------------- | ----------------------------- |
| RV64 ELF, `e_flags 0x5` (RVC, double-float ABI) | `RISCV:LE:64:default:gcc`     |
| RV32 ELF, `e_flags 0x5`, no Andes declaration   | `RISCV:LE:32:AndeStar_v5:gcc` |

So an ordinary RV32 image lands on an Andes processor model unless the language
is stated. REA therefore pins `RISCV:LE:32:default` or `RISCV:LE:64:default`
with the `gcc` compiler specification per class, records
`language_selection: provider-pinned-v1`, and refuses a caller-selected
`REA_GHIDRA_LANGUAGE_ID` or `REA_GHIDRA_COMPILER_SPEC_ID` that disagrees with the
pin without changing the requested override. An override that matches the pin is
accepted and recorded as `configured-v1`.

The soft-float lane pins the same `RISCV:LE:32:default` language. Every RV32
language in Ghidra 12.1.4, including the deprecated soft-float `RV32I`, `RV32IC`
and `RV32IMC` variants in `old/riscv_deprecated.ldefs`, uses the same
`riscv.ilp32d.sla` decoder; only the compiler specification differs. REA keeps
the generic language and corrects the calling convention instead.

## Calling conventions

Ghidra's generic RV32 compiler specification, `riscv32-fp.cspec`, models the
ilp32d ABI. Its default prototype passes `float` and `double` values in
`fa0`–`fa7` and returns them in `fa0`, and it passes a structure of one or two
floating-point members in floating-point registers. An ilp32 image passes all
of these in integer registers. Measured on Ghidra 12.1.4 with an ilp32 build of
the fixture in `tests/conformance/c/riscv-float-abi.c`, the stock model
decompiles `rea_riscv_abi_pick(1.5f, 2.5f, sel)` as
`rea_riscv_abi_pick(in_fa0,in_fa1,0x3fc00000)`.

### Decision record: D3, RISC-V float ABIs

Decided in [#7477](https://github.com/morluto/rea/issues/7477).

- **Choice.**
  - Admit little-endian ELF32 `ET_EXEC` images that declare the soft-float ABI
    (ilp32) through a new lane, `elf32-exec-le-soft-float-generic-v1`. Lane ids
    are built from their fields: `elf<class>-exec-le-<float ABI>-float-generic-v1`.
  - Keep the pinned `RISCV:LE:32:default` language and `gcc` compiler
    specification. After analysis, `ReaGhidraRiscvCallingConvention.java`
    derives the program-specific `__rea_ilp32` prototype from the program's
    default prototype as the [ilp32 policy](#ilp32) states. It installs the
    prototype through a Ghidra specification extension and assigns it, with
    dynamic storage, to every non-thunk function, every external function and
    every function definition. Thunks follow their targets. The script fails,
    and writes no report, if the derived prototype or any function still
    places a value in a floating-point register, or if the prototype does not
    pass a 16-byte value by reference.
  - One derivation serves every policy. A policy row says how it changes the
    default prototype's floating-point entries and preserved registers; every
    policy passes values of 9 bytes or more by reference.
  - The profile commits `riscv_calling_convention: ilp32-prototype-v1`. The
    bridge reports the policy and its function and definition counts, and REA
    requires that report exactly when the profile commits the policy.
  - Admission requires a `Tag_RISCV_arch` declaration with an RV32I base and
    only extensions that Ghidra 12.1.4's generic RV32 language implements with
    p-code ([ISA declarations](#isa-declarations)).
  - Soft-float profiles add `float_abi` and `arch` to `riscv_elf`. Double-float
    profiles keep their exact parameters, so their digests, sessions and
    snapshots are unchanged.
  - ilp32f keeps its [written policy](#ilp32f) and stays refused until its
    prototype is implemented and verified. Quad-float, RVE, TSO, and ELF64
    soft- or single-float images stay refused.
- **Alternatives** (and what switching to each would take):
  - Pin the deprecated soft-float languages (`RISCV:LE:32:RV32IMC` and others,
    `riscv32.cspec`): REA's language catalog would have to read `old/`, the
    variants cover only I, IC and IMC, Ghidra marks them deprecated, and no
    stock specification models ilp32f.
  - Assign `__rea_ilp32` only to callables whose types use floating-point
    values, as the MIPS soft-float lane does: typed storage is the same, but
    prototypes Ghidra infers for untyped code would keep the ilp32d model. In
    an ilp32 image that contains F or D instructions, that model can still
    claim `fa0`. Switching is one predicate in the Java script and a new
    policy id.
  - Admit with a limitation and no correction: a reduced-capability contract
    that needs its own review, because arguments, returns and aggregates
    become unverified.
  - Keep refusing: the lane rows become refusals again.
  - Admit images without `Tag_RISCV_arch`, or refuse a list of known
    extensions instead of admitting a list: a declaration that REA cannot
    check would be treated as compatible. Widening the decoded set later is
    additive.
  - Add `float_abi` and `arch` to double-float profiles as well: one shape for
    every lane, but every existing RISC-V session and snapshot would be
    invalidated.
  - Ship ilp32 and ilp32f together (the question in #7477): ilp32f needs a
    float-and-integer structure rule that Ghidra's model lacks, so it ships
    separately with its own fixtures.
- **Semantic owner and consumers.**
  - Owners:
    - `src/domain/riscvIsaDeclaration.ts` owns the float-ABI vocabulary of
      `e_flags` and the parsing of `.riscv.attributes` and `Tag_RISCV_arch`.
    - `GHIDRA_RISCV_LANES`, `GHIDRA_RISCV_CALLING_CONVENTIONS` and
      `GHIDRA_RISCV32_DECODED_EXTENSIONS` (`src/ghidra/GhidraRiscvProfile.ts`)
      own admission, lane ids and the policy table.
    - `bridge/ghidra/ReaGhidraRiscvCallingConvention.java` owns how each policy
      becomes a Ghidra prototype.
  - Consumers: target resolution, Ghidra provider admission, the analysis
    profile, the provider client and launcher, the session handshake, project
    history, the real-Ghidra lane and this page. Later work reuses the table:
    ilp32f adds a row, and RISC-V ESP images (F6) select a row through D5.
- **Costs of changing it.**
  - **Code:** S. A policy or lane is one table row plus the Java derivation.
  - **Compatibility:** the soft-float lane id, `riscv_elf.float_abi`,
    `riscv_elf.arch` and `riscv_calling_convention` are persisted in sessions,
    snapshots and Evidence once released. A changed derivation ships as a new
    policy id, such as `ilp32-prototype-v2`, which invalidates soft-float
    snapshots only.
  - **Migration:** none for admitted targets; double-float profiles are pinned
    by tests. Previously refused soft-float targets become admitted.
  - **Verification:** rerun `npm run verify:ghidra:riscv`.

### ilp32

Policy `ilp32-prototype-v1`, prototype `__rea_ilp32`. XLEN is 32 bits and no
floating-point register passes a value.

| Topic                      | psABI rule                                                                                                                                                                                        | `__rea_ilp32`                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Integer and pointer values | `a0`–`a7`, then the stack in 4-byte-aligned slots                                                                                                                                                 | The default integer and stack entries, unchanged                                                                                    |
| `float`                    | One integer register, or a stack slot                                                                                                                                                             | The `fa0`–`fa7` entries and the `float` rule are removed, so a `float` takes the next integer register                              |
| `double` and 8-byte values | A register pair with the low word in the lower register. Named arguments need no aligned pair. With one register left, the low word goes in `a7` and the high word on the stack                   | The default `join` rule with stack spill: Ghidra writes `a2:4,a1:4` for a pair and `Stack[0x0]:4,a7:4` for the split                |
| Aggregates up to 8 bytes   | One or two integer registers, laid out as in memory, also when every member is floating-point                                                                                                     | The homogeneous-float-aggregate rule is removed; the `join` rule applies                                                            |
| Aggregates over 8 bytes    | By reference: the caller passes the address of a copy                                                                                                                                             | The default rule that converts structures and unions of 9 bytes or more to pointers                                                 |
| Return values              | As the first argument of the same type: `a0`, or `a0` and `a1`. Larger values go to a caller buffer whose address is an implicit first argument in `a0`                                           | The `fa0`/`fa1` return entries and floating-point rules are removed; Ghidra's hidden-return fallback supplies the pointer in `a0`   |
| Variadic arguments         | The integer convention. A variadic argument with 8-byte alignment and size takes an aligned (even-numbered) register pair, or the stack; after the first stack argument, the rest go on the stack | The default variadic rule (`join` with alignment), unchanged                                                                        |
| Preserved registers        | `s0`–`s11` and `sp`; `gp` and `tp` are not allocated. No floating-point register is preserved                                                                                                     | The default preserved list without `fs0`–`fs11`, which join the killed-by-call list                                                 |
| Scalars over 8 bytes       | By reference (`long double` is 16 bytes), and returned through a caller buffer                                                                                                                    | A rule before the final join converts any value of 9 bytes or more to a pointer; a return that size already goes to a caller buffer |

Ghidra recovers the arguments of a variadic call from the registers the caller
writes, not from their types. A padding register that still holds an earlier
value can appear as an argument, and arguments after an unwritten register are
omitted.

### ilp32f

Written policy for `EF_RISCV_FLOAT_ABI_SINGLE` on ELF32. REA does not admit it
yet. ABI_FLEN is 32 bits.

| Topic                                                   | psABI rule                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `float`                                                 | `fa0`–`fa7` while one is free, then the integer convention                                       |
| `double` and other values wider than 32 bits            | The integer convention, as in ilp32                                                              |
| Structure of one or two floats (after flattening)       | One floating-point register per member when enough are free, otherwise the integer convention    |
| Structure of one float and one integer, in either order | One floating-point and one integer register when both are free, otherwise the integer convention |
| Unions                                                  | Never flattened; the integer convention                                                          |
| Return values                                           | As the first argument: `fa0`, `fa0` and `fa1`, or `fa0` and `a0`                                 |
| Variadic arguments                                      | The integer convention, as in ilp32                                                              |
| Preserved registers                                     | `s0`–`s11`, `sp`, and `fs0`–`fs11` for values of 32 bits or fewer                                |

The planned prototype limits the default floating-point entries to 4 bytes and
keeps the shared rule that passes values of 9 bytes or more by reference.
Observed on Ghidra 12.1.4, a `double` then takes an integer pair and a structure
of two floats takes `fa0` and `fa1`. Ghidra's model has no rule for a structure
of one float and one integer: it joins `struct { float; int; }` into `a1:a0`
instead of `fa0` and `a0`. The ilp32f policy needs that rule and its own
fixtures before it is admitted.

### ilp32d and lp64d

The double-float lanes use Ghidra's stock `riscv32-fp.cspec` and
`riscv64-fp.cspec` models unchanged. This page does not verify them. They share
the float-and-integer structure gap above.

## ISA declarations

The target reader finds the one `SHT_RISCV_ATTRIBUTES` section and reads
`Tag_RISCV_arch`, such as `rv32i2p1_m2p0_c2p0_zicsr2p0_zifencei2p0`. It
retains the string, the base and the extension names, or an unavailable reason
when the section is malformed, declares other vendors or scopes, or uses a
non-canonical string. A missing section or tag is recorded as absent.

Calling-convention lanes admit an image only when it declares an RV32I base
and only extensions that Ghidra 12.1.4's generic RV32 language implements with
p-code: `m`, `a`, `f`, `d`, `c`, `zicsr`, `zifencei`, and the subset names
toolchains record, `zmmul`, `zaamo`, `zalrsc`, `zca`, `zcf` and `zcd`. Any
other extension is refused. In particular:

- Ghidra 12.1.4 decodes no Zcb, Zcmp or Zcmt instruction.
- Its bit-manipulation, cryptography and packed-SIMD files follow draft
  encodings and mark nearly every instruction unimplemented.
- Vendor extensions, such as Espressif's `xesploop`, `xespv` and `xespdsp`,
  decode only as custom-opcode placeholders.

ESP-IDF builds ESP32-C2 and C3 images as `rv32imc_zicsr_zifencei` and ESP32-C5,
C6, C61, H2 and H21 images as `rv32imac_zicsr_zifencei_zaamo_zalrsc`, all ilp32.
Those base strings are admitted. Builds that add `_zba_zbb_zbs`,
`_zcb_zcmp_zcmt` or an `xesp` extension are refused.

## Evidence

The lane identity is one of the lane ids above, and `riscv_elf` retains
`elf_class`, `byte_order`, `type`, and the raw `flags` alongside the read-only
booleans `float_abi_double`, `rvc_declared`, `rve_declared`, and
`tso_declared`. Soft-float profiles also retain `float_abi: soft`, the declared
`arch` string, and `riscv_calling_convention: ilp32-prototype-v1`. Those fields
report declarations the header and attributes make, and the policy REA applied;
none of them is evidence of the original compiler or of instruction
conformance. Session Evidence states the prototype and how many functions and
definitions use it.

## Verification and limits

Ghidra 12.1.4 PUBLIC with a 64-bit JDK 21+ is required, and on macOS the release
tree ships no host decompiler binary, so `Decompiler/os/<platform>/decompile` and
`sleigh` must come from your own build; see
[installation](installation.md#ghidra).

Run `npm run verify:ghidra:riscv` with an existing Ghidra 12.1.4 installation,
JDK 21+, and a RISC-V-capable Clang, LLD, LLVM readelf and LLVM objdump. The
verifier acquires no tools and never executes target code. Select installed
tools explicitly when they are not on `PATH`:

```sh
GHIDRA_INSTALL_DIR=/path/to/ghidra_12.1.4_PUBLIC \
JAVA_HOME=/path/to/jdk-21 \
REA_RISCV_CLANG=/path/to/llvm/bin/clang \
REA_RISCV_LLD=/path/to/lld/bin/ld.lld \
REA_RISCV_READELF=/path/to/llvm/bin/llvm-readelf \
REA_RISCV_OBJDUMP=/path/to/llvm/bin/llvm-objdump \
npm run verify:ghidra:riscv
```

The lane builds four `ET_EXEC` fixtures from committed freestanding C and
assembly sources:

- RV32 and RV64 double-float builds (`rv{32,64}imafdc`) of `riscv.c`.
- An RV32 soft-float build of `riscv-float-abi.c` with ESP32-C3's
  `-march=rv32imc_zicsr_zifencei -mabi=ilp32`, typed with DWARF.
- The same objects linked with `--strip-all`. Every allocated section keeps
  its address and bytes, so the typed build's symbols locate its functions.

Independent LLVM readelf observations establish ELF declarations,
`Tag_RISCV_arch` and symbol addresses. Public CLI and stdio MCP workflows verify
function enumeration, decompilation, pinned language/compiler identity, the
committed lane and policy, decoded probe bytes, global data, and direct calls.
They validate advertised MCP output schemas and both JSON representations, save
and reopen snapshots, and check unchanged source bytes and owned cleanup.

For the soft-float builds the lane also checks:

- `fence.i` and `csrr` decode, as ESP32-C3's Zifencei and Zicsr declare.
- An LLVM objdump reading of `rea_riscv_abi_caller` finds each call-site word
  where the [ilp32 policy](#ilp32) puts it: an unaligned `double` in `a1`/`a2`,
  the `a7`/stack split, two floats in an integer pair, a large structure and a
  `long double` passed by reference (the pointed-to copies hold the source
  values), aligned variadic pairs, and an indirect call.
- `inspect_native_api` reports `__rea_ilp32` with exactly that storage for the
  typed build. The stripped build has one integer word per parameter location
  and returns in the typed build's registers, or in none when the result goes
  through caller memory.
- The caller's pseudocode passes the source constants through that storage and
  names no floating-point register.
- Retained Evidence states the prototype outcome; the stripped build has no
  function definitions.

Header-mutated copies check admission. The RV32 double-float image relabelled as
soft-float (`e_flags` `0x1`), refused before this lane, is admitted through the
soft-float lane over CLI and MCP. The soft-float image relabelled as
single-float, RV64 soft-float, and unsupported high bits are refused with their
reasons. Failures retain the diagnostic workspace; successful runs remove it and
report the observed process lineage.

Module tests cover admission, malformed headers and attribute sections, the
handshake, and the conformance checks against recorded LLVM and Ghidra output.
Call-graph completeness, string inventories, dynamic linkage, Andes or RVE/TSO
images, big-endian targets, ilp32f images, and decoding beyond the probes are
**not** established by this lane.
