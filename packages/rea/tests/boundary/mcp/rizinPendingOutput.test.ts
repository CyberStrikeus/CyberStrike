import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";

import { registerRizinDebugTools } from "../../../src/server/registerRizinDebugTools.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { silentLogger } from "../../../src/logger.js";
import { createInjectedProcess } from "../providers/RizinDebugSessionCoverage.fixtures.js";
import {
  createRizinTestManager,
  rizinTestInferiorTty,
} from "../providers/RizinTestInferiorTty.js";

const test = it.skipIf(process.platform === "win32");

test.each([
  "exit",
  "deadline",
  "framed-exit",
  "drained-exit",
  "drained-framed-exit",
] as const)(
  "retains received command bytes through MCP after %s",
  async (mode) => {
    const injected = createInjectedProcess({
      onWrite: (text, control) => {
        if (!text.includes("!echo __REA_COMMAND_COMPLETE_")) return;
        setImmediate(() => {
          control.output("complete prefix\0");
          if (mode.startsWith("drained-")) {
            control.exitLeader();
            setImmediate(() => {
              control.output("unfinished diagnostic Ω");
              if (mode === "drained-framed-exit") control.output("\0");
              control.closeOutput();
            });
            return;
          }
          control.output("unfinished diagnostic Ω");
          if (mode === "framed-exit") control.output("\0");
          if (mode !== "deadline") control.exit();
        });
      },
    });
    const manager = createRizinTestManager(
      {},
      {
        spawnProcess: injected.spawnProcess,
        frameTimeoutMs: 100,
      },
    );
    const server = new McpServer({ name: "rizin-partial-test", version: "1" });
    registerRizinDebugTools(
      server,
      manager,
      silentLogger,
      createToolResultDelivery(undefined),
    );
    const client = new Client({ name: "rizin-partial-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const startReply = await client.callTool({
        name: "start_rizin_debug_session",
        arguments: {
          path: "fixture.bin",
          inferior_tty: await rizinTestInferiorTty(),
        },
      });
      expect(startReply.isError).not.toBe(true);
      const started = toolContract(
        "start_rizin_debug_session",
      ).outputSchema.parse(startReply.structuredContent);
      const reply = await client.callTool({
        name: "rizin_debug_command",
        arguments: { session_id: started.session_id, command: "dr" },
      });
      expect(reply.isError).not.toBe(true);
      const expected = {
        output: "complete prefix\nunfinished diagnostic Ω",
        completion_status: "unknown",
        output_truncated: mode === "deadline",
      };
      expect(reply.structuredContent).toMatchObject({
        normalized_result: expected,
        raw_result: expected,
      });
    } finally {
      injected.control.exit();
      await client.close();
      await server.close();
      await manager.closeAll();
    }
  },
);

test.each([
  { mode: "exit", maximum: 10, invalid: true, expected: "first\n�A" },
  { mode: "cancel", maximum: 9, invalid: true, expected: "first\n�" },
  { mode: "exit", maximum: 9, invalid: false, expected: "first\n�" },
  { mode: "cancel", maximum: 8, invalid: true, expected: "first" },
])(
  "bounds pending UTF-8 after $mode (budget: $maximum, invalid: $invalid)",
  async ({ mode, maximum, invalid, expected }) => {
    const controller = new AbortController();
    const injected = createInjectedProcess({
      onWrite: (text, control) => {
        if (!text.includes("!echo __REA_COMMAND_COMPLETE_")) return;
        control.output(
          Buffer.concat([
            Buffer.from("first\0"),
            invalid ? Buffer.from([0xff]) : Buffer.from("�"),
            Buffer.from("ABCDEFGHIJKLM"),
          ]),
        );
        if (mode === "exit") control.exit();
        else controller.abort();
      },
    });
    const manager = createRizinTestManager(
      {},
      {
        spawnProcess: injected.spawnProcess,
        maxCommandOutputBytes: maximum,
      },
    );
    try {
      const started = await manager.start({
        path: "fixture.bin",
        inferior_tty: await rizinTestInferiorTty(),
      });
      if (!started.ok) throw started.error;
      const result = await manager.execute(
        started.value.session_id,
        "dr",
        controller.signal,
      );
      const evidence = result.ok
        ? result.value.evidence
        : result.error.partialObservation;
      expect(evidence).toMatchObject({
        normalized_result: {
          output: expected,
          output_truncated: true,
          completion_status: "unknown",
        },
        raw_result: { output: expected, output_truncated: true },
      });
      if (invalid)
        expect(evidence).toMatchObject({
          normalized_result: { output_invalid_utf8: true },
        });
      else
        expect(evidence).not.toHaveProperty(
          "normalized_result.output_invalid_utf8",
        );
      if (!result.ok) expect(result.error.capturedOutput?.truncated).toBe(true);
      expect(
        manager.status(started.value.session_id)?.output_invalid_utf8,
      ).toBe(invalid);
    } finally {
      injected.control.exit();
      await manager.closeAll();
    }
  },
);

