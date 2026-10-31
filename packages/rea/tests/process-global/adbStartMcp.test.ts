import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished, vi } from "vitest";

import { AdbProvider } from "../../src/adb/AdbProvider.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createServer } from "../../src/server/createServer.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import {
  execFileBytes,
  execFileOutput,
} from "../../src/process/ExecFileOutput.js";
import { toolContract } from "../../src/contracts/toolContracts.js";

vi.mock("../../src/process/ExecFileOutput.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/process/ExecFileOutput.js")
  >()),
  execFileOutput: vi.fn(),
  execFileBytes: vi.fn(),
}));

it.each(["start_adb_app", "start_adb_activity"] as const)(
  "%s retains launch evidence through MCP with isolated process mocks",
  async (operation) => {
    const starting =
      "Starting: Intent { act=android.intent.action.MAIN cmp=com.example/.Main }\n";
    let stdout = `${starting}Status: ok\nActivity: com.example/.Main\nWaitTime: 315\nComplete\n`;
    let stderr = "";
    const version =
      "Android Debug Bridge version 1.0.41\nVersion 34.0.5-stub\n";
    vi.mocked(execFileOutput).mockResolvedValue({
      stdout: version,
      stderr: "",
      stdoutBytes: Buffer.byteLength(version),
      stderrBytes: 0,
    });
    const calls: string[][] = [];
    vi.mocked(execFileBytes).mockImplementation(async (_binary, args) => {
      calls.push([...args]);
      return args.includes("resolve-activity")
        ? {
            stdout: Buffer.from("com.example/.Main\n"),
            stderr: Buffer.alloc(0),
          }
        : { stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) };
    });
    onTestFinished(() => {
      vi.resetAllMocks();
    });
    const server = createServer(
      {
        kind: "session",
        session: createTestBinarySession(() => {
          throw new Error("must not start deep provider");
        }),
      },
      { adbDeviceAnalysis: new AdbProvider({ environment: {} }) },
    );
    onTestFinished(() => server.close());
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "adb-start-boundary", version: "0.0.0" });
    onTestFinished(() => client.close());
    await client.connect(clientTransport);
    const input =
      operation === "start_adb_app"
        ? { serial: "emulator-5554", package: "com.example" }
        : {
            serial: "emulator-5554",
            action: "android.intent.action.MAIN",
            component: "com.example/.Main",
          };
    const successful = await client.callTool({
      name: operation,
      arguments: input,
    });
    expect(successful.isError).not.toBe(true);
    const evidence = toolContract(operation).outputSchema.parse(
      parseEvidence(
        JSON.parse(
          (successful.content as { text?: string }[])
            .map((part) => part.text ?? "")
            .join(""),
        ),
      ),
    );
    expect(evidence.confidence).toBe("observed");
    expect(evidence.normalized_result).toMatchObject({
      started_activity: "act=android.intent.action.MAIN cmp=com.example/.Main",
      reported_activity: "com.example/.Main",
      reported_status: "ok",
    });
    expect(evidence.raw_result).toEqual({ stdout, stderr });

    stdout = `${starting}Status: timeout\nActivity: com.example/.Main\nWaitTime: 10004\nComplete\n`;
    const timedOut = await client.callTool({
      name: operation,
      arguments: input,
    });
    expect(timedOut.isError).toBe(true);
    const failure = JSON.parse(
      (timedOut.content as { text?: string }[])
        .map((part) => part.text ?? "")
        .join(""),
    );
    expect(failure.error).toMatchObject({
      code: "unsupported_target",
      details: {
        captured_output: { stdout, stderr, truncated: false },
        partial_observation: {
          provider_id: "adb",
          operation,
          result: {
            started_activity:
              "act=android.intent.action.MAIN cmp=com.example/.Main",
            reported_activity: "com.example/.Main",
            reported_status: "timeout",
          },
        },
      },
    });
    expect(failure).not.toHaveProperty("confidence");

    stdout = starting;
    stderr = "Error: Activity class does not exist\n";
    const refused = await client.callTool({
      name: operation,
      arguments: input,
    });
    expect(refused.isError).toBe(true);
    expect(
      (refused.content as { text?: string }[])
        .map((part) => part.text ?? "")
        .join(""),
    ).toContain("Activity class does not exist");
    expect(calls.filter((args) => args.includes("start"))).toEqual(
      Array.from({ length: 3 }, () => [
        "-s",
        "emulator-5554",
        "shell",
        "am",
        "start",
        "-W",
        ...(operation === "start_adb_app"
          ? ["-n", "com.example/.Main"]
          : ["-a", "android.intent.action.MAIN", "-n", "com.example/.Main"]),
      ]),
    );
  },
);
