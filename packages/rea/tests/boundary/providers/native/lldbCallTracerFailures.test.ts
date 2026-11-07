import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  open,
  stat,
  type FileHandle,
} from "node:fs/promises";
import { ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";

import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisTimeoutError,
} from "../../../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { EvidenceIntegrityError } from "../../../../src/domain/evidenceErrors.js";
import { ArtifactFileCleanupFailure } from "../../../../src/artifacts/ArtifactFileOperation.js";
import { resolvedAnalysisError } from "../../../../src/domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { nativeCallObservationInputSchema } from "../../../../src/domain/native/nativeCallObservation.js";
import { nativeCallPartialObservationSchema } from "../../../../src/domain/native/nativeCallPartialObservation.js";
import type { NativeCallTracer } from "../../../../src/native/LldbCallTracer.js";
import { LldbCallTracer } from "../../../../src/native/LldbCallTracer.js";
import { err, ok } from "../../../../src/domain/result.js";
import { NativeCommandFailure } from "../../../../src/native/CommandRunner.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import { createDeferred } from "../../../fixtures/binarySession.js";
import { PrivateRuntimeRoot } from "../../../../src/process/PrivateRuntimeRoot.js";
import {
  ProviderProcessSupervisor,
  type ProviderProcessStopOptions,
  type ProviderProcessStopResult,
} from "../../../../src/process/ProviderProcess.js";
import { ProviderStartupDeadline } from "../../../../src/process/ProviderDeadline.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
  nativeResolvedToolFixture,
} from "../../../fixtures/nativeCommands.js";

const EVENT = {
  sequence: 0,
  elapsed_ms: 1,
  thread_id: 2,
  breakpoint_index: 0,
  load_address: "0x1000",
  file_address: "0x1000",
  module: "fixture",
  module_path: "/tmp/fixture",
  symbol: "main",
  receiver_class: null,
  selector: null,
  registers: [],
  backtrace: [],
};

const request: Parameters<NativeCallTracer["trace"]>[0] = {
  executable: "/tmp/fixture",
  architecture: "arm64",
  expectedSha256: "a".repeat(64),
  input: nativeCallObservationInputSchema.parse({
    breakpoints: [{ kind: "function", name: "main" }],
    arguments: ["--fixture"],
    environment: { CASE: "retained" },
  }),
};

const fakeTool = nativeResolvedToolFixture("/usr/bin/lldb", "b".repeat(64));
const successfulTracerOutput = {
  status: "traced",
  version: "lldb-fixture",
  pid: 12345,
  outcome: "exited",
  resource_limit_reached: false,
  target_output: {
    stdout_bytes: 0,
    stderr_bytes: 0,
    stdout_truncated: false,
    stderr_truncated: false,
    stdout_complete: true,
    stderr_complete: true,
  },
  exit_status: 0,
  exit_description: null,
  killed: false,
  terminated: true,
  target_identity: {
    loaded_image_sha256: null,
    selected_file_sha256: request.expectedSha256,
    file_device: "1",
    file_inode: "2",
    module_path: request.executable,
    module_uuid: "fixture",
    stable: true,
  },
  elapsed_ms: 1,
  breakpoints: [{ index: 0, location_count: 1, locations: [] }],
  events: [EVENT],
  other_stops: [],
};
const configSchema = z.object({
  result_path: z.string(),
  observation_path: z.string(),
  stdout_capture_path: z.string(),
  stderr_capture_path: z.string(),
  pid_path: z.string(),
});

const configFromArguments = async (arguments_: readonly string[]) => {
  const command = arguments_.at(-1);
  const match =
    command === undefined ? null : /^rea_trace (.+)$/u.exec(command);
  if (match?.[1] === undefined)
    throw new Error("fake LLDB launcher did not receive a tracer config path");
  const raw: unknown = JSON.parse(await readFile(match[1], "utf8"));
  return { config: configSchema.parse(raw), configPath: match[1] };
};

const fixtureTracer = (
  outcome: "cancelled" | "integrity-error-cleanup-failure",
) => {
  let configPath: string | undefined;
  const tracer = new LldbCallTracer(
    {},
    async (_executable, arguments_) => {
      const resolved = await configFromArguments(arguments_);
      const { config } = resolved;
      configPath = resolved.configPath;
      await writeFile(
        config.observation_path,
        `${JSON.stringify({ kind: "event", event: EVENT })}\n`,
      );
      await writeFile(config.stdout_capture_path, "captured prefix");
      if (outcome === "integrity-error-cleanup-failure")
        await writeFile(
          config.result_path,
          JSON.stringify({
            status: "target-integrity-error",
            error: "launched target digest changed",
          }),
        );
      return outcome === "cancelled"
        ? {
            kind: "cancelled",
            targetLaunched: false,
            targetIdentity: undefined,
            cleanupFailure: undefined,
          }
        : {
            kind: "exited",
            targetLaunched: false,
            exitCode: 1,
            output: "bridge reported target integrity failure",
            targetIdentity: undefined,
            cleanupFailure: "LLDB process-group cleanup could not be verified",
          };
    },
    async () => ok(fakeTool),
  );
  return {
    tracer,
    runtimeRoot: async () => {
      if (configPath === undefined)
        throw new Error("fake LLDB launcher was not called");
      const root = dirname(configPath);
      if (outcome === "cancelled") await expect(access(root)).rejects.toThrow();
      else {
        // The simulated launcher reported incomplete cleanup without returning
        // its process owner. That absence cannot establish completion.
        await expect(access(root)).resolves.toBeUndefined();
        onTestFinished(async () => {
          await rm(root, { recursive: true, force: true });
        });
      }
    },
  };
};

describe("LLDB completed trace retention through finalization", () => {
  it.each([
    "after launch",
    "during runtime cleanup",
    "runtime cleanup failure",
  ])("retains completed trace facts after %s", async (phase) => {
    const controller = new AbortController();
    const close = PrivateRuntimeRoot.prototype.close;
    let runtime: string | undefined;
    const closeSpy =
      phase !== "after launch"
        ? vi
            .spyOn(PrivateRuntimeRoot.prototype, "close")
            .mockImplementation(async function (this: PrivateRuntimeRoot) {
              if (phase === "runtime cleanup failure")
                throw new Error("fixture runtime removal denied");
              await close.call(this);
              controller.abort();
            })
        : undefined;
    const tracer = new LldbCallTracer(
      {},
      async (_executable, arguments_) => {
        const { config } = await configFromArguments(arguments_);
        runtime = dirname(config.result_path);
        await writeFile(config.observation_path, "");
        await writeFile(config.stdout_capture_path, "");
        await writeFile(config.stderr_capture_path, "");
        await writeFile(
          config.result_path,
          JSON.stringify(successfulTracerOutput),
        );
        if (phase === "after launch") controller.abort();
        return {
          kind: "exited",
          targetLaunched: false,
          exitCode: 0,
          output: "",
          targetIdentity: undefined,
          cleanupFailure: undefined,
        };
      },
      async () => ok(fakeTool),
    );
    onTestFinished(async () => {
      closeSpy?.mockRestore();
      await tracer.close();
    });

    const result = await tracer
      .trace(request, controller.signal)
      .finally(() => closeSpy?.mockRestore());
    if (result.ok)
      throw new Error("expected finalization failure after LLDB exit");
    if (runtime === undefined) throw new Error("LLDB fixture did not launch");
    if (phase === "runtime cleanup failure") {
      expect(result.error.cleanupResources).toEqual([runtime]);
      await access(runtime);
      expect((await tracer.close()).ok).toBe(true);
    } else expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    await expect(access(runtime)).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.error.partialObservation).toMatchObject({
      coverage: {
        status: "partial",
        reason:
          phase === "runtime cleanup failure" ? "cleanup-failure" : "cancelled",
      },
      target: { launch_identity: successfulTracerOutput.target_identity },
      debugger: {
        path: fakeTool.invocationPath,
        sha256: fakeTool.sha256,
        version: successfulTracerOutput.version,
      },
      process: {
        outcome: "exited",
        exit_status: 0,
        exit_description: null,
        terminated: true,
        elapsed_ms: 1,
        stdout: { complete: true },
      },
      breakpoints: [
        {
          index: 0,
          request: { kind: "function", name: "main" },
          location_count: 1,
        },
      ],
      events: [EVENT],
    });
    const partial = nativeCallPartialObservationSchema.parse(
      result.error.partialObservation,
    );
    expect(partial).toEqual(result.error.partialObservation);
    expect(partial.limitations).not.toContain(
      "Captured output byte counts are observed lower bounds because LLDB did not report final stream counters.",
    );
  });
});

