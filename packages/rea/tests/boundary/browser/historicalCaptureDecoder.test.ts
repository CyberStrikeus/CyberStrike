import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import type { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { ProviderProcessSupervisor } from "../../../src/process/ProviderProcess.js";
import { createDeferred } from "../../fixtures/binarySession.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { HistoricalCaptureDecoder } from "../../../src/browser/history/HistoricalCaptureDecoder.js";
import { MitmproxyCaptureAdapter } from "../../../src/browser/history/MitmproxyCaptureAdapter.js";
import {
  MITMPROXY_CAPTURE_PROVIDER_IDENTITY,
  HAR_CAPTURE_PROVIDER_IDENTITY,
} from "../../../src/browser/history/CaptureRelease.js";
import {
  inspectWebNetworkCaptureInputSchema,
  WEB_NETWORK_CAPTURE_LIMITS,
} from "../../../src/domain/webNetworkCapture.js";
import { historicalHar } from "../../fixtures/historicalHar.js";
import { decodeHarCapture } from "../../../src/browser/history/HarCapture.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { primaryAnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";

const linux = it.skipIf(process.platform !== "linux");

linux("refuses a directory configured as the mitmdump executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-mitmdump-command-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const command = join(root, "mitmdump");
  await mkdir(command);

  await expect(
    new MitmproxyCaptureAdapter({ REA_MITMDUMP_COMMAND: command }).command(
      join(root, "request.json"),
      join(root, "runtime"),
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining(command),
  });
});

linux("allows a symlink to a regular mitmdump executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-mitmdump-command-symlink-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const command = join(root, "mitmdump");
  const target = join(root, "mitmdump-bin");
  await writeFile(target, "#!/bin/sh\n", { mode: 0o700 });
  await symlink(target, command);

  await expect(
    new MitmproxyCaptureAdapter({ REA_MITMDUMP_COMMAND: command }).command(
      join(root, "request.json"),
      join(root, "runtime"),
    ),
  ).resolves.toMatchObject({ command });
});

it("keeps the admitted decoder environment across adapter preparation and refreshes it for the next call", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-capture-environment-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "capture.har");
  const observedPath = join(root, "observed.json");
  const text = JSON.stringify(historicalHar());
  await writeFile(path, text);
  const environment = { ...process.env, REA_CAPTURE_TEST_VALUE: "first" };
  let runtimePath: string | undefined;
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "har",
        identity: HAR_CAPTURE_PROVIDER_IDENTITY,
        command: async (_, selectedRuntime) => {
          // Adapter preparation can yield while callers reconfigure the next operation.
          await Promise.resolve();
          environment.REA_CAPTURE_TEST_VALUE = "changed-during-preparation";
          return {
            command: process.execPath,
            arguments: [
              "-e",
              `
            const fs = require("node:fs");
            fs.writeFileSync(process.argv[1], JSON.stringify(process.env.REA_CAPTURE_TEST_VALUE));
            fs.writeFileSync(process.argv[2], process.argv[3]);
          `,
              observedPath,
              join(selectedRuntime, "reply.json"),
              JSON.stringify({ ok: true, value: decodeHarCapture(text, []) }),
            ],
          };
        },
      },
    ],
    environment,
    async () => {
      const runtime = await PrivateRuntimeRoot.create({
        prefix: "rea-capture-environment-",
      });
      runtimePath = runtime.path;
      return runtime;
    },
  );
  onTestFinished(() => decoder.close());
  for (const selected of ["first", "second"]) {
    environment.REA_CAPTURE_TEST_VALUE = selected;
    const result = await decoder.inspect(
      inspectWebNetworkCaptureInputSchema.parse({
        capture_path: path,
        format: "har",
      }),
    );
    expect(result.ok).toBe(true);
    expect(JSON.parse(await readFile(observedPath, "utf8"))).toBe(selected);
    if (runtimePath === undefined) throw new Error("runtime was not acquired");
    await expect(access(runtimePath)).rejects.toMatchObject({ code: "ENOENT" });
  }
});

