import { AnalysisResourceConstraintError } from "../../../src/domain/analysisErrorCore.js";
import { packetFieldsCatalogSchema } from "../../../src/domain/captures/packetFields.js";
import { OwnedCommandFailure } from "../../../src/process/OwnedCommand.js";
import { it, expect, onTestFinished } from "vitest";
import { writeFile, readdir, chmod, symlink } from "node:fs/promises";
import { join } from "node:path";
import { readStableArtifact } from "../../../src/artifacts/readStableArtifact.js";
import { TsharkCaptureProvider } from "../../../src/captures/TsharkCaptureProvider.js";
import { PacketCaptureService } from "../../../src/application/captures/PacketCaptureService.js";
import { packetCaptureSchema } from "../../../src/domain/captures/packetCapture.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createDeferred } from "../../fixtures/binarySession.js";
import { Cli } from "incur";
import { registerCaptureCommands } from "../../../src/cli/captureCommands.js";
import { silentLogger } from "../../../src/logger.js";
import { analysisErrorRemediationAction } from "../../../src/domain/analysisErrorPresentation.js";
import { parseEvidence } from "../../../src/domain/evidence.js";

// A command-boundary simulator: real process ownership/filesystem, not real TShark coverage.
const fixture = async (mode = "ok", failCleanup = false) => {
  const directory = await createTestTempDirectory("rea-capture-test-");
  const path = join(directory, "recorded bytes.pcap");
  await writeFile(path, "recording bytes");
  const script = join(directory, "producer.mjs");
  await writeFile(
    script,
    `import {readFileSync, writeFileSync, chmodSync, truncateSync} from 'node:fs';
if (process.argv.includes('--version')) { console.log(${JSON.stringify(mode)} === 'bad-version' ? 'TShark (Wireshark) 3.0.0' : ${JSON.stringify(mode)} === 'foreign-version' ? 'tcpdump version 4.99.4' : 'TShark (Wireshark) 4.6.9 (fixture)'); console.error('version warning'); }
else if (${JSON.stringify(mode)} === 'nonzero') { console.error('invalid decoder'); process.exitCode = 1; }
else if (${JSON.stringify(mode)} === 'malformed-copy') { chmodSync('capture', 0o600); writeFileSync('capture', 'changed'); }
else if (${JSON.stringify(mode)} === 'oversized-copy') { chmodSync('capture', 0o600); truncateSync('capture', 32 * 1024 * 1024 + 1); console.log('[]'); }
else if (${JSON.stringify(mode)} === 'overflow') process.stdout.write('x'.repeat((process.argv.includes('-G') ? 33 : 5) * 1024 * 1024));
else if (${JSON.stringify(mode)} === 'wait') { console.log('ready'); setInterval(() => {}, 1000); }
else if (${JSON.stringify(mode)} === 'invalid-json') console.log('not json');
else if (${JSON.stringify(mode)} === 'many') console.log(JSON.stringify(Array.from({length:90},(_,i)=>({_source:{layers:{"frame.number":[String(i+1)],"ip.addr":["192.0.2.1"]}}}))));
else if (${JSON.stringify(mode)} === 'alias-canonical') { if (!process.argv.includes('bootp.type')) throw Error('alias selector missing'); console.log(JSON.stringify([{_source:{layers:{"frame.number":["1"],"dhcp.type":["1"]}}}])); }
else if (process.argv.includes('-G')) { console.log(${JSON.stringify(mode)} === 'unicode-search' ? 'P\\tΟΣ\\tgreek.proto\\nF\\tΟΣ field\\tgreek.field\\tFT_STRING\\tgreek.proto\\tBASE_NONE\\t0x0\\tGreek description' : 'P\\tUniversal Serial Bus\\tusb\\nF\\tVendor ID\\tusb.idVendor\\tFT_UINT16\\tusb\\tBASE_HEX\\t0x0\\t\\nF\\tOther Vendor\\tusb.idVendor\\tFT_UINT32\\tusb\\tBASE_HEX\\t0x0\\tSecond registration\\nP\\tInternet Protocol\\tip\\nF\\tAddress\\tip.addr\\tFT_IPv4\\tip\\t\\t0x0\\tSource or destination'); console.error('glossary warning'); }
else { if(readFileSync('capture', 'utf8') !== 'recording bytes') throw Error('wrong copy'); console.log(JSON.stringify([{_source:{layers:{"frame.number":["1"],"ip.addr":["192.0.2.1","192.0.2.2"]}}}])); console.error('producer warning'); }
`,
  );
  await chmod(script, 0o700);
  const configuredCommand =
    mode === "symlink" ? join(directory, "configured-tool") : script;
  if (mode === "symlink") await symlink(script, configuredCommand);
  if (mode === "path") await symlink(script, join(directory, "tshark"));
  const controller = new AbortController();
  let calls = 0;
  let mayClean = !failCleanup;
  const acquired = createDeferred<void>();
  const release = createDeferred<void>();
  const provider = new TsharkCaptureProvider(
    {
      ...process.env,
      ...(mode === "path"
        ? { PATH: directory, REA_TSHARK_COMMAND: undefined }
        : { REA_TSHARK_COMMAND: configuredCommand }),
      REA_TSHARK_PRLIMIT_COMMAND: configuredCommand,
    },
    async (input) => {
      calls++;
      if (mode === "launch-failure" && !input.arguments.includes("--version"))
        throw Object.assign(new Error("spawn E2BIG"), { code: "E2BIG" });
      if (mode === "file-limit" && !input.arguments.includes("--version")) {
        const stdout = { text: "", bytes: 0, observedBytes: 0 };
        const stderr = {
          text: "before file limit\n",
          bytes: 18,
          observedBytes: 18,
        };
        throw new OwnedCommandFailure("process", "Synthetic SIGXFSZ snapshot", {
          stdout,
          stderr,
          exitCode: null,
          signal: "SIGXFSZ",
        });
      }
      const spawned = await spawnOwnedProviderProcess({
        ...input,
        command: process.execPath,
        arguments: [script, ...input.arguments],
        expectedCommand: process.execPath,
      });
      if (mode === "wait" && !input.arguments.includes("--version"))
        spawned.process.stdout?.once("data", () => controller.abort());
      return spawned;
    },
    async () => {
      if (mode === "workspace-full")
        throw Object.assign(new Error("No space left on device"), {
          code: "ENOSPC",
        });
      const root = await PrivateRuntimeRoot.create({
        parent: directory,
        prefix: "decoder-",
      });
      if (mode === "gated") {
        acquired.resolve();
        await release.promise;
      }
      if (mode === "snapshot-write-failure")
        await writeFile(join(root.path, "capture"), "existing");
      return {
        path: root.path,
        close: async () => {
          if (mode === "close-abort")
            controller.abort({ request: "cancel during workspace close" });
          if (!mayClean) throw new Error("cleanup fixture failure");
          await root.close();
        },
      };
    },
    "linux",
    async (...args) => {
      if (mode === "oversized-tool" && calls === 2 && args[0] === script) {
        const { truncate } = await import("node:fs/promises");
        await truncate(script, 64 * 1024 * 1024 + 1);
      }
      if (mode === "post-run-abort" && calls === 2) controller.abort();
      return readStableArtifact(...args);
    },
    async (limits) => ({ ...limits, file_bytes: 1048576 }),
  );
  onTestFinished(async () => {
    release.resolve();
    mayClean = true;
    await provider.close();
  });
  const service = new PacketCaptureService(provider);
  return {
    service,
    directory,
    path,
    controller,
    calls: () => calls,
    acquired: acquired.promise,
    release: () => release.resolve(),
    allowCleanup: () => {
      mayClean = true;
    },
  };
};

