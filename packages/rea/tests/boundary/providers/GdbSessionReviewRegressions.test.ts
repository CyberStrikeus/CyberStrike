import { readFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { GdbSessionManager } from "../../../src/gdb/GdbSessionManager.js";
import { evidenceSchema } from "../../../src/domain/evidence.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { stopOwnedDebuggerProcess } from "../../../src/process/ownedDebuggerSession.js";

// These tests launch controlled fake providers; Linux admission is injected so
// lifecycle semantics remain testable on hosts that correctly reject GDB.
const createGdbManagerForInjectedPlatform = (
  options: ConstructorParameters<typeof GdbSessionManager>[0] = {},
): GdbSessionManager =>
  new GdbSessionManager({ platform: "linux", ...options });

let directory: string | undefined;
const managers: Array<{ closeAll(): Promise<void> }> = [];

const expectOwnedProcessExited = async (pidText: string): Promise<void> => {
  const pid = Number(pidText);
  expect(Number.isInteger(pid)).toBe(true);
  await expect
    .poll(() => {
      try {
        if (process.platform === "linux") {
          const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
          const state = stat.slice(
            stat.lastIndexOf(")") + 2,
            stat.lastIndexOf(")") + 3,
          );
          if (state === "Z") return false;
        }
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
};

it("keeps persistent GDB sessions unavailable on Windows", async () => {
  const gdb = await createGdbManagerForInjectedPlatform({
    environment: { REA_GDB_COMMAND: "/missing/gdb" },
    platform: "win32",
  }).start();

  expect(gdb.ok).toBe(false);
  if (!gdb.ok) {
    expect(gdb.error._tag).toBe("AnalysisCapabilityUnavailableError");
    expect(gdb.error.message).toContain("Job Object");
  }
});

it.skipIf(process.platform === "win32")(
  "spawns GDB from the provider environment snapshot",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-environment-snapshot-"));
    const selectedDirectory = join(directory, "selected-bin");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(selectedDirectory),
    );
    const selectedPath = [selectedDirectory, process.env.PATH ?? ""].join(
      delimiter,
    );
    const provider = join(selectedDirectory, "gdb");
    const markerPath = join(directory, "selected-provider-started");
    await writeFile(
      provider,
      `#!${process.execPath}
await import("node:fs/promises").then(({ writeFile }) => writeFile(${JSON.stringify(markerPath)}, "started"));
process.stdout.write("(gdb)\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line);
    if (match) process.stdout.write(match[1] + (line.includes("list-thread-groups") ? "^done,groups=[]\\n" : "^done\\n"));
  }
});
`,
    );
    await chmod(provider, 0o700);
    const suppliedEnvironment: NodeJS.ProcessEnv = { PATH: selectedPath };
    const manager = createGdbManagerForInjectedPlatform({
      environment: suppliedEnvironment,
    });
    managers.push(manager);
    suppliedEnvironment.PATH = join(directory, "mutated-bin");

    const started = await manager.start();
    expect(started.ok, started.ok ? undefined : started.error.message).toBe(
      true,
    );
    await expect(readFile(markerPath, "utf8")).resolves.toBe("started");
    if (started.ok) {
      const closed = await manager.close(started.value.session_id);
      expect(closed.ok).toBe(true);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "classifies an early GDB startup exit as a process failure with diagnostics",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-startup-early-exit-"));
    const provider = join(directory, "fake-gdb-exits-during-config.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
process.stderr.write("GDB startup stderr diagnostic\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line);
    if (match && line.includes("auto-load off")) {
      process.stdout.write("~\\"GDB startup diagnostic\\n\\"\\n");
      process.exit(7);
    }
  }
});
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
      startupTimeoutMs: 1_000,
    });
    managers.push(manager);

    const started = await manager.start();

    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error).toMatchObject({
        _tag: "AnalysisCapabilityUnavailableError",
        operation: "start_gdb_session",
      });
      expect(started.error).not.toMatchObject({ _tag: "AnalysisTimeoutError" });
      expect(JSON.stringify(started.error)).toContain("GDB startup diagnostic");
      expect(started.error.message).toContain("exit code 7, signal null");
      expect(JSON.stringify(started.error)).toContain("process_exit_observed");
      expect(started.error.partialObservation).toMatchObject({
        parameters: {
          command: "-gdb-set auto-load off",
        },
        raw_result: {
          process_exit_code: 7,
          process_exit_observed: true,
          completion_status: "unknown",
        },
      });
      expect(started.error.capturedOutput).toMatchObject({
        stderr: "GDB startup stderr diagnostic\n",
        exit_code: 7,
      });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "verifies inferior state after an automatic-loading rejection before cleanup",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-autoload-reject-"));
    const provider = join(directory, "fake-gdb-autoload-reject.mjs");
    let detachChecked = false;
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line); if (!match) continue;
    if (line.includes("auto-load off")) process.stdout.write("~\\"automatic loading rejected\\n\\"\\n" + match[1] + "^error,msg=\\"unsupported\\"\\n");
    else if (line.includes("list-thread-groups")) process.stdout.write(match[1] + "^done,groups=[]\\n");
  }
});
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
      stopProcess: async (session) => {
        detachChecked = true;
        await session.detachInferior?.();
        return { status: "stopped" };
      },
    });
    managers.push(manager);

    const started = await manager.start();

    expect(started).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCapabilityUnavailableError",
        operation: "start_gdb_session",
      },
    });
    if (!started.ok)
      expect(started.error.partialObservation).toMatchObject({
        predicate_type: "rea.debugger.startup-observation",
        raw_result: {
          records: expect.arrayContaining([
            '~"automatic loading rejected',
            '"',
            '1^error,msg="unsupported"',
          ]),
          completion_status: "unknown",
        },
      });
    expect(detachChecked).toBe(true);
  },
);