it.skipIf(process.platform === "win32")(
  "binds independently selected mitmproxy configuration before runtime preparation",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-mitmproxy-environment-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const capturePath = join(root, "capture.mitm");
    const observedPath = join(root, "observed.json");
    await writeFile(capturePath, "inert selected capture");
    const first = join(root, "first");
    const second = join(root, "second");
    const value = {
      ...decodeHarCapture(JSON.stringify(historicalHar()), []),
      decoder: MITMPROXY_CAPTURE_PROVIDER_IDENTITY,
    };
    for (const command of [first, second]) {
      await writeFile(
        command,
        `#!${process.execPath}
const fs = require("node:fs");
const request = JSON.parse(fs.readFileSync(process.argv.find(a => a.startsWith("rea_request_path=")).slice("rea_request_path=".length), "utf8"));
fs.writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify({ command: ${JSON.stringify(command)}, host: process.env.REA_CAPTURE_TEST_VALUE }));
fs.writeFileSync(request.reply_path, ${JSON.stringify(JSON.stringify({ ok: true, value }))});
`,
        { mode: 0o700 },
      );
    }
    // Exercise the Linux adapter gate while the actual owned inert child uses this host.
    const command = MitmproxyCaptureAdapter.prototype.command;
    vi.spyOn(MitmproxyCaptureAdapter.prototype, "command").mockImplementation(
      function (this: MitmproxyCaptureAdapter, request, runtime) {
        const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
        Object.defineProperty(process, "platform", {
          ...platform,
          value: "linux",
        });
        try {
          return command.call(this, request, runtime);
        } finally {
          Object.defineProperty(process, "platform", platform);
        }
      },
    );
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const adapterEnvironment = { REA_MITMDUMP_COMMAND: first };
    const hostEnvironment = {
      ...process.env,
      REA_MITMDUMP_COMMAND: "independent-host-setting",
      REA_CAPTURE_TEST_VALUE: "first-host",
    };
    let runtimePath: string | undefined;
    const decoder = new HistoricalCaptureDecoder(
      [new MitmproxyCaptureAdapter(adapterEnvironment)],
      hostEnvironment,
      async () => {
        adapterEnvironment.REA_MITMDUMP_COMMAND = second;
        hostEnvironment.REA_CAPTURE_TEST_VALUE = "changed-during-preparation";
        const runtime = await PrivateRuntimeRoot.create({
          prefix: "rea-mitmproxy-environment-",
        });
        runtimePath = runtime.path;
        return runtime;
      },
    );
    onTestFinished(() => decoder.close());
    for (const [selectedCommand, selectedHost] of [
      [first, "first-host"],
      [second, "second-host"],
    ] as const) {
      adapterEnvironment.REA_MITMDUMP_COMMAND = selectedCommand;
      hostEnvironment.REA_CAPTURE_TEST_VALUE = selectedHost;
      const result = await decoder.inspect(
        inspectWebNetworkCaptureInputSchema.parse({
          capture_path: capturePath,
          format: "mitmproxy",
        }),
      );
      expect(
        result.ok,
        result.ok ? "" : JSON.stringify(projectAnalysisError(result.error)),
      ).toBe(true);
      expect(JSON.parse(await readFile(observedPath, "utf8"))).toEqual({
        command: selectedCommand,
        host: selectedHost,
      });
      if (runtimePath === undefined)
        throw new Error("runtime was not acquired");
      await expect(access(runtimePath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  },
);

const expectOwnedDecoderPrimary = (
  error: AnalysisError,
  outcome: "cancelled" | "process",
  reason: unknown,
) => {
  const primary = primaryAnalysisError(error);
  if (outcome === "cancelled") {
    expect(primary._tag).toBe("AnalysisCancelledError");
    expect(primary.cause).toBe(reason);
  } else {
    expect(primary.diagnostics).toMatchObject({
      exit_code: 7,
      stderr: "authored workload failure",
    });
  }
};

it.each(["cancelled", "process"] as const)(
  "retains an unresolved decoder and its root across concurrent inspection and shutdown (%s)",
  async (outcome) => {
    const root = await mkdtemp(join(tmpdir(), "rea-capture-owned-cleanup-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const capturePath = join(root, "capture.har");
    const markerPath = join(root, "started.json");
    const finishPath = join(root, "finish");
    const text = JSON.stringify(historicalHar());
    await writeFile(capturePath, text);
    const peerEntered = createDeferred<void>();
    const peerContinue = createDeferred<void>();
    const controller = new AbortController();
    const reason = { request: "cancel owned inert decoder" };
    let targetPid: number | undefined;
    let targetOwner: ProviderProcessSupervisor | undefined;
    let denied = true;
    let targetStops = 0;
    const stop = ProviderProcessSupervisor.prototype.stop;
    vi.spyOn(ProviderProcessSupervisor.prototype, "stop").mockImplementation(
      function (this: ProviderProcessSupervisor, options) {
        if (this.launch.process.pid === targetPid) {
          targetOwner = this;
          targetStops++;
          if (denied)
            return Promise.resolve({
              status: "incomplete",
              reason: "controlled stop refusal",
            });
        }
        return stop.call(this, options);
      },
    );
    let calls = 0;
    let roots = 0;
    let targetRuntime: string | undefined;
    let targetRootCloses = 0;
    let denyRoot = false;
    const decoder = new HistoricalCaptureDecoder(
      [
        {
          format: "har",
          identity: HAR_CAPTURE_PROVIDER_IDENTITY,
          command: async (_, runtimePath) => {
            if (calls++ === 0)
              return {
                command: process.execPath,
                arguments: [
                  "-e",
                  `const fs = require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify(process.pid)); setInterval(() => { if (fs.existsSync(process.argv[2])) { process.stderr.write("authored workload failure"); process.exit(7); } }, 10)`,
                  markerPath,
                  finishPath,
                ],
              };
            peerEntered.resolve(undefined);
            await peerContinue.promise;
            await writeFile(
              join(runtimePath, "reply.json"),
              JSON.stringify({ ok: true, value: decodeHarCapture(text, []) }),
            );
            return { command: process.execPath, arguments: ["-e", ""] };
          },
        },
      ],
      process.env,
      async () => {
        const runtime = await PrivateRuntimeRoot.create({
          prefix: "capture-private-runtime-",
        });
        if (roots++ !== 0) return runtime;
        targetRuntime = runtime.path;
        return {
          path: runtime.path,
          close: async () => {
            targetRootCloses++;
            if (denyRoot) throw new Error("controlled root close refusal");
            await runtime.close();
          },
        };
      },
    );
    onTestFinished(async () => {
      denied = false;
      denyRoot = false;
      peerContinue.resolve(undefined);
      await targetOwner?.stop();
      await decoder.close();
      vi.restoreAllMocks();
    });
    const input = inspectWebNetworkCaptureInputSchema.parse({
      capture_path: capturePath,
      format: "har",
      sensitive_values: ["capture-private-runtime"],
    });
    const target = decoder.inspect(input, { signal: controller.signal });
    await vi.waitFor(
      async () => {
        targetPid = JSON.parse(await readFile(markerPath, "utf8"));
      },
      { timeout: 5000 },
    );
    const peer = decoder.inspect(input);
    await peerEntered.promise;
    if (outcome === "cancelled") controller.abort(reason);
    else await writeFile(finishPath, "finish workload");
    const failed = await target;
    if (failed.ok) throw new Error("cancelled decoder must fail");
    expect(targetRootCloses).toBe(0);
    expectOwnedDecoderPrimary(failed.error, outcome, reason);
    expect(failed.error.partialObservation).toMatchObject({
      kind: "file-snapshot-hash",
      path: capturePath,
      bytes: Buffer.byteLength(text),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(projectAnalysisError(failed.error).code).toBe("cleanup_incomplete");
    expect(JSON.stringify(projectAnalysisError(failed.error))).not.toContain(
      "capture-private-runtime",
    );
    if (targetRuntime === undefined) throw new Error("runtime missing");
    await expect(access(targetRuntime)).resolves.toBeUndefined();
    expect(targetOwner?.launch.process.exitCode).toBe(
      outcome === "cancelled" ? null : 7,
    );
    const closing = decoder.close().then(
      () => undefined,
      (cause) => cause,
    );
    peerContinue.resolve(undefined);
    expect((await peer).ok).toBe(true);
    expect(await closing).toBeInstanceOf(Error);
    expect(targetRootCloses).toBe(0);
    denied = false;
    denyRoot = true;
    await expect(decoder.close()).rejects.toBeInstanceOf(Error);
    expect(targetRootCloses).toBe(1);
    const releasedStops = targetStops;
    denyRoot = false;
    await decoder.close();
    expect(targetStops).toBe(releasedStops);
    await expect(access(targetRuntime)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(projectAnalysisError(failed.error).code).not.toBe(
      "cleanup_incomplete",
    );
    expectOwnedDecoderPrimary(failed.error, outcome, reason);
    expect(projectAnalysisError(failed.error).code).toBe(
      outcome === "cancelled" ? "cancelled" : "execution_failure",
    );
  },
  15000,
);

it("applies a non-default capture deadline and releases its runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-capture-deadline-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "capture.har");
  await writeFile(path, JSON.stringify(historicalHar()));
  let runtimePath: string | undefined;
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "har",
        identity: HAR_CAPTURE_PROVIDER_IDENTITY,
        command: () =>
          Promise.resolve({
            command: process.execPath,
            arguments: ["-e", "setInterval(() => {}, 1_000_000)"],
          }),
      },
    ],
    process.env,
    async () => {
      const runtime = await PrivateRuntimeRoot.create({
        prefix: "rea-capture-deadline-",
      });
      runtimePath = runtime.path;
      return runtime;
    },
  );
  const result = await decoder.inspect(
    inspectWebNetworkCaptureInputSchema.parse({
      capture_path: path,
      format: "har",
      capture_timeout_ms: 250,
    }),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected capture timeout");
  expect(result.error._tag).toBe("AnalysisTimeoutError");
  expect(result.error.userMessage).toContain("250");
  expect(result.error.userMessage).toContain("capture_timeout_ms");
  if (runtimePath === undefined) throw new Error("runtime was not acquired");
  await expect(access(runtimePath)).rejects.toMatchObject({ code: "ENOENT" });
}, 8_000);

it.each([true, false])(
  "binds decoder replies to the complete selected provider identity (matching name: %s)",
  async (matching) => {
    const root = await mkdtemp(join(tmpdir(), "rea-capture-identity-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "capture.har");
    const text = JSON.stringify(historicalHar());
    await writeFile(path, text);
    const decoder = new HistoricalCaptureDecoder(
      [
        {
          format: "har",
          identity: HAR_CAPTURE_PROVIDER_IDENTITY,
          command: async (_, runtimePath) => {
            const value = decodeHarCapture(text, []);
            if (!matching) value.decoder.name = "different adapter";
            await writeFile(
              join(runtimePath, "reply.json"),
              JSON.stringify({ ok: true, value }),
            );
            return { command: process.execPath, arguments: ["-e", ""] };
          },
        },
      ],
      process.env,
    );
    const result = await decoder.inspect(
      inspectWebNetworkCaptureInputSchema.parse({
        capture_path: path,
        format: "har",
      }),
    );
    expect(result.ok).toBe(matching);
    if (!result.ok) expect(result.error._tag).toBe("AnalysisOutputError");
    else expect(result.value.decoder).toEqual(HAR_CAPTURE_PROVIDER_IDENTITY);
  },
);

it("classifies an oversized selected capture before creating an owned decoder", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-historical-limit-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "input.har");
  await writeFile(path, "");
  await truncate(path, WEB_NETWORK_CAPTURE_LIMITS.inputBytes + 1);
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "har",
        identity: HAR_CAPTURE_PROVIDER_IDENTITY,
        command: async () => {
          throw new Error("Oversized input must not launch decoding");
        },
      },
    ],
    process.env,
  );
  const result = await decoder.inspect(
    inspectWebNetworkCaptureInputSchema.parse({
      capture_path: path,
      format: "har",
    }),
  );
  if (result.ok) throw new Error("Oversized input must fail");
  expect(result.error._tag).toBe("AnalysisInputError");
  expect(projectAnalysisError(result.error)).toMatchObject({
    category: "invalid_input",
    details: {
      issues: [
        {
          path: ["capture_path"],
          reason: "out_of_range",
          expected: {
            maximum_capture_bytes: WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
          },
        },
      ],
    },
  });
});

it("retains a failed capture reader and retries it before a fresh load", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-capture-reader-close-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "input.har");
  await writeFile(path, JSON.stringify(historicalHar()));
  const originalClose = OwnedFileHandle.prototype.close;
  const close = vi.spyOn(OwnedFileHandle.prototype, "close");
  let allowClose = false;
  let closeAttempts = 0;
  close.mockImplementation(async function (this: OwnedFileHandle) {
    closeAttempts += 1;
    if (!allowClose) throw new Error("injected capture reader close failure");
    await originalClose.call(this);
  });
  let decoderCalls = 0;
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "har",
        identity: HAR_CAPTURE_PROVIDER_IDENTITY,
        command: async () => {
          decoderCalls += 1;
          return {
            command: process.execPath,
            arguments: ["-e", "process.exit(0)"],
          };
        },
      },
    ],
    process.env,
  );
  const input = inspectWebNetworkCaptureInputSchema.parse({
    capture_path: path,
    format: "har",
  });
  try {
    const first = await decoder.inspect(input);
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("Reader close failure must fail inspection");
    expect(first.error.cleanupIncomplete).toBe(true);
    expect(first.error.cleanupResources).toContain(path);
    expect(decoderCalls).toBe(0);

    const refused = await decoder.inspect(input);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("Fresh read must wait for owner cleanup");
    expect(refused.error.cleanupIncomplete).toBe(true);
    expect(refused.error.cleanupResources).toContain(path);
    expect(decoderCalls).toBe(0);
    expect(closeAttempts).toBe(2);

    allowClose = true;
    await decoder.close();
    expect(closeAttempts).toBe(3);
    expect(first.error.cleanupIncomplete).toBe(false);
    expect(first.error.cleanupResources).toEqual([]);
  } finally {
    allowClose = true;
    await decoder.close().catch(() => undefined);
    close.mockRestore();
  }
});