const expectCompletedCleanupFacts = (
  partial: ReturnType<typeof nativeCallPartialObservationSchema.parse>,
  completed: typeof successfulTracerOutput,
) => {
  expect(partial.debugger).toEqual({
    path: fakeTool.invocationPath,
    sha256: fakeTool.sha256,
    version: completed.version,
  });
  expect(partial.target.launch_identity).toEqual(completed.target_identity);
  expect(partial.events).toEqual(completed.events);
  expect(partial.breakpoints).toEqual([
    {
      ...completed.breakpoints[0],
      request: { kind: "function", name: "main", module: null },
    },
  ]);
  expect(partial.limitations).not.toContain(
    "The LLDB run did not produce a complete native call observation result.",
  );
  expect(partial.limitations).not.toContain(
    "Captured output byte counts are observed lower bounds because LLDB did not report final stream counters.",
  );
};

describe("LLDB completed trace retention after process cleanup", () => {
  it.each([
    "clean",
    "group-cleanup",
    "target-uncertain",
    "target-uncertain-limit",
    "group-capture-failure",
  ] as const)("retains validated completed facts with %s", async (phase) => {
    let runtime: string | undefined;
    let launches = 0;
    let releaseGroup = false;
    const targetUncertain = phase.startsWith("target-");
    const groupFailure = phase.startsWith("group-");
    const captureFailure = phase === "group-capture-failure";
    // This handle is never spawned. The production supervisor owns only the
    // synthetic launcher's injected cleanup receipt, not an OS process.
    const child = new ChildProcess();
    const cleanup = vi.fn(async () =>
      releaseGroup
        ? { cleaned: true as const, signaled: false }
        : { cleaned: false as const, reason: "fixture group cleanup failed" },
    );
    const supervisor = new ProviderProcessSupervisor({
      process: child,
      ownsProcessLifetime: true,
      cleanup,
    });
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    const completed = {
      ...successfulTracerOutput,
      ...(phase === "target-uncertain-limit"
        ? { outcome: "duration-elapsed", terminated: false, killed: true }
        : {}),
      target_output: {
        stdout_bytes: 4096,
        stderr_bytes: 2,
        stdout_truncated: true,
        stderr_truncated: false,
        stdout_complete: true,
        stderr_complete: true,
      },
    };
    const tracer = new LldbCallTracer(
      {},
      async (_executable, arguments_) => {
        launches += 1;
        const { config } = await configFromArguments(arguments_);
        runtime = dirname(config.result_path);
        // A shorter journal must not replace the validated completed result.
        await writeFile(config.observation_path, "");
        if (!captureFailure) await writeFile(config.stdout_capture_path, "abc");
        await writeFile(config.stderr_capture_path, "ok");
        await writeFile(config.result_path, JSON.stringify(completed));
        return {
          kind: "exited",
          targetLaunched: targetUncertain,
          exitCode: 0,
          output: "",
          targetIdentity: undefined,
          cleanupFailure: groupFailure
            ? "fixture group cleanup failed"
            : undefined,
          ...(groupFailure ? { cleanupOwner: supervisor } : {}),
        };
      },
      async () => ok(fakeTool),
    );
    try {
      const result = await tracer.trace(request);
      if (runtime === undefined) throw new Error("fixture did not launch");
      const stdout = {
        text: "abc",
        bytes: 4096,
        truncated: true,
        complete: false,
      };
      const stderr = {
        text: "ok",
        bytes: 2,
        truncated: false,
        complete: true,
      };
      if (phase === "clean") {
        expect(result.ok).toBe(true);
        if (!result.ok) throw result.error;
        expect(result.value.run).toEqual(completed);
        expect(result.value.stdout).toEqual(stdout);
        expect(result.value.stderr).toEqual(stderr);
        await expect(access(runtime)).rejects.toMatchObject({
          code: "ENOENT",
        });
        return;
      }
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected cleanup failure");
      expect(result.error).toBeInstanceOf(ProviderCleanupError);
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toContain(runtime);
      await access(runtime);
      const retry = await tracer.trace(request);
      expect(retry.ok).toBe(false);
      expect(launches).toBe(1);
      expect((await tracer.close()).ok).toBe(false);
      const partial = nativeCallPartialObservationSchema.parse(
        result.error.partialObservation,
      );
      expect(partial.coverage.reason).toBe("cleanup-failure");
      expect(partial.process).toEqual({
        pid: completed.pid,
        outcome: completed.outcome,
        exit_status: completed.exit_status,
        exit_description: completed.exit_description,
        // Producer termination does not establish independent host cleanup.
        terminated: !targetUncertain,
        elapsed_ms: completed.elapsed_ms,
        stdout: captureFailure ? null : stdout,
        stderr,
        other_stops: completed.other_stops,
      });
      expectCompletedCleanupFacts(partial, completed);
      if (phase === "target-uncertain-limit") {
        expect(partial.limitations.join(" ")).not.toContain("was killed");
        expect(partial.limitations.join(" ")).toContain(
          "termination was requested but could not be confirmed",
        );
      }
      if (captureFailure) {
        expect(result.error.secondaryFailures).toHaveLength(1);
        expect(result.error.secondaryFailures[0]?.cause).toMatchObject({
          code: "ENOENT",
        });
        expect(partial.limitations).toContain(
          "One or more target output captures were unavailable.",
        );
      }
      if (groupFailure) {
        releaseGroup = true;
        expect((await tracer.close()).ok).toBe(true);
        expect(cleanup).toHaveBeenCalled();
        expect(result.error.cleanupIncomplete).toBe(false);
        await expect(access(runtime)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    } finally {
      releaseGroup = true;
      await tracer.close();
      supervisor.dispose();
      // No target was launched; only the synthetic unknown-target fixture
      // needs test-owned removal after proving production retains ownership.
      if (runtime !== undefined)
        await rm(runtime, { recursive: true, force: true });
    }
  });
});

describe("LLDB cleanup without a validated completed trace", () => {
  it.each(["missing", "invalid"] as const)(
    "keeps journal-only fallback when the completed result is %s",
    async (resultKind) => {
      let runtime: string | undefined;
      const tracer = new LldbCallTracer(
        {},
        async (_executable, arguments_) => {
          const { config } = await configFromArguments(arguments_);
          runtime = dirname(config.result_path);
          await writeFile(
            config.observation_path,
            `${JSON.stringify({ kind: "event", event: EVENT })}\n`,
          );
          await writeFile(config.stdout_capture_path, "abc");
          await writeFile(config.stderr_capture_path, "");
          if (resultKind === "invalid")
            await writeFile(
              config.result_path,
              JSON.stringify({ status: "traced", outcome: "exited" }),
            );
          return {
            kind: "exited",
            targetLaunched: true,
            exitCode: 0,
            output: "",
            targetIdentity: undefined,
            cleanupFailure: undefined,
          };
        },
        async () => ok(fakeTool),
      );
      try {
        const result = await tracer.trace(request);
        if (result.ok) throw new Error("expected cleanup failure");
        expect(result.error).toBeInstanceOf(ProviderCleanupError);
        expect(result.error.cleanupIncomplete).toBe(true);
        const partial = nativeCallPartialObservationSchema.parse(
          result.error.partialObservation,
        );
        expect(partial.coverage.reason).toBe("cleanup-failure");
        expect(partial.events).toEqual([EVENT]);
        expect(partial.process.stdout).toEqual({
          text: "abc",
          bytes: 3,
          truncated: true,
          complete: false,
        });
        expect(partial.process.outcome).toBeUndefined();
        expect(partial.process.exit_status).toBeUndefined();
        expect(partial.process.terminated).toBeUndefined();
        expect(partial.process.elapsed_ms).toBeUndefined();
        expect(partial.target.launch_identity).toBeUndefined();
        expect(partial.breakpoints).toBeUndefined();
        expect(partial.debugger.version).toBeNull();
        expect(partial.limitations).toContain(
          "Captured output byte counts are observed lower bounds because LLDB did not report final stream counters.",
        );
        expect((await tracer.close()).ok).toBe(false);
      } finally {
        // The launcher never created a target; remove only its synthetic files.
        if (runtime !== undefined)
          await rm(runtime, { recursive: true, force: true });
      }
    },
  );
});

describe("LLDB failure retention through the production tracer", () => {
  it("treats an invalid UTF-8 tracer result as unavailable and retains journal facts", async () => {
    let configPath: string | undefined;
    const tracer = new LldbCallTracer(
      {},
      async (_executable, arguments_) => {
        const resolved = await configFromArguments(arguments_);
        configPath = resolved.configPath;
        await writeFile(
          resolved.config.observation_path,
          `${JSON.stringify({ kind: "event", event: EVENT })}\n`,
        );
        await writeFile(
          resolved.config.result_path,
          Buffer.concat([
            Buffer.from('{"status":"tracer-error","error":"before'),
            Buffer.from([0xff]),
            Buffer.from('after"}'),
          ]),
        );
        return {
          kind: "exited",
          targetLaunched: false,
          exitCode: 1,
          output: "invalid UTF-8 tracer result",
          targetIdentity: undefined,
          cleanupFailure: undefined,
        };
      },
      async () => ok(fakeTool),
    );

    const result = await tracer.trace(request);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected unavailable tracer result");
    expect(result.error).toMatchObject({
      _tag: "ProviderAdapterError",
      diagnostics: { reason: "LLDB exited without a usable tracer result" },
      partialObservation: { events: [EVENT] },
    });
    expect(result.error.cause).toMatchObject({
      code: "ERR_ENCODING_INVALID_ENCODED_DATA",
    });
    expect(result.error.secondaryFailures).toHaveLength(1);
    expect(result.error.secondaryFailures[0]?.cause).toBeInstanceOf(
      AggregateError,
    );
    if (configPath === undefined)
      throw new Error("LLDB fixture did not launch");
    await expect(access(dirname(configPath))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("waits for an active trace before client close removes its runtime root", async () => {
    const launchGate = createDeferred<void>();
    const launchStarted = createDeferred<void>();
    const tracer = new LldbCallTracer(
      {},
      async (_executable, arguments_) => {
        const { config } = await configFromArguments(arguments_);
        await writeFile(
          config.observation_path,
          `${JSON.stringify({ kind: "event", event: EVENT })}\n`,
        );
        await writeFile(config.stdout_capture_path, "captured prefix");
        launchStarted.resolve();
        await launchGate.promise;
        return {
          kind: "exited",
          targetLaunched: false,
          exitCode: 0,
          output: "",
          targetIdentity: undefined,
          cleanupFailure: undefined,
        };
      },
      async () => ok(fakeTool),
    );
    const client = new NativeMacOSProvider(
      {},
      new NativeFixtureRunner(),
      "darwin",
      () => tracer,
    ).createClient(nativeMachoTarget(request.executable));
    const tracePromise = tracer.trace(request);
    await launchStarted.promise;
    let closeFinished = false;
    const closePromise = client.close().then((result) => {
      closeFinished = true;
      return result;
    });
    await Promise.resolve();
    expect(closeFinished).toBe(false);
    launchGate.resolve();
    const [trace, close] = await Promise.all([tracePromise, closePromise]);
    expect(close.ok).toBe(true);
    if (trace.ok) throw new Error("expected missing LLDB result");
    expect(trace.error.partialObservation).toMatchObject({
      events: [EVENT],
      process: { stdout: { text: "captured prefix", complete: false } },
    });
  });

  it("names the missing LLDB requirement instead of asking for another target", async () => {
    const tracer = new LldbCallTracer(
      {},
      () => Promise.reject(new Error("LLDB must not launch")),
      async (tool) => err(new NativeCommandFailure(tool, "unavailable")),
    );
    const result = await tracer.trace(request);
    if (result.ok) throw new Error("expected an unavailable LLDB");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "capability_unavailable",
      message: "LLDB from Xcode or the Command Line Tools is not available",
    });
  });

  it("preserves cancellation and journal/output evidence after runtime cleanup", async () => {
    const fixture = fixtureTracer("cancelled");
    const result = await fixture.tracer.trace(request);
    await fixture.runtimeRoot();
    if (result.ok) throw new Error("expected cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.partialObservation).toMatchObject({
      coverage: { status: "partial", reason: "cancelled" },
      events: [EVENT],
      process: { stdout: { text: "captured prefix", complete: false } },
      target: {
        arguments: ["--fixture"],
        environment: { CASE: "retained" },
        working_directory: null,
      },
    });
  });

  it("preserves bridge integrity failure type when process-group cleanup also fails", async () => {
    const fixture = fixtureTracer("integrity-error-cleanup-failure");
    const result = await fixture.tracer.trace(request);
    await fixture.runtimeRoot();
    if (result.ok) throw new Error("expected integrity failure");
    expect(result.error).toBeInstanceOf(EvidenceIntegrityError);
    expect(result.error.partialObservation).toMatchObject({
      coverage: { status: "partial", reason: "cleanup-failure" },
      events: [EVENT],
      process: { stdout: { text: "captured prefix", complete: false } },
    });
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: { execution_failure: "evidence_integrity_mismatch" },
    });
  });
});

