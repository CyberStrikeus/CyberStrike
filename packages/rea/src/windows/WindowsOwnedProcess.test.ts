import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";

import type { WindowsNativeAuthority } from "./WindowsNativeLoader.js";
import {
  quoteWindowsProcessArgument,
  WindowsNativeControlUnavailableError,
  WindowsOwnedProcess,
} from "./WindowsOwnedProcess.js";

describe("Windows process argument representation", () => {
  it.each([
    ["", '""'],
    ["plain", '"plain"'],
    ["two words", '"two words"'],
    ['embedded"quote', '"embedded\\"quote"'],
    ["D:\\folder\\", '"D:\\folder\\\\"'],
    ['slash\\"quote', '"slash\\\\\\"quote"'],
  ])("quotes %j without changing its CRT argument", (input, expected) => {
    expect(quoteWindowsProcessArgument(input)).toBe(expected);
  });

  it("rejects NUL before crossing the native boundary", () => {
    expect(() => quoteWindowsProcessArgument("a\0b")).toThrow("NUL");
  });
});

const LIMIT = 704 * 1024 * 1024;
const settledPoll = {
  stdout: Buffer.alloc(0),
  stderr: Buffer.from("allocation failed"),
  stdoutEnded: true,
  stderrEnded: true,
  exitCode: 3,
  activeProcesses: 0,
};

/** Native authority double that records calls and replays exact poll observations. */
const authority = (
  options: {
    readonly jobMemoryLimit?: true;
    readonly polls?: readonly unknown[];
    readonly appliedLimit?: (requested: unknown) => unknown;
    readonly failClose?: () => boolean;
  } = {},
) => {
  const calls: { operation: string; arguments_: readonly unknown[] }[] = [];
  const polls = [...(options.polls ?? [])];
  const native: WindowsNativeAuthority = {
    inspection: {
      abiVersion: 1,
      nodeApiVersion: 8,
      architecture: "x64",
      filesystem: {
        requestedPath: "C:\\probe",
        finalPath: "C:\\probe",
        filesystem: "NTFS",
        volumeSerial: "0".repeat(16),
        fileId: "0".repeat(32),
        size: 0,
        directory: true,
      },
      privateDacl: true,
      privateBridgeDescriptorAccess: true,
      atomicJobAssignment: true,
      killOnOwnerClose: true,
      protocolStdin: true,
      ...(options.jobMemoryLimit === undefined ? {} : { jobMemoryLimit: true }),
    },
    call: (operation, arguments_) => {
      calls.push({ operation, arguments_ });
      if (operation === "process_spawn")
        return {
          pid: 42,
          handle: {},
          jobAssigned: true,
          killOnOwnerClose: true,
          ...(arguments_.length === 6
            ? {
                jobMemoryLimitBytes: (
                  options.appliedLimit ?? ((value) => value)
                )(arguments_[5]),
              }
            : {}),
        };
      if (operation === "process_poll") return polls.shift();
      if (operation === "process_terminate") return true;
      if (operation === "process_close") {
        if (options.failClose?.()) throw new Error("native close failed");
        return null;
      }
      throw new Error(`Unmodeled native operation ${operation}`);
    },
  };
  return { native, calls };
};

const launch = (
  native: WindowsNativeAuthority,
  memoryLimitBytes?: number,
): WindowsOwnedProcess =>
  new WindowsOwnedProcess(
    "C:\\runtime\\bun.exe",
    ["worker.js"],
    "C:\\work",
    {},
    false,
    {
      authority: native,
      ...(memoryLimitBytes === undefined ? {} : { memoryLimitBytes }),
    },
  );