it("does not misclassify decoder filesystem failures as missing selected input", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-historical-command-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "input.har");
  await writeFile(path, JSON.stringify(historicalHar()));
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "har",
        identity: HAR_CAPTURE_PROVIDER_IDENTITY,
        command: async () => {
          throw Object.assign(
            new Error("Configured decoder command file missing"),
            { code: "ENOENT" },
          );
        },
      },
    ],
    process.env,
  );
  const result = await decoder.inspect(
    inspectWebNetworkCaptureInputSchema.parse({
      capture_path: path,
      format: "har",
    }),
  );
  if (result.ok) throw new Error("Failed decoder command must fail");
  expect(result.error._tag).toBe("ProviderAdapterError");
  expect(projectAnalysisError(result.error)).toMatchObject({
    details: {
      diagnostics: {
        phase: "decoder",
        reason: "Configured decoder command file missing",
      },
    },
  });
});

it.each(["missing-capture", "missing-reply", "failed-command"])(
  "redacts declared paths and diagnostics while preserving the %s failure",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "rea-historical-sensitive-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "explicit-private-value.har");
    if (mode !== "missing-capture")
      await writeFile(path, JSON.stringify(historicalHar()));
    const decoder = new HistoricalCaptureDecoder(
      [
        {
          format: "har",
          identity: HAR_CAPTURE_PROVIDER_IDENTITY,
          command: async () => ({
            command: process.execPath,
            arguments: [
              "-e",
              mode === "failed-command"
                ? 'process.stderr.write("explicit-private-value ordinary diagnostic"); process.exit(2)'
                : "process.exit(0)",
            ],
          }),
        },
      ],
      process.env,
    );
    const result = await decoder.inspect(
      inspectWebNetworkCaptureInputSchema.parse({
        capture_path: path,
        format: "har",
        sensitive_values: ["explicit-private-value", "REDACTED"],
      }),
    );
    if (result.ok) throw new Error("Failure required");
    const projected = projectAnalysisError(result.error);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("explicit-private-value");
    expect(serialized).not.toContain("REDACTED");
    expect(result.error._tag).toBe(
      mode === "missing-capture"
        ? "AnalysisInputError"
        : mode === "missing-reply"
          ? "AnalysisOutputError"
          : "ProviderAdapterError",
    );
    if (mode === "missing-capture") expect(serialized).toContain("ENOENT");
    if (mode === "failed-command")
      expect(serialized).toContain('"exit_code":2');
  },
);

