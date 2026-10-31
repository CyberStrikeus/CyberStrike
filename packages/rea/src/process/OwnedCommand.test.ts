import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { expect, it, vi } from "vitest";

import { createDeferred } from "../../tests/fixtures/binarySession.js";
import { OwnedCommandFailure, runOwnedCommand } from "./OwnedCommand.js";
import type { ProcessCleanupResult } from "./ProcessOwnership.js";

class CommandChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => false);
  exitCode: number | null = null;
  readonly signalCode = null;

  constructor(readonly stdin: Writable | null) {
    super();
  }

  complete(): void {
    if (this.exitCode !== null) return;
    this.exitCode = 0;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", 0, null);
    this.emit("close", 0, null);
  }
}

const ownedInput = (input: Writable | null) => {
  const child = new CommandChild(input);
  const ownership = {
    runId: "authored-command-input",
    leaderPid: 41234,
    processGroupId: 41234,
  };
  const cleanup = vi.fn(async (): Promise<ProcessCleanupResult> => {
    input?.destroy();
    child.complete();
    return { cleaned: true, signaled: false };
  });
  return { child, ownership, cleanup };
};

const spawn = {
  command: "authored-command",
  arguments: [],
  runId: "authored-command-input",
};

it("captures synchronous EOF output after supervision and interprets it before cleanup", async () => {
  const stages: string[] = [];
  const input = new Writable({
    final(callback) {
      stages.push("input-final");
      fixture.child.stdout.write("EOF output");
      fixture.child.stderr.write("EOF diagnostic");
      fixture.child.complete();
      callback();
    },
  });
  const fixture = ownedInput(input);
  const cleanup = fixture.cleanup.getMockImplementation()!;
  fixture.cleanup.mockImplementation(async () => {
    stages.push("cleanup");
    return cleanup();
  });
  const snapshot = await runOwnedCommand(
    spawn,
    {
      timeoutMs: null,
      diagnosticBytes: 1024,
      stdin: "closed-pipe",
      observeCompleted: () => stages.push("observed"),
    },
    {
      launcher: async (request) => {
        expect(request.stdin).toBe("pipe");
        expect(input.writableEnded).toBe(false);
        return {
          process: fixture.child,
          ownership: fixture.ownership,
          cleanup: fixture.cleanup,
        };
      },
    },
  );
  expect(snapshot).toMatchObject({
    exitCode: 0,
    stdout: { text: "EOF output" },
    stderr: { text: "EOF diagnostic" },
  });
  expect(stages).toEqual(["input-final", "observed", "cleanup"]);
  expect(fixture.child.kill).not.toHaveBeenCalled();
});

it("waits for delayed input finalization after output closes", async () => {
  const finalizing = createDeferred<void>();
  let finishInput: () => void = () => {};
  const input = new Writable({
    final(callback) {
      finishInput = callback;
      fixture.child.complete();
      finalizing.resolve();
    },
  });
  const fixture = ownedInput(input);
  const observeCompleted = vi.fn();
  const pending = runOwnedCommand(
    spawn,
    {
      timeoutMs: null,
      diagnosticBytes: 1024,
      stdin: "closed-pipe",
      observeCompleted,
    },
    {
      launcher: async () => ({
        process: fixture.child,
        ownership: fixture.ownership,
        cleanup: fixture.cleanup,
      }),
    },
  );
  await finalizing.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(observeCompleted).not.toHaveBeenCalled();
  expect(fixture.cleanup).not.toHaveBeenCalled();
  finishInput();
  await expect(pending).resolves.toMatchObject({ exitCode: 0 });
  expect(observeCompleted).toHaveBeenCalledOnce();
  expect(fixture.cleanup).toHaveBeenCalledOnce();
});

it.each([2_000, null])(
  "cancels delayed input finalization with the opaque caller reason (timeout %s)",
  async (timeoutMs) => {
    const controller = new AbortController();
    const reason = new OwnedCommandFailure("timeout", "opaque caller reason");
    const finalizing = createDeferred<void>();
    const input = new Writable({
      final(_callback) {
        fixture.child.complete();
        finalizing.resolve();
      },
    });
    const fixture = ownedInput(input);
    const observeCompleted = vi.fn();
    const pending = runOwnedCommand(
      spawn,
      {
        timeoutMs,
        diagnosticBytes: 1024,
        stdin: "closed-pipe",
        observeCompleted,
      },
      {
        signal: controller.signal,
        launcher: async () => ({
          process: fixture.child,
          ownership: fixture.ownership,
          cleanup: fixture.cleanup,
        }),
      },
    );
    const rejected = expect(pending).rejects.toMatchObject({
      reason: "cancelled",
      cancellation: { reason },
      cleanupFailure: null,
    });
    await finalizing.promise;
    controller.abort(reason);
    await rejected;
    expect(observeCompleted).not.toHaveBeenCalled();
    expect(fixture.cleanup).toHaveBeenCalledOnce();
    expect(input.destroyed).toBe(true);
    expect(fixture.child.kill).not.toHaveBeenCalled();
  },
);

