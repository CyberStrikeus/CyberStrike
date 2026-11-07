# Firmware analysis

REA accepts **Binwalk 3.1.x** for region inspection and **Unblob 26.6.x** for
explicit extraction. The report parsers are verified with Binwalk 3.1.0 and
Unblob 26.6.4. Another build on those lines is accepted, the observed version
is reported, and a limitation records that the parser was not verified against
that build. This first firmware milestone is verified on Linux x64.
No device, root privilege, mount, emulation or execution of extracted programs
is needed. Arbitrary firmware bytes do not pass native executable admission;
select a returned ELF separately for supported Ghidra analysis.

On Linux, Binwalk and Unblob run as REA-owned processes and require a
procps-compatible `ps` on REA's `PATH`; see the shared
[Linux process prerequisite](installation.md#linux-owned-process-prerequisite).

## Caller-supplied tools

Provide existing tools using absolute executable paths, scoped to your shell:

```sh
export REA_BINWALK_COMMAND=/absolute/path/to/binwalk
export REA_UNBLOB_COMMAND=/absolute/path/to/unblob
```

REA does not install these tools, their dependencies or system packages. It
checks the tool's `--version` banner when executing a request. Binwalk must
print `binwalk <version>` and Unblob must print the version alone. Inspection and
extraction have independent prerequisites; one does not require the other.
Both require util-linux `prlimit`, normally `/usr/bin/prlimit`; override its
absolute path with `REA_FIRMWARE_PRLIMIT_COMMAND` if needed. `rea doctor` does
not currently inspect firmware readiness. Engine selection/version checks run
when the firmware operation is requested; successful general doctor checks do
not establish firmware tool or external-extractor availability.

REA retains at most 8 MiB of combined stdout and stderr per command. Exceeding
that diagnostic budget stops analysis with an explicit truncated-output error;
child process limits do not bound parent-side pipe retention. Completed commands
drain their output streams before recording diagnostics. Failed worker cleanup
retains the worker and workspace for retry before another request or at shutdown.

Unblob needs the external extractor for the selected format on its inherited
`PATH`: for example, `debugfs` for ext2/ext3/ext4. Its default Landlock sandbox
and skip rules stay enabled. Sandbox startup failures remain actionable errors;
REA does not retry with `--no-sandbox`. Missing extractors reported in a valid
analysis report retain partial results and dependency names inline.

Upstream sources are preserved unmodified as optional pinned submodules:

```sh
git submodule update --init third_party/binwalk third_party/unblob
```

Normal REA builds and npm packages do not include or build these sources or
engine binaries. See [upstream provenance](https://github.com/morluto/rea/blob/main/third_party/README.md).

### Windows submodule checkout

On Windows, the Unblob checkout stops with `error: invalid path`. Several
upstream test fixture names under `tests/integration/` contain characters,
trailing dots, or trailing spaces that NTFS does not allow; REA does not use
those fixtures. Keep the clone, exclude that directory, and retry from the
repository root in PowerShell:

```powershell
git -C third_party/unblob config core.protectNTFS false
git -C third_party/unblob sparse-checkout set --no-cone '/*' '!/tests/integration/'
git submodule update third_party/unblob
```

Both settings are required. While `core.protectNTFS` is enabled, Git for
Windows also rejects index paths that the sparse pattern excludes; the pattern
keeps the invalid names out of the worktree. The setting applies only to the
Unblob submodule. In Git Bash, prefix the `sparse-checkout` command with
`MSYS_NO_PATHCONV=1`; otherwise `!/tests/integration/` is rewritten as a
Windows path.

The extraction destination must be absent with an existing writable parent.
REA checks that selection before starting an engine and still acquires it
exclusively during publication. Invalid sources and destinations identify the
caller argument; failures inside an acquired workspace keep their own cause.
Published file `relative_path` preserves producer spelling for lineage; `path`
uses the writer's actual normalized filename. An extracted filename that cannot
be represented losslessly as UTF-8 fails publication explicitly with its raw
name bytes in hexadecimal instead of silently omitting the entry.
Unpublished symlinks retain the extracted tree's target bytes in lowercase
`link_target_hex`; `link_target` is null when those bytes are not valid UTF-8.
Older retained Evidence may omit the hexadecimal field. Unblob may have rewritten
the target before REA observed it, so these bytes are not necessarily those stored
in the firmware image.

## CLI and MCP

```sh
rea inspect-firmware-regions /path/to/firmware.bin
rea extract-firmware /path/to/firmware.bin /path/to/new-output
rea extract-firmware /path/to/firmware.bin /path/to/selected-output \
  --offset 64 --length 4096 --max-depth 3
```

The corresponding MCP tools accept the same intent:

```json
{
  "name": "inspect_firmware_regions",
  "arguments": { "path": "/path/to/firmware.bin" }
}
```

```json
{
  "name": "extract_firmware",
  "arguments": {
    "path": "/path/to/firmware.bin",
    "output_directory": "/path/to/new-output",
    "range": { "offset": 64, "length": 4096 },
    "max_depth": 3
  }
}
```

Both return Evidence with the original path and SHA-256, raw producer reports,
actual executable path/digest, version and limitations. Binwalk signature UUIDs
and Unblob blob IDs are producer-local identities; compare content hashes and
source ranges across runs. A matching version does not attest an installed
build's source revision, so that field remains unknown.

### Interpret the results

- Region offsets refer to bytes in the original firmware. `reported_size`
  preserves Binwalk's output; `size_basis=provider_reported_validation_unknown`
  reflects that Binwalk can replace unknown lengths with the next signature or
  EOF before serialization. Neither a signature nor its confidence byte proves
  a valid partition, encryption or runtime behavior.
- Extraction returns regular file paths, independently verified SHA-256 values,
  producer hashes when available, chunks, diagnostics and task derivations.
  Unblob's task report is unordered; REA resolves relationships by paths and
  blob IDs. Logical references use `$input`, `$output`, or `$output/<relative-path>`
  so a real file named `$input` stays distinct from the original input.
  Chunk offsets belong to the task's input file. Only chunks in the
  selected input have a known `root_file_range`, adjusted by the selected offset.
- Decompressed children have unknown original byte ranges and runtime addresses.
  Task lineage does not establish a byte-for-byte mapping through decompression.
- `partial` marks unknown/encrypted chunks, selected input bytes outside all
  reported chunk intervals, reported extraction problems,
  unpublished links/special files or reached depth limits. `complete` means the
  selected input is covered by reported chunk intervals and the engine finished
  its configured extraction without those reported conditions;
  default skip rules and format coverage still apply. It does not establish
  complete firmware reconstruction.
- `extraction_gaps` makes those conditions recoverable: a row identifies an
  unextracted region or a failed task/stage. A chunk retains its identity and
  byte range, plus its original-file range when it belongs to the selected input.
  `unclassified-range` rows identify selected input intervals with no reported
  chunk; their provider identity and handler stay null. An empty chunk inventory
  therefore cannot establish complete extraction of a nonempty selected input.
  A multi-file stage retains its reported ID and handler with unknown byte ranges;
  a standalone task failure keeps unavailable stage identity null. Rows retain exact dependency names from
  the producer's missing-dependency reports; an accepted report with no names
  remains a failure with unknown dependencies; no executable identity or specific installation step is inferred. Each row's `continuation_id`
  references one instruction in `extraction_continuations`, so many regions
  share recovery prose without losing any region identity. Instructions use
  already configured capabilities where one exists. Every extraction rerun
  requires a fresh absent `output_directory`, preserving the prior evidence.
  Unblob's declared `ERROR` severity establishes an extraction failure,
  including standalone `UnknownError` task exceptions. Warnings and resolved
  extraction problems remain diagnostics with partial coverage; they do not
  establish failed extractor stages. Standalone errors do not acquire a nearby
  chunk's handler or byte range.
  Nested unknown chunks use `inspect_firmware_regions` on the actual published
  child rather than repeating the same extraction with unchanged handlers.
  Inspection requires separately configured Binwalk (`REA_BINWALK_COMMAND`);
  without it, the inspection step is unavailable and the region remains unexamined. A listed gap does not
  mean the target is corrupt or that a retained region is empty; REA installs
  nothing.
- The destination must be absent, absolute, with an existing parent. Publication
  uses exclusive, symlink-resistant writes and durable digest readback. Existing
  destinations are never overwritten. This is not an atomic directory rename:
  a new tree can be visible while files are written. Failed uncommitted output
  is rolled back. Symlinks and special files are recorded without publication;
  empty directories, ownership and executable permission bits are not reproduced.

Select a verified native child for the existing tools:

```json
{
  "name": "open_binary",
  "arguments": {
    "path": "/path/from/extraction/usr/bin/program",
    "provider_id": "ghidra"
  }
}
```

Then use `analyze_function`, `inspect_native_api` or the other native primitives.
Native architecture and executable validation still apply. Generic
[MIPS ELF](ghidra-mips.md) and [RISC-V ELF](ghidra-riscv.md) lanes are separate
documents with their own admission boundaries. This milestone does
not add PPC decompilation, raw flash load profiles, bootloader/device
tree semantics, vulnerability scanning, emulation or hardware runtime capture.

## Resource and lifecycle policy

- Nonempty regular firmware inputs: at most **128 MiB**, copied and hashed into
  a private workspace before analysis. Growth beyond that allowance during
  copying receives the same typed input refusal as an already oversized file.
  Supply a stable copy within the allowance. No in-place source modification.
- One queued heavy operation per provider instance; Binwalk one thread and
  Unblob one worker. No automatic parallel extraction engines.
- Analysis defaults to **120 seconds**, from tool resolution and input snapshot
  through inspection and its final private-workspace cleanup, or extraction
  through report consumption and inventory, excluding queue waiting and retained
  cleanup admission. Inspection has no publication phase. Select `analysis_timeout_ms` in either MCP operation or
  `--analysis-timeout-ms` in either CLI command for slower analysis. Current
  results retain the actual budget; an absent historical value means unknown.
  Extraction publication and its final
  cleanup start a separate **120-second** budget; select
  `publication_timeout_ms` in MCP or `--publication-timeout-ms` in CLI for a slow
  destination. Valid budgets are integers from 1 through 2,147,483,647 ms (the
  timer representation limit). Publication timeouts identify their phase and
  verified file progress; verified writes before atomic commit are not a claim
  that output remains published after rollback. Caller cancellation applies to
  both phases and final cleanup. Phase handoff, publication commit and final
  completion also check monotonic elapsed time, so delayed timer callbacks
  cannot revive an expired budget.
- Analysis timeout recovery names the selected budget and the analysis control,
  not the later publication control. Keep the client call timeout above analysis,
  publication and cleanup headroom; keep the input/range/question unchanged.
  Resolve any reported incomplete cleanup before retrying. Raising wall time
  does not raise fixed CPU, memory, report, diagnostic or input limits.
- Inherited **1 GiB per-process address-space** limit,
  120 CPU seconds and zero core-dump allowance through `prlimit`.
- JSON reports: at most **8 MiB** and valid UTF-8; malformed encoding and
  oversized reports fail without repairing or truncating producer data.
  Exit status 0 is not an empty result: a missing, empty, malformed or
  oversized report fails with `unreadable_output`, its `report_state`, the
  command, exit status and captured output. REA does not retry automatically.
  Diagnostic output is bounded with exact captured byte counts.
- Default staging budget: **256 MiB** and **10,000 entries**, configurable using
  `max_output_bytes` / `max_output_files` (CLI `--max-output-bytes` /
  `--max-output-files`). Exceeding either selected staging budget returns a
  nonretryable resource constraint naming the selected limit. Depth defaults to
  3, allowed range 1–10.

Staging budgets are polled and rechecked after exit; short-lived overshoot is
possible. The per-file process limit is the larger of the selected payload budget
and the fixed report/diagnostic file allowances, so a small payload selection
still permits the mandatory report. A tighter inherited host limit still applies.
The inherited file-size limit bounds each file, not total storage;
address-space limits are per process, not an aggregate memory quota. Worker
count is not CPU affinity for every external extractor. These limits do not
claim cgroup/container containment. Cancellation cleans the owned process group
before removing its workspace; uncertain cleanup retains resources and blocks
further operations in that provider instance.

## Verification

Generate small public, source-derived fixtures into ignored `_reference/`:

```sh
npm run fixtures:firmware
npm run verify:firmware
```

Fixture generation requires existing Python 3 and a host C compiler (`cc`);
override with `REA_FIRMWARE_PYTHON` / `REA_FIRMWARE_CC`. The independent oracle
records gzip offset/length and extracted file hashes. Real verification checks
CLI/MCP, full-file and selected-range extraction, unknown chunks, depth limits,
content parity and unchanged source bytes. No binary fixture is committed.

The optional missing-extractor lane asserts dependency names and the owning
handler in `extraction_gaps`. Those assertions must be run against the pinned
Unblob release to establish real-provider coverage; synthetic producer fixtures
alone do not verify Unblob's report nesting or stage identities. The gap ownership
claims remain unverified against real Unblob until that lane runs.

Additional lanes are explicit, so the base lane stays small:

```sh
# Existing mke2fs and debugfs required; put debugfs on the scoped PATH.
REA_FIRMWARE_VERIFY_EXT4=1 npm run fixtures:firmware
REA_FIRMWARE_VERIFY_EXT4=1 npm run verify:firmware

# Existing Ghidra 12.x (>=12.1) and its declared JDK required.
REA_FIRMWARE_VERIFY_GHIDRA=1 npm run verify:firmware
```

`REA_FIRMWARE_MKE2FS_COMMAND` selects the optional ext4 fixture producer.
`REA_FIRMWARE_FIXTURE_ROOT` selects generated data storage.
`REA_FIRMWARE_TEST_ENTRYPOINT` can select an isolated installed npm package's
`scripts/rea.mjs` to verify the packaged CLI/MCP workflow. Real coverage here is
generated gzip/USTAR/ext4 with a Linux x64 ELF child; SquashFS, UBIFS, proprietary
firmware, other hosts and architectures remain unverified.

## Inspect ESP images

Use `inspect-artifact` / `inspect_artifact` on an ESP32-family app or
bootloader image, such as an OTA download or app partition, for its chip,
classified segments, checksum and SHA-256 results, descriptor and Secure Boot
v2 signature blocks. `extract-artifact` / `extract_artifact` writes one file
per segment and signature block. Reading is portable and needs no external
tool. See [ESP images](esp-image.md).

## Inspect ESP flash dumps

Use the same tools on a whole-flash dump, such as `esptool read-flash 0 ALL`
output. The inventory reports the bootloader, the partition table and how it
was found, each partition with its declared type, flags and digest, ESP image
facts for the bootloader and each app partition, and the OTA records with a
derived selection; the running partition stays unknown. Extraction writes
each partition, `nvs_keys` included, as an ordinary file. For a dump that
does not start at flash address 0, select `esp-flash-image` with
`flash_offset`. See [ESP flash images](esp-flash-image.md).

## Inspect extracted devicetrees

Use [`inspect_devicetree`](devicetree.md) / `rea inspect-devicetree` on an
extracted DTB for its node/property tree, reservations, hardware summary and
selected phandle relationships. FDT v16/v17 inspection is portable and requires
no external tool or disassembler.

## Inspect Intel HEX and S-record images

Use `inspect-artifact` / `inspect_artifact` on an Intel HEX or Motorola S-record
file for its address regions, declared start address and record facts, then
`extract-artifact` / `extract_artifact` for one raw file per region. Decoding is
portable and requires no external tool. See
[Intel HEX and S-record images](hex-records.md).

## Inspect U-Boot legacy uImages

`inspect-artifact` / `extract-artifact` recognize a legacy uImage by its
`0x27051956` magic and inventory it without running or decompressing it.
The root facts record the 64-byte header (architecture, OS, type, and
compression as raw values and names, load and entry addresses, image name,
and timestamp) with the header and data CRC32 verified; the stored payload
is extractable as `payload.bin`, and multi-file and script images additionally
expose each sub-image as `image-<n>.bin` from the stored size table. Declared
addresses are facts from the header, not proven entry points, and compressed
payloads stay as stored. Intel HEX/S-record and FIT images are separate
readers and are not covered here. See [U-Boot legacy uImage](uimage.md) for
component padding, preserved names, resource policies and verification scope.

## Inspect UF2 and DfuSe images

Use `inspect-artifact` / `inspect_artifact` on a UF2 file for each familyID's
address regions and its block numbering, or on a DfuSe file for its targets,
elements and DFU suffix, then `extract-artifact` / `extract_artifact` for one
raw file per region or element. A DfuSe suffix CRC mismatch follows
`integrity_policy`. Decoding is portable and requires no external tool. See
[UF2 and DfuSe images](uf2-dfuse.md).

## Inspect U-Boot FIT images

Use `inspect-artifact` / `inspect_artifact` on a U-Boot FIT (`.itb`) for its
images, declared load and entry addresses, configurations and verified hashes,
then `extract-artifact` / `extract_artifact` for one raw file per image.
Decoding is portable and requires no external tool. See
[U-Boot FIT images](fit-images.md).
