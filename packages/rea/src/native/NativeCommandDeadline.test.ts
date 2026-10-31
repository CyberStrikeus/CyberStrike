import { afterEach, describe, expect, it, vi } from "vitest";

import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../../tests/fixtures/nativeCommands.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../process/OwnedCommand.js";
import type {
  NativeCommandOptions,
  NativeCommandRunner,
} from "./CommandRunner.js";
import { XcrunCommandRunner } from "./CommandRunner.js";
import { DEFAULT_NATIVE_COMMAND_TIMEOUT_MS } from "../domain/native/nativeDeadlines.js";
import { NativeMacOSProvider } from "./NativeMacOSProvider.js";

vi.mock("../process/OwnedCommand.js", async (original) => ({
  ...(await original<typeof import("../process/OwnedCommand.js")>()),
  runOwnedCommand: vi.fn(),
}));

afterEach(() => {
  vi.mocked(runOwnedCommand).mockReset();
});

class RecordingRunner implements NativeCommandRunner {
  readonly timeouts: number[] = [];
  readonly #inner = new NativeFixtureRunner();

  run(
    tool: string,
    arguments_: readonly string[],
    options: NativeCommandOptions,
  ) {
    if (options.timeoutMs !== undefined) this.timeouts.push(options.timeoutMs);
    return this.#inner.run(tool, arguments_, options);
  }
}

const execute = async (
  runner: NativeCommandRunner,
  parameters: Readonly<Record<string, JsonValue>>,
) => {
  const client = new NativeMacOSProvider({}, runner, "darwin").createClient(
    nativeMachoTarget("/fixture/app"),
  );
  try {
    return await client.execute("list_architectures", parameters);
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
};

describe("native_command_timeout_ms", () => {
  it("uses 60000 ms when the caller omits the setting", async () => {
    const runner = new RecordingRunner();
    const result = await execute(runner, {});
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(runner.timeouts.every((timeout) => timeout === 60_000)).toBe(true);
    expect(DEFAULT_NATIVE_COMMAND_TIMEOUT_MS).toBe(60_000);
    expect(runner.timeouts.length).toBeGreaterThan(0);
  });

  it("passes a selected deadline through to each native command", async () => {
    const runner = new RecordingRunner();
    const result = await execute(runner, { native_command_timeout_ms: 1_500 });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(runner.timeouts.length).toBeGreaterThan(0);
    expect(runner.timeouts.every((timeout) => timeout === 1_500)).toBe(true);
  });

  it("passes the selected deadline through production xcrun resolution", async () => {
    const calls: {
      command: string;
      arguments: readonly string[];
      timeoutMs: number | null;
    }[] = [];
    vi.mocked(runOwnedCommand).mockImplementation(async (spawn, limits) => {
      calls.push({
        command: spawn.command,
        arguments: spawn.arguments,
        timeoutMs: limits.timeoutMs,
      });
      throw new OwnedCommandFailure("timeout", "Command deadline elapsed.");
    });
    const runner = new XcrunCommandRunner({});
    const result = await runner.run("lipo", ["-info", "/fixture/app"], {
      timeoutMs: 120_000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected resolution timeout");
    expect(result.error.reason).toBe("timeout");
    expect(calls).toEqual([
      {
        command: "/usr/bin/xcrun",
        arguments: ["--find", "lipo"],
        timeoutMs: 120_000,
      },
    ]);
  });

  it("uses 60000 ms for xcrun resolution when the caller omits the deadline", async () => {
    const timeouts: (number | null)[] = [];
    vi.mocked(runOwnedCommand).mockImplementation(async (_spawn, limits) => {
      timeouts.push(limits.timeoutMs);
      throw new OwnedCommandFailure("timeout", "Command deadline elapsed.");
    });
    const runner = new XcrunCommandRunner({});
    const result = await runner.run("file", ["--brief", "/fixture/app"], {});
    expect(result.ok).toBe(false);
    expect(timeouts).toEqual([60_000]);
  });

  it("rejects an out-of-range deadline before launching a command", async () => {
    const runner = new RecordingRunner();
    const result = await execute(runner, { native_command_timeout_ms: 0 });
    if (result.ok) throw new Error("expected an invalid deadline");
    expect(runner.timeouts).toEqual([]);
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["native_command_timeout_ms"],
            reason: "out_of_range",
            minimum: 1,
            maximum: 2_147_483_647,
          },
        ],
      },
    });
  });
});