test("rejects an unfinished unsolicited frame before command dispatch", async () => {
  let dispatched = false;
  const injected = createInjectedProcess({
    onWrite: (text, control) => {
      const marker = /!echo (__REA_COMMAND_COMPLETE_\w+)/u.exec(text)?.[1];
      if (marker === undefined) return;
      dispatched = true;
      setImmediate(() => control.output(`new command\0${marker}\n\0`));
    },
  });
  const manager = createRizinTestManager(
    {},
    { spawnProcess: injected.spawnProcess },
  );
  try {
    const started = await manager.start({
      path: "fixture.bin",
      inferior_tty: await rizinTestInferiorTty(),
    });
    if (!started.ok) throw started.error;
    injected.control.output("unclaimed old output");
    const result = await manager.execute(started.value.session_id, "dr");
    expect(result.ok).toBe(false);
    expect(dispatched).toBe(false);
  } finally {
    injected.control.exit();
    await manager.closeAll();
  }
});

test.each(["_", "__REA_", "marker-prefix"])(
  "preserves ambiguous diagnostic suffix %s on interruption",
  async (suffix) => {
    let expected = "";
    const injected = createInjectedProcess({
      onWrite: (text, control) => {
        const marker = /!echo (__REA_COMMAND_COMPLETE_\w+)/u.exec(text)?.[1];
        if (marker === undefined) return;
        expected = `literal diagnostic ${suffix === "marker-prefix" ? marker.slice(0, -5) : suffix}`;
        control.output(expected);
        control.exit();
      },
    });
    const manager = createRizinTestManager(
      {},
      { spawnProcess: injected.spawnProcess },
    );
    try {
      const started = await manager.start({
        path: "fixture.bin",
        inferior_tty: await rizinTestInferiorTty(),
      });
      if (!started.ok) throw started.error;
      const result = await manager.execute(started.value.session_id, "dr");
      if (!result.ok) throw result.error;
      expect(result.value.evidence).toMatchObject({
        normalized_result: { output: expected, completion_status: "unknown" },
        raw_result: { output: expected },
      });
      expect(result.value.evidence.limitations).toContain(
        "Interrupted output may include an incomplete completion-marker prefix; it is retained because it cannot be distinguished from command diagnostics.",
      );
    } finally {
      injected.control.exit();
      await manager.closeAll();
    }
  },
);

test("retains partial bytes and uncertainty when exited output never closes", async () => {
  const injected = createInjectedProcess({
    onWrite: (text, control) => {
      if (!text.includes("!echo __REA_COMMAND_COMPLETE_")) return;
      control.output("retained before exit");
      control.exitLeader();
    },
  });
  const manager = createRizinTestManager(
    {},
    { spawnProcess: injected.spawnProcess },
  );
  try {
    const started = await manager.start({
      path: "fixture.bin",
      inferior_tty: await rizinTestInferiorTty(),
    });
    if (!started.ok) throw started.error;
    const result = await manager.execute(started.value.session_id, "dr");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected retained cleanup uncertainty");
    expect(result.error.partialObservation).toMatchObject({
      normalized_result: {
        output: "retained before exit",
        output_truncated: true,
        completion_status: "unknown",
      },
    });
    expect(manager.status(started.value.session_id)?.state).toBe("closed");
  } finally {
    injected.control.closeOutput();
    await manager.closeAll();
  }
});

