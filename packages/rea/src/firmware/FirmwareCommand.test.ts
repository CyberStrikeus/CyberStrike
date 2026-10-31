import { cleanupOwnedProcessGroup } from "../process/ProcessOwnership.js";
import { EventEmitter } from "node:events";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { expect, it as test, vi } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { AnalysisCapabilityUnavailableError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { FIRMWARE_LIMITS } from "./FirmwareRelease.js";
import { FirmwareFileAccess } from "./FirmwareFiles.js";
import {
  resolveFirmwareCommand,
  runFirmwareCommand,
} from "./FirmwareCommand.js";
import {
  spawnOwnedProviderProcess,
  type ProviderProcessHandle,
  type ProviderProcessSupervisor,
  type OwnedProviderProcessSpawnOptions,
} from "../process/ProviderProcess.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ExecFileOutputCancelledError } from "../process/ExecFileOutput.js";

const it = test.skipIf(process.platform !== "linux");

it.each([
  { source: "analysis", wrapped: false },
  { source: "caller", wrapped: false },
  { source: "analysis", wrapped: true },
  { source: "caller", wrapped: true },
] as const)(
  "classifies $source cancellation during launcher admission (wrapped: $wrapped)",
  async ({ source, wrapped }) => {
    const analysis = new AbortController();
    const caller = new AbortController();
    const reason =
      source === "analysis"
        ? new DOMException("selected deadline", "TimeoutError")
        : { caller: "opaque admission cancellation" };
    const retainCleanup = vi.fn();
    const failure: unknown = await runFirmwareCommand({
      fileSizeCeiling: Number.MAX_SAFE_INTEGER,
      engine: "binwalk",
      operation: "inspect_firmware_regions",
      command: "/usr/bin/true",
      limiter: "/usr/bin/true",
      args: ["--version"],
      cwd: await createTestTempDirectory("rea-firmware-admission-"),
      environment: process.env,
      signal: AbortSignal.any([analysis.signal, caller.signal]),
      deadline: {
        phase: "analysis",
        signal: analysis.signal,
        timeoutMs: 1234,
        expiresAtMs: performance.now() + 1234,
      },
      launcher: async (options) => {
        // Real launcher is paused at its first ownership-preparation await;
        // it must reject before acquiring a child after this cancellation.
        const admission = wrapped
          ? undefined
          : spawnOwnedProviderProcess(options);
        (source === "analysis" ? analysis : caller).abort(reason);
        if (admission !== undefined) return admission;
        throw new ExecFileOutputCancelledError(reason);
      },
      retainCleanup,
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(AnalysisError);
    if (!(failure instanceof AnalysisError))
      throw new Error("Expected typed admission interruption");
    expect(failure.cause).toBe(reason);
    expect(projectAnalysisError(failure)).toMatchObject(
      source === "analysis"
        ? {
            code: "provider_timeout",
            details: { timeout_ms: 1234, diagnostics: { phase: "analysis" } },
            remediation: {
              action: expect.stringContaining("analysis_timeout_ms"),
            },
          }
        : { code: "cancelled" },
    );
    expect(retainCleanup).not.toHaveBeenCalled();
  },
);

it("does not relabel an unrelated launch failure when a deadline also fires", async () => {
  const analysis = new AbortController();
  const failure = new Error("distinct launch refusal");
  await expect(
    runFirmwareCommand({
      fileSizeCeiling: Number.MAX_SAFE_INTEGER,
      engine: "binwalk",
      operation: "inspect_firmware_regions",
      command: "/usr/bin/true",
      limiter: "/usr/bin/true",
      args: [],
      cwd: await createTestTempDirectory("rea-firmware-admission-error-"),
      environment: process.env,
      signal: analysis.signal,
      deadline: {
        phase: "analysis",
        signal: analysis.signal,
        timeoutMs: 1234,
        expiresAtMs: performance.now() + 1234,
      },
      launcher: async () => {
        analysis.abort();
        throw failure;
      },
      retainCleanup: vi.fn(),
    }),
  ).rejects.toBe(failure);
});

test("names the host and tool requirement of an unconfigured engine", async () => {
  const refusal: unknown = await resolveFirmwareCommand(
    {},
    "binwalk",
    "inspect_firmware_regions",
    new FirmwareFileAccess(),
  ).catch((cause: unknown) => cause);

  expect(refusal).toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
  });
  if (!(refusal instanceof AnalysisCapabilityUnavailableError))
    throw new Error("Expected a capability refusal");
  expect(projectAnalysisError(refusal)).toMatchObject({
    code: "capability_unavailable",
    message: refusal.reason,
    remediation: { action: refusal.reason },
  });
  expect(refusal.reason).toContain("REA_BINWALK_COMMAND");
});

it("rejects a directory configured as the firmware engine executable", async () => {
  const root = await createTestTempDirectory("rea-firmware-command-");
  const command = join(root, "binwalk");
  const limiter = await executableFixture(root, "prlimit");
  await mkdir(command);

  await expect(
    resolveFirmwareCommand(
      {
        REA_BINWALK_COMMAND: command,
        REA_FIRMWARE_PRLIMIT_COMMAND: limiter,
      },
      "binwalk",
      "inspect_firmware_regions",
      new FirmwareFileAccess(),
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining(command),
  });
});

it("classifies an unusable firmware engine as an unavailable capability", async () => {
  const root = await createTestTempDirectory("rea-firmware-command-");
  const command = join(root, "binwalk");
  const limiter = await executableFixture(root, "prlimit");
  await writeFile(command, "not executable", { mode: 0o600 });

  await expect(
    resolveFirmwareCommand(
      {
        REA_BINWALK_COMMAND: command,
        REA_FIRMWARE_PRLIMIT_COMMAND: limiter,
      },
      "binwalk",
      "inspect_firmware_regions",
      new FirmwareFileAccess(),
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining(command),
  });
});

it("rejects a directory configured as the resource limiter executable", async () => {
  const root = await createTestTempDirectory("rea-firmware-limiter-");
  const command = await executableFixture(root, "binwalk");
  const limiter = join(root, "prlimit");
  await mkdir(limiter);

  await expect(
    resolveFirmwareCommand(
      {
        REA_BINWALK_COMMAND: command,
        REA_FIRMWARE_PRLIMIT_COMMAND: limiter,
      },
      "binwalk",
      "inspect_firmware_regions",
      new FirmwareFileAccess(),
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining(limiter),
  });
});

it("keeps captured tool output when firmware stops on SIGXCPU", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();
  const child: ProviderProcessHandle = {
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    pid: 4242,
    stdout,
    stderr,
    exitCode: null,
    signalCode: "SIGXCPU",
    kill: () => false,
  };
  let ended = 0;
  const close = () => {
    ended += 1;
    if (ended === 2) emitter.emit("close", null, "SIGXCPU");
  };
  stdout.once("end", close);
  stderr.once("end", close);
  setTimeout(() => {
    stdout.end("partial scan\n");
    stderr.end("cpu limit\n");
  }, 15);
  const analysis = new AbortController();
  const failure: unknown = await runFirmwareCommand({
    fileSizeCeiling: Number.MAX_SAFE_INTEGER,
    engine: "binwalk",
    operation: "inspect_firmware_regions",
    command: "/opt/binwalk",
    limiter: "/usr/bin/prlimit",
    args: ["--quiet"],
    cwd: await createTestTempDirectory("rea-firmware-signal-"),
    environment: process.env,
    signal: analysis.signal,
    deadline: {
      phase: "analysis",
      signal: analysis.signal,
      timeoutMs: 30_000,
      expiresAtMs: performance.now() + 30_000,
    },
    launcher: () =>
      Promise.resolve({
        process: child,
        ownership: {
          runId: "rea-firmware-signal",
          leaderPid: 4242,
          processGroupId: 4242,
        },
        cleanup: () => Promise.resolve({ cleaned: true, signaled: false }),
      }),
    retainCleanup: vi.fn(),
  }).catch((cause: unknown) => cause);
  expect(failure).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    resource: "cpu",
    capturedOutput: {
      stdout: "partial scan\n",
      stderr: "cpu limit\n",
      signal: "SIGXCPU",
      exit_code: null,
      truncated: false,
    },
  });
  if (!(failure instanceof AnalysisError))
    throw new Error("Expected a firmware resource constraint");
  expect(projectAnalysisError(failure).details?.captured_output).toMatchObject({
    stdout: "partial scan\n",
    stderr: "cpu limit\n",
    signal: "SIGXCPU",
  });
});

