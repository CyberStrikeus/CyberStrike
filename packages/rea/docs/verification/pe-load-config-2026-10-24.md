# PE TLS/load-config verification - 2026-10-24

All runs used macOS arm64 and Node 26.5.0. No target was executed.

## Cross-compiled lane

`npm run verify:pe:load-config` with Zig 0.16.0 compiled freestanding C samples
for `x86_64-windows-gnu` and `x86-windows-gnu`, then invoked the public
`inspect-pe-load-config --json` CLI.

| Target | Callback VA   | RVA      | File offset | Section |
| ------ | ------------- | -------- | ----------- | ------- |
| PE32+  | `0x140001000` | `0x1000` | `0x400`     | `.text` |
| PE32   | `0x401000`    | `0x1000` | `0x400`     | `.text` |

Both images declare one callback and no load-config directory.

## Linker-produced and vendor images (not committed)

- A MinGW-linked PE32+ sample with two `.CRT$XL*` callbacks (`zig cc -target
  x86_64-windows-gnu`): four callbacks reported in `.text` at `0x140001000`,
  `0x140001020`, `0x140001470` and `0x140001500`, matching the callback array
  at `AddressOfCallBacks` `0x14002B8C8` shown by `llvm-readobj
  --coff-tls-directory`.
- Sysinternals `strings64.exe` (PE32+, MSVC): load-config fields match
  `llvm-readobj --coff-load-config`.
- Sysinternals `strings.exe` (PE32, MSVC): the data directory declares 64 bytes
  while the structure `Size` is 188 (`0xBC`). REA reports `size: 188`,
  security cookie `0x4560dc` in `.data`, SafeSEH table `0x453b28` with 7
  handlers and guard flags `0x100`, matching `llvm-readobj`.

Sized fields beyond these samples, EH-continuation and XFG declarations, and
malformed ranges are covered by synthetic fixtures. Runtime enforcement of any
mitigation is not verified.