describe("LLDB primary outcome during owned process cleanup", () => {
  it
    .skipIf(process.platform === "win32")
    .each(["caller cancellation", "deadline timeout"] as const)(
    "preserves a physical bridge failure and no-target proof when %s arrives during successful process cleanup",
    async (interruption) => {
      const fixtureRoot = await mkdtemp(
        join(tmpdir(), "rea-lldb-primary-outcome-"),
      );
      const fakeLldb = join(fixtureRoot, "fake-lldb");
      await writeFile(
        fakeLldb,
        `#!${process.execPath}\nconst fs = require("node:fs");\nconst command = process.argv.at(-1);\nif (!command?.startsWith("rea_trace ")) process.exit(91);\nconst config = JSON.parse(fs.readFileSync(command.slice("rea_trace ".length), "utf8"));\nfs.writeFileSync(config.result_path, JSON.stringify({ status: "target-error", error: "fixture physical bridge failure", target_process_created: false }));\nprocess.exit(17);\n`,
        { mode: 0o700 },
      );

      const controller = new AbortController();
      const stopEntered = createDeferred<void>();
      const stopReleased = createDeferred<void>();
      let stopping = false;
      const deadlineSpy =
        interruption === "deadline timeout"
          ? vi
              .spyOn(ProviderStartupDeadline.prototype, "interruption", "get")
              .mockImplementation(() => (stopping ? "timeout" : undefined))
          : undefined;
      let observedExit:
        | ReturnType<ProviderProcessSupervisor["observedExit"]>
        | undefined;
      let observedStop: ProviderProcessStopResult | undefined;
      const originalStop = ProviderProcessSupervisor.prototype.stop;
      const stopSpy = vi
        .spyOn(ProviderProcessSupervisor.prototype, "stop")
        .mockImplementation(async function (
          this: ProviderProcessSupervisor,
          options?: ProviderProcessStopOptions,
        ): Promise<ProviderProcessStopResult> {
          observedExit = this.observedExit();
          stopping = true;
          stopEntered.resolve(undefined);
          await stopReleased.promise;
          observedStop = await originalStop.call(this, options);
          return observedStop;
        });
      const tracer = new LldbCallTracer({}, undefined, async () =>
        ok(nativeResolvedToolFixture(fakeLldb, "c".repeat(64))),
      );

      try {
        const pending = tracer.trace(
          request,
          interruption === "caller cancellation"
            ? controller.signal
            : undefined,
        );
        await stopEntered.promise;
        expect(observedExit).toEqual({ code: 17, signal: null });
        if (interruption === "caller cancellation")
          controller.abort(new Error("abort during final cleanup"));
        stopReleased.resolve(undefined);
        const result = await pending;

        expect(observedStop?.status).toMatch(
          /^(already-exited|verified-cleanup|terminated|killed)$/u,
        );
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Expected the bridge target error");
        expect(result.error).toBeInstanceOf(AnalysisCapabilityUnavailableError);
        if (!(result.error instanceof AnalysisCapabilityUnavailableError))
          return;
        expect(result.error.reason).toBe(
          "lldb-target-unloadable: fixture physical bridge failure",
        );
        expect(result.error.cleanup).toBeUndefined();
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(result.error.cleanupResources).toEqual([]);
        expect(result.error.partialObservation).toMatchObject({
          coverage: { status: "partial", reason: "tracer-failure" },
          process: { pid: null },
        });
      } finally {
        stopReleased.resolve(undefined);
        stopSpy.mockRestore();
        deadlineSpy?.mockRestore();
        await tracer.close();
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    },
  );
});

describe("LLDB process exit while output is still open", () => {
  it.skipIf(process.platform === "win32")(
    "keeps a nonzero leader exit observed before cancellation while inherited output is still open",
    async () => {
      const fixtureRoot = await mkdtemp(
        join(tmpdir(), "rea-lldb-exit-before-cancel-"),
      );
      const fakeLldb = join(fixtureRoot, "fake-lldb");
      await writeFile(
        fakeLldb,
        `#!${process.execPath}\nconst fs = require("node:fs");\nconst { spawn } = require("node:child_process");\nconst command = process.argv.at(-1);\nif (!command?.startsWith("rea_trace ")) process.exit(91);\nconst config = JSON.parse(fs.readFileSync(command.slice("rea_trace ".length), "utf8"));\nconst child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: ["ignore", "inherit", "inherit"] });\nchild.once("error", () => process.exit(92));\nchild.once("spawn", () => { fs.writeFileSync(config.result_path, JSON.stringify({ status: "target-error", error: "fixture leader failure before drain", target_process_created: false })); process.exit(17); });\n`,
        { mode: 0o700 },
      );

      const controller = new AbortController();
      const drainObserved = createDeferred<void>();
      const drainReleased = createDeferred<void>();
      const originalWait =
        ProviderProcessSupervisor.prototype.waitForOutputClose;
      const drainSpy = vi
        .spyOn(ProviderProcessSupervisor.prototype, "waitForOutputClose")
        .mockImplementation(async function (
          this: ProviderProcessSupervisor,
          timeoutMs?: number,
          signal?: AbortSignal,
        ): Promise<boolean> {
          const closed = await originalWait.call(this, timeoutMs, signal);
          if (!closed && !stopping && this.observedExit()?.code === 17) {
            drainObserved.resolve(undefined);
            await drainReleased.promise;
          }
          return closed;
        });
      let stopping = false;
      let stopReceipt: ProviderProcessStopResult | undefined;
      const originalStop = ProviderProcessSupervisor.prototype.stop;
      const stopSpy = vi
        .spyOn(ProviderProcessSupervisor.prototype, "stop")
        .mockImplementation(async function (
          this: ProviderProcessSupervisor,
          options?: ProviderProcessStopOptions,
        ): Promise<ProviderProcessStopResult> {
          stopping = true;
          stopReceipt = await originalStop.call(this, options);
          return stopReceipt;
        });
      const tracer = new LldbCallTracer({}, undefined, async () =>
        ok(nativeResolvedToolFixture(fakeLldb, "d".repeat(64))),
      );

      try {
        const pending = tracer.trace(request, controller.signal);
        await drainObserved.promise;
        controller.abort(new Error("abort after leader exit"));
        drainReleased.resolve(undefined);
        const result = await pending;

        expect(stopReceipt?.status).toMatch(
          /^(already-exited|verified-cleanup|terminated|killed)$/u,
        );
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Expected the bridge target error");
        expect(result.error).toBeInstanceOf(AnalysisCapabilityUnavailableError);
        if (!(result.error instanceof AnalysisCapabilityUnavailableError))
          return;
        expect(result.error.reason).toBe(
          "lldb-target-unloadable: fixture leader failure before drain",
        );
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(result.error.cleanupResources).toEqual([]);
      } finally {
        drainReleased.resolve(undefined);
        drainSpy.mockRestore();
        stopSpy.mockRestore();
        await tracer.close();
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    },
  );
});

/**
 * A fake LLDB that publishes its bridge result and exits 0, as `lldb --batch`
 * does after rea_trace, while an inherited child keeps its output open.
 */
const publishedResultLldb = async (result: string) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "rea-lldb-published-"));
  const fakeLldb = join(fixtureRoot, "fake-lldb");
  await writeFile(
    fakeLldb,
    `#!${process.execPath}\nconst fs = require("node:fs");\nconst { spawn } = require("node:child_process");\nconst command = process.argv.at(-1);\nif (!command?.startsWith("rea_trace ")) process.exit(91);\nconst config = JSON.parse(fs.readFileSync(command.slice("rea_trace ".length), "utf8"));\nconst child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: ["ignore", "inherit", "inherit"] });\nchild.once("error", () => process.exit(92));\nchild.once("spawn", () => { fs.writeFileSync(config.result_path, ${JSON.stringify(result)}); process.exit(0); });\n`,
    { mode: 0o700 },
  );
  return { fixtureRoot, fakeLldb };
};

