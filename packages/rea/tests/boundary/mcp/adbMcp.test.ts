import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished } from "vitest";

import type { AdbDeviceAnalysisPort } from "../../../src/application/adb/AdbDeviceAnalysisPort.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { assertAdvertisedMcpContracts } from "./mcpContractHarness.js";

const identity = { id: "adb", name: "Android Debug Bridge", version: null };

const clientIdentity = {
  binary_path: "/usr/bin/adb",
  path_source: "path",
  version: "34.0.5-debian",
  installed_path: "/usr/bin/adb",
};

const results: Readonly<Record<string, unknown>> = {
  inspect_adb_client: {
    client: clientIdentity,
    contacted_adb_server: false,
  },
  list_adb_devices: {
    client: clientIdentity,
    devices: [
      {
        serial: "emulator-5554",
        state: "device",
        transport: "tcp",
        product: "sdk_gphone64_x86_64",
        model: "sdk_gphone64_x86_64",
        device: "emu64xa",
        transport_id: 1,
        kind: "emulator",
        kind_basis: "emulator_serial_prefix",
      },
    ],
    may_have_started_adb_server: false,
  },
  inspect_adb_device: {
    client: clientIdentity,
    serial: "emulator-5554",
    properties: [{ name: "ro.build.version.sdk", value: "34" }],
    property_count: 1,
    emulator_observed: true,
  },
  list_adb_packages: {
    client: clientIdentity,
    serial: "emulator-5554",
    scope: "third_party",
    packages: [
      {
        package_name: "com.example",
        base_apk_device_path: "/data/app/x/base.apk",
      },
    ],
    unparsed_lines: [],
    coverage: "complete",
  },
  pull_adb_package: {
    client: clientIdentity,
    serial: "emulator-5554",
    package_name: "com.example",
    output_directory: "/tmp/rea-pulls",
    artifacts: [
      {
        device_path: "/data/app/x/base.apk",
        file_name: "base.apk",
        local_path: "/tmp/rea-pulls/com.example/base.apk",
        bytes: 2048,
        sha256: "a".repeat(64),
        role: "base",
        role_basis: "file_name",
      },
    ],
    failures: [],
    coverage: "complete",
  },
  read_adb_logcat: {
    client: clientIdentity,
    serial: "emulator-5554",
    count: 500,
    buffer: "main",
    pid: null,
    lines: ["08-10 13:00:00.000 I/Tag( 123): message"],
    total_bytes: 34,
    coverage: "complete",
  },
  inspect_adb_package: {
    client: clientIdentity,
    serial: "emulator-5554",
    package_name: "com.example",
    version_name: "1.2.3",
    version_code: "45",
    first_install_time: "2026-01-02 03:04:05",
    last_update_time: "2026-02-03 04:05:06",
    installer_package_name: null,
    user_id: 10234,
    pkg_flags: "[ HAS_CODE ]",
    requested_permissions_count: 2,
    numeric_issues: { sample: [], total: 0 },
    coverage: "complete",
  },
  pull_adb_file: {
    client: clientIdentity,
    serial: "emulator-5554",
    device_path: "/data/local/tmp/notes.txt",
    local_path: "/tmp/rea-pulls/notes.txt",
    bytes: 10,
    sha256: "a".repeat(64),
  },
  push_adb_file: {
    client: clientIdentity,
    serial: "emulator-5554",
    local_path: "/tmp/payload.bin",
    device_path: "/data/local/tmp/payload.bin",
    bytes: 12,
    sha256: "a".repeat(64),
    device_sha256: "a".repeat(64),
    overwritten: false,
    device_digest_source: "device_sha256sum",
  },
  capture_adb_screen: {
    client: clientIdentity,
    serial: "emulator-5554",
    local_path: "/tmp/rea-captures/screen.png",
    bytes: 8192,
    sha256: "a".repeat(64),
    width: 1080,
    height: 2340,
  },
  list_adb_processes: {
    client: clientIdentity,
    serial: "emulator-5554",
    columns: "USER PID PPID VSZ RSS WCHAN ADDR S NAME",
    processes: [
      {
        user: "u0_a1",
        pid: 1234,
        ppid: 567,
        rss: 7890,
        state: "S",
        name: "com.example.app",
      },
    ],
    unparsed_lines: [],
    coverage: "complete",
  },
  list_adb_directory: {
    client: clientIdentity,
    serial: "emulator-5554",
    device_path: "/data/local/tmp",
    entries: [
      {
        name: "notes.txt",
        kind: "file",
        permissions: "-rw-rw-rw-",
        owner: "shell",
        group: "shell",
        bytes: 10,
        date: "2026-01-01 10:00",
        link_target: null,
      },
    ],
    unparsed_lines: [],
    coverage: "complete",
  },
  list_adb_features: {
    client: clientIdentity,
    serial: "emulator-5554",
    features: [{ name: "android.hardware.camera", version: null }],
    unparsed_lines: [],
    coverage: "complete",
  },
  list_adb_services: {
    client: clientIdentity,
    serial: "emulator-5554",
    services: [
      { name: "package", interface: "android.content.pm.IPackageManager" },
    ],
    unparsed_lines: [],
    coverage: "complete",
  },
  inspect_adb_display: {
    client: clientIdentity,
    serial: "emulator-5554",
    physical_size: { width: 1080, height: 2340 },
    override_size: null,
    physical_density: 420,
    override_density: null,
    numeric_issues: { sample: [], total: 0 },
    coverage: "complete",
  },
  inspect_adb_window: {
    client: clientIdentity,
    serial: "emulator-5554",
    source_section: "windows",
    focus_summary: "single_context",
    focus_contexts: [
      {
        scope: "unscoped",
        display_id: null,
        header_line: null,
        declarations: [
          {
            field: "mCurrentFocus",
            value: "Window{abcdef u0 com.example.app/Main}",
            raw_line: "mCurrentFocus=Window{abcdef u0 com.example.app/Main}",
          },
        ],
      },
    ],
    focused_window: "Window{abcdef u0 com.example.app/Main}",
    focused_app: null,
    observed_lines: ["mCurrentFocus=Window{abcdef u0 com.example.app/Main}"],
  },
  read_adb_setting: {
    client: clientIdentity,
    serial: "emulator-5554",
    namespace: "secure",
    key: "adb_enabled",
    value: "1",
    device_reported_null: false,
  },
  collect_adb_bugreport: {
    client: clientIdentity,
    serial: "emulator-5554",
    local_path: "/tmp/rea-bugreports/bugreport.zip",
    bytes: 1024,
    sha256: "a".repeat(64),
    adb_reported_path: "/tmp/rea-bugreports/bugreport.zip",
  },
  resolve_adb_packages: {
    client: clientIdentity,
    serial: "emulator-5554",
    query: "whatsapp",
    matches: [
      {
        package_name: "com.whatsapp",
        base_apk_device_path: "/data/app/x/base.apk",
      },
    ],
    exact_match: true,
    unparsed_lines: [],
    coverage: "complete",
  },
  install_adb_package: {
    client: clientIdentity,
    serial: "emulator-5554",
    apk_path: "/tmp/app.apk",
    bytes: 2048,
    sha256: "a".repeat(64),
    replace_requested: false,
    replaced: null,
  },
  uninstall_adb_package: {
    client: clientIdentity,
    serial: "emulator-5554",
    package_name: "com.whatsapp",
  },
  start_adb_app: {
    client: clientIdentity,
    serial: "emulator-5554",
    package_name: "com.example.app",
    component: "com.example.app/.Main",
    started_activity:
      "act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] cmp=com.example.app/.Main",
  },
  start_adb_activity: {
    client: clientIdentity,
    serial: "emulator-5554",
    action: "android.intent.action.VIEW",
    data_uri: "https://example.com/",
    component: null,
    extras: [],
    started_activity: "act=android.intent.action.VIEW dat=https://example.com/",
  },
  stop_adb_app: {
    client: clientIdentity,
    serial: "emulator-5554",
    package_name: "com.example.app",
  },
};