it("refuses new acquisition after provider shutdown", async () => {
  const f = await fixture();
  await f.service.close();
  expect(
    await f.service.inspect({ path: f.path, fields: ["ip.addr"] }),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(f.calls()).toBe(0);
});

it("pages matching observations without changing dissection scope or frame identities", async () => {
  const f = await fixture("many");
  const input = { path: f.path, fields: ["ip.addr"] };
  for (const [options, first, count] of [
    [{}, 1, 50],
    [{ match_offset: 50, match_limit: 30 }, 51, 30],
    [{ match_limit: null }, 1, 90],
    [{ match_offset: 100 }, undefined, 0],
  ] as const) {
    const result = await f.service.inspect({ ...input, ...options });
    if (!result.ok) throw result.error;
    const report = packetCaptureSchema.parse(result.value.normalized_result);
    expect(report.packets).toHaveLength(count);
    expect(report.packets[0]?.["frame.number"][0]).toBe(
      first === undefined ? undefined : String(first),
    );
    expect(report.output_window.matching_packets).toBe(90);
    expect(report.output_window.returned_packets).toBe(count);
    expect(report.read_scope).toBe("to-eof");
    expect(report.tool.arguments).not.toContain("-c");
  }
});

it("preserves TShark canonical output for a caller-selected field alias", async () => {
  const f = await fixture("alias-canonical");
  const input = { path: f.path, fields: ["bootp.type"] };
  const result = await f.service.inspect(input);
  if (!result.ok) throw result.error;
  const report = packetCaptureSchema.parse(result.value.normalized_result);
  expect(report.selection.fields).toEqual(["bootp.type"]);
  expect(report.packets).toEqual([
    { "frame.number": ["1"], "dhcp.type": ["1"] },
  ]);
  expect(report.tool.arguments).toContain("bootp.type");
});

it("returns canonical alias output through the public packet-capture CLI", async () => {
  const f = await fixture("alias-canonical");
  const cli = Cli.create("capture-alias-test", { sync: false });
  registerCaptureCommands(cli, silentLogger, {}, f.service);
  let stdout = "";
  await cli.serve(
    [
      "inspect-packet-capture",
      f.path,
      "--fields",
      "bootp.type",
      "--format",
      "json",
    ],
    { stdout: (text) => (stdout += text), exit: () => {} },
  );
  const evidence = parseEvidence(JSON.parse(stdout));
  const report = packetCaptureSchema.parse(evidence.normalized_result);
  expect(report.selection.fields).toEqual(["bootp.type"]);
  expect(report.packets).toEqual([
    { "frame.number": ["1"], "dhcp.type": ["1"] },
  ]);
});

it("bounds admission without queuing additional snapshots or delaying cancellation", async () => {
  const f = await fixture("gated");
  const input = { path: f.path, fields: ["ip.addr"] };
  const first = f.service.inspect(input);
  await f.acquired;
  const second = f.service.inspect(input);
  const cancelled = f.service.inspect(input, { signal: AbortSignal.abort() });
  f.release();
  expect(await first).toMatchObject({ ok: true });
  expect(await second).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError", resource: "capacity" },
  });
  expect(await cancelled).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(f.calls()).toBe(2);
  expect(await f.service.inspect(input)).toMatchObject({ ok: true });
});

