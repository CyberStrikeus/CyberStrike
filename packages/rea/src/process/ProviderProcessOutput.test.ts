import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { withVerifierCleanup } from "../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../tests/fixtures/lifecycleAcknowledgement.js";
import {
  ProviderProcessSupervisor,
  type ProcessDiagnosticBudget,
} from "./ProviderProcess.js";
import { redactCapturedTransportCredential } from "./ProviderDiagnosticRedaction.js";

it("retains final stderr between verified exit and output close during stop", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  let cleanupStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    cleanupStarted = resolve;
  });
  const owner = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: true,
    cleanup: async () => {
      producer.emit("exit", 2, null);
      cleanupStarted();
      return { cleaned: true, signaled: false };
    },
  });
  const stopped = owner.stop();
  await withVerifierCleanup(async () => {
    expect(owner.stop()).toBe(stopped);
    await awaitAcknowledgement(started, stopped, "process cleanup");
    // Let cleanup observe exit before delivering the separately acknowledged output.
    await new Promise<void>((resolve) => setImmediate(resolve));
    producer.stderr.end("final launcher diagnostic");
    producer.stdout.end();
    producer.emit("close", 2, null);
    await expect(stopped).resolves.toEqual({ status: "verified-cleanup" });
    expect(owner.snapshot()).toMatchObject({
      stderr: { text: "final launcher diagnostic" },
      exitCode: 2,
    });
    expect(await owner.waitForOutputClose(0)).toBe(true);
  }, [
    () => {
      producer.stderr.end();
      producer.stdout.end();
      if (!owner.observedOutputClose()) producer.emit("close", 2, null);
    },
    async () => {
      await stopped;
    },
    () => owner.dispose(),
    () => producer.stderr.destroy(),
    () => producer.stdout.destroy(),
  ]);
});

it("bounds late output retention and drain without changing verified cleanup", async () => {
  vi.useFakeTimers();
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: Object.assign(new PassThrough(), { unref: vi.fn() }),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const owner = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: true,
    cleanup: async () => {
      producer.emit("exit", 0, null);
      return { cleaned: true, signaled: false };
    },
  });
  const checkpoint = owner.checkpointOutput();
  try {
    const stopped = owner.stop();
    await vi.advanceTimersByTimeAsync(0);
    producer.stderr.write("x".repeat(65537));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(stopped).resolves.toEqual({ status: "verified-cleanup" });
    expect(owner.snapshot()).toMatchObject({
      stderr: { bytes: 65536, observedBytes: 65537 },
      outputIncomplete: true,
      diagnosticTruncated: true,
    });
    expect(owner.snapshotOutputSince(checkpoint).complete).toBe(false);
    expect(producer.stderr.destroyed).toBe(false);
    expect(producer.stderr.unref).toHaveBeenCalledOnce();
    producer.emit("close", 0, null);
    expect(owner.snapshot().outputIncomplete).toBe(true);
  } finally {
    owner.dispose();
    producer.stdout.destroy();
    producer.stderr.destroy();
    vi.useRealTimers();
  }
});

it("retries process cleanup with capture attached until output closes", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => false),
  });
  let fails = true;
  const owner = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: true,
    cleanup: async () => {
      if (fails) return { cleaned: false, reason: "identity unavailable" };
      producer.emit("exit", 0, null);
      return { cleaned: true, signaled: false };
    },
  });
  await expect(owner.stop()).resolves.toMatchObject({ status: "incomplete" });
  producer.stderr.write("retained during retry");
  fails = false;
  const retried = owner.stop();
  await new Promise<void>((resolve) => setImmediate(resolve));
  producer.stderr.end(" and final tail");
  producer.stdout.end();
  producer.emit("close", 0, null);
  await expect(retried).resolves.toEqual({ status: "verified-cleanup" });
  expect(owner.snapshot().stderr.text).toBe(
    "retained during retry and final tail",
  );
});