it("advertises exact valid ADB schemas and records inline evidence through MCP", async () => {
  const provider: AdbDeviceAnalysisPort = {
    async inspectAvailability() {
      return { status: "available", code: null, reason: null, diagnostics: {} };
    },
    async close() {},
    async execute(request) {
      return ok(createAnalysisExecution(results[request.operation], identity));
    },
  };
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
  });
  const server = createServer(
    { kind: "session", session },
    { adbDeviceAnalysis: provider },
  );
  onTestFinished(() => server.close());
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "adb-boundary", version: "0.0.0" });
  onTestFinished(() => client.close());
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  const operationNames = [
    "inspect_adb_client",
    "list_adb_devices",
    "inspect_adb_device",
    "list_adb_packages",
    "pull_adb_package",
    "read_adb_logcat",
    "inspect_adb_package",
    "pull_adb_file",
    "push_adb_file",
    "capture_adb_screen",
    "list_adb_processes",
    "list_adb_directory",
    "list_adb_features",
    "list_adb_services",
    "inspect_adb_display",
    "inspect_adb_window",
    "read_adb_setting",
    "collect_adb_bugreport",
    "resolve_adb_packages",
    "install_adb_package",
    "uninstall_adb_package",
    "start_adb_app",
    "start_adb_activity",
    "stop_adb_app",
  ] as const;
  for (const name of operationNames) expect(names, name).toContain(name);

  assertAdvertisedMcpContracts(operationNames, tools);

  const pulled = await client.callTool({
    name: "pull_adb_package",
    arguments: {
      serial: "emulator-5554",
      package: "com.example",
      output_directory: "/tmp/rea-pulls",
    },
  });
  expect(pulled.isError).not.toBe(true);
  const text = (pulled.content as { readonly text?: string }[])
    .map((part) => part.text ?? "")
    .join("");
  const evidence = parseEvidence(JSON.parse(text));
  expect(evidence.provider.id).toBe("adb");
  expect(evidence.operation).toBe("pull_adb_package");
  expect(evidence.normalized_result).toMatchObject({
    artifacts: [{ file_name: "base.apk", role: "base", bytes: 2048 }],
    coverage: "complete",
  });
});

it("rejects invalid tool input before reaching the provider", async () => {
  const provider: AdbDeviceAnalysisPort = {
    async inspectAvailability() {
      return { status: "available", code: null, reason: null, diagnostics: {} };
    },
    async close() {},
    async execute() {
      throw new Error("must not execute");
    },
  };
  const server = createServer(
    {
      kind: "session",
      session: createTestBinarySession(() => {
        throw new Error("must not start");
      }),
    },
    { adbDeviceAnalysis: provider },
  );
  onTestFinished(() => server.close());
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "adb-boundary-invalid", version: "0.0.0" });
  onTestFinished(() => client.close());
  await client.connect(clientTransport);

  const rejected = await client.callTool({
    name: "inspect_adb_device",
    arguments: { serial: "bad serial" },
  });
  expect(rejected.isError).toBe(true);
  expect(parseMcpToolError(rejected)).toMatchObject({
    error: {
      code: "invalid_request",
      recovery: {
        kind: "inspect_input_contract",
        operation: "inspect_adb_device",
      },
      details: {
        operation: "inspect_adb_device",
        issues: [
          {
            path: ["serial"],
            reason: "invalid_format",
            expected: "regex",
          },
        ],
      },
    },
  });
});
