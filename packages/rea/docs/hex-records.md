# Intel HEX and S-record images

REA inventories Intel HEX (I8HEX, I16HEX, I32HEX) and Motorola S-record (S19,
S28, S37) programming files through `inspect-artifact` / `inspect_artifact`, and
materializes their decoded bytes through `extract-artifact` /
`extract_artifact`. Decoding is static and needs no external tool.

```sh
rea inspect-artifact ./firmware.hex --json
rea inspect-artifact ./firmware.s37 --detail summary --evidence_output evidence.json --json
rea extract-artifact ./firmware.hex --json
```

For MCP, open the file with `open_binary`, then call `inspect_artifact`. Summary
delivery retains the complete Evidence; use `parent_evidence_id` with
`inspect_analysis_view` to read selected regions and fields. `extract_artifact`
returns a fresh `output_root` containing one raw file per region.

## Recognition

A file is recognized only when its first line, starting at byte 0, is a fully
valid record: correct start character, hex digits, byte count, checksum, known
record type and fixed length. The file name does not matter. A byte-order mark,
a leading blank line or an invalid first record leaves the file unrecognized,
so it falls through to plain `file` classification. Recognition never searches
for a record later in the file. The container formats are `intel-hex` and
`srec`.

## Regions and metadata

Each inventory entry is one address-contiguous region of decoded bytes, named
`0x<start>-0x<end>.bin` with an inclusive end address of eight lowercase hex
digits, for example `0x08000000-0x0800001f.bin`. Regions are listed in ascending
address order. Out-of-order records are sorted into regions; gaps separate
regions and are never filled.

Region `format_metadata` (`hex-record-region`) records `start_address`,
`end_address`, `length`, `record_count`, and `first_line`/`last_line`: the
1-based line span of the contributing data records.

Root `format_metadata` (`hex-records`) records:

| Field                                             | Meaning                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `encoding`, `variant`                             | `intel-hex` or `srec`; the variant derived from the record types seen, or `mixed` |
| `line_count`, `record_count`, `data_record_count` | Lines read, non-blank records, and data records                                   |
| `data_bytes`, `duplicate_bytes`, `region_count`   | Unique decoded bytes, bytes rewritten with identical values, and regions          |
| `lowest_address`, `highest_address`               | Address bounds of the decoded bytes, or `null` without data                       |
| `termination`                                     | Whether Intel `01` or S-record `S7`/`S8`/`S9` was present                         |
| `start_address`, `start_address_record`           | The Intel `05` EIP or the `S7`/`S8`/`S9` address, with its record type            |
| `start_segment_cs`, `start_segment_ip`            | The Intel `03` CS:IP pair                                                         |
| `header_hex`, `header_text`                       | S-record `S0` data as hex, and as text only when every byte is printable ASCII    |
| `declared_data_record_count`                      | The last `S5`/`S6` count, validated against the data records before it            |

`variant` is `null` for an S-record file in which no data or termination
record establishes an address width. Start addresses are declared facts, not
proven entry points.

## Facts, limitations and failures

| Situation                                                                                  | Outcome                                                                      |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Gaps between regions                                                                       | Separate regions; never zero-filled                                          |
| Out-of-order records                                                                       | Sorted into regions                                                          |
| An address written twice with the same value                                               | Accepted and counted in `duplicate_bytes`                                    |
| An address written twice with different values                                             | Fails, naming the address and the line spans of both writes                  |
| Checksum mismatch, odd hex length, non-hex character, byte count disagreeing with the line | Fails with the line, declared and computed values, and record type           |
| Line longer than 521 (Intel) or 514 (S-record) characters, excluding the line ending       | Fails before the line is decoded                                             |
| Intel type `06` or higher, `S4`, wrong fixed length for Intel `01`–`05` or `S5`–`S9`       | Fails                                                                        |
| Missing Intel `01` or `S7`–`S9`                                                            | Regions are returned; coverage is unknown and the file may be truncated      |
| A non-blank record after termination, or a second `S0`                                     | Fails; blank lines are allowed anywhere                                      |
| `S5`/`S6` count different from the data records before it                                  | Fails                                                                        |
| Termination type not matching the data address width                                       | Reported as a limitation; the declared fact is kept                          |
| Conflicting repeated `03`/`05` start records                                               | Fails; identical repeats are allowed                                         |
| An Intel data record whose 16-bit offset wraps past `0xFFFF`                               | Fails: producers disagree on whether the address wraps or continues linearly |
| I16HEX data above `0xFFFFF`, or data crossing the S1/S2/S3 address width                   | Fails                                                                        |

Lowercase hex, LF and CRLF line endings, and trailing spaces or tabs are
accepted. A CR not followed by LF is an invalid character. Failures apply to
the whole file and return no partial regions.

## Limits

The file must be at most 128 MiB. Every data byte needs two hex digits, so the
decoder reserves at most half the file size for decoded bytes before reading,
and stores only written addresses. The decoder retains at most 65,536
address-discontiguous record runs before merging them into regions. A run is a
sequence of consecutive records whose addresses continue each other. Both are
fixed resource bounds, not format limits, and fail as limits (`file-size` and
`capacity`) with no runtime override. Configurable ceilings are tracked in
[#6176](https://github.com/morluto/rea/issues/6176). The line-length limits are
the one-byte record count: Intel HEX allows 255 data bytes, while S-record
counts include address and checksum bytes.

Decoded regions are cached only for the reader's lifetime. Each open checks
its admitted carrier identity again. Region streams copy at most 64 KiB per
chunk, so consumers cannot mutate cached bytes and opening a large region does
not copy it in full. Caller cancellation keeps its exact reason, and closing
the reader waits for active region streams to close.

## Analyzing a region

Inventory does not establish the CPU, byte order or memory map, or that a
declared start address is executable. To disassemble a region, extract it and
open the region file with `open_binary` using format `raw-binary`, an
architecture you choose, and `entry_point` set to the region start address;
raw-binary maps file offset 0 at `entry_point`. Each region is opened
separately, so references between regions are not resolved. A caller-selected
Ghidra language and base address for raw-binary imports is tracked in
[#4246](https://github.com/morluto/rea/issues/4246); Thumb-only Cortex-M images
may be refused or decoded in ARM state until
[#5744](https://github.com/morluto/rea/issues/5744) is resolved.

## Verification

Fixtures with computed checksums cover supported record types, checksums,
termination, address gaps and overlaps, resource refusals, inventory, extraction
and reader lifecycle. CLI and stdio MCP tests exercise the same artifact
provider and advertised schemas, including retained Evidence views.

GNU objcopy 2.40 output was also checked on Linux: the system `true` ELF was
converted to Intel HEX and S-record, with additional address-rebased I32HEX
and S37 cases. Each yielded 13 regions. A 19,124,817-byte Intel HEX conversion
of the system Python 3.11 ELF yielded 11 regions containing 6,799,261 decoded
bytes. Public CLI inspection and extraction matched GNU BFD address ranges
and independently exported section bytes. Adjacent GNU sections were joined
without filling address gaps. These are real producer outputs from system
applications, not vendor-firmware or target-execution verification; srec_cat
and other producers remain unverified. No general speedup is claimed.
