import { access } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "../../domain/analysisErrorCore.js";
import { PrivateRuntimeRoot } from "../../process/PrivateRuntimeRoot.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../process/ProviderProcess.js";
import {
  WEB_SOURCE_MAP_LIMITS,
  type WebSourceMapReport,
} from "../../domain/webSourceLocation.js";
import { traceSourceMap } from "./TraceSourceMap.js";
import {
  runSourceMapCommand,
  SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES,
  type SourceMapCleanupRetention,
} from "./SourceMapCommand.js";

const report = traceSourceMap(
  JSON.stringify({ version: 3, sources: [], names: [], mappings: "" }),
  "https://app.test/app.map",
  { line: 1, column: 0 },
);
const completedReport: WebSourceMapReport = {
  ...report,
  runtime:
    report.runtime.id === "node-v8"
      ? { ...report.runtime, v8_heap_limit_bytes: 200 * 1024 * 1024 }
      : {
          ...report.runtime,
          process_memory_limit_bytes: SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES,
        },
};
const completedCodec = `process.stdout.write(${JSON.stringify(JSON.stringify({ state: "success", report: completedReport }))})`;

const unexpectedCleanup: SourceMapCleanupRetention = {};
afterEach(async () => {
  const owner = unexpectedCleanup.owner;
  const failure = await owner?.close();
  if (failure !== undefined) throw failure;
  unexpectedCleanup.owner = undefined;
  expect(owner).toBeUndefined();
});

const runChild = (
  signal: AbortSignal | undefined,
  script: string,
  onRuntime?: (path: string) => void,
  onLaunch?: () => void,
) =>
  runSourceMapCommand(
    "{}",
    "/probe/source.map",
    signal === undefined ? undefined : { signal },
    {
      prepareOwnership: async () => {},
      createRuntime: async () => {
        const runtime = await PrivateRuntimeRoot.create({
          prefix: "rea-source-map-command-test-",
        });
        onRuntime?.(runtime.path);
        return runtime;
      },
      launcher: async (options) => {
        const child = await spawnOwnedProviderProcess({
          ...options,
          arguments: ["-e", script],
        });
        onLaunch?.();
        return child;
      },
    },
    unexpectedCleanup,
  );

const exitsAfterHoldingOutput =
  'const {spawn}=require("node:child_process"); spawn(process.execPath,["-e","setTimeout(()=>{},400)"],{stdio:["ignore","inherit","inherit"]}); process.stderr.write("physical exit 7"); process.exit(7)';
const exitsThenDescendantExceedsStderrBudget =
  'const {spawn}=require("node:child_process"); spawn(process.execPath,["-e",`setTimeout(()=>{process.stderr.write("x".repeat(1024*1024+64)); setInterval(()=>{},1000)},25)`],{stdio:["ignore","inherit","inherit"]}); process.stderr.write("physical exit 7"); process.exit(7)';

