import { afterEach, expect, it } from "vitest";

import { AnalysisCapabilityUnavailableError } from "../../../src/domain/analysisErrorCore.js";
import { err } from "../../../src/domain/result.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { closeEnhancedToolResources, connect } from "./enhancedToolsHarness.js";

afterEach(closeEnhancedToolResources);

for (const [tool, refused] of [
  ["binary_overview", "list_segments"],
  ["get_objc_classes", "inspect_native_dispatch_metadata"],
  ["analyze_swift_types", "list_names"],
] as const)
  for (const incomplete of [false, true])
    it(`${tool} ${incomplete ? "preserves unresolved cleanup" : "permits a clean capability fallback"}`, async () => {
      const refusal = new AnalysisCapabilityUnavailableError(
        "fixture",
        refused,
        "Fixture inventory unavailable",
        incomplete
          ? {
              cleanup: {
                reason: "Fixture owner remains retained",
                resources: ["fixture-inventory-owner"],
              },
            }
          : undefined,
      );
      const client = await connect({
        execute: async (operation) => {
          if (operation === refused) return err(refusal);
          if (operation === "read_binary_inventory_summary")
            return err(
              new AnalysisCapabilityUnavailableError(
                "fixture",
                operation,
                "Use the ordinary inventory fallback",
              ),
            );
          if (operation === "current_document") return observed("fixture");
          if (operation === "list_names")
            return observed([
              { address: "0x1000", value: "_OBJC_CLASS_$_Document" },
            ]);
          if (operation === "list_procedures" || operation === "list_strings")
            return observed([]);
          throw new Error(`Unexpected inventory operation ${operation}`);
        },
      });
      const response = await client.callTool({ name: tool, arguments: {} });
      if (incomplete) {
        expect(response.isError).toBe(true);
        expect(parseMcpToolError(response)).toMatchObject({
          error: {
            code: "cleanup_incomplete",
            details: {
              operation: refused,
              resources: ["fixture-inventory-owner"],
              cleanup_reason: "Fixture owner remains retained",
            },
          },
        });
        expect(refusal.cleanupIncomplete).toBe(true);
      } else expect(response.isError).not.toBe(true);
      await client.ping();
    });
