# Ghidra conformance corpus

These source-owned fixtures are compiled at verification time; generated
binaries and Ghidra projects are never committed.

- `../c/riscv.c` and `riscv-probe.S` produce source-owned RV32/RV64 ELF images
  with double-float ABI declarations and an independently known instruction.
  `../c/riscv-float-abi.c`, `riscv-probe.S` and `riscv-isa-probe.S` produce
  typed and stripped RV32 ilp32 images whose calls cover every rule of the ilp32
  policy; `riscv-checks.mjs` holds that policy's expected storage and the
  call-site oracle. `npm run verify:ghidra:riscv` exercises real CLI/MCP
  discovery, decompilation, argument storage, output schemas, profile and
  snapshot identity, admission and refusal diagnostics, immutable source bytes,
  and owned cleanup. It requires BYO Ghidra 12.1.4/JDK 21+ and RISC-V
  Clang/LLD/LLVM readelf/LLVM objdump; `REA_RISCV_CLANG`, `REA_RISCV_LLD`,
  `REA_RISCV_READELF` and `REA_RISCV_OBJDUMP` select existing tool commands.

- `ReaDecodeProbe.java` decodes source-owned instruction bytes from a
  language's default context and checks each mnemonic, length and optional
  complete operand. The `ghidra-bridge-sources` CI job runs it for `ARM:LE:32:Cortex`,
  `ARM:LE:32:v8-m` and `Xtensa:LE:32:default`; the bytes are never executed.
- `inventory.c` produces separate x86-64 debug and stripped ELF executables.
  It covers imports, an external `puts` function, linker thunks, source symbols,
  direct calls, a targetless callback call, two referenced strings, and a
  multi-block branch.
- `entry-aliases.c` preserves secondary imported entry labels, a bare-hex
  alias, and an interior label. The native CLI/MCP lane verifies entry selection,
  annotation, interior-label rejection, and unchanged source bytes.
- `cross-format.c` is freestanding so the verifier can produce AArch64 ELF,
  x86-64 PE, and x86-64 Mach-O targets from the same semantics. It preserves an
  exported entry, direct and indirect calls, a volatile string reference, and a
  multi-block branch across loaders.
- `no-return.c` and `ReaNoReturnProbe.java` inject incorrect import flags into a
  real ELF or Mach-O analysis database, verify caller recovery, propagated flag
  repair and signature preservation, and retain genuine/unknown no-return calls
  and independently identified entries. Run `npm run build:cached`, then
  `node scripts/verify-real-ghidra-noreturn.mjs` with the Ghidra/JDK environment
  below on Linux or macOS x64/arm64. On Linux, use a procps-compatible process
  table that exposes REA's current process for owned cleanup. It also checks
  named limitations through the real read-only TCP bridge and provider Evidence
  projection; default Unix-socket transport, Windows, and the reported Amethyst
  artifact need separate verification. Fixture target code is never executed.
- `ReaDecompilerFailureProbe.java` replaces the bridge decompiler after a real
  import of `cross-format.c`, so one function's decompilation fails. It checks
  that `analyze_function` still returns that function's assembly, callers,
  callees, references and basic blocks unchanged, marks pseudocode, native API
  and p-code value flow unavailable with the decompiler's reason, and that
  cancellation still ends the request. Run `npm run build:cached`, then
  `node scripts/verify-real-ghidra-decompiler-failure.mjs` on Linux or macOS
  x64/arm64. The lane also parses the degraded dossier with REA's Ghidra output
  contract and checks the healthy provider path through the real read-only TCP bridge.
  Decompiler failure marks only that observation as live: retain its Evidence,
  retry after backend recovery, and keep healthy dossier snapshot reuse.
  The injection does not establish which natural inputs make the decompiler
  fail.
- `node scripts/verify-real-ghidra-decompile-timeout.mjs` (after
  `npm run build:cached`, Linux or macOS x64/arm64) compiles a generated shared
  library whose `rea_slow` function has thousands of branches and analyzes it
  with `REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS=1` through the real read-only TCP
  provider. Ghidra's own decompiler stops at the limit with no injection:
  `analyze_function` returns the listing facets with pseudocode unavailable and
  a live cache policy, `procedure_pseudo_code` fails with a message naming the
  setting, and the same session then decompiles `rea_small`. Set
  `REA_DECOMPILE_TIMEOUT_BRANCHES` to change the fixture size. The verifier
  budgets 1 MiB for generated C source and derives the maximum branch count
  from the worst-case line size before allocating the source. Larger or
  invalid counts are rejected before installation inspection or compilation.

`scripts/verify-real-ghidra.mjs` uses `cc`, `clang`, and `lld-link` by default;
`REA_CC`, `REA_CLANG`, and `REA_LLD_LINK` can select alternate commands. The
verifier requires the verified bring-your-own Ghidra 12.1.4 installation through
`GHIDRA_INSTALL_DIR` and validates header classification before starting the
provider. Provider admission accepts newer 12.x (>=12.1) builds with an unverified-build limitation; this lane does
not.

Conformance compares semantic facts: provider/profile identity, function
classification, resolved call edges, typed references, strings/xrefs, and CFG
topology. It only requires provider pseudocode and assembly to be non-empty,
bounded, and address-bearing; it never compares their text with Hopper. The
callback fixture also proves that an unresolved targetless flow is not silently
promoted to a direct callee. Every target runs in a separate owned project and
must leave no process, socket, project, or runtime root after close.

`relative-switch-signed.S` covers signed halfword offsets, the CBZ zero-entry
route, and selector biases of 0, 2 and 10 in the AArch64 jump-table lane. The
nonzero biases exercise overlapping and disjoint typed label/index ranges. REA
retains Ghidra's typed labels when the compared selector has an earlier register
definition; additional labels remain unknown until their relationship to the
typed switch selector can be proved. The oracle rejects extra numeric labels
and verifies each retained target against the source instruction immediate.