it.each([undefined, null, new Error("synchronous end failure")])(
  "preserves a synchronous input end rejection as a physical collection failure: %j",
  async (reason) => {
    const input = new Writable();
    vi.spyOn(input, "end").mockImplementation(() => {
      throw reason;
    });
    const fixture = ownedInput(input);
    const failure: unknown = await runOwnedCommand(
      spawn,
      { timeoutMs: null, diagnosticBytes: 1024, stdin: "closed-pipe" },
      {
        launcher: async () => ({
          process: fixture.child,
          ownership: fixture.ownership,
          cleanup: fixture.cleanup,
        }),
      },
    ).catch((cause: unknown) => cause);
    if (!(failure instanceof OwnedCommandFailure)) throw failure;
    expect(failure.reason).toBe("process");
    expect(failure.collectionFailure).toBe(true);
    expect(failure.cause).toBeInstanceOf(OwnedCommandFailure);
    expect(failure.cause).toHaveProperty("cause", reason);
    expect(fixture.cleanup).toHaveBeenCalledOnce();
  },
);

it("keeps an asynchronous input error primary before same-turn cancellation", async () => {
  const controller = new AbortController();
  const inputError = new Error("authored input failure");
  const reason = { request: "abort after physical input error" };
  const input = new Writable({
    final(_callback) {
      setImmediate(() => {
        input.emit("error", inputError);
        controller.abort(reason);
      });
    },
  });
  const fixture = ownedInput(input);
  const failure: unknown = await runOwnedCommand(
    spawn,
    { timeoutMs: null, diagnosticBytes: 1024, stdin: "closed-pipe" },
    {
      signal: controller.signal,
      launcher: async () => ({
        process: fixture.child,
        ownership: fixture.ownership,
        cleanup: fixture.cleanup,
      }),
    },
  ).catch((cause: unknown) => cause);
  if (!(failure instanceof OwnedCommandFailure)) throw failure;
  expect(failure).toMatchObject({
    reason: "process",
    collectionFailure: true,
    processError: inputError,
  });
  expect(failure.cancellation?.reason).toBe(reason);
  expect(failure.cause).toHaveProperty("cause", inputError);
  expect(fixture.cleanup).toHaveBeenCalledOnce();
});

it("collects an asynchronous Writable final callback error before process cleanup", async () => {
  const inputError = new Error("asynchronous final callback failure");
  const input = new Writable({
    final(callback) {
      setImmediate(() => callback(inputError));
    },
  });
  const fixture = ownedInput(input);
  const failure: unknown = await runOwnedCommand(
    spawn,
    { timeoutMs: null, diagnosticBytes: 1024, stdin: "closed-pipe" },
    {
      launcher: async () => ({
        process: fixture.child,
        ownership: fixture.ownership,
        cleanup: fixture.cleanup,
      }),
    },
  ).catch((cause: unknown) => cause);
  if (!(failure instanceof OwnedCommandFailure)) throw failure;
  expect(failure.reason).toBe("process");
  expect(failure.collectionFailure).toBe(true);
  expect(failure.processError).toBe(inputError);
  expect(failure.cause).toHaveProperty("cause", inputError);
  expect(fixture.cleanup).toHaveBeenCalledOnce();
});

it("reports a premature input close as a collection failure", async () => {
  const input = new Writable({
    final(_callback) {
      input.destroy();
    },
  });
  const fixture = ownedInput(input);
  await expect(
    runOwnedCommand(
      spawn,
      { timeoutMs: null, diagnosticBytes: 1024, stdin: "closed-pipe" },
      {
        launcher: async () => ({
          process: fixture.child,
          ownership: fixture.ownership,
          cleanup: fixture.cleanup,
        }),
      },
    ),
  ).rejects.toMatchObject({
    reason: "process",
    collectionFailure: true,
    message:
      "stdin stream failed: closed before writable finalization completed",
    processError: {
      message: "closed before writable finalization completed",
    },
  });
  expect(fixture.cleanup).toHaveBeenCalledOnce();
});

