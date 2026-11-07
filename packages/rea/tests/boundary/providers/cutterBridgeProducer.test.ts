import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, it } from "vitest";

import { CutterBridgeClient } from "../../../src/cutter/CutterBridgeClient.js";
import { CutterBridgeService } from "../../../src/cutter/CutterBridgeService.js";
import {
  createTestProcessRegistry,
  waitForExit,
} from "../../../tests/support/process/processFixture.js";

const startPythonBridge = async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-cutter-receipt-"));
  await chmod(directory, 0o700);
  const processes = createTestProcessRegistry();
  const child = processes.spawn(
    "python3",
    [resolve("tests/fixtures/cutter_bridge_protocol_test.py"), "--serve"],
    { env: { ...process.env, REA_CUTTER_BRIDGE_DIR: directory } },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  try {
    await new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(
        () =>
          rejectReady(
            new Error(`Python bridge did not become ready: ${stderr}`),
          ),
        5_000,
      );
      const onData = (_chunk: string): void => {
        if (!stdout.includes("ready\n")) return;
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        resolveReady();
      };
      child.stdout.on("data", onData);
      child.once("error", (error) => {
        clearTimeout(timeout);
        rejectReady(error);
      });
      child.once("exit", (code, signal) => {
        if (stdout.includes("ready\n")) return;
        clearTimeout(timeout);
        rejectReady(
          new Error(
            `Python bridge exited before ready (${code ?? signal}): ${stderr}`,
          ),
        );
      });
      if (stdout.includes("ready\n")) onData("");
    });
    const client = new CutterBridgeClient({
      ...process.env,
      REA_CUTTER_BRIDGE_DIR: directory,
    });
    const discovery = await client.listSessions();
    const session = discovery.sessions[0];
    if (session === undefined) throw new Error("Python bridge session missing");
    return {
      client,
      directory,
      session,
      stderr: () => stderr,
      async close(): Promise<void> {
        child.stdin.end("shutdown\n");
        const exited = await waitForExit(child, 3_000);
        try {
          await processes.shutdown();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
        if (!exited) throw new Error(`Python bridge did not exit: ${stderr}`);
      },
    };
  } catch (error) {
    child.stdin.end("shutdown\n");
    await waitForExit(child, 3_000);
    await processes.shutdown();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};

it("authenticates bridge peers before payloads and permits status recovery after a poisoned UI timeout", () => {
  execFileSync(
    "python3",
    [resolve("tests/fixtures/cutter_bridge_protocol_test.py")],
    {
      encoding: "utf8",
      timeout: 20_000,
    },
  );
});

it("round-trips authenticated status and command bytes across the Python producer boundary", async () => {
  const bridge = await startPythonBridge();
  try {
    const { client, session } = bridge;
    expect(session.document_generation).toBe(4);
    expect(session.current_file).toBe("/tmp/cutter-interop-雪.bin");

    for (let index = 0; index <= 64; index += 1) {
      await expect(
        client.execute({
          sessionId: session.session_id,
          expectedGeneration: 3,
          command: "iI",
          json: false,
        }),
      ).rejects.toMatchObject({
        _tag: "AnalysisInputError",
        issues: [
          {
            path: ["expected_generation"],
            reason: "invalid_value",
            message: expect.stringContaining("List sessions again"),
          },
        ],
      });
    }

    const result = await client.execute({
      sessionId: session.session_id,
      expectedGeneration: session.document_generation,
      command: 'print("雪 ☃️ \\\"quoted\\\" \\\\ slash\\nline\\ttab")',
      json: false,
    });
    expect(result.output).toBe(
      'round-trip: 雪 ☃️ quote=" slash=\\\\ line=\\n tab=\\t',
    );
    expect(result.executionState).toBe("complete");
    expect(result.documentGeneration).toBe(4);
    expect(result.currentFile).toBe("/tmp/cutter-interop-雪.bin");
    expect(result.outputTruncated).toBe(false);
  } finally {
    await bridge.close();
  }
});

it("preserves caller A service cleanup proof after caller B acknowledges A", async () => {
  const bridge = await startPythonBridge();
  try {
    const commandInput = {
      session_id: bridge.session.session_id,
      expected_generation: bridge.session.document_generation,
      command: "fixture-unknown",
      json: false,
    };
    const callerA = new CutterBridgeService(bridge.client);
    const executionA = await callerA.execute(commandInput);
    expect(executionA).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });

    const callerB = new CutterBridgeService(
      new CutterBridgeClient({
        ...process.env,
        REA_CUTTER_BRIDGE_DIR: bridge.directory,
      }),
    );
    await expect(
      callerB.execute({
        ...commandInput,
        command: "iI",
        json: false,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(callerA.retryCleanup()).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(
      callerA.execute({ ...commandInput, command: "iI" }),
    ).resolves.toMatchObject({ ok: true });
  } finally {
    await bridge.close();
  }
});

it("recovers orphan receipts across more than 64 fresh CLI clients", async () => {
  const bridge = await startPythonBridge();
  try {
    for (let index = 0; index < 65; index += 1) {
      const freshClient = new CutterBridgeClient({
        ...process.env,
        REA_CUTTER_BRIDGE_DIR: bridge.directory,
      });
      const execution = await freshClient.execute({
        sessionId: bridge.session.session_id,
        expectedGeneration: bridge.session.document_generation,
        command: "fixture-unknown",
        json: false,
      });
      expect(execution.executionState, `orphan ${index}`).toBe("unknown");
    }
    const nextInvocation = new CutterBridgeClient({
      ...process.env,
      REA_CUTTER_BRIDGE_DIR: bridge.directory,
    });
    await expect(
      nextInvocation.execute({
        sessionId: bridge.session.session_id,
        expectedGeneration: bridge.session.document_generation,
        command: "iI",
        json: false,
      }),
    ).resolves.toMatchObject({ executionState: "complete" });
  } finally {
    await bridge.close();
  }
});

it("retains failed receipt acknowledgements and retries before another command", async () => {
  const bridge = await startPythonBridge();
  try {
    await expect(
      bridge.client.execute({
        sessionId: bridge.session.session_id,
        expectedGeneration: bridge.session.document_generation,
        command: "fixture-fail-ack",
        json: false,
      }),
    ).resolves.toMatchObject({ executionState: "complete" });
    await expect(
      bridge.client.execute({
        sessionId: bridge.session.session_id,
        expectedGeneration: bridge.session.document_generation,
        command: "iI",
        json: false,
      }),
    ).resolves.toMatchObject({ executionState: "complete" });
  } finally {
    await bridge.close();
  }
});

it("retains a receipt when an ACK reply omits its acknowledgement field", async () => {
  const bridge = await startPythonBridge();
  try {
    await expect(
      bridge.client.execute({
        sessionId: bridge.session.session_id,
        expectedGeneration: bridge.session.document_generation,
        command: "fixture-malformed-ack",
        json: false,
      }),
    ).resolves.toMatchObject({ executionState: "complete" });
    await expect(
      bridge.client.execute({
        sessionId: bridge.session.session_id,
        expectedGeneration: bridge.session.document_generation,
        command: "iI",
        json: false,
      }),
    ).resolves.toMatchObject({ executionState: "complete" });
  } finally {
    await bridge.close();
  }
});