it.skipIf(process.platform === "win32")(
  "preserves invalid UTF-8 in startup Evidence when cleanup remains incomplete",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-startup-invalid-utf8-"));
    const provider = join(directory, "fake-gdb-startup-invalid-utf8.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line);
    if (match && line.includes("auto-load off")) {
      const output = Buffer.concat([
        Buffer.from("~startup invalid byte "),
        Buffer.from([0xff]),
        Buffer.from("\\n"),
      ]);
      process.stdout.write(output, () => process.exit(7));
    }
  }
});
`,
    );
    await chmod(provider, 0o700);
    let retainedSessionId: string | undefined;
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
      stopProcess: async (session) => {
        retainedSessionId = session.id;
        return { status: "incomplete", reason: "startup cleanup is retained" };
      },
    });
    managers.push(manager);

    const started = await manager.start();

    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.cleanupIncomplete).toBe(true);
      expect(started.error.partialObservation).toMatchObject({
        normalized_result: { output_invalid_utf8: true },
        raw_result: {
          output_invalid_utf8: true,
          process_exit_observed: true,
        },
        limitations: expect.arrayContaining([
          expect.stringContaining("invalid UTF-8 bytes"),
        ]),
      });
    }
    expect(manager.status(retainedSessionId ?? "")?.mi_invalid_utf8).toBe(true);
  },
);

it.skipIf(process.platform === "win32")(
  "bounds persistent GDB sessions before spawning another process",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-session-limit-"));
    const provider = join(directory, "fake-gdb.mjs");
    const countPath = join(directory, "spawn-count");
    await writeFile(
      provider,
      `#!${process.execPath}
import { appendFile } from "node:fs/promises";
await appendFile(${JSON.stringify(countPath)}, "spawn\\n");
process.stdout.write("(gdb)\\n");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n");
    if (boundary < 0) break;
    const line = input.slice(0, boundary); input = input.slice(boundary + 1);
    const match = /^(\\d+)/.exec(line);
    if (match) process.stdout.write(match[1] + "^done\\n");
  }
});
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
      maxSessions: 1,
    });
    managers.push(manager);

    const started = await manager.start();
    expect(started.ok).toBe(true);
    const overflow = await manager.start();
    expect(overflow).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisResourceConstraintError",
        resource: "memory",
        reportedLimits: {
          max_sessions: 1,
          active_or_reserved_sessions: 1,
        },
      },
    });
    expect(
      (await readFile(countPath, "utf8")).trim().split("\\n"),
    ).toHaveLength(1);
    const cancelled = new AbortController();
    cancelled.abort();
    const cancelledAtCapacity = await manager.start(cancelled.signal);
    expect(cancelledAtCapacity).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
  },
);