it("bounds additional retention during held cleanup and across retries", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fails = true;
  const owner = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: true,
    cleanup: async () => {
      if (fails) {
        await held;
        return { cleaned: false, reason: "held ownership inspection failed" };
      }
      producer.stdout.end();
      producer.stderr.end();
      producer.emit("exit", 0, null);
      producer.emit("close", 0, null);
      return { cleaned: true, signaled: false };
    },
  });
  const stopped = owner.stop();
  producer.stderr.write("x".repeat(65537));
  expect(owner.snapshot().stderr).toMatchObject({
    bytes: 65536,
    observedBytes: 65537,
  });
  release();
  await expect(stopped).resolves.toMatchObject({ status: "incomplete" });
  producer.stderr.write("tail");
  fails = false;
  await expect(owner.stop()).resolves.toEqual({ status: "verified-cleanup" });
  expect(owner.snapshot()).toMatchObject({
    stderr: { bytes: 65536, observedBytes: 65541 },
    diagnosticTruncated: true,
  });
});

it("releases borrowed capture as incomplete without killing or destroying streams", async () => {
  const borrowedProcess = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new PassThrough(), { ref: vi.fn(), unref: vi.fn() }),
    stderr: Object.assign(new PassThrough(), { ref: vi.fn(), unref: vi.fn() }),
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => false),
    ref: vi.fn(),
    unref: vi.fn(),
  });
  const borrowed = new ProviderProcessSupervisor({
    process: borrowedProcess,
    ownsProcessLifetime: false,
  });
  await expect(borrowed.stop()).resolves.toEqual({ status: "not-owned" });
  expect(borrowedProcess.kill).not.toHaveBeenCalled();
  for (const handle of [
    borrowedProcess,
    borrowedProcess.stdout,
    borrowedProcess.stderr,
  ]) {
    expect(handle.ref).not.toHaveBeenCalled();
    expect(handle.unref).not.toHaveBeenCalled();
  }
  expect(borrowedProcess.stderr.destroyed).toBe(false);
  expect(borrowed.snapshot().outputIncomplete).toBe(true);
  borrowedProcess.stdout.destroy();
  borrowedProcess.stderr.destroy();
});

it("retains stream failure incompleteness even after output close", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const owner = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: false,
  });
  const checkpoint = owner.checkpointOutput();
  producer.stderr.emit("error", new Error("read failure"));
  producer.emit("close", 1, null);
  expect(await owner.waitForOutputClose(0)).toBe(true);
  expect(owner.snapshot()).toMatchObject({
    outputIncomplete: true,
    diagnosticTruncated: true,
  });
  expect(owner.snapshotOutputSince(checkpoint).complete).toBe(false);
  owner.dispose();
  producer.stdout.destroy();
  producer.stderr.destroy();
});

it("exit does not establish complete output when a producer closes its streams later", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const supervisor = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: false,
  });
  try {
    producer.stdout.write("first");
    producer.emit("exit", 0, null);
    expect(await supervisor.waitForExit(0)).toBe(true);
    expect(await supervisor.waitForOutputClose(0)).toBe(false);
    producer.stdout.end("last");
    producer.stderr.end("diagnostic");
    producer.emit("close", 0, null);
    expect(await supervisor.waitForOutputClose(0)).toBe(true);
    expect(supervisor.snapshot()).toMatchObject({
      stdout: { text: "firstlast" },
      stderr: { text: "diagnostic" },
      exitCode: 0,
    });
  } finally {
    supervisor.dispose();
  }
});

it("reads an observed exit without materializing stream diagnostics", () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const supervisor = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: false,
  });
  try {
    producer.stdout.write("retained-diagnostic");
    const snapshot = vi.spyOn(supervisor, "snapshot");
    expect(supervisor.observedExit()).toBeUndefined();
    producer.emit("exit", null, "SIGKILL");
    expect(supervisor.observedExit()).toEqual({
      code: null,
      signal: "SIGKILL",
    });
    expect(snapshot).not.toHaveBeenCalled();
    expect(supervisor.snapshot()).toMatchObject({
      stdout: { text: "retained-diagnostic" },
      exitCode: null,
      signal: "SIGKILL",
    });
  } finally {
    supervisor.dispose();
  }
});