it("inspects an immutable copy, preserves options and warnings, and releases its directory", async () => {
  const f = await fixture();
  const result = await f.service.inspect({
    path: f.path,
    fields: ["ip.addr"],
    display_filter: "udp",
    packet_limit: 10,
    decode_as: ["udp.port==5555,dns"],
  });
  if (!result.ok) throw result.error;
  const report = packetCaptureSchema.parse(result.value.normalized_result);
  expect(report.packets).toEqual([
    { "frame.number": ["1"], "ip.addr": ["192.0.2.1", "192.0.2.2"] },
  ]);
  expect(report.diagnostics).toBe("producer warning\n");
  expect(report.tool.version_diagnostics).toBe("version warning\n");
  expect(report.read_scope).toBe("up-to-input-packet-limit");
  expect(report.tool.arguments).toEqual([
    "-n",
    "-r",
    "capture",
    "-T",
    "json",
    "--no-duplicate-keys",
    "--temp-dir=.",
    "-2",
    "-c",
    "10",
    "-Y",
    "udp",
    "-d",
    "udp.port==5555,dns",
    "-e",
    "frame.number",
    "-e",
    "ip.addr",
  ]);
  expect((await readdir(f.directory)).sort()).toEqual([
    "producer.mjs",
    "recorded bytes.pcap",
  ]);
});

