import { DarwinProcessOwnershipInspectionError } from "../../../src/process/DarwinProcessRunTokenReader.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { beforeAll, expect, it, vi } from "vitest";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../../../src/process/OwnedCommand.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../../src/process/ProviderProcess.js";
import {
  cleanupOwnedProcessGroup,
  type ProcessCleanupResult,
} from "../../../src/process/ProcessOwnership.js";
import {
  prepareProcessOwnershipInspection,
  systemProcessOwnershipHost,
} from "../../../src/process/ProcessOwnershipObservation.js";
import { waitForProviderProcessReady } from "../../fixtures/providerProcess.js";
import { createDeferred } from "../../fixtures/binarySession.js";

const command = (script: string) => ({
  command: process.execPath,
  arguments: ["-e", script],
  runId: `rea-owned-command-test-${randomUUID()}`,
});

// Output/exit cases start with a prepared inspector; startup deadline cases
// below inject their own preparation so they remain independent of compiler speed.
beforeAll(() => prepareProcessOwnershipInspection());

it("includes ownership preparation in the command deadline before provider creation", async () => {
  let prepared = false;
  await expect(
    runOwnedCommand(
      command("process.exit(0)"),
      {
        timeoutMs: 20,
        diagnosticBytes: 1024,
      },
      {
        launcher: async (input) => {
          await delay(80, undefined, { signal: input.signal });
          prepared = true;
          throw new Error(
            "Slow preparation must be aborted before provider creation",
          );
        },
      },
    ),
  ).rejects.toMatchObject({ reason: "timeout", snapshot: null });
  expect(prepared).toBe(false);
});

it("passes cancellation into native ownership preparation before provider creation", async () => {
  const controller = new AbortController();
  await expect(
    runOwnedCommand(
      command("process.exit(0)"),
      { timeoutMs: 2000, diagnosticBytes: 1024 },
      {
        signal: controller.signal,
        launcher: async (input) => {
          expect(input.signal?.aborted).toBe(false);
          controller.abort();
          input.signal?.throwIfAborted();
          throw new Error("Cancelled preparation must not launch a provider");
        },
      },
    ),
  ).rejects.toMatchObject({ reason: "cancelled", snapshot: null });
});

it("bounds retained diagnostics across both streams during a real output burst", async () => {
  try {
    await runOwnedCommand(
      command(
        'process.stdout.write("a".repeat(256 * 1024)); process.stderr.write("b".repeat(256 * 1024))',
      ),
      { timeoutMs: 2_000, diagnosticBytes: 1024 },
    );
    throw new Error("An oversized producer must fail");
  } catch (cause: unknown) {
    if (!(cause instanceof OwnedCommandFailure)) throw cause;
    expect(cause.reason).toBe("output-limit");
    expect(cause.snapshot).not.toBeNull();
    expect(
      (cause.snapshot?.stdout.bytes ?? 0) + (cause.snapshot?.stderr.bytes ?? 0),
    ).toBeLessThanOrEqual(1024);
  }
});

it.each([2_000, null])(
  "collects a real owned command and verifies its exit before returning diagnostics (timeout %s)",
  async (timeoutMs) => {
    const result = await runOwnedCommand(
      command('process.stdout.write("observed-output")'),
      { timeoutMs, diagnosticBytes: 1024 },
    );
    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      stdout: { text: "observed-output", bytes: 15 },
    });
  },
);

it.each([0, 2])(
  "observes complete accepted output once before final cleanup (exit %s)",
  async (exitCode) => {
    const stages: string[] = [];
    const snapshot = await runOwnedCommand(
      command(
        `process.stdout.write("complete"); process.exitCode = ${exitCode}`,
      ),
      {
        timeoutMs: 2000,
        diagnosticBytes: 1024,
        acceptNonZeroExit: true,
        observeCompleted: (observed) => {
          stages.push("observed");
          expect(observed.exitCode).toBe(exitCode);
          expect(observed.stdout.text).toBe("complete");
        },
      },
      {
        launcher: async (input) => {
          const acquired = await spawnOwnedProviderProcess(input);
          return {
            ...acquired,
            cleanup: async () => {
              stages.push("cleanup");
              return cleanupOwnedProcessGroup(acquired.ownership);
            },
          };
        },
      },
    );
    expect(snapshot.exitCode).toBe(exitCode);
    expect(stages).toEqual(["observed", "cleanup"]);
  },
);