it("scopes output checkpoints to raw bytes on one supervisor and epoch", () => {
  const first = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const second = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const owner = new ProviderProcessSupervisor(
    { process: first, ownsProcessLifetime: false },
    { maxDiagnosticBytes: 128 },
  );
  const other = new ProviderProcessSupervisor({
    process: second,
    ownsProcessLifetime: false,
  });
  try {
    first.stdout.write(Buffer.from("prior: 🧭\n", "utf8"));
    const checkpoint = owner.checkpointOutput();
    first.stdout.write(Buffer.from("current: é\n", "utf8"));
    first.stderr.write(Buffer.from([0xff, 0x61]));
    const scoped = owner.snapshotOutputSince(checkpoint);
    expect(scoped.complete).toBe(true);
    expect(scoped.snapshot.stdout.text).toBe("current: é\n");
    expect(scoped.snapshot.stdout.bytes).toBe(
      Buffer.byteLength("current: é\n"),
    );
    expect(scoped.snapshot.stderr).toEqual({
      text: "\ufffda",
      bytes: 2,
      observedBytes: 2,
      invalidUtf8: true,
    });
    expect(other.snapshotOutputSince(checkpoint).complete).toBe(false);
    owner.resetOutput();
    expect(owner.snapshotOutputSince(checkpoint).complete).toBe(false);
  } finally {
    owner.dispose();
    other.dispose();
    first.stdout.destroy();
    first.stderr.destroy();
    second.stdout.destroy();
    second.stderr.destroy();
  }
});

it.each<{ budget: ProcessDiagnosticBudget; stderr: string }>([
  { budget: 4, stderr: "" },
  { budget: { stdout: 4, stderr: 4 }, stderr: "wxyz" },
])(
  "distinguishes aggregate and per-stream output budgets: $budget",
  ({ budget, stderr }) => {
    const producer = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: () => false,
    });
    const supervisor = new ProviderProcessSupervisor(
      { process: producer, ownsProcessLifetime: false },
      { maxDiagnosticBytes: budget },
    );
    try {
      const checkpoint = supervisor.checkpointOutput();
      producer.stdout.write("abcd");
      producer.stderr.write("wxyz");
      expect(supervisor.snapshot().stdout).toEqual({
        text: "abcd",
        bytes: 4,
        observedBytes: 4,
      });
      expect(supervisor.snapshot().stderr).toEqual({
        text: stderr,
        bytes: stderr.length,
        observedBytes: 4,
      });
      expect(supervisor.snapshot().diagnosticTruncated === true).toBe(
        stderr === "",
      );
      expect(supervisor.snapshotOutputSince(checkpoint).complete).toBe(
        stderr !== "",
      );
    } finally {
      supervisor.dispose();
      producer.stdout.destroy();
      producer.stderr.destroy();
    }
  },
);

it.each(["stdout", "stderr"] as const)(
  "drains and reports overflowing %s without consuming the other stream's budget",
  (stream) => {
    const producer = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: () => false,
    });
    const events: unknown[] = [];
    const supervisor = new ProviderProcessSupervisor(
      { process: producer, ownsProcessLifetime: false },
      {
        maxDiagnosticBytes: { stdout: 4, stderr: 4 },
        onDiagnostic: (event) => {
          if (event.type === "output") events.push(event);
        },
      },
    );
    const other = stream === "stdout" ? "stderr" : "stdout";
    try {
      producer[stream].write("abcde");
      producer[stream].write("fg");
      producer[other].write("wxyz");
      expect(supervisor.snapshot()).toMatchObject({
        diagnosticTruncated: true,
        [stream]: { text: "abcd", bytes: 4, observedBytes: 7 },
        [other]: { text: "wxyz", bytes: 4, observedBytes: 4 },
      });
      expect(events).toEqual([
        { type: "output", stream, bytes: 5, totalBytes: 5, truncated: true },
        { type: "output", stream, bytes: 2, totalBytes: 7, truncated: true },
        { type: "output", stream: other, bytes: 4, totalBytes: 4 },
      ]);
    } finally {
      supervisor.dispose();
      producer.stdout.destroy();
      producer.stderr.destroy();
    }
  },
);

