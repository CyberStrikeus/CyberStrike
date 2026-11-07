# Recorded packet capture inspection

`inspect_packet_capture` answers which selected protocol fields TShark observes
in an existing capture. Network, USB or Bluetooth recordings can use the same
field/filter interface when the installed TShark supports their encapsulation
and dissectors. This tool does not acquire traffic, open an interface or control
a device. HAR/SAZ/mitmproxy web-capture workflows remain separate.

Supply an existing TShark 4.x installation **on Linux**, with util-linux
`prlimit` available at `/usr/bin/prlimit`. Override its absolute path with
`REA_TSHARK_PRLIMIT_COMMAND` if required. Unsupported hosts, including macOS
and Windows, are refused before inspection because this integration requires
an enforced address-space limit.

TShark selection follows the same rule as [`inspect_pcap_capture`](pcap-analysis.md):
an absolute `REA_TSHARK_COMMAND`, otherwise `tshark` from the first absolute
`PATH` entry that holds an executable file. A relative `REA_TSHARK_COMMAND` is
refused rather than looked up. Either way the selected executable is resolved,
hashed and rechecked after each run, and Evidence records its
`selection_source` (`environment` or `path`):

```sh
export REA_TSHARK_COMMAND=/absolute/path/to/tshark   # optional when tshark is on PATH
rea inspect-packet-capture /artifacts/device.pcapng \
  --fields ip.addr --fields udp.port --fields data.data \
  --display_filter 'udp' --format json
```

The corresponding MCP call is:

```json
{
  "name": "inspect_packet_capture",
  "arguments": {
    "path": "/artifacts/device.pcapng",
    "fields": ["ip.addr", "udp.port", "data.data"],
    "display_filter": "udp"
  }
}
```

`frame.number` is always included. Repeated values are ordered string arrays,
for example `"ip.addr": ["192.0.2.1", "192.0.2.2"]`. Missing fields remain
absent; they are not converted to zero or empty arrays. Export-only index/score
metadata is discarded. No payload bytes are automatically added; select a
supported byte field such as `data.data` or `@data` when needed.

Selectors are limited before argv expansion: at most 1,024 fields and 1,024
`decode_as` rules, 8,192 UTF-16 code units per selector, and 32 KiB total encoded
selector arguments (UTF-8 text, terminators, option names and argv pointers).
This leaves headroom below Linux's [execve argument/environment limits](https://man7.org/linux/man-pages/man2/execve.2.html);
an unusually large inherited environment can still prevent launching.

Output is paged after filtering: `match_limit` defaults to 50 and `match_offset`
to 0. The result retains original frame numbers and reports `output_window`
with the matching count within the input read scope, returned count and
`has_more`. Request later pages with the offset, or explicit `match_limit: null`
(CLI `--all_matches`) for all remaining matches. Paging does not shorten
input reading or change two-pass reassembly. Producer output must still fit its
resource limit; use selected fields, a display filter or an input-packet limit
when dissection output is too large. Each call checks the recording's current
digest, so pages from different source digests must not be combined.

For a question about a known input prefix, select `packet_limit` for that
prefix, the fields needed for the answer, and a matching output window. For
example, a question about the first twelve PostgreSQL TCP packets within
original frames 1–2,000 can use fields `tcp.srcport`, `tcp.dstport`, `tcp.flags`,
filter `tcp.port == 5432`, `packet_limit: 2000` and `match_limit: 12`.
The matching count then describes that input prefix. A filter containing
`frame.number <= 2000` without an input limit still reads the entire capture;
returning twelve rows does not limit producer output. These controls answer a
bounded question and must not be used to infer whole-capture absence.

Discover unfamiliar field names with `inspect_packet_fields`, using an exact
protocol and a narrow query. If the installed names are already established,
direct field selection avoids an additional glossary probe. Count discovery
and any retries when comparing investigation cost; a small page alone does
not establish a faster workflow.

Additional selections:

- `display_filter`: Wireshark display-filter syntax; omitted means no filter.
- `decode_as`: explicit dissector overrides, such as `["udp.port==5555,dns"]`.
  Repeat `--decode_as` in the CLI for multiple overrides.
- `packet_limit`: optional maximum **input packets read before filtering**.
  A limit of 1 can therefore yield zero matching packets even when later frames
  match. Omitted means read to EOF within resource limits. The report records
  `to-eof` or `up-to-input-packet-limit`, never inferring total capture size from
  the returned packet count.
- `two_pass`: defaults to true for fields that need later packets and reassembly
  dependencies. MCP may set false; CLI uses `--no-two_pass` for a single pass.

