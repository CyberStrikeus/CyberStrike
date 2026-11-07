import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, expect, it, vi } from "vitest";

import {
  resolveXcrunTool,
  type NativeCommandLauncher,
} from "../../../../src/native/CommandRunner.js";

const realpathState = vi.hoisted(() => ({
  resolve: undefined as ((path: string) => Promise<string>) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: (path: string): Promise<string> => {
      if (realpathState.resolve === undefined)
        throw new Error("realpath fixture was not configured");
      return realpathState.resolve(path);
    },
  };
});

const launcher: NativeCommandLauncher = async (options) => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: () => true,
  });
  setImmediate(() => {
    child.stdout.end("/controlled/native-tool\n");
    child.stderr.end();
    child.exitCode = 0;
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
  });
  return {
    process: child,
    ownership: {
      runId: options.runId,
      leaderPid: 48_100,
      processGroupId: 48_100,
      expectedParentPid: process.pid,
    },
    cleanup: async () => ({ cleaned: true, signaled: false }),
  };
};

afterEach(() => {
  realpathState.resolve = undefined;
});

it("keeps a realpath I/O failure primary when cancellation is observed before rejection", async () => {
  let realpathStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    realpathStarted = resolve;
  });
  let rejectRealpath!: (cause: unknown) => void;
  realpathState.resolve = () =>
    new Promise<string>((_resolve, reject) => {
      rejectRealpath = reject;
      realpathStarted();
    });
  const controller = new AbortController();
  const cancellationReason = { source: "caller", phase: "tool resolution" };
  const pending = resolveXcrunTool("file", {}, controller.signal, launcher);
  await started;
  controller.abort(cancellationReason);
  const ioFailure = Object.assign(new Error("fixture realpath failure"), {
    code: "EACCES",
  });
  rejectRealpath(ioFailure);

  const result = await pending;
  if (result.ok) throw new Error("Expected realpath I/O failure");
  expect(result.error).toMatchObject({
    reason: "io",
    cancellation: { reason: cancellationReason },
  });
  expect(result.error.cause).toBe(ioFailure);
});

it("retains exact cancellation observed after successful tool path resolution", async () => {
  let finishRealpath!: () => void;
  let realpathStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    realpathStarted = resolve;
  });
  realpathState.resolve = () =>
    new Promise<string>((resolve) => {
      finishRealpath = () => resolve("/controlled/physical-tool");
      realpathStarted();
    });
  const controller = new AbortController();
  const cancellationReason = { source: "caller", phase: "tool selection" };
  const pending = resolveXcrunTool("file", {}, controller.signal, launcher);
  await started;
  controller.abort(cancellationReason);
  finishRealpath();

  const result = await pending;
  if (result.ok) throw new Error("Expected selection cancellation");
  expect(result.error).toMatchObject({
    reason: "cancelled",
    cancellation: { reason: cancellationReason },
  });
  expect(result.error.cancellation?.reason).toBe(cancellationReason);
  expect(result.error.cause).toMatchObject({
    reason: "cancelled",
    cause: cancellationReason,
  });
});

it.skipIf(process.platform === "win32")(
  "uses the AbortError cause as the exact tool-hash cancellation fact",
  async () => {
    let finishRealpath!: () => void;
    let realpathStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      realpathStarted = resolve;
    });
    realpathState.resolve = () =>
      new Promise<string>((resolve) => {
        finishRealpath = () => resolve("/dev/zero");
        realpathStarted();
      });
    const controller = new AbortController();
    const cancellationReason = { source: "caller", phase: "tool hash" };
    const pending = resolveXcrunTool("file", {}, controller.signal, launcher);
    await started;
    finishRealpath();
    setImmediate(() => controller.abort(cancellationReason));

    const result = await pending;
    if (result.ok) throw new Error("Expected hash cancellation");
    expect(result.error).toMatchObject({
      reason: "cancelled",
      cancellation: { reason: cancellationReason },
    });
    expect(result.error.cause).toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR",
      cause: cancellationReason,
    });
  },
);