it.each([
  ["invalid-json", "AnalysisOutputError"],
  ["nonzero", "ProviderAdapterError"],
  ["malformed-copy", "AnalysisArtifactChangedError"],
  ["overflow", "AnalysisResourceConstraintError"],
  ["wait", "AnalysisCancelledError"],
])(
  "preserves %s failure and releases the process and snapshot",
  async (mode, tag) => {
    const f = await fixture(mode);
    const result = await f.service.inspect(
      { path: f.path, fields: ["ip.addr"] },
      { signal: f.controller.signal },
    );
    if (result.ok) throw new Error("Expected capture analysis failure");
    expect(result.error._tag).toBe(tag);
    if (mode === "wait")
      expect(result.error.cause).toBe(f.controller.signal.reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(
      (await readdir(f.directory)).filter((name) =>
        name.startsWith("decoder-"),
      ),
    ).toEqual([]);
  },
);

it.each(["capture", "fields"] as const)(
  "does not attribute the version probe's output to a %s command that fails to launch",
  async (operation) => {
    const f = await fixture("launch-failure");
    const result =
      operation === "capture"
        ? await f.service.inspect({ path: f.path, fields: ["ip.addr"] })
        : await f.service.inspectFields({ kind: "fields" });
    if (result.ok) throw new Error("Expected launch failure");
    expect(f.calls()).toBe(2);
    expect(result.error.message).toContain("spawn E2BIG");
    expect(result.error.capturedOutput).toBeUndefined();
  },
);

it("retains a completed observation and cleanup ownership for retry", async () => {
  const f = await fixture("ok", true);
  const result = await f.service.inspect({ path: f.path, fields: ["ip.addr"] });
  if (result.ok) throw new Error("Expected cleanup failure");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.partialObservation).toMatchObject({
    operation: "inspect_packet_capture",
  });
  const retry = await f.service.inspect({ path: f.path, fields: ["ip.addr"] });
  expect(retry.ok).toBe(false);
  expect(f.calls()).toBe(2);
  f.allowCleanup();
  await f.service.close();
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith("decoder-")),
  ).toEqual([]);
});

it("rejects cancelled and invalid requests before any provider work", async () => {
  const f = await fixture();
  for (const input of [
    { path: "relative.pcap", fields: ["ip.addr"] },
    { path: f.path, fields: ["ip.addr"], interface: "lo0" },
  ]) {
    const result = await f.service.inspect(input);
    expect(result.ok).toBe(false);
  }
  const result = await f.service.inspect(
    { path: f.path, fields: ["ip.addr"] },
    { signal: AbortSignal.abort() },
  );
  if (result.ok) throw new Error("Expected cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(f.calls()).toBe(0);
});

it("retains a completed observation when cancellation arrives at the service boundary", async () => {
  const f = await fixture();
  const input = {
    path: f.path,
    fields: ["ip.addr"],
    display_filter: null,
    decode_as: [],
    packet_limit: null,
    two_pass: true,
    match_offset: 0,
    match_limit: 50,
  };
  const execution = await f.service.provider.inspect(input);
  if (!execution.ok) throw execution.error;
  const service = new PacketCaptureService({
    inspectFields: async () => {
      throw new Error("Unexpected field discovery call");
    },
    inspect: async () => {
      f.controller.abort({ request: "cancel at Evidence boundary" });
      return execution;
    },
    close: async () => {},
  });
  const result = await service.inspect(input, { signal: f.controller.signal });
  if (result.ok) throw new Error("Expected late cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(f.controller.signal.reason);
  expect(result.error.partialObservation).toMatchObject({
    operation: "inspect_packet_capture",
    normalized_result: {
      packets: [
        { "frame.number": ["1"], "ip.addr": ["192.0.2.1", "192.0.2.2"] },
      ],
    },
  });
});

it.each([
  ["workspace-full", "AnalysisResourceConstraintError"],
  ["snapshot-write-failure", "ProviderAdapterError"],
])(
  "reports %s against the private workspace, not the selected input",
  async (mode, tag) => {
    const f = await fixture(mode);
    const result = await f.service.inspect({
      path: f.path,
      fields: ["ip.addr"],
    });
    if (result.ok) throw new Error("Expected workspace failure");
    expect(result.error._tag).toBe(tag);
    if (result.error._tag === "ProviderAdapterError")
      expect(result.error).toMatchObject({
        diagnostics: {
          stage: "workspace",
          system_code: "EEXIST",
        },
      });
    if (result.error._tag === "AnalysisResourceConstraintError")
      expect(result.error).toMatchObject({
        reportedLimits: {
          system_code: "ENOSPC",
        },
      });
    expect(f.calls()).toBe(mode === "workspace-full" ? 0 : 1);
    expect(
      (await readdir(f.directory)).filter((name) =>
        name.startsWith("decoder-"),
      ),
    ).toEqual([]);
  },
);

it("refuses unsupported hosts before launching or allocating a workspace", async () => {
  const provider = new TsharkCaptureProvider(
    { REA_TSHARK_COMMAND: process.execPath },
    async () => {
      throw new Error("Must not launch");
    },
    async () => {
      throw new Error("Must not allocate");
    },
    "darwin",
  );
  const result = await new PacketCaptureService(provider).inspect({
    path: "/recording.pcap",
    fields: ["ip.addr"],
  });
  if (result.ok) throw new Error("Expected host refusal");
  expect(result.error).toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining("Linux"),
  });
});

