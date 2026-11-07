import { access, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PendingOperations } from "../../../src/process/PendingOperations.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { ProviderStartupDeadline } from "../../../src/process/ProviderDeadline.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import {
  observeOwnedProcessLineage,
  systemProcessOwnershipHost,
} from "../../../src/process/ProcessOwnershipObservation.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
  type ProviderProcessDiagnostic,
} from "../../../src/process/ProviderProcess.js";
import * as nativeLoader from "../../../src/windows/WindowsNativeLoader.js";
import {
  spawnProviderProcessFixture,
  stopProviderProcessFixture,
  waitForDetachedProviderChild,
  waitForProviderProcessReady,
} from "../../fixtures/providerProcess.js";

const processFixturePath = fileURLToPath(
  new URL("../../fixtures/providerProcess.mjs", import.meta.url),
);

const waitForPidExit = async (
  pid: number,
  timeoutMs = 2_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (cause: unknown) {
      if (cause instanceof Error && "code" in cause && cause.code === "ESRCH")
        return;
      throw cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Process ${String(pid)} did not exit within the test bound`);
};

afterEach(() => {
  vi.useRealTimers();
});

describe("provider process runtime and wait primitives", () => {
  it("allocates a private runtime root and removes it idempotently", async () => {
    const runtime = await PrivateRuntimeRoot.create({
      parent: tmpdir(),
      prefix: "rea-provider-test-",
    });
    expect((await stat(runtime.path)).mode & 0o077).toBe(0);
    await writeFile(join(runtime.path, "owned-scratch"), "fixture");

    const first = runtime.close();
    const second = runtime.close();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    await expect(access(runtime.path)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails closed for a Windows runtime root without native DACL authority", async () => {
    const authority = vi
      .spyOn(nativeLoader, "systemWindowsNativeAuthority")
      .mockReturnValue({
        available: false,
        failureStage: "self-test",
        reason: "Native DACL self-test failed with Win32 error 145",
        retryable: true,
      });
    try {
      await expect(
        PrivateRuntimeRoot.create({ platform: "win32" }),
      ).rejects.toMatchObject({
        code: "private-runtime-root-authority-unavailable",
        message: "Native DACL self-test failed with Win32 error 145",
        retryable: true,
      });
    } finally {
      authority.mockRestore();
    }
  });

  it("classifies external cancellation during startup", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const deadline = new ProviderStartupDeadline(1_000, controller.signal);

    const waiting = deadline.wait(1_000);
    controller.abort();
    await expect(waiting).resolves.toBe("aborted");
    expect(deadline.interruption).toBe("cancelled");
  });

  it("releases the owned timer and abort listener when disposed", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const deadline = new ProviderStartupDeadline(60_000, controller.signal);

    // The deadline owns exactly one live timer while it is undisposed.
    expect(vi.getTimerCount()).toBe(1);
    expect(deadline.interruption).toBeUndefined();

    deadline.dispose();

    // Disposal must release the timer it owns. Leaving it armed would keep a
    // live handle per provider startup for the whole timeout.
    expect(vi.getTimerCount()).toBe(0);

    // Disposal must also detach the abort listener. A listener that survived
    // disposal would still classify this deadline as cancelled, which is the
    // observable difference between a released and a retained deadline.
    controller.abort();
    expect(deadline.interruption).toBeUndefined();

    // No timer may be reintroduced by later ticks either.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one absolute startup deadline across interval waits", async () => {
    vi.useFakeTimers();
    const deadline = new ProviderStartupDeadline(100);
    const waiting = deadline.wait(1_000);

    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).resolves.toBe("aborted");
    expect(deadline.interruption).toBe("timeout");
    expect(deadline.remainingMs()).toBe(0);
    deadline.dispose();
    // Further ticks must not revive the deadline.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deadline.remainingMs()).toBe(0);
  });

  it("does not reclassify an elapsed deadline as later cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const deadline = new ProviderStartupDeadline(50, controller.signal);

    await vi.advanceTimersByTimeAsync(50);
    controller.abort();

    expect(deadline.signal.reason).toMatchObject({ name: "TimeoutError" });
    expect(deadline.interruption).toBe("timeout");
    // After disposal a further tick must not resurrect the abort listener.
    deadline.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deadline.interruption).toBe("timeout");
  });

  it("settles pending requests once on cancellation, timeout, and failure", async () => {
    vi.useFakeTimers();
    const operations = new PendingOperations<number, string>();
    const controller = new AbortController();
    const cancelled = operations.wait(1, {
      timeoutMs: 1_000,
      signal: controller.signal,
      timeoutValue: () => "timeout",
      cancelledValue: () => "cancelled",
    });
    controller.abort();
    await expect(cancelled).resolves.toBe("cancelled");
    // Settling by key after the fact proves the pending entry was released.
    expect(operations.settle(1, "late reply")).toBe(false);

    const timedOut = operations.wait(2, {
      timeoutMs: 50,
      timeoutValue: () => "timeout",
      cancelledValue: () => "cancelled",
    });
    await vi.advanceTimersByTimeAsync(50);
    await expect(timedOut).resolves.toBe("timeout");
    expect(operations.settle(2, "late reply")).toBe(false);

    const failed = operations.wait(3, {
      timeoutMs: 1_000,
      timeoutValue: () => "timeout",
      cancelledValue: () => "cancelled",
    });
    operations.failAll((key) => `failed:${String(key)}`);
    await expect(failed).resolves.toBe("failed:3");
    expect(operations.settle(3, "late reply")).toBe(false);
    expect(operations.size).toBe(0);
    // No pending entry and no live timeout: a later tick changes nothing.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(operations.size).toBe(0);
  });
});

describe("provider process output and cleanup primitives", () => {
  it("marks retained provider output that cannot be represented as UTF-8", async () => {
    const child = spawnProviderProcessFixture("invalid-utf8");
    const supervisor = new ProviderProcessSupervisor({
      process: child,
      ownsProcessLifetime: true,
    });

    await expect(supervisor.waitForOutputClose(2_000)).resolves.toBe(true);
    expect(supervisor.snapshot()).toMatchObject({
      stdout: { text: "a�b", invalidUtf8: true },
      stderr: { text: "c�d", invalidUtf8: true },
    });
    await expect(supervisor.stop()).resolves.toMatchObject({
      status: "already-exited",
    });
  });

  it("marks a retained byte prefix that cuts a valid multibyte UTF-8 character", async () => {
    const child = spawnProviderProcessFixture("valid-multibyte");
    const supervisor = new ProviderProcessSupervisor(
      { process: child, ownsProcessLifetime: true },
      { maxDiagnosticBytes: 2 },
    );

    await expect(supervisor.waitForOutputClose(2_000)).resolves.toBe(true);
    expect(supervisor.snapshot()).toMatchObject({
      stdout: { text: "�", bytes: 2, observedBytes: 3, invalidUtf8: true },
      diagnosticTruncated: true,
    });
    await expect(supervisor.stop()).resolves.toMatchObject({
      status: "already-exited",
    });
  });

  it("retains complete stdout and stderr beyond the former fixed ceiling", async () => {
    const outputBytes = 70_000;
    const child = spawnProviderProcessFixture("burst", outputBytes);
    const diagnostics: ProviderProcessDiagnostic[] = [];
    const supervisor = new ProviderProcessSupervisor(
      { process: child, ownsProcessLifetime: true },
      {
        onDiagnostic: (event) => diagnostics.push(event),
      },
    );

    await expect(supervisor.waitForExit(2_000)).resolves.toBe(true);
    const snapshot = supervisor.snapshot();
    expect(snapshot).toMatchObject({
      stdout: {
        bytes: outputBytes,
        observedBytes: outputBytes,
      },
      stderr: {
        bytes: outputBytes,
        observedBytes: outputBytes,
      },
      exitCode: 23,
      signal: null,
    });
    expect(snapshot.stdout.text).toBe("o".repeat(outputBytes));
    expect(snapshot.stderr.text).toBe("e".repeat(outputBytes));
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ type: "exit", code: 23 }),
    );
    await expect(supervisor.stop()).resolves.toEqual({
      status: "already-exited",
    });
  });

  // POSIX-only: libuv maps every signal to TerminateProcess on Windows, so a
  // child that ignores SIGTERM cannot survive the TERM step there and the
  // escalation below is unreachable.
  it.skipIf(process.platform === "win32")(
    "shares double-stop and escalates a stubborn child from TERM to KILL",
    async () => {
      const child = spawnProviderProcessFixture("stubborn");
      const supervisor = new ProviderProcessSupervisor({
        process: child,
        ownsProcessLifetime: true,
      });
      await waitForProviderProcessReady(child);

      const first = supervisor.stop({
        terminationGraceMs: 20,
        killGraceMs: 500,
      });
      const second = supervisor.stop({
        terminationGraceMs: 20,
        killGraceMs: 500,
      });
      // Concurrent callers must share one escalation instead of signalling
      // the same child twice.
      expect(second).toBe(first);
      await expect(first).resolves.toEqual({ status: "killed" });
      expect(child.signalCode).toBe("SIGKILL");
    },
  );

  it("detaches its process listeners when disposed", async () => {
    const child = spawnProviderProcessFixture("stubborn");
    const diagnostics: ProviderProcessDiagnostic[] = [];
    const supervisor = new ProviderProcessSupervisor(
      { process: child, ownsProcessLifetime: true },
      { onDiagnostic: (event) => diagnostics.push(event) },
    );
    await waitForProviderProcessReady(child);
    // The no-op listener only prevents Node's unhandled-'error' throw. The
    // supervisor's own listener is what is under test.
    child.on("error", () => undefined);

    try {
      // Control: while attached, a late event reaches the diagnostic channel.
      child.emit("error", new Error("attached provider failure"));
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          type: "error",
          message: "attached provider failure",
        }),
      );

      supervisor.dispose();

      // A released supervisor must ignore later events. A retained listener
      // would keep invoking callbacks for an owner that has already let go,
      // which is what accumulates handles across repeated provider lifecycles.
      const observed = diagnostics.length;
      child.emit("error", new Error("late provider failure"));
      child.emit("close", 0, null);
      expect(diagnostics).toHaveLength(observed);
    } finally {
      await stopProviderProcessFixture(child);
    }
  });
});

describe("provider process cleanup authority", () => {
  it("honors verified group cleanup instead of direct process signaling", async () => {
    const child = spawnProviderProcessFixture("stubborn");
    const signalFromCleanup = child.kill.bind(child);
    const directSignal = vi.spyOn(child, "kill");
    const cleanup = vi.fn(async () => {
      // Keep the injected cleanup signal separate from the supervisor's
      // direct method, while retaining the child handle's lifetime checks.
      signalFromCleanup("SIGKILL");
      return { cleaned: true, signaled: true } as const;
    });
    const supervisor = new ProviderProcessSupervisor({
      process: child,
      ownsProcessLifetime: true,
      cleanup,
    });

    try {
      await waitForProviderProcessReady(child);
      await expect(supervisor.stop({ killGraceMs: 500 })).resolves.toEqual({
        status: "verified-cleanup",
      });
      // Cleanup must be attempted. The exact attempt count is an internal
      // retry ladder, so it is deliberately not pinned here.
      expect(cleanup).toHaveBeenCalled();
      expect(directSignal).not.toHaveBeenCalled();
    } finally {
      directSignal.mockRestore();
      await stopProviderProcessFixture(child);
    }
  });

  it("cleans an owned group even after its launcher leader has exited", async () => {
    const child = spawnProviderProcessFixture("exit", 0);
    const cleanup = vi.fn(
      async () => ({ cleaned: true, signaled: false }) as const,
    );
    const supervisor = new ProviderProcessSupervisor({
      process: child,
      ownsProcessLifetime: true,
      cleanup,
    });
    await expect(supervisor.waitForExit(2_000)).resolves.toBe(true);

    await expect(supervisor.stop()).resolves.toEqual({
      status: "verified-cleanup",
    });
    // Cleanup must be attempted. The exact attempt count is an internal retry
    // ladder, so it is deliberately not pinned here.
    expect(cleanup).toHaveBeenCalled();
  });

  it("retains a live child after incomplete cleanup and permits a later stop", async () => {
    const child = spawnProviderProcessFixture("stubborn");
    await waitForProviderProcessReady(child);
    let release = false;
    const cleanup = () => {
      if (release) child.kill("SIGKILL");
      return Promise.resolve({ cleaned: true, signaled: release } as const);
    };
    const supervisor = new ProviderProcessSupervisor({
      process: child,
      ownsProcessLifetime: true,
      cleanup,
    });
    try {
      await expect(supervisor.stop({ killGraceMs: 20 })).resolves.toEqual({
        status: "incomplete",
        reason: "verified process-group cleanup did not stop the launcher",
      });
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
      release = true;
      await expect(supervisor.stop()).resolves.toEqual({
        status: "verified-cleanup",
      });
      expect(supervisor.snapshot().signal).toBe("SIGKILL");
    } finally {
      await stopProviderProcessFixture(child);
    }
  });
});

it("retains member failures and sweep uncertainty from a failed cleanup recheck", async () => {
  const child = spawnProviderProcessFixture("stubborn");
  await waitForProviderProcessReady(child);
  const pid = child.pid;
  if (pid === undefined) {
    await stopProviderProcessFixture(child);
    throw new Error("The acquired ready fixture must have a process ID");
  }
  const failed = {
    cleaned: false as const,
    reason: "fixture identity unavailable during recheck",
    failures: [
      {
        pid,
        reason: "process-identity-unavailable" as const,
        diagnostic: "fixture identity reader unavailable",
      },
    ],
    unverified: [
      { pid: 777, diagnostic: "fixture foreign process token unavailable" },
    ],
  };
  let attempts = 0;
  let release = false;
  const supervisor = new ProviderProcessSupervisor({
    process: child,
    ownsProcessLifetime: true,
    cleanup: async () => {
      if (release) child.kill("SIGKILL");
      attempts += 1;
      return release || attempts === 1
        ? { cleaned: true as const, signaled: release }
        : failed;
    },
  });
  try {
    await expect(supervisor.stop({ killGraceMs: 20 })).resolves.toEqual({
      status: "incomplete",
      reason: failed.reason,
      cleanupResult: failed,
    });
    expect(child.exitCode).toBeNull();
    release = true;
    await expect(supervisor.stop()).resolves.toEqual({
      status: "verified-cleanup",
    });
  } finally {
    await stopProviderProcessFixture(child);
  }
});

describe("provider process host injection", () => {
  it("uses injected host platform and environment when spawning", async () => {
    const spawned = await spawnOwnedProviderProcess({
      command: process.execPath,
      arguments: ["-e", "process.stdout.write(process.env.REA_HOST_TEST)"],
      runId: "injected-host-run",
      platform: "win32",
      hostEnvironment: { PATH: process.env.PATH, REA_HOST_TEST: "host-value" },
      env: { REA_HOST_TEST: "spawn-override" },
    });
    try {
      const supervisor = new ProviderProcessSupervisor({
        process: spawned.process,
        ownsProcessLifetime: true,
      });
      expect(await supervisor.waitForExit(2_000)).toBe(true);
      expect(supervisor.snapshot().stdout.text).toBe("spawn-override");
    } finally {
      if (spawned.process.exitCode === null)
        await new Promise<void>((resolve) =>
          spawned.process.once("close", () => resolve()),
        );
    }
  });
});

describe("provider process memory limits", () => {
  it("refuses a memory limit that the selected launcher cannot enforce", async () => {
    await expect(
      spawnOwnedProviderProcess({
        command: `${tmpdir()}/rea-provider-must-not-spawn-without-limit`,
        arguments: [],
        runId: "provider-process-unenforceable-limit-run",
        platform: "linux",
        memoryLimitBytes: 704 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      _tag: "ProcessAdmissionError",
      code: "memory_limit_unsupported",
    });
  });
});

describe("provider startup cancellation", () => {
  it("rejects an already cancelled launch before preparing or spawning", async () => {
    const controller = new AbortController();
    const cancellation = new Error("provider launch already cancelled");
    controller.abort(cancellation);

    await expect(
      spawnOwnedProviderProcess({
        command: `${tmpdir()}/rea-provider-must-not-spawn-after-cancel`,
        arguments: [],
        runId: "provider-process-pre-aborted-run",
        signal: controller.signal,
      }),
    ).rejects.toBe(cancellation);
  });

  it.skipIf(process.platform !== "darwin")(
    "forwards cancellation through native ownership preparation before spawning",
    async () => {
      const controller = new AbortController();
      const cancellation = new Error("cancelled during native preparation");
      const prepare = vi.spyOn(systemProcessOwnershipHost, "prepare");
      prepare.mockImplementation(async (signal) => {
        expect(signal).toBe(controller.signal);
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      });

      try {
        const starting = spawnOwnedProviderProcess({
          command: `${tmpdir()}/rea-provider-must-not-spawn-after-cancel`,
          arguments: [],
          runId: "provider-process-cancelled-preparation-run",
          signal: controller.signal,
        });
        controller.abort(cancellation);
        await expect(starting).rejects.toBe(cancellation);
        expect(prepare).toHaveBeenCalledOnce();
      } finally {
        prepare.mockRestore();
      }
    },
  );
});

describe("provider process spawning primitives", () => {
  it("spawns an owned process group with exact identity coordinates", async () => {
    const runId = "provider-process-run";
    const spawned = await spawnOwnedProviderProcess({
      command: process.execPath,
      arguments: [processFixturePath, "graceful"],
      runId,
    });
    try {
      expect(spawned.ownership).toMatchObject({
        runId,
        leaderPid: spawned.process.pid,
        processGroupId: spawned.process.pid,
        expectedCommand: process.execPath,
        expectedParentPid: process.pid,
      });
      expect(spawned.process.stdout).not.toBeNull();
      expect(spawned.process.stderr).not.toBeNull();
    } finally {
      await stopProviderProcessFixture(spawned.process);
    }
  });

  it.skipIf(process.platform === "win32")(
    "cleans a real descendant that starts a distinct process group",
    async () => {
      const spawned = await spawnOwnedProviderProcess({
        command: process.execPath,
        arguments: [processFixturePath, "detached-child"],
        runId: "provider-process-lineage-run",
      });
      let detachedChildPid: number | undefined;
      try {
        detachedChildPid = await waitForDetachedProviderChild(spawned.process);
        const observation = await observeOwnedProcessLineage(spawned.ownership);
        expect(observation).toEqual({
          status: "verified",
          observedAt: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
          ),
          lineage: {
            runId: "provider-process-lineage-run",
            launcherPid: spawned.process.pid,
            launcherParentPid: process.pid,
            processGroupId: spawned.process.pid,
            descendants: [
              {
                pid: detachedChildPid,
                parentPid: spawned.process.pid,
                processGroupId: detachedChildPid,
              },
            ],
          },
        });
        await expect(
          cleanupOwnedProcessGroup(spawned.ownership),
        ).resolves.toEqual({ cleaned: true, signaled: true });
        await Promise.all([
          waitForPidExit(spawned.ownership.leaderPid),
          waitForPidExit(detachedChildPid),
        ]);
      } finally {
        await cleanupOwnedProcessGroup(spawned.ownership);
        if (detachedChildPid !== undefined)
          await cleanupOwnedProcessGroup({
            runId: spawned.ownership.runId,
            leaderPid: detachedChildPid,
            processGroupId: detachedChildPid,
          });
        await waitForPidExit(spawned.ownership.leaderPid);
        if (detachedChildPid !== undefined)
          await waitForPidExit(detachedChildPid);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "stops a detached fixture descendant when its launcher receives SIGTERM",
    async () => {
      const launcher = spawnProviderProcessFixture("detached-child");
      let detachedChildPid: number | undefined;
      const cleanup = async (): Promise<void> => {
        await stopProviderProcessFixture(launcher);
        if (detachedChildPid === undefined) return;
        try {
          process.kill(detachedChildPid, "SIGKILL");
        } catch (cause: unknown) {
          if (
            !(
              cause instanceof Error &&
              "code" in cause &&
              cause.code === "ESRCH"
            )
          )
            throw cause;
        }
      };
      try {
        detachedChildPid = await waitForDetachedProviderChild(launcher);
        const launcherPid = launcher.pid;
        if (launcherPid === undefined)
          throw new Error("Detached fixture launcher did not expose a PID");
        launcher.kill("SIGTERM");
        await Promise.all([
          waitForPidExit(launcherPid),
          waitForPidExit(detachedChildPid),
        ]);
      } catch (cause: unknown) {
        await cleanup();
        throw cause;
      }
      await cleanup();
    },
  );

  it("allows interpreter launchers to rely on parent and run-token identity", async () => {
    const spawned = await spawnOwnedProviderProcess({
      command: process.execPath,
      arguments: [processFixturePath, "graceful"],
      runId: "provider-process-interpreter-run",
      expectedCommand: null,
    });
    try {
      expect(spawned.ownership).toMatchObject({
        expectedParentPid: process.pid,
        runId: "provider-process-interpreter-run",
      });
      expect(spawned.ownership).not.toHaveProperty("expectedCommand");
    } finally {
      await stopProviderProcessFixture(spawned.process);
    }
  });

  it("rejects deterministic spawn failures without producing a process", async () => {
    await expect(
      spawnOwnedProviderProcess({
        command: `${tmpdir()}/rea-provider-command-that-does-not-exist`,
        arguments: [],
        runId: "missing-provider",
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("provider process configured-platform spawning", () => {
  it.skipIf(process.platform === "win32")(
    "uses the configured platform when establishing process-group identity",
    async () => {
      const windowsConfigured = await spawnOwnedProviderProcess({
        command: process.execPath,
        arguments: [processFixturePath, "graceful"],
        runId: "provider-process-configured-win32-run",
        platform: "win32",
      });
      const posixConfigured = await spawnOwnedProviderProcess({
        command: process.execPath,
        arguments: [processFixturePath, "graceful"],
        runId: "provider-process-configured-posix-run",
        platform: "linux",
      });
      try {
        await Promise.all([
          waitForProviderProcessReady(windowsConfigured.process),
          waitForProviderProcessReady(posixConfigured.process),
        ]);
        await expect(
          observeOwnedProcessLineage(windowsConfigured.ownership),
        ).resolves.toMatchObject({
          status: "unavailable",
          reason: "owned launcher process-group identity did not match",
          launcherPid: windowsConfigured.process.pid,
        });
        await expect(
          observeOwnedProcessLineage(posixConfigured.ownership),
        ).resolves.toMatchObject({
          status: "verified",
          lineage: {
            runId: "provider-process-configured-posix-run",
            launcherPid: posixConfigured.process.pid,
            launcherParentPid: process.pid,
            processGroupId: posixConfigured.process.pid,
            descendants: [],
          },
        });
      } finally {
        await Promise.all([
          stopProviderProcessFixture(windowsConfigured.process),
          stopProviderProcessFixture(posixConfigured.process),
        ]);
      }
    },
  );
});