it("does not interpret output rejected by its complete-output budget", async () => {
  const observeCompleted = vi.fn();
  await expect(
    runOwnedCommand(command('process.stdout.write("x".repeat(2048))'), {
      timeoutMs: 2000,
      diagnosticBytes: 1024,
      observeCompleted,
    }),
  ).rejects.toMatchObject({ reason: "output-limit" });
  expect(observeCompleted).not.toHaveBeenCalled();
});

it.each([2000, null])(
  "retains late cancellation separately from a physical failure with refused cleanup (timeout %s)",
  async (timeoutMs) => {
    const controller = new AbortController();
    const callerReason = { request: "cancel during refused finalization" };
    let denied = true;
    let failure: OwnedCommandFailure | undefined;
    try {
      await runOwnedCommand(
        command("process.exit(2)"),
        { timeoutMs, diagnosticBytes: 1024 },
        {
          signal: controller.signal,
          launcher: async (input) => {
            const acquired = await spawnOwnedProviderProcess(input);
            return {
              ...acquired,
              cleanup: async () => {
                if (denied) {
                  controller.abort(callerReason);
                  return {
                    cleaned: false,
                    reason: "controlled cleanup refusal",
                  };
                }
                return cleanupOwnedProcessGroup(acquired.ownership);
              },
            };
          },
        },
      ).catch((cause: unknown) => {
        if (!(cause instanceof OwnedCommandFailure)) throw cause;
        failure = cause;
      });
      expect(failure).toMatchObject({
        reason: "process",
        snapshot: { exitCode: 2 },
        cleanupFailure: "controlled cleanup refusal",
      });
      expect(failure?.cancellation?.reason).toBe(callerReason);
      denied = false;
      expect(await failure?.cleanupOwner?.stop()).toEqual({
        status: "verified-cleanup",
      });
    } finally {
      denied = false;
      await failure?.cleanupOwner?.stop();
    }
  },
);

it("keeps an exit failure observed before cancellation primary across delayed classification", async () => {
  const controller = new AbortController();
  const callerReason = { request: "cancel after process exit" };
  let denied = true;
  let retainedOwner: ProviderProcessSupervisor | undefined;
  const outputClosed = createDeferred<void>();
  const continueClassification = createDeferred<void>();
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
    final(_callback) {},
  });
  const originalWait = ProviderProcessSupervisor.prototype.waitForOutputClose;
  const waitForOutputClose = vi.spyOn(
    ProviderProcessSupervisor.prototype,
    "waitForOutputClose",
  );
  let delayed = false;
  waitForOutputClose.mockImplementation(async function (
    this: ProviderProcessSupervisor,
    timeoutMs?: number,
    signal?: AbortSignal,
  ) {
    const closed = await originalWait.call(this, timeoutMs, signal);
    if (closed && !delayed) {
      delayed = true;
      outputClosed.resolve(undefined);
      await continueClassification.promise;
    }
    return closed;
  });

  try {
    const result = runOwnedCommand(
      command(
        'process.stdout.write("buffered"); process.stderr.write("authored physical failure"); process.exitCode = 7',
      ),
      { timeoutMs: 2_000, diagnosticBytes: 1_024, stdout: sink },
      {
        signal: controller.signal,
        retainCleanup: (owner) => {
          retainedOwner = owner;
        },
        launcher: async (input) => {
          const acquired = await spawnOwnedProviderProcess(input);
          return {
            ...acquired,
            cleanup: async () => {
              if (denied)
                return { cleaned: false, reason: "controlled cleanup refusal" };
              return cleanupOwnedProcessGroup(acquired.ownership);
            },
          };
        },
      },
    );

    await outputClosed.promise;
    controller.abort(callerReason);
    continueClassification.resolve(undefined);
    const failure = await result.catch((cause: unknown) => {
      if (!(cause instanceof OwnedCommandFailure)) throw cause;
      return cause;
    });

    expect(failure).toMatchObject({
      reason: "process",
      snapshot: {
        exitCode: 7,
        stderr: { text: "authored physical failure" },
      },
    });
    expect(failure).toBeInstanceOf(OwnedCommandFailure);
    if (!(failure instanceof OwnedCommandFailure)) return;
    expect(failure.cancellation?.reason).toBe(callerReason);
    expect(failure.collectionFailure).toBe(false);
    expect(failure.processError).toBeUndefined();
    expect(sink.destroyed).toBe(true);
    expect(retainedOwner).toBeDefined();
    denied = false;
    expect(await retainedOwner?.stop()).toEqual({
      status: "verified-cleanup",
    });
  } finally {
    continueClassification.resolve(undefined);
    waitForOutputClose.mockRestore();
    denied = false;
    await retainedOwner?.stop();
  }
});

