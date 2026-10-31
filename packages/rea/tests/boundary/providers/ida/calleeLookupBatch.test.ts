import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { IdaOperationRunner } from "../../../../src/ida/IdaOperationRunner.js";
import { IdaSessionClient } from "../../../../src/ida/IdaSessionClient.js";
import { createIdaTarget, RecordingIdaMcp } from "../../../fixtures/idaMcp.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const queriesSchema = z.object({ queries: z.array(z.string()) });
const addresses = Array.from(
  { length: 20 },
  (_, index) => `0x${(0x2000 + index * 16).toString(16)}`,
);
const row = (query: string) => ({
  query,
  fn: {
    address: query === "main" ? "0x1000" : query,
    name: query === "main" ? "main" : `sub_${query}`,
    size: "0x10",
  },
  error: null,
});
const fixture = async () => {
  const { root, target } = await createIdaTarget();
  roots.push(root);
  const producer = new RecordingIdaMcp(target, "headless");
  producer.overrideCall = (name, args) => {
    if (name === "lookup_funcs")
      return queriesSchema.parse(args).queries.map(row).reverse();
    if (name === "callees")
      return [
        {
          callees: [
            ...addresses.map((addr) => ({
              addr,
              name: `callee_${addr}`,
              type: "internal",
            })),
            { addr: addresses[0]!, name: "duplicate", type: "internal" },
            { addr: "0x9000", name: "external", type: "external" },
          ],
          more: false,
        },
      ];
    return undefined;
  };
  return { root, target, producer };
};

describe.each(["modern", "native"] as const)(
  "%s IDA callee lookups",
  (protocol) => {
    it("batches unique internal queries, correlates reordered rows, and retains raw observations", async () => {
      const { producer } = await fixture();
      const runner = new IdaOperationRunner(
        producer,
        protocol,
        "selected-database",
        { x86Only: true },
      );
      expect(
        await runner.run("procedure_callees", { procedure: "main" }),
      ).toEqual(["0x9000", ...addresses]);
      expect(
        producer.calls
          .filter(({ name }) => name === "lookup_funcs")
          .map(({ args }) => args),
      ).toEqual([
        { queries: ["main"], database: "selected-database" },
        { queries: addresses, database: "selected-database" },
      ]);
      expect(runner.raw.map(({ tool }) => tool)).toEqual([
        "lookup_funcs",
        "callees",
        "lookup_funcs",
      ]);
      expect(runner.raw.at(-1)?.result).toEqual(addresses.map(row).reverse());
      expect(runner.relationshipCoverage).toEqual({ status: "complete" });
    });

    it.each([
      "missing",
      "duplicate",
      "unrequested",
      "Not found",
      "Not a function",
      "database unavailable",
    ])("preserves a producer fault for %s batch rows", async (failure) => {
      const { producer } = await fixture();
      const original = producer.overrideCall;
      producer.overrideCall = (name, args) => {
        if (
          name !== "lookup_funcs" ||
          queriesSchema.parse(args).queries.length === 1
        )
          return original?.(name, args);
        const rows = addresses.map(row);
        if (failure === "missing") return rows.slice(1);
        if (failure === "duplicate") return [rows[0]!, ...rows.slice(0, -1)];
        if (failure === "unrequested") return [row("0xdead"), ...rows.slice(1)];
        return [
          { query: addresses[0]!, fn: null, error: failure },
          ...rows.slice(1),
        ];
      };
      const runner = new IdaOperationRunner(producer, protocol, undefined, {
        x86Only: true,
      });
      await expect(
        runner.run("procedure_callees", { procedure: "main" }),
      ).rejects.toMatchObject({ _tag: "AnalysisProtocolError" });
      expect(producer.calls).toHaveLength(3);
      expect(runner.raw).toHaveLength(3);
    });

    it("propagates cancellation after the batch reply without reporting partial success", async () => {
      const { producer } = await fixture();
      const controller = new AbortController();
      producer.beforeCall = async (name, args) => {
        if (
          name === "lookup_funcs" &&
          queriesSchema.parse(args).queries.length > 1
        )
          controller.abort();
      };
      const runner = new IdaOperationRunner(producer, protocol, undefined, {
        x86Only: true,
        signal: controller.signal,
      });
      await expect(
        runner.run("procedure_callees", { procedure: "main" }),
      ).rejects.toMatchObject({ _tag: "AnalysisCancelledError" });
      expect(producer.calls).toHaveLength(3);
      expect(runner.raw.at(-1)?.tool).toBe("lookup_funcs");
    });
  },
);

it("uses the batch through a modern session and preserves complete callee Evidence", async () => {
  const { producer, target, root } = await fixture();
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
  try {
    const result = await client.execute("procedure_callees", {
      procedure: "main",
    });
    if (!result.ok) throw result.error;
    expect(result.value.result).toEqual(["0x9000", ...addresses]);
    expect(result.value.relationshipCoverage).toEqual({ status: "complete" });
    expect(
      producer.calls
        .filter(({ name }) => name === "lookup_funcs")
        .map(({ args }) => queriesSchema.parse(args).queries),
    ).toEqual([["main"], addresses]);
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
});