it("reports an absent owned reply as output failure and removes its private snapshot root", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-historical-decoder-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "input.har");
  await writeFile(path, JSON.stringify(historicalHar()));
  let privatePath: string | undefined;
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "har",
        identity: HAR_CAPTURE_PROVIDER_IDENTITY,
        command: async (_, runtimePath) => {
          privatePath = runtimePath;
          return {
            command: process.execPath,
            arguments: ["-e", "process.exit(0)"],
          };
        },
      },
    ],
    process.env,
  );
  const result = await decoder.inspect(
    inspectWebNetworkCaptureInputSchema.parse({
      capture_path: path,
      format: "har",
    }),
  );
  if (result.ok) throw new Error("Owned reply is required");
  expect(result.error._tag).toBe("AnalysisOutputError");
  expect(result.error.message).toContain("ENOENT");
  if (privatePath === undefined)
    throw new Error("Private root was not acquired");
  await expect(access(privatePath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("cancels after snapshot acquisition before launch and removes private input declarations", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-historical-cancel-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "input.har");
  await writeFile(path, JSON.stringify(historicalHar()));
  let privatePath: string | undefined;
  const controller = new AbortController();
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "har",
        identity: HAR_CAPTURE_PROVIDER_IDENTITY,
        command: async (_, runtimePath) => {
          privatePath = runtimePath;
          controller.abort();
          return {
            command: process.execPath,
            arguments: ["-e", "process.exit(3)"],
          };
        },
      },
    ],
    process.env,
  );
  const result = await decoder.inspect(
    inspectWebNetworkCaptureInputSchema.parse({
      capture_path: path,
      format: "har",
      sensitive_values: ["explicit-private-declaration"],
    }),
    { signal: controller.signal },
  );
  if (result.ok) throw new Error("Cancelled acquisition must fail");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  if (privatePath === undefined)
    throw new Error("Private root was not acquired");
  await expect(access(privatePath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("preserves the exact cancellation reason observed during final runtime close", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-historical-final-cancel-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "input.har");
  const text = JSON.stringify(historicalHar());
  await writeFile(path, text);
  const controller = new AbortController();
  const reason = { request: "cancel during runtime close" };
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "har",
        identity: HAR_CAPTURE_PROVIDER_IDENTITY,
        command: async (_, runtimePath) => {
          await writeFile(
            join(runtimePath, "reply.json"),
            JSON.stringify({ ok: true, value: decodeHarCapture(text, []) }),
          );
          return {
            command: process.execPath,
            arguments: ["-e", "process.exit(0)"],
          };
        },
      },
    ],
    process.env,
    async () => {
      const runtime = await PrivateRuntimeRoot.create({
        prefix: "rea-final-cancel-proof-",
      });
      return {
        path: runtime.path,
        close: async () => {
          controller.abort(reason);
          await runtime.close();
        },
      };
    },
  );
  const result = await decoder.inspect(
    inspectWebNetworkCaptureInputSchema.parse({
      capture_path: path,
      format: "har",
    }),
    { signal: controller.signal },
  );
  if (result.ok) throw new Error("Finalization cancellation must fail");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
  expect(result.error.partialObservation).toMatchObject({
    artifact: { path, sha256: expect.any(String) },
    records: [{ ordinal: 0 }],
  });
});