const executableFixture = async (root: string, name: string) => {
  const path = join(root, name);
  await writeFile(path, "#!/bin/sh\n");
  await chmod(path, 0o700);
  return path;
};

test.each([
  {
    selected: 1,
    inherited: Number.MAX_SAFE_INTEGER,
    expected: 8 * 1024 * 1024,
  },
  {
    selected: 16 * 1024 * 1024,
    inherited: Number.MAX_SAFE_INTEGER,
    expected: 16 * 1024 * 1024,
  },
  { selected: 16 * 1024 * 1024, inherited: 1024, expected: 1024 },
])(
  "separates payload $selected from metadata file headroom and inherited ceiling $inherited",
  async ({ selected, inherited, expected }) => {
    const root = await createTestTempDirectory("rea-firmware-file-policy-");
    const refused = new Error("stop after inspecting launch policy");
    const launcher = vi.fn(
      async (options: OwnedProviderProcessSpawnOptions) => {
        expect(options.arguments).toContain(`--fsize=${expected}:${expected}`);
        expect(options.arguments).toContain(
          `--as=${FIRMWARE_LIMITS.addressSpaceBytes}:${FIRMWARE_LIMITS.addressSpaceBytes}`,
        );
        throw refused;
      },
    );
    await expect(
      runFirmwareCommand({
        engine: "unblob",
        operation: "extract_firmware",
        command: "/synthetic/unblob",
        limiter: "/synthetic/prlimit",
        fileSizeCeiling: inherited,
        args: [],
        cwd: root,
        environment: {},
        signal: new AbortController().signal,
        deadline: {
          phase: "analysis",
          signal: new AbortController().signal,
          timeoutMs: 120_000,
          expiresAtMs: performance.now() + 120_000,
        },
        launcher,
        outputBudget: { root, bytes: selected, entries: 10 },
        retainCleanup: vi.fn(),
      }),
    ).rejects.toBe(refused);
    expect(launcher).toHaveBeenCalledOnce();
  },
);

