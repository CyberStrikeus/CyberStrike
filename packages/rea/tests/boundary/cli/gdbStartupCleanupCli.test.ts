import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import pino from "pino";
import { expect, it, vi } from "vitest";

import { AnalysisOutputError } from "../../../src/domain/analysisErrorCore.js";
import { err } from "../../../src/domain/result.js";
import { registerReverseEngineeringCommands } from "../../../src/cli/reverseEngineeringCommands.js";
import { CLI_COMMANDS } from "../../../src/cliCommandNames.js";
import type { CliInstance } from "../../../src/cli/types.js";
import { GdbSessionManager } from "../../../src/gdb/GdbSessionManager.js";

const registerGdbCommand = (
  createManager: () => GdbSessionManager,
): {
  run(input: {
    args: { command: string };
    options: { inferiorTty: string };
  }): Promise<unknown>;
} => {
  const commands = new Map<
    string,
    {
      run(input: {
        args: { command: string };
        options: { inferiorTty: string };
      }): Promise<unknown>;
    }
  >();
  const cli = {
    command: (
      name: string,
      definition: {
        run(input: {
          args: { command: string };
          options: { inferiorTty: string };
        }): Promise<unknown>;
      },
    ) => {
      commands.set(name, definition);
      return cli;
    },
  } as unknown as CliInstance;
  registerReverseEngineeringCommands(cli, pino({ enabled: false }), {}, () =>
    createManager(),
  );
  const command = commands.get(CLI_COMMANDS.debugWithGdb);
  if (command === undefined)
    throw new Error("GDB CLI command was not registered");
  return command;
};

it.each([
  "source /tmp/gdbinit",
  "python print('x')",
  "def custom-command",
  "run > /tmp/out",
  "set inferior-t /dev/null",
  "with inferior-t /dev/null -- run",
])("rejects one-shot command %s before starting GDB", async (inputCommand) => {
  const manager = {
    start: vi.fn(),
    closeAll: vi.fn(),
  } as unknown as GdbSessionManager;
  const command = registerGdbCommand(() => manager);
  const result = await command.run({
    args: { command: inputCommand },
    options: { inferiorTty: "/dev/pts/42" },
  });
  expect(result).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [
        expect.objectContaining({
          message: expect.stringContaining("persistent GDB session workflow"),
        }),
      ],
    },
  });
  expect(manager.start).not.toHaveBeenCalled();
  expect(manager.closeAll).not.toHaveBeenCalled();
});

it("retries retained GDB cleanup when CLI session startup fails", async () => {
  const closeAll = vi.fn(async () => undefined);
  const manager = {
    start: vi.fn(async () =>
      err(new AnalysisOutputError("start_gdb_session", "startup failed")),
    ),
    closeAll,
  } as unknown as GdbSessionManager;
  const originalExitCode = process.exitCode;
  const command = registerGdbCommand(() => manager);

  try {
    const result = await command.run({
      args: { command: "info files" },
      options: { inferiorTty: "/dev/pts/42" },
    });
    expect(result).toMatchObject({ code: "unreadable_output" });
    expect(manager.start).toHaveBeenCalledOnce();
    expect(manager.start).toHaveBeenCalledWith(expect.anything(), {
      inferiorTty: "/dev/pts/42",
    });
    expect(closeAll).toHaveBeenCalledOnce();
  } finally {
    process.exitCode = originalExitCode;
  }
});

it("marks the CLI failed when retained GDB cleanup remains incomplete", async () => {
  const manager = {
    start: vi.fn(async () =>
      err(new AnalysisOutputError("start_gdb_session", "startup failed")),
    ),
    closeAll: vi.fn(async () => {
      throw new Error("process still owned");
    }),
  } as unknown as GdbSessionManager;
  const originalExitCode = process.exitCode;
  const command = registerGdbCommand(() => manager);

  try {
    const result = await command.run({
      args: { command: "info files" },
      options: { inferiorTty: "/dev/pts/42" },
    });
    expect(result).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: { primary_error: { code: "unreadable_output" } },
      },
    });
    expect(manager.closeAll).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = originalExitCode;
  }
});

it.each(["ENOENT", "EACCES", "EPERM"] as const)(
  "keeps selected GDB launch recovery in the public CLI for %s",
  async (code) => {
    const selected = "/selected/gdb command";
    const launchFailure = Object.assign(
      new Error(`spawn ${selected} ${code}`),
      {
        code,
      },
    );
    const spawnProcess = vi.fn(async () => {
      throw launchFailure;
    });
    const manager = new GdbSessionManager({
      platform: "linux",
      environment: { REA_GDB_COMMAND: selected },
      spawnProcess,
    });
    const command = registerGdbCommand(() => manager);
    const previousExitCode = process.exitCode;
    try {
      const result = await command.run({
        args: { command: "show version" },
        options: { inferiorTty: "/dev/pts/42" },
      });
      expect(result).toMatchObject({
        code: "capability_unavailable",
        message: expect.stringContaining(JSON.stringify(selected)),
        remediation: { action: expect.stringContaining("REA_GDB_COMMAND") },
        details: {
          reason: launchFailure.message,
          diagnostics: {
            boundary: "provider-launch",
            command: selected,
            system_code: code,
          },
        },
      });
      expect(spawnProcess).toHaveBeenCalledOnce();
      expect(spawnProcess).toHaveBeenCalledWith(
        expect.objectContaining({ command: selected }),
      );
    } finally {
      await manager.closeAll();
      process.exitCode = previousExitCode;
    }
  },
);