it("retains completed capture facts and binds final root cleanup to its retry lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-historical-report-cleanup-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "input.har");
  const text = JSON.stringify(historicalHar());
  await writeFile(path, text);
  let runtimePath: string | undefined;
  let allowClose = false;
  let runtime: PrivateRuntimeRoot | undefined;
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "har",
        identity: HAR_CAPTURE_PROVIDER_IDENTITY,
        command: async (_, path) => {
          await writeFile(
            join(path, "reply.json"),
            JSON.stringify({ ok: true, value: decodeHarCapture(text, []) }),
          );
          return {
            command: process.execPath,
            arguments: ["-e", "process.exit(0)"],
          };
        },
      },
    ],
    process.env,
    async () => {
      runtime = await PrivateRuntimeRoot.create({
        prefix: "rea-report-cleanup-proof-",
      });
      runtimePath = runtime.path;
      onTestFinished(() => runtime?.close());
      return {
        path: runtime.path,
        close: async () => {
          if (!allowClose)
            throw new Error("injected private root close failure");
          await runtime?.close();
        },
      };
    },
  );
  const result = await decoder.inspect(
    inspectWebNetworkCaptureInputSchema.parse({
      capture_path: path,
      format: "har",
    }),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Root close failure must be reported");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(runtimePath).toBeDefined();
  expect(result.error.cleanupResources).toContain(runtimePath);
  expect(result.error.partialObservation).toMatchObject({
    artifact: { path, sha256: expect.any(String) },
    records: [{ ordinal: 0 }],
  });

  allowClose = true;
  await decoder.close();
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupResources).toEqual([]);
});