it("preserves the exact object reason for an already-aborted caller", async () => {
  const reason = { caller: "opaque source-map request" };
  const controller = new AbortController();
  controller.abort(reason);
  const result = await runSourceMapCommand(
    "{}",
    "/probe/source.map",
    { signal: controller.signal },
    {
      prepareOwnership: async () => {},
      launcher: async () => {
        throw new Error("must not launch");
      },
    },
    unexpectedCleanup,
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected cancellation");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
});

it.each([null, { caller: "late source-map cancellation" }])(
  "retains a late caller reason %j when runtime cleanup first fails",
  async (reason) => {
    const root = await PrivateRuntimeRoot.create({
      prefix: "rea-source-map-late-cleanup-test-",
    });
    const controller = new AbortController();
    let cleanupAttempts = 0;
    const retainedCleanup: SourceMapCleanupRetention = {};
    try {
      const result = await runSourceMapCommand(
        "{}",
        "/probe/source.map",
        { signal: controller.signal },
        {
          prepareOwnership: async () => {},
          createRuntime: async () => ({
            path: root.path,
            close: async () => {
              cleanupAttempts += 1;
              if (cleanupAttempts === 1) {
                controller.abort(reason);
                throw new Error("controlled late cleanup failure");
              }
              await root.close();
            },
          }),
          launcher: async (options) =>
            spawnOwnedProviderProcess({
              ...options,
              arguments: ["-e", completedCodec],
            }),
        },
        retainedCleanup,
      );
      expect(result.ok).toBe(false);
      if (result.ok)
        throw new Error("expected cancellation with cleanup failure");
      expect(result.error.cleanupPrimary).toBeInstanceOf(
        AnalysisCancelledError,
      );
      expect(result.error.cleanupPrimary?.cause).toBe(reason);
      expect(result.error.cleanupResources).toEqual([root.path]);
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(retainedCleanup.owner).toBeDefined();
      await retainedCleanup.owner?.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(result.error.cleanupResources).toEqual([]);
      expect(result.error.cleanupPrimary?.cause).toBe(reason);
    } finally {
      await retainedCleanup.owner?.close();
      await root.close();
    }
  },
);

it("returns completed codec output after successful cleanup", async () => {
  const result = await runChild(undefined, completedCodec);
  expect(result).toEqual({ ok: true, value: completedReport });
});

it("preserves exact caller reason when cancellation precedes process exit", async () => {
  const reason = { caller: "active source-map cancellation" };
  const controller = new AbortController();
  let runtimePath: string | undefined;
  const result = await runChild(
    controller.signal,
    'process.stdout.write("ready\\n"); setInterval(()=>{},1000)',
    (path) => {
      runtimePath = path;
    },
    () => setTimeout(() => controller.abort(reason), 0),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected cancellation");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
  if (runtimePath === undefined) throw new Error("runtime was not acquired");
  await expect(access(runtimePath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("preserves an observed nonzero exit before caller cancellation during output drain", async () => {
  const reason = { caller: "later than owned exit" };
  const controller = new AbortController();
  let runtimePath: string | undefined;
  let observedBeforeAbort:
    | { readonly code: number | null; readonly signal: NodeJS.Signals | null }
    | undefined;
  const originalWait = ProviderProcessSupervisor.prototype.waitForOutputClose;
  const waitSpy = vi
    .spyOn(ProviderProcessSupervisor.prototype, "waitForOutputClose")
    .mockImplementation(async function (
      this: ProviderProcessSupervisor,
      timeoutMs,
      signal,
    ) {
      const exit = this.observedExit();
      if (exit?.code === 7 && !controller.signal.aborted) {
        observedBeforeAbort = exit;
        controller.abort(reason);
        return false;
      }
      return originalWait.call(this, timeoutMs, signal);
    });
  let result;
  try {
    result = await runChild(
      controller.signal,
      exitsAfterHoldingOutput,
      (path) => {
        runtimePath = path;
      },
    );
  } finally {
    waitSpy.mockRestore();
  }
  expect(observedBeforeAbort).toEqual({ code: 7, signal: null });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected physical failure");
  expect(result.error._tag).toBe("ProviderAdapterError");
  expect(result.error.diagnostics).toMatchObject({
    exit_code: 7,
    output_complete: false,
  });
  expect(result.error.capturedOutput?.truncated).toBe(true);
  if (runtimePath === undefined) throw new Error("runtime was not acquired");
  await expect(access(runtimePath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("classifies the same nonzero exit without cancellation", async () => {
  const result = await runChild(undefined, exitsAfterHoldingOutput);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected physical failure");
  expect(result.error).toMatchObject({
    _tag: "ProviderAdapterError",
    diagnostics: {
      exit_code: 7,
      stderr: "physical exit 7",
      output_complete: true,
    },
  });
});

it("stops a held drain after late output exceeds budget but keeps the exit primary", async () => {
  const startedAt = performance.now();
  const result = await runChild(
    undefined,
    exitsThenDescendantExceedsStderrBudget,
  );
  const elapsedMs = performance.now() - startedAt;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected physical failure");
  expect(result.error._tag).toBe("ProviderAdapterError");
  expect(result.error.diagnostics).toMatchObject({
    exit_code: 7,
    output_limit_reached: true,
    output_complete: false,
  });
  expect(result.error.diagnostics?.stderr).toContain("physical exit 7");
  expect(result.error.capturedOutput?.truncated).toBe(true);
  expect(elapsedMs).toBeLessThan(5_000);
});

it("preserves an observed process-memory limit over the codec exit status", async () => {
  const controller = new AbortController();
  const reason = { caller: "after memory-limit exit" };
  let observedBeforeAbort:
    | { readonly code: number | null; readonly signal: NodeJS.Signals | null }
    | undefined;
  const originalWait = ProviderProcessSupervisor.prototype.waitForOutputClose;
  const waitSpy = vi
    .spyOn(ProviderProcessSupervisor.prototype, "waitForOutputClose")
    .mockImplementation(async function (
      this: ProviderProcessSupervisor,
      timeoutMs,
      signal,
    ) {
      const exit = this.observedExit();
      if (exit?.code === 3 && !controller.signal.aborted) {
        observedBeforeAbort = exit;
        controller.abort(reason);
        return false;
      }
      return originalWait.call(this, timeoutMs, signal);
    });
  let result;
  try {
    result = await runSourceMapCommand(
      "{}",
      "/probe/source.map",
      { signal: controller.signal },
      {
        prepareOwnership: async () => {},
        launcher: async (options) => {
          const spawned = await spawnOwnedProviderProcess({
            ...options,
            arguments: [
              "-e",
              'const {spawn}=require("node:child_process"); spawn(process.execPath,["-e","setTimeout(()=>{},400)"],{stdio:["ignore","inherit","inherit"]}); process.stderr.write("memory limit reached"); process.exit(3)',
            ],
          });
          let exited = false;
          spawned.process.once("exit", () => {
            exited = true;
          });
          Object.defineProperty(spawned.process, "memoryLimitReached", {
            get: () => exited,
          });
          return spawned;
        },
      },
      unexpectedCleanup,
    );
  } finally {
    waitSpy.mockRestore();
  }
  expect(observedBeforeAbort).toEqual({ code: 3, signal: null });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected memory-limit failure");
  expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
  expect(result.error).toMatchObject({
    resource: "memory",
    reportedLimits: {
      codec_process_memory_limit_bytes: SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES,
    },
    capturedOutput: { stderr: "memory limit reached" },
  });
  expect(result.error.capturedOutput?.truncated).toBe(true);
});

it("keeps a timeout distinct from caller cancellation", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "performance"],
  });
  let runtimePath: string | undefined;
  try {
    const result = await runSourceMapCommand(
      "{}",
      "/probe/source.map",
      undefined,
      {
        prepareOwnership: async () => {},
        createRuntime: async () => {
          const runtime = await PrivateRuntimeRoot.create({
            prefix: "rea-source-map-timeout-test-",
          });
          runtimePath = runtime.path;
          return runtime;
        },
        launcher: async () => {
          await vi.advanceTimersByTimeAsync(
            WEB_SOURCE_MAP_LIMITS.decodeTimeoutMs + 1,
          );
          throw new Error("launcher settled after deadline");
        },
      },
      unexpectedCleanup,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected timeout");
    expect(result.error).toBeInstanceOf(AnalysisTimeoutError);
    if (runtimePath === undefined) throw new Error("runtime was not acquired");
    await expect(access(runtimePath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    vi.useRealTimers();
  }
});

it("applies a non-default decode deadline and releases its runtime", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "performance"],
  });
  let runtimePath: string | undefined;
  try {
    const result = await runSourceMapCommand(
      "{}",
      "/probe/source.map",
      undefined,
      {
        prepareOwnership: async () => {},
        createRuntime: async () => {
          const runtime = await PrivateRuntimeRoot.create({
            prefix: "rea-source-map-selected-deadline-",
          });
          runtimePath = runtime.path;
          return runtime;
        },
        launcher: async () => {
          await vi.advanceTimersByTimeAsync(251);
          throw new Error("launcher settled after deadline");
        },
      },
      unexpectedCleanup,
      250,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected timeout");
    expect(result.error).toBeInstanceOf(AnalysisTimeoutError);
    expect(result.error.userMessage).toContain("250");
    expect(result.error.userMessage).toContain("decode_timeout_ms");
    if (runtimePath === undefined) throw new Error("runtime was not acquired");
    await expect(access(runtimePath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    vi.useRealTimers();
  }
});
