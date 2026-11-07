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

const observe = async (
  prefix: string,
  framing: "coalesced" | "separate" | "split-transport",
  maximum?: number,
) => {
  const injected = createInjectedProcess({
    onWrite: (text, control) => {
      const marker = /!echo (.+)\n/u.exec(text)?.[1];
      if (marker === undefined) return;
      setImmediate(() => {
        if (framing === "separate") control.output(`${prefix}\0${marker}\n\0`);
        else if (framing === "split-transport") {
          const bytes = Buffer.from(`${prefix}${marker}\n\0`);
          const split = Math.max(1, Buffer.byteLength(prefix) - 1);
          control.output(bytes.subarray(0, split));
          control.output(bytes.subarray(split));
        } else control.output(`${prefix}${marker}\n\0`);
      });
    },
  });
  const manager = createRizinTestManager(
    {},
    {
      spawnProcess: injected.spawnProcess,
      frameTimeoutMs: 100,
      ...(maximum === undefined ? {} : { maxCommandOutputBytes: maximum }),
    },
  );
  const server = new McpServer({ name: "rizin-output-test", version: "1" });
  registerRizinDebugTools(
    server,
    manager,
    silentLogger,
    createToolResultDelivery(undefined),
  );
  const client = new Client({ name: "rizin-output-test", version: "1" });
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
    return toolContract("rizin_debug_command").outputSchema.parse(
      reply.structuredContent,
    );
  } finally {
    injected.control.exit();
    await client.close();
    await server.close();
    await manager.closeAll();
  }
};

test.each(
  ["value  \n", " \t\r\n", "Ω雪\t\r\n", "", "😀"].flatMap((prefix) =>
    (["coalesced", "separate", "split-transport"] as const).map((framing) => ({
      prefix,
      framing,
    })),
  ),
)(
  "preserves output %j across $framing framing",
  async ({ prefix, framing }) => {
    const evidence = await observe(prefix, framing);
    const expected = {
      output: prefix,
      completion_status: "complete",
      output_truncated: false,
    };
    expect(evidence.normalized_result).toMatchObject(expected);
    expect(evidence.raw_result).toMatchObject(expected);
  },
);

test.each([7, 8])(
  "counts trailing whitespace in the exact %s-byte budget",
  async (maximum) => {
    const evidence = await observe("value  \n", "coalesced", maximum);
    const truncated = maximum < 8;
    const expected = {
      output: truncated ? "value  " : "value  \n",
      output_truncated: truncated,
      completion_status: truncated ? "unknown" : "complete",
    };
    expect(evidence.normalized_result).toMatchObject(expected);
    expect(evidence.raw_result).toMatchObject(expected);
  },
);