it.skipIf(process.platform === "win32")(
  "counts established GDB sessions and in-flight reservations together",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-reservations-"));
    const provider = join(directory, "fake-gdb.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line);
    if (match) process.stdout.write(match[1] + "^done\\n");
  }
});
`,
    );
    await chmod(provider, 0o700);
    let spawnCalls = 0;
    let enterSecondSpawn: (() => void) | undefined;
    let releaseSecondSpawn: (() => void) | undefined;
    const secondSpawnEntered = new Promise<void>((resolve) => {
      enterSecondSpawn = resolve;
    });
    const secondSpawnGate = new Promise<void>((resolve) => {
      releaseSecondSpawn = resolve;
    });
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
      maxSessions: 2,
      spawnProcess: async (options) => {
        spawnCalls += 1;
        if (spawnCalls === 2) {
          enterSecondSpawn?.();
          await secondSpawnGate;
        }
        return spawnOwnedProviderProcess(options);
      },
    });
    managers.push(manager);

    const first = await manager.start();
    expect(first.ok).toBe(true);
    const secondStart = manager.start();
    await secondSpawnEntered;
    const third = await manager.start();
    expect(third).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisResourceConstraintError",
        reportedLimits: {
          max_sessions: 2,
          active_or_reserved_sessions: 2,
        },
      },
    });
    expect(spawnCalls).toBe(2);
    releaseSecondSpawn?.();
    const second = await secondStart;
    expect(second.ok).toBe(true);
  },
);

it.skipIf(process.platform === "win32")(
  "cancels and drains GDB starts before closeAll resolves",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-start-shutdown-"));
    const provider = join(directory, "fake-gdb-blocked.mjs");
    const pidPath = join(directory, "pid");
    const signalPath = join(directory, "signal");
    const releasePath = join(directory, "release");
    await writeFile(
      provider,
      `#!${process.execPath}
