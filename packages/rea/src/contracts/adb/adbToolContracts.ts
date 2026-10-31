import {
  adbInputSchemas,
  adbResultSchemas,
} from "../../domain/adb/adbDeviceAnalysis.js";
import type { ToolContract } from "../toolContractTypes.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
import { toolContractMetadata } from "../toolEffects.js";

/** ADB device inspection and acquisition over a caller-supplied binary. */
export const ADB_TOOL_CONTRACTS = [
  {
    name: "inspect_adb_client",
    ...toolContractMetadata("inspect_adb_client"),
    description:
      "Inspect the caller-selected adb client: resolved binary, version, and install path. Never contacts devices and never starts the adb server. REA never installs platform tools; select a binary with REA_ADB_PATH (absolute) or adb on PATH.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.inspect_adb_client,
    outputSchema: evidenceResultOf(adbResultSchemas.inspect_adb_client),
    examples: [{ title: "Check the adb client", input: {} }],
  },
  {
    name: "list_adb_devices",
    ...toolContractMetadata("list_adb_devices"),
    description:
      "List attached devices exactly as `adb devices -l` reports them: serial, state, transport, model metadata, and an inferred emulator/physical kind with its evidence basis. Emulators and USB or network devices appear alike; REA neither starts nor manages them. May start the local adb server on first use.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.list_adb_devices,
    outputSchema: evidenceResultOf(adbResultSchemas.list_adb_devices),
    examples: [{ title: "List attached devices", input: {} }],
  },
  {
    name: "inspect_adb_device",
    ...toolContractMetadata("inspect_adb_device"),
    description:
      "Inspect one device's build identity through a fixed `getprop` whitelist: Android and SDK versions, security patch, fingerprint, product identity, CPU ABIs, and debuggable flag, plus the observed emulator indicator ro.kernel.qemu. Present properties retain empty values; omitted keys were not reported. Read-only with respect to the device.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.inspect_adb_device,
    outputSchema: evidenceResultOf(adbResultSchemas.inspect_adb_device),
    examples: [
      { title: "Inspect one device", input: { serial: "emulator-5554" } },
    ],
  },
  {
    name: "list_adb_packages",
    ...toolContractMetadata("list_adb_packages"),
    description:
      "List installed packages on one device with each base APK's device path, optionally scoped to third-party or system packages. Paths are device filesystem paths, not host-local. Read-only.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.list_adb_packages,
    outputSchema: evidenceResultOf(adbResultSchemas.list_adb_packages),
    examples: [
      {
        title: "List third-party packages",
        input: { serial: "emulator-5554", scope: "third_party" },
      },
    ],
  },
  {
    name: "pull_adb_package",
    ...toolContractMetadata("pull_adb_package"),
    description:
      "Pull one installed package's complete APK set (base plus every split, as `pm path` reports) from the device into a caller-selected output directory, creating a package-named subdirectory that must not already exist. Every pulled file is digested with SHA-256; partial pulls keep successful artifacts and per-file failure reasons. The device keeps the originals.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.pull_adb_package,
    outputSchema: evidenceResultOf(adbResultSchemas.pull_adb_package),
    examples: [
      {
        title: "Pull a package APK set",
        input: {
          serial: "emulator-5554",
          package: "com.example.app",
          output_directory: "/tmp/rea-pulls",
        },
      },
    ],
  },
  {
    name: "read_adb_logcat",
    ...toolContractMetadata("read_adb_logcat"),
    description:
      "Read a bounded dump of the device log (`logcat -d -t`) for one buffer, optionally restricted to a process id. No streaming, no clearing; the newest lines are kept when the count cap trims. Read-only.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.read_adb_logcat,
    outputSchema: evidenceResultOf(adbResultSchemas.read_adb_logcat),
    examples: [
      {
        title: "Read the last 200 main-buffer lines",
        input: { serial: "emulator-5554", count: 200, buffer: "main" },
      },
    ],
  },
  {
    name: "inspect_adb_package",
    ...toolContractMetadata("inspect_adb_package"),
    description:
      "Inspect installed-package versions, install times, installer, user id, flags, and requested-permission count through read-only `dumpsys package`. Malformed numeric declarations are retained in bounded numeric_issues and make coverage partial; version_code stays exact text. Unknown sections are not inferred.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.inspect_adb_package,
    outputSchema: evidenceResultOf(adbResultSchemas.inspect_adb_package),
    examples: [
      {
        title: "Inspect an installed package",
        input: { serial: "emulator-5554", package: "com.example.app" },
      },
    ],
  },
  {
    name: "pull_adb_file",
    ...toolContractMetadata("pull_adb_file"),
    description:
      "Pull one absolute device path (a database, shared-preferences XML, or any readable file) into a caller-selected output directory, digesting it with SHA-256. The local copy must not already exist. Read-only with respect to the device.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.pull_adb_file,
    outputSchema: evidenceResultOf(adbResultSchemas.pull_adb_file),
    examples: [
      {
        title: "Pull an app database",
        input: {
          serial: "emulator-5554",
          device_path: "/data/data/com.example.app/databases/app.db",
          output_directory: "/tmp/rea-pulls",
        },
      },
    ],
  },
  {
    name: "push_adb_file",
    ...toolContractMetadata("push_adb_file"),
    description:
      "Push one local file to an absolute device path. If the destination is an existing directory, adb places the file inside it under the local basename and the result reports that file path. A device-mutating tool: checks for an existing destination file before transfer and refuses it unless overwrite is explicitly requested; this check is not atomic and another process can create the path before adb writes. The private staged copy remains non-writable and preserves source executable bits. When the device provides sha256sum, the transfer is verified by comparing it with the local digest.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.push_adb_file,
    outputSchema: evidenceResultOf(adbResultSchemas.push_adb_file),
    examples: [
      {
        title: "Push a script to tmp",
        input: {
          serial: "emulator-5554",
          local_path: "/tmp/frida-server",
          device_path: "/data/local/tmp/frida-server",
        },
      },
    ],
  },
  {
    name: "capture_adb_screen",
    ...toolContractMetadata("capture_adb_screen"),
    description:
      "Capture one frame of the device screen as a PNG (`screencap -p` through exec-out, no device-side file) into a caller-selected output directory, digesting it and reporting its dimensions. No recording or interaction.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.capture_adb_screen,
    outputSchema: evidenceResultOf(adbResultSchemas.capture_adb_screen),
    examples: [
      {
        title: "Capture the current screen",
        input: {
          serial: "emulator-5554",
          output_directory: "/tmp/rea-captures",
        },
      },
    ],
  },
  {
    name: "list_adb_processes",
    ...toolContractMetadata("list_adb_processes"),
    description:
      "List running processes exactly as `ps -A` reports them: user, pid, ppid, rss, state, and name. Useful for pairing with instrumentation lanes. Read-only.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.list_adb_processes,
    outputSchema: evidenceResultOf(adbResultSchemas.list_adb_processes),
    examples: [{ title: "List processes", input: { serial: "emulator-5554" } }],
  },
  {
    name: "list_adb_directory",
    ...toolContractMetadata("list_adb_directory"),
    description:
      "List the immediate children of one absolute device directory, including hidden entries: names, kinds, permissions, owner, group, sizes, dates, and symlink targets. Names and targets preserve embedded newlines. Recognizes the standard errors for absent paths and denied reads. Read-only.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.list_adb_directory,
    outputSchema: evidenceResultOf(adbResultSchemas.list_adb_directory),
    examples: [
      {
        title: "List an app's data directory",
        input: {
          serial: "emulator-5554",
          device_path: "/data/data/com.example.app",
        },
      },
    ],
  },
  {
    name: "list_adb_features",
    ...toolContractMetadata("list_adb_features"),
    description:
      "List the device's declared hardware and software features (`pm list features`) for device fingerprinting. Read-only.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.list_adb_features,
    outputSchema: evidenceResultOf(adbResultSchemas.list_adb_features),
    examples: [{ title: "List features", input: { serial: "emulator-5554" } }],
  },
  {
    name: "list_adb_services",
    ...toolContractMetadata("list_adb_services"),
    description:
      "List the device's binder services with their interfaces (`service list`). Read-only.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.list_adb_services,
    outputSchema: evidenceResultOf(adbResultSchemas.list_adb_services),
    examples: [{ title: "List services", input: { serial: "emulator-5554" } }],
  },
  {
    name: "inspect_adb_display",
    ...toolContractMetadata("inspect_adb_display"),
    description:
      "Read physical and override size/density from `wm size` and `wm density`. Malformed numeric declarations are retained in numeric_issues with partial coverage; optional values remain null. Required physical-size failures retain partial display facts. Read-only.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.inspect_adb_display,
    outputSchema: evidenceResultOf(adbResultSchemas.inspect_adb_display),
    examples: [
      { title: "Inspect the display", input: { serial: "emulator-5554" } },
    ],
  },
  {
    name: "inspect_adb_window",
    ...toolContractMetadata("inspect_adb_window"),
    description:
      "Report the window manager's focus declarations with display context, original lines and explicit summary status. Reads `dumpsys window windows`, falling back to `displays` only when no focus field is declared. Singular fields are unknown for multiple contexts or repeated declarations; inspect focus_contexts for every observation. Read-only; no interaction occurs.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.inspect_adb_window,
    outputSchema: evidenceResultOf(adbResultSchemas.inspect_adb_window),
    examples: [
      { title: "Inspect window focus", input: { serial: "emulator-5554" } },
    ],
  },
  {
    name: "read_adb_setting",
    ...toolContractMetadata("read_adb_setting"),
    description:
      "Read one settings value (`settings get`) from the system, secure, or global namespace. Absent keys report the device's own null observation. Read-only; writing settings is not exposed.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.read_adb_setting,
    outputSchema: evidenceResultOf(adbResultSchemas.read_adb_setting),
    examples: [
      {
        title: "Read the ADB-enabled setting",
        input: {
          serial: "emulator-5554",
          namespace: "secure",
          key: "adb_enabled",
        },
      },
    ],
  },
  {
    name: "collect_adb_bugreport",
    ...toolContractMetadata("collect_adb_bugreport"),
    description:
      "Collect one device-generated bugreport archive (`adb bugreport`) into a caller-selected output directory, digesting the zip. The archive contains the device's own dumpstate, dumpsys, and logcat report; collection can take minutes. Read-only with respect to configuration.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.collect_adb_bugreport,
    outputSchema: evidenceResultOf(adbResultSchemas.collect_adb_bugreport),
    examples: [
      {
        title: "Collect a bugreport",
        input: {
          serial: "emulator-5554",
          output_directory: "/tmp/rea-bugreports",
        },
      },
    ],
  },
  {
    name: "resolve_adb_packages",
    ...toolContractMetadata("resolve_adb_packages"),
    description:
      "Find installed packages by case-insensitive substring of the package name (e.g. `whatsapp` → `com.whatsapp`), returning each match's base APK device path. The first step of an easy get: resolve, then pull_adb_package the exact name. Read-only.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.resolve_adb_packages,
    outputSchema: evidenceResultOf(adbResultSchemas.resolve_adb_packages),
    examples: [
      {
        title: "Find a package by partial name",
        input: { serial: "emulator-5554", query: "whatsapp" },
      },
    ],
  },
  {
    name: "install_adb_package",
    ...toolContractMetadata("install_adb_package"),
    description:
      "Install one local APK on the device (`adb install [-r]`), recording the APK's host digest and byte size. A device-mutating tool: `replace_requested` records whether `-r` was selected; `replaced` is null because install success does not establish prior package state. The device's own Success/Failure verdict is preserved with its reason.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.install_adb_package,
    outputSchema: evidenceResultOf(adbResultSchemas.install_adb_package),
    examples: [
      {
        title: "Install an APK",
        input: { serial: "emulator-5554", apk_path: "/tmp/app.apk" },
      },
      {
        title: "Request reinstall mode to keep existing app data",
        input: {
          serial: "emulator-5554",
          apk_path: "/tmp/app.apk",
          replace: true,
        },
      },
    ],
  },
  {
    name: "uninstall_adb_package",
    ...toolContractMetadata("uninstall_adb_package"),
    description:
      "Request package removal for user 0 (`adb shell pm uninstall --user 0`) without data retention. A device-mutating tool; absent packages report the device's own refusal reason.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.uninstall_adb_package,
    outputSchema: evidenceResultOf(adbResultSchemas.uninstall_adb_package),
    examples: [
      {
        title: "Uninstall a package",
        input: { serial: "emulator-5554", package: "com.example.app" },
      },
    ],
  },
  {
    name: "start_adb_app",
    ...toolContractMetadata("start_adb_app"),
    description:
      "Start one installed app's resolved launcher activity with `am start -W -n`. A device-mutating tool for dynamic analysis. The full wait report determines success; failures retain launch-attempt facts and raw output. Pair with `read_adb_logcat` (pid filter) and `list_adb_processes` to observe the app, and `stop_adb_app` to end the run.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.start_adb_app,
    outputSchema: evidenceResultOf(adbResultSchemas.start_adb_app),
    examples: [
      {
        title: "Start an app",
        input: { serial: "emulator-5554", package: "com.example.app" },
      },
    ],
  },
  {
    name: "start_adb_activity",
    ...toolContractMetadata("start_adb_activity"),
    description:
      "Start an intent with `am start -W`: one action, optional data URI, optional explicit component, and up to 16 typed extras (string, boolean, int, long, float). A device-mutating tool; the full wait report determines success, with failed-attempt facts and raw output retained.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.start_adb_activity,
    outputSchema: evidenceResultOf(adbResultSchemas.start_adb_activity),
    examples: [
      {
        title: "Open a deep link",
        input: {
          serial: "emulator-5554",
          action: "android.intent.action.VIEW",
          data_uri: "https://example.com/path",
        },
      },
      {
        title: "Start with typed extras",
        input: {
          serial: "emulator-5554",
          action: "com.example.APP_ACTION",
          extras: [{ key: "level", type: "int", value: "3" }],
        },
      },
    ],
  },
  {
    name: "stop_adb_app",
    ...toolContractMetadata("stop_adb_app"),
    description:
      "Force-stop every process of one package (`am force-stop`), ending a dynamic-analysis run. A device-mutating tool; it succeeds whether or not the package had running processes.",
    kind: "adb-provider",
    inputSchema: adbInputSchemas.stop_adb_app,
    outputSchema: evidenceResultOf(adbResultSchemas.stop_adb_app),
    examples: [
      {
        title: "Stop an app",
        input: { serial: "emulator-5554", package: "com.example.app" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