it("keeps cancellation primary when the owned child exits during cancellation cleanup", async () => {
  const controller = new AbortController();
  const callerReason = { request: "cancel before process exit" };
  const outcome = runOwnedCommand(
    command('process.stdout.write("ready"); setInterval(() => {}, 1_000)'),
    { timeoutMs: 2_000, diagnosticBytes: 1_024 },
    {
      signal: controller.signal,
      launcher: async (input) => {
        const acquired = await spawnOwnedProviderProcess(input);
        acquired.process.stdout?.once("data", () =>
          controller.abort(callerReason),
        );
        return acquired;
      },
    },
  );
  const failure = await outcome.catch((cause: unknown) => {
    if (!(cause instanceof OwnedCommandFailure)) throw cause;
    return cause;
  });
  expect(failure).toBeInstanceOf(OwnedCommandFailure);
  if (!(failure instanceof OwnedCommandFailure)) return;
  expect(failure.reason).toBe("cancelled");
  expect(failure.cancellation?.reason).toBe(callerReason);
});

it("streams stdout beyond the diagnostic budget into a sink and returns after it finishes", async () => {
  let received = 0;
  let finished = false;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength;
      callback();
    },
    final(callback) {
      // A sink still parsing after output closes delays the result.
      setTimeout(() => {
        finished = true;
        callback();
      }, 50);
    },
  });
  const result = await runOwnedCommand(
    command(
      'process.stdout.write("a".repeat(256 * 1024)); process.stderr.write("diagnostic")',
    ),
    { timeoutMs: 2_000, diagnosticBytes: 1024, stdout: sink },
  );
  expect(finished).toBe(true);
  expect(received).toBe(256 * 1024);
  expect(result).toMatchObject({
    exitCode: 0,
    stdout: { text: "", bytes: 0 },
    stderr: { text: "diagnostic" },
  });
});

it("destroys a sink still finishing when the command deadline elapses", async () => {
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
    final(callback) {
      setTimeout(callback, 5_000);
    },
  });
  await expect(
    runOwnedCommand(command('process.stdout.write("observed-output")'), {
      timeoutMs: 300,
      diagnosticBytes: 1024,
      stdout: sink,
    }),
  ).rejects.toMatchObject({ reason: "timeout" });
  expect(sink.destroyed).toBe(true);
});

it("reports a failed stdout sink as a collection failure", async () => {
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("fixture sink failure"));
    },
  });
  await expect(
    runOwnedCommand(command('process.stdout.write("observed-output")'), {
      timeoutMs: 2_000,
      diagnosticBytes: 1024,
      stdout: sink,
    }),
  ).rejects.toMatchObject({
    reason: "process",
    collectionFailure: true,
    message: "stdout stream failed: fixture sink failure",
  });
});

it("fails an accepted nonzero command when an output stream errors and cleans it up", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const readFailure = Object.assign(new Error("fixture read failure"), {
    code: "EIO",
  });
  class FakeProcess extends EventEmitter {
    readonly stdout = stdout;
    readonly stderr = stderr;
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    readonly pid = 41234;
    kill(): boolean {
      return true;
    }
  }
  const child = new FakeProcess();
  const cleanup = vi.fn(async () => ({
    cleaned: true as const,
    signaled: false,
  }));
  const request = command("unused fake launcher command");

  const failure = runOwnedCommand(
    request,
    { timeoutMs: 2_000, diagnosticBytes: 1024, acceptNonZeroExit: true },
    {
      launcher: async () => {
        setImmediate(() => {
          stdout.write("partial output");
          stdout.destroy(readFailure);
          stderr.end();
          child.exitCode = 7;
          child.emit("exit", 7, null);
          child.emit("close", 7, null);
        });
        return {
          process: child,
          ownership: {
            runId: request.runId,
            leaderPid: child.pid,
            processGroupId: child.pid,
          },
          cleanup,
        };
      },
    },
  );

  await expect(failure).rejects.toMatchObject({
    reason: "process",
    message: "stdout stream failed: fixture read failure",
    snapshot: { stdout: { text: "partial output" }, exitCode: 7 },
  });
  await expect(failure).rejects.toHaveProperty("processError", readFailure);
  expect(cleanup).toHaveBeenCalledOnce();
});