import { readFile, writeFile } from "node:fs/promises";
process.on("SIGTERM", async () => {
  await writeFile(${JSON.stringify(signalPath)}, "SIGTERM");
  while (true) {
    try {
      await readFile(${JSON.stringify(releasePath)}, "utf8");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  process.exit(0);
});
await writeFile(${JSON.stringify(pidPath)}, String(process.pid));
process.stdin.resume();
`,
    );
    await chmod(provider, 0o700);
    let enterStop!: () => void;
    const stopEntered = new Promise<void>((resolve) => {
      enterStop = resolve;
    });
    let releaseStop!: () => void;
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
      startupTimeoutMs: 30_000,
      stopProcess: async (session, name, options) => {
        enterStop();
        await stopGate;
        return stopOwnedDebuggerProcess(session, name, options);
      },
    });
    managers.push(manager);

    const starting = manager.start();
    let pidText: string | undefined;
    for (
      let attempt = 0;
      attempt < 100 && pidText === undefined;
      attempt += 1
    ) {
      try {
        pidText = await readFile(pidPath, "utf8");
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    if (pidText === undefined) throw new Error("fake GDB did not start");

    let closeSettled = false;
    const closing = manager.closeAll().then(() => {
      closeSettled = true;
    });
    try {
      await stopEntered;
      expect(closeSettled).toBe(false);
      await writeFile(releasePath, "release");
      releaseStop();
    } finally {
      await writeFile(releasePath, "release");
      releaseStop();
    }
    const started = await starting;
    await closing;
    expect(started.ok).toBe(false);
    if (started.ok) throw new Error("GDB unexpectedly started");
    expect(started.error._tag).toBe("AnalysisCancelledError");
    expect(await readFile(signalPath, "utf8")).toBe("SIGTERM");
    await expectOwnedProcessExited(pidText);
    expect(manager.status("unknown-session")).toBeUndefined();
    await expect(manager.start()).resolves.toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
  },
);

afterEach(async () => {
  await Promise.all(
    managers
      .splice(0)
      .map((manager) => manager.closeAll().catch(() => undefined)),
  );
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it.skipIf(process.platform === "win32")(
  "marks GDB status history truncated when old MI records are discarded",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-history-truncated-"));
    const provider = join(directory, "fake-gdb-history-truncated.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n" + Array.from({ length: 300 }, (_, index) =>
  "=thread-group-added,id=\\"i" + index + "\\"\\n").join(""));
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line);
    if (match) process.stdout.write(match[1] + "^done\\n");
  }
});
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
    });
    managers.push(manager);
    const started = await manager.start();
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    expect(
      manager.status(started.value.session_id)?.recent_mi_records_truncated,
    ).toBe(true);
  },
);

it.skipIf(process.platform === "win32")(
  "returns partial GDB observations with unknown completion on command timeout",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-command-timeout-"));
    const provider = join(directory, "fake-gdb-command-timeout.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
await import("node:fs/promises").then((fs) => fs.writeFile(${JSON.stringify(join(directory ?? "", "pid"))}, String(process.pid)));
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n");
    if (boundary < 0) break;
    const line = input.slice(0, boundary); input = input.slice(boundary + 1);
    const match = /^(\\d+)/.exec(line);
    if (match && line.includes("auto-load off")) process.stdout.write(match[1] + "^done\\n");
    else if (match) process.stdout.write("~\\"partial output\\n\\"\\n");
  }
});
setTimeout(() => process.exit(0), 250).unref();
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
      commandTimeoutMs: 40,
    });
    managers.push(manager);
    const started = await manager.start();
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const result = await manager.execute(
      started.value.session_id,
      "shell sleep 5",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("AnalysisCapabilityUnavailableError");
      expect(result.error.partialObservation).toMatchObject({
        operation: "gdb_console",
        normalized_result: {
          completion_status: "unknown",
          records: ['~"partial output', '"'],
        },
      });
      expect(result.error.cleanupIncomplete).toBe(true);
    }
    await expectOwnedProcessExited(
      await readFile(join(directory, "pid"), "utf8"),
    );
    expect(manager.status(started.value.session_id)?.state).toBe("closed");
  },
);

it.skipIf(process.platform === "win32")(
  "retains timed-out GDB records and cleanup uncertainty when stopping is incomplete",
  async () => {
    directory = await mkdtemp(
      join(tmpdir(), "rea-gdb-timeout-cleanup-incomplete-"),
    );
    const provider = join(directory, "fake-gdb-timeout-cleanup.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line);
    if (!match) continue;
    if (line.includes("auto-load off")) process.stdout.write(match[1] + "^done\\n");
    else process.stdout.write("~\\"partial console record\\n\\"\\n@target partial\\n&log partial\\n");
  }
});
setTimeout(() => process.exit(0), 250);
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
      commandTimeoutMs: 40,
      stopProcess: async () => ({
        status: "incomplete",
        reason: "simulated incomplete stop",
      }),
    });
    managers.push(manager);
    const started = await manager.start();
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const result = await manager.execute(
      started.value.session_id,
      "shell sleep 5",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        _tag: "AnalysisCapabilityUnavailableError",
        cleanup: {
          reason: "simulated incomplete stop",
          resources: [started.value.session_id],
        },
        partialObservation: {
          predicate_type: "rea.debugger.console-observation",
          raw_result: {
            records: [
              '~"partial console record',
              '"',
              "@target partial",
              "&log partial",
            ],
            completion_status: "unknown",
          },
        },
      });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps queued GDB commands serialized when a waiting request is cancelled",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-queue-cancel-"));
    const provider = join(directory, "fake-gdb-queue-cancel.mjs");
    const overlapPath = join(directory, "overlap");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
let input = "";
let firstActive = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n"); if (boundary < 0) break;
    const line = input.slice(0, boundary); input = input.slice(boundary + 1);
    const match = /^(\\d+)/.exec(line); if (!match) continue;
    if (line.includes("auto-load off")) process.stdout.write(match[1] + "^done\\n");
    else if (line.includes("first")) {
      firstActive = true;
      setTimeout(() => { firstActive = false; process.stdout.write(match[1] + "^done\\n"); }, 100);
    } else {
      if (line.includes("third") && firstActive) import("node:fs/promises").then((fs) => fs.writeFile(${JSON.stringify(overlapPath)}, "overlap"));
      process.stdout.write(match[1] + "^done\\n");
    }
  }
});
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
    });
    managers.push(manager);
    const started = await manager.start();
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const first = manager.execute(started.value.session_id, "first");
    const controller = new AbortController();
    const second = manager.execute(
      started.value.session_id,
      "second",
      controller.signal,
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    controller.abort();
    const third = manager.execute(started.value.session_id, "third");
    expect((await second).ok).toBe(false);
    expect((await first).ok).toBe(true);
    expect((await third).ok).toBe(true);
    await expect(readFile(overlapPath, "utf8")).rejects.toThrow();
  },
);

it.skipIf(process.platform === "win32")(
  "marks GDB exit-fallback output truncated when MI history was bounded",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-exit-truncated-"));
    const provider = join(directory, "fake-gdb-exit-truncated.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n"); if (boundary < 0) break;
    const line = input.slice(0, boundary); input = input.slice(boundary + 1);
    const match = /^(\\d+)/.exec(line); if (!match) continue;
    if (line.includes("auto-load off")) process.stdout.write(match[1] + "^done\\n");
    else {
      process.stdout.write(Array.from({ length: 300 }, (_, index) => "=thread-created,id=\\"" + index + "\\"\\n").join(""));
      process.exit(0);
    }
  }
});
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
    });
    managers.push(manager);
    const started = await manager.start();
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const result = await manager.execute(
      started.value.session_id,
      "info threads",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.partialObservation).toMatchObject({
        normalized_result: {
          process_exit_observed: true,
          output_truncated: false,
          completion_status: "unknown",
          records: expect.arrayContaining([
            expect.stringContaining("thread-created"),
          ]),
        },
      });
      const parsedEvidence = evidenceSchema.safeParse(
        result.error.partialObservation,
      );
      expect(parsedEvidence.success).toBe(true);
      if (parsedEvidence.success) {
        const rawResult = parsedEvidence.data.raw_result;
        expect(rawResult).toMatchObject({ records: expect.any(Array) });
        if (
          typeof rawResult === "object" &&
          rawResult !== null &&
          !Array.isArray(rawResult) &&
          "records" in rawResult
        )
          expect(rawResult.records).toHaveLength(300);
      }
    }
  },
);

it.skipIf(process.platform === "win32")(
  "cancels a running GDB command and retains its closed status",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-command-cancel-"));
    const provider = join(directory, "fake-gdb-command-cancel.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n");
    if (boundary < 0) break;
    const line = input.slice(0, boundary); input = input.slice(boundary + 1);
    const match = /^(\\d+)/.exec(line);
    if (match && line.includes("auto-load off")) process.stdout.write(match[1] + "^done\\n");
    else if (match) process.stdout.write("~\\"partial before cancellation\\n\\"\\n@target before cancellation\\n");
  }
});
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
    });
    managers.push(manager);
    const started = await manager.start();
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const controller = new AbortController();
    const pending = manager.execute(
      started.value.session_id,
      "shell sleep 600",
      controller.signal,
    );
    await expect
      .poll(() => manager.status(started.value.session_id)?.recent_mi_records)
      .toContain("@target before cancellation");
    controller.abort();
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.partialObservation).toMatchObject({
        predicate_type: "rea.debugger.console-observation",
        parameters: { command: "shell sleep 600" },
        raw_result: {
          command: "shell sleep 600",
          records: [
            '~"partial before cancellation',
            '"',
            "@target before cancellation",
          ],
          completion_status: "unknown",
        },
      });
    }
    expect(manager.status(started.value.session_id)?.state).toBe("closed");
  },
);

it.skipIf(process.platform === "win32")(
  "re-reads the configured inferior TTY before detaching after a console alias change",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-tty-readback-"));
    const provider = join(directory, "fake-gdb-tty-readback.mjs");
    const detachPath = join(directory, "detached");
    await writeFile(
      provider,
      `#!${process.execPath}
let tty = "/tmp/selected-tty";
process.stdout.write("(gdb)\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line); if (!match) continue;
    if (line.includes("auto-load off")) process.stdout.write(match[1] + "^done\\n");
    else if (line.includes("inferior-tty-set")) process.stdout.write(match[1] + "^done\\n");
    else if (line.includes("inferior-tty-show")) process.stdout.write(match[1] + "^done,inferior_tty_terminal=\\"" + tty + "\\"\\n");
    else if (line.includes("list-thread-groups")) process.stdout.write(match[1] + "^done,groups=[{id=\\"i1\\"}]\\n");
    else if (line.includes("interpreter-exec")) { tty = "/tmp/changed-by-abbreviated-alias"; process.stdout.write(match[1] + "^done\\n"); }
    else if (line.includes("target-detach")) { import("node:fs/promises").then((fs) => fs.writeFile(${JSON.stringify(detachPath)}, "detached")); process.stdout.write(match[1] + "^done\\n"); }
  }
});
setTimeout(() => process.exit(0), 500);
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
      stopProcess: async () => ({
        status: "incomplete",
        reason: "test cleanup",
      }),
    });
    managers.push(manager);
    const started = await manager.start(undefined, {
      inferiorTty: "/tmp/selected-tty",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const changed = await manager.execute(
      started.value.session_id,
      "inferior-t /tmp/changed-by-abbreviated-alias",
    );
    expect(changed.ok).toBe(true);

    const closed = await manager.close(started.value.session_id);

    expect(closed.ok).toBe(false);
    await expect(readFile(detachPath, "utf8")).rejects.toThrow();
  },
);