it("tightens aggregate retention without replacing or relaxing the original stream caps", () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const supervisor = new ProviderProcessSupervisor(
    { process: producer, ownsProcessLifetime: false },
    { maxDiagnosticBytes: { stdout: 4, stderr: 10 } },
  );
  try {
    producer.stdout.write("abc");
    producer.stderr.write("de");
    supervisor.limitAdditionalOutputBytes(4);
    producer.stdout.write("fgh");
    producer.stderr.write("ijklmn");
    expect(supervisor.snapshot()).toMatchObject({
      diagnosticTruncated: true,
      stdout: { text: "abcf", bytes: 4, observedBytes: 6 },
      stderr: { text: "deijk", bytes: 5, observedBytes: 8 },
    });
    supervisor.limitAdditionalOutputBytes(100);
    producer.stderr.write("op");
    expect(supervisor.snapshot().stderr).toEqual({
      text: "deijk",
      bytes: 5,
      observedBytes: 10,
    });
  } finally {
    supervisor.dispose();
    producer.stdout.destroy();
    producer.stderr.destroy();
  }
});

it.each(["stdout", "stderr"] as const)(
  "retains raw UTF-8 and checkpoint facts while scanning %s markers past its stream cap",
  (stream) => {
    const producer = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: () => false,
    });
    const supervisor = new ProviderProcessSupervisor(
      { process: producer, ownsProcessLifetime: false },
      { maxDiagnosticBytes: { stdout: 4, stderr: 4 }, outputToken: "DONE" },
    );
    try {
      const checkpoint = supervisor.checkpointOutput();
      const bytes = Buffer.from("é🧭 DONE\n");
      producer[stream].write(bytes.subarray(0, 3));
      producer[stream].write(bytes.subarray(3));
      const scoped = supervisor.snapshotOutputSince(checkpoint);
      expect(scoped.complete).toBe(false);
      expect(scoped.snapshot[stream]).toEqual({
        text: "é\ufffd",
        bytes: 4,
        observedBytes: 12,
        invalidUtf8: true,
      });
      expect(scoped.markers).toEqual([
        { stream, offset: 7, line: "é🧭 DONE", truncated: false },
      ]);
    } finally {
      supervisor.dispose();
      producer.stdout.destroy();
      producer.stderr.destroy();
    }
  },
);

it.each(["stdout", "stderr"] as const)(
  "redacts a budget-cut credential in scoped %s after prior output",
  (stream) => {
    const producer = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: () => false,
    });
    const supervisor = new ProviderProcessSupervisor(
      { process: producer, ownsProcessLifetime: false },
      { maxDiagnosticBytes: 40 },
    );
    try {
      producer.stdout.write("p".repeat(32));
      const checkpoint = supervisor.checkpointOutput();
      const token = "private-transport-token";
      producer[stream].write(token);
      const scoped = supervisor.snapshotOutputSince(checkpoint);
      expect(scoped.complete).toBe(false);
      expect(scoped.snapshot.outputIncomplete).toBe(true);
      expect(scoped.snapshot[stream]).toMatchObject({
        bytes: 8,
        observedBytes: Buffer.byteLength(token),
        text: token.slice(0, 8),
      });
      expect(
        redactCapturedTransportCredential(
          scoped.snapshot[stream],
          token,
          "[REDACTED]",
        ),
      ).toBe("[REDACTED]");
    } finally {
      supervisor.dispose();
      producer.stdout.destroy();
      producer.stderr.destroy();
    }
  },
);

it("observes an exit that completed before supervision", () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: 2,
    signalCode: null,
    kill: () => false,
  });
  const supervisor = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: false,
  });
  try {
    expect(supervisor.observedExit()).toEqual({ code: 2, signal: null });
  } finally {
    supervisor.dispose();
  }
});