See the [TShark manual](https://www.wireshark.org/docs/man-pages/tshark.html)
for field names, display filters, decode-as syntax and pass semantics. Invalid
fields or filters return producer diagnostics. An empty result does not prove
absence of traffic outside the selected recording, filter or read range.
Dissector results are observations, not independently verified device behavior.
TShark may resolve a selected alias to its canonical field name in packet output;
the report preserves the exact requested selection and the producer's output key.

Evidence includes source path/digest/size, exact selections, typed packet fields,
configured and resolved executable paths/digests/full version banner, arguments and stderr. Warnings remain
visible even on exit zero. `tool.version_diagnostics` also retains warnings from
the separate version probe. Post-run identity failures identify the affected
private copy, executable or limiter; resource-signal errors retain the signal
and effective ceilings. Two-pass mode cannot recover missing capture bytes.

Each call uses a private read-only capture copy and an empty personal
configuration directory (`WIRESHARK_CONFIG_DIR`), with name resolution disabled.
The executable, resource limiter and private input copy are rechecked after execution. Owned
processes, file descriptors and private files are cleaned up; failed cleanup retains ownership and
completed observations for retry. The one-shot CLI awaits a cleanup retry while
preserving the original failure and completed Evidence. Completed observations
remain in the MCP session after cancellation or cleanup failure; bounded
post-run integrity checks finish before honoring a late abort. Source files
are never passed to TShark.
Installed libraries, global configuration and plugins remain trusted, are not
fully fingerprinted, and can influence dissection. This is not an OS sandbox.

Input is limited to 32 MiB before reading, each command to 30 seconds, and
combined stdout/stderr to 4 MiB during collection. Output overflow fails instead
of returning truncated success. Before execution, `prlimit` enforces **1 GiB
address space per process**, **64 MiB per file**, **30 CPU seconds** and no core
dumps. Stricter inherited soft/hard limits are preserved; Evidence records the effective
ceilings. Both limits are set before execution, so dissector allocations and
compressed-capture expansion cannot exceed the per-process address-space cap.
These are not aggregate process-memory or filesystem quotas. The selected
limiter is trusted; its path, digest and arguments are retained in Evidence.
No arbitrary process flags are accepted.

## Verification

```sh
npm run build:cached
REA_TSHARK_COMMAND=/absolute/path/to/tshark node scripts/verify-packet-capture.mjs
```

The verifier generates its own Ethernet/IPv4/UDP/DNS and Bluetooth HCI PCAPs.
It exercises real compiled CLI/MCP parity, advertised schemas, repeated/missing
fields, filtering, decode-as, both pass modes, a packet limit before matching
frames, Evidence persistence, failure diagnostics, source identity and cleanup.
An optional positional REA entrypoint verifies an installed package.

The real-tool lane requires Linux and TShark 4.x. A separate kernel-limit
regression checks the inherited soft/hard limits and verifies an oversized
allocation is refused before it can consume memory. The Ubuntu workflow uses
its distribution package; check its outcome before claiming that build verified.
The earlier macOS check does not establish the current bounded integration,
which deliberately refuses unsupported hosts. Other formats (including PCAPNG),
USB, BLE ATT and actual physical capture are not established by these fixtures.

Each provider admits one inspection at a time, including acquisition and cleanup.
An occupied provider returns a retryable capacity error before acquiring another
file or worker. Closing the provider stops new admission and drains accepted work;
failed cleanup remains owned and can be retried.

## Discover protocols and field names

`inspect_packet_fields` / `inspect-packet-fields` queries the installed TShark
registration glossary before selecting fields for capture inspection:

```sh
rea inspect-packet-fields --query usb
rea inspect-packet-fields --kind fields --protocol usb --query idVendor
rea inspect-packet-fields --kind fields --protocol udp --all
```

`kind` defaults to `protocols`; `fields` selects field definitions. `protocol`
selects an exact protocol abbreviation (the protocol itself or its child fields).
`query` is a case-insensitive literal substring in name, abbreviation or field
description. `offset` skips matching records; `limit` defaults to 50. MCP
`limit: null` or CLI `--all` requests all remaining matches within the resource
budget. `--all` and `--limit` conflict. The window reports examined records of
the selected kind before filters, matching records, returned records and
`has_more`; it never counts capture packets.

Returned records preserve field type, parent protocol, display base, bitmask,
description and original glossary line number. Empty producer strings remain
empty; protocol records have null field-only properties. Repeated abbreviations
remain separate registrations. A listed field is an installation capability, not
proof that the field appears in a selected recording.

The adapter uses the documented `tshark -G fields` grammar under its existing
private empty profile and Linux process limits. TShark 4.6.9's full glossary was
measured at 22,303,197 bytes; discovery admits at most **32 MiB** combined command
output (capture inspection remains at **4 MiB**). Parsing walks lines once and
constructs objects only for the selected page. Returned strings are copied so
retained pages do not retain the complete glossary string. Before constructing a selected
record it charges six times the source UTF-8 bytes plus 512 bytes against an
**8 MiB** representation budget, covering JSON escaping and record bookkeeping.
If that budget would be exceeded, narrow the query or page size; results are not
silently truncated. This is a conservative admission budget, not measured heap
usage. Parent pipe buffers and producer per-process limits remain distinct.

Tool/limiter identity, version, stderr and selected arguments are retained in
Evidence. No capture, interface or device is opened. Discovery shares capture
analysis's admission slot and cleanup owner. Each call rereads the glossary;
installed plugins, libraries and global configuration remain trusted and are not
fully fingerprinted. There is no cache or snapshot-consistent pagination claim.
The real Linux lane checks public CLI/MCP queries against the direct glossary,
including USB vendor-ID typing, negative queries and paging.