it("keeps late cancellation primary when runtime close also fails, then clears on retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-historical-cancel-cleanup-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "input.har");
  const text = JSON.stringify(historicalHar());
  await writeFile(path, text);
  const controller = new AbortController();
  const reason = { request: "cancel during failed root close" };
  let runtime: PrivateRuntimeRoot | undefined;
  let closeAttempts = 0;
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "har",
        identity: HAR_CAPTURE_PROVIDER_IDENTITY,
        command: async (_, runtimePath) => {
          await writeFile(
            join(runtimePath, "reply.json"),
            JSON.stringify({ ok: true, value: decodeHarCapture(text, []) }),
          );
          return {
            command: process.execPath,
            arguments: ["-e", "process.exit(0)"],
          };
        },
      },
    ],
    process.env,
    async () => {
      runtime = await PrivateRuntimeRoot.create({
        prefix: "rea-cancel-cleanup-proof-",
      });
      onTestFinished(() => runtime?.close());
      return {
        path: runtime.path,
        close: async () => {
          closeAttempts += 1;
          if (closeAttempts === 1) {
            controller.abort(reason);
            throw new Error("injected close failure after cancellation");
          }
          await runtime?.close();
        },
      };
    },
  );
  const result = await decoder.inspect(
    inspectWebNetworkCaptureInputSchema.parse({
      capture_path: path,
      format: "har",
    }),
    { signal: controller.signal },
  );
  if (result.ok) throw new Error("Cancellation and failed close must fail");
  expect(result.error._tag).toBe("ProviderAdapterError");
  expect(result.error.cleanupPrimary?._tag).toBe("AnalysisCancelledError");
  expect(result.error.cleanupPrimary?.cause).toBe(reason);
  expect(JSON.stringify(result.error.diagnostics)).not.toContain(
    "partial_observation",
  );
  expect(result.error.partialObservation).toMatchObject({
    artifact: { path, sha256: expect.any(String) },
    records: [{ ordinal: 0 }],
  });
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toContain(runtime?.path);

  await decoder.close();
  expect(closeAttempts).toBe(2);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupResources).toEqual([]);
});

