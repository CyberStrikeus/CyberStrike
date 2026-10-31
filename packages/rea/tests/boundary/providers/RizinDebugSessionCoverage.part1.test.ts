import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import {
  stopFakeNoInferior,
  rizinTestInferiorTty,
} from "./RizinTestInferiorTty.js";
import * as providerProcess from "../../../src/process/ProviderProcess.js";
import type { SpawnedOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import {
  createRizinCoverageHarness,
  createInjectedProcess,
  abortOnCheck,
  incompleteStop,
} from "./RizinDebugSessionCoverage.fixtures.js";

const {
  cleanup,
  makeProvider,
  missingProviderPath,
  start,
  startInjected,
  createManager,
  spawnOwnedProcess,
} = createRizinCoverageHarness();
afterEach(cleanup);

it.skipIf(process.platform === "win32")(
  "rejects unsupported, pre-cancelled, and failed startup requests",
  async () => {
    const windows = createManager({}, { platform: "win32" });
    expect(
      (
        await windows.start({
          path: "/tmp/a",
          inferior_tty: "unused-before-platform-admission",
        })
      ).ok,
    ).toBe(false);
    const aborted = new AbortController();
    aborted.abort();
    expect(
      (
        await windows.start(
          { path: "/tmp/a", inferior_tty: await rizinTestInferiorTty() },
          aborted.signal,
        )
      ).ok,
    ).toBe(false);

    const failed = await makeProvider("process.exit(9);");
    const manager = createManager({
      REA_RIZIN_COMMAND: failed,
    });

    const result = await manager.start({
      path: "/tmp/a",
      inferior_tty: await rizinTestInferiorTty(),
    });
    expect(result.ok).toBe(false);

    const missing = createManager({
      REA_RIZIN_COMMAND: missingProviderPath(),
    });

    const spawnFailure = await missing.start({
      path: "/tmp/a",
      inferior_tty: await rizinTestInferiorTty(),
    });
    expect(spawnFailure.ok).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "reports Rizin exiting before its initial frame",
  async () => {
    const provider = await makeProvider(
      'process.stderr.write("early startup diagnostic\\n", () => process.exit(0));',
    );
    const manager = createManager({
      REA_RIZIN_COMMAND: provider,
    });

    const result = await manager.start({
      path: "/tmp/early-exit",
      inferior_tty: await rizinTestInferiorTty(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      providerId: "rizin",
      operation: "start_rizin_debug_session",
      capturedOutput: { stderr: "early startup diagnostic\n" },
    });
    expect(result.error.cause).toBeInstanceOf(Error);
    expect((result.error.cause as Error).message).toContain("Rizin exited");
  },
);

it.skipIf(process.platform === "win32")(
  "times out startup through the frame wait when Rizin never emits a frame",
  async () => {
    let resolveSpawned!: () => void;
    const spawned = new Promise<void>((resolve) => {
      resolveSpawned = resolve;
    });
    const injected = createInjectedProcess({
      startup: () => undefined,
      beforeSpawnReturns: resolveSpawned,
    });
    const manager = createManager(
      { REA_RIZIN_COMMAND: "injected-rizin" },
      {
        spawnProcess: injected.spawnProcess,
        stopProcess: async () => ({ status: "stopped" }),
      },
    );

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const starting = manager.start({
        path: "/tmp/no-startup-frame",
        inferior_tty: await rizinTestInferiorTty(),
      });
      await spawned;
      await vi.advanceTimersByTimeAsync(30_001);
      const result = await starting;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "does not spawn Rizin when cancellation arrives during TTY validation",
  async () => {
    let spawned = false;
    const manager = createManager(
      { REA_RIZIN_COMMAND: "injected-rizin" },
      {
        spawnProcess: async () => {
          spawned = true;
          throw new Error("must not spawn after cancellation");
        },
      },
    );
    const result = await manager.start(
      {
        path: "/tmp/cancel-before-spawn",
        inferior_tty: await rizinTestInferiorTty(),
      },
      abortOnCheck(2),
    );
    expect(result.ok).toBe(false);
    expect(spawned).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a non-TTY path before spawning Rizin",
  async () => {
    let spawned = false;
    const manager = createManager(
      { REA_RIZIN_COMMAND: "injected-rizin" },
      {
        spawnProcess: async () => {
          spawned = true;
          throw new Error("must not spawn with an invalid TTY");
        },
      },
    );
    const result = await manager.start({
      path: "/tmp/not-a-tty-target",
      inferior_tty: "/dev/null",
    });
    expect(result.ok).toBe(false);
    expect(spawned).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "closeAll drains concurrent startups and blocks later admission",
  async () => {
    let spawnCount = 0;
    let resolveSpawnCalls!: () => void;
    const bothSpawnsCalled = new Promise<void>((resolve) => {
      resolveSpawnCalls = resolve;
    });
    let releaseSpawns!: () => void;
    const spawnGate = new Promise<void>((resolve) => {
      releaseSpawns = resolve;
    });
    const injected = createInjectedProcess();
    const manager = createManager(
      { REA_RIZIN_COMMAND: "injected-rizin" },
      {
        spawnProcess: async (options) => {
          spawnCount += 1;
          if (spawnCount === 2) resolveSpawnCalls();
          await spawnGate;
          return injected.spawnProcess(options);
        },
        stopProcess: async () => ({ status: "stopped" }),
      },
    );
    const tty = await rizinTestInferiorTty();
    const starts = [
      manager.start({ path: "/tmp/start-one", inferior_tty: tty }),
      manager.start({ path: "/tmp/start-two", inferior_tty: tty }),
    ];
    await bothSpawnsCalled;
    let closeAllResolved = false;
    const closing = manager.closeAll().then(() => {
      closeAllResolved = true;
    });
    await Promise.resolve();
    expect(closeAllResolved).toBe(false);
    releaseSpawns();
    const started = await Promise.all(starts);
    expect(started.every((result) => result.ok)).toBe(true);
    await closing;
    expect(
      manager.status(started[0]!.ok ? started[0]!.value.session_id : "missing"),
    ).toBeUndefined();
    expect(
      (await manager.start({ path: "/tmp/after-close-all", inferior_tty: tty }))
        .ok,
    ).toBe(false);
    expect((await manager.close("missing")).ok).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "rejects an oversized initial frame instead of marking the session ready",
  async () => {
    const provider = await makeProvider(
      'process.stdout.write("x".repeat(16 * 1024 * 1024 + 1) + "\\0"); process.stdin.resume();',
    );
    const manager = createManager({
      REA_RIZIN_COMMAND: provider,
    });

    const result = await manager.start({
      path: "/tmp/oversized-startup",
      inferior_tty: await rizinTestInferiorTty(),
    });

    expect(result.ok).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "cancels startup while waiting for the initial NUL frame",
  async () => {
    let resolveSpawned!: () => void;
    const spawned = new Promise<void>((resolve) => {
      resolveSpawned = resolve;
    });
    const provider = await makeProvider(
      'setTimeout(() => process.stdout.write("\\0"), 500); process.stdin.resume();',
    );
    const manager = createManager(
      {
        REA_RIZIN_COMMAND: provider,
      },
      {
        spawnProcess: async (options) => {
          const launched = await spawnOwnedProcess(options);
          resolveSpawned();
          return launched;
        },
      },
    );

    const abort = new AbortController();
    const starting = manager.start(
      { path: "/tmp/cancel-start", inferior_tty: await rizinTestInferiorTty() },
      abort.signal,
    );
    await spawned;
    abort.abort();
    expect((await starting).ok).toBe(false);
  },
);

it
  .skipIf(process.platform === "win32")
  .each(["is uncertain", "reports stopped before exit"] as const)(
  "cleans startup fixtures after cancellation when manager stop %s",
  async (stopMode) => {
    const provider = await makeProvider(
      "process.stdin.resume(); setInterval(() => {}, 1000);",
    );
    let resolveSpawned!: () => void;
    const spawned = new Promise<void>((resolve) => {
      resolveSpawned = resolve;
    });
    let ownedLaunch: SpawnedOwnedProviderProcess | undefined;
    const nativeSpawn = providerProcess.spawnOwnedProviderProcess;
    const spy = vi
      .spyOn(providerProcess, "spawnOwnedProviderProcess")
      .mockImplementation(async (options) => {
        const launched = await nativeSpawn(options);
        ownedLaunch = launched;
        resolveSpawned();
        return launched;
      });
    try {
      const stopProcess: typeof incompleteStop =
        stopMode === "is uncertain"
          ? incompleteStop
          : async () => ({ status: "stopped" });
      const manager = createManager(
        { REA_RIZIN_COMMAND: provider },
        { stopProcess },
      );
      const abort = new AbortController();
      const starting = manager.start(
        {
          path: "/tmp/cancel-start",
          inferior_tty: await rizinTestInferiorTty(),
        },
        abort.signal,
      );
      await spawned;
      const reason = { stage: "startup cancellation" };
      abort.abort(reason);
      const result = await starting;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error._tag).toBe("AnalysisCancelledError");
        expect(result.error.cause).toBe(reason);
        if (stopMode === "is uncertain")
          expect(result.error.cleanup?.reason).toContain(
            "injected stop uncertainty",
          );
      }
      await cleanup();
      if (ownedLaunch === undefined)
        throw new Error("Fixture launch was not observed");
      expect(
        ownedLaunch.process.exitCode !== null ||
          ownedLaunch.process.signalCode !== null,
        "harness returned before fixture child exit",
      ).toBe(true);
    } finally {
      spy.mockRestore();
      // A failing regression must also reap its observed, directly owned child.
      if (
        ownedLaunch !== undefined &&
        ownedLaunch.process.exitCode === null &&
        ownedLaunch.process.signalCode === null
      ) {
        const safety = new providerProcess.ProviderProcessSupervisor(
          { ...ownedLaunch, ownsProcessLifetime: true },
          { captureStdout: false, maxDiagnosticBytes: 0 },
        );
        expect((await safety.stop()).status).not.toBe("incomplete");
        expect(safety.observedExit()).toBeDefined();
      }
    }
  },
);

it.skipIf(process.platform === "win32")(
  "retains owned fixture processes and files until a failed cleanup can complete",
  async () => {
    let failCleanup = true;
    const fixture = createRizinCoverageHarness({
      stopOwnedProcess: async (supervisor) =>
        failCleanup
          ? { status: "incomplete", reason: "injected fixture stop failure" }
          : supervisor.stop(),
    });
    const provider = await fixture.makeProvider(
      "process.stdin.resume(); setInterval(() => {}, 1000);",
    );
    const launched = await fixture.spawnOwnedProcess({
      command: provider,
      arguments: [],
      runId: randomUUID(),
      stdin: "pipe",
    });
    try {
      await expect(fixture.cleanup()).rejects.toMatchObject({
        message: "Fake Rizin fixture cleanup failed",
        errors: [
          expect.objectContaining({
            message: expect.stringContaining("injected fixture stop failure"),
          }),
        ],
      });
      expect(launched.process.exitCode).toBeNull();
      expect(launched.process.signalCode).toBeNull();
      await access(provider);
      const nextProvider = await fixture.makeProvider("process.exit(0);");
      failCleanup = false;
      await fixture.cleanup();
      expect(
        launched.process.exitCode !== null ||
          launched.process.signalCode !== null,
      ).toBe(true);
      await expect(access(provider)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(nextProvider)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      failCleanup = false;
      try {
        await fixture.cleanup();
      } finally {
        if (
          launched.process.exitCode === null &&
          launched.process.signalCode === null
        ) {
          const safety = new providerProcess.ProviderProcessSupervisor(
            { ...launched, ownsProcessLifetime: true },
            { captureStdout: false, maxDiagnosticBytes: 0 },
          );
          expect((await safety.stop()).status).not.toBe("incomplete");
          expect(safety.observedExit()).toBeDefined();
        }
      }
    }
  },
);

it.skipIf(process.platform === "win32")(
  "rejects commands for missing and pre-cancelled sessions",
  async () => {
    const provider = await makeProvider(
      'process.stdout.write("\\0"); process.stdin.resume();',
    );
    const { manager, sessionId } = await start(provider);
    expect((await manager.execute("missing", "dr")).ok).toBe(false);
    const aborted = new AbortController();
    aborted.abort(null);
    const result = await manager.execute(sessionId, "dr", aborted.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.cause).toBeNull();
    }
    expect(manager.status(sessionId)?.state).toBe("ready");
    expect((await manager.close("missing")).ok).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "retains close failures and resolves their owner after cleanup retry",
  async () => {
    const provider = await makeProvider(
      'process.stdout.write("\\0"); process.stdin.resume();',
    );
    let stopCalls = 0;
    const { manager, sessionId } = await start(provider, {
      stopProcess: async (session, name, options) => {
        stopCalls += 1;
        if (stopCalls === 1) {
          session.launched.process.kill("SIGTERM");
          return {
            status: "incomplete",
            reason: "first stop result is uncertain",
          };
        }
        await session.supervisor.waitForExit(1000);
        return stopFakeNoInferior(session, name, options);
      },
    });
    const closed = await manager.close(sessionId);
    expect(closed.ok).toBe(false);
    if (!closed.ok) {
      expect(closed.error.cleanupIncomplete).toBe(true);
      expect(closed.error.cleanup?.resources).toEqual([sessionId]);
      const retainedFailure = closed.error;
      expect(await manager.retryCleanupFailures()).toEqual({
        ok: true,
        value: null,
      });
      expect(retainedFailure.cleanupIncomplete).toBe(false);
    }
    expect(stopCalls).toBe(2);
    expect(manager.status(sessionId)).toBeUndefined();
  },
);

it.skipIf(process.platform === "win32")(
  "retains a Rizin close owner until inherited output writers close",
  async () => {
    const injected = createInjectedProcess();
    const { manager, started } = await startInjected(injected.spawnProcess);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const sessionId = started.value.session_id;
    injected.control.exitLeader();

    const firstClose = await manager.close(sessionId);
    expect(firstClose.ok).toBe(false);
    if (!firstClose.ok) {
      expect(firstClose.error.cleanupIncomplete).toBe(true);
      expect(firstClose.error.message).toMatch(/inherited output streams/i);
    }
    expect(manager.status(sessionId)).toBeDefined();

    injected.control.closeOutput();
    const retried = await manager.retryCleanupFailures();

    expect(retried).toEqual({ ok: true, value: null });
    expect(manager.status(sessionId)).toBeUndefined();
  },
);

it.skipIf(process.platform === "win32")(
  "closes a session after unsolicited frames make command correlation unsafe",
  async () => {
    const provider = await makeProvider(
      'process.stdout.write("\\0"); setTimeout(() => process.stdout.write("unexpected\\0"), 20); process.stdin.resume();',
    );
    const { manager, sessionId } = await start(provider);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = await manager.execute(sessionId, "dr");
    expect(result.ok).toBe(false);
    expect(manager.status(sessionId)?.state).toBe("closed");
    expect((await manager.close(sessionId)).ok).toBe(true);
  },
);