it("reports a reached process memory limit only when the handle observed one", () => {
  let reached = false;
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  // A live accessor, as on the owned Windows process handle.
  Object.defineProperty(producer, "memoryLimitReached", { get: () => reached });
  const exitSnapshots: unknown[] = [];
  const supervisor = new ProviderProcessSupervisor(
    { process: producer, ownsProcessLifetime: false },
    {
      onDiagnostic: (event) => {
        if (event.type === "exit") exitSnapshots.push(event.snapshot);
      },
    },
  );
  try {
    expect(supervisor.snapshot()).not.toHaveProperty("memoryLimitReached");
    // Owned launchers record the job notification before emitting exit.
    reached = true;
    producer.emit("exit", 3, null);
    expect(supervisor.snapshot()).toMatchObject({
      exitCode: 3,
      memoryLimitReached: true,
    });
    expect(exitSnapshots).toEqual([
      expect.objectContaining({ memoryLimitReached: true }),
    ]);
  } finally {
    supervisor.dispose();
  }
});

it("reports output closure synchronously with the final incomplete-output snapshot", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const events: string[] = [];
  let closeSnapshot: unknown;
  const owner = new ProviderProcessSupervisor(
    { process: producer, ownsProcessLifetime: false },
    {
      onDiagnostic: (event) => {
        if (event.type === "output-close") {
          events.push("output-close");
          closeSnapshot = event.snapshot;
          expect(owner.observedOutputClose()).toBe(true);
        }
        if (event.type === "exit")
          queueMicrotask(() => events.push("exit-callback-microtask"));
      },
    },
  );
  try {
    producer.stdout.emit("error", new Error("output ended unexpectedly"));
    producer.stdout.end();
    producer.stderr.end();
    producer.emit("close", 0, null);
    expect(events).toEqual(["output-close"]);
    expect(closeSnapshot).toMatchObject({ outputIncomplete: true });
    await Promise.resolve();
    expect(events).toEqual(["output-close", "exit-callback-microtask"]);
    await expect(owner.waitForOutputClose(0)).resolves.toBe(true);
  } finally {
    owner.dispose();
    producer.stdout.destroy();
    producer.stderr.destroy();
  }
});

it("does not emit diagnostics after disposal when process close arrives", () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const events: string[] = [];
  const owner = new ProviderProcessSupervisor(
    { process: producer, ownsProcessLifetime: false },
    { onDiagnostic: (event) => events.push(event.type) },
  );
  owner.dispose();
  producer.emit("close", 0, null);
  expect(events).toEqual([]);
  producer.stdout.destroy();
  producer.stderr.destroy();
});

it("emits output-close before queued abort microtasks and promise continuations", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const events: string[] = [];
  let owner!: ProviderProcessSupervisor;
  owner = new ProviderProcessSupervisor(
    { process: producer, ownsProcessLifetime: false },
    {
      onDiagnostic: (event) => {
        if (event.type === "exit")
          queueMicrotask(() => events.push("later-abort-microtask"));
        if (event.type === "output-close") {
          expect(owner.observedOutputClose()).toBe(true);
          events.push("output-close");
        }
      },
    },
  );
  const closeWait = owner.waitForOutputClose();
  producer.stdout.end();
  producer.stderr.end();
  producer.emit("close", 0, null);
  expect(events).toEqual(["output-close"]);
  await closeWait;
  await Promise.resolve();
  expect(events).toEqual(["output-close", "later-abort-microtask"]);
  owner.dispose();
});

it("projects provider output loss as truncated diagnostics without inventing a byte count", () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  Object.defineProperty(producer, "outputIncomplete", { value: true });
  const supervisor = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: false,
  });
  try {
    expect(supervisor.snapshot()).toMatchObject({
      diagnosticTruncated: true,
      outputIncomplete: true,
    });
    expect(supervisor.snapshot()).not.toHaveProperty("discardedOutputBytes");
  } finally {
    supervisor.dispose();
  }
});

it("unreferences process and stream handles when stop reports incomplete cleanup", async () => {
  const unrefProcess = vi.fn();
  const unrefStdin = vi.fn();
  const unrefStdout = vi.fn();
  const unrefStderr = vi.fn();
  const producer = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new PassThrough(), { unref: unrefStdout }),
    stdin: Object.assign(new PassThrough(), { unref: unrefStdin }),
    stderr: Object.assign(new PassThrough(), { unref: unrefStderr }),
    exitCode: null,
    signalCode: null,
    kill: () => false,
    unref: unrefProcess,
  });
  const supervisor = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: true,
    cleanup: async () => ({
      cleaned: false,
      reason: "process table could not be inspected: spawn EPERM",
    }),
  });
  try {
    const result = await supervisor.stop();
    expect(result).toMatchObject({
      status: "incomplete",
      reason: "process table could not be inspected: spawn EPERM",
    });
    expect(unrefProcess).toHaveBeenCalledTimes(1);
    expect(unrefStdin).toHaveBeenCalledTimes(1);
    expect(unrefStdout).toHaveBeenCalledTimes(1);
    expect(unrefStderr).toHaveBeenCalledTimes(1);
  } finally {
    supervisor.dispose();
  }
});