it("marks an output collection error when the process itself exits zero", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  class FakeProcess extends EventEmitter {
    readonly stdout = stdout;
    readonly stderr = stderr;
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    readonly pid = 41235;
    kill(): boolean {
      return true;
    }
  }
  const child = new FakeProcess();
  const request = command("unused fake launcher command");
  const failure = runOwnedCommand(
    request,
    { timeoutMs: 2_000, diagnosticBytes: 1024, acceptNonZeroExit: true },
    {
      launcher: async () => {
        setImmediate(() => {
          stdout.write("partial output");
          stdout.destroy(new Error("fixture read failure"));
          stderr.end();
          child.exitCode = 0;
          child.emit("exit", 0, null);
          child.emit("close", 0, null);
        });
        return {
          process: child,
          ownership: {
            runId: request.runId,
            leaderPid: child.pid,
            processGroupId: child.pid,
          },
          cleanup: async () => ({ cleaned: true, signaled: false }),
        };
      },
    },
  );

  await expect(failure).rejects.toMatchObject({
    reason: "process",
    collectionFailure: true,
    message: "stdout stream failed: fixture read failure",
    snapshot: { stdout: { text: "partial output" }, exitCode: 0 },
  });
});

it.skipIf(process.platform === "win32")(
  "sweeps detached run-token descendants and preserves a pre-existing unrelated process",
  async () => {
    const runId = `rea-owned-descendant-test-${randomUUID()}`;
    const unrelated = await spawnOwnedProviderProcess({
      command: process.execPath,
      arguments: ["-e", "setInterval(() => undefined, 1000)"],
      runId: `${runId}-unrelated`,
      hostEnvironment: process.env,
    });
    let descendantPid: number | undefined;
    let descendantOwner:
      | Awaited<ReturnType<typeof spawnOwnedProviderProcess>>
      | undefined;
    try {
      const result = await runOwnedCommand(
        {
          ...command(`
            const { spawn } = require("node:child_process");
            const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
              detached: true,
              stdio: "ignore",
            });
            child.unref();
            process.stdout.write(String(child.pid));
          `),
          runId,
          sweepTokenOwnedProcesses: true,
        },
        { timeoutMs: 5_000, diagnosticBytes: 1024 },
        {
          launcher: async (input) => {
            descendantOwner = await spawnOwnedProviderProcess(input);
            return descendantOwner;
          },
        },
      );
      descendantPid = Number(result.stdout.text);
      expect(Number.isSafeInteger(descendantPid)).toBe(true);
      let remainsLive = true;
      const deadline = Date.now() + 2_000;
      while (remainsLive && Date.now() < deadline) {
        remainsLive = (await systemProcessOwnershipHost.listProcesses()).some(
          ({ pid }) => pid === descendantPid,
        );
        if (remainsLive) await delay(25);
      }
      expect(remainsLive).toBe(false);
      expect(() => process.kill(unrelated.process.pid!, 0)).not.toThrow();
    } finally {
      const descendant = descendantOwner;
      const results = await Promise.allSettled([
        ...(descendant === undefined
          ? []
          : [
              Promise.resolve().then(
                () =>
                  descendant.cleanup?.() ??
                  cleanupOwnedProcessGroup(descendant.ownership),
              ),
            ]),
        Promise.resolve().then(() =>
          cleanupOwnedProcessGroup(unrelated.ownership),
        ),
      ]);
      const failures = results.flatMap((result) => {
        if (result.status === "rejected") return [result.reason];
        return result.value.cleaned ? [] : [new Error(result.value.reason)];
      });
      if (failures.length > 0)
        throw new AggregateError(failures, "Fixture process cleanup failed");
    }
  },
);

it.skipIf(process.platform === "win32")(
  "fails before provider spawn when a requested ownership baseline cannot be captured",
  async () => {
    const baseline = vi
      .spyOn(systemProcessOwnershipHost, "captureBaseline")
      .mockRejectedValue(new Error("baseline unavailable"));
    try {
      await expect(
        runOwnedCommand(
          { ...command("process.exit(0)"), sweepTokenOwnedProcesses: true },
          { timeoutMs: 2_000, diagnosticBytes: 1024 },
        ),
      ).rejects.toThrow("baseline unavailable");
    } finally {
      baseline.mockRestore();
    }
  },
);

