# ADB device inspection and acquisition

REA inspects connected Android devices, reads device state, and transfers
files and packages through the caller's `adb` binary. Emulators, USB
devices, and network devices participate alike: REA neither starts nor
manages them and never installs platform tools. Every operation composes a
fixed adb argument vector — caller values occupy positional arguments only
and are quoted when adb forwards them to the device shell.

The adb client may start its local server on first device query; that is adb
client behavior, recorded in the tool result when observed.
`inspect_adb_client` probes only the binary and never contacts the server.

## Supply tools

Use any Android platform-tools `adb` (verified with 34.0.5). Select it
through the environment:

```sh
# Optional: absolute path to the adb binary; without it, adb resolves from PATH.
export REA_ADB_PATH=/absolute/path/to/adb
```

REA never installs the Android SDK, an emulator, or a system image.
Readiness is `rea inspect-adb-client`: it runs `adb version` and reports the
resolved binary, its version, and where it was selected from. A missing
binary reports `capability_unavailable` with the `REA_ADB_PATH` remediation
rather than attempting an installation.
The `binary_session` inventory uses the same bounded client-version probe; it
does not query devices, start the adb server, or establish that a requested
serial is reachable. Device state is checked by each device operation.

## Answer an analyst question

```sh
# Device identity
rea inspect-adb-client
rea list-adb-devices
rea inspect-adb-device emulator-5554
rea inspect-adb-display emulator-5554
rea list-adb-features emulator-5554
rea list-adb-services emulator-5554

# Find and acquire an app (the easy-get flow)
rea resolve-adb-packages emulator-5554 whatsapp
rea list-adb-packages emulator-5554 --scope third_party
rea inspect-adb-package emulator-5554 com.whatsapp
rea pull-adb-package emulator-5554 com.whatsapp --output-directory /tmp/acq
rea inspect-android-package /tmp/acq/com.whatsapp/base.apk

# Device state and files
rea list-adb-processes emulator-5554
rea inspect-adb-window emulator-5554
rea read-adb-setting emulator-5554 global adb_enabled
rea read-adb-logcat emulator-5554 --count 200
rea list-adb-directory emulator-5554 /data/data/com.whatsapp
rea pull-adb-file emulator-5554 /data/local/tmp/notes.txt --output-directory /tmp/acq
rea push-adb-file emulator-5554 /tools/frida-server /data/local/tmp/frida-server
rea capture-adb-screen emulator-5554 --output-directory /tmp/shots
rea collect-adb-bugreport emulator-5554 --output-directory /tmp/bugs

# Package lifecycle and dynamic analysis (device-mutating)
rea install-adb-package emulator-5554 /tmp/app.apk --replace
rea start-adb-app emulator-5554 com.example.app
rea read-adb-logcat emulator-5554 --pid 12345
rea start-adb-activity emulator-5554 android.intent.action.VIEW --data-uri https://example.com
rea stop-adb-app emulator-5554 com.example.app
rea uninstall-adb-package emulator-5554 com.example.app
```

Equivalent MCP methods use the snake_case names (`list_adb_devices`,
`pull_adb_package`, `resolve_adb_packages`, …). Device operations take
`serial` exactly as `adb devices` reports it. The pulled APK set feeds the
existing analysis families directly, for example
`rea inspect-android-package /tmp/acq/<package>/base.apk`.

## Operations

