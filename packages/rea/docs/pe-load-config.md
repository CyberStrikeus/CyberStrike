# PE TLS callbacks and load configuration

Use `inspect_pe_load_config` to locate declared TLS callbacks and inspect the load
configuration of an explicit local PE32 or PE32+ image. No disassembler, Windows
host, or target execution is required.

```sh
rea inspect-pe-load-config /absolute/path/to/application.exe --json
rea inspect-pe-load-config /absolute/path/to/application.exe --max-callbacks 256 --json
```

MCP accepts `{ "path": "/absolute/path/to/application.exe" }`. CLI paths may be
relative to the current directory; MCP paths must be absolute.

The complete Evidence includes the artifact path, SHA-256, directory file ranges,
and callback-array file ranges. `tls` reports the raw data range, index address,
zero-fill size, characteristics and null-terminated callback array. Callback VAs
are hexadecimal strings to preserve 64-bit precision. RVA, mapped file offset,
and section are derived locations; unknown mappings are `null`.

`load_config` reports fields only when its declared `Size` covers the entire
field. MSVC x86 images often declare a 64-byte load-config data directory while
the structure's own `Size` is larger; like the Windows loader, REA reads `Size`
bytes when they are file-backed in one run, and reports both
`directory.size` and `size`. `structure_location` is the file range of the
`Size` bytes REA checked; Evidence locations include it beside the declared
directory range when the two differ. Unavailable fields are `null`; a covered zero pointer remains `"0x0"`.
The report includes the security cookie, PE32 SafeSEH table/count, CFG pointers
and table/count, address-taken IAT and long-jump tables/counts, EH continuation
table/count, and XFG check pointer. CHPE and dynamic relocation pointers are raw
values. The dynamic relocation table offset (DWORD) and section (WORD) are
reported separately when `Size` covers them, including zero values; REA does
not infer a VA from that pair or decode the target and mitigation-table entries.

Guard flags retain the raw DWORD, recognized names, unknown bits, and the CFG
entry stride. Mitigation claims derived from those flags carry
`evidence_kind: "inferred"`; they do not prove runtime enforcement. The image is
never executed. Missing directories are observed absence of those declarations,
not proof that no callback or mitigation exists by another mechanism.

The default read budget is 64 MiB (`max_file_bytes`, ceiling 512 MiB). The default
callback budget is 64 (`max_callbacks`, ceiling 4096). An exact-budget array is
accepted if its next slot is null. Truncated, ambiguous or unmapped directory and
callback-array storage fails closed, as does budget exhaustion; no partial
success is returned. An unmapped callback **target** retains its VA/RVA with an
unknown file offset. Load-config versions beyond the supported fields remain
undecoded.

Layout references: [Microsoft PE format](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format),
[IMAGE_LOAD_CONFIG_DIRECTORY32](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-image_load_config_directory32),
and [IMAGE_LOAD_CONFIG_DIRECTORY64](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-image_load_config_directory64).

For a real cross-compiled fixture, run `npm run verify:pe:load-config` with Zig
on PATH (or `REA_ZIG` set to its path). The script builds PE32 and PE32+ samples
and inspects them through the public CLI without running them.
