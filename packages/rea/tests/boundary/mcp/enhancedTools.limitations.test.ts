import { afterEach, expect, it } from "vitest";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { err, ok } from "../../../src/domain/result.js";
import { AnalysisCapabilityUnavailableError } from "../../../src/domain/analysisErrorCore.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connect, closeEnhancedToolResources } from "./enhancedToolsHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

afterEach(closeEnhancedToolResources);

it("retains provider coverage caveats in a composed MCP overview without repeated reads", async () => {
  const calls: string[] = [];
  const limitation = "Companion PDB symbol coverage is unverified.";
  const client = await connect({
    execute: async (operation) => {
      if (operation === "read_binary_inventory_summary")
        return err(
          new AnalysisCapabilityUnavailableError(
            "fixture",
            operation,
            "No native overview",
          ),
        );
      calls.push(operation);
      const value = operation === "current_document" ? "fixture" : [];
      return ok(
        createAnalysisExecution(
          value,
          { id: "fixture", name: "Fixture", version: "1" },
          { limitations: [limitation] },
        ),
      );
    },
  });
  const response = await client.callTool({
    name: "binary_overview",
    arguments: {},
  });
  expect(response.isError).not.toBe(true);
  const evidence = parseEvidence(response.structuredContent);
  expect(evidence.limitations).toEqual([
    "Artifact identity is unavailable for this observation.",
    "Derived by an REA composed workflow.",
    `Fixture (fixture 1) current_document, list_procedures, list_segments, list_strings: ${limitation}`,
  ]);
  expect(evidence.normalized_result).toMatchObject({
    document: "fixture",
    procedure_count: 0,
    string_count: 0,
  });
  expect(calls.length).toBe(new Set(calls).size);
});

it("counts canonical inventory rows in the composed overview without altering labels", async () => {
  const procedures = [
    { address: "0x1000", value: "__proto__" },
    { address: "0x2000", value: "ordinary procedure" },
  ];
  const strings = [{ address: "0x3000", value: "__proto__" }];
  const before = [JSON.stringify(procedures), JSON.stringify(strings)];
  const client = await connect({
    execute: async (operation) => {
      if (operation === "read_binary_inventory_summary")
        return err(
          new AnalysisCapabilityUnavailableError(
            "fixture",
            operation,
            "No native overview",
          ),
        );
      const value =
        operation === "current_document"
          ? "fixture"
          : operation === "list_procedures"
            ? procedures
            : operation === "list_strings"
              ? strings
              : [];
      return ok(
        createAnalysisExecution(value, {
          id: "fixture",
          name: "Fixture",
          version: "1",
        }),
      );
    },
  });
  const response = await client.callTool({
    name: "binary_overview",
    arguments: {},
  });
  expect(response.isError).not.toBe(true);
  const evidence = parseEvidence(response.structuredContent);
  expect(evidence.normalized_result).toMatchObject({
    document: "fixture",
    procedure_count: procedures.length,
    string_count: strings.length,
  });
  expect([JSON.stringify(procedures), JSON.stringify(strings)]).toEqual(before);
});

it.each(["list_procedures", "list_strings"])(
  "refuses legacy %s dictionaries instead of declaring a complete overview",
  async (invalidOperation) => {
    const client = await connect({
      execute: async (operation) => {
        if (operation === "read_binary_inventory_summary")
          return err(
            new AnalysisCapabilityUnavailableError(
              "fixture",
              operation,
              "No native overview",
            ),
          );
        return ok(
          createAnalysisExecution(
            operation === "current_document"
              ? "fixture"
              : operation === invalidOperation
                ? { "0x1000": "legacy" }
                : [],
            { id: "fixture", name: "Fixture", version: "1" },
          ),
        );
      },
    });
    const response = await client.callTool({
      name: "binary_overview",
      arguments: {},
    });
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "unreadable_output",
      details: {
        operation: invalidOperation,
      },
    });
  },
);