it.each([
  { reason: "input-limit", tag: "AnalysisInputError" },
  { reason: "expanded-limit", tag: "AnalysisInputError" },
  { reason: "resource-limit", tag: "AnalysisResourceConstraintError" },
  { reason: "decoder", tag: "ProviderAdapterError" },
  { reason: "limit", tag: "AnalysisOutputError" },
])(
  "preserves $reason decoder failures through the public error boundary",
  async ({ reason, tag }) => {
    const root = await mkdtemp(join(tmpdir(), "rea-historical-reply-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "input.har");
    await writeFile(path, JSON.stringify(historicalHar()));
    let privatePath: string | undefined;
    const decoder = new HistoricalCaptureDecoder(
      [
        {
          format: "har",
          identity: HAR_CAPTURE_PROVIDER_IDENTITY,
          command: async (_, runtimePath) => {
            privatePath = runtimePath;
            await writeFile(
              join(runtimePath, "reply.json"),
              JSON.stringify({
                ok: false,
                reason,
                message: "Specific decoder constraint",
                pointer: "/extension/child",
              }),
            );
            return {
              command: process.execPath,
              arguments: ["-e", "process.exit(0)"],
            };
          },
        },
      ],
      process.env,
    );
    const result = await decoder.inspect(
      inspectWebNetworkCaptureInputSchema.parse({
        capture_path: path,
        format: "har",
      }),
    );
    if (result.ok) throw new Error("Failure required");
    expect(result.error._tag).toBe(tag);
    const projected = projectAnalysisError(result.error);
    if (reason === "input-limit") {
      expect(projected).toMatchObject({
        category: "invalid_input",
        details: {
          issues: [
            {
              path: ["capture_path", "/extension/child"],
              reason: "out_of_range",
              expected: {
                maximum_capture_nesting: WEB_NETWORK_CAPTURE_LIMITS.depth,
              },
            },
          ],
        },
      });
    } else if (reason === "expanded-limit") {
      expect(projected).toMatchObject({
        category: "invalid_input",
        details: {
          issues: [
            {
              path: ["capture_path", "/extension/child"],
              reason: "out_of_range",
              expected: {
                maximum_expanded_capture_bytes:
                  WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
              },
            },
          ],
        },
      });
    } else if (reason === "limit") {
      expect(projected).toMatchObject({
        code: "unreadable_output",
        retryable: false,
        message: expect.stringContaining(
          String(WEB_NETWORK_CAPTURE_LIMITS.outputBytes),
        ),
        details: {
          diagnostics: {
            maximum_reply_bytes: WEB_NETWORK_CAPTURE_LIMITS.outputBytes,
          },
        },
      });
      expect(projected.remediation.action).toContain("no runtime override");
      expect(projected.remediation.action).toContain(
        "no completed capture Evidence",
      );
      expect(projected.remediation.action).not.toContain("rea doctor");
      expect(result.error.partialObservation).toMatchObject({
        kind: "file-snapshot-hash",
        path,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    } else if (tag === "ProviderAdapterError") {
      expect(projected).toMatchObject({
        details: {
          diagnostics: {
            phase: "decoder",
            reason: "Specific decoder constraint",
            failure_kind: reason,
            pointer: "/extension/child",
          },
        },
      });
    }
    if (privatePath === undefined)
      throw new Error("Private root was not acquired");
    await expect(access(privatePath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "reports a real filesystem permission denial separately from missing capture input",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "rea-historical-denied-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "unreadable.har");
    await writeFile(path, JSON.stringify(historicalHar()), { mode: 0o000 });
    const decoder = new HistoricalCaptureDecoder(
      [
        {
          format: "har",
          identity: HAR_CAPTURE_PROVIDER_IDENTITY,
          command: async () => {
            throw new Error("Permission-denied input must not launch decoding");
          },
        },
      ],
      process.env,
    );
    const result = await decoder.inspect(
      inspectWebNetworkCaptureInputSchema.parse({
        capture_path: path,
        format: "har",
      }),
    );
    await chmod(path, 0o600);
    if (result.ok) throw new Error("Permission denial required");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "access_denied",
      category: "unavailable",
      retryable: false,
      details: {
        operation: "inspect_web_network_capture",
        path,
        system_code: "EACCES",
      },
    });
    expect(projectAnalysisError(result.error).remediation.action).toContain(
      "read access",
    );
  },
);

it.each(["format", "process"])(
  "preserves the structured %s failure when runtime cleanup fails",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "rea-historical-cleanup-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "capture-private.har");
    await writeFile(path, JSON.stringify(historicalHar()));
    const decoder = new HistoricalCaptureDecoder(
      [
        {
          format: "har",
          identity: HAR_CAPTURE_PROVIDER_IDENTITY,
          command: async (_, runtimePath) => {
            if (kind === "format")
              await writeFile(
                join(runtimePath, "reply.json"),
                JSON.stringify({
                  ok: false,
                  reason: "format",
                  message: "Malformed retained record",
                  pointer: "/metadata/capture-private",
                }),
              );
            return {
              command: process.execPath,
              arguments: [
                "-e",
                kind === "format"
                  ? "process.exit(0)"
                  : 'process.stderr.write("Specific provider fault"); process.exit(3)',
              ],
            };
          },
        },
      ],
      process.env,
      async () => {
        const runtime = await PrivateRuntimeRoot.create({
          prefix: "rea-cleanup-proof-",
        });
        onTestFinished(() => runtime.close());
        return {
          path: runtime.path,
          close: async () => {
            throw new Error("Deliberate cleanup denial");
          },
        };
      },
    );
    const result = await decoder.inspect(
      inspectWebNetworkCaptureInputSchema.parse({
        capture_path: path,
        format: "har",
        sensitive_values: ["capture-private"],
      }),
    );
    if (result.ok) throw new Error("Cleanup failure required");
    expect(result.error.cleanupPrimary?._tag).toBe(
      kind === "format" ? "AnalysisInputError" : "ProviderAdapterError",
    );
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: {
          primary_error:
            kind === "format"
              ? {
                  category: "invalid_input",
                  details: {
                    issues: [
                      {
                        path: ["capture_path", "/metadata"],
                        reason: "invalid_format",
                        message: "Malformed retained record",
                      },
                    ],
                  },
                }
              : {
                  code: "execution_failure",
                  details: {
                    diagnostics: {
                      phase: "decoder",
                      exit_code: 3,
                      stderr: "Specific provider fault",
                    },
                  },
                },
        },
      },
    });
    expect(JSON.stringify(projected)).not.toContain("capture-private");
  },
);