it("selects TShark from PATH with the shared rule and records the selection", async () => {
  const f = await fixture("path");
  const result = await f.service.inspect({ path: f.path, fields: ["ip.addr"] });
  if (!result.ok) throw result.error;
  expect(result.value.normalized_result).toMatchObject({
    tool: {
      configured_path: join(f.directory, "tshark"),
      selection_source: "path",
      path: join(f.directory, "producer.mjs"),
    },
  });
});

it.each([
  [
    "bad-version",
    "Packet capture inspection currently requires Wireshark 4.x tools",
  ],
  [
    "foreign-version",
    "Expected TShark 4.x; inspect the selected installation.",
  ],
] as const)(
  "refuses an unadmitted version banner before dissection: %s",
  async (mode, reason) => {
    const f = await fixture(mode);
    const result = await f.service.inspect({
      path: f.path,
      fields: ["ip.addr"],
    });
    if (result.ok) throw new Error("Expected version refusal");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      reason: expect.stringContaining(reason),
    });
    expect(f.calls()).toBe(1);
  },
);

it("refuses a relative REA_TSHARK_COMMAND instead of searching PATH", async () => {
  const provider = new TsharkCaptureProvider(
    { REA_TSHARK_COMMAND: "tshark", PATH: "/usr/bin" },
    async () => {
      throw new Error("Must not launch");
    },
    async () => {
      throw new Error("Must not allocate");
    },
    "linux",
  );
  const result = await new PacketCaptureService(provider).inspect({
    path: "/recording.pcap",
    fields: ["ip.addr"],
  });
  if (result.ok) throw new Error("Expected configuration refusal");
  expect(result.error).toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: "REA_TSHARK_COMMAND must be an absolute path to the tshark binary",
  });
});

it("preserves complete Evidence when aborted during post-run integrity checks", async () => {
  const f = await fixture("post-run-abort");
  const result = await f.service.inspect(
    { path: f.path, fields: ["ip.addr"] },
    { signal: f.controller.signal },
  );
  if (result.ok) throw new Error("Expected late cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.partialObservation).toMatchObject({
    normalized_result: {
      packets: [
        { "frame.number": ["1"], "ip.addr": ["192.0.2.1", "192.0.2.2"] },
      ],
      diagnostics: "producer warning\n",
    },
  });
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith("decoder-")),
  ).toEqual([]);
});
it("preserves configured symlink paths separately from resolved tool identities", async () => {
  const f = await fixture("symlink");
  const result = await f.service.inspect({ path: f.path, fields: ["ip.addr"] });
  if (!result.ok) throw result.error;
  expect(result.value.normalized_result).toMatchObject({
    tool: {
      configured_path: join(f.directory, "configured-tool"),
      selection_source: "environment",
      path: join(f.directory, "producer.mjs"),
    },
    resource_limiter: {
      configured_path: join(f.directory, "configured-tool"),
      path: join(f.directory, "producer.mjs"),
    },
  });
});

it.each(["oversized-copy", "oversized-tool"])(
  "identifies the mutated %s without blaming the admitted source",
  async (mode) => {
    const f = await fixture(mode);
    const result = await f.service.inspect({
      path: f.path,
      fields: ["ip.addr"],
    });
    if (result.ok) throw new Error("Expected changed artifact");
    expect(result.error).toMatchObject({
      _tag: "AnalysisArtifactChangedError",
      path:
        mode === "oversized-tool"
          ? join(f.directory, "producer.mjs")
          : expect.stringMatching(/decoder-.*[/\\]capture$/u),
    });
    expect(
      (await readdir(f.directory)).filter((name) =>
        name.startsWith("decoder-"),
      ),
    ).toEqual([]);
  },
);
it("preserves termination signal and effective file ceiling as a resource failure", async () => {
  const f = await fixture("file-limit");
  const result = await f.service.inspect({ path: f.path, fields: ["ip.addr"] });
  if (result.ok) throw new Error("Expected resource failure");
  expect(result.error).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    resource: "file-size",
    reportedLimits: { file_bytes: 1048576 },
    capturedOutput: { signal: "SIGXFSZ", stderr: "before file limit\n" },
  });
  expect(analysisErrorRemediationAction(result.error)).toContain(
    "REA retains the tighter inherited limit",
  );
});

