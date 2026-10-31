import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";

import { runAdbCapture } from "../../../../src/adb/AdbCommand.js";
import {
  inspectAdbClient,
  resolveAdbBinary,
} from "../../../../src/adb/AdbConfiguration.js";
import { AdbDeviceAnalysisService } from "../../../../src/application/adb/AdbDeviceAnalysisService.js";
import {
  execFileOutput,
  execFileOutputFailure,
} from "../../../../src/process/ExecFileOutput.js";
import { AdbProvider } from "../../../../src/adb/AdbProvider.js";
import { parseEvidence } from "../../../../src/domain/evidence.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { AnalysisTimeoutError } from "../../../../src/domain/analysisErrorCore.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const hooks = vi.hoisted(() => ({
  afterCommand: undefined as (() => void) | undefined,
  failure: undefined as unknown,
}));

vi.mock("../../../../src/process/ExecFileOutput.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../../src/process/ExecFileOutput.js")
    >();
  return {
    ...actual,
    execFileBytes: async (...args: Parameters<typeof actual.execFileBytes>) => {
      try {
        return await actual.execFileBytes(...args);
      } catch (cause: unknown) {
        hooks.failure = cause;
        throw cause;
      } finally {
        hooks.afterCommand?.();
      }
    },
    execFileOutput: async (
      ...args: Parameters<typeof actual.execFileOutput>
    ) => {
      try {
        return await actual.execFileOutput(...args);
      } catch (cause: unknown) {
        hooks.failure = cause;
        throw cause;
      } finally {
        hooks.afterCommand?.();
      }
    },
  };
});

beforeEach(() => {
  hooks.afterCommand = undefined;
  hooks.failure = undefined;
});

const capture = async (
  script: string,
  signal?: AbortSignal,
  limits = { timeoutMs: 1000, maxOutputBytes: 1024 },
) =>
  runAdbCapture(
    "inspect_adb_device",
    { device: "device" },
    await resolveAdbBinary({ ...process.env, REA_ADB_PATH: process.execPath }),
    ["-e", script],
    limits,
    signal,
  );

const failureOf = async (result: ReturnType<typeof capture>) => {
  const completed = await result;
  expect(completed.ok).toBe(false);
  if (completed.ok) throw new Error("Expected command failure");
  return completed.error;
};

test.each([
  {
    script: "process.stderr.write('remote failure'); process.exitCode=7",
    tag: "AnalysisProtocolError",
  },
  {
    script: "process.stderr.write('device unauthorized'); process.exitCode=1",
    tag: "AnalysisUnsupportedTargetError",
  },
  {
    script: "setInterval(()=>{},1000)",
    tag: "AnalysisTimeoutError",
    limits: { timeoutMs: 100, maxOutputBytes: 1024 },
  },
  {
    script: "process.stdout.write('x'.repeat(4096))",
    tag: "AnalysisResourceConstraintError",
    limits: { timeoutMs: 1000, maxOutputBytes: 4 },
  },
])(
  "retains completed $tag when cancellation arrives at consumer handoff",
  async ({ script, tag, limits }) => {
    const controller = new AbortController();
    hooks.afterCommand = () => controller.abort("later consumer cancellation");
    const error = await failureOf(capture(script, controller.signal, limits));
    expect(error._tag).toBe(tag);
    expect(error.cause).toBe(hooks.failure);
  },
);

test("hands completed bytes to the consuming provider after a late abort", async () => {
  const controller = new AbortController();
  hooks.afterCommand = () => controller.abort(null);
  expect(
    await capture("process.stdout.write('observed')", controller.signal),
  ).toEqual({
    ok: true,
    value: { stdout: Buffer.from("observed"), stderr: Buffer.alloc(0) },
  });
});

test("retains the command owner's exact cancellation reason after active process exit", async () => {
  const root = await createTestTempDirectory("rea-adb-active-command-");
  const ready = join(root, "ready");
  const controller = new AbortController();
  const pending = capture(
    `require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready'); setInterval(()=>{},1000)`,
    controller.signal,
    { timeoutMs: 5000, maxOutputBytes: 1024 },
  );
  try {
    await vi.waitFor(async () =>
      expect(await readFile(ready, "utf8")).toBe("ready"),
    );
    controller.abort(null);
    const error = await failureOf(pending);
    expect(error._tag).toBe("AnalysisCancelledError");
    expect(error.cause).toBeNull();
    expect(hooks.failure).toMatchObject({
      _tag: "ExecFileOutputCancelledError",
      cause: null,
    });
  } finally {
    controller.abort(null);
    await pending;
  }
});

const clientScript = async (source: string) => {
  const root = await createTestTempDirectory("rea-adb-client-command-");
  const binary = join(root, "adb");
  await writeFile(binary, `#!${process.execPath}\n${source}\n`, {
    mode: 0o755,
  });
  return resolveAdbBinary({ ...process.env, REA_ADB_PATH: binary });
};
const nativeClientTest = test.skipIf(process.platform === "win32");

test.each([null, "caller stopped", new Error("caller stopped")] as const)(
  "keeps exact %s cancellation before version-probe admission",
  async (reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    const error: unknown = await inspectAdbClient(
      await resolveAdbBinary({ REA_ADB_PATH: process.execPath }),
      controller.signal,
    ).catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
    });
    if (!(error instanceof Error)) throw new Error("Expected cancellation");
    expect(error.cause).toBe(reason);
  },
);

