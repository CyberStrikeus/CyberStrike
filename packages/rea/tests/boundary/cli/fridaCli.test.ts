import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { DeviceManager } from "frida";

import { createCli } from "../../../src/cli.js";
import { FRIDA_TOOL_CONTRACTS } from "../../../src/contracts/fridaToolContracts.js";
import type { FridaInstrumentationPort } from "../../../src/application/frida/FridaInstrumentationPort.js";
import { AnalysisCapabilityUnavailableError } from "../../../src/domain/analysisErrorCore.js";
import { FridaInstrumentationManager } from "../../../src/frida/FridaInstrumentationManager.js";

it.each([
  {
    option: "--device-id",
    value: "missing-device",
    error: "Device not found",
    field: "device_id",
    code: "provider_timeout",
  },
  {
    option: "--remote-address",
    value: "127.0.0.1:27042",
    error: "Unable to connect to remote frida-server",
    field: "remote_address",
    code: "capability_unavailable",
  },
])(
  "retains selected Frida endpoint in CLI discovery failures: $field",
  async ({ option, value, error, field, code }) => {
    const bindings = {
      getDeviceById: async () => {
        throw new Error(error);
      },
      addRemoteDevice: async () => {
        throw new Error(error);
      },
    } as unknown as DeviceManager;
    const provider = new FridaInstrumentationManager({
      deviceManager: bindings,
    });
    let stdout = "";
    await createCli({}, undefined, provider).serve(
      ["list-frida-processes", option, value, "--json"],
      {
        env: {},
        exit: () => {},
        stdout: (text) => {
          stdout += text;
        },
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      code,
      details: { diagnostics: { [field]: value } },
    });
  },
);

it.each([
  { devices: [], cleanupError: null },
  {
    devices: [
      { deviceId: "local", name: "Local System", type: "local" },
      { deviceId: "socket", name: "Local Socket", type: "remote" },
    ],
    cleanupError: null,
  },
  {
    devices: [{ deviceId: "remote-device", name: "endpoint", type: "remote" }],
    cleanupError: "remote removal failed",
  },
])("returns canonical Frida device JSON for %j", async (observation) => {
  const provider: FridaInstrumentationPort = new FridaInstrumentationManager();
  provider.listDevices = async () => ({ ok: true, value: observation });
  let closed = false;
  provider.closeAll = async () => {
    closed = true;
  };
  let stdout = "";
  let exitCode = 0;
  await createCli({}, undefined, provider).serve(
    ["list-frida-devices", "--json"],
    {
      env: {},
      exit: (code) => {
        exitCode = code;
      },
      stdout: (text) => {
        stdout += text;
      },
    },
  );
  expect(exitCode).toBe(0);
  expect(closed).toBe(true);
  const output = FRIDA_TOOL_CONTRACTS.find(
    (contract) => contract.name === "list_frida_devices",
  )!.outputSchema.parse(JSON.parse(stdout));
  expect(output).toEqual({
    devices: observation.devices.map(({ deviceId, name, type }) => ({
      device_id: deviceId,
      name,
      type,
    })),
    cleanup_error: observation.cleanupError,
  });
});

it.each([false, true])(
  "preserves canonical process discovery when CLI cleanup fails: %s",
  async (cleanupFails) => {
    const provider: FridaInstrumentationPort =
      new FridaInstrumentationManager();
    const processes = [
      { pid: 0, name: "idle", identifier: null },
      { pid: 71, name: "target", identifier: "example.target" },
    ];
    provider.listProcesses = async (selector) => {
      expect(selector).toEqual({ deviceId: "chosen-device" });
      return {
        ok: true,
        value: {
          deviceId: "chosen-device",
          processes,
          cleanupError: "earlier endpoint cleanup diagnostic",
        },
      };
    };
    provider.closeAll = async () => {
      if (cleanupFails) throw new Error("final cleanup failed");
    };
    let stdout = "";
    await createCli({}, undefined, provider).serve(
      ["list-frida-processes", "--device-id", "chosen-device", "--json"],
      {
        env: {},
        exit: () => {},
        stdout: (text) => {
          stdout += text;
        },
      },
    );
    const expected = {
      device_id: "chosen-device",
      processes,
      cleanup_error: "earlier endpoint cleanup diagnostic",
    };
    if (cleanupFails)
      expect(JSON.parse(stdout)).toMatchObject({
        code: "cleanup_incomplete",
        details: { partial_observation: expected },
      });
    else
      expect(
        FRIDA_TOOL_CONTRACTS.find(
          (contract) => contract.name === "list_frida_processes",
        )!.outputSchema.parse(JSON.parse(stdout)),
      ).toEqual(expected);
  },
);