it.each([
  { outcome: "close", timeoutMs: undefined },
  { outcome: "abort", timeoutMs: undefined },
  { outcome: "close", timeoutMs: 5000 },
  { outcome: "abort", timeoutMs: 5000 },
] as const)(
  "releases output wait resources after $outcome with timeout $timeoutMs",
  async ({ outcome, timeoutMs }) => {
    vi.useFakeTimers();
    const producer = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: () => false,
    });
    const owner = new ProviderProcessSupervisor({
      process: producer,
      ownsProcessLifetime: true,
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    let settled = false;
    const pending = owner
      .waitForOutputClose(timeoutMs, controller.signal)
      .then((result) => {
        settled = true;
        return result;
      });
    try {
      await Promise.resolve();
      expect(settled).toBe(false);
      if (outcome === "close") producer.emit("close", 0, null);
      else controller.abort();
      expect(await pending).toBe(outcome === "close");
      expect(vi.getTimerCount()).toBe(0);
      expect(removeListener).toHaveBeenCalledWith(
        "abort",
        expect.any(Function),
      );
    } finally {
      vi.useRealTimers();
      removeListener.mockRestore();
      owner.dispose();
      producer.stdout.destroy();
      producer.stderr.destroy();
    }
  },
);

it("keeps current checkpoint coverage separate from historically dropped output", () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const supervisor = new ProviderProcessSupervisor(
    { process: producer, ownsProcessLifetime: false },
    { maxDiagnosticBytes: 0 },
  );
  try {
    producer.stdout.write("earlier dropped output");
    expect(supervisor.snapshot().diagnosticTruncated).toBe(true);
    const checkpoint = supervisor.checkpointOutput();
    const current = supervisor.snapshotOutputSince(checkpoint);
    expect(current.complete).toBe(true);
    expect(current.snapshot.diagnosticTruncated).not.toBe(true);
    expect(current.snapshot.stdout).toEqual({
      text: "",
      bytes: 0,
      observedBytes: 0,
    });
    producer.stderr.write("current dropped output");
    expect(supervisor.snapshotOutputSince(checkpoint)).toMatchObject({
      complete: false,
      snapshot: { diagnosticTruncated: true },
    });
    expect(supervisor.snapshot().diagnosticTruncated).toBe(true);
  } finally {
    supervisor.dispose();
    producer.stdout.destroy();
    producer.stderr.destroy();
  }
});

it("marks a stop the owner requested before any signal it sends", async () => {
  const producer = () =>
    Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: () => false,
    });
  const external = producer();
  const unowned = new ProviderProcessSupervisor({
    process: external,
    ownsProcessLifetime: true,
    cleanup: async () => ({ cleaned: true, signaled: false }),
  });
  external.emit("exit", null, "SIGKILL");
  expect(unowned.snapshot()).toMatchObject({ signal: "SIGKILL" });
  expect(unowned.snapshot()).not.toHaveProperty("stopRequested");

  const stopped = producer();
  const owner = new ProviderProcessSupervisor({
    process: stopped,
    ownsProcessLifetime: true,
    cleanup: async () => {
      // The owner's group cleanup is the SIGKILL sender here.
      expect(owner.snapshot().stopRequested).toBe(true);
      stopped.emit("exit", null, "SIGKILL");
      stopped.stdout.end();
      stopped.stderr.end();
      stopped.emit("close", null, "SIGKILL");
      return { cleaned: true, signaled: true };
    },
  });
  await owner.stop();
  expect(owner.snapshot()).toMatchObject({
    signal: "SIGKILL",
    stopRequested: true,
  });
});