nativeClientTest(
  "retains a version-probe capture overflow as a resource constraint",
  async () => {
    const selection = await clientScript(
      "process.stdout.write('x'.repeat(128 * 1024))",
    );
    const provider = new AdbProvider({
      environment: { REA_ADB_PATH: selection.binary },
    });
    onTestFinished(() => provider.close());
    const result = await provider.execute({
      operation: "inspect_adb_client",
      input: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected capture overflow");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "resource_constraint",
    });
    expect(result.error).toMatchObject({
      reportedLimits: { max_output_bytes: 65536 },
      capturedOutput: { truncated: true, stdout_bytes: 65536 },
    });
  },
);

nativeClientTest(
  "preserves missing-binary identity despite later cancellation",
  async () => {
    const root = await createTestTempDirectory("rea-adb-missing-command-");
    const controller = new AbortController();
    hooks.afterCommand = () => controller.abort(null);
    const error: unknown = await inspectAdbClient(
      await resolveAdbBinary({ REA_ADB_PATH: join(root, "missing") }),
      controller.signal,
    ).catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      code: "binary_missing",
      cause: hooks.failure,
    });
  },
);

nativeClientTest.each([
  null,
  "caller stopped",
  new Error("caller stopped"),
] as const)(
  "retains completed client Evidence and exact %s reason at application completion",
  async (reason) => {
    const selection = await clientScript(
      "console.log('Android Debug Bridge version 1.0.41\\nVersion 34.0.5-test')",
    );
    const provider = new AdbProvider({
      environment: { REA_ADB_PATH: selection.binary },
    });
    onTestFinished(() => provider.close());
    const controller = new AbortController();
    hooks.afterCommand = () => controller.abort(reason);
    const result = await new AdbDeviceAnalysisService(provider).execute(
      "inspect_adb_client",
      {},
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected completion cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "inspect_adb_client",
      confidence: "observed",
      normalized_result: {
        client: { version: "34.0.5-test" },
        contacted_adb_server: false,
      },
    });
  },
);

nativeClientTest(
  "keeps invalid client output primary over later cancellation",
  async () => {
    const selection = await clientScript(
      "console.log('unrecognized version output')",
    );
    const controller = new AbortController();
    hooks.afterCommand = () => controller.abort(null);
    const error: unknown = await inspectAdbClient(
      selection,
      controller.signal,
    ).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "version_unresolved" });
  },
);

nativeClientTest.each([false, true])(
  "projects the actual client probe deadline through provider admission (late abort: %s)",
  async (lateAbort) => {
    const selection = await clientScript("setInterval(()=>{},1000)");
    const provider = new AdbProvider({
      environment: { REA_ADB_PATH: selection.binary },
    });
    onTestFinished(() => provider.close());
    const controller = new AbortController();
    if (lateAbort)
      hooks.afterCommand = () => controller.abort("after the timeout");
    const result = await provider.execute(
      { operation: "inspect_adb_client", input: {} },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected version timeout");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "provider_timeout",
      retryable: true,
      details: {
        timeout_ms: 10000,
        diagnostics: { prerequisite_operation: "inspect_adb_client" },
      },
    });
    expect(result.error).toBeInstanceOf(AnalysisTimeoutError);
    expect(result.error.cause).toBeInstanceOf(AnalysisTimeoutError);
    const prerequisite = result.error.cause;
    if (!(prerequisite instanceof AnalysisTimeoutError))
      throw new Error("Expected the authored client-probe timeout frame");
    expect(prerequisite.operation).toBe("inspect_adb_client");
    expect(prerequisite.timeoutMs).toBe(10000);
    expect(prerequisite.cause).toBe(hooks.failure);
    const capturedOutput = {
      stdout: "",
      stderr: "",
      stdout_bytes: 0,
      stderr_bytes: 0,
      exit_code: null,
      signal: "SIGTERM",
      truncated: false,
    };
    expect(prerequisite.capturedOutput).toEqual(capturedOutput);
    expect(result.error.capturedOutput).toEqual(capturedOutput);
  },
  20000,
);

nativeClientTest(
  "projects an actual version-probe timeout through the public CLI",
  async () => {
    const selection = await clientScript("setInterval(()=>{},1000)");
    const root = dirname(selection.binary);
    const completed = await execFileOutput(
      process.execPath,
      ["scripts/rea.mjs", "inspect-adb-client", "--json"],
      {
        env: {
          PATH: process.env.PATH,
          HOME: root,
          USERPROFILE: root,
          REA_ADB_PATH: selection.binary,
        },
        timeout: 20000,
        stopSignal: "SIGTERM",
        maxBuffer: 1024 * 1024,
      },
    ).then(
      (output) => ({ exitCode: 0, stdout: output.stdout }),
      (cause: unknown) => {
        const failure = execFileOutputFailure(cause);
        if (failure === undefined) throw cause;
        return { exitCode: failure.code, stdout: failure.stdout };
      },
    );
    expect(completed.exitCode).toBe(1);
    expect(JSON.parse(completed.stdout)).toMatchObject({
      code: "provider_timeout",
      retryable: true,
      details: { timeout_ms: 10000 },
    });
  },
  20000,
);