it("maps one-shot Frida CLI target, script, duration, and remote options", async () => {
  const calls: unknown[] = [];
  const provider: FridaInstrumentationPort = {
    async listDevices() {
      calls.push({ operation: "devices" });
      return { ok: true, value: { devices: [], cleanupError: null } };
    },
    async listProcesses() {
      return {
        ok: true,
        value: { deviceId: "local", processes: [], cleanupError: null },
      };
    },
    async startSession(input) {
      calls.push({ operation: "start", input });
      return {
        ok: true,
        value: {
          sessionId: "00000000-0000-4000-8000-000000000001",
          deviceId: "remote",
          target: "fixture",
          pid: 71,
          mode: input.mode,
          state: "running",
        },
      };
    },
    async loadScript(sessionId, source) {
      calls.push({ operation: "load", sessionId, source });
      return {
        ok: true,
        value: {
          scriptId: "00000000-0000-4000-8000-000000000002",
          sourceKind: source.sourceKind,
          sourcePath: source.sourceKind === "file" ? source.path : null,
          sourceSha256: "a".repeat(64),
          messages: [{ type: "send", payload: "observed" }],
          messagesTruncated: false,
        },
      };
    },
    async resumeSession(sessionId) {
      calls.push({ operation: "resume", sessionId });
      return { ok: true, value: null };
    },
    async unloadScript() {
      return { ok: true, value: null };
    },
    status(sessionId) {
      return {
        sessionId,
        deviceId: "remote",
        target: "fixture",
        pid: 71,
        mode: "attach",
        state: "running",
        targetResumeObserved: false,
        scripts: [],
        messages: [],
        messagesTruncated: false,
      };
    },
    async closeSession(sessionId) {
      calls.push({ operation: "close", sessionId });
      return { ok: true, value: { targetResumeObserved: false } };
    },
    async closeAll() {},
  };
  const cli = createCli({}, undefined, provider);
  let stdout = "";
  let exitCode = 0;
  await cli.serve(
    [
      "instrument-with-frida",
      "attach",
      "71",
      "--script",
      "send('hello')",
      "--remote-address",
      "127.0.0.1:27042",
      "--token",
      "synthetic-secret-token",
      "--keepalive-interval",
      "10",
      "--duration-ms",
      "0",
      "--json",
    ],
    {
      env: {},
      exit: (code) => {
        exitCode = code;
      },
      stdout: (text) => {
        stdout += text;
      },
    },
  );
  expect(exitCode).toBe(0);
  const result: unknown = JSON.parse(stdout);
  expect(() =>
    FRIDA_TOOL_CONTRACTS.find(
      (contract) => contract.name === "instrument_with_frida",
    )!.outputSchema.parse(result),
  ).not.toThrow();
  expect(JSON.stringify(result)).not.toContain("synthetic-secret-token");
  expect(calls).toEqual([
    {
      operation: "start",
      input: {
        mode: "attach",
        pid: 71,
        remote: {
          address: "127.0.0.1:27042",
          token: "synthetic-secret-token",
          keepaliveInterval: 10,
        },
        source: { sourceKind: "inline", source: "send('hello')" },
        durationMs: 0,
      },
    },
    {
      operation: "load",
      sessionId: "00000000-0000-4000-8000-000000000001",
      source: { sourceKind: "inline", source: "send('hello')" },
    },
    {
      operation: "close",
      sessionId: "00000000-0000-4000-8000-000000000001",
    },
  ]);

  stdout = "";
  exitCode = 0;
  await cli.serve(
    ["list-frida-devices", "--token", "synthetic-secret-token", "--json"],
    {
      env: {},
      exit: (code) => {
        exitCode = code;
      },
      stdout: (text) => {
        stdout += text;
      },
    },
  );
  expect(exitCode).not.toBe(0);
  expect(calls).toHaveLength(3);
  expect(stdout).not.toContain("synthetic-secret-token");
});

