import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";

import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";

const provider = { id: "fixed-fixture", name: "Fixed fixture", version: "1" };

const inventory = [
  { address: "0x1000", value: "foo" },
  { address: "0x1000", value: "bar" },
  { address: "0x1000", value: "bar" },
  { address: "0x1000", value: "shared" },
  { address: "0x2000", value: "other" },
  { address: "0x2000", value: "shared" },
  { address: "0x3000", value: "later" },
  { address: "0x3000", value: "later" },
  { address: "0x1000", value: "later" },
];

const completeProcedure = async (client: Client, value: string) =>
  (
    await client.complete({
      ref: { type: "ref/prompt", name: "investigate_feature" },
      argument: { name: "procedure", value },
    })
  ).completion;

it.each([false, true])(
  "completes every uniquely named procedure across inventory order (reversed: %s)",
  async (reversed) => {
    const rows = reversed ? [...inventory].reverse() : inventory;
    const server = createServer({
      kind: "fixed",
      analysis: {
        execute: async (operation) =>
          ok(
            createAnalysisExecution(
              operation === "list_procedures" ? rows : null,
              provider,
            ),
          ),
      },
    });
    const client = new Client({ name: "procedure-completion", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listed = await client.callTool({
        name: "list_procedures",
        arguments: {},
      });
      expect(listed.isError).not.toBe(true);
      expect(listed.structuredContent).toMatchObject({
        normalized_result: rows,
      });

      expect(await completeProcedure(client, "")).toEqual({
        values: ["0x1000", "0x2000", "0x3000", "bar", "foo", "other"],
        total: 6,
        hasMore: false,
      });
      expect(await completeProcedure(client, "bar")).toEqual({
        values: ["bar"],
        total: 1,
        hasMore: false,
      });
      expect(await completeProcedure(client, "foo")).toEqual({
        values: ["foo"],
        total: 1,
        hasMore: false,
      });
      expect(await completeProcedure(client, "shared")).toEqual({
        values: [],
        total: 0,
        hasMore: false,
      });
      expect(await completeProcedure(client, "later")).toEqual({
        values: [],
        total: 0,
        hasMore: false,
      });
    } finally {
      await client.close();
      await server.close();
    }
  },
);

it("evaluates later alias rows before the MCP completion limit is applied", async () => {
  const rows = Array.from({ length: 120 }, (_, index) => ({
    address: `entry:${String(index)}`,
    value: `name_${String(index).padStart(3, "0")}`,
  }));
  rows.push(
    { address: "entry:0", value: "late_alias" },
    { address: "entry:119", value: "name_000" },
  );
  const server = createServer({
    kind: "fixed",
    analysis: {
      execute: async () => ok(createAnalysisExecution(rows, provider)),
    },
  });
  const client = new Client({
    name: "large-completion-inventory",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(await completeProcedure(client, "name_")).toEqual({
      values: Array.from(
        { length: 100 },
        (_, index) => `name_${String(index + 1).padStart(3, "0")}`,
      ),
      total: 119,
      hasMore: true,
    });
    expect(await completeProcedure(client, "name_000")).toEqual({
      values: [],
      total: 0,
      hasMore: false,
    });
    expect(await completeProcedure(client, "LATE_A")).toEqual({
      values: ["late_alias"],
      total: 1,
      hasMore: false,
    });
    expect(await completeProcedure(client, "entry:119")).toEqual({
      values: ["entry:119"],
      total: 1,
      hasMore: false,
    });
  } finally {
    await client.close();
    await server.close();
  }
});
