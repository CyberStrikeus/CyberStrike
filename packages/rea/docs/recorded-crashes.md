# Recorded crash evidence

`inspect_recorded_crash` / `rea inspect-recorded-crash` inspect a caller-selected
Linux ELF64 little-endian core independently of an active binary target. Apple
`.ips` crash reports use the separate [Apple IPS](apple-ips.md) workflow. Two
architecture profiles are interpreted, x86-64 and AArch64; each binds registers
to its own `NT_PRSTATUS` layout, and any other `e_machine` is refused as
`unsupported_target` before note interpretation.

```sh
export REA_PWNTOOLS_PYTHON=/absolute/existing/venv/bin/python
rea inspect-recorded-crash ./crash.core --json
```

The selected Python needs unchanged pwntools 4.15.0, pyelftools 0.33 and Unicorn 2.1.2.
REA does not install these dependencies. ELFFile/its original ELF structures and
pwntools' original Linux amd64 and aarch64 ctypes provide parsing and ABI layout.
The adapter adds bounds, representation preservation and lifecycle ownership.
The initial Linux note profile accepts System V/unspecified and GNU/Linux OSABI
with ABI version zero. Other declared ABIs return `unsupported_target` before
note interpretation; an unspecified OSABI alone does not prove OS origin.

## Recorded observations

- Artifact path, original SHA-256 and size; full normalized result and Evidence
  are inline through CLI and MCP.
- Original program headers and recorded segment file/memory ranges. Undumped
  memory and current executable/library identity remain unknown.
- Program headers and notes retain their original numeric `type_id` separately
  from the decoder's `type` label. Source binding and semantic decisions use the
  numeric identity; an architecture-specific display name does not establish
  support for that segment's payload semantics.
  Header `type` names follow the pinned parser's machine-specific projection:
  `PT_AARCH64_ARCHEXT` and `PT_AARCH64_UNWIND` denote `0x70000000` and
  `0x70000001` only for AArch64. The same codes on x86-64 remain numeric, as
  does AArch64's `0x70000002` in pyelftools 0.33. These display projections
  are checked against the architecture and source-bound `type_id`; they do not
  decode architecture compatibility, unwind or MTE payloads.
- Every note's original identity, owner/descriptor bytes and source ranges,
  including unfamiliar owners and note kinds.
  CORE symbolic note labels apply only to the exact `CORE\0` owner. Other
  owners keep numeric types, so GNU/type 3 remains opaque instead of acquiring
  CORE process-info semantics, and a GNU-owned numeric NT_FILE collision does
  not acquire debugger mapping authority.
- Every exact Linux CORE PRSTATUS note as a separate recorded thread, with
  historical PID, signal and lossless uint64 registers bound to source bytes.
  Each supported note has exactly one interpretation; each thread contains the
  complete ABI register set for its architecture (27 registers for amd64,
  34 for AArch64), with names bound to their original ABI offsets.
  Physical note ranges cannot overlap or leave segment gaps. ELF and note headers
  are independently bound to the snapshot, including extended program counts.
- Signed SIGINFO number/code/errno. Initially only SIGSEGV codes 1/2 establish the
  fault-address union; other variants retain raw bytes and unknown meaning.

Historical PIDs are metadata. They never select a live process or authorize
attach/control. Missing notes do not establish absence at the crash; note
interpretation completeness and signal-thread association remain unknown.

## Optional debugger mapping context

```sh
export REA_PWNDBG_GDB=/absolute/existing/gdb
export REA_PWNDBG_GDBINIT=/absolute/unchanged/pwndbg/gdbinit.py
export REA_PWNDBG_VENV_PATH=/absolute/existing/pwndbg-venv
rea inspect-recorded-crash ./crash.core --debugger-context --json
```

MCP uses `{ "path": "/artifacts/crash.core", "include_debugger_context": true }`.
Omitting this meaningful facet requests only recorded evidence. Requested but
unavailable context returns an actionable failure; it never silently claims
debugger coverage. GDB defaults to `/usr/bin/gdb`; the plugin and virtual
environment require explicit absolute paths. Initial local verification covers
Linux x64, GDB 13.1 and unchanged pwndbg 2026.09.15.