it("keeps Frida script-file identity in original bytes when UTF-8 decoding replaces invalid bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-frida-script-identity-"));
  const files = [
    {
      name: "ff.js",
      bytes: Buffer.from([
        0x2f, 0x2f, 0x20, 0xff, 0x0a, 0x73, 0x65, 0x6e, 0x64, 0x28, 0x31, 0x29,
        0x3b,
      ]),
    },
    {
      name: "fe.js",
      bytes: Buffer.from([
        0x2f, 0x2f, 0x20, 0xfe, 0x0a, 0x73, 0x65, 0x6e, 0x64, 0x28, 0x31, 0x29,
        0x3b,
      ]),
    },
    { name: "replacement.js", bytes: Buffer.from("// �\nsend(1);", "utf8") },
    {
      name: "ascii.js",
      bytes: Buffer.from("// ordinary ASCII\nsend(1);", "ascii"),
    },
  ];
  try {
    await Promise.all(
      files.map(({ name, bytes }) => writeFile(join(directory, name), bytes)),
    );
    const loadedSources: string[] = [];
    const deviceManager = {
      async getDeviceById() {
        return {
          id: "local",
          name: "Fixture device",
          type: "local",
          async getProcessByPid(pid: number) {
            return { pid, name: "fixture" };
          },
          async attach() {
            let detached = false;
            return {
              pid: 71,
              detached: { connect() {}, disconnect() {} },
              isDetached: () => detached,
              async detach() {
                detached = true;
              },
              async createScript(source: string) {
                loadedSources.push(source);
                return {
                  message: { connect() {}, disconnect() {} },
                  async load() {},
                  async unload() {},
                };
              },
            };
          },
        };
      },
    } as unknown as DeviceManager;

    for (const { name } of files) {
      const provider = new FridaInstrumentationManager({ deviceManager });
      let stdout = "";
      let exitCode = 0;
      await createCli({}, undefined, provider).serve(
        [
          "instrument-with-frida",
          "attach",
          "71",
          "--script-file",
          join(directory, name),
          "--duration-ms",
          "0",
          "--json",
        ],
        {
          env: {},
          exit: (code) => {
            exitCode = code;
          },
          stdout: (text) => {
            stdout += text;
          },
        },
      );
      expect(exitCode).toBe(0);
      const output: unknown = JSON.parse(stdout);
      const bytes = files.find((file) => file.name === name)?.bytes;
      if (bytes === undefined) throw new Error(`Missing fixture ${name}`);
      const decodedSource = bytes.toString("utf8");
      expect(loadedSources.at(-1)).toBe(decodedSource);
      const rawDigest = createHash("sha256").update(bytes).digest("hex");
      const loadedSourceDigest = createHash("sha256")
        .update(decodedSource, "utf8")
        .digest("hex");
      const outputText = JSON.stringify(output);
      if (name === "ff.js" || name === "fe.js") {
        expect(rawDigest).not.toBe(loadedSourceDigest);
        expect(output).toMatchObject({
          normalized_result: { source_sha256: rawDigest },
          raw_result: {
            source_representation: {
              encoding: "utf8",
              decoding: "replacement",
              loaded_source_sha256: loadedSourceDigest,
            },
          },
          limitations: expect.arrayContaining([
            expect.stringMatching(/replacement|original bytes/iu),
          ]),
        });
      } else {
        expect(output).toMatchObject({
          normalized_result: { source_sha256: rawDigest },
        });
        expect(outputText).not.toContain("source_representation");
      }
      await provider.closeAll();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("awaits failed startup cleanup without clearing an unbound cleanup marker", async () => {
  for (const cleanupFails of [false, true]) {
    const calls: string[] = [];
    const provider: FridaInstrumentationPort =
      new FridaInstrumentationManager();
    provider.startSession = async () => {
      calls.push("start");
      return {
        ok: false,
        error: new AnalysisCapabilityUnavailableError(
          "frida",
          "start_frida_session",
          "attach failed after spawn",
          {
            cleanup: {
              reason: "first resume failed",
              resources: ["paused spawn"],
            },
          },
        ),
      };
    };
    provider.closeAll = async () => {
      calls.push("cleanup");
      if (cleanupFails) throw new Error("resume still failed");
    };
    let stdout = "";
    await createCli({}, undefined, provider).serve(
      [
        "instrument-with-frida",
        "spawn",
        "/tmp/fixture",
        "--script",
        "send('ready')",
        "--json",
      ],
      {
        env: {},
        exit: () => {},
        stdout: (text) => {
          stdout += text;
        },
      },
    );
    expect(calls).toEqual(["start", "cleanup"]);
    const output: unknown = JSON.parse(stdout);
    expect(output).toMatchObject({
      code: "cleanup_incomplete",
    });
    expect(stdout).toContain("attach failed after spawn");
    if (cleanupFails) expect(stdout).toContain("primary_error");
  }
});

it("preserves observed devices when CLI provider cleanup fails", async () => {
  const provider: FridaInstrumentationPort = new FridaInstrumentationManager();
  const devices = [
    { deviceId: "remote-device", name: "selected endpoint", type: "remote" },
  ];
  provider.listDevices = async () => ({
    ok: true,
    value: { devices, cleanupError: null },
  });
  provider.closeAll = async () => {
    throw new Error("remote removal failed");
  };
  let stdout = "";
  await createCli({}, undefined, provider).serve(
    ["list-frida-devices", "--json"],
    {
      env: {},
      exit: () => {},
      stdout: (text) => {
        stdout += text;
      },
    },
  );
  const output: unknown = JSON.parse(stdout);
  expect(output).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      partial_observation: {
        devices: [
          {
            device_id: "remote-device",
            name: "selected endpoint",
            type: "remote",
          },
        ],
        cleanup_error: null,
      },
    },
  });
});