it("rejects oversized selector lists and UTF-8 argv expansion before provider work", async () => {
  const f = await fixture();
  for (const selections of [
    { fields: Array.from({ length: 1025 }, () => "ip.addr") },
    { fields: ["x".repeat(8193)] },
    { fields: ["x".repeat(8192)], display_filter: "界".repeat(8192) },
    {
      fields: ["ip.addr"],
      decode_as: Array.from({ length: 1025 }, () => "udp.port==5555,dns"),
    },
  ]) {
    const result = await f.service.inspect({ path: f.path, ...selections });
    if (result.ok) throw new Error("Expected invalid selectors");
    expect(result.error._tag).toBe("AnalysisInputError");
  }
  expect(f.calls()).toBe(0);
});

it("discovers installed protocols and field definitions without a capture", async () => {
  const f = await fixture();
  for (const [input, expected] of [
    [
      { query: "USB" },
      {
        records: [{ abbreviation: "usb", kind: "protocol", field_type: null }],
        output_window: { examined: 2, matching: 1, returned: 1 },
      },
    ],
    [
      { kind: "fields", protocol: "usb", limit: 1 },
      {
        records: [
          {
            abbreviation: "usb.idVendor",
            field_type: "FT_UINT16",
            source_line: 2,
          },
        ],
        output_window: {
          examined: 3,
          matching: 2,
          returned: 1,
          has_more: true,
        },
      },
    ],
    [
      { kind: "fields", protocol: "usb", offset: 1, limit: null },
      {
        records: [
          {
            kind: "field",
            name: "Other Vendor",
            abbreviation: "usb.idVendor",
            field_type: "FT_UINT32",
            parent_protocol: "usb",
            display_base: "BASE_HEX",
            bitmask: "0x0",
            description: "Second registration",
            source_line: 3,
          },
        ],
        output_window: { matching: 2, returned: 1, has_more: false },
      },
    ],
    [
      { kind: "fields", query: "destination" },
      {
        records: [
          {
            abbreviation: "ip.addr",
            description: "Source or destination",
            display_base: "",
          },
        ],
      },
    ],
    [
      { query: "no-such-protocol" },
      { records: [], output_window: { matching: 0, returned: 0 } },
    ],
  ] as const) {
    const result = await f.service.inspectFields(input);
    if (!result.ok) throw result.error;
    const report = packetFieldsCatalogSchema.parse(
      result.value.normalized_result,
    );
    expect(report).toMatchObject(expected);
    expect(report.tool.arguments).toEqual(["-G", "fields"]);
    expect(report.tool.version_diagnostics).toBe("version warning\n");
    expect(report.diagnostics).toBe("glossary warning\n");
    expect(report.limits.output_bytes).toBe(32 * 1024 * 1024);
  }
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith("decoder-")),
  ).toEqual([]);
});

it("matches Unicode simple case-folded protocol and field glossary queries", async () => {
  const f = await fixture("unicode-search");
  for (const [input, expected] of [
    [{ kind: "protocols", query: "Σ" }, "greek.proto"],
    [{ kind: "fields", query: "Σ" }, "greek.field"],
  ] as const) {
    const result = await f.service.inspectFields(input);
    if (!result.ok) throw result.error;
    const report = packetFieldsCatalogSchema.parse(
      result.value.normalized_result,
    );
    expect(report.records).toMatchObject([{ abbreviation: expected }]);
    expect(report.output_window.matching).toBe(1);
  }
});

it("shares discovery admission with inspection and refuses work after shutdown", async () => {
  const f = await fixture("gated");
  const active = f.service.inspect({ path: f.path, fields: ["ip.addr"] });
  await f.acquired;
  const busy = await f.service.inspectFields({});
  f.release();
  if (!(await active).ok) throw new Error("Inspection failed");
  expect(busy).toMatchObject({
    ok: false,
    error: { operation: "inspect_packet_fields", resource: "capacity" },
  });
  await f.service.close();
  expect(await f.service.inspectFields({})).toMatchObject({
    ok: false,
    error: {
      operation: "inspect_packet_fields",
      _tag: "AnalysisCancelledError",
    },
  });
});

