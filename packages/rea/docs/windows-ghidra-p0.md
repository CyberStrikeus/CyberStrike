# Windows Ghidra P0

This guide describes repository main. npm 4.1.0 includes the Windows
native bundle; check the [release boundary](installation.md#released-package-and-main)
before applying these instructions to an older published package.
Native x86 (32-bit) PE support is available on repository main; npm releases
through 5.0.0 admit x86-64 PE targets on Windows.

Status: experimental Windows x64 support for the read-only P0 boundary. Windows
package builds bundle native process, filesystem, and DACL controls. REA
uses them automatically when the analyst selects a Ghidra operation; no
additional permission flag or degraded mode is required.

## Supported boundary

- Windows 10+ x64 with fixed local NTFS target and temporary volumes;
- Node.js 22.x (>=22.23.4), 24.x (>=24.22.1), or 26.12.1+;
- an operator-installed Ghidra 12.x (>=12.1) distribution (verified with 12.1.4);
- a 64-bit full JDK inside that installation's declared Java range (JDK 21 or newer, with no maximum, for current 12.1 releases);
- an explicit native, non-managed x86, x86-64, ARMNT (Thumb-2) or ARM64 PE application/DLL, or a
  [raw NMOS 6502 image](raw-binary.md#nmos-6502) with a caller-supplied entry; and
- the 27 read-only Ghidra inventory, memory, and function-analysis operations.

Loaded memory reads and file offsets preserve Ghidra's observed source mappings.
PE load-image inspection returns an explicit unsupported attestation status.
Independent verification covers admitted DOS MZ, explicit COM, explicit
[raw-binary imports](raw-binary.md), and explicit
[GameCube DOL images](ghidra-dol.md) on their supported hosts, including the
admitted raw NMOS 6502 mapping on Windows. Windows P0 admission remains limited
to native PE and raw NMOS 6502 images. For x64 PE
NativeAOT RTR 9.1, the read-only snapshot parser can report metadata through
`inspect_native_load_image` and `inspect_native_data_type` without a JAR or
database mutation: MethodTable relationships, virtual slots and frozen strings.
`analyze_function` decompiles slot targets. Database reads of the rehydrated
bytes (`read_bytes`, `search_strings`) return nothing on this host. See
[NativeAOT](ghidra-nativeaot.md).

This boundary does not establish general Windows feature parity. Ghidra GUI
state, annotations, other target architectures and formats, and Hopper-only
operations remain unavailable through this provider. Managed PE/CLI inspection
uses its separate execution-free provider.

Raw 6502 imports retain the same native filesystem and process ownership
requirements. The complete image must fit in the 16-bit address space; no
console-specific cartridge loader, CPU variant, or bank-switching model is
implied. Run `npm run verify:ghidra:6502` with caller-installed `ca65`/`ld65`
to check the source-built fixture through real CLI and MCP workflows.

REA does not install or upgrade Ghidra, Java, Python, npm, Node.js, Hopper, or a
compiler. The adapter uses the packaged Java `HeadlessScript`; Python and
PyGhidra are not prerequisites. Users do not build the native addon.

REA selects its packaged bridge scripts by explicit path. Same-named files or
directories in the caller's working directory do not select a different
script or require users to clean that directory before analysis.

Native DLL analysis preserves the PE shared-library role in the analysis profile.
REA imports an immutable copy for static analysis; it does not load the library
into the analyst process or execute its entry routine. The source-owned DLL
fixtures have no entry routine or imports and expose two exported functions.
The same native snapshot, path-admission and cleanup requirements apply to EXEs
and DLLs.

## Configuration

```powershell
npm install --global rea-agents
$env:GHIDRA_INSTALL_DIR = "C:\tools\ghidra_12.1.4_PUBLIC"
$env:JAVA_HOME = "C:\tools\jdk-21"
$env:REA_ANALYSIS_PROVIDER = "ghidra"

rea doctor --json
rea providers --json
rea inspect "C:\fixtures\sample.exe" --provider ghidra --format json
```

`rea doctor` distinguishes installation prerequisites from native artifact or
OS failures. It checks the Ghidra release, headless launcher, full JDK, x64
host, and native controls. A missing or mismatched addon requires the matching
Windows x64 package; changing MCP registration cannot supply that artifact.
A filesystem or access failure identifies the failed native constraint.
An incompatible host uses `unsupported_host`. Missing, mismatched or unloadable
native artifacts use `runtime_missing` and doctor classification
`missing_dependency`. A verified artifact that Windows refuses to load, for
example under Smart App Control or an App Control policy, reports failure stage
`load`; restoring or reinstalling the file cannot fix it. A failed native
invocation or invalid inspection uses `runtime_unavailable` and doctor
classification `runtime_failure`; it does not
mean Windows x64 itself is unsupported. Provider diagnostics retain the failure
stage under `windows_native_failure`, together with the corresponding remediation.
Self-test failures preserve the native operation and OS error text. Check the
process's writable local NTFS temporary directory and the reported filesystem,
DACL, Job Object or cleanup constraint, then rerun doctor after resolving it.
Ghidra or Java reinstallation cannot resolve a native self-test failure. The
provider remains unavailable until all native controls are proven; a later query
may retry a failed native invocation, while artifact or malformed-inspection
failures remain stable for the process lifetime.
Other doctor checks, including unconfigured agent integrations, can remain
unready while Ghidra itself is available.

`rea setup` can register supported agent integrations and the bundled skill.
Its existing preview and approval apply to configuration writes. Setup
preserves valid Ghidra and Java settings even when a separate runtime
prerequisite is unavailable.

For MCP, register the resolved Node entry point and the same provider settings:

```json
{
  "mcpServers": {
    "rea": {
      "command": "C:\\tools\\node\\node.exe",
      "args": ["C:\\tools\\rea\\scripts\\rea.mjs", "mcp"],
      "env": {
        "REA_ANALYSIS_PROVIDER": "ghidra",
        "GHIDRA_INSTALL_DIR": "C:\\tools\\ghidra_12.1.4_PUBLIC",
        "JAVA_HOME": "C:\\tools\\jdk-21"
      }
    }
  }
}
```

These paths are examples. Use the actual package location and restart the MCP
client after registration changes. Cold Ghidra import can exceed a client's
short default request timeout; the real verification lane allows the existing
330-second provider startup deadline to complete.

## Native authority and target identity

The verified boundary excludes SUBST aliases and changing drive-letter/DOS-device
namespaces. REA does not claim a separate SUBST detector. Mounted-folder entries
that expose reparse tags fail component admission; broader namespace variants
have not been established by this lane. Requested paths, final handle paths,
volume serials, and file IDs remain separate observations.

The loader validates package version, ABI, Node-API compatibility, PE machine,
and artifact SHA-256 before loading the package-owned addon. Native failure
reasons remain distinct from a valid installation and an unsupported target.

PE header classification and SHA-256 come from the same open file. The Windows
provider admits native x86, x86-64, ARMNT (Thumb-2) and ARM64 PE applications and DLLs and rejects unsupported roles,
architectures, managed images, and malformed headers. The original selected
source coordinate is preserved for native admission. The original COFF machine is
retained separately from the normalized CPU family. ARM admission requires the
observed ARMNT machine 0x01C4; ARM64 requires 0xAA64. Legacy ARM (0x01C0), Thumb
(0x01C2), and unavailable machine facts do not select this Windows lane.
Without a caller-selected processor override, Ghidra's PE loader
selects the language from the PE machine field: ARM (`IMAGE_FILE_MACHINE_ARMNT`)
imports as `ARM:LE:32:v8` (Thumb), ARM64 (`IMAGE_FILE_MACHINE_ARM64`) as
`AARCH64:LE:64:v8A`. Explicit language/compiler selections remain caller choices
in the analysis profile and are recorded as explicit imports. The source
fixture verifier compares the complete observed language ID, not just its CPU
family prefix. ARM/ARM64 admission is a bounded extension of the x86/x64
lane. `npm run verify:ghidra:windows -- --arm` or `-- --arm64`, optionally
combined with `--dll`, selects encoded Thumb or ARM64 PE fixtures on a Windows
x64 host. The packaged verifier accepts the same flags. These fixtures are not
compiler-produced programs. ARM64EC (machine 0xA641) and ARM64X are not admitted;
this target support does not establish Windows-on-Arm host support.

Real Windows x64 verification with Ghidra 12.1.4 and JDK 21 completed the ARM64
application and ARMNT/Thumb DLL fixtures' 26 read-only operations, constant-return
decompilation, byte searches, CLI/MCP file-offset parity, source identity, and
owned cleanup. The DLL fixture also verifies the exported caller/callee
relationship. The x86/x64 compact-reference value-flow battery does not cover
ARM or ARM64 instructions. ARM64 EXE file-offset verification includes ambiguous
mappings; the single-section ARM32 DLL cannot exercise that case.

The runs used two logical CPUs, 512 MiB Node/JVM heaps, a 900-second startup
budget, and an explicit `REA_GHIDRA_DISABLED_ANALYZERS=WindowsResourceReference`
test configuration. Default-analyzer runs exceeded the selected startup budget;
resource-reference analysis and default-configuration completion are not
established by these results. A Microsoft-signed Coreinfo ARM64 application also
completed focused MCP decompilation, repeated readback, source-mapped memory
reads, unchanged-input and cleanup checks. On this constrained host the first
function query, including cold analysis, took about 434 seconds; its identical
same-session read took about 23 ms and returned about 4.6 KiB of Evidence. These
are individual observations, not general latency guarantees. Public ARM32
DLL verification also completed against Microsoft Visual C++ 2013 ARM
`msvcr120.dll`, including decompilation of its exported `abs`, repeated readback,
source-mapped bytes, unchanged-input and cleanup checks. Its first function
query took about 601 seconds; the same-session repeat took about 11 ms and
returned about 4.8 KiB of Evidence. After preserving original COFF machines in the
admission/profile, a further real Windows check rejected legacy ARM/Thumb and
retained ARMNT/ARM64 admission. A rebuilt-candidate MSVCR120 query completed
in about 407 seconds with a 15 ms repeat (4,830 bytes of Evidence), unchanged
input and complete cleanup. That retry selected an 1,800-second startup budget
after an additional 900-second attempt timed out. The resource bounds were
unchanged; these observations do not establish a speedup. Configured processor
selection is covered by profile tests, not these real-provider runs.

Admission opens and checks every path component without following a reparse
point. It retains handles, verifies local NTFS semantics, and observes volume
serial, 128-bit file ID, final handle path, requested path, and size. Reparse
paths, alternate streams, ambiguous coordinates, UNC paths, and other
filesystems are rejected with the actual constraint.

The snapshot streams from the admitted source handle on a background worker.
Its digest must match the parsed target digest. Ghidra imports that private,
immutable snapshot, and the bridge requires the imported program SHA-256 to
match before serving operations. Source and snapshot identities remain
separate diagnostic observations. Snapshot cancellation is checked between
64 KiB reads and cleanup waits for worker settlement.

## Private runtime, transport, and lifecycle

Runtime creation installs a protected DACL permitting exactly the current user
and SYSTEM. Readback checks the actual owner and ACEs by handle. Descriptors
and snapshots remain locked until owner cleanup. Child files inherit the
private boundary. Analysis runs with the caller's authority; these controls
are not a sandbox for the Ghidra engine or other processes using the same user.

Windows uses an authenticated listener bound to `127.0.0.1` on an ephemeral
port. The endpoint record contains only the literal loopback host and port.
The bridge writes a new record and closes its writer before the native reader
can admit it. The reader refuses concurrent writers and verifies its opened
object's private DACL. The random 256-bit bearer token stays in the private,
immutable session descriptor and is redacted from diagnostic output.

The batch launcher uses an absolute `cmd.exe`, fixed switches, delayed
expansion disabled, and quoted tokens. Command-interpreter metacharacters in
launch paths are unsupported. JVM home and temporary properties use quoted
`JDK_JAVA_OPTIONS`, preserving spaces. `APPDATA` and `LOCALAPPDATA` point into
the private runtime, isolating Ghidra preferences, logs, and caches.

Process creation assigns a suspended child atomically to an owned Job Object.
Membership and kill-on-owner-close policy are verified before resume.
Breakaway is disabled. Only the child's default file owner is normalized;
the caller token stays unchanged. Caller priority is preserved, and caller CPU
affinity is preserved whenever the caller and the child share a processor group. A child that
Windows places in another group keeps that group's default when the caller asked
for no bound of its own; a caller pinned to fewer processors than its group
holds is refused there rather than widened.
Close, cancellation, timeout, startup failure, and provider failure
terminate the job and verify all members have settled before runtime cleanup.
Cleanup removes admitted objects by handle and unlinks reparse entries without
following their targets. Abrupt owner death kills the job but can leave
private runtime files; crash-time transactional deletion is not claimed.

## Verification

See [native controls](https://github.com/morluto/rea/blob/main/native/windows/README.md) for the separate artifact
build lane and native boundary checks. Development tarballs without the built
artifact report native controls unavailable; publishing requires the verified
artifact and manifest.

```powershell
npm run verify:windows-native
npm run verify:ghidra:windows
npm run verify:ghidra:windows -- --x86
npm run verify:ghidra:windows -- --dll
npm run verify:ghidra:windows -- --x86 --dll
npm run verify:ghidra:windows -- --arm64
npm run verify:ghidra:windows -- --arm64 --dll
npm run verify:ghidra:windows:package -- --x86
npm run verify:ghidra:windows:package -- --dll
npm run verify:ghidra:windows:package -- --x86 --dll
npm run verify:ghidra:windows:package -- C:\fixtures\installed-rea C:\fixtures\sample.exe
```

The package lane must run with an ordinary, non-elevated user token. It exercises
CLI inspection and every admitted MCP operation, validates named canonical
input/output contracts, checks the source digest stays unchanged, and verifies
runtime cleanup. Use a source-owned fixture, one analysis process at a time,
and a bounded heap for real-provider verification.

The controlled GitHub workflow runs only default-branch code on its protected
self-hosted Windows environment. A separate Linux job builds the matching
native artifact. Hosted Windows CI verifies native controls and packaged
startup separately from real Ghidra acceptance. Broader hostile-target,
concurrently mutable-path, extraction, and IPC-security claims require their
own acceptance and are not implied by this P0 result.