it("keeps late input errors observed through refused cleanup and the exact retry owner", async () => {
  const controller = new AbortController();
  const reason = { request: "abort during final cleanup" };
  const inputError = new Error("late input failure");
  const input = new Writable({
    autoDestroy: false,
    final(callback) {
      callback();
      fixture.child.complete();
    },
  });
  const fixture = ownedInput(input);
  let denied = true;
  fixture.cleanup.mockImplementation(async () => {
    if (denied) {
      input.emit("error", inputError);
      controller.abort(reason);
      return { cleaned: false, reason: "authored input owner still held" };
    }
    input.emit("error", new Error("input error during retry"));
    input.destroy();
    return { cleaned: true, signaled: false };
  });
  let failure: OwnedCommandFailure | undefined;
  try {
    const cause: unknown = await runOwnedCommand(
      spawn,
      { timeoutMs: null, diagnosticBytes: 1024, stdin: "closed-pipe" },
      {
        signal: controller.signal,
        launcher: async () => ({
          process: fixture.child,
          ownership: fixture.ownership,
          cleanup: fixture.cleanup,
        }),
      },
    ).catch((cause: unknown) => cause);
    if (!(cause instanceof OwnedCommandFailure)) throw cause;
    failure = cause;
    expect(failure).toMatchObject({
      reason: "process",
      collectionFailure: true,
      processError: inputError,
      cleanupFailure: "authored input owner still held",
    });
    expect(failure.cancellation?.reason).toBe(reason);
    expect(failure.cleanupOwner?.launch.ownership).toBe(fixture.ownership);
    expect(failure.cleanupOwner?.launch.process.stdin).toBe(input);
    expect(failure.cause).toHaveProperty("cause", inputError);
    denied = false;
    await expect(failure.cleanupOwner?.stop()).resolves.toEqual({
      status: "verified-cleanup",
    });
    expect(fixture.cleanup).toHaveBeenCalledTimes(2);
    expect(input.destroyed).toBe(true);
    expect(fixture.child.kill).not.toHaveBeenCalled();
  } finally {
    denied = false;
    await failure?.cleanupOwner?.stop();
    input.destroy();
  }
});

it("keeps an explicitly selected input pipe open until process cleanup", async () => {
  const stages: string[] = [];
  const input = new Writable();
  const ended = vi.spyOn(input, "end");
  const fixture = ownedInput(input);
  const cleanup = fixture.cleanup.getMockImplementation()!;
  fixture.cleanup.mockImplementation(async () => {
    stages.push("cleanup");
    expect(input.writableEnded).toBe(false);
    expect(input.writableFinished).toBe(false);
    expect(input.destroyed).toBe(false);
    return cleanup();
  });
  const snapshot = await runOwnedCommand(
    spawn,
    {
      timeoutMs: 2_000,
      diagnosticBytes: 1024,
      stdin: "pipe",
      observeCompleted: () => stages.push("observed"),
    },
    {
      launcher: async (request) => {
        expect(request.stdin).toBe("pipe");
        setImmediate(() => {
          stages.push("output");
          fixture.child.stdout.write("open input output");
          fixture.child.stderr.write("open input diagnostic");
          fixture.child.complete();
        });
        return {
          process: fixture.child,
          ownership: fixture.ownership,
          cleanup: fixture.cleanup,
        };
      },
    },
  );
  expect(snapshot).toMatchObject({
    exitCode: 0,
    stdout: { text: "open input output" },
    stderr: { text: "open input diagnostic" },
  });
  expect(stages).toEqual(["output", "observed", "cleanup"]);
  expect(ended).not.toHaveBeenCalled();
  expect(fixture.cleanup).toHaveBeenCalledOnce();
  expect(input.destroyed).toBe(true);
  expect(fixture.child.kill).not.toHaveBeenCalled();
});

it.each([undefined, "pipe"] as const)(
  "leaves stdin untouched without the closed-pipe contract (spawn stdin %s)",
  async (stdin) => {
    const input = new Writable();
    const ended = vi.spyOn(input, "end");
    const fixture = ownedInput(input);
    await runOwnedCommand(
      { ...spawn, ...(stdin === undefined ? {} : { stdin }) },
      { timeoutMs: null, diagnosticBytes: 1024 },
      {
        launcher: async (request) => {
          expect(request.stdin).toBe(stdin);
          setImmediate(() => fixture.child.complete());
          return {
            process: fixture.child,
            ownership: fixture.ownership,
            cleanup: fixture.cleanup,
          };
        },
      },
    );
    expect(ended).not.toHaveBeenCalled();
  },
);