describe("Windows native release retry", () => {
  it("ends output streams and retains ownership for a failed close retry", async () => {
    vi.useFakeTimers();
    let shouldFailClose = true;
    try {
      const { native, calls } = authority({
        polls: [{ ...settledPoll }, { ...settledPoll }],
        failClose: () => shouldFailClose,
      });
      const child = launch(native);
      const failures: string[] = [];
      child.on("error", (error: Error) => failures.push(error.message));
      const closed = new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });

      await vi.advanceTimersByTimeAsync(25);
      expect(child.stdout.writableEnded).toBe(true);
      expect(child.stderr.writableEnded).toBe(true);
      expect(failures).toContain("native close failed");
      expect(calls.some(({ operation }) => operation === "process_close")).toBe(
        true,
      );

      shouldFailClose = false;
      const callsBeforeRetry = calls.length;
      const cleanup = child.cleanup();
      expect(await cleanup).toMatchObject({ cleaned: true, signaled: false });
      await closed;
      expect(
        calls.slice(callsBeforeRetry).map(({ operation }) => operation),
      ).toEqual(["process_close"]);
      expect(child.stdout.writableEnded).toBe(true);
      expect(child.stderr.writableEnded).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Windows Job Object memory limits", () => {
  it("emits close only after descendants leave the Job Object", async () => {
    const { native, calls } = authority({
      polls: [
        {
          ...settledPoll,
          stdoutEnded: false,
          stderrEnded: false,
          activeProcesses: 1,
        },
        settledPoll,
      ],
    });
    const child = launch(native);
    const events: string[] = [];
    child.once("exit", () => events.push("exit"));
    child.once("close", () => events.push("close"));

    await once(child, "close");

    expect(events).toEqual(["exit", "close"]);
    expect(
      calls.filter(({ operation }) => operation === "process_poll"),
    ).toHaveLength(2);
    expect(calls.at(-1)?.operation).toBe("process_close");
  });

  it("refuses a requested limit before launch when the artifact lacks the control", () => {
    const { native, calls } = authority();
    expect(() => launch(native, LIMIT)).toThrow(
      expect.objectContaining({
        constructor: WindowsNativeControlUnavailableError,
        control: "job-memory-limit",
        retryable: false,
        message: expect.stringContaining(
          "does not support Job Object memory limits",
        ),
      }),
    );
    expect(calls).toEqual([]);
  });

  it("refuses protocol stdin before launch when the artifact lacks the control", () => {
    const { native, calls } = authority();
    const earlier = {
      ...native,
      inspection: { ...native.inspection, protocolStdin: false },
    };
    expect(
      () =>
        new WindowsOwnedProcess(
          "C:\\runtime\\bun.exe",
          [],
          undefined,
          {},
          false,
          {
            authority: earlier,
            protocolStdin: true,
          },
        ),
    ).toThrow(
      expect.objectContaining({
        constructor: WindowsNativeControlUnavailableError,
        control: "protocol-stdin",
        message: expect.stringContaining(
          "does not support owned protocol stdin",
        ),
      }),
    );
    expect(calls).toEqual([]);
  });

  it("keeps the unlimited launch shape and rejects limit fields it did not request", async () => {
    const { native, calls } = authority({
      jobMemoryLimit: true,
      polls: [
        { ...settledPoll, memoryLimitReached: true, peakJobMemoryBytes: 1 },
      ],
    });
    const child = launch(native);
    const failure = once(child, "error");
    expect(calls[0]?.arguments_).toHaveLength(4);
    const [error] = await failure;
    expect(error).toBeInstanceOf(Error);
    expect(child.memoryLimitReached).toBe(false);
    expect(child.peakJobMemoryBytes).toBeUndefined();
  });

  it("passes the limit, verifies its read-back and reports a reached limit before exit", async () => {
    const { native, calls } = authority({
      jobMemoryLimit: true,
      polls: [
        {
          ...settledPoll,
          exitCode: null,
          stdoutEnded: false,
          stderrEnded: false,
          activeProcesses: 1,
          memoryLimitReached: false,
          peakJobMemoryBytes: 300 * 1024 * 1024,
        },
        { ...settledPoll, memoryLimitReached: true, peakJobMemoryBytes: LIMIT },
      ],
    });
    const child = launch(native, LIMIT);
    expect(calls[0]?.arguments_.slice(4)).toEqual([false, LIMIT]);
    const closed = once(child, "close");
    const exited = new Promise((resolve) => {
      child.once("exit", (code: number) =>
        resolve({ code, reached: child.memoryLimitReached }),
      );
    });
    expect(await exited).toEqual({ code: 3, reached: true });
    expect(child.peakJobMemoryBytes).toBe(LIMIT);
    await closed;
    expect(calls.at(-1)?.operation).toBe("process_close");
  });

  it("rejects a limited poll that omits the job's notification state", async () => {
    const { native } = authority({
      jobMemoryLimit: true,
      polls: [settledPoll],
    });
    const child = launch(native, LIMIT);
    const [error] = await once(child, "error");
    expect(error).toBeInstanceOf(Error);
    expect(child.memoryLimitReached).toBe(false);
  });

  it("refuses a launch whose applied limit differs from the request", () => {
    const { native } = authority({
      jobMemoryLimit: true,
      appliedLimit: () => LIMIT - 4096,
    });
    expect(() => launch(native, LIMIT)).toThrow();
  });
});

describe("Windows output capture drain", () => {
  it("repolls without the 25ms idle delay while the child keeps producing output", async () => {
    vi.useFakeTimers();
    try {
      const chunk = Buffer.alloc(8192, 0x61);
      const polls: Array<{
        stdout: Buffer;
        stderr: Buffer;
        stdoutEnded: boolean;
        stderrEnded: boolean;
        exitCode: number | null;
        activeProcesses: number;
      }> = Array.from({ length: 10 }, () => ({
        stdout: chunk,
        stderr: Buffer.alloc(0),
        stdoutEnded: false,
        stderrEnded: false,
        exitCode: null,
        activeProcesses: 1,
      }));
      polls.push({ ...settledPoll });
      const { native, calls } = authority({ polls });
      const child = launch(native);
      child.stdout.resume();
      const closed = once(child, "close");
      // 100ms of simulated time: the fixed 25ms poll cadence can complete
      // at most ~4 polls, so all 10 data polls plus the settle poll must
      // still be pending. Draining repolls immediately while data flows.
      await vi.advanceTimersByTimeAsync(100);
      expect(
        calls.filter((call) => call.operation === "process_poll"),
      ).toHaveLength(11);
      await closed;
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the 25ms idle delay after a poll with no output", async () => {
    vi.useFakeTimers();
    try {
      const idle = {
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        stdoutEnded: false,
        stderrEnded: false,
        exitCode: null,
        activeProcesses: 1,
      };
      const { native, calls } = authority({
        polls: [idle, { ...settledPoll }],
      });
      const child = launch(native);
      const closed = once(child, "close");
      const pollCount = () =>
        calls.filter((call) => call.operation === "process_poll").length;
      // The constructor schedules the first poll 25ms out.
      await vi.advanceTimersByTimeAsync(25);
      expect(pollCount()).toBe(1);
      // An idle child must not be repolled early: 10ms of simulated time
      // must not reach the next poll, the remaining 15ms must.
      await vi.advanceTimersByTimeAsync(10);
      expect(pollCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(15);
      expect(pollCount()).toBe(2);
      await closed;
    } finally {
      vi.useRealTimers();
    }
  });

  it("repolls without the 25ms idle delay while only stderr carries output", async () => {
    vi.useFakeTimers();
    try {
      const chunk = Buffer.alloc(4096, 0x62);
      const { native, calls } = authority({
        polls: [
          {
            stdout: Buffer.alloc(0),
            stderr: chunk,
            stdoutEnded: false,
            stderrEnded: false,
            exitCode: null,
            activeProcesses: 1,
          },
          { ...settledPoll },
        ],
      });
      const child = launch(native);
      const closed = once(child, "close");
      const pollCount = () =>
        calls.filter((call) => call.operation === "process_poll").length;
      await vi.advanceTimersByTimeAsync(25);
      expect(pollCount()).toBe(1);
      // stderr-only output still means the child is producing: the next
      // poll must be immediate, not 25ms out.
      await vi.advanceTimersByTimeAsync(1);
      expect(pollCount()).toBe(2);
      await closed;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Windows output backpressure and cleanup", () => {
  it("stops native reads until both paused output consumers drain", async () => {
    vi.useFakeTimers();
    try {
      const chunk = Buffer.alloc(65536, 0x63);
      const { native, calls } = authority({
        polls: [
          {
            stdout: chunk,
            stderr: chunk,
            stdoutEnded: false,
            stderrEnded: false,
            exitCode: null,
            activeProcesses: 1,
          },
          { ...settledPoll, stderr: Buffer.alloc(0) },
        ],
      });
      const child = launch(native);
      const closed = once(child, "close");
      child.stdout.pause();
      child.stderr.pause();
      const pollCount = () =>
        calls.filter((call) => call.operation === "process_poll").length;
      await vi.advanceTimersByTimeAsync(25);
      expect(child.stdout.writableNeedDrain).toBe(true);
      expect(child.stderr.writableNeedDrain).toBe(true);
      await vi.advanceTimersByTimeAsync(5000);
      expect(pollCount()).toBe(1);
      const stdoutDrained = once(child.stdout, "drain");
      child.stdout.resume();
      await stdoutDrained;
      await vi.advanceTimersByTimeAsync(25);
      expect(pollCount()).toBe(1);
      const stderrDrained = once(child.stderr, "drain");
      child.stderr.resume();
      await stderrDrained;
      await vi.advanceTimersByTimeAsync(1);
      await closed;
      expect(pollCount()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("discards blocked output during cleanup so the owned job can settle", async () => {
    vi.useFakeTimers();
    try {
      const chunk = Buffer.alloc(65536, 0x64);
      const { native, calls } = authority({
        polls: [
          {
            stdout: chunk,
            stderr: Buffer.alloc(0),
            stdoutEnded: false,
            stderrEnded: false,
            exitCode: null,
            activeProcesses: 1,
          },
          { ...settledPoll, stderr: Buffer.alloc(0) },
        ],
      });
      const child = launch(native);
      child.stdout.pause();
      await vi.advanceTimersByTimeAsync(25);
      expect(child.stdout.writableNeedDrain).toBe(true);
      const closed = once(child, "close");
      const cleanup = child.cleanup();
      await vi.advanceTimersByTimeAsync(25);
      expect(await cleanup).toEqual({ cleaned: true, signaled: true });
      await closed;
      expect(
        calls.filter((call) => call.operation === "process_poll"),
      ).toHaveLength(2);
      expect(child.stdout.destroyed).toBe(true);
      expect(child.outputIncomplete).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes polling when a blocked output stream is destroyed", async () => {
    vi.useFakeTimers();
    try {
      const chunk = Buffer.alloc(65536, 0x65);
      const { native, calls } = authority({
        polls: [
          {
            stdout: chunk,
            stderr: Buffer.alloc(0),
            stdoutEnded: false,
            stderrEnded: false,
            exitCode: null,
            activeProcesses: 1,
          },
          { ...settledPoll, stderr: Buffer.alloc(0) },
        ],
      });
      const child = launch(native);
      const closed = once(child, "close");
      await vi.advanceTimersByTimeAsync(25);
      expect(child.stdout.writableNeedDrain).toBe(true);
      child.stdout.destroy();
      await vi.advanceTimersByTimeAsync(0);
      await closed;
      expect(
        calls.filter((call) => call.operation === "process_poll"),
      ).toHaveLength(2);
      expect(child.outputIncomplete).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Windows output poll failure", () => {
  it("keeps polling after failed native polls and reports the run once", async () => {
    vi.useFakeTimers();
    try {
      const { native, calls } = authority({
        polls: [
          { malformed: true },
          { malformed: true },
          {
            stdout: Buffer.from("frame\n"),
            stderr: Buffer.alloc(0),
            stdoutEnded: false,
            stderrEnded: false,
            exitCode: null,
            activeProcesses: 1,
          },
          { ...settledPoll, stderr: Buffer.alloc(0), exitCode: 0 },
        ],
      });
      const child = launch(native);
      const errors: unknown[] = [];
      child.on("error", (error) => errors.push(error));
      const output: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
      let closed = false;
      child.once("close", () => (closed = true));
      const polls = () =>
        calls.filter((call) => call.operation === "process_poll").length;
      // Failed polls back off 250 ms instead of retrying at the idle cadence.
      await vi.advanceTimersByTimeAsync(25);
      expect(polls()).toBe(1);
      await vi.advanceTimersByTimeAsync(249);
      expect(polls()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(polls()).toBe(2);
      await vi.advanceTimersByTimeAsync(249);
      expect(polls()).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(polls()).toBe(3);
      // Output resumes the immediate cadence (Node clamps a 0 ms timer to 1 ms).
      await vi.advanceTimersByTimeAsync(1);
      expect(polls()).toBe(4);
      expect(errors).toHaveLength(1);
      expect(Buffer.concat(output).toString()).toBe("frame\n");
      expect(child.exitCode).toBe(0);
      expect(closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
