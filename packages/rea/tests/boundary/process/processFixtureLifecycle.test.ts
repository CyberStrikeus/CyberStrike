import { EventEmitter, once } from "node:events";
import { createServer, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { expect, it, vi } from "vitest";

import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import { createTestProcessRegistry } from "../../support/process/processFixture.js";

const within = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutValue: string,
): Promise<T | string> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

it("bounds a timed-out run when the leader exits but output remains open", async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 123,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => false),
  });
  const processes = createTestProcessRegistry(
    () => child as unknown as ChildProcessWithoutNullStreams,
  );
  const pending = processes.run("fixture", [], { timeoutMs: 100 });
  const outcome = pending.then(
    () => "resolved",
    (error: unknown) => error,
  );
  try {
    child.stdout.write("partial output");
    child.exitCode = 0;
    child.emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(2_101);
    const result = await Promise.race([
      outcome,
      Promise.resolve("still pending"),
    ]);
    expect(result).toBeInstanceOf(Error);
    expect(child.kill).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      message: "Test process exceeded its 100ms deadline",
      cause: { exitCode: 0, signal: null, stdout: "partial output" },
    });
  } finally {
    child.emit("close", 0, null);
    await outcome;
    await processes.shutdown();
    vi.useRealTimers();
  }
});

it("retains an unconfirmed child for shutdown retry after the run deadline", async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 456,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => true),
  });
  const processes = createTestProcessRegistry(
    () => child as unknown as ChildProcessWithoutNullStreams,
  );
  const pending = processes.run("fixture", [], { timeoutMs: 100 });
  const outcome = pending.then(
    () => "resolved",
    (error: unknown) => error,
  );
  try {
    await vi.advanceTimersByTimeAsync(2_101);
    expect(await outcome).toMatchObject({
      message: "Test process exceeded its 100ms deadline",
      cause: { exitCode: null, signal: null },
    });
    const firstShutdown = processes.shutdown().then(
      () => "resolved",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(2_001);
    expect(await firstShutdown).toMatchObject({
      message: "Test child process shutdown failed",
      errors: [
        expect.objectContaining({
          message: "test child process 456 did not exit after SIGKILL",
        }),
        expect.any(Error),
      ],
    });
    child.kill.mockImplementation(() => {
      child.exitCode = 0;
      child.emit("exit", 0, null);
      return true;
    });
    await expect(processes.shutdown()).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledTimes(5);
  } finally {
    child.exitCode = 0;
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    await outcome;
    await processes.shutdown();
    vi.useRealTimers();
  }
});

it("returns normal completion without a timeout and preserves child errors", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 789,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => true),
  });
  const processes = createTestProcessRegistry(
    () => child as unknown as ChildProcessWithoutNullStreams,
  );
  const run = processes.run("fixture", []);
  child.stdout.write("completed");
  child.exitCode = 0;
  child.emit("exit", 0, null);
  child.emit("close", 0, null);
  await expect(run).resolves.toEqual({
    exitCode: 0,
    signal: null,
    stdout: "completed",
    stderr: "",
  });
  await processes.shutdown();

  const failure = new Error("spawn failed");
  child.exitCode = null;
  const failedRun = processes.run("fixture", []);
  child.emit("error", failure);
  child.emit("close", null, null);
  await expect(failedRun).rejects.toBe(failure);
  await processes.shutdown();
});

const releaseDescendant = async (peer: Socket | undefined): Promise<void> => {
  if (peer === undefined) {
    // The child has a finite self-expiry even if it never connects.
    await delay(9_500);
    return;
  }
  if (peer.destroyed) return;
  const acknowledgement = once(peer, "data");
  const closed = once(peer, "close");
  peer.write("stop");
  const result = await within(
    Promise.all([acknowledgement, closed]),
    10_000,
    "still open",
  );
  if (result === "still open") {
    peer.destroy();
    throw new Error("descendant connection did not close");
  }
  expect(String(result[0][0])).toBe("stopping");
};

it("times out when a real descendant holds the exited leader's output open", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected TCP listener");
  let peer: Socket | undefined;
  let descendantPid: number | undefined;
  const connected = new Promise<void>((resolve) => {
    server.once("connection", (socket) => {
      peer = socket;
      socket.once("data", (data: Buffer) => {
        descendantPid = Number(data.toString());
        resolve();
      });
    });
  });
  const descendant = `
    const net = require("node:net");
    const socket = net.connect(Number(process.argv[1]), "127.0.0.1", () => {
      process.stdout.write("descendant output\\n");
      socket.write(String(process.pid));
    });
    socket.on("data", () => socket.write("stopping", () => process.exit(0)));
    setTimeout(() => process.exit(0), 9000);
  `;
  const leader = `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", process.argv[1], process.argv[2]], {
      detached: true, stdio: ["ignore", "inherit", "inherit"],
    });
    child.unref();
  `;
  const processes = createTestProcessRegistry();
  const pending = processes.run(
    process.execPath,
    ["-e", leader, descendant, String(address.port)],
    { timeoutMs: 3000 },
  );
  const outcome = pending.then(
    () => "resolved",
    (error: unknown) => error,
  );
  try {
    await awaitAcknowledgement(connected, outcome, "descendant connection");
    const result = await within(outcome, 7_000, "still pending");
    expect(result).toMatchObject({
      message: "Test process exceeded its 3000ms deadline",
      cause: {
        exitCode: 0,
        signal: null,
        stdout: expect.stringContaining("descendant output"),
      },
    });
    expect(descendantPid).toBeGreaterThan(0);
  } finally {
    try {
      await releaseDescendant(peer);
    } finally {
      await outcome;
      await processes.shutdown();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
}, 17_000);