it.each([
  [
    ["attach", "abc", "--script", "send(1)"],
    "target",
    "attach mode needs a positive integer process ID.",
  ],
  [
    ["attach", "71"],
    "script",
    "Provide exactly one of --script or --script-file.",
  ],
  [
    ["attach", "71", "--script", "send(1)", "--script-file", "source.js"],
    "script",
    "Provide exactly one of --script or --script-file.",
  ],
  [
    ["attach", "71", "--script", "send(1)", "--argument", "ignored"],
    "argument",
    "--argument is only valid in spawn mode; remove it when attaching to a process.",
  ],
])(
  "names the rejected instrument-with-frida argument for %j",
  async (argv, path, message) => {
    let starts = 0;
    const provider = {
      async startSession() {
        starts += 1;
        throw new Error("Frida must not start for invalid input");
      },
    } as unknown as FridaInstrumentationPort;
    const cli = createCli({}, undefined, provider);
    let stdout = "";
    await cli.serve(["instrument-with-frida", ...argv, "--json"], {
      env: {},
      exit: () => undefined,
      stdout: (text) => {
        stdout += text;
      },
    });
    expect(JSON.parse(stdout)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [{ path: [path], reason: "invalid_value", message }],
      },
    });
    expect(starts).toBe(0);
  },
);

it("advances each Frida script source to the attach target error without attaching or spawning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-frida-script-source-"));
  const scriptPath = join(directory, "source.js");
  try {
    await writeFile(scriptPath, "send(1);\n");
    for (const scriptArguments of [
      ["--script", "send(1)"],
      ["--script-file", scriptPath],
    ]) {
      let starts = 0;
      const provider = {
        async startSession() {
          starts += 1;
          throw new Error("Frida must not attach or spawn for an invalid PID");
        },
      } as unknown as FridaInstrumentationPort;
      let stdout = "";
      await createCli({}, undefined, provider).serve(
        [
          "instrument-with-frida",
          "attach",
          "abc",
          ...scriptArguments,
          "--json",
        ],
        {
          env: {},
          exit: () => undefined,
          stdout: (text) => {
            stdout += text;
          },
        },
      );
      expect(JSON.parse(stdout)).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["target"],
              reason: "invalid_value",
              message: "attach mode needs a positive integer process ID.",
            },
          ],
        },
      });
      expect(starts).toBe(0);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
