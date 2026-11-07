import { afterEach, describe, expect, it } from "vitest";

import type { AnalysisOperationPort } from "../../../src/application/AnalysisProvider.js";
import { EnhancedTools } from "../../../src/application/EnhancedTools.js";

import {
  closeEnhancedToolResources,
  connect,
  inventory,
  jsonResult,
} from "./enhancedToolsHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";

afterEach(closeEnhancedToolResources);

describe("enhanced MCP tools", () => {
  it("returns stable unresolved-name results", async () => {
    const tools = new EnhancedTools({
      execute: () => Promise.resolve(ok(inventory({}))),
    });

    const unresolved = await tools.execute("find_xrefs_to_name", {
      name: "missing",
    });

    expect(unresolved).toEqual({
      ok: true,
      value: {
        status: "unresolved",
        name: "missing",
        reason: "name_not_found",
      },
    });
  });

  it("uses every procedure in one complete inventory", async () => {
    const client = await connect({
      execute: () => {
        return Promise.resolve(
          ok([
            { address: "0x1", value: "_TtC5First" },
            { address: "0x2", value: "_TtC4Last" },
          ]),
        );
      },
    });
    const result = jsonResult(
      await client.callTool({ name: "analyze_swift_types", arguments: {} }),
    );
    expect(result).toMatchObject({
      total: 2,
      categories: { classes: { count: 2 } },
    });
  });

  it("returns cancellation when a complete inventory call is cancelled", async () => {
    const controller = new AbortController();
    let calls = 0;
    const analysis: AnalysisOperationPort = {
      execute: () => {
        calls += 1;
        controller.abort();
        return Promise.resolve(ok([{ address: "0x1", value: "_TtC5First" }]));
      },
    };

    const result = await new EnhancedTools(analysis).execute(
      "analyze_swift_types",
      {},
      controller.signal,
    );

    expect(calls).toBe(1);
    if (result.ok) throw new Error("expected cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
  });
});

it("exact-name xrefs preserves ambiguity independently of inventory order and accepts repeated rows", async () => {
  let rows = [
    { address: "0x20", value: "entry" },
    { address: "0x10", value: "entry" },
  ];
  const queried: unknown[] = [];
  const client = await connect({
    execute: async (operation, parameters) => {
      if (operation === "list_names") return ok(rows);
      if (operation === "xrefs") {
        queried.push(parameters.address);
        return ok(["0x90"]);
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  });
  for (const reversed of [false, true]) {
    if (reversed) rows.reverse();
    const rejected = await client.callTool({
      name: "find_xrefs_to_name",
      arguments: { name: "entry" },
    });
    expect(parseMcpToolError(rejected).error).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          expect.objectContaining({
            path: ["name"],
            message: expect.stringContaining("ambiguous at 0x10, 0x20"),
          }),
        ],
      },
    });
  }
  expect(queried).toEqual([]);
  rows = [
    { address: "0x10", value: "entry" },
    { address: "0x10", value: "entry" },
  ];
  expect(
    jsonResult(
      await client.callTool({
        name: "find_xrefs_to_name",
        arguments: { name: "entry" },
      }),
    ),
  ).toMatchObject({ status: "resolved", address: "0x10", xrefs: ["0x90"] });
  expect(queried).toEqual(["0x10"]);
});