test.each(["cancel", "overflow", "cancel-overflow"] as const)(
  "preserves exit-drain evidence across %s",
  async (mode) => {
    const controller = new AbortController();
    const injected = createInjectedProcess({
      onWrite: (text, control) => {
        if (!text.includes("!echo __REA_COMMAND_COMPLETE_")) return;
        setImmediate(() => {
          control.output("before exit\0");
          control.exitLeader();
          setImmediate(() => {
            control.output("after exit\0");
            if (mode.includes("overflow"))
              control.output("late\0".repeat(4096));
            if (mode.includes("cancel")) controller.abort();
            control.closeOutput();
          });
        });
      },
    });
    const manager = createRizinTestManager(
      {},
      { spawnProcess: injected.spawnProcess },
    );
    try {
      const started = await manager.start({
        path: "fixture.bin",
        inferior_tty: await rizinTestInferiorTty(),
      });
      if (!started.ok) throw started.error;
      const result = await manager.execute(
        started.value.session_id,
        "dr",
        controller.signal,
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected interrupted command");
      const expected = mode.includes("overflow")
        ? [
            "before exit",
            "after exit",
            ...Array<string>(4094).fill("late"),
          ].join("\n")
        : "before exit\nafter exit";
      expect(result.error.partialObservation).toMatchObject({
        normalized_result: {
          output: expected,
          output_truncated: mode.includes("overflow"),
          completion_status: "unknown",
        },
        raw_result: { output: expected },
      });
      expect(manager.status(started.value.session_id)?.state).toBe("closed");
    } finally {
      injected.control.exit();
      await manager.closeAll();
    }
  },
);

test.each(["before-wait", "during-wait"])(
  "preserves accepted bytes on stdin failure %s",
  async (mode) => {
    const injected = createInjectedProcess({
      onWrite: (text, control) => {
        if (!text.includes("!echo __REA_COMMAND_COMPLETE_")) return;
        const fail = () => {
          control.output("accepted diagnostic Ω");
          control.stdinError();
        };
        if (mode === "before-wait") fail();
        else setImmediate(fail);
      },
    });
    const manager = createRizinTestManager(
      {},
      { spawnProcess: injected.spawnProcess },
    );
    try {
      const started = await manager.start({
        path: "fixture.bin",
        inferior_tty: await rizinTestInferiorTty(),
      });
      if (!started.ok) throw started.error;
      const result = await manager.execute(started.value.session_id, "dr");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected stdin protocol failure");
      expect(result.error.partialObservation).toMatchObject({
        normalized_result: {
          output: "accepted diagnostic Ω",
          output_truncated: false,
          completion_status: "unknown",
        },
      });
    } finally {
      injected.control.exit();
      await manager.closeAll();
    }
  },
);

test("marks output discarded by the byte queue limit during exit drainage", async () => {
  const size = 1024 * 1024;
  const injected = createInjectedProcess({
    onWrite: (text, control) => {
      if (!text.includes("!echo __REA_COMMAND_COMPLETE_")) return;
      setImmediate(() => {
        control.output("before exit\0");
        control.exitLeader();
        setImmediate(() => {
          const frame = Buffer.alloc(size + 1, "x");
          frame[size] = 0;
          for (let index = 0; index < 5; index += 1) control.output(frame);
          control.closeOutput();
        });
      });
    },
  });
  const manager = createRizinTestManager(
    {},
    { spawnProcess: injected.spawnProcess },
  );
  try {
    const started = await manager.start({
      path: "fixture.bin",
      inferior_tty: await rizinTestInferiorTty(),
    });
    if (!started.ok) throw started.error;
    const result = await manager.execute(started.value.session_id, "dr");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected bounded queue failure");
    const observation = result.error.partialObservation;
    expect(observation).toMatchObject({
      normalized_result: {
        output_truncated: true,
        completion_status: "unknown",
      },
    });
    const output = toolContract("rizin_debug_command").outputSchema.parse(
      observation,
    ).normalized_result.output;
    const frames = output.split("\n");
    expect(frames.map((frame) => frame.length)).toEqual([
      "before exit".length,
      size,
      size,
      size,
      size,
    ]);
    expect(frames.shift()).toBe("before exit");
    expect(frames.every((frame) => /^x+$/u.test(frame))).toBe(true);
  } finally {
    injected.control.exit();
    await manager.closeAll();
  }
});

test("publishes the bounded prefix when an oversized frame has no terminator", async () => {
  const injected = createInjectedProcess({
    onWrite: (text, control) => {
      if (text.includes("!echo __REA_COMMAND_COMPLETE_"))
        setImmediate(() =>
          control.output(Buffer.alloc(16 * 1024 * 1024 + 1, "x")),
        );
    },
  });
  const manager = createRizinTestManager(
    {},
    {
      spawnProcess: injected.spawnProcess,
      maxCommandOutputBytes: 20,
      frameTimeoutMs: 100,
    },
  );
  try {
    const started = await manager.start({
      path: "fixture.bin",
      inferior_tty: await rizinTestInferiorTty(),
    });
    if (!started.ok) throw started.error;
    const result = await manager.execute(started.value.session_id, "dr");
    if (!result.ok) throw result.error;
    expect(result.value.evidence).toMatchObject({
      normalized_result: {
        output: "x".repeat(20),
        output_truncated: true,
        completion_status: "unknown",
      },
    });
  } finally {
    injected.control.exit();
    await manager.closeAll();
  }
});