it.each([5_000, null])(
  "cancels a real acquired process and independently releases it (timeout %s)",
  async (timeoutMs) => {
    const controller = new AbortController();
    const callerReason = {
      request: "active cancellation",
      cleanup: "caller metadata",
    };
    let pid: number | undefined;
    const result = runOwnedCommand(
      command(
        'process.stdout.write("ready\\n"); setInterval(() => undefined, 1000)',
      ),
      { timeoutMs, diagnosticBytes: 1024 },
      {
        signal: controller.signal,
        launcher: async (input) => {
          const process = await spawnOwnedProviderProcess(input);
          pid = process.process.pid;
          await waitForProviderProcessReady(process.process);
          setImmediate(() => controller.abort(callerReason));
          return process;
        },
      },
    );
    await expect(result).rejects.toMatchObject({
      reason: "cancelled",
      cleanupFailure: null,
      cancellation: { reason: callerReason },
    });
    if (pid === undefined) throw new Error("Process was not acquired");
    const acquiredPid = pid;
    expect(() => process.kill(acquiredPid, 0)).toThrow();
  },
);

it("returns a timeout for a running process after independent cleanup", async () => {
  await expect(
    runOwnedCommand(command("setInterval(() => undefined, 1000)"), {
      timeoutMs: 50,
      diagnosticBytes: 1024,
    }),
  ).rejects.toMatchObject({ reason: "timeout", cleanupFailure: null });
});

it.skipIf(process.platform === "win32").each(["cancelled", "timeout"] as const)(
  "retains the real per-member cleanup ledger after %s and settles after cooperative exit",
  async (reason) => {
    const childScript =
      'process.stdin.once("data", () => process.exit(0)); process.stdout.write("child-ready\\n")';
    const request = {
      ...command(`
        const { spawn } = require("node:child_process");
        const child = spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], {
          env: { ...process.env, REA_PROCESS_RUN_ID: "different-child-owner" },
          stdio: ["pipe", "inherit", "inherit"],
        });
        const release = () => child.stdin.end("release");
        process.stdin.once("data", release);
        const failsafe = setTimeout(release, 10000);
        child.once("exit", () => { clearTimeout(failsafe); process.stdin.destroy(); });
      `),
      stdin: "pipe" as const,
    };
    const controller = new AbortController();
    let launched:
      | Awaited<ReturnType<typeof spawnOwnedProviderProcess>>
      | undefined;
    let cleanup: ProcessCleanupResult | undefined;
    let failure: OwnedCommandFailure | undefined;
    try {
      await runOwnedCommand(
        request,
        { timeoutMs: 2000, diagnosticBytes: 1024 },
        {
          signal: controller.signal,
          launcher: async (input) => {
            const acquired = await spawnOwnedProviderProcess(input);
            launched = acquired;
            acquired.process.stdout?.on("data", (chunk: Buffer) => {
              if (
                reason === "cancelled" &&
                chunk.toString().includes("child-ready")
              )
                controller.abort();
            });
            return {
              ...acquired,
              cleanup: async () => {
                const observed = await cleanupOwnedProcessGroup(
                  acquired.ownership,
                );
                cleanup ??= observed;
                return observed;
              },
            };
          },
        },
      ).catch((cause: unknown) => {
        if (!(cause instanceof OwnedCommandFailure)) throw cause;
        failure = cause;
      });
      if (failure === undefined || launched === undefined)
        throw new Error(
          "The acquired command must retain its failed cleanup owner",
        );
      expect(failure.reason).toBe(reason);
      if (reason === "cancelled")
        expect(failure.cancellation?.reason).toBe(controller.signal.reason);
      else expect(failure.cancellation).toBeUndefined();
      expect(failure.snapshot?.stdout.text).toContain("child-ready");
      expect(cleanup).toMatchObject({
        cleaned: false,
        failures: [expect.objectContaining({ reason: "run-token-mismatch" })],
      });
      expect(failure.cleanupResult).toEqual(cleanup);
      expect(failure.resources).toEqual([
        request.runId,
        `pid:${launched.ownership.leaderPid}`,
        `process-group:${launched.ownership.processGroupId}`,
      ]);
      // An unresolved member does not grant authority to signal the shared group.
      const acquiredPid = launched.ownership.leaderPid;
      expect(() => process.kill(acquiredPid, 0)).not.toThrow();
      if (cleanup?.cleaned === false) {
        for (const member of cleanup.failures ?? []) {
          expect(() => process.kill(member.pid, 0)).not.toThrow();
          expect(failure.cleanupFailure).toContain(String(member.pid));
        }
      }
    } finally {
      // Release through the fixture's acquired input channel, never by an unverified PID.
      launched?.process.stdin?.end("release");
      if (failure?.cleanupOwner !== undefined) {
        expect(await failure.cleanupOwner.waitForOutputClose(5000)).toBe(true);
        expect(await failure.cleanupOwner.stop()).toEqual({
          status: "verified-cleanup",
        });
      }
    }
  },
);