it.each([
  "bad-version",
  "nonzero",
  "overflow",
  "wait",
  "oversized-tool",
  "invalid-json",
])("retains field discovery failure facts: %s", async (mode) => {
  const f = await fixture(mode);
  const result = await f.service.inspectFields(
    {},
    { signal: f.controller.signal },
  );
  if (result.ok) throw new Error("Expected failure");
  expect(result.error).toMatchObject({ operation: "inspect_packet_fields" });
  if (mode === "bad-version")
    expect(result.error.capturedOutput).toMatchObject({
      stdout: "TShark (Wireshark) 3.0.0\n",
      stderr: "version warning\n",
    });
  if (mode === "invalid-json")
    expect(result.error.capturedOutput?.stdout).toBe("not json\n");
  if (mode === "overflow") {
    expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
    if (!(result.error instanceof AnalysisResourceConstraintError))
      throw new Error("Expected command-output allowance refusal");
    expect(result.error).toMatchObject({
      resource: "memory",
      reportedLimits: { output_bytes: 32 * 1024 * 1024 },
      retryable: false,
    });
    expect(analysisErrorRemediationAction(result.error)).toContain(
      "The retained command-output allowance",
    );
    expect(analysisErrorRemediationAction(result.error)).not.toMatch(
      /Review the reported worker memory limits/u,
    );
  }
});

it("retains completed discovery on late cancellation and cleanup failure", async () => {
  for (const mode of ["post-run-abort", "cleanup"]) {
    const f = await fixture(mode, mode === "cleanup");
    const result = await f.service.inspectFields(
      { query: "usb" },
      { signal: f.controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        partialObservation: {
          operation: "inspect_packet_fields",
          normalized_result: { records: [{ abbreviation: "usb" }] },
        },
      },
    });
    if (mode === "cleanup") {
      await f.service.inspectFields({});
      await f.service.inspect({ path: f.path, fields: ["ip.addr"] });
      expect(f.calls()).toBe(2);
      for (let attempt = 0; attempt < 2; attempt++)
        await expect(f.service.close()).rejects.toMatchObject({
          operation: "inspect_packet_fields",
          cleanupIncomplete: true,
        });
    }
    f.allowCleanup();
    await f.service.close();
  }
});

it("preserves discovery resource ownership through CLI shutdown retries", async () => {
  const f = await fixture("cleanup", true);
  const cli = Cli.create("discovery-cleanup", { sync: false });
  registerCaptureCommands(cli, silentLogger, {}, f.service);
  let stdout = "";
  try {
    await cli.serve(
      ["inspect-packet-fields", "--query", "usb", "--format", "json"],
      {
        stdout: (text) => {
          stdout += text;
        },
        exit: () => {},
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: {
          cleanup_error: {
            details: { operation: "inspect_packet_fields" },
          },
        },
      },
    });
  } finally {
    f.allowCleanup();
    await f.service.close();
  }
});

it.each(
  [false, true].flatMap((failsClose) =>
    [false, true].map((discovery) => ({ failsClose, discovery })),
  ),
)(
  "retains completed Evidence and exact cancellation during workspace close: %j",
  async ({ failsClose, discovery }) => {
    const f = await fixture("close-abort", failsClose);
    const result = discovery
      ? await f.service.inspectFields({}, { signal: f.controller.signal })
      : await f.service.inspect(
          { path: f.path, fields: ["ip.addr"] },
          { signal: f.controller.signal },
        );
    if (result.ok) throw new Error("Expected finalization cancellation");
    const primary = failsClose ? result.error.cleanupPrimary : result.error;
    expect(primary).toMatchObject({ _tag: "AnalysisCancelledError" });
    expect(primary?.cause).toBe(f.controller.signal.reason);
    expect(result.error.partialObservation).toMatchObject({
      operation: discovery ? "inspect_packet_fields" : "inspect_packet_capture",
    });
    expect(result.error.cleanupIncomplete).toBe(failsClose);
    if (failsClose)
      await expect(f.service.close()).rejects.toMatchObject({
        cleanupIncomplete: true,
      });
    f.allowCleanup();
    await f.service.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(primary?.cause).toBe(f.controller.signal.reason);
  },
);
