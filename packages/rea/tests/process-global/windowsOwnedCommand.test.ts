import { EventEmitter, once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { expect, it, vi } from "vitest";

import {
  createWindowsOwnedCommand,
  loadWindowsOwnedProcessClass,
  superviseWindowsOwnedProcess,
} from "../../scripts/lib/windows-owned-command.mjs";
import { requireWindowsNativeAuthority } from "../../src/windows/WindowsNativeLoader.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const require = createRequire(import.meta.url);

async function readOptional(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}

it("imports the source Windows owner without dist using a fake native authority", async () => {
  const calls: string[] = [];
  const WindowsOwnedProcess = await loadWindowsOwnedProcessClass();
  const child = new WindowsOwnedProcess(
    "ignored.exe",
    [],
    undefined,
    {},
    false,
    {
      authority: {
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
        },
        call(operation: string) {
          calls.push(operation);
          if (operation === "process_spawn")
            return {
              pid: 42,
              handle: {},
              jobAssigned: true,
              killOnOwnerClose: true,
            };
          if (operation === "process_poll")
            return {
              stdout: Buffer.alloc(0),
              stderr: Buffer.alloc(0),
              stdoutEnded: true,
              stderrEnded: true,
              exitCode: 0,
              activeProcesses: 0,
            };
          if (operation === "process_close") return null;
          throw new Error(`Unmodeled fake native operation ${operation}`);
        },
      },
    },
  );

  await expect(once(child, "close")).resolves.toEqual([0, null]);
  expect(calls).toEqual(["process_spawn", "process_poll", "process_close"]);
});

it("passes cross-spawn's resolved executable to the native owner", () => {
  const parserPath = require.resolve("cross-spawn/lib/parse");
  require(parserPath);
  const parserModule = require.cache[parserPath];
  if (parserModule === undefined)
    throw new Error("cross-spawn parser was not loaded");
  const originalParser = parserModule.exports;
  let received: unknown[] | undefined;
  class CaptureOwnedProcess {
    constructor(...arguments_: unknown[]) {
      received = arguments_;
    }
  }
  parserModule.exports = () => ({
    command: "node",
    file: "C:\\runtime\\node.exe",
    args: ["-e", "code"],
    options: {},
  });
  try {
    createWindowsOwnedCommand({
      WindowsOwnedProcess: CaptureOwnedProcess as never,
      command: "node",
      arguments: ["-e", "code"],
      cwd: undefined,
      environment: {},
    });
  } finally {
    parserModule.exports = originalParser;
  }

  expect(received?.[0]).toBe("C:\\runtime\\node.exe");
  expect(received?.[1]).toEqual(["-e", "code"]);
});

it("supervises protocol stdin errors until the owned job and stream close", async () => {
  const calls: string[] = [];
  let activeProcesses = 1;
  const writeFailure = new Error("controlled native stdin failure");
  const WindowsOwnedProcess = await loadWindowsOwnedProcessClass();
  const child = createWindowsOwnedCommand({
    WindowsOwnedProcess,
    command: "ignored.exe",
    arguments: [],
    cwd: undefined,
    environment: {},
    authority: {
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
      },
      call(operation: string) {
        calls.push(operation);
        if (operation === "process_spawn")
          return {
            pid: 42,
            handle: {},
            jobAssigned: true,
            killOnOwnerClose: true,
          };
        if (operation === "process_stdin_write") throw writeFailure;
        if (operation === "process_stdin_close") return null;
        if (operation === "process_terminate") {
          activeProcesses = 0;
          return true;
        }
        if (operation === "process_poll")
          return {
            stdout: Buffer.alloc(0),
            stderr: Buffer.alloc(0),
            stdoutEnded: true,
            stderrEnded: true,
            exitCode: 0,
            activeProcesses,
          };
        if (operation === "process_close") return null;
        throw new Error(`Unmodeled fake native operation ${operation}`);
      },
    },
  });
  const lifecycle = superviseWindowsOwnedProcess(child, {
    retryIntervalMs: 10,
  });
  if (child.stdin === null) throw new Error("fixture protocol stdin missing");
  const stdin = child.stdin;
  const write = new Promise<Error | null>((resolve) => {
    stdin.write(Buffer.from("x"), (cause?: Error | null) =>
      resolve(cause ?? null),
    );
  });

  await expect(write).resolves.toBe(writeFailure);
  await expect(lifecycle.finished).rejects.toBe(writeFailure);
  expect(calls).toContain("process_terminate");
  expect(calls).toContain("process_close");
});

it.runIf(process.platform === "win32")(
  "supervises native protocol stdin through Job Object close",
  async () => {
    const directory = await createTestTempDirectory("rea-owned-stdin-probe-");
    const WindowsOwnedProcess = await loadWindowsOwnedProcessClass();
    const child = new WindowsOwnedProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      directory,
      process.env,
      false,
      {
        protocolStdin: true,
        authority: requireWindowsNativeAuthority(),
      },
    );
    child.stdout.resume();
    child.stderr.resume();
    const lifecycle = superviseWindowsOwnedProcess(child);
    const stdin = child.stdin;
    if (stdin === null) throw new Error("fixture protocol stdin missing");
    let stdinClosed = false;
    stdin.once("close", () => {
      stdinClosed = true;
    });
    process.stdin.pipe(stdin);

    try {
      lifecycle.requestCleanup();
      let settled = false;
      void lifecycle.finished.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 15_000 });
      await expect(lifecycle.finished).resolves.toMatchObject({
        code: expect.any(Number),
      });
      expect(stdinClosed).toBe(true);
    } finally {
      process.stdin.unpipe(stdin);
      lifecycle.requestCleanup();
    }
  },
);