it("honors cancellation during cleanup after a successful command", async () => {
  const controller = new AbortController();
  const callerReason = new Error("cancel during final process cleanup");
  await expect(
    runOwnedCommand(
      command("process.exit(0)"),
      { timeoutMs: 2_000, diagnosticBytes: 1024 },
      {
        signal: controller.signal,
        launcher: async (input) => {
          const launched = await spawnOwnedProviderProcess(input);
          return {
            ...launched,
            cleanup: async () => {
              const result = await cleanupOwnedProcessGroup(launched.ownership);
              controller.abort(callerReason);
              return result;
            },
          };
        },
      },
    ),
  ).rejects.toMatchObject({
    reason: "cancelled",
    cleanupFailure: null,
    cancellation: { reason: callerReason },
  });
});

it("rejects oversized diagnostics even when the child exits immediately", async () => {
  await expect(
    runOwnedCommand(command('process.stdout.write("x".repeat(2048))'), {
      timeoutMs: 2_000,
      diagnosticBytes: 1024,
    }),
  ).rejects.toMatchObject({ reason: "output-limit", cleanupFailure: null });
});

it("preserves original command failure together with failed cleanup resource identities", async () => {
  const request = command("process.exit(2)");
  await expect(
    runOwnedCommand(
      request,
      { timeoutMs: 2_000, diagnosticBytes: 1024 },
      {
        launcher: async (input) => {
          const process = await spawnOwnedProviderProcess(input);
          return {
            ...process,
            cleanup: async () => ({
              cleaned: false as const,
              reason: "synthetic cleanup could not be confirmed",
            }),
          };
        },
      },
    ),
  ).rejects.toMatchObject({
    reason: "process",
    cleanupFailure: "synthetic cleanup could not be confirmed",
    resources: expect.arrayContaining([request.runId]),
    snapshot: { exitCode: 2 },
  });
});

it("retains the preparation owner alongside an independent command deadline", async () => {
  const marker = new ProviderCleanupError(
    "process-ownership",
    ["owned helper root"],
    { reason: "controlled cleanup failure" },
  );
  let preparation: DarwinProcessOwnershipInspectionError | undefined;
  const failure = await runOwnedCommand(
    command("process.exit(0)"),
    { timeoutMs: 20, diagnosticBytes: 1024 },
    {
      launcher: async (input) => {
        try {
          await delay(80, undefined, { signal: input.signal });
        } catch {
          preparation = new DarwinProcessOwnershipInspectionError(
            "cancelled preparation",
            {
              cancellation: { reason: input.signal?.reason },
              cleanupFailure: marker,
            },
          );
          throw preparation;
        }
        throw new Error("Unexpected completed preparation");
      },
    },
  ).catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(OwnedCommandFailure);
  if (!(failure instanceof OwnedCommandFailure))
    throw new Error("Expected command deadline failure");
  expect(failure.reason).toBe("timeout");
  expect(failure.preparationFailure).toBe(preparation);
  expect(failure.preparationFailure?.cleanupFailure).toBe(marker);
});

it("keeps a caller-supplied preparation error opaque when it is the exact abort reason", async () => {
  const controller = new AbortController();
  const marker = new ProviderCleanupError("caller", ["caller metadata"], {
    reason: "opaque caller value",
  });
  const reason = new DarwinProcessOwnershipInspectionError("caller value", {
    cleanupFailure: marker,
  });
  const failure = await runOwnedCommand(
    command("process.exit(0)"),
    { timeoutMs: 2000, diagnosticBytes: 1024 },
    {
      signal: controller.signal,
      launcher: async (input) => {
        controller.abort(reason);
        input.signal?.throwIfAborted();
        throw new Error("Unexpected completed preparation");
      },
    },
  ).catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(OwnedCommandFailure);
  if (!(failure instanceof OwnedCommandFailure))
    throw new Error("Expected command cancellation");
  expect(failure.reason).toBe("cancelled");
  expect(failure.cause).toBe(reason);
  expect(failure.preparationFailure).toBeUndefined();
});