const publishedResults = {
  "no target created": JSON.stringify({
    status: "target-error",
    error: "fixture target creation failure",
    target_process_created: false,
  }),
  "target exit observed": JSON.stringify({
    status: "launch-error",
    error: "fixture launch failure after exit",
    target_process_created: true,
    target_process_exit_observed: true,
  }),
  "target created": JSON.stringify({
    status: "target-integrity-error",
    error: "fixture post-launch integrity failure",
    target_process_created: true,
  }),
  "truncated result": `{"status":"target-error","error":null,"target_process_created":false`,
} as const;
const provesTargetGone = (published: keyof typeof publishedResults) =>
  published === "no target created" || published === "target exit observed";

/** Interrupt once, after the LLDB leader exited while inherited output is open. */
const interruptAfterLeaderExit = (interrupt: () => void) => {
  let interrupted = false;
  const originalWait = ProviderProcessSupervisor.prototype.waitForOutputClose;
  const spy = vi
    .spyOn(ProviderProcessSupervisor.prototype, "waitForOutputClose")
    .mockImplementation(async function (
      this: ProviderProcessSupervisor,
      timeoutMs?: number,
      signal?: AbortSignal,
    ): Promise<boolean> {
      const closed = await originalWait.call(this, timeoutMs, signal);
      if (!closed && !interrupted && this.observedExit()?.code === 0) {
        interrupted = true;
        interrupt();
      }
      return closed;
    });
  return {
    get interrupted() {
      return interrupted;
    },
    restore: () => spy.mockRestore(),
  };
};

describe("LLDB target proof published before interruption", () => {
  for (const interruption of [
    "caller cancellation",
    "deadline timeout",
  ] as const)
    for (const published of Object.keys(publishedResults) as Array<
      keyof typeof publishedResults
    >)
      it.skipIf(process.platform === "win32")(
        `keeps the bridge's ${published} fact when ${interruption} arrives after LLDB exit and before result readback`,
        async () => {
          const { fixtureRoot, fakeLldb } = await publishedResultLldb(
            publishedResults[published],
          );
          const controller = new AbortController();
          const leader = interruptAfterLeaderExit(() => {
            if (interruption === "caller cancellation")
              controller.abort(new Error("abort before result readback"));
          });
          const deadlineSpy =
            interruption === "deadline timeout"
              ? vi
                  .spyOn(
                    ProviderStartupDeadline.prototype,
                    "interruption",
                    "get",
                  )
                  .mockImplementation(() =>
                    leader.interrupted ? "timeout" : undefined,
                  )
              : undefined;
          const tracer = new LldbCallTracer({}, undefined, async () =>
            ok(nativeResolvedToolFixture(fakeLldb, "c".repeat(64))),
          );
          let retainedRoot: string | undefined;
          try {
            const result = await tracer.trace(request, controller.signal);

            expect(leader.interrupted).toBe(true);
            expect(result.ok).toBe(false);
            if (result.ok) throw new Error("Expected an interrupted trace");
            expect(result.error).toBeInstanceOf(
              interruption === "caller cancellation"
                ? AnalysisCancelledError
                : AnalysisTimeoutError,
            );
            expect(result.error.partialObservation).toMatchObject({
              coverage: {
                reason:
                  interruption === "caller cancellation"
                    ? "cancelled"
                    : "timeout",
              },
            });
            if (provesTargetGone(published)) {
              expect(result.error.cleanupIncomplete).toBe(false);
              expect(result.error.cleanupResources).toEqual([]);
              expect((await tracer.close()).ok).toBe(true);
              return;
            }
            // Without an explicit producer proof, a missing PID stays ambiguous.
            expect(result.error.cleanupIncomplete).toBe(true);
            expect(result.error.cleanupResources).toContain(
              "native-target:unknown",
            );
            expect(result.error.cleanupResources).not.toContain(
              "lldb-process-group",
            );
            retainedRoot = result.error.cleanupResources.find((resource) =>
              resource.includes("rea-lldb-"),
            );
            const close = await tracer.close();
            expect(close.ok).toBe(false);
            if (!close.ok)
              expect(close.error.cleanupResources).toContain(
                "native-target:unknown",
              );
          } finally {
            leader.restore();
            deadlineSpy?.mockRestore();
            if (retainedRoot !== undefined)
              await rm(retainedRoot, { recursive: true, force: true });
            await rm(fixtureRoot, { recursive: true, force: true });
          }
        },
      );
});