test.each([
  { exitCode: 0, cleanupFails: false },
  { exitCode: 7, cleanupFails: false },
  { exitCode: 7, cleanupFails: true },
])(
  "preserves completed exit $exitCode through cancellation during real owned cleanup (fails: $cleanupFails)",
  async ({ exitCode, cleanupFails }) => {
    const root = await createTestTempDirectory("rea-firmware-finalization-");
    const caller = new AbortController();
    const reason = { caller: "cancel during final cleanup" };
    let cleanupCalls = 0;
    const retained: ProviderProcessSupervisor[] = [];
    const failure: unknown = await runFirmwareCommand({
      engine: "binwalk",
      operation: "inspect_firmware_regions",
      command: process.execPath,
      limiter: process.execPath,
      fileSizeCeiling: Number.MAX_SAFE_INTEGER,
      args: [],
      cwd: root,
      environment: process.env,
      signal: caller.signal,
      deadline: {
        phase: "analysis",
        signal: new AbortController().signal,
        timeoutMs: 30_000,
        expiresAtMs: performance.now() + 30_000,
      },
      launcher: async (options) => {
        const owned = await spawnOwnedProviderProcess({
          ...options,
          command: process.execPath,
          arguments: [
            "-e",
            `process.stdout.write("scan evidence\\n"); process.stderr.write("producer diagnostics\\n"); process.exitCode = ${exitCode}`,
          ],
        });
        return {
          ...owned,
          cleanup: async () => {
            cleanupCalls += 1;
            expect(owned.process.exitCode).toBe(exitCode);
            caller.abort(reason);
            const cleaned = await cleanupOwnedProcessGroup(owned.ownership);
            if (cleanupFails && cleanupCalls === 1)
              return {
                cleaned: false as const,
                reason: "controlled cleanup refusal after real release",
              };
            return cleaned;
          },
        };
      },
      retainCleanup: (owner) => {
        retained.push(owner);
      },
    }).catch((cause: unknown) => cause);
    expect(cleanupCalls).toBe(1);
    expect(failure).toBeInstanceOf(AnalysisError);
    if (!(failure instanceof AnalysisError))
      throw new Error("Expected typed failure");
    if (exitCode === 0) {
      expect(failure).toMatchObject({
        _tag: "AnalysisCancelledError",
        cause: reason,
      });
    } else if (cleanupFails) {
      expect(retained).toHaveLength(1);
      expect(await retained[0]!.stop()).toMatchObject({
        status: "verified-cleanup",
      });
      expect(cleanupCalls).toBe(2);
      retained[0]!.dispose();
      expect(failure).toMatchObject({
        diagnostics: {
          previous_error: {
            code: "execution_failure",
            details: { diagnostics: { exit_code: 7 } },
          },
        },
        capturedOutput: {
          stdout: "scan evidence\n",
          stderr: "producer diagnostics\n",
          exit_code: 7,
        },
      });
    } else {
      expect(failure).toMatchObject({
        _tag: "ProviderAdapterError",
        diagnostics: {
          exit_code: 7,
          stdout: "scan evidence\n",
          stderr: "producer diagnostics\n",
        },
      });
      expect(projectAnalysisError(failure).code).toBe("execution_failure");
    }
  },
);