it("keeps prelaunch caller cancellation distinct from executable refusal", async () => {
  const controller = new AbortController();
  const reason = { caller: "stop before GDB launch" };
  const spawnProcess = vi.fn(async () => {
    controller.abort(reason);
    throw reason;
  });
  const manager = new GdbSessionManager({ platform: "linux", spawnProcess });
  try {
    const result = await manager.start(controller.signal);
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", cause: reason },
    });
    expect(spawnProcess).toHaveBeenCalledOnce();
  } finally {
    await manager.closeAll();
  }
});

class FakeGdb extends EventEmitter {
  pid = process.pid + 1;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill(signal: NodeJS.Signals) {
    this.exitCode = 0;
    this.signalCode = signal;
    this.stdout.end();
    this.stderr.end();
    this.stdin.destroy();
    this.emit("exit", 0, signal);
    this.emit("close", 0, signal);
    return true;
  }
}

const modeledGdbReplies = new Map([
  ["-gdb-set auto-load off", "^done"],
  ['-inferior-tty-set "/dev/pts/7"', "^done"],
  ["-inferior-tty-show", '^done,inferior_tty_terminal="/dev/pts/7"'],
  ['-interpreter-exec console "info files"', "^done"],
  ["-list-thread-groups --recurse 1", "^done,groups=[]"],
  ["-gdb-exit", "^exit"],
]);

it.each(["incomplete", "interrupt", "control"] as const)(
  "reports final GDB cleanup %s as a typed outcome",
  async (mode) => {
    const child = new FakeGdb();
    const unmodeled: string[] = [];
    let requests = 0;
    child.stdout.write("(gdb)\n");
    child.stdin.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) {
        const match = /^(\d+)(.*)$/u.exec(line);
        if (!match) continue;
        requests++;
        const token = match[1] ?? "";
        const tail = match[2] ?? "";
        const reply = modeledGdbReplies.get(tail);
        if (reply === undefined) unmodeled.push(line);
        child.stdout.write(
          `${token}${reply ?? '^error,msg="unmodeled request"'}\n`,
        );
      }
    });
    let calls = 0;
    let recovering = false;
    let retainedId: string | undefined;
    const manager = new GdbSessionManager({
      platform: "linux",
      spawnProcess: async (options) => ({
        process: child,
        ownership: {
          runId: options.runId,
          leaderPid: child.pid,
          processGroupId: child.pid,
          expectedParentPid: process.pid,
        },
      }),
      stopProcess: async () => {
        calls++;
        if (mode === "interrupt" && calls === 1) process.emit("SIGINT");
        if (mode === "incomplete" && !recovering)
          return {
            status: "incomplete",
            reason: "synthetic stop remains pending",
          };
        child.kill("SIGTERM");
        return { status: "stopped" };
      },
    });
    const originalStart = manager.start.bind(manager);
    manager.start = async (...args) => {
      const started = await originalStart(...args);
      if (started.ok) retainedId = started.value.session_id;
      return started;
    };
    const command = registerGdbCommand(() => manager);
    const previous = process.exitCode;
    try {
      process.exitCode = 0;
      const result = await command.run({
        args: { command: "info files" },
        options: { inferiorTty: "/dev/pts/7" },
      });
      expect(requests).toBeGreaterThan(0);
      expect(unmodeled).toEqual([]);
      if (mode === "control") {
        expect(result).toMatchObject({
          operation: "gdb_console",
          parameters: { session_id: retainedId },
          normalized_result: { completion_status: "complete" },
        });
        expect(process.exitCode).toBe(0);
      } else if (mode === "interrupt") {
        expect(result).toMatchObject({
          code: "cancelled",
          details: {
            partial_observation: {
              operation: "gdb_console",
              parameters: { session_id: retainedId },
            },
          },
        });
        expect(process.exitCode).toBe(130);
      } else {
        expect(result).toMatchObject({
          code: "cleanup_incomplete",
          details: {
            cleanup: "incomplete",
            resources: [retainedId],
            partial_observation: {
              operation: "gdb_console",
              parameters: { session_id: retainedId },
            },
          },
        });
        expect(process.exitCode).toBe(1);
        expect(retainedId).toBeDefined();
      }
    } finally {
      recovering = true;
      await manager.closeAll();
      process.exitCode = previous;
    }
  },
);