describe("LLDB target proof read by cleanup retry", () => {
  for (const published of ["no target created", "target created"] as const)
    it.skipIf(process.platform === "win32")(
      `reads the published ${published} fact when cleanup retry releases interrupted LLDB`,
      async () => {
        const { fixtureRoot, fakeLldb } = await publishedResultLldb(
          publishedResults[published],
        );
        const controller = new AbortController();
        const leader = interruptAfterLeaderExit(() =>
          controller.abort(new Error("abort before result readback")),
        );
        const originalStop = ProviderProcessSupervisor.prototype.stop;
        let stops = 0;
        const stopSpy = vi
          .spyOn(ProviderProcessSupervisor.prototype, "stop")
          .mockImplementation(async function (
            this: ProviderProcessSupervisor,
            options?: ProviderProcessStopOptions,
          ): Promise<ProviderProcessStopResult> {
            stops += 1;
            return stops === 1
              ? { status: "incomplete", reason: "fixture held LLDB cleanup" }
              : originalStop.call(this, options);
          });
        const tracer = new LldbCallTracer({}, undefined, async () =>
          ok(nativeResolvedToolFixture(fakeLldb, "c".repeat(64))),
        );
        let retainedRoot: string | undefined;
        try {
          const result = await tracer.trace(request, controller.signal);

          expect(result.ok).toBe(false);
          if (result.ok) throw new Error("Expected a cancelled trace");
          expect(result.error).toBeInstanceOf(AnalysisCancelledError);
          expect(result.error.cleanupIncomplete).toBe(true);
          expect(result.error.cleanupResources).toEqual(
            expect.arrayContaining([
              "lldb-process-group",
              "native-target:unknown",
            ]),
          );
          retainedRoot = result.error.cleanupResources.find((resource) =>
            resource.includes("rea-lldb-"),
          );
          expect(retainedRoot).toBeDefined();

          // The first pass could not read the result while LLDB was unstopped.
          const close = await tracer.close();
          expect(stops).toBe(2);
          if (published === "no target created") {
            expect(close.ok).toBe(true);
            expect(result.error.cleanupIncomplete).toBe(false);
            await expect(access(retainedRoot ?? "")).rejects.toThrow();
            return;
          }
          expect(close.ok).toBe(false);
          if (close.ok) return;
          expect(close.error.cleanupResources).toContain(
            "native-target:unknown",
          );
          expect(close.error.cleanupResources).not.toContain(
            "lldb-process-group",
          );
        } finally {
          leader.restore();
          stopSpy.mockRestore();
          if (retainedRoot !== undefined)
            await rm(retainedRoot, { recursive: true, force: true });
          await rm(fixtureRoot, { recursive: true, force: true });
        }
      },
    );
});

const completedOutputCloseFixture = async () => {
  const fixtureRoot = await mkdtemp(
    join(tmpdir(), "rea-lldb-complete-output-"),
  );
  const fakeLldb = join(fixtureRoot, "fake-lldb");
  const completedPidPath = join(fixtureRoot, "completed-target.pid");
  const completed = {
    ...successfulTracerOutput,
    target_output: {
      ...successfulTracerOutput.target_output,
      stdout_bytes: 2,
    },
  };
  await writeFile(
    fakeLldb,
    `#!${process.execPath}
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const command = process.argv.at(-1);
if (!command?.startsWith("rea_trace ")) process.exit(91);
const config = JSON.parse(fs.readFileSync(command.slice("rea_trace ".length), "utf8"));
const child = spawnSync(process.execPath, ["-e", ""]);
const result = ${JSON.stringify(completed)};
result.pid = child.pid;
fs.writeFileSync(${JSON.stringify(completedPidPath)}, String(child.pid));
fs.writeFileSync(config.pid_path, String(child.pid));
fs.writeFileSync(config.stdout_capture_path, "ok");
fs.writeFileSync(config.stderr_capture_path, "");
fs.writeFileSync(config.observation_path, JSON.stringify({ kind: "event", event: result.events[0] }) + "\\n");
fs.writeFileSync(config.result_path, JSON.stringify(result));
process.exit(0);
`,
    { mode: 0o700 },
  );
  return {
    fixtureRoot,
    fakeLldb,
    readCompleted: async () => ({
      ...completed,
      pid: z.coerce
        .number()
        .int()
        .positive()
        .parse(await readFile(completedPidPath, "utf8")),
    }),
  };
};