The outer provider owns both processes and one stable core snapshot. An owned
Python launcher lowers inherited soft limits before replacing itself with GDB.
GDB starts without initfiles, auto-load, debuginfod or automatic shared-library
loading. Owned empty library search paths and caches are used, with plugin
updates disabled. Debug-file lookup is also restricted to the owned empty
search directory. GDB 16 can otherwise locate the recorded executable independently
of these settings. While opening the core, fixed package code temporarily selects
`/proc/self/exe` (the already running debugger) with `exec-file`, without loading
symbols or running an inferior. This occupies GDB's executable slot and prevents
its automatic executable discovery. The validated decoder profile selects the
core architecture explicitly, so the placeholder cannot select it instead. The
bridge discards that selection with `file` before querying mapping candidates,
and verifies the core connection and absence of a main symbol file. Before launching GDB, the provider also checks
source-bound `NT_FILE` descriptors: mapping names must be absolute Unix paths
without dot segments. Relative names bypass GDB's sysroot, and traversal can
escape it. Unresolved or unsafe mapping coverage refuses debugger enrichment
while retaining the basic decoded observation and original bytes. No caller GDB
command language is exposed. The exact observed GDB/plugin version strings are
retained.

Mapping names are producer display metadata, with unknown current file identity.
Map permissions are derived from reported flags; zero/unfamiliar flags leave
permissions unknown. These maps do not establish page contents or an executable
match. Core source bytes remain available independently of this enrichment.
An Evidence envelope containing these maps is `derived`; inspection without
debugger context is `observed`.

## Bounds and verification

Initial Linux x64 limits: 32 MiB input, 64 MiB decoder reply, 1 MiB diagnostics per
stage, 30 seconds owned wall deadline per stage, 3 GiB address-space soft ceiling
and 30 seconds CPU soft ceiling. `REA_PWNTOOLS_MAX_INPUT_BYTES` raises the input
bound alone, up to 1 GiB, and returns `provider_unavailable` when it is not a
decimal integer in range; the reply, diagnostic and deadline bounds stay fixed, so a
large core that outruns them still fails explicitly instead of partially. Tighter
inherited soft/hard limits are retained; hard limits are not raised. Complete
oversized results fail explicitly. These process limits do not constitute a sandbox
for caller-supplied engine code.

Resource exit statuses need matching private failure-branch markers. Unmarked
launcher failures retain their actual status/output and unknown resource cause.
Cancellation, output truncation and independent owned cleanup remain explicit.

`npm run verify:recorded:crash` uses source-owned fixtures and caller-supplied
GDB/Python/pwndbg/strace. Fixture generation explicitly launches its owned test
program; subsequent inspection only reads the resulting core. Real acceptance
checks recorded threads, high registers, missing/malformed notes, opaque owners,
CLI/MCP parity, optional debugger context and historical PID collision with an
owned live sentinel. Authored AArch64 auxiliary-header and numeric-unknown
carriers also pass through the configured decoder and both public adapters;
they are metadata fixtures, rather than captured AArch64 crashes. Their expected
names follow [pyelftools 0.33's enums](https://github.com/eliben/pyelftools/blob/v0.33/elftools/elf/enums.py#L431-L435)
and [machine-specific selection](https://github.com/eliben/pyelftools/blob/v0.33/elftools/elf/structs.py#L179-L184).
The [AArch64 ELF ABI](https://github.com/ARM-software/abi-aa/blob/2025Q1/aaelf64/aaelf64.rst#program-header)
defines their raw codes. An observed Node thread group must launch the exact
ownership `ps` inventory before it can read that live process's `stat` or `status` for native
identity/UID facts. Only traced `CLONE_THREAD` members share this allowance;
exec-replaced threads, ordinary children, debugger and decoder processes cannot
use it. The purpose of stat/status reads within the same Node thread group
cannot be distinguished by strace. A second recording uses a valid
historical PID above the host's assignable PID range and rejects resolved lookups,
including Node `stat`/`status` reads, to detect historical-PID-driven access separately
from live inventory. Descriptor paths come from strace's `-yy` decoding; exact
PID-directory opens and relative accesses through those handles are rejected.
Failed FD-relative pathname attempts are checked across syscall variants.
Legacy relative pathname calls without dirfd/cwd evidence and symlink aliases
remain unverified; the verification report declares these gaps rather than
establishing their absence.
One syscall/selector contract supplies trace selection, target interpretation
and the report's explicit coverage catalog. Unlisted PID-directed syscalls remain
unverified. The catalog includes PID-directed resource
limits, scheduling, priority, process metadata, signals and pidfd controls.
Self, group and UID selectors retain their syscall-defined meanings; unresolved
targets cannot qualify. Coverage is reported once for all CLI/MCP traces and
does not establish containment of every possible kernel interaction.
The syscall trace also rejects access to the still-present
source executable. The CI workflow defines Ubuntu 24.04 and Debian 13 (GDB 16)
container lanes. Original inputs and host configuration remain unchanged.
