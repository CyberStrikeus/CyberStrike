import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { access } from "node:fs/promises";

import { expect, it, onTestFinished, vi } from "vitest";

import { ProviderCleanupError } from "../domain/providerCleanupError.js";

const command = vi.hoisted(() => {
  let helperMode: "read" | "identities" = "read";
  let identityAbsent = false;
  let helperSessions: Array<{
    readonly pid: number;
    readonly failed: boolean;
    readonly gate: Promise<void>;
    readonly release: () => void;
  }> = [];
  let expectedHelpers = 1;
  let startedHelpers = 0;
  let failRootRemovals = 0;
  let startedResolve: (() => void) | undefined;
  let started: Promise<void> = Promise.resolve();
  const events: string[] = [];

  const makeGate = () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { gate, release };
  };

  return {
    configure(mode: "read" | "identities", absent = false) {
      helperMode = mode;
      identityAbsent = absent;
      events.length = 0;
      expectedHelpers = 1;
      startedHelpers = 0;
      failRootRemovals = 0;
      const session = makeGate();
      helperSessions = [{ pid: 123, failed: false, ...session }];
      started = new Promise<void>((resolve) => {
        startedResolve = resolve;
      });
    },
    configureMixed() {
      helperMode = "read";
      events.length = 0;
      expectedHelpers = 2;
      startedHelpers = 0;
      failRootRemovals = 1;
      helperSessions = [
        { pid: 123, failed: false, ...makeGate() },
        { pid: 124, failed: true, ...makeGate() },
      ];
      started = new Promise<void>((resolve) => {
        startedResolve = resolve;
      });
    },
    waitUntilStarted() {
      return started;
    },
    release() {
      for (const session of helperSessions) session.release();
    },
    releaseHelper(pid: number) {
      helperSessions.find((session) => session.pid === pid)?.release();
    },
    async remove(path: string) {
      const ownedPath = String(path);
      if (ownedPath.includes("rea-process-token-")) {
        events.push(`root-remove:${ownedPath}`);
        if (failRootRemovals > 0) {
          failRootRemovals -= 1;
          throw new Error("fixture root removal failure");
        }
      }
    },
    get events() {
      return [...events];
    },
    async run(commandPath: string, arguments_: readonly string[]) {
      if (basename(commandPath) === "fixture-swiftc") {
        const outputIndex = arguments_.indexOf("-o");
        const output = arguments_[outputIndex + 1];
        if (output === undefined) throw new Error("Missing helper output path");
        const fs = await import("node:fs/promises");
        await fs.writeFile(output, "fixture helper");
        return { stdout: "", stderr: "", stdoutBytes: 0, stderrBytes: 0 };
      }
      const session = helperSessions[startedHelpers];
      if (session === undefined)
        throw new Error("Unexpected helper invocation");
      startedHelpers += 1;
      events.push(`helper-start:${session.pid}`);
      if (startedHelpers === expectedHelpers) startedResolve?.();
      try {
        await session.gate;
        if (session.failed) throw new Error("fixture helper failure");
        const stdout = JSON.stringify({
          results: [
            helperMode === "read"
              ? { pid: session.pid, state: "readable", run_id: "run" }
              : identityAbsent
                ? {
                    pid: session.pid,
                    state: "absent",
                    identity: null,
                    reason: "not-in-snapshot",
                  }
                : {
                    pid: session.pid,
                    state: "readable",
                    identity: "start:456",
                    lifecycle: "non-zombie",
                    relation: {
                      state: "observed",
                      parent_pid: 1,
                      process_group_id: 123,
                    },
                  },
          ],
        });
        return {
          stdout,
          stderr: "",
          stdoutBytes: Buffer.byteLength(stdout),
          stderrBytes: 0,
        };
      } finally {
        events.push(`helper-finalized:${session.pid}`);
      }
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    rm: async (
      path: Parameters<typeof original.rm>[0],
      options?: Parameters<typeof original.rm>[1],
    ) => {
      const ownedPath = String(path);
      await command.remove(ownedPath);
      return original.rm(path, options);
    },
  };
});

vi.mock("./ExecFileOutput.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./ExecFileOutput.js")>();
  return {
    ...original,
    execFileOutput: (commandPath: string, arguments_: readonly string[]) =>
      command.run(commandPath, arguments_),
  };
});

import { createDarwinProcessRunTokenReader } from "./DarwinProcessRunTokenReader.js";

it("decodes a successful native snapshot absence as a distinct identity fact", async () => {
  command.configure("identities", true);
  const reader = createDarwinProcessRunTokenReader({
    compiler: {
      kind: "swiftc",
      executable: join(tmpdir(), "fixture-swiftc"),
      sdkRoot: tmpdir(),
    },
    environment: {},
  });
  try {
    const operation = reader.identities([
      {
        pid: 123,
        parentPid: 1,
        processGroupId: 123,
        state: "S",
        command: "fixture",
      },
    ]);
    await command.waitUntilStarted();
    command.release();
    await expect(operation).resolves.toEqual(
      new Map([[123, { state: "absent", reason: "not-in-snapshot" }]]),
    );
  } finally {
    command.release();
    await reader.close();
  }
});