describe("LLDB process exit at output-close loop completion", () => {
  for (const abort of [false, true])
    it.skipIf(process.platform === "win32")(
      `retains completed trace facts after output closure (cancelled=${String(abort)})`,
      async () => {
        const fixture = await completedOutputCloseFixture();
        const controller = new AbortController();
        const reason = { requested: "stop after completed output closure" };
        let interrupted = false;
        const originalWait =
          ProviderProcessSupervisor.prototype.waitForOutputClose;
        const waitSpy = vi
          .spyOn(ProviderProcessSupervisor.prototype, "waitForOutputClose")
          .mockImplementation(async function (
            this: ProviderProcessSupervisor,
            timeoutMs?: number,
            signal?: AbortSignal,
          ): Promise<boolean> {
            const closed = await originalWait.call(this, timeoutMs, signal);
            if (
              abort &&
              !interrupted &&
              closed &&
              this.observedExit()?.code === 0
            ) {
              interrupted = true;
              controller.abort(reason);
            }
            return closed;
          });
        const tracer = new LldbCallTracer({}, undefined, async () =>
          ok(nativeResolvedToolFixture(fixture.fakeLldb, "e".repeat(64))),
        );
        try {
          const result = await tracer.trace(request, controller.signal);
          const completed = await fixture.readCompleted();
          expect(interrupted).toBe(abort);
          if (result.ok) {
            expect(abort).toBe(false);
            expect(result.value.run).toMatchObject(completed);
            expect(result.value.stdout).toMatchObject({
              text: "ok",
              bytes: 2,
              complete: true,
            });
          } else {
            expect(abort).toBe(true);
            expect(result.error).toBeInstanceOf(AnalysisCancelledError);
            expect(result.error.cause).toBe(reason);
            expect(result.error.cleanupIncomplete).toBe(false);
            expect(
              nativeCallPartialObservationSchema.parse(
                result.error.partialObservation,
              ),
            ).toMatchObject({
              coverage: { status: "partial", reason: "cancelled" },
              debugger: { version: completed.version },
              process: {
                pid: completed.pid,
                outcome: "exited",
                exit_status: 0,
                terminated: true,
                elapsed_ms: 1,
                stdout: { text: "ok", bytes: 2, complete: true },
              },
              target: { launch_identity: completed.target_identity },
              breakpoints: [{ index: 0, location_count: 1 }],
              events: [EVENT],
            });
          }
        } finally {
          waitSpy.mockRestore();
          expect((await tracer.close()).ok).toBe(true);
          await rm(fixture.fixtureRoot, { recursive: true, force: true });
        }
      },
    );

  it.skipIf(process.platform === "win32")(
    "keeps a nonzero exit when output closure and cancellation meet at loop exit",
    async () => {
      const fixtureRoot = await mkdtemp(
        join(tmpdir(), "rea-lldb-closed-output-cancel-"),
      );
      const fakeLldb = join(fixtureRoot, "fake-lldb");
      await writeFile(
        fakeLldb,
        `#!${process.execPath}\nconst fs = require("node:fs");\nconst command = process.argv.at(-1);\nif (!command?.startsWith("rea_trace ")) process.exit(91);\nconst config = JSON.parse(fs.readFileSync(command.slice("rea_trace ".length), "utf8"));\nfs.writeFileSync(config.result_path, JSON.stringify({ status: "target-error", error: "fixture exit before closed-output cancellation", target_process_created: false }));\nprocess.exit(17);\n`,
        { mode: 0o700 },
      );

      const controller = new AbortController();
      let interruptionApplied = false;
      let stopReceipt: ProviderProcessStopResult | undefined;
      const originalWait =
        ProviderProcessSupervisor.prototype.waitForOutputClose;
      const waitSpy = vi
        .spyOn(ProviderProcessSupervisor.prototype, "waitForOutputClose")
        .mockImplementation(async function (
          this: ProviderProcessSupervisor,
          timeoutMs?: number,
          signal?: AbortSignal,
        ): Promise<boolean> {
          const closed = await originalWait.call(this, timeoutMs, signal);
          if (
            !interruptionApplied &&
            closed &&
            this.observedExit()?.code === 17
          ) {
            interruptionApplied = true;
            controller.abort(new Error("abort at output-close loop exit"));
          }
          return closed;
        });
      const originalStop = ProviderProcessSupervisor.prototype.stop;
      const stopSpy = vi
        .spyOn(ProviderProcessSupervisor.prototype, "stop")
        .mockImplementation(async function (
          this: ProviderProcessSupervisor,
          options?: ProviderProcessStopOptions,
        ): Promise<ProviderProcessStopResult> {
          stopReceipt = await originalStop.call(this, options);
          return stopReceipt;
        });
      const tracer = new LldbCallTracer({}, undefined, async () =>
        ok(nativeResolvedToolFixture(fakeLldb, "f".repeat(64))),
      );

      try {
        const result = await tracer.trace(request, controller.signal);

        expect(interruptionApplied).toBe(true);
        expect(stopReceipt?.status).toMatch(
          /^(already-exited|verified-cleanup|terminated|killed)$/u,
        );
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Expected the bridge target error");
        expect(result.error).toBeInstanceOf(AnalysisCapabilityUnavailableError);
        if (!(result.error instanceof AnalysisCapabilityUnavailableError))
          return;
        expect(result.error.reason).toBe(
          "lldb-target-unloadable: fixture exit before closed-output cancellation",
        );
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(result.error.cleanupResources).toEqual([]);
      } finally {
        waitSpy.mockRestore();
        stopSpy.mockRestore();
        await tracer.close();
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    },
  );
});

describe("LLDB late timeout publication", () => {
  it("converts a late deadline to timeout at successful-result publication", async () => {
    let runtime: string | undefined;
    const tracer = new LldbCallTracer(
      {},
      async (_executable, arguments_) => {
        const { config } = await configFromArguments(arguments_);
        runtime = dirname(config.result_path);
        await writeFile(
          config.observation_path,
          `${JSON.stringify({ kind: "event", event: EVENT })}\n`,
        );
        await writeFile(config.stdout_capture_path, "");
        await writeFile(config.stderr_capture_path, "");
        await writeFile(
          config.result_path,
          JSON.stringify(successfulTracerOutput),
        );
        return {
          kind: "exited",
          targetLaunched: false,
          exitCode: 0,
          output: "",
          targetIdentity: undefined,
          cleanupFailure: undefined,
          lateTimeout: true,
        };
      },
      async () => ok(fakeTool),
    );

    const result = await tracer.trace(request);
    if (runtime === undefined) throw new Error("LLDB fixture did not run");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected the late deadline to be retained");
    expect(result.error).toBeInstanceOf(AnalysisTimeoutError);
    if (!(result.error instanceof AnalysisTimeoutError)) return;
    expect(result.error.timeoutMs).toBeGreaterThan(request.input.duration_ms);
    expect(result.error.cleanup).toBeUndefined();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.partialObservation).toMatchObject({
      coverage: { status: "partial", reason: "timeout" },
      process: {
        outcome: "exited",
        exit_status: 0,
        terminated: true,
      },
      events: [EVENT],
    });
    await expect(access(runtime)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("LLDB pre-target phase proof", () => {
  it("releases an invalid-process launch failure and permits the next complete observation", async () => {
    let launches = 0;
    const runtimes: string[] = [];
    const tracer = new LldbCallTracer(
      {},
      async (_executable, arguments_) => {
        const { config } = await configFromArguments(arguments_);
        launches += 1;
        runtimes.push(dirname(config.result_path));
        await writeFile(config.observation_path, "");
        await writeFile(config.stdout_capture_path, "");
        await writeFile(config.stderr_capture_path, "");
        await writeFile(
          config.result_path,
          JSON.stringify(
            launches === 1
              ? {
                  status: "launch-error",
                  error: "No such file or directory: fixture/absent",
                  target_process_created: false,
                }
              : successfulTracerOutput,
          ),
        );
        return {
          kind: "exited",
          exitCode: launches === 1 ? 1 : 0,
          output: "",
          targetLaunched: launches === 1,
          targetIdentity: undefined,
          cleanupFailure: undefined,
        };
      },
      async () => ok(fakeTool),
    );
    try {
      const rejected = await tracer.trace(request);
      expect(rejected.ok).toBe(false);
      if (rejected.ok) throw new Error("Expected launch refusal");
      expect(projectAnalysisError(rejected.error)).toMatchObject({
        code: "capability_unavailable",
        details: {
          reason: "launch-failed: No such file or directory: fixture/absent",
        },
      });
      expect(rejected.error.cleanupIncomplete).toBe(false);
      expect(rejected.error.cleanupResources).toEqual([]);
      await expect(access(runtimes[0]!)).rejects.toMatchObject({
        code: "ENOENT",
      });
      const completed = await tracer.trace(request);
      expect(completed.ok).toBe(true);
      if (!completed.ok) throw completed.error;
      expect(completed.value.run).toMatchObject(successfulTracerOutput);
      expect(launches).toBe(2);
      await expect(access(runtimes[1]!)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect((await tracer.close()).ok).toBe(true);
    } finally {
      await tracer.close();
    }
  });

  it("releases a proven pre-target integrity rejection and allows tracer reuse", async () => {
    let launches = 0;
    let firstRuntime: string | undefined;
    const tracer = new LldbCallTracer(
      {},
      async (_executable, arguments_) => {
        const { config } = await configFromArguments(arguments_);
        launches += 1;
        if (firstRuntime === undefined)
          firstRuntime = dirname(config.result_path);
        await writeFile(config.observation_path, "");
        await writeFile(config.stdout_capture_path, "");
        await writeFile(
          config.result_path,
          JSON.stringify(
            launches === 1
              ? {
                  status: "target-integrity-error",
                  error:
                    "selected executable digest changed before LLDB target creation",
                  target_process_created: false,
                }
              : {
                  status: "target-error",
                  error: "second launch reached the bridge",
                },
          ),
        );
        return {
          kind: "exited",
          targetLaunched: launches === 1,
          exitCode: 1,
          output: "",
          targetIdentity: undefined,
          cleanupFailure: undefined,
        };
      },
      async () => ok(fakeTool),
    );

    const rejected = await tracer.trace(request);
    if (rejected.ok) throw new Error("expected pre-target integrity failure");
    expect(rejected.error).toBeInstanceOf(EvidenceIntegrityError);
    expect(projectAnalysisError(rejected.error).code).toBe(
      "evidence_integrity_mismatch",
    );
    if (firstRuntime === undefined) throw new Error("LLDB was not launched");
    await expect(access(firstRuntime)).rejects.toThrow();

    const retried = await tracer.trace(request);
    expect(launches).toBe(2);
    if (retried.ok) throw new Error("expected the second bridge result");
    expect(retried.error).toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      reason: expect.stringContaining("second launch reached the bridge"),
    });
  });
});

describe("LLDB retains ambiguous target ownership", () => {
  it("releases a launch failure after the bridge proves the process exited", async () => {
    let configPath: string | undefined;
    const tracer = new LldbCallTracer(
      {},
      async (_executable, arguments_) => {
        const resolved = await configFromArguments(arguments_);
        configPath = resolved.configPath;
        await writeFile(
          resolved.config.result_path,
          JSON.stringify({
            status: "launch-error",
            error: "attach failed after the launched process exited",
            target_process_created: true,
            target_process_exit_observed: true,
          }),
        );
        return {
          kind: "exited",
          targetLaunched: true,
          exitCode: 1,
          output: "",
          targetIdentity: undefined,
          cleanupFailure: undefined,
        };
      },
      async () => ok(fakeTool),
    );

    const result = await tracer.trace(request);
    if (result.ok) throw new Error("expected LLDB launch failure");
    expect(projectAnalysisError(result.error).code).toBe(
      "capability_unavailable",
    );
    expect(result.error.cleanup).toBeUndefined();
    expect(configPath).toBeDefined();
    if (configPath !== undefined)
      await expect(access(dirname(configPath))).rejects.toThrow();
  });

  it("keeps a post-target integrity rejection unresolved when its PID is missing", async () => {
    let runtime: string | undefined;
    const tracer = new LldbCallTracer(
      {},
      async (_executable, arguments_) => {
        const { config } = await configFromArguments(arguments_);
        runtime = dirname(config.result_path);
        await writeFile(config.observation_path, "");
        await writeFile(config.stdout_capture_path, "");
        await writeFile(
          config.result_path,
          JSON.stringify({
            status: "target-integrity-error",
            error: "selected executable changed during LLDB launch",
            target_process_created: true,
          }),
        );
        return {
          kind: "exited",
          targetLaunched: true,
          exitCode: 1,
          output: "",
          targetIdentity: undefined,
          cleanupFailure: undefined,
        };
      },
      async () => ok(fakeTool),
    );

    try {
      const result = await tracer.trace(request);
      if (result.ok) throw new Error("expected unresolved target identity");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          resources: expect.arrayContaining(["native-target:unknown"]),
        },
      });
      expect(runtime).toBeDefined();
      if (runtime !== undefined) await access(runtime);
      const retry = await tracer.trace(request);
      if (retry.ok) throw new Error("expected retained target cleanup");
      expect(projectAnalysisError(retry.error).code).toBe("cleanup_incomplete");
    } finally {
      if (runtime !== undefined)
        await rm(runtime, { recursive: true, force: true });
    }
  });

  it("keeps an invalid process after Launch unresolved without producer proof", async () => {
    let launches = 0;
    let runtime: string | undefined;
    const tracer = new LldbCallTracer(
      {},
      async (_executable, arguments_) => {
        launches += 1;
        const { config } = await configFromArguments(arguments_);
        runtime = dirname(config.result_path);
        await writeFile(config.observation_path, "");
        await writeFile(config.stdout_capture_path, "");
        await writeFile(
          config.result_path,
          JSON.stringify({
            status: "launch-error",
            error: "LLDB returned an invalid process after Launch",
          }),
        );
        return {
          kind: "exited",
          targetLaunched: true,
          exitCode: 1,
          output: "",
          targetIdentity: undefined,
          cleanupFailure: undefined,
        };
      },
      async () => ok(fakeTool),
    );

    try {
      const result = await tracer.trace(request);
      if (result.ok) throw new Error("expected unresolved launch cleanup");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          resources: expect.arrayContaining(["native-target:unknown"]),
        },
      });
      expect(runtime).toBeDefined();
      if (runtime !== undefined) await access(runtime);
      const retry = await tracer.trace(request);
      if (retry.ok) throw new Error("expected retained target cleanup");
      expect(projectAnalysisError(retry.error).code).toBe("cleanup_incomplete");
      expect(launches).toBe(1);
    } finally {
      if (runtime !== undefined)
        await rm(runtime, { recursive: true, force: true });
    }
  });
});