it.each([
  { closeFails: false, reply: "capture" },
  { closeFails: true, reply: "capture" },
  { closeFails: false, reply: "malformed" },
  { closeFails: true, reply: "malformed" },
  { closeFails: false, reply: "malformed UTF-8" },
  { closeFails: true, reply: "malformed UTF-8" },
  { closeFails: false, reply: "malformed schema" },
  { closeFails: true, reply: "malformed schema" },
  { closeFails: false, reply: "refusal" },
  { closeFails: true, reply: "refusal" },
])(
  "retains validated reply completion through descriptor cancellation %j",
  async ({ closeFails, reply }) => {
    const root = await mkdtemp(join(tmpdir(), "rea-reply-finalization-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "input.har");
    const text = JSON.stringify(historicalHar());
    await writeFile(path, text);
    const controller = new AbortController();
    const reason = { caller: "reply descriptor close" };
    const originalClose = OwnedFileHandle.prototype.close;
    let closes = 0;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        closes += 1;
        if (closes === 2 && closeFails) {
          controller.abort(reason);
          throw new Error("controlled reply close denial");
        }
        await originalClose.call(this);
        if (closes === 2) controller.abort(reason);
      });
    const decoder = new HistoricalCaptureDecoder(
      [
        {
          format: "har",
          identity: HAR_CAPTURE_PROVIDER_IDENTITY,
          command: async (_, runtimePath) => {
            const bytes =
              reply === "malformed UTF-8"
                ? Buffer.concat([
                    Buffer.from('{"ok":false,"reason":"format","message":"'),
                    Buffer.from([0xff]),
                    Buffer.from('","pointer":""}'),
                  ])
                : Buffer.from(
                    reply === "malformed"
                      ? "{"
                      : JSON.stringify(
                          reply === "malformed schema"
                            ? { ok: true, value: {} }
                            : reply === "refusal"
                              ? {
                                  ok: false,
                                  reason: "limit",
                                  message: "Complete reply allowance exceeded",
                                  pointer: "",
                                }
                              : { ok: true, value: decodeHarCapture(text, []) },
                        ),
                  );
            return {
              command: process.execPath,
              arguments: [
                "-e",
                `require('node:fs').writeFileSync(process.argv[1],Buffer.from(${JSON.stringify(bytes.toString("base64"))},'base64'))`,
                join(runtimePath, "reply.json"),
              ],
            };
          },
        },
      ],
      process.env,
    );
    try {
      const result = await decoder.inspect(
        inspectWebNetworkCaptureInputSchema.parse({
          capture_path: path,
          format: "har",
        }),
        { signal: controller.signal },
      );
      if (result.ok)
        throw new Error("Expected reply finalization cancellation");
      expect(projectAnalysisError(result.error).code).toBe(
        closeFails
          ? "cleanup_incomplete"
          : reply === "capture"
            ? "cancelled"
            : "unreadable_output",
      );
      if (reply !== "capture")
        expect(result.error.partialObservation).toMatchObject({
          kind: "file-snapshot-hash",
          path,
          bytes: Buffer.byteLength(text),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
      else
        expect(result.error.partialObservation).toMatchObject({
          artifact: { path },
          records: [{ ordinal: 0 }],
        });
      await decoder.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error).code).toBe(
        reply === "capture" ? "cancelled" : "unreadable_output",
      );
      const primary = primaryAnalysisError(result.error);
      if (reply !== "capture") {
        expect(primary.diagnostics).toMatchObject({
          reply_finalization_error: { code: "cancelled" },
        });
        expect(
          primary.secondaryFailures.some(
            (failure) =>
              failure._tag === "AnalysisCancelledError" &&
              failure.cause === reason,
          ),
        ).toBe(true);
        if (reply === "malformed")
          expect(primary.message).toContain("Reply is malformed JSON.");
        if (reply === "malformed UTF-8")
          expect(primary.message).toContain("Reply is not valid UTF-8.");
        if (reply === "malformed schema")
          expect(primary.message).toContain("Reply violates its schema");
      } else expect(primary.cause).toBe(reason);
      expect(closes).toBe(closeFails ? 3 : 2);
    } finally {
      close.mockRestore();
      await decoder.close();
    }
  },
);

it("excludes normalized native numbers before retaining a completed decoder reply", async () => {
  const root = await createTestTempDirectory("rea-native-number-redaction-");
  const capturePath = join(root, "capture.mitm");
  const original = "controlled native decoder input";
  await writeFile(capturePath, original);
  const payload = decodeHarCapture(JSON.stringify(historicalHar()), []);
  payload.decoder = MITMPROXY_CAPTURE_PROVIDER_IDENTITY;
  const record = payload.records[0]!;
  record.reported = { metadata: { small: 1e-7, large: 1e20, ordinary: 42 } };
  record.binary_fields = [];
  record.redactions = [];
  record.numeric_literals = [
    { pointer: "/metadata/small", producer_type: "float", literal: "1e-07" },
    { pointer: "/metadata/large", producer_type: "float", literal: "1e+20" },
  ];
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "mitmproxy",
        identity: MITMPROXY_CAPTURE_PROVIDER_IDENTITY,
        command: async (_, runtime) => ({
          command: process.execPath,
          arguments: [
            "-e",
            "require('node:fs').writeFileSync(process.argv[1], process.argv[2])",
            join(runtime, "reply.json"),
            JSON.stringify({ ok: true, value: payload }),
          ],
        }),
      },
    ],
    process.env,
  );
  onTestFinished(() => decoder.close());
  for (const marked of [false, true]) {
    const result = await decoder.inspect(
      inspectWebNetworkCaptureInputSchema.parse({
        capture_path: capturePath,
        format: "mitmproxy",
        sensitive_values: marked ? ["1e-7", "000000"] : [],
      }),
    );
    if (!result.ok) throw result.error;
    const retained = result.value.records[0]!;
    expect(retained.reported).toEqual({
      metadata: {
        small: marked ? null : 1e-7,
        large: marked ? null : 1e20,
        ordinary: 42,
      },
    });
    expect(retained.numeric_literals).toEqual(
      marked ? [] : record.numeric_literals,
    );
    expect(retained.redactions).toEqual(
      marked
        ? [
            { pointer: "/metadata/small", reason: "explicit-sensitive-value" },
            { pointer: "/metadata/large", reason: "explicit-sensitive-value" },
          ]
        : [],
    );
    expect(await readFile(capturePath, "utf8")).toBe(original);
  }
});
