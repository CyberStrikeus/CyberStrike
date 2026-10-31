import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { AnalysisCancelledError } from "../../../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { ok } from "../../../../src/domain/result.js";
import { cleanupOwnedProcessGroup } from "../../../../src/process/ProcessOwnership.js";
import { observeProcessStartIdentity } from "../../../../src/process/ProcessOwnershipObservation.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../../../src/process/ProviderProcess.js";
import type { NativeCallTracer } from "../../../../src/native/LldbCallTracer.js";
import { LldbCallTracer } from "../../../../src/native/LldbCallTracer.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../../../fixtures/nativeCommands.js";

const request: Parameters<NativeCallTracer["trace"]>[0] = {
  executable: "/fixture/target",
  architecture: "arm64",
  expectedSha256: "0".repeat(64),
  input: {
    breakpoints: [{ kind: "function", name: "main" }],
    arguments: [],
    environment: {},
    duration_ms: 100,
    max_events: 1,
    argument_registers: 0,
    backtrace_frames: 0,
  },
};
const tool = {
  invocationPath: process.execPath,
  resolvedPath: process.execPath,
  sha256: "0".repeat(64),
};

const createTracer = (
  launch?: ConstructorParameters<typeof LldbCallTracer>[1],
): LldbCallTracer =>
  new LldbCallTracer(process.env, launch, async () => ok(tool));

const createClient = (tracer: NativeCallTracer) =>
  new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
    () => tracer,
  ).createClient(nativeMachoTarget(request.executable));

const runtimeRoot = (error: ProviderCleanupError): string => {
  const root = error.cleanupResources.find((resource) =>
    resource.startsWith(`${tmpdir()}/rea-lldb-`),
  );
  if (root === undefined) throw new Error("Expected retained runtime root");
  return root;
};

const liveChild = async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  await once(child, "spawn");
  if (child.pid === undefined) throw new Error("Fixture process had no PID");
  return { child, pid: child.pid };
};

const stopChild = async (child: ReturnType<typeof spawn>) => {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
  }
};