it("retains journal descriptor cleanup after a cancelled run instead of removing its runtime", async () => {
  let release: (() => Promise<void>) | undefined;
  let restoreRead: (() => void) | undefined;
  let captured: FileHandle | undefined;
  let allowClose = false;
  let configPath: string | undefined;
  let attempts = 0;
  const tracer = new LldbCallTracer(
    {},
    async (_executable, args) => {
      const resolved = await configFromArguments(args);
      configPath = resolved.configPath;
      await writeFile(
        resolved.config.observation_path,
        JSON.stringify({
          kind: "other-stop",
          reason: "controlled journal fact",
        }) + "\n",
      );
      const probe = await open(resolved.config.observation_path, "r");
      const prototype = Object.getPrototypeOf(probe) as FileHandle;
      await probe.close();
      const original = prototype.read;
      const read = vi
        .spyOn(prototype, "read")
        .mockImplementationOnce(async function (
          this: FileHandle,
          ...parameters: Parameters<FileHandle["read"]>
        ) {
          captured = this;
          release = this.close.bind(this);
          this.close = async () => {
            attempts += 1;
            if (!allowClose)
              throw new Error("controlled journal descriptor close failure");
            await release!();
          };
          return Reflect.apply(original, this, parameters);
        });
      restoreRead = () => read.mockRestore();
      return {
        kind: "cancelled",
        targetLaunched: false,
        targetIdentity: undefined,
        cleanupFailure: undefined,
      };
    },
    async () => ok(fakeTool),
  );
  onTestFinished(async () => {
    restoreRead?.();
    allowClose = true;
    await tracer.close();
    await release?.();
  });
  const result = await tracer.trace(request);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cancelled controlled run");
  const partial = nativeCallPartialObservationSchema.parse(
    result.error.partialObservation,
  );
  expect(partial.process.other_stops).toEqual(["controlled journal fact"]);
  expect(attempts).toBeGreaterThan(0);
  if (configPath === undefined)
    throw new Error("Expected owned runtime config path");
  const rootRetained = await access(dirname(configPath)).then(
    () => true,
    () => false,
  );
  expect({
    cleanupIncomplete: result.error.cleanupIncomplete,
    rootRetained,
    descriptorStillOpen: captured !== undefined && captured.fd >= 0,
  }).toEqual({
    cleanupIncomplete: true,
    rootRetained: true,
    descriptorStillOpen: true,
  });
  expect((await tracer.close()).ok).toBe(false);
  allowClose = true;
  expect((await tracer.close()).ok).toBe(true);
  expect(result.error.cleanupIncomplete).toBe(false);
  await expect(access(dirname(configPath))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

/** Write the complete producer facts used by readback ownership controls. */
const writeReadbackFixture = async (
  config: z.infer<typeof configSchema>,
  stdout: string,
  stderr: string,
) => {
  await writeFile(
    config.observation_path,
    JSON.stringify({ kind: "event", event: EVENT }) + "\n",
  );
  await writeFile(config.stdout_capture_path, stdout);
  await writeFile(config.stderr_capture_path, stderr);
  await writeFile(config.pid_path, "12345\n");
  await writeFile(
    config.result_path,
    JSON.stringify({
      ...successfulTracerOutput,
      target_output: {
        ...successfulTracerOutput.target_output,
        stdout_bytes: Buffer.byteLength(stdout),
        stderr_bytes: Buffer.byteLength(stderr),
      },
    }),
  );
};

const readbackPath = (
  config: z.infer<typeof configSchema>,
  selected: "journal" | "stdout" | "stderr" | "result" | "pid",
): string =>
  ({
    journal: config.observation_path,
    stdout: config.stdout_capture_path,
    stderr: config.stderr_capture_path,
    result: config.result_path,
    pid: config.pid_path,
  })[selected];

const controlReadbackDescriptor = async (options: {
  readonly path: string;
  readonly selected: "journal" | "stdout" | "stderr" | "result" | "pid";
  readonly readFails: boolean;
  readonly readFailsAfterPrefix: boolean;
  readonly cancels: boolean;
  readonly controller: AbortController;
  readonly reason: unknown;
  readonly physicalFailure: Error;
}) => {
  const selectedStat = await stat(options.path);
  const probe = await open(options.path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  let captured: FileHandle | undefined;
  let originalClose: (() => Promise<void>) | undefined;
  let allowClose = false;
  let partialReadAttempted = false;
  const arm = async (file: FileHandle) => {
    if (captured !== undefined) return;
    const metadata = await file.stat();
    if (metadata.ino !== selectedStat.ino || metadata.dev !== selectedStat.dev)
      return;
    captured = file;
    originalClose = file.close.bind(file);
    file.close = async () => {
      if (!allowClose) {
        if (options.cancels) options.controller.abort(options.reason);
        throw new Error("controlled selected descriptor cleanup failure");
      }
      await originalClose!();
    };
  };
  const readMethod = prototype.read;
  const readFileMethod = prototype.readFile;
  const read = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...parameters: Parameters<FileHandle["read"]>
  ) {
    await arm(this);
    if (options.readFails && captured === this) throw options.physicalFailure;
    if (options.readFailsAfterPrefix && captured === this) {
      if (partialReadAttempted) throw options.physicalFailure;
      partialReadAttempted = true;
      const [buffer, offset, length, position] = parameters as unknown as [
        Buffer,
        number,
        number,
        number,
      ];
      const prefixLength =
        options.selected === "journal"
          ? Buffer.byteLength(
              JSON.stringify({ kind: "event", event: EVENT }) + "\n",
            )
          : 4;
      return Reflect.apply(readMethod, this, [
        buffer,
        offset,
        Math.min(prefixLength, length),
        position,
      ]);
    }
    return Reflect.apply(readMethod, this, parameters);
  });
  const readFile = vi
    .spyOn(prototype, "readFile")
    .mockImplementation(async function (
      this: FileHandle,
      ...parameters: Parameters<FileHandle["readFile"]>
    ) {
      await arm(this);
      return Reflect.apply(readFileMethod, this, parameters);
    });
  return {
    get captured() {
      return captured;
    },
    allowClose() {
      allowClose = true;
    },
    restore() {
      read.mockRestore();
      readFile.mockRestore();
    },
    closeCaptured() {
      return originalClose?.();
    },
  };
};

interface ReadbackCase {
  readonly selected: "journal" | "stdout" | "stderr" | "result" | "pid";
  readonly readFails: boolean;
  readonly readFailsAfterPrefix?: boolean;
  readonly rootFails: boolean;
  readonly cancels: boolean;
}

const readbackCases: readonly ReadbackCase[] = [
  ...(["journal", "stdout", "stderr", "result", "pid"] as const).map(
    (selected) => ({
      selected,
      readFails: false,
      rootFails: false,
      cancels: false,
    }),
  ),
  {
    selected: "stdout" as const,
    readFails: true,
    readFailsAfterPrefix: false,
    rootFails: false,
    cancels: false,
  },
  {
    selected: "stdout" as const,
    readFails: false,
    readFailsAfterPrefix: true,
    rootFails: false,
    cancels: false,
  },
  {
    selected: "journal" as const,
    readFails: false,
    readFailsAfterPrefix: true,
    rootFails: false,
    cancels: true,
  },
  {
    selected: "stdout" as const,
    readFails: false,
    rootFails: true,
    cancels: false,
  },
  {
    selected: "stdout" as const,
    readFails: false,
    rootFails: false,
    cancels: true,
  },
];
for (const {
  selected,
  readFails,
  readFailsAfterPrefix = false,
  rootFails,
  cancels,
} of readbackCases)
  it(`retains ${selected} readback cleanup and sibling facts (read fails: ${readFails || readFailsAfterPrefix}, root fails: ${rootFails})`, async () => {
    const controller = new AbortController();
    const reason = { caller: "readback-final-close" };
    let launches = 0;
    let runtime: string | undefined;
    let descriptorControl:
      | Awaited<ReturnType<typeof controlReadbackDescriptor>>
      | undefined;
    let restoreRoot: (() => void) | undefined;
    const physicalFailure = new Error("controlled capture read failure");
    const tracer = new LldbCallTracer(
      {},
      async (_executable, args) => {
        launches++;
        const { config } = await configFromArguments(args);
        runtime = dirname(config.result_path);
        await writeReadbackFixture(config, "stdout fact", "stderr fact");
        const journalRow =
          JSON.stringify({ kind: "event", event: EVENT }) + "\n";
        if (selected === "journal" && readFailsAfterPrefix)
          await writeFile(config.observation_path, journalRow + '{"kind":');
        descriptorControl = await controlReadbackDescriptor({
          path: readbackPath(config, selected),
          selected,
          readFails,
          readFailsAfterPrefix,
          cancels,
          controller,
          reason,
          physicalFailure,
        });
        return selected === "journal"
          ? {
              kind: "cancelled",
              targetLaunched: false,
              targetIdentity: undefined,
              cleanupFailure: undefined,
            }
          : {
              kind: "exited",
              targetLaunched: false,
              targetIdentity: undefined,
              cleanupFailure: undefined,
              exitCode: 0,
              output: "",
            };
      },
      async () => ok(fakeTool),
    );
    onTestFinished(async () => {
      descriptorControl?.restore();
      restoreRoot?.();
      descriptorControl?.allowClose();
      await tracer.close();
      await descriptorControl?.closeCaptured();
    });
    const result = await tracer.trace(request, controller.signal);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected retained readback cleanup");
    expect(result.error.cleanupIncomplete).toBe(true);
    const partial = nativeCallPartialObservationSchema.parse(
      result.error.partialObservation,
    );
    expect(partial.events).toEqual([EVENT]);
    if (selected === "pid") expect(partial.process.pid).toBe(12345);
    if (readFails) {
      expect(partial.process.stdout).toBeNull();
      const primary = result.error.cleanupPrimary;
      if (!(primary?.cause instanceof AggregateError))
        throw new Error("Expected retained capture read failure");
      const frame = primary.cause.errors[0];
      if (!(frame instanceof ArtifactFileCleanupFailure))
        throw new Error("Expected exact file cleanup outcome");
      expect(frame.fileCleanupFailure.outcome).toEqual({
        kind: "failed",
        cause: physicalFailure,
      });
    } else if (readFailsAfterPrefix && selected === "stdout") {
      expect(partial.process.stdout).toMatchObject({
        text: "stdo",
        truncated: true,
        complete: false,
      });
      const primary = result.error.cleanupPrimary;
      if (!(primary?.cause instanceof AggregateError))
        throw new Error("Expected retained capture read failure");
      expect(primary.cause.errors).toContain(physicalFailure);
    } else if (readFailsAfterPrefix) {
      const primary = result.error.cleanupPrimary ?? result.error;
      expect(primary.cause).toBe(reason);
      expect(primary.secondaryFailures).toHaveLength(1);
      expect(primary.secondaryFailures[0]?.cause).toBe(physicalFailure);
    } else expect(partial.process.stdout?.text).toBe("stdout fact");
    expect(partial.process.stderr?.text).toBe("stderr fact");
    expect(descriptorControl?.captured?.fd).toBeGreaterThanOrEqual(0);
    if (runtime === undefined) throw new Error("Missing owned runtime");
    await expect(access(runtime)).resolves.toBeUndefined();
    const replacement = await tracer.trace(request);
    expect(replacement.ok).toBe(false);
    expect(launches).toBe(1);
    descriptorControl?.allowClose();
    if (rootFails) {
      const close = vi
        .spyOn(PrivateRuntimeRoot.prototype, "close")
        .mockRejectedValueOnce(new Error("controlled parent cleanup failure"));
      restoreRoot = () => close.mockRestore();
      const rootRetry = await tracer.close();
      expect(rootRetry.ok).toBe(false);
      expect(descriptorControl?.captured?.fd).toBe(-1);
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toEqual([runtime]);
      expect((await tracer.close()).ok).toBe(true);
      if (!rootRetry.ok) expect(rootRetry.error.cleanupIncomplete).toBe(false);
    } else expect((await tracer.close()).ok).toBe(true);
    expect(result.error.cleanupIncomplete).toBe(false);
    if (cancels)
      expect(resolvedAnalysisError(result.error)).toMatchObject({
        _tag: "AnalysisCancelledError",
        cause: reason,
      });
    expect(result.error.cleanupResources).toEqual([]);
    if (!replacement.ok)
      expect(replacement.error.cleanupIncomplete).toBe(false);
    await expect(access(runtime)).rejects.toMatchObject({ code: "ENOENT" });
  });
