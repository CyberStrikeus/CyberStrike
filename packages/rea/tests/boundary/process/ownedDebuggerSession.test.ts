import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn as spawnPty } from "@lydell/node-pty";

import { expect, it, onTestFinished, vi } from "vitest";

import {
  closeOwnedDebuggerSessions,
  stopOwnedDebuggerProcess,
  verifyOwnedInferiorsEnded,
} from "../../../src/process/ownedDebuggerSession.js";
import { ProviderProcessSupervisor } from "../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";

const triggerDescendantOutput = (port: number): void => {
  const socket = connect(port, "127.0.0.1");
  socket.on("error", () => {});
  socket.on("connect", () => socket.end());
};

const createFakeSupervisor = () => ({
  waitForExit: async () => true,
  waitForOutputClose: async () => true,
  limitAdditionalOutputBytes: vi.fn(),
  dispose: vi.fn(),
  unrefOutputStreams: vi.fn(),
});

const startStopProbe = (source: string, pipeInput = false) => {
  const runId = randomUUID();
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    detached: process.platform !== "win32",
    env: { ...process.env, REA_PROCESS_RUN_ID: runId },
    stdio: [pipeInput ? "pipe" : "ignore", "pipe", "pipe"],
  });
  const leaderPid = child.pid;
  if (leaderPid === undefined) throw new Error("Fixture probe did not spawn");
  onTestFinished(async () => {
    const cleanup = await cleanupOwnedProcessGroup({
      runId,
      leaderPid,
      processGroupId: leaderPid,
    });
    expect(cleanup.cleaned, JSON.stringify(cleanup)).toBe(true);
  });
  let output = "";
  const collect = (chunk: Buffer | string): void => {
    output += chunk.toString();
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  return {
    child,
    get output() {
      return output;
    },
  };
};

const waitForProbeLine = (
  child: ReturnType<typeof spawn>,
  initialOutput: string,
  pattern: RegExp,
): Promise<string> =>
  new Promise((resolve, reject) => {
    let output = initialOutput;
    const match = (): string | undefined => pattern.exec(output)?.[0];
    const existing = match();
    if (existing !== undefined) {
      resolve(existing);
      return;
    }
    const timeout = setTimeout(
      () =>
        reject(new Error("probe did not report the expected cleanup state")),
      3_000,
    );
    child.stdout?.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
      const found = match();
      if (found !== undefined) {
        clearTimeout(timeout);
        resolve(found);
      }
    });
    child.once("error", (cause) => {
      clearTimeout(timeout);
      reject(cause);
    });
  });

