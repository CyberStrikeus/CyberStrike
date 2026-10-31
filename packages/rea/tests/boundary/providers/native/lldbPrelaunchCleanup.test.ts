import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, expect, it, vi } from "vitest";

import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { nativeCallObservationInputSchema } from "../../../../src/domain/native/nativeCallObservation.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { err, ok } from "../../../../src/domain/result.js";
import { NativeCommandFailure } from "../../../../src/native/CommandRunner.js";
import { LldbCallTracer } from "../../../../src/native/LldbCallTracer.js";
import { DarwinProcessOwnershipInspectionError } from "../../../../src/process/DarwinProcessRunTokenReader.js";
import * as processBoundary from "../../../../src/process/ProviderProcess.js";

const tool = {
  invocationPath: "/usr/bin/true",
  resolvedPath: "/usr/bin/true",
  sha256: "b".repeat(64),
};
const request = {
  executable: "/fixture",
  architecture: "arm64" as const,
  expectedSha256: "a".repeat(64),
  input: nativeCallObservationInputSchema.parse({
    breakpoints: [{ kind: "function", name: "main" }],
  }),
};

const preparation = (cancellation?: { readonly reason: unknown }) => {
  const marker = new ProviderCleanupError(
    "process-ownership",
    ["owned-helper-root"],
    { reason: "controlled root deletion failure" },
  );
  const close = vi.fn(async () => {
    marker.resolveCleanup();
  });
  const failure = new DarwinProcessOwnershipInspectionError(
    "controlled compiler failure",
    {
      ...(cancellation === undefined ? {} : { cancellation }),
      cleanupFailure: marker,
      cleanupOwner: { close },
      compilerOutcome: {
        outcome: "exited",
        code: 1,
        signal: null,
        stderr: "compiler failed",
        stderrTruncated: false,
        outputTruncated: false,
        killed: false,
      },
      capturedOutput: {
        stdout: "",
        stderr: "compiler failed",
        stderr_bytes: 15,
        truncated: false,
      },
    },
  );
  return { marker, close, failure };
};

afterEach(() => {
  vi.restoreAllMocks();
});

it("keeps LLDB preparation facts and the foreign helper marker", async () => {
  const prepared = preparation();
  const launch = vi
    .spyOn(processBoundary, "spawnOwnedProviderProcess")
    .mockRejectedValue(prepared.failure);
  const tracer = new LldbCallTracer({}, undefined, async () => ok(tool));
  try {
    const result = await tracer.trace(request);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.diagnostics).toMatchObject({
      phase: "process-preparation",
      tool: "lldb",
      reason: "controlled compiler failure",
      compiler_outcome: { outcome: "exited", code: 1, signal: null },
    });
    expect(result.error.diagnostics).not.toMatchObject({
      reason: "LLDB exited without a usable tracer result",
    });
    expect(result.error.capturedOutput).toMatchObject({
      stderr: "compiler failed",
      stderr_bytes: 15,
    });
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual(["owned-helper-root"]);
    expect(projectAnalysisError(result.error).code).toBe("cleanup_incomplete");
    expect((await tracer.close()).ok).toBe(true);
    expect(prepared.close).not.toHaveBeenCalled();
    expect(prepared.marker.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupIncomplete).toBe(true);
    await prepared.close();
    expect(prepared.marker.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    await tracer.close();
    await prepared.close();
  }
});

it("retries the tracer-owned resolver supervisor before another trace", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: 0,
    signalCode: null,
    kill: () => true,
  });
  let failStop = true;
  const supervisor = new processBoundary.ProviderProcessSupervisor({
    process: child,
    ownsProcessLifetime: true,
    ownership: {
      runId: "controlled-resolver",
      leaderPid: 46000,
      processGroupId: 46000,
      expectedParentPid: process.pid,
    },
    cleanup: async () =>
      failStop
        ? { cleaned: false, reason: "controlled incomplete stop" }
        : { cleaned: true, signaled: false },
  });
  const stop = vi.spyOn(supervisor, "stop");
  const marker = new ProviderCleanupError(
    "native-macos",
    ["owned-resolver-process"],
    { reason: "controlled incomplete stop" },
  );
  const resolver = vi.fn(async () =>
    err(
      new NativeCommandFailure(
        "lldb",
        "io",
        null,
        { cleanupOwner: supervisor, cleanupMarker: marker },
        null,
        "controlled incomplete stop",
        ["owned-resolver-process"],
      ),
    ),
  );
  const tracer = new LldbCallTracer({}, undefined, resolver);
  try {
    const result = await tracer.trace(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("ProviderAdapterError");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual(["owned-resolver-process"]);
    expect(projectAnalysisError(result.error).code).toBe("cleanup_incomplete");

    const closed = await tracer.close();
    expect(closed.ok).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(marker.cleanupIncomplete).toBe(true);

    await tracer.trace(request);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(2);

    failStop = false;
    const released = await tracer.close();
    expect(released.ok).toBe(true);
    expect(marker.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupIncomplete).toBe(false);

    const again = await tracer.trace(request);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(again.ok).toBe(false);
  } finally {
    supervisor.dispose();
    child.stdout.destroy();
    child.stderr.destroy();
    await tracer.close();
  }
});

it("keeps resolver preparation cleanup with the foreign helper", async () => {
  const prepared = preparation();
  const failure = new NativeCommandFailure("lldb", "io", null, {
    cause: prepared.failure,
  });
  const resolver = vi.fn(async () => err(failure));
  const tracer = new LldbCallTracer({}, undefined, resolver);
  try {
    const result = await tracer.trace(request);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("ProviderAdapterError");
    expect(result.error.cause).toBe(failure);
    expect(result.error.diagnostics).toMatchObject({
      phase: "process-preparation",
      tool: "lldb",
      reason: "io",
      detail: "controlled compiler failure",
      compiler_outcome: { outcome: "exited", code: 1, signal: null },
    });
    expect(result.error.capturedOutput).toMatchObject({
      stderr: "compiler failed",
    });
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual(["owned-helper-root"]);
    expect(projectAnalysisError(result.error).code).toBe("cleanup_incomplete");

    expect((await tracer.close()).ok).toBe(true);
    expect(prepared.close).not.toHaveBeenCalled();
    expect(prepared.marker.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupIncomplete).toBe(true);

    await tracer.trace(request);
    expect(resolver).toHaveBeenCalledTimes(2);

    await prepared.close();
    expect(prepared.marker.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    await tracer.close();
    await prepared.close();
  }
});

it.each([
  ["timeout", "AnalysisTimeoutError", "provider_timeout"],
  ["cancelled", "AnalysisCancelledError", "cancelled"],
] as const)(
  "preserves resolver preparation %s classification and exact reason",
  async (reason, tag, code) => {
    const abortReason = { phase: "resolver preparation" };
    const prepared = preparation({ reason: abortReason });
    const failure = new NativeCommandFailure("lldb", reason, null, {
      cause: prepared.failure,
    });
    const tracer = new LldbCallTracer({}, undefined, async () => err(failure));
    try {
      const result = await tracer.trace(request);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected preparation failure");
      expect(result.error._tag).toBe(tag);
      expect(result.error.cause).toBe(abortReason);
      expect(result.error.capturedOutput?.stderr).toBe("compiler failed");
      expect(result.error.cleanupIncomplete).toBe(true);
      await prepared.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error).code).toBe(code);
    } finally {
      await tracer.close();
      await prepared.close();
    }
  },
);
