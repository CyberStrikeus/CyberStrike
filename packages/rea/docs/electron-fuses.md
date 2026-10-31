# Electron fuse state

`inspect_electron_fuses` / `inspect-electron-fuses` answers whether a packaged
Electron app will honor `--inspect` and `--inspect-brk`, `ELECTRON_RUN_AS_NODE`,
embedded ASAR integrity validation, and loading application code only from
`app.asar`. It reads the fuse wire stored in the Electron binary. It does not
launch the app, modify fuse bytes, or use the network.

```bash
rea inspect-electron-fuses /Applications/Example.app --json
```

The CLI resolves a relative path against the caller's working directory. MCP
requires an absolute filesystem path and preserves that exact selection:

```json
{
  "name": "inspect_electron_fuses",
  "arguments": { "path": "/Applications/Example.app" }
}
```

On POSIX hosts, the CLI preserves path components so symlinks are followed
before parent (`..`) steps. Bundle selections may end in `.` or parent steps
through real directories; a terminal parent step through a directory symlink
is rejected. Windows CLI paths retain native drive and separator resolution.

Check this before `observe_javascript_runtime` with `electron-main`. When
`EnableNodeCliInspectArguments` is disabled or removed, Electron ignores
Inspector flags, and a later target listing can simply show no main-process
target.

## What is read

On macOS, pass the `.app` bundle or the Electron Framework binary. Bundle and
framework selection first tries the top-level `Electron Framework` binary,
then `Versions/Current/Electron Framework`, then
`Versions/A/Electron Framework`. Symlinks are followed only while they stay
inside that framework.
On Windows and Linux, pass the main Electron executable. The wire lives in
that executable rather than in `app.asar`.

The inline Evidence result contains:

- the selected path, the resolved regular file, its SHA-256, size, and container
  format (`mach-o`, `mach-o-universal`, `pe`, or `elf`);
- one slice entry for a thin Mach-O, PE, or ELF file, and one entry per slice of
  a universal Mach-O, with file-absolute `sentinel_offset` values;
- `wire_version`, `declared_length`, and ordered fuses `{ index, name, state, raw_byte }`;
- `sentinel_count`, including zero and more than one;
- `runtime_implications`, each marked `relationship: "derivation"` and tied to
  the fuse index it came from.

Version 1 names, in index order, are `RunAsNode`, `EnableCookieEncryption`,
`EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`,
`EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`,
`LoadBrowserProcessSpecificV8Snapshot`, `GrantFileProtocolExtraPrivileges`,
and `WasmTrapHandlers`. An index past that table, or any index on another wire
version, keeps `name: null` and the raw byte.

Wire bytes are `0x30` disabled, `0x31` enabled, and `0x72` removed. Any other
byte is `unknown`. A removed fuse is not enabled: Inspector flags and
`ELECTRON_RUN_AS_NODE` are not honored, and application code is not restricted
to `app.asar`. On macOS and Windows, a removed or disabled
`EnableEmbeddedAsarIntegrityValidation` byte means embedded ASAR integrity is
not enforced, and an enabled byte means it is enforced. Electron compiles that
validation only on macOS and Windows. On a Linux ELF executable the observed
byte is preserved and the enforcement outcome is `unknown`.

## Unknown and multiple sentinels

No sentinel means the fuse state is unknown. It does not mean the fuses are
disabled. A wire that continues past the slice is reported as truncated, with
only the fuse bytes that were present. Two or more sentinels in one slice are
all reported. REA does not pick one.

Fuse bytes do not prove that the application enables Inspector some other way,
for example through `app.commandLine` or a remote-debugging switch in
application code.

The selected file must be a regular file, or a bundle that resolves to one.
Symlinks are followed only inside `Electron Framework.framework`. The reader
admits at most 1 GiB, searches with 256 KiB windows, and keeps at most 32
sentinels per slice. A real nine-fuse, one-slice result is about 1,200 CLI
tokens; a two-slice result is about 1,300 tokens. Exact size varies with path
lengths and limitations. This inspection creates no temporary files and does
not modify the selected bytes.