const startDebuggerWithInferior = (inferiorSource: string) => {
  const debuggerSource = [
    'const { spawn } = require("node:child_process");',
    `spawn(process.execPath, ["-e", ${JSON.stringify(inferiorSource)}], { stdio: "inherit" });`,
    "process.exit(0);",
  ].join("\n");
  const child = spawn(process.execPath, ["-e", debuggerSource], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const supervisor = new ProviderProcessSupervisor({
    process: child,
    ownsProcessLifetime: true,
  });
  let readyOutput = "";
  const inferiorPort = new Promise<number>((resolvePort) => {
    child.stdout?.on("data", (chunk: Buffer | string) => {
      readyOutput += chunk.toString();
      const match = /^ready:(\d+)$/mu.exec(readyOutput);
      if (match !== null) resolvePort(Number(match[1]));
    });
  });
  return { child, supervisor, inferiorPort };
};

it("preserves the session receiver when invoking the provider detach callback", async () => {
  const session = {
    id: "receiver-bound-detach",
    exited: false,
    transport: { verified: true },
    launched: { process: { kill: vi.fn(() => true) } },
    async detachInferior(this: { transport: { verified: boolean } }) {
      expect(this.transport.verified).toBe(true);
      return { status: "no-inferior" } as const;
    },
    supervisor: createFakeSupervisor(),
  };

  await expect(
    stopOwnedDebuggerProcess(session, "GDB", { platform: "linux" }),
  ).resolves.toEqual({ status: "stopped" });
  expect(session.supervisor.limitAdditionalOutputBytes).toHaveBeenCalledWith(
    64 * 1024,
  );
});

it("clears the detach timeout when provider detachment settles immediately", async () => {
  vi.useFakeTimers();
  try {
    const session = {
      id: "immediate-detach",
      exited: false,
      launched: { process: { kill: vi.fn(() => true) } },
      detachInferior: async () => ({ status: "no-inferior" }) as const,
      supervisor: createFakeSupervisor(),
    };

    await expect(
      stopOwnedDebuggerProcess(session, "GDB", { platform: "linux" }),
    ).resolves.toEqual({ status: "stopped" });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("retries provider detachment after a rejected attempt", async () => {
  const detachInferior = vi
    .fn<() => Promise<{ readonly status: "no-inferior" }>>()
    .mockRejectedValueOnce(new Error("detach transport failed"))
    .mockResolvedValueOnce({ status: "no-inferior" });
  const session = {
    id: "retry-rejected-detach",
    exited: false,
    launched: { process: { kill: vi.fn(() => true) } },
    detachInferior,
    supervisor: createFakeSupervisor(),
  };

  await expect(
    stopOwnedDebuggerProcess(session, "GDB", { platform: "linux" }),
  ).resolves.toMatchObject({ status: "incomplete" });
  await expect(
    stopOwnedDebuggerProcess(session, "GDB", { platform: "linux" }),
  ).resolves.toEqual({ status: "stopped" });
  expect(detachInferior).toHaveBeenCalledTimes(2);
});

it("retains ownership after stop until inherited output writers close", async () => {
  let exited = false;
  let outputClosed = false;
  const supervisor = {
    ...createFakeSupervisor(),
    waitForOutputClose: async () => outputClosed,
  };
  const session = {
    id: "stopped-with-open-output",
    get exited() {
      return exited;
    },
    launched: {
      process: {
        kill: vi.fn(() => {
          exited = true;
          return true;
        }),
      },
    },
    detachInferior: async () => ({ status: "no-inferior" }) as const,
    supervisor,
  };

  await expect(
    stopOwnedDebuggerProcess(session, "GDB", { platform: "linux" }),
  ).resolves.toMatchObject({ status: "incomplete", reason: /output streams/i });
  expect(supervisor.unrefOutputStreams).not.toHaveBeenCalled();
  expect(supervisor.dispose).not.toHaveBeenCalled();

  outputClosed = true;
  await expect(
    stopOwnedDebuggerProcess(session, "GDB", { platform: "linux" }),
  ).resolves.toEqual({ status: "already_exited" });
  expect(supervisor.unrefOutputStreams).toHaveBeenCalledOnce();
  expect(supervisor.dispose).toHaveBeenCalledOnce();
});

it("retains process supervision after an incomplete stop and disposes after a retry observes exit", async () => {
  let waits = 0;
  let disposals = 0;
  let outputUnrefs = 0;
  const signals: NodeJS.Signals[] = [];
  const detachInferior = vi
    .fn<
      () => Promise<{
        readonly status: "detached";
        readonly outputSink: "durable";
      }>
    >()
    .mockResolvedValueOnce({ status: "detached", outputSink: "durable" })
    .mockRejectedValue(
      new Error("debugger transport closed during termination"),
    );
  const session = {
    id: "debugger-session",
    exited: false,
    launched: {
      process: {
        kill: (signal: NodeJS.Signals): boolean => {
          signals.push(signal);
          return true;
        },
      },
    },
    detachInferior,
    supervisor: {
      waitForExit: async (): Promise<boolean> => {
        waits += 1;
        return waits === 3;
      },
      limitAdditionalOutputBytes: vi.fn(),
      waitForOutputClose: async (): Promise<boolean> => true,
      dispose: (): void => {
        disposals += 1;
      },
      unrefOutputStreams: (): void => {
        outputUnrefs += 1;
      },
    },
  };

  const first = await stopOwnedDebuggerProcess(session, "GDB", {
    platform: "linux",
  });
  expect(first).toEqual({
    status: "incomplete",
    reason: "Owned GDB process did not exit after direct termination.",
  });
  expect(disposals).toBe(0);
  expect(outputUnrefs).toBe(0);
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);

  const retry = await stopOwnedDebuggerProcess(session, "GDB", {
    platform: "linux",
  });
  expect(retry).toEqual({ status: "stopped" });
  expect(disposals).toBe(1);
  expect(waits).toBe(3);
  expect(detachInferior).toHaveBeenCalledOnce();
});

it("refuses Windows job-backed debugger termination before signaling", async () => {
  const signals: NodeJS.Signals[] = [];
  let outputUnrefs = 0;
  const session = {
    id: "windows-debugger",
    exited: false,
    launched: {
      process: {
        kill: (signal: NodeJS.Signals): boolean => {
          signals.push(signal);
          return true;
        },
      },
    },
    supervisor: {
      waitForExit: async (): Promise<boolean> => false,
      limitAdditionalOutputBytes: vi.fn(),
      waitForOutputClose: async (): Promise<boolean> => false,
      dispose: (): void => {},
      unrefOutputStreams: (): void => {
        outputUnrefs += 1;
      },
    },
  };

  await expect(
    stopOwnedDebuggerProcess(session, "GDB", { platform: "win32" }),
  ).resolves.toEqual({
    status: "incomplete",
    reason:
      "Owned GDB process cannot be stopped safely on Windows because job termination can also terminate its inferior processes.",
  });
  expect(signals).toEqual([]);
  expect(outputUnrefs).toBe(0);
});

it("retains an already-exited Windows session while its job has descendants", async () => {
  let outputUnrefs = 0;
  let disposals = 0;
  const result = await stopOwnedDebuggerProcess(
    {
      id: "windows-already-exited",
      exited: true,
      launched: { process: { kill: () => true } },
      supervisor: {
        waitForExit: async () => false,
        limitAdditionalOutputBytes: vi.fn(),
        waitForOutputClose: async () => false,
        dispose: () => {
          disposals += 1;
        },
        unrefOutputStreams: () => {
          outputUnrefs += 1;
        },
      },
    },
    "GDB",
    { platform: "win32" },
  );

  expect(result).toEqual({
    status: "incomplete",
    reason:
      "Owned GDB process leader exited, but its Windows Job Object still has active descendants or has not reported settlement.",
  });
  expect(disposals).toBe(0);
  expect(outputUnrefs).toBe(0);
});

it("retains an exited POSIX session while descendants still hold its output streams", async () => {
  let outputUnrefs = 0;
  let disposals = 0;
  const result = await stopOwnedDebuggerProcess(
    {
      id: "posix-already-exited-with-descendant",
      exited: true,
      launched: { process: { kill: () => true } },
      supervisor: {
        waitForExit: async () => true,
        limitAdditionalOutputBytes: vi.fn(),
        waitForOutputClose: async () => false,
        dispose: () => {
          disposals += 1;
        },
        unrefOutputStreams: () => {
          outputUnrefs += 1;
        },
      },
    },
    "GDB",
    { platform: "linux" },
  );

  expect(result).toEqual({
    status: "incomplete",
    reason:
      "Owned GDB process leader exited, but inherited output streams are still open or have not reported settlement.",
  });
  expect(disposals).toBe(0);
  expect(outputUnrefs).toBe(0);
});

it.each([
  [
    "POSIX Error",
    "linux",
    new Error("pipe state unknown"),
    /inherited output stream settlement could not be verified: pipe state unknown/,
  ],
  [
    "POSIX non-Error",
    "linux",
    "pipe state unknown",
    /inherited output stream settlement could not be verified: pipe state unknown/,
  ],
  [
    "Windows Error",
    "win32",
    new Error("job state unknown"),
    /Windows Job Object settlement could not be verified: job state unknown/,
  ],
  [
    "Windows non-Error",
    "win32",
    "job state unknown",
    /Windows Job Object settlement could not be verified: job state unknown/,
  ],
] as const)(
  "retains an exited debugger when output settlement throws (%s)",
  async (_label, platform, cause, expectedReason) => {
    let disposals = 0;
    const result = await stopOwnedDebuggerProcess(
      {
        id: "output-settlement-error",
        exited: true,
        launched: { process: { kill: () => true } },
        supervisor: {
          waitForExit: async () => true,
          waitForOutputClose: async () => Promise.reject(cause),
          limitAdditionalOutputBytes: () => {},
          dispose: () => {
            disposals += 1;
          },
          unrefOutputStreams: () => {},
        },
      },
      "GDB",
      { platform },
    );

    expect(result).toMatchObject({
      status: "incomplete",
      reason: expectedReason,
    });
    expect(disposals).toBe(0);
  },
);

it("does not signal an active debugger when its provider cannot detach the inferior", async () => {
  const signals: NodeJS.Signals[] = [];
  const result = await stopOwnedDebuggerProcess(
    {
      id: "missing-detach-capability",
      exited: false,
      launched: { process: { kill: (signal) => (signals.push(signal), true) } },
      supervisor: {
        waitForExit: async () => false,
        waitForOutputClose: async () => false,
        limitAdditionalOutputBytes: () => {},
        dispose: () => {},
        unrefOutputStreams: () => {},
      },
    },
    "GDB",
    { platform: "linux" },
  );

  expect(result).toEqual({
    status: "incomplete",
    reason:
      "Owned GDB inferior detach cannot be verified because the provider has no detach capability.",
  });
  expect(signals).toEqual([]);
});

it("preserves a non-Error provider detach rejection and does not signal the debugger", async () => {
  const signals: NodeJS.Signals[] = [];
  const result = await stopOwnedDebuggerProcess(
    {
      id: "non-error-detach-failure",
      exited: false,
      launched: { process: { kill: (signal) => (signals.push(signal), true) } },
      detachInferior: async () => Promise.reject("detach state unknown"),
      supervisor: {
        waitForExit: async () => false,
        waitForOutputClose: async () => false,
        limitAdditionalOutputBytes: () => {},
        dispose: () => {},
        unrefOutputStreams: () => {},
      },
    },
    "GDB",
    { platform: "linux" },
  );

  expect(result).toEqual({
    status: "incomplete",
    reason:
      "Owned GDB inferior detach could not be verified: detach state unknown",
  });
  expect(signals).toEqual([]);
});

it("does not signal a POSIX debugger when provider detach cannot be verified", async () => {
  const signals: NodeJS.Signals[] = [];
  const result = await stopOwnedDebuggerProcess(
    {
      id: "unverified-detach",
      exited: false,
      launched: { process: { kill: (signal) => (signals.push(signal), true) } },
      detachInferior: async () => {
        throw new Error("MI detach failed");
      },
      supervisor: {
        waitForExit: async () => false,
        limitAdditionalOutputBytes: vi.fn(),
        waitForOutputClose: async () => false,
        dispose: () => {},
        unrefOutputStreams: () => {},
      },
    },
    "GDB",
    { platform: "linux" },
  );

  expect(result).toEqual({
    status: "incomplete",
    reason: "Owned GDB inferior detach could not be verified: MI detach failed",
  });
  expect(signals).toEqual([]);
});

it("retains an exited debugger after provider detach failed", async () => {
  let exited = false;
  let disposals = 0;
  const session = {
    id: "detach-failed-then-exited",
    get exited() {
      return exited;
    },
    launched: { process: { kill: () => true } },
    detachInferior: async () => {
      throw new Error("MI detach failed");
    },
    supervisor: {
      waitForExit: async () => true,
      limitAdditionalOutputBytes: vi.fn(),
      waitForOutputClose: async () => true,
      dispose: () => {
        disposals += 1;
      },
      unrefOutputStreams: () => {},
    },
  };
  const sessions = new Map([[session.id, session]]);

  expect(
    await stopOwnedDebuggerProcess(session, "GDB", { platform: "linux" }),
  ).toEqual({
    status: "incomplete",
    reason: "Owned GDB inferior detach could not be verified: MI detach failed",
  });

  exited = true;
  await expect(
    closeOwnedDebuggerSessions(
      sessions,
      (owned) => stopOwnedDebuggerProcess(owned, "GDB", { platform: "linux" }),
      "GDB",
    ),
  ).rejects.toThrow("One or more owned GDB processes did not stop cleanly");
  expect(sessions.get(session.id)).toBe(session);
  expect(disposals).toBe(0);
});

it("recovers failed detach only after the identified inferior ends and output settles", async () => {
  let exited = false;
  let inferiorEnded = false;
  const supervisor = {
    ...createFakeSupervisor(),
    waitForOutputClose: vi.fn(async () => true),
  };
  const session = {
    id: "failed-detach-recovery",
    get exited() {
      return exited;
    },
    launched: { process: { kill: vi.fn(() => true) } },
    detachInferior: async () => {
      throw new Error("detach failed");
    },
    verifyInferiorsEndedAfterExit: async () => inferiorEnded,
    supervisor,
  };
  const sessions = new Map([[session.id, session]]);
  const stop = (owned: typeof session) =>
    stopOwnedDebuggerProcess(owned, "GDB", { platform: "linux" });
  expect(await stop(session)).toMatchObject({ status: "incomplete" });
  exited = true;
  expect(await stop(session)).toMatchObject({ status: "incomplete" });
  expect(supervisor.waitForOutputClose).not.toHaveBeenCalled();
  expect(session.launched.process.kill).not.toHaveBeenCalled();
  inferiorEnded = true;
  await closeOwnedDebuggerSessions(sessions, stop, "GDB");
  expect(supervisor.waitForOutputClose).toHaveBeenCalledOnce();
  expect(supervisor.dispose).toHaveBeenCalledOnce();
  expect(sessions.size).toBe(0);
});

it.each([
  { observed: "100", ended: false },
  { observed: "200", ended: true },
  { observed: null, ended: true },
])(
  "compares captured inferior identity with $observed",
  async ({ observed, ended }) => {
    expect(
      await verifyOwnedInferiorsEnded(
        [{ pid: "123", startTime: "100" }],
        async () => observed,
      ),
    ).toBe(ended);
  },
);

it("preserves unknown identity reads and rejects empty proof", async () => {
  const read = vi.fn(async () => {
    throw new Error("identity unreadable");
  });
  await expect(
    verifyOwnedInferiorsEnded([{ pid: "123", startTime: "100" }], read),
  ).rejects.toThrow("identity unreadable");
  read.mockClear();
  expect(await verifyOwnedInferiorsEnded([], read)).toBe(false);
  expect(read).not.toHaveBeenCalled();
});

it("allows closing when the provider confirms no inferior is attached", async () => {
  const signals: NodeJS.Signals[] = [];
  const result = await stopOwnedDebuggerProcess(
    {
      id: "no-inferior",
      exited: false,
      launched: { process: { kill: (signal) => (signals.push(signal), true) } },
      detachInferior: async () => ({ status: "no-inferior" }),
      supervisor: {
        waitForExit: async () => true,
        limitAdditionalOutputBytes: vi.fn(),
        waitForOutputClose: async () => true,
        dispose: () => {},
        unrefOutputStreams: () => {},
      },
    },
    "GDB",
    { platform: "linux" },
  );

  expect(result).toEqual({ status: "stopped" });
  expect(signals).toEqual(["SIGTERM"]);
});

it("fails closed when detach lacks durable output sink confirmation", async () => {
  const signals: NodeJS.Signals[] = [];
  const result = await stopOwnedDebuggerProcess(
    {
      id: "non-durable-sink",
      exited: false,
      launched: { process: { kill: (signal) => (signals.push(signal), true) } },
      detachInferior: async () => ({ status: "detached" }) as never,
      supervisor: {
        waitForExit: async () => true,
        limitAdditionalOutputBytes: vi.fn(),
        waitForOutputClose: async () => false,
        dispose: () => {},
        unrefOutputStreams: () => {},
      },
    },
    "GDB",
    { platform: "linux" },
  );

  expect(result).toEqual({
    status: "incomplete",
    reason:
      "Owned GDB provider did not confirm no inferior or detachment with a durable output sink.",
  });
  expect(signals).toEqual([]);
});

it("retains an owned debugger when inferior detach does not settle", async () => {
  vi.useFakeTimers();
  const signals: NodeJS.Signals[] = [];
  let detachCalls = 0;
  let resolveDetach!: (value: {
    readonly status: "detached";
    readonly outputSink: "durable";
  }) => void;
  let disposals = 0;
  try {
    const session = {
      id: "detach-timeout",
      exited: false,
      launched: {
        process: {
          kill: (signal: NodeJS.Signals) => (signals.push(signal), true),
        },
      },
      detachInferior: () => {
        detachCalls += 1;
        return new Promise<{
          readonly status: "detached";
          readonly outputSink: "durable";
        }>((resolve) => {
          resolveDetach = resolve;
        });
      },
      supervisor: {
        waitForExit: async () => true,
        limitAdditionalOutputBytes: vi.fn(),
        waitForOutputClose: async () => true,
        dispose: () => {
          disposals += 1;
        },
        unrefOutputStreams: () => {},
      },
    };

    const attempt = stopOwnedDebuggerProcess(session, "GDB", {
      platform: "linux",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await attempt).toEqual({
      status: "incomplete",
      reason:
        "Owned GDB inferior detach was not verified within 1000 ms. This release has no runtime override.",
    });
    const retry = stopOwnedDebuggerProcess(session, "GDB", {
      platform: "linux",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await retry).toEqual({
      status: "incomplete",
      reason:
        "Owned GDB inferior detach was not verified within 1000 ms. This release has no runtime override.",
    });
    expect(detachCalls).toBe(1);
    expect(signals).toEqual([]);
    expect(disposals).toBe(0);

    resolveDetach({ status: "detached", outputSink: "durable" });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      await stopOwnedDebuggerProcess(session, "GDB", { platform: "linux" }),
    ).toEqual({ status: "stopped" });
    expect(detachCalls).toBe(1);
    expect(signals).toEqual(["SIGTERM"]);
    expect(disposals).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

it("retains an exited session while a timed-out detach attempt is still pending", async () => {
  vi.useFakeTimers();
  let exited = false;
  let resolveDetach!: (value: { readonly status: "no-inferior" }) => void;
  let detachCalls = 0;
  const session = {
    id: "exited-with-pending-detach",
    get exited() {
      return exited;
    },
    launched: { process: { kill: () => true } },
    detachInferior: () => {
      detachCalls += 1;
      return new Promise<{ readonly status: "no-inferior" }>((resolve) => {
        resolveDetach = resolve;
      });
    },
    supervisor: {
      waitForExit: async () => true,
      limitAdditionalOutputBytes: vi.fn(),
      waitForOutputClose: async () => true,
      dispose: vi.fn(),
      unrefOutputStreams: vi.fn(),
    },
  };
  const sessions = new Map([[session.id, session]]);

  try {
    const attempt = stopOwnedDebuggerProcess(session, "GDB", {
      platform: "linux",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await attempt).toMatchObject({ status: "incomplete" });

    exited = true;
    await expect(
      closeOwnedDebuggerSessions(
        sessions,
        (owned) =>
          stopOwnedDebuggerProcess(owned, "GDB", { platform: "linux" }),
        "GDB",
      ),
    ).rejects.toThrow("One or more owned GDB processes did not stop cleanly");
    expect(sessions.get(session.id)).toBe(session);
    expect(session.supervisor.dispose).not.toHaveBeenCalled();
    expect(detachCalls).toBe(1);

    resolveDetach({ status: "no-inferior" });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await expect(
      closeOwnedDebuggerSessions(
        sessions,
        (owned) =>
          stopOwnedDebuggerProcess(owned, "GDB", { platform: "linux" }),
        "GDB",
      ),
    ).resolves.toBeUndefined();
    expect(sessions.size).toBe(0);
    expect(session.supervisor.dispose).toHaveBeenCalledTimes(1);
    expect(detachCalls).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

it("requires the Windows Job Object to close before releasing an exited session", async () => {
  let closeWaits = 0;
  let disposals = 0;
  const session = {
    id: "windows-job-settlement",
    exited: true,
    launched: { process: { kill: () => true } },
    supervisor: {
      waitForExit: async () => true,
      limitAdditionalOutputBytes: vi.fn(),
      waitForOutputClose: async () => ++closeWaits > 1,
      dispose: () => {
        disposals += 1;
      },
      unrefOutputStreams: () => {},
    },
  };

  expect(
    await stopOwnedDebuggerProcess(session, "GDB", { platform: "win32" }),
  ).toMatchObject({ status: "incomplete" });
  expect(disposals).toBe(0);
  expect(
    await stopOwnedDebuggerProcess(session, "GDB", { platform: "win32" }),
  ).toEqual({ status: "already_exited" });
  expect(closeWaits).toBe(2);
  expect(disposals).toBe(1);
});

it("disposes supervision when a process had already exited", async () => {
  let disposals = 0;
  const lifecycle: string[] = [];
  let outputUnrefs = 0;
  const result = await stopOwnedDebuggerProcess(
    {
      id: "already-exited",
      exited: true,
      launched: { process: { kill: () => true } },
      supervisor: {
        waitForExit: async () => false,
        limitAdditionalOutputBytes: vi.fn(),
        waitForOutputClose: async () => true,
        dispose: () => {
          lifecycle.push("dispose");
          disposals += 1;
        },
        unrefOutputStreams: () => {
          lifecycle.push("unref");
          outputUnrefs += 1;
        },
      },
    },
    "GDB",
    { platform: "linux" },
  );

  expect(result).toEqual({ status: "already_exited" });
  expect(disposals).toBe(1);
  expect(outputUnrefs).toBe(1);
  expect(lifecycle).toEqual(["unref", "dispose"]);
});

it("uses the host platform when an exited debugger is stopped without options", async () => {
  let outputCloseWaits = 0;
  let outputUnrefs = 0;
  const result = await stopOwnedDebuggerProcess(
    {
      id: "already-exited-default-platform",
      exited: true,
      launched: { process: { kill: () => true } },
      supervisor: {
        waitForExit: async () => true,
        waitForOutputClose: async (timeoutMs) => {
          expect(timeoutMs).toBe(1_000);
          outputCloseWaits += 1;
          return true;
        },
        limitAdditionalOutputBytes: () => {},
        dispose: () => {},
        unrefOutputStreams: () => {
          outputUnrefs += 1;
        },
      },
    },
    "GDB",
  );

  expect(result).toEqual({ status: "already_exited" });
  expect(outputCloseWaits).toBe(1);
  expect(outputUnrefs).toBe(process.platform === "win32" ? 0 : 1);
});

it.each([
  ["linux", "inherited output stream"],
  ["win32", "Windows Job Object"],
] as const)(
  "retains a non-Error output-settlement failure on %s",
  async (platform, resource) => {
    const result = await stopOwnedDebuggerProcess(
      {
        id: `output-settlement-${platform}`,
        exited: true,
        launched: { process: { kill: () => true } },
        supervisor: {
          waitForExit: async () => true,
          waitForOutputClose: async () => {
            throw "output status unavailable";
          },
          limitAdditionalOutputBytes: () => {},
          dispose: () => {},
          unrefOutputStreams: () => {},
        },
      },
      "GDB",
      { platform },
    );

    expect(result).toEqual({
      status: "incomplete",
      reason: `Owned GDB ${resource} settlement could not be verified: output status unavailable`,
    });
  },
);

it.skipIf(process.platform === "win32")(
  "keeps supervision until a late-writing descendant closes inherited output after leader exit",
  async () => {
    const inferiorSource = [
      'const { createServer } = require("node:net");',
      "const server = createServer((socket) => {",
      '  process.stdout.write("late-stdout-sentinel\\n");',
      '  process.stderr.write("late-stderr-sentinel\\n");',
      "  socket.end();",
      "  setImmediate(() => process.exit(0));",
      "});",
      'server.listen(0, "127.0.0.1", () => process.stdout.write(`ready:${server.address().port}\\n`));',
    ].join("\n");
    const { child, supervisor, inferiorPort } =
      startDebuggerWithInferior(inferiorSource);
    let port: number | undefined;

    try {
      await once(child, "exit");
      const readyPort = await inferiorPort;
      port = readyPort;
      const limitAdditionalOutputBytes =
        supervisor.limitAdditionalOutputBytes.bind(supervisor);
      vi.spyOn(supervisor, "limitAdditionalOutputBytes").mockImplementation(
        (maxBytes) => {
          limitAdditionalOutputBytes(maxBytes);
          triggerDescendantOutput(readyPort);
        },
      );
      const result = await stopOwnedDebuggerProcess(
        {
          id: "leader-exited-with-inferior",
          exited: true,
          launched: { process: child },
          supervisor,
        },
        "GDB",
        { platform: "linux" },
      );

      expect(result).toEqual({ status: "already_exited" });
      expect(supervisor.snapshot().stdout.text).toContain(
        "late-stdout-sentinel",
      );
      expect(supervisor.snapshot().stderr.text).toContain(
        "late-stderr-sentinel",
      );
    } finally {
      if (port !== undefined) triggerDescendantOutput(port);
      supervisor.dispose();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps late debugger output bounded and drained across cleanup retries",
  async () => {
    const inferiorSource = [
      'const { createServer } = require("node:net");',
      "const writePair = (stdout, stderr) => Promise.all([",
      "  new Promise((resolve) => process.stdout.write(stdout, resolve)),",
      "  new Promise((resolve) => process.stderr.write(stderr, resolve)),",
      "]);",
      "let outputCount = 0;",
      "const server = createServer((socket) => {",
      "  outputCount += 1;",
      '  const output = outputCount === 1 ? writePair("a".repeat(40 * 1024), "b".repeat(40 * 1024)) : writePair("c".repeat(40 * 1024), "d".repeat(40 * 1024));',
      "  socket.end();",
      "  if (outputCount === 2) void output.then(() => process.exit(0));",
      "});",
      'server.listen(0, "127.0.0.1", () => process.stdout.write(`ready:${server.address().port}\\n`));',
    ].join("\n");
    const { child, supervisor, inferiorPort } =
      startDebuggerWithInferior(inferiorSource);
    let port: number | undefined;
    const session = {
      id: "leader-exited-retrying-inferior",
      exited: true,
      launched: { process: child },
      supervisor,
    };

    try {
      await once(child, "exit");
      const readyPort = await inferiorPort;
      port = readyPort;
      const initialStdoutBytes = supervisor.snapshot().stdout.observedBytes;
      const limitAdditionalOutputBytes =
        supervisor.limitAdditionalOutputBytes.bind(supervisor);
      vi.spyOn(supervisor, "limitAdditionalOutputBytes").mockImplementation(
        (maxBytes) => {
          limitAdditionalOutputBytes(maxBytes);
          triggerDescendantOutput(readyPort);
        },
      );
      const first = await stopOwnedDebuggerProcess(session, "GDB", {
        platform: "linux",
      });
      expect(first.status).toBe("incomplete");
      expect(supervisor.snapshot().stdout.observedBytes).toBe(
        initialStdoutBytes + 40 * 1024,
      );
      expect(supervisor.snapshot().stderr.observedBytes).toBe(40 * 1024);

      const second = await stopOwnedDebuggerProcess(session, "GDB", {
        platform: "linux",
      });
      expect(second).toEqual({ status: "already_exited" });
      const snapshot = supervisor.snapshot();
      expect(snapshot.stdout.observedBytes).toBe(
        initialStdoutBytes + 80 * 1024,
      );
      expect(snapshot.stderr.observedBytes).toBe(80 * 1024);
      expect(snapshot.stdout.bytes + snapshot.stderr.bytes).toBe(
        initialStdoutBytes + 64 * 1024,
      );
      expect(snapshot.diagnosticTruncated).toBe(true);
    } finally {
      if (port !== undefined) {
        triggerDescendantOutput(port);
        triggerDescendantOutput(port);
      }
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      supervisor.dispose();
    }
  },
);

it("does not escalate when the debugger exits after SIGTERM", async () => {
  const signals: NodeJS.Signals[] = [];
  const lifecycle: string[] = [];
  let disposals = 0;
  const result = await stopOwnedDebuggerProcess(
    {
      id: "graceful-exit",
      exited: false,
      launched: {
        process: {
          kill: (signal: NodeJS.Signals): boolean => {
            signals.push(signal);
            return true;
          },
        },
      },
      detachInferior: async () =>
        ({
          status: "detached",
          outputSink: "durable",
        }) as const,
      supervisor: {
        waitForExit: async () => true,
        limitAdditionalOutputBytes: vi.fn(),
        waitForOutputClose: async () => true,
        dispose: () => {
          lifecycle.push("dispose");
          disposals += 1;
        },
        unrefOutputStreams: () => lifecycle.push("unref"),
      },
    },
    "Rizin",
    { platform: "linux" },
  );

  expect(result).toEqual({ status: "stopped" });
  expect(signals).toEqual(["SIGTERM"]);
  expect(disposals).toBe(1);
  expect(lifecycle).toEqual(["unref", "dispose"]);
});

it("disposes supervision when the debugger exits after SIGKILL", async () => {
  let waits = 0;
  let disposals = 0;
  const lifecycle: string[] = [];
  const signals: NodeJS.Signals[] = [];
  const result = await stopOwnedDebuggerProcess(
    {
      id: "forced-exit",
      exited: false,
      launched: {
        process: {
          kill: (signal: NodeJS.Signals): boolean => {
            signals.push(signal);
            return true;
          },
        },
      },
      detachInferior: async () =>
        ({
          status: "detached",
          outputSink: "durable",
        }) as const,
      supervisor: {
        waitForExit: async () => {
          waits += 1;
          return waits === 2;
        },
        limitAdditionalOutputBytes: vi.fn(),
        waitForOutputClose: async () => true,
        dispose: () => {
          lifecycle.push("dispose");
          disposals += 1;
        },
        unrefOutputStreams: () => lifecycle.push("unref"),
      },
    },
    "Rizin",
    { platform: "linux" },
  );

  expect(result).toEqual({ status: "stopped" });
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(disposals).toBe(1);
  expect(lifecycle).toEqual(["unref", "dispose"]);
});

it.skipIf(process.platform === "win32")(
  "retains the debugger owner while an unknown descendant holds output pipes open",
  async () => {
    const releaseDirectory = await mkdtemp(
      join(tmpdir(), "rea-debugger-output-writer-"),
    );
    const releaseFile = join(releaseDirectory, "release-writer");
    const writerSource = `const{watch}=require("node:fs");const watcher=watch(${JSON.stringify(releaseDirectory)},(_event,name)=>{if(name==="release-writer"){watcher.close();process.exit(0)}});process.stdout.write("writer-ready\\n");`;
    const providerProcessUrl = new URL(
      "../../../dist/process/ProviderProcess.js",
      import.meta.url,
    ).href;
    const debuggerSessionUrl = new URL(
      "../../../dist/process/ownedDebuggerSession.js",
      import.meta.url,
    ).href;
    const debuggerSource = [
      'const { spawn } = require("node:child_process");',
      `spawn(process.execPath, ["-e", ${JSON.stringify(writerSource)}], { stdio: "inherit" });`,
      "process.stdout.write(`debugger=${process.pid}\\n`);",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const probeSource = [
      'import { spawn } from "node:child_process";',
      `import { ProviderProcessSupervisor } from ${JSON.stringify(providerProcessUrl)};`,
      `import { stopOwnedDebuggerProcess } from ${JSON.stringify(debuggerSessionUrl)};`,
      `const child = spawn(process.execPath, ["-e", ${JSON.stringify(debuggerSource)}], { stdio: ["ignore", "pipe", "pipe"] });`,
      "const supervisor = new ProviderProcessSupervisor({ process: child, ownsProcessLifetime: true });",
      "let output = '';",
      "await new Promise((resolve, reject) => {",
      "  const timer = setTimeout(() => reject(new Error('output writer did not become ready')), 2000);",
      "  child.stdout.on('data', (chunk) => {",
      "    output += chunk.toString();",
      "    const debuggerMatch = /^debugger=(\\d+)/mu.exec(output);",
      "    if (debuggerMatch) process.stderr.write(`debugger-pid=${debuggerMatch[1]}\\n`);",
      "    if (output.includes('writer-ready\\n')) { clearTimeout(timer); resolve(); }",
      "  });",
      "  child.once('error', reject);",
      "});",
      "const session = { id: 'debugger', get exited() { return child.exitCode !== null || child.signalCode !== null; }, launched: { process: child }, supervisor };",
      "session.detachInferior = async () => ({ status: 'no-inferior' });",
      "const result = await stopOwnedDebuggerProcess(session, 'GDB', { platform: 'linux' });",
      "process.stdout.write(JSON.stringify({ result }) + '\\n');",
      "await new Promise((resolve) => process.stdin.once('data', () => { process.stdin.destroy(); resolve(); }));",
      "const retried = await stopOwnedDebuggerProcess(session, 'GDB', { platform: 'linux' });",
      "process.stdout.write(JSON.stringify({ retried }) + '\\n');",
    ].join("\n");
    const stopProbe = startStopProbe(probeSource, true);
    const probe = stopProbe.child;
    const probeExit = once(probe, "exit");

    try {
      const incompleteLine = await waitForProbeLine(
        probe,
        stopProbe.output,
        /\{"result":\{"status":"incomplete"/u,
      );
      expect(incompleteLine).toContain('"status":"incomplete"');
      expect(probe.exitCode).toBeNull();
      expect(probe.signalCode).toBeNull();
      expect(stopProbe.output).toContain('"status":"incomplete"');
      await writeFile(releaseFile, "release");
      probe.stdin?.write("retry\n");
      const settledLine = await waitForProbeLine(
        probe,
        stopProbe.output,
        /\{"retried":\{"status":"already_exited"\}\}/u,
      );
      expect(settledLine).toContain('"status":"already_exited"');
      await probeExit;
    } finally {
      await writeFile(releaseFile, "release").catch(() => undefined);
      probe.stdin?.write("retry\n");
      if (probe.exitCode === null && probe.signalCode === null)
        await Promise.race([
          probeExit,
          new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
        ]);
      await rm(releaseDirectory, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "preserves inferior output written to its selected PTY after the REA probe exits",
  async () => {
    const inferiorSource = [
      "process.stdout.write(`inferior-ready=${process.pid}\\n`);",
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", (input) => { if (input.includes("write-after-probe")) { process.stdout.write("stdout-after-probe-sentinel\\n"); process.stderr.write("stderr-after-probe-sentinel\\n"); } });',
      "setTimeout(() => process.exit(0), 5000);",
    ].join("\n");
    const terminal = spawnPty(process.execPath, ["-e", inferiorSource], {
      name: "xterm",
      cols: 100,
      rows: 20,
    });
    const terminalExit = new Promise<void>((resolve) => {
      terminal.onExit(() => resolve());
    });
    let terminalOutput = "";
    terminal.onData((data) => {
      terminalOutput += data;
    });
    let inferiorPid: number | undefined;
    const ready = new Promise<number>((resolve, reject) => {
      let readySubscription: { dispose: () => void } | undefined;
      const timeout = setTimeout(() => {
        readySubscription?.dispose();
        reject(new Error("PTY inferior did not start"));
      }, 2_000);
      const checkReady = (): void => {
        const match = /inferior-ready=(\d+)/u.exec(terminalOutput);
        if (match?.[1] !== undefined) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      };
      readySubscription = terminal.onData(() => {
        checkReady();
        if (/inferior-ready=\d+/u.test(terminalOutput))
          readySubscription?.dispose();
      });
    });
    const providerProcessUrl = new URL(
      "../../../dist/process/ProviderProcess.js",
      import.meta.url,
    ).href;
    const debuggerSessionUrl = new URL(
      "../../../dist/process/ownedDebuggerSession.js",
      import.meta.url,
    ).href;
    const probeSource = [
      'import { spawn } from "node:child_process";',
      `import { ProviderProcessSupervisor } from ${JSON.stringify(providerProcessUrl)};`,
      `import { stopOwnedDebuggerProcess } from ${JSON.stringify(debuggerSessionUrl)};`,
      'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "pipe"] });',
      "process.stdout.write(`debugger-pid=${child.pid}\\n`);",
      "const supervisor = new ProviderProcessSupervisor({ process: child, ownsProcessLifetime: true });",
      "const session = { id: 'debugger-with-selected-pty-inferior', get exited() { return child.exitCode !== null || child.signalCode !== null; }, launched: { process: child }, supervisor, detachInferior: async () => ({ status: 'detached', outputSink: 'durable' }) };",
      "const result = await stopOwnedDebuggerProcess(session, 'GDB', { platform: 'linux' });",
      "process.stdout.write(`probe-result=${JSON.stringify(result)}\\n`);",
    ].join("\n");
    const stopProbe = startStopProbe(probeSource);
    const probe = stopProbe.child;
    const probeExit = once(probe, "exit");

    try {
      inferiorPid = await ready;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("REA probe did not exit")),
          3_000,
        );
        void probeExit.then(() => {
          clearTimeout(timeout);
          resolve();
        }, reject);
      });
      expect(stopProbe.output).toContain('probe-result={"status":"stopped"}');
      expect(() => process.kill(inferiorPid!, 0)).not.toThrow();

      terminal.write("write-after-probe\n");
      await new Promise<void>((resolve, reject) => {
        let subscription: { dispose: () => void } | undefined;
        const timeout = setTimeout(() => {
          subscription?.dispose();
          reject(
            new Error(
              "PTY inferior sentinels were not observed after probe exit",
            ),
          );
        }, 2_000);
        const finish = (): void => {
          subscription?.dispose();
          clearTimeout(timeout);
          resolve();
        };
        const checkOutput = (): void => {
          if (
            terminalOutput.includes("stdout-after-probe-sentinel") &&
            terminalOutput.includes("stderr-after-probe-sentinel")
          )
            finish();
        };
        subscription = terminal.onData(checkOutput);
        checkOutput();
      });
      expect(terminalOutput).toContain("stdout-after-probe-sentinel");
      expect(terminalOutput).toContain("stderr-after-probe-sentinel");
      expect(() => process.kill(inferiorPid!, 0)).not.toThrow();
    } finally {
      terminal.kill("SIGKILL");
      await Promise.race([
        terminalExit,
        new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
  },
);

it("removes stopped sessions and retains incomplete sessions when closing all", async () => {
  const sessions = new Map([
    ["stopped", { id: "stopped" }],
    ["incomplete", { id: "incomplete" }],
  ]);

  await expect(
    closeOwnedDebuggerSessions(
      sessions,
      async (session) =>
        session.id === "incomplete"
          ? { status: "incomplete", reason: "process remains alive" }
          : { status: "stopped" },
      "GDB",
    ),
  ).rejects.toMatchObject({
    errors: [expect.objectContaining({ message: "process remains alive" })],
  });
  expect([...sessions.keys()]).toEqual(["incomplete"]);
});

it("does not remove a replacement session installed under the same key while stopping", async () => {
  const original = { id: "shared-key", generation: "old" };
  const replacement = { id: "shared-key", generation: "new" };
  const sessions = new Map([["shared-key", original]]);
  let finishStop!: (result: { readonly status: "stopped" }) => void;
  const stopping = new Promise<{ readonly status: "stopped" }>((resolve) => {
    finishStop = resolve;
  });

  const closing = closeOwnedDebuggerSessions(
    sessions,
    async () => stopping,
    "GDB",
  );
  await Promise.resolve();
  sessions.set("shared-key", replacement);
  finishStop({ status: "stopped" });
  await closing;

  expect(sessions.get("shared-key")).toBe(replacement);
});

it("closes an empty owned-session collection", async () => {
  const sessions = new Map<string, { id: string }>();
  await expect(
    closeOwnedDebuggerSessions(
      sessions,
      async () => ({ status: "stopped" }),
      "GDB",
    ),
  ).resolves.toBeUndefined();
});

it("settles every stop and retains rejected sessions while removing successful ones", async () => {
  const sessions = new Map([
    ["stopped", { id: "stopped" }],
    ["rejected", { id: "rejected" }],
    ["string-rejected", { id: "string-rejected" }],
    ["incomplete", { id: "incomplete" }],
  ]);
  const calls: string[] = [];

  await expect(
    closeOwnedDebuggerSessions(
      sessions,
      async (session) => {
        calls.push(session.id);
        if (session.id === "rejected") throw new Error("signal failed");
        if (session.id === "string-rejected") throw "string rejection";
        if (session.id === "incomplete")
          return { status: "incomplete", reason: "still alive" };
        return { status: "stopped" };
      },
      "GDB",
    ),
  ).rejects.toMatchObject({
    message: "One or more owned GDB processes did not stop cleanly",
    errors: [
      expect.objectContaining({ message: "signal failed" }),
      expect.objectContaining({ message: "string rejection" }),
      expect.objectContaining({ message: "still alive" }),
    ],
  });

  expect(calls).toHaveLength(4);
  expect([...sessions.keys()]).toEqual([
    "rejected",
    "string-rejected",
    "incomplete",
  ]);
});