| Tool                    | Kind               | What it does                                                                                                                                                                                                                          |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect_adb_client`    | read               | Resolved binary, version, install path; never contacts the server                                                                                                                                                                     |
| `list_adb_devices`      | read               | Serial, state, transport, model metadata, inferred emulator/physical kind with basis                                                                                                                                                  |
| `inspect_adb_device`    | read               | Fixed `getprop` whitelist: build, SDK, patch, fingerprint, product, ABIs, debuggable, `ro.kernel.qemu`                                                                                                                                |
| `inspect_adb_display`   | read               | `wm size` and `wm density` as declared                                                                                                                                                                                                |
| `list_adb_features`     | read               | `pm list features` (hardware/software features, hex GL versions)                                                                                                                                                                      |
| `list_adb_services`     | read               | `service list` binder services and interfaces                                                                                                                                                                                         |
| `list_adb_processes`    | read               | `ps -A`: user, pid, ppid, rss, state, name                                                                                                                                                                                            |
| `inspect_adb_window`    | read               | `dumpsys window` focus declarations (what is on screen)                                                                                                                                                                               |
| `read_adb_setting`      | read               | One `settings get` value; device-side null is reported as such                                                                                                                                                                        |
| `read_adb_logcat`       | read               | Bounded `logcat -d -t` dump for one buffer, optional pid filter                                                                                                                                                                       |
| `list_adb_packages`     | read               | `pm list packages -f` with scope; base APK device paths                                                                                                                                                                               |
| `resolve_adb_packages`  | read               | Case-insensitive package-name substring search with exact-match flag                                                                                                                                                                  |
| `inspect_adb_package`   | read               | `dumpsys package` projection: versions, install times, installer, flags, and count of listed requested-permission rows (including Unicode names)                                                                                      |
| `list_adb_directory`    | read               | NUL-framed immediate children, including hidden entries: kinds, permissions, owner, group, sizes, symlink targets                                                                                                                     |
| `pull_adb_package`      | read               | Complete split APK set from `pm path`, each file digested                                                                                                                                                                             |
| `pull_adb_file`         | read               | One absolute device path pulled and digested                                                                                                                                                                                          |
| `capture_adb_screen`    | read               | One `screencap -p` frame (exec-out, no device-side file) with dimensions                                                                                                                                                              |
| `collect_adb_bugreport` | read               | Device-generated bugreport zip, digested                                                                                                                                                                                              |
| `push_adb_file`         | **mutates device** | One local file to a device path (e.g. pushing tools into `/data/local/tmp`); checks for existing targets and refuses them without explicit overwrite (the check is not atomic); compares digests when device `sha256sum` is available |
| `install_adb_package`   | **mutates device** | Local APK via `adb install [-r]`; preserves its Success/Failure verdict, records `replace_requested`, and leaves actual replacement `null` because prior package state is not observed                                                |
| `uninstall_adb_package` | **mutates device** | Requests package removal for user 0 via `adb shell pm uninstall --user 0`, without data retention                                                                                                                                     |
| `start_adb_app`         | **mutates device** | Resolves the package's launcher activity (`cmd package resolve-activity --brief`) and starts it (`am start -n`)                                                                                                                       |
| `start_adb_activity`    | **mutates device** | Starts an intent (`am start -a` with optional URI, component, and up to 16 typed extras); preserves the activity manager's verdict                                                                                                    |
| `stop_adb_app`          | **mutates device** | Force-stops every process of a package, ending a dynamic-analysis run                                                                                                                                                                 |

Screen capture validates the PNG signature, IHDR framing, dimensions, and IHDR
checksum before publishing. It does not validate encoding fields or decode and
validate image contents; that limitation is retained in Evidence.

When `push_adb_file` receives an existing directory, adb places the local file
inside it under the local basename; Evidence reports that effective file path
while retaining the caller's directory path in the input parameters. The
private read-only staging copy preserves the source file's executable bits.

For `inspect_adb_window`, `focus_contexts` retains each display header, its exact
display ID when recognized, and every focus declaration with its original line.
Declarations without a display header are explicitly `unscoped`. A missing
declaration differs from a declaration whose `value` is JSON `null`.
`source_section` identifies the selected dumpsys section; `observed_lines`
preserves its focus declarations and display headers in source order.

`focus_summary` is `single_context` only for one context with no repeated focus
field. The singular `focused_window` and `focused_app` summarize that context;
they do not establish device-wide focus. Multiple contexts or repeated fields
produce `ambiguous` with null singular fields and all declarations retained.
When no focus field was declared, the status is `unavailable`. REA reads the
displays section only when the windows section declares neither focus field.

For `install_adb_package`, `replace_requested` records whether `-r` was sent.
The `replaced` result is `null`: the successful install response does not say
whether the package was installed fresh or replaced, and REA does not query the
device first. The install verdict and host APK digest remain available.

Push and install consume a private snapshot of the selected local input. The
reported size and SHA-256 identify those consumed bytes; `local_path` and
`apk_path` retain the original input path, whose contents may change later.
Snapshot creation needs temporary disk space proportional to the input size.
Failed snapshot cleanup remains owned and is retried before later operations
and during shutdown.

## Interpret the result

- **Package numeric declarations retain failures.** `inspect_adb_package`
  admits the first valid `userId` or `appId` as `user_id`: a nonnegative safe
  integer, including zero. A null value means no valid declaration was found.
  Malformed declarations before or after a valid value remain in
  `numeric_issues`: the first ten issues with command, field, reason and original
  `raw_line`, plus the exact `total`. Reasons are `invalid_format` or
  `unsafe_integer`. Any issue makes package coverage partial; existing section
  omissions can also make it partial. `version_code` remains exact source text.
- **Display nulls preserve uncertainty.** `inspect_adb_display` admits positive
  safe integers. Absent or malformed optional values are null; `numeric_issues`
  distinguishes malformed declarations from absence. It keeps the first ten
  issues and exact total, with command, field, original line and reason
  (`invalid_format`, `unsafe_integer` or `nonpositive`). The last recognized
  labeled declaration wins, even when malformed. A physical-density label
  suppresses bare-number fallback even when malformed; without that label, the
  first unsigned bare number wins, including zero or an unsafe integer that
  leaves the value null. Display coverage is complete only with known physical
  density and no numeric issues. Missing or malformed required physical size
  produces a protocol failure with `details.partial_observation`: an
  `inspect_adb_display` observation from provider `adb`, reason
  `physical_size_absent` or `physical_size_malformed`, and a `result` retaining
  client, serial, optional display facts, numeric issues, null physical size
  and partial coverage.
- **Directory names retain whitespace and newlines.** Symlink targets do too,
  including trailing newlines. Records containing invalid UTF-8 remain as
  labelled hex in `unparsed_lines` and make directory coverage partial.
- **Inferences carry their basis.** Device `kind` reports
  `kind_basis` (serial prefix or USB transport); APK `role` reports
  `role_basis: file_name`; `emulator_observed` is derived from the build's
  `ro.kernel.qemu` property: `true` only when its value is `"1"`, `false` for
  any other reported value, and `null` when the property is absent. The raw
  property value remains available in `properties`.
- **Device paths are not host paths.** `base_apk_device_path` values live on
  the device filesystem. Only pulls and captures produce host-local paths,
  each paired with byte size and SHA-256 digest. A pulled file's host name is
  the device path's final POSIX segment. REA preserves the original device
  path and filename; a missing final segment or `.`/`..` is refused before
  output creation. Windows hosts follow [Windows filename rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file),
  while POSIX hosts retain valid POSIX filenames such as names with spaces or
  colons. A package pull checks reported names against the destination
  filesystem before pulling, and refuses names that would share a local path.
- **Package path refusals are diagnosable.** Refusals from `pull_adb_package`
  return `unreadable_output` with `retryable: false`, keep the `pm path` output
  in `details.captured_output`, and name the refusal in `details.reason`.
  `unsafe_device_path` lists refused entries in
  `details.diagnostics.rejected_paths` as `{device_path, reason}`;
  `duplicate_local_destination` reports the shared `file_name` and both
  `device_paths`; `local_destination_unavailable` reports the `device_path`,
  `file_name`, and filesystem `error_code`. Diagnostics retain raw device
  strings, while the caller-facing message escapes invisible and bidirectional
  characters so they cannot hide text or reorder the path.
- **Splits are part of the answer.** `pm path` enumerates the base APK and
  every installed split; pulls cover the whole set. System packages whose
  APKs keep other names report the `unknown` role rather than guessing.
- **Partial results keep facts.** Failed individual pulls return successful
  artifacts with `coverage: "partial"` and per-file `failures`. Listings
  and package searches that contain unrecognized lines report the first ten
  as `unparsed_lines`, state the exact total in a limitation when more were
  seen, and mark partial coverage instead of dropping rows.
- **Mutations are explicit.** `push_adb_file`, `install_adb_package`, and
  `uninstall_adb_package` declare `mutatesTarget` and never run implicitly:
  pushes check for existing device files before transfer and refuse them
  unless `overwrite` is set. A failed or unexpected existence probe stops
  transfer even with `overwrite`; only a clean `test -e` exit of 1 with no
  output is interpreted as absence. The check is not atomic, so a different
  process can create the path before `adb push` writes it. When available, the device's
  `sha256sum` verifies the transfer. A missing command or output without a
  recognizable digest reports `device_digest_source: "unavailable"` with an
  unverified-transfer limitation; installs preserve the
  device's `Failure [...]` reason verbatim.
- **Producer identity stays attached.** Every result embeds the producing
  adb client (`binary_path`, `path_source`, `version`, `installed_path`).

## Resource and lifecycle limits

- Caller values reach adb only as positional arguments in fixed vectors;
  no tool accepts an arbitrary shell command line, `input`, or `monkey`.
  The app/activity lifecycle tools use `am start -W` and `am force-stop`.
- Per-invocation budgets: client/devices 10-20 s, shell reads 20-60 s with
  64 KiB-8 MiB capture caps (logcat 4 MiB, screen 32 MiB), transfers and
  bugreports 600 s. Output capture overflow reports `resource_constraint`
  and names the byte allowance. Deadline expiration, including the
  client-version probe, reports `provider_timeout` and names the effective
  milliseconds. This release has no runtime override for those deadlines or
  capture caps. Command cancellation preserves the caller's exact reason;
  a later abort does not replace an already completed command failure.
- Pull and capture outputs are additive: the destination must not already
  exist. Re-running a completed pull refuses the existing directory instead
  of overwriting evidence.
- Cancellation during a package pull preserves caller-selected output. The
  error includes partial observations identifying completed artifacts and the
  interrupted local path; remaining APKs were not attempted.
- Screen capture checks cancellation before publishing its exclusive output.
  If cancellation arrives after publication, the error retains the committed
  file's path, digest and dimensions; the file remains available as evidence.
- Bugreports collect into isolated staging and publish with exclusive creation;
  filename collisions select the next numeric suffix. If publication fails, the
  completed archive remains in staging. The error's partial observation gives
  its recoverable `local_path`, the original `adb_reported_path`, and an unknown
  digest status. Later operations and shutdown preserve this retained evidence.
- Failed package acquisition rollback retains its directory identity and retries
  cleanup before later work and during shutdown. Cleanup refuses a replacement
  directory. Terminal shutdown stops admission and drains active operations.
- The provider holds no long-lived processes; every invocation is one
  bounded adb run. The adb server belongs to the caller.

## Related capability and follow-up lanes

UI interaction beyond intent starts (tapping, typing, monkey fuzzing, screen
recording) remains a separate lane: candidates such as
[mobile-device-mcp](https://github.com/srmorete/mobile-device-mcp) install
driver software on the device and pair with the Frida instrumentation lane
(#1359) behind explicit mutation-authority contracts. Network transports
beyond already-connected devices (`adb connect`) are not exposed yet.

## Real verification

`npm run verify:adb` exercises every operation against a live device. It
requires `adb` (or `REA_ADB_PATH`) and any attached emulator or phone;
`--serial` selects one when several are attached, `--pull PACKAGE` pulls a
real package and verifies the returned digests against the files on disk,
and `--install-apk PATH` drives a full install → resolve → uninstall
lifecycle with a lane-owned probe.

Record: verified against adb 34.0.5 on Linux against an Android 14
(API 34) x86_64 emulator — all operations above, a 224-package inventory,
287 services, 92 features, a real two-APK split set pulled with byte-exact
digests, a verified push/pull roundtrip, a 1.3 MB screen capture, and the
complete package lifecycle; see `docs/testing.md` for the lane summary.

Intent integer extras use signed decimal text. The ADB argument encoder removes
redundant leading zeros for Android's radix-sensitive `--ei` parser while retained
Evidence keeps the caller's original spelling. Package inspection accepts both
`userId` and Android 16's `appId` spelling for the legacy `user_id` result field.

A completed push and device digest verification are separate observations. A
verification timeout, cancellation, or output budget failure returns the typed
failure with partial Evidence of the completed transfer. An unavailable checksum
command or unrecognized checksum output leaves verification explicitly unknown.