// The injected launcher runs real owned Node processes on every POSIX host;
// Linux firmware binaries and prlimit are deliberately outside this lifecycle seam.
test.skipIf(process.platform === "win32").each([
  {
    overflow: false,
    exitCode: 7,
    acceptFailure: false,
    cancelBeforeExit: false,
    expected: "ProviderAdapterError",
  },
  {
    overflow: false,
    exitCode: 0,
    acceptFailure: false,
    cancelBeforeExit: false,
    expected: "AnalysisCancelledError",
  },
  {
    overflow: false,
    exitCode: 1,
    acceptFailure: true,
    cancelBeforeExit: false,
    expected: "AnalysisCancelledError",
  },
  {
    overflow: false,
    exitCode: 7,
    acceptFailure: false,
    cancelBeforeExit: true,
    expected: "AnalysisCancelledError",
  },
  {
    overflow: true,
    exitCode: 7,
    acceptFailure: false,
    cancelBeforeExit: false,
    expected: "ProviderAdapterError",
  },
])(
  "retains root exit $exitCode while a handshaken descendant holds output (accepted: $acceptFailure, earlier cancellation: $cancelBeforeExit, overflow: $overflow)",
  async ({ exitCode, acceptFailure, cancelBeforeExit, expected, overflow }) => {
    const root = await createTestTempDirectory(
      "rea-firmware-inherited-output-",
    );
    const caller = new AbortController();
    const reason = { caller: "cancel with inherited output still open" };
    let cleanupCalls = 0;
    let closed = false;
    let exited = false;
    const failure: unknown = await runFirmwareCommand({
      engine: "binwalk",
      operation: "inspect_firmware_regions",
      command: process.execPath,
      limiter: process.execPath,
      fileSizeCeiling: Number.MAX_SAFE_INTEGER,
      args: [],
      cwd: root,
      environment: process.env,
      signal: caller.signal,
      deadline: {
        phase: "analysis",
        signal: new AbortController().signal,
        timeoutMs: 30_000,
        expiresAtMs: performance.now() + 30_000,
      },
      acceptReportedExtractionFailure: acceptFailure,
      launcher: async (options) => {
        const exitRelease = join(root, "exit-release");
        const tailRelease = join(root, "tail-release");
        const descendant = `
          const { existsSync } = require("node:fs");
          setInterval(() => {}, 1000);
          const tail = setInterval(() => {
            if (!existsSync(${JSON.stringify(tailRelease)})) return;
            clearInterval(tail);
            process.stderr.write(Buffer.alloc(${overflow ? FIRMWARE_LIMITS.diagnosticBytes : 0}, 120), () => {
              process.stderr.write("descendant-tail\\n");
            });
          }, 10);
          process.send("ready");
        `;
        const owned = await spawnOwnedProviderProcess({
          ...options,
          command: process.execPath,
          arguments: [
            "-e",
            `
            const { spawn } = require("node:child_process");
            const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], {
              stdio: ["ignore", "inherit", "inherit", "ipc"],
            });
            child.once("message", () => {
              process.stderr.write("descendant-ready\\n");
              child.disconnect();
              child.unref();
              if (${cancelBeforeExit}) {
                const release = setInterval(() => {
                  if (!require("node:fs").existsSync(${JSON.stringify(exitRelease)})) return;
                  clearInterval(release);
                  process.exitCode = ${exitCode};
                }, 10);
              } else process.exitCode = ${exitCode};
            });
          `,
          ],
        });
        owned.process.once("close", () => {
          closed = true;
        });
        let diagnostics = "";
        owned.process.stderr?.on("data", (chunk: Buffer) => {
          diagnostics += chunk.toString();
          if (cancelBeforeExit && !caller.signal.aborted) {
            expect(exited).toBe(false);
            caller.abort(reason);
            void writeFile(exitRelease, "release");
          } else if (
            !cancelBeforeExit &&
            diagnostics.includes("descendant-tail")
          ) {
            expect(exited).toBe(true);
            expect(closed).toBe(false);
            caller.abort(reason);
          }
        });
        owned.process.once("exit", () => {
          exited = true;
          // Release descendant diagnostics only after the supervisor has also
          // observed the root's exit, leaving inherited pipes open until cleanup.
          queueMicrotask(() => {
            void writeFile(tailRelease, "release");
          });
        });
        return {
          ...owned,
          cleanup: async () => {
            cleanupCalls += 1;
            return cleanupOwnedProcessGroup(owned.ownership);
          },
        };
      },
      retainCleanup: () => {
        throw new Error("Real descendant cleanup must complete");
      },
    }).catch((cause: unknown) => cause);
    expect(exited).toBe(true);
    expect(cleanupCalls).toBe(1);
    expect(failure).toMatchObject({ _tag: expected });
    if (expected === "ProviderAdapterError")
      expect(failure).toMatchObject({
        diagnostics: {
          exit_code: 7,
          stderr: overflow
            ? expect.stringMatching(/^descendant-ready\nxxx/)
            : "descendant-ready\ndescendant-tail\n",
          truncated: overflow,
        },
      });
    else expect(failure).toMatchObject({ cause: reason });
  },
);