it.runIf(process.platform === "win32")(
  "keeps native Job Object ownership after the leader exits",
  async () => {
    const directory = await createTestTempDirectory("rea-owned-tree-probe-");
    const activityPath = join(directory, "descendant-activity.log");
    const readyPath = join(directory, "descendant-ready");
    const exitedPath = join(directory, "descendant-exited");
    const errorPath = join(directory, "descendant-error");
    const stopPath = join(directory, "descendant-stop");
    const grandchild = `
      const fs = require("node:fs");
      process.on("exit", (code) => fs.writeFileSync(${JSON.stringify(exitedPath)}, String(code)));
      process.on("uncaughtExceptionMonitor", (error) => fs.writeFileSync(${JSON.stringify(errorPath)}, String(error)));
      fs.writeFileSync(${JSON.stringify(readyPath)}, "ready");
      const timer = setInterval(() => {
        if (fs.existsSync(${JSON.stringify(stopPath)})) {
          clearInterval(timer);
          process.exit(0);
        }
        fs.appendFileSync(${JSON.stringify(activityPath)}, "active\\n");
      }, 20);
    `;
    const leader = `
      const fs = require("node:fs");
      const child = require("node:child_process").spawn(
        process.execPath,
        ["-e", ${JSON.stringify(grandchild)}],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
      const waitForDescendant = setInterval(() => {
        if (!fs.existsSync(${JSON.stringify(readyPath)})) return;
        clearInterval(waitForDescendant);
        process.exit(0);
      }, 10);
    `;
    const WindowsOwnedProcess = await loadWindowsOwnedProcessClass();
    const native = requireWindowsNativeAuthority();
    const observedCounts: number[] = [];
    const authority = {
      inspection: native.inspection,
      call(operation: string, arguments_: readonly unknown[]) {
        const result = native.call(operation, arguments_);
        if (
          operation === "process_poll" &&
          typeof result === "object" &&
          result !== null &&
          "activeProcesses" in result &&
          typeof result.activeProcesses === "number"
        )
          observedCounts.push(result.activeProcesses);
        return result;
      },
    };
    const child = new WindowsOwnedProcess(
      process.execPath,
      ["-e", leader],
      directory,
      process.env,
      false,
      { authority },
    );
    child.stdout.resume();
    child.stderr.resume();
    const exited = once(child, "exit");
    const closed = once(child, "close");
    let hasClosed = false;
    void closed.then(() => {
      hasClosed = true;
    });

    try {
      await exited;
      await expect(readFile(readyPath, "utf8")).resolves.toBe("ready");
      const before = await readOptional(activityPath);
      await expect
        .poll(async () => (await readFile(activityPath, "utf8")).length, {
          timeout: 5_000,
        })
        .toBeGreaterThan(before?.length ?? 0);
      expect(
        hasClosed,
        JSON.stringify({
          activeProcessCounts: observedCounts,
          descendantExitCode: await readOptional(exitedPath),
          descendantError: await readOptional(errorPath),
          activity: await readOptional(activityPath),
        }),
      ).toBe(false);
      await expect(child.cleanup()).resolves.toMatchObject({ cleaned: true });
      await closed;
      const activityAtCleanup = await readFile(activityPath, "utf8");
      await delay(100);
      expect(await readFile(activityPath, "utf8")).toBe(activityAtCleanup);
    } finally {
      await writeFile(stopPath, "stop");
      if (!hasClosed) {
        const cleanup = await child.cleanup();
        if (cleanup.cleaned) await closed;
        else child.unref();
      }
      await delay(100);
    }
  },
);

it("retries thrown and false cleanup results, then preserves the first error", async () => {
  vi.useFakeTimers();
  try {
    class ControlledOwnedProcess extends EventEmitter {
      attempts = 0;

      cleanup() {
        this.attempts += 1;
        if (this.attempts === 1)
          throw new Error("controlled synchronous cleanup throw");
        if (this.attempts === 2)
          return Promise.resolve({
            cleaned: false,
            reason: "controlled poll failure",
          });
        this.emit("close", 7, null);
        return Promise.resolve({ cleaned: true, signaled: true });
      }
    }

    const child = new ControlledOwnedProcess();
    const diagnostics: { type: string; reason?: string }[] = [];
    const lifecycle = superviseWindowsOwnedProcess(child, {
      retryIntervalMs: 25,
      onCleanupDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    let completed = false;
    const completion = lifecycle.finished
      .catch((cause: unknown) => cause)
      .then((cause) => {
        completed = true;
        return cause;
      });

    child.emit("error", undefined);
    expect(child.attempts).toBe(1);
    await vi.waitFor(() =>
      expect(diagnostics).toEqual([
        {
          type: "cleanup-failed",
          reason: "controlled synchronous cleanup throw",
        },
      ]),
    );
    expect(completed).toBe(false);

    child.emit("error", new Error("secondary native error"));
    expect(child.attempts).toBe(2);
    await vi.waitFor(() =>
      expect(diagnostics).toEqual([
        {
          type: "cleanup-failed",
          reason: "controlled synchronous cleanup throw",
        },
        { type: "cleanup-failed", reason: "controlled poll failure" },
      ]),
    );
    expect(completed).toBe(false);

    await vi.advanceTimersByTimeAsync(25);
    await expect(completion).resolves.toBeUndefined();
    expect(child.attempts).toBe(3);
    expect(diagnostics).toEqual([
      {
        type: "cleanup-failed",
        reason: "controlled synchronous cleanup throw",
      },
      { type: "cleanup-failed", reason: "controlled poll failure" },
      { type: "cleanup-recovered" },
    ]);
  } finally {
    vi.useRealTimers();
  }
});