it.skipIf(process.platform === "win32")(
  "retains a real LLDB process owner and runtime until a later cleanup retry succeeds",
  async () => {
    let cleanupFailures = 2;
    let ownedPid: number | undefined;
    const tracer = createTracer(async (_exe, _args, options) => {
      const target = spawn(process.execPath, ["-e", "process.exit(0)"], {
        stdio: "ignore",
      });
      await once(target, "exit");
      if (target.pid === undefined)
        throw new Error("Fixture target had no PID");
      await writeFile(options.pidPath, String(target.pid));
      const launched = await spawnOwnedProviderProcess({
        command: process.execPath,
        arguments: ["-e", "setInterval(() => {}, 1000)"],
        runId: randomUUID(),
        hostEnvironment: options.environment,
      });
      ownedPid = launched.process.pid;
      const supervisor = new ProviderProcessSupervisor({
        ...launched,
        ownsProcessLifetime: true,
        cleanup: async () => {
          if (cleanupFailures-- > 0)
            return {
              cleaned: false,
              reason: "fixture transient cleanup failure",
            };
          return cleanupOwnedProcessGroup(launched.ownership);
        },
      });
      const stopped = await supervisor.stop();
      return {
        kind: "exited" as const,
        targetLaunched: true,
        exitCode: null,
        output: "",
        targetIdentity: undefined,
        cleanupFailure:
          stopped.status === "incomplete" ? stopped.reason : undefined,
        ...(stopped.status === "incomplete"
          ? { cleanupOwner: supervisor }
          : {}),
      };
    });
    const client = createClient(tracer);

    try {
      const trace = await tracer.trace(request);
      expect(trace.ok).toBe(false);
      if (trace.ok) throw new Error("Expected incomplete cleanup");
      expect(trace.error).toBeInstanceOf(ProviderCleanupError);
      if (!(trace.error instanceof ProviderCleanupError)) return;
      expect(trace.error.cleanupResources).toContain("lldb-process-group");
      expect(trace.error.partialObservation).toBeDefined();
      const root = runtimeRoot(trace.error);
      await expect(access(root)).resolves.toBeUndefined();
      if (ownedPid === undefined) throw new Error("Expected owned process PID");
      const pid = ownedPid;
      expect(() => process.kill(pid, 0)).not.toThrow();
      expect((await client.close()).ok).toBe(false);
      expect(() => process.kill(pid, 0)).not.toThrow();
      await expect(access(root)).resolves.toBeUndefined();
      expect((await client.close()).ok).toBe(true);
      expect(() => process.kill(pid, 0)).toThrow();
      await expect(access(root)).rejects.toThrow();
    } finally {
      await client.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "does not retain a target when cancellation proves LLDB never launched",
  async () => {
    const controller = new AbortController();
    const cancelledTracer = new LldbCallTracer(
      process.env,
      undefined,
      async () => {
        controller.abort();
        return ok(tool);
      },
    );
    const result = await cancelledTracer.trace(request, controller.signal);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cancelled trace");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect((await cancelledTracer.close()).ok).toBe(true);
  },
);

it.skipIf(process.platform === "win32")(
  "retains an unidentified debuggee and runtime until exit can be confirmed",
  async () => {
    const { child, pid } = await liveChild();
    const tracer = createTracer(async (_exe, _args, options) => {
      await writeFile(options.pidPath, String(pid));
      return {
        kind: "exited",
        targetLaunched: true,
        exitCode: 0,
        output: "",
        targetIdentity: undefined,
        cleanupFailure: undefined,
      };
    });
    const client = createClient(tracer);

    try {
      const trace = await tracer.trace(request);
      expect(trace.ok).toBe(false);
      if (trace.ok) throw new Error("Expected unverified target cleanup");
      expect(trace.error).toBeInstanceOf(ProviderCleanupError);
      if (!(trace.error instanceof ProviderCleanupError)) return;
      expect(trace.error.cleanupResources).toContain(`native-target:${pid}`);
      const root = runtimeRoot(trace.error);
      await expect(access(root)).resolves.toBeUndefined();
      expect(() => process.kill(pid, 0)).not.toThrow();
      expect((await client.close()).ok).toBe(false);
      expect(() => process.kill(pid, 0)).not.toThrow();
      await expect(access(root)).resolves.toBeUndefined();
      await stopChild(child);
      expect((await client.close()).ok).toBe(true);
      await expect(access(root)).rejects.toThrow();
    } finally {
      await stopChild(child);
      await client.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "rejects malformed PID authority and retries after the target exits",
  async () => {
    const { child, pid } = await liveChild();
    const identity = await observeProcessStartIdentity(pid);
    if (identity?.state !== "readable")
      throw new Error("Host could not read fixture process identity");
    const tracer = createTracer(async (_exe, _args, options) => {
      await writeFile(options.pidPath, `${pid}junk`);
      return {
        kind: "exited",
        targetLaunched: true,
        exitCode: 0,
        output: "",
        targetIdentity: identity.identity,
        cleanupFailure: undefined,
      };
    });
    const client = createClient(tracer);

    try {
      const trace = await tracer.trace(request);
      expect(trace.ok).toBe(false);
      if (trace.ok) throw new Error("Expected malformed PID cleanup failure");
      expect(trace.error).toBeInstanceOf(ProviderCleanupError);
      if (!(trace.error instanceof ProviderCleanupError)) return;
      expect(trace.error.cleanupResources).toContain("native-target:unknown");
      expect(() => process.kill(pid, 0)).not.toThrow();
      const root = runtimeRoot(trace.error);
      await stopChild(child);
      await writeFile(join(root, "pid"), String(pid));
      expect((await client.close()).ok).toBe(true);
    } finally {
      await stopChild(child);
      await client.close();
    }
  },
);