it.skipIf(process.platform === "win32")(
  "reports bounded GDB stderr retention in session status",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-diagnostic-limit-"));
    const provider = join(directory, "fake-gdb-diagnostic-limit.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stderr.write("x".repeat(100000));
process.stdout.write("(gdb)\\n");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n");
    if (boundary < 0) break;
    const line = input.slice(0, boundary); input = input.slice(boundary + 1);
    const match = /^(\\d+)/.exec(line);
    if (match) process.stdout.write(match[1] + "^done\\n");
  }
});
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
    });
    managers.push(manager);
    const started = await manager.start();
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    expect(
      manager.status(started.value.session_id)?.diagnostics_truncated,
    ).toBe(true);
  },
);

it.skipIf(process.platform === "win32")(
  "converts a GDB stdin pipe failure into a provider session error",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-stdin-error-"));
    const provider = join(directory, "fake-gdb-stdin-error.mjs");
    const stdinClosed = join(directory, "stdin-closed");
    await writeFile(
      provider,
      `#!${process.execPath}
import { closeSync, writeFileSync } from "node:fs";
process.stdout.write("(gdb)\\n");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n"); if (boundary < 0) break;
    const line = input.slice(0, boundary); input = input.slice(boundary + 1);
    const match = /^(\\d+)/.exec(line);
    if (match && line.includes("auto-load off")) {
      process.stdout.write(match[1] + "^done\\n");
      closeSync(0);
      writeFileSync(${JSON.stringify(stdinClosed)}, "closed");
    }
  }
});
setInterval(() => {}, 1000);
`,
    );
    await chmod(provider, 0o700);
    let ownedLaunch:
      | Awaited<ReturnType<typeof spawnOwnedProviderProcess>>
      | undefined;
    let ownedProcessExit: Promise<void> | undefined;
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
      spawnProcess: async (options) => {
        ownedLaunch = await spawnOwnedProviderProcess(options);
        ownedProcessExit = new Promise<void>((resolve) => {
          const child = ownedLaunch!.process;
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("exit", () => resolve());
        });
        return ownedLaunch;
      },
      stopProcess: async (session, name, options) =>
        session.exited
          ? stopOwnedDebuggerProcess(session, name, options)
          : {
              status: "incomplete",
              reason: "fixture-owned process awaits test teardown",
            },
    });
    managers.push(manager);
    let sessionId: string | undefined;
    let originalError: { cleanupIncomplete: boolean } | undefined;
    try {
      const started = await manager.start();
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      sessionId = started.value.session_id;

      await expect
        .poll(() => readFile(stdinClosed, "utf8").catch(() => undefined))
        .toBe("closed");
      const result = await manager.execute(sessionId, "info files");

      expect(result.ok).toBe(false);
      expect(manager.status(sessionId)?.state).toBe("closed");
      const closed = await manager.close(sessionId);
      expect(closed.ok).toBe(false);
      if (!closed.ok) {
        originalError = closed.error;
        expect(closed.error.cleanupIncomplete).toBe(true);
      }
      expect(manager.status(sessionId)?.state).toBe("closed");
      await expect(manager.closeAll()).rejects.toThrow();
      expect(manager.status(sessionId)?.state).toBe("closed");
    } finally {
      if (ownedLaunch !== undefined) {
        const cleanup = await cleanupOwnedProcessGroup(ownedLaunch.ownership);
        if (!cleanup.cleaned) {
          const child = ownedLaunch.process;
          if (child.exitCode === null && child.signalCode === null)
            child.kill("SIGKILL");
        }
        await ownedProcessExit;
        await expectOwnedProcessExited(String(ownedLaunch.process.pid));
      }
      const retried = await manager.retryCleanupFailures();
      expect(retried.ok).toBe(false);
      if (originalError !== undefined)
        expect(originalError.cleanupIncomplete).toBe(true);
      if (sessionId !== undefined)
        expect(manager.status(sessionId)?.state).toBe("closed");
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps GDB exit-fallback Evidence scoped to the active command",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-gdb-command-exit-scope-"));
    const provider = join(directory, "fake-gdb-command-exit-scope.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n");
    if (boundary < 0) break;
    const line = input.slice(0, boundary); input = input.slice(boundary + 1);
    const match = /^(\\d+)/.exec(line); if (!match) continue;
    if (line.includes("auto-load off")) process.stdout.write(match[1] + "^done\\n");
    else if (line.includes("first command")) process.stdout.write("~first-command-only\\n" + match[1] + "^done\\n");
    else process.stdout.write("~second-command-partial\\n@target-partial\\n@target-tail\\n&log-partial\\n&log-tail\\n~second-command-tail\\n", () => process.exit(7));
  }
});
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
    });
    managers.push(manager);
    const started = await manager.start();
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    expect(
      (await manager.execute(started.value.session_id, "first command")).ok,
    ).toBe(true);
    const exited = await manager.execute(
      started.value.session_id,
      "second command",
    );

    expect(exited.ok).toBe(false);
    if (!exited.ok) {
      expect(exited.error.cleanupIncomplete).toBe(true);
      expect(exited.error.partialObservation).toMatchObject({
        normalized_result: {
          command: "second command",
          mi: "",
          process_exit_observed: true,
          records: [
            "~second-command-partial",
            "@target-partial",
            "@target-tail",
            "&log-partial",
            "&log-tail",
            "~second-command-tail",
          ],
          console: ["~second-command-partial", "~second-command-tail"].join(
            "\n",
          ),
          target: ["@target-partial", "@target-tail"].join("\n"),
          log: ["&log-partial", "&log-tail"].join("\n"),
          output_truncated: false,
          completion_status: "unknown",
        },
      });
      expect(exited.error.partialObservation).toMatchObject({
        parameters: {
          command: "second command",
          session_id: started.value.session_id,
        },
        normalized_result: {
          command: "second command",
          records: [
            "~second-command-partial",
            "@target-partial",
            "@target-tail",
            "&log-partial",
            "&log-tail",
            "~second-command-tail",
          ],
          completion_status: "unknown",
        },
        raw_result: {
          command: "second command",
          records: expect.not.arrayContaining(["~first-command-only"]),
          completion_status: "unknown",
        },
        limitations: expect.arrayContaining([
          expect.stringContaining(
            "only records retained for the active command",
          ),
          expect.stringContaining(
            "The active GDB inferior identity is not established by the debugger session identifier.",
          ),
        ]),
      });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "preserves the GDB cleanup failure when a running command is cancelled",
  async () => {
    directory = await mkdtemp(
      join(tmpdir(), "rea-gdb-cancel-cleanup-failure-"),
    );
    const provider = join(directory, "fake-gdb-cancel-cleanup-failure.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n");
    if (boundary < 0) break;
    const line = input.slice(0, boundary); input = input.slice(boundary + 1);
    const match = /^(\\d+)/.exec(line); if (!match) continue;
    if (line.includes("auto-load off")) process.stdout.write(match[1] + "^done\\n");
  }
});
setTimeout(() => process.exit(0), 250);
`,
    );
    await chmod(provider, 0o700);
    const manager = createGdbManagerForInjectedPlatform({
      environment: { REA_GDB_COMMAND: provider },
      stopProcess: async () => ({
        status: "incomplete",
        reason: "simulated debugger cleanup failure",
      }),
    });
    managers.push(manager);
    const started = await manager.start();
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const controller = new AbortController();
    const execution = manager.execute(
      started.value.session_id,
      "shell sleep 600",
      controller.signal,
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
    controller.abort();

    const cancelled = await execution;

    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) {
      expect(cancelled.error._tag).toBe("AnalysisCancelledError");
      expect(cancelled.error.cleanup?.reason).toContain(
        "simulated debugger cleanup failure",
      );
    }
  },
);
