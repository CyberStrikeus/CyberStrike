# Recorded signal decoding

`decode_signal_recording` answers what a selected protocol decoder observes in
an existing recording. It uses caller-supplied **sigrok-cli 0.7.2** with
libsigrokdecode on **Linux**. util-linux `prlimit` is required (default
`/usr/bin/prlimit`, overridable with absolute `REA_SIGROK_PRLIMIT_COMMAND`).
The limiter sets soft and hard address-space limits before the decoder starts.
macOS and Windows are refused because this adapter cannot enforce that limit on
those hosts. It does not acquire samples or communicate with hardware.

```sh
export REA_SIGROK_COMMAND=/absolute/path/to/sigrok-cli
rea decode-signal-recording /artifacts/uart.vcd \
  --decoders uart:rx=RX:baudrate=9600 --input_format vcd \
  --annotations uart=rx-data --format json
```

The corresponding MCP request is:

```json
{
  "name": "decode_signal_recording",
  "arguments": {
    "path": "/artifacts/uart.vcd",
    "decoders": "uart:rx=RX:baudrate=9600",
    "input_format": "vcd",
    "annotations": "uart=rx-data"
  }
}
```

`decoders` uses sigrok's decoder stack and option/channel syntax. Channel names
must match the recording; REA does not guess wiring, baud rate or protocol.
Each selected decoder channel needs a target, for example `uart:rx=RX`; a bare
channel key such as `uart:rx` is missing that target. When sigrok reports a
missing or unknown selected channel target, REA returns `invalid_request` for
`decoders` even if sigrok continues with fallback annotations and exits
successfully. The diagnostic and any partial stdout remain in `captured_output`;
unrelated producer warnings do not change request status.
Omitting `input_format` requests sigrok's autodetection. REA uses an immutable
private copy whose filename retains the selected recording's final suffix,
including a dotfile basename such as `.csv`. Filename-based format detection
receives that hint without exposing the caller's directory to sigrok. The
input operand is an explicit relative path within the private workspace,
so a recording named `-` is opened as a file rather than
[sigrok's stdin operand](https://github.com/sigrokproject/sigrok-cli/blob/sigrok-cli-0.7.2/input.c#L49-L75).
Omitting `annotations` retains every annotation class. Both omitted selections
are recorded as null.
If sigrok reports an explicitly selected input format as unknown, REA returns
`invalid_request` for `input_format`, retains the producer diagnostic, and
advises correcting the format or omitting it for autodetection. The
[tagged option parser](https://github.com/sigrokproject/sigrok-cli/blob/sigrok-cli-0.7.2/parsers.c#L387-L404)
warns when an option key is unknown. When that diagnostic's key exactly matches
a selected `input_format` option, REA returns `invalid_request`, even on exit zero.
Fallback output and the diagnostic remain in `captured_output`; unrelated
option warnings stay visible without rejecting the request. Matching keeps
the complete diagnostic caption, including an LF inside a selected key;
embedded warning substrings do not establish a refusal. A completed nonzero
`--version` probe is a configuration refusal with its captured output and the
selected sigrok/prlimit configuration guidance. See the
[upstream manual](https://sigrok.org/wiki/Sigrok-cli) for formats, decoder
stacking and annotation selectors. No arbitrary command flags are accepted.

Output defaults to 50 literal LF-separated lines. Use `line_offset` and
`line_limit` for later pages, or MCP `line_limit: null` / CLI `--all_lines`
for all remaining output. `output_window` reports `total_lines`, `returned_lines`
and `has_more`; these count display lines, **not annotations or samples**.
Line endings, blank lines and text within the selected window stay unchanged.
REA does not parse display text into protocol facts, as explained by
[upstream's annotation output guidance](https://sigrok.org/wiki/Protocol_decoder_output).
Paging does not shorten decoding and producer output must still fit its limit.
Use annotation-class selection to reduce producer output. Calls independently
check the source digest; do not combine pages from different digests.

Each selector is limited to 8,192 UTF-16 code units, and total encoded selector
arguments (UTF-8, option prefixes, terminators and 64-bit argv pointers) to
32 KiB before launching. This reserves headroom below Linux execve's minimum
argument/environment budget; a large inherited environment may still exhaust it.

The returned Evidence includes the input path/digest, exact selections, tool
configured and resolved paths/digests, full version banner (including library versions), annotation text
with sample-number ranges, and stderr. For example, `1104-1938 uart-1: 52`
is producer display text over a sample range, not a timestamp or an independently
verified protocol fact. Valid UTF-8 text is retained verbatim; it is not parsed as
a lossless binary payload. If any sigrok stdout or stderr stream is invalid UTF-8,
REA returns `unreadable_output` with the replacement-decoded text in
`captured_output` and the affected streams in
`details.diagnostics.invalid_utf8_streams`.
It does not report that text as successful Evidence. A valid literal replacement
character remains ordinary producer text. Empty output does not establish absence
of traffic. Warnings remain visible even when sigrok exits zero, including
`tool.version_diagnostics` from the separate version probe. Post-run identity
failures name the tool, limiter or private copy involved, rather than blaming the
admitted source. Resource-signal failures retain the signal and effective limits
without inferring its exact cause.

REA decodes a private, read-only copy of the recording, verifies that copy and
the selected executable and resource limiter after decoding, and removes the workspace after owned
process cleanup. Failed descriptor, process or workspace cleanup retains ownership for retry, and the one-shot
CLI awaits a retry without replacing the original failure or completed Evidence.
Completed observations remain in the MCP session after cancellation or cleanup
failure; bounded post-run integrity checks finish before honoring a late abort. The source file is
never passed to sigrok. Caller-supplied tools and their libraries/decoder modules
are trusted, and hashes identify bytes rather than publisher authenticity.

The input copy is bounded at 32 MiB before reading, each command has a 30-second
deadline, and combined stdout/stderr is bounded at 4 MiB during collection.
Oversized output fails rather than becoming truncated success. These limits do
not form an OS sandbox. Before execution, `prlimit` enforces **1 GiB address
space per process**, **64 MiB per file**, **30 CPU seconds** and no core dumps.
Stricter inherited soft/hard limits are preserved; Evidence records the effective
ceilings. Both limits are set before execution, so decoder allocations and compressed
recording expansion cannot exceed the per-process address-space cap. These are
not aggregate process-memory or filesystem quotas. The selected limiter is
trusted and its path, digest and arguments are retained in Evidence.

## Verification

```sh
npm run build:cached
REA_SIGROK_COMMAND=/absolute/path/to/sigrok-cli node scripts/verify-signal-recording.mjs
```

The verifier synthesizes a 9600-baud 8N1 UART VCD carrying `REA`, then checks
actual CLI/MCP parity, advertised schemas, stored Evidence, source hashes,
annotation filtering/autodetection, invalid decoder/input failures, missing
channel rejection with retained partial output, and cleanup.
An optional positional REA entrypoint verifies an installed package.
The real-tool lane requires Linux, sigrok-cli 0.7.2 and libsigrokdecode. A separate
kernel-limit regression checks the inherited soft/hard limits and verifies an
oversized allocation is refused before it can consume memory. Other formats,
decoders and physical acquisition are not established by the UART fixture.
The workflow result must be checked before claiming a specific Linux build
verified. The earlier macOS tool check does not establish the current bounded
integration, which deliberately refuses unsupported hosts.

One decode is admitted at a time, including acquisition and cleanup. Excess
requests receive a retryable capacity error before acquiring another file or
worker. Shutdown closes admission and drains accepted work; failed cleanup
remains owned and retryable.

## Discover decoders before choosing settings

`inspect_signal_decoders` / `inspect-signal-decoders` queries the **installed**
sigrok catalog without opening a recording or scanning devices:

```sh
rea inspect-signal-decoders --query uart
rea inspect-signal-decoders --decoder uart --query baud
rea inspect-signal-decoders --decoder i2c --offset 0 --limit 50
```

Omit `decoder` to search decoder IDs and names. Supply one exact decoder ID to
read its literal help, including required/optional channels, options, annotation
classes and documentation. `query` is a case-insensitive literal substring;
matching help retains original one-based line numbers. Empty query selects all.
`offset` skips matches; `limit` defaults to 50. MCP `limit: null` or CLI `--all`
returns all remaining matches; CLI `--all` and `--limit` conflict.
The window reports examined, matching and returned records and `has_more`.
A filtered empty page is not evidence that the installation has no decoders.
When sigrok reports a selected decoder ID as not installed, help and decoding
return `invalid_request` naming `decoder` or `decoders`; omit `decoder` to list
installed IDs. An installed decoder that fails to load remains an execution failure.

Discovery refuses more than 65,535 line separators before constructing record
objects (65,536-line representation budget), in addition to the 4 MiB output cap.
Exceeding that budget is a resource failure with captured output. Returned text
is copied so a retained page does not keep the complete producer output alive.

Discovery shares decoding's owned process, admission slot, resource limits,
cleanup retries and Evidence delivery. It records the executable and limiter
identities, version banner and warnings. Failed version checks and malformed
producer output preserve diagnostics. Catalog names, help lines and version
output follow decoding's UTF-8 handling: malformed streams produce an
`unreadable_output` error with replacement-decoded captured text and the affected
streams identified in `details.diagnostics.invalid_utf8_streams`. Help is
producer text, not an independently validated parameter schema. Each request
probes again; it does not cache or claim stable pages across installation
changes. Libraries/decoder modules remain trusted and are not fully fingerprinted.
Catalog output includes a SHA-256 of its executable, not a digest of the complete
installation.