it.each(["read", "identities"] as const)(
  "waits for an active helper %s before removing its executable root",
  async (mode) => {
    command.configure(mode);
    const reader = createDarwinProcessRunTokenReader({
      compiler: {
        kind: "swiftc",
        executable: join(tmpdir(), "fixture-swiftc"),
        sdkRoot: tmpdir(),
      },
      environment: {},
    });
    let operation: Promise<unknown> | undefined;
    let closing: Promise<void> | undefined;
    onTestFinished(async () => {
      command.release();
      await Promise.allSettled([operation, closing, reader.close()]);
    });

    operation =
      mode === "read"
        ? reader.read([
            {
              pid: 123,
              parentPid: 1,
              processGroupId: 123,
              state: "S",
              command: "fixture",
            },
          ])
        : reader.identities([
            {
              pid: 123,
              parentPid: 1,
              processGroupId: 123,
              state: "S",
              command: "fixture",
            },
          ]);
    await command.waitUntilStarted();

    let closeSettled = false;
    closing = reader.close().then(() => {
      closeSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const closeWaitedForHelper = !closeSettled;
    command.release();
    const result = await operation;
    await closing;

    expect(closeWaitedForHelper).toBe(true);
    const events = command.events;
    const helperFinalizedAt = events.findIndex((event) =>
      event.startsWith("helper-finalized:"),
    );
    const rootRemovedAt = events.findIndex((event) =>
      event.startsWith("root-remove:"),
    );
    expect(helperFinalizedAt).toBeGreaterThanOrEqual(0);
    expect(rootRemovedAt).toBeGreaterThan(helperFinalizedAt);
    expect(result).toEqual(
      new Map([
        [
          123,
          mode === "read"
            ? { state: "readable", runId: "run" }
            : {
                state: "readable",
                identity: "start:456",
                lifecycle: { state: "observed", lifecycle: "non-zombie" },
                relation: {
                  state: "observed",
                  parentPid: 1,
                  processGroupId: 123,
                },
              },
        ],
      ]),
    );
    await expect(
      mode === "read"
        ? reader.read([
            {
              pid: 123,
              parentPid: 1,
              processGroupId: 123,
              state: "S",
              command: "fixture",
            },
          ])
        : reader.identities([
            {
              pid: 123,
              parentPid: 1,
              processGroupId: 123,
              state: "S",
              command: "fixture",
            },
          ]),
    ).rejects.toThrow("closed");
  },
);

it("drains mixed helper outcomes before cleanup and retries failed root removal", async () => {
  command.configureMixed();
  const reader = createDarwinProcessRunTokenReader({
    compiler: {
      kind: "swiftc",
      executable: join(tmpdir(), "fixture-swiftc"),
      sdkRoot: tmpdir(),
    },
    environment: {},
  });
  const entry = (pid: number) => ({
    pid,
    parentPid: 1,
    processGroupId: pid,
    state: "S",
    command: "fixture",
  });
  let successfulRead: Promise<unknown> | undefined;
  let failedRead: Promise<unknown> | undefined;
  let closing: Promise<void> | undefined;
  onTestFinished(async () => {
    command.release();
    await Promise.allSettled([
      successfulRead,
      failedRead,
      closing,
      reader.close(),
    ]);
  });

  successfulRead = reader.read([entry(123)]);
  failedRead = reader.read([entry(124)]);
  await command.waitUntilStarted();

  closing = reader.close();
  command.releaseHelper(124);
  const failedOutcome = await failedRead.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(failedOutcome).toBeInstanceOf(Error);
  expect(command.events.some((event) => event.startsWith("root-remove:"))).toBe(
    false,
  );

  command.releaseHelper(123);
  await expect(successfulRead).resolves.toEqual(
    new Map([[123, { state: "readable", runId: "run" }]]),
  );
  const closeFailure = await closing.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (!(closeFailure instanceof ProviderCleanupError))
    throw new Error("Expected retained helper-root cleanup failure");
  expect(closeFailure.cleanupIncomplete).toBe(true);
  expect(closeFailure.cleanupResources).toHaveLength(1);
  const [retainedRoot] = closeFailure.cleanupResources;
  if (retainedRoot === undefined)
    throw new Error("Expected retained helper root");
  await expect(access(retainedRoot)).resolves.toBeUndefined();

  const events = command.events;
  const finalHelperAt = Math.max(
    events.indexOf("helper-finalized:123"),
    events.indexOf("helper-finalized:124"),
  );
  const removalEvents = events.filter((event) =>
    event.startsWith("root-remove:"),
  );
  expect(finalHelperAt).toBeGreaterThanOrEqual(0);
  expect(removalEvents).toHaveLength(1);
  expect(events.indexOf(removalEvents[0]!)).toBeGreaterThan(finalHelperAt);

  await reader.close();
  await expect(access(retainedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  expect(closeFailure.cleanupIncomplete).toBe(false);
  expect(
    command.events.filter((event) => event.startsWith("helper-start:")),
  ).toHaveLength(2);
  expect(
    command.events.filter((event) => event.startsWith("root-remove:")),
  ).toHaveLength(2);
  await expect(reader.read([entry(123)])).rejects.toThrow("closed");
});
