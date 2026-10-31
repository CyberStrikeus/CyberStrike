import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import {
  XcrunCommandRunner,
  type NativeCommandLauncher,
} from "../../../../src/native/CommandRunner.js";
import { ok } from "../../../../src/domain/result.js";
import { DarwinProcessOwnershipInspectionError } from "../../../../src/process/DarwinProcessRunTokenReader.js";

afterEach(() => vi.unstubAllEnvs());

it.skipIf(process.platform === "win32")(
  "retains an xcrun resolver's failed owner and retries it before resolving again",
  async () => {
    let launches = 0;
    const launcher: NativeCommandLauncher = async (options) => {
      launches += 1;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill: () => true,
      });
      setImmediate(() => {
        child.stdout.end("partial xcrun output");
        child.stderr.end("resolver failed");
        child.exitCode = 1;
        child.emit("exit", 1, null);
        setImmediate(() => child.emit("close", 1, null));
      });
      return {
        process: child,
        ownership: {
          runId: options.runId,
          leaderPid: 43_000 + launches,
          processGroupId: 43_000 + launches,
          expectedParentPid: process.pid,
        },
        cleanup: async () => ({
          cleaned: false,
          reason: "resolver owner remains unverified",
        }),
      };
    };
    const runner = new XcrunCommandRunner({}, undefined, launcher);

    const resolution = await runner.run("file", [], {});

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.error.cleanupOwner).toBeDefined();
    expect(resolution.error.capture).toMatchObject({
      stdout: "partial xcrun output",
      stderr: "resolver failed",
    });
    expect(launches).toBe(1);

    const retry = await runner.run("file", [], {});
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.error.cleanupFailures).toHaveLength(1);
    expect(launches).toBe(1);
  },
);

it.skipIf(process.platform === "win32")(
  "executes native commands with the selected environment snapshot instead of ambient values",
  async () => {
    vi.stubEnv("REA_NATIVE_SELECTED", "ambient");
    vi.stubEnv("REA_NATIVE_AMBIENT", "ambient-only");
    const environment = {
      REA_NATIVE_SELECTED: "selected",
      PATH: "/selected-path",
    };
    const runner = new XcrunCommandRunner(environment, async () =>
      ok({
        invocationPath: process.execPath,
        resolvedPath: process.execPath,
        sha256: "a".repeat(64),
      }),
    );
    environment.REA_NATIVE_SELECTED = "mutated-after-construction";
    const captured = await runner.run(
      "file",
      [
        "-e",
        "process.stdout.write(JSON.stringify({selected:process.env.REA_NATIVE_SELECTED,ambient:process.env.REA_NATIVE_AMBIENT??null,path:process.env.PATH,locale:process.env.LC_ALL}))",
      ],
      {},
    );
    if (!captured.ok) throw captured.error;
    expect(JSON.parse(captured.value.stdout)).toEqual({
      selected: "selected",
      ambient: null,
      path: "/selected-path",
      locale: "C",
    });
  },
);

it.skipIf(process.platform === "win32")(
  "retains and retries every failed native command cleanup owner before launching another command",
  async () => {
    const cleanupCalls = new Map<string, number>();
    let launches = 0;
    const launcher: NativeCommandLauncher = async (options) => {
      const name = options.arguments[0] ?? "unnamed";
      launches += 1;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill: () => true,
      });
      setImmediate(() => {
        child.stdout.end(`partial-${name}`);
        child.stderr.end(`diagnostic-${name}`);
        child.exitCode = 0;
        child.emit("exit", 0, null);
        setImmediate(() => child.emit("close", 0, null));
      });
      return {
        process: child,
        ownership: {
          runId: options.runId,
          leaderPid: 42_000 + launches,
          processGroupId: 42_000 + launches,
          expectedParentPid: process.pid,
        },
        cleanup: async () => {
          const calls = (cleanupCalls.get(name) ?? 0) + 1;
          cleanupCalls.set(name, calls);
          return calls < 3
            ? {
                cleaned: false,
                reason: `${name} cleanup attempt ${String(calls)}`,
              }
            : { cleaned: true, signaled: false };
        },
      };
    };
    const runner = new XcrunCommandRunner(
      {},
      async () =>
        ok({
          invocationPath: process.execPath,
          resolvedPath: process.execPath,
          sha256: "a".repeat(64),
        }),
      launcher,
    );

    const [first, second] = await Promise.all([
      runner.run("file", ["first"], {}),
      runner.run("file", ["second"], {}),
    ]);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) return;
    expect(first.error.capture).toMatchObject({
      stdout: "partial-first",
      stderr: "diagnostic-first",
    });
    expect(first.error.cleanupOwner).toBeDefined();
    expect(second.error.cleanupOwner).toBeDefined();
    expect(cleanupCalls).toEqual(
      new Map([
        ["first", 1],
        ["second", 1],
      ]),
    );

    const blocked = await runner.run("file", ["must-not-launch"], {});
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.cleanupFailures).toHaveLength(2);
    expect(blocked.error.cleanupResources).toEqual(
      expect.arrayContaining([
        first.error.cleanupOwner?.launch.ownership?.runId,
        second.error.cleanupOwner?.launch.ownership?.runId,
      ]),
    );
    expect(launches).toBe(2);

    const cleared = await runner.retryCleanup?.();
    expect(cleared).toEqual([]);
    expect(cleanupCalls).toEqual(
      new Map([
        ["first", 3],
        ["second", 3],
      ]),
    );
  },
);

it.skipIf(process.platform === "win32")(
  "does not accept signal termination as an allowed nonzero exit",
  async () => {
    const sha256 = createHash("sha256")
      .update(await readFile(process.execPath))
      .digest("hex");
    const runner = new XcrunCommandRunner({}, async () =>
      ok({
        invocationPath: process.execPath,
        resolvedPath: process.execPath,
        sha256,
      }),
    );
    const exited = await runner.run("file", ["-e", "process.exit(1)"], {
      acceptNonZero: true,
    });
    expect(exited.ok).toBe(true);
    if (exited.ok) expect(exited.value.exitCode).toBe(1);
    const killed = await runner.run(
      "file",
      ["-e", "process.kill(process.pid, 'SIGTERM')"],
      { acceptNonZero: true },
    );
    expect(killed.ok).toBe(false);
    if (!killed.ok) expect(killed.error.reason).toBe("nonzero-exit");
  },
);

it("keeps the ownership helper prerequisite when xcrun cannot be supervised", async () => {
  const inspection = new DarwinProcessOwnershipInspectionError(
    "macOS process ownership inspection requires the Apple Swift compiler via xcrun",
  );
  const runner = new XcrunCommandRunner({}, undefined, () =>
    Promise.reject(inspection),
  );

  const result = await runner.run("file", [], {});

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.preparationFailure).toBe(inspection);
  expect(result.error).toMatchObject({
    tool: "file",
    reason: "io",
    preparationFailure: inspection,
    detail: inspection.message,
    cause: { tool: "xcrun", detail: inspection.message, cause: inspection },
  });
});
