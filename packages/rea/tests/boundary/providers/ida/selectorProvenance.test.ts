import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { EnhancedTools } from "../../../../src/application/EnhancedTools.js";
import { IdaSessionClient } from "../../../../src/ida/IdaSessionClient.js";
import type { JsonValue } from "../../../../src/domain/jsonValue.js";
import { createIdaTarget, RecordingIdaMcp } from "../../../fixtures/idaMcp.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

const entry = { addr: "0x1000", name: "main", size: "0x20" };

/** Headless session where `main` resolves, its external callee 0x2000 is not a function, and `nosuch` is unknown. */
const session = async () => {
  const { root, target } = await createIdaTarget();
  roots.push(root);
  const producer = new RecordingIdaMcp(target, "headless");
  producer.overrideCall = (name, args): JsonValue | undefined => {
    if (name !== "lookup_funcs") return undefined;
    const queries = args.queries;
    const query = Array.isArray(queries) ? String(queries[0]) : "";
    if (query === "main" || query === "0x1000")
      return [{ query, fn: entry, error: null }];
    return [
      {
        query,
        fn: null,
        error: query === "nosuch" ? "Not found" : "Not a function",
      },
    ];
  };
  const client = new IdaSessionClient(
    {
      command: "fixture",
      args: [],
      env: {},
      mode: "headless",
      timeoutMs: 1000,
      workspaceRoot: root,
    },
    target,
    producer,
  );
  return { client, tools: new EnhancedTools(client) };
};

describe("provider-derived selectors in IDA composed workflows", () => {
  it("records an external callee IDA cannot resolve as a producer fault in the call graph", async () => {
    const { client, tools } = await session();
    try {
      const result = await tools.execute("get_call_graph", { address: "main" });

      if (!result.ok) throw result.error;
      expect(
        result.value,
        "the resolved root stays ok and only the derived node carries the producer fault",
      ).toMatchObject({
        graph: {
          "0": [{ address: "0x1000", status: "ok" }],
          "1": [
            {
              address: "0x2000",
              status: "error",
              error: { code: "unreadable_output" },
            },
          ],
        },
        limitations: expect.any(Array),
      });
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("records the same node as a producer fault in the call path", async () => {
    const { client, tools } = await session();
    try {
      const result = await tools.execute("trace_call_path", { start: "main" });

      if (!result.ok) throw result.error;
      expect(
        result.value,
        "the failure belongs to the derived address and is not blamed on the caller",
      ).toMatchObject({
        failures: [{ address: "0x2000", error: { code: "unreadable_output" } }],
      });
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });

  it("keeps the caller's own unknown selector an invalid request in each workflow", async () => {
    const { client, tools } = await session();
    try {
      const graph = await tools.execute("get_call_graph", {
        address: "nosuch",
      });
      const trace = await tools.execute("trace_call_path", { start: "nosuch" });
      const batch = await tools.execute("batch_decompile", {
        addresses: ["nosuch"],
      });

      if (graph.ok || trace.ok) throw new Error("expected invalid requests");
      expect(graph.error._tag, "graph start is caller input").toBe(
        "AnalysisInputError",
      );
      expect(trace.error._tag, "trace start is caller input").toBe(
        "AnalysisInputError",
      );
      if (!batch.ok) throw batch.error;
      expect(
        batch.value,
        "the unresolved batch item and its fallback retry are both caller input",
      ).toMatchObject({
        items: [
          {
            address: "nosuch",
            procedure: {
              status: "unknown",
              error: { code: "invalid_request" },
            },
            status: "error",
            error: { code: "invalid_request" },
          },
        ],
      });
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});
