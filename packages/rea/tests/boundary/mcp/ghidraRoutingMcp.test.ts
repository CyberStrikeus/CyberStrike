import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { describe, expect, it } from "vitest";
import { connectGhidraMcp, ghidraFixtureResult } from "./ghidraMcpHarness.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";

describe("Ghidra MCP capability routing", () => {
  it("routes composed and capability tools", async () => {
    const harness = await connectGhidraMcp("ghidra-routing");
    const { calls, mcp } = harness;
    try {
      const batch = await mcp.callTool({
        name: "batch_decompile",
        arguments: { addresses: ["fixture_main"] },
      });
      expect(batch.isError).not.toBe(true);
      expect(batch.structuredContent).toMatchObject({
        normalized_result: {
          succeeded: 1,
          failed: 0,
          items: [{ status: "ok" }],
        },
      });

      const availableNames = (await mcp.listTools()).tools.map(
        ({ name }) => name,
      );
      expect(availableNames).toContain("set_comment");
      const denied = await mcp.callTool({
        name: "set_comment",
        arguments: { address: "0x1000", comment: "must not mutate" },
      });
      expect(denied.isError).toBe(true);
      expect(parseMcpToolError(denied)).toMatchObject({
        error: {
          code: "capability_unavailable",
          category: "unsupported_provider",
        },
      });
      expect(calls).not.toContain("set_comment");

      const status = await mcp.callTool({
        name: "binary_session",
        arguments: {},
      });
      const sessionStatus = toolContract("binary_session").outputSchema.parse(
        status.structuredContent,
      );
      expect(sessionStatus.result).toMatchObject({
        open: true,
        analysis_provider_binding: {
          provider: { id: "ghidra", version: "12.1.4" },
        },
      });
      const availability = expandToolAvailability(
        sessionStatus.result.tool_availability,
      );
      expect(availability).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "binary_overview", available: true }),
          expect.objectContaining({
            name: "get_objc_classes",
            available: true,
          }),
          expect.objectContaining({ name: "batch_decompile", available: true }),
          expect.objectContaining({ name: "trace_feature", available: true }),
          expect.objectContaining({ name: "get_call_graph", available: true }),
          expect.objectContaining({
            name: "find_xrefs_to_name",
            available: true,
          }),
          expect.objectContaining({ name: "set_comment", available: false }),
        ]),
      );
    } finally {
      await harness.close();
    }
  }, 30_000);

  it("keeps a Ghidra null-pseudocode observation's limitations on its batch item", async () => {
    const bodyless = "0x401020";
    const caveat =
      "Ghidra Listing shows a terminal call at 0x401020 without a return.";
    const harness = await connectGhidraMcp(
      "ghidra-batch-null",
      (operation, input) =>
        Promise.resolve(
          ok(
            operation === "procedure_address"
              ? String(input.procedure)
              : operation === "procedure_pseudo_code" &&
                  input.procedure === bodyless
                ? { value: null, limitations: [caveat] }
                : ghidraFixtureResult(operation, input),
          ),
        ),
    );
    try {
      const direct = await harness.mcp.callTool({
        name: "procedure_pseudo_code",
        arguments: { procedure: bodyless },
      });
      expect(direct.isError).not.toBe(true);
      const observed = parseEvidence(direct.structuredContent);
      expect(observed.normalized_result).toBeNull();
      expect(observed.limitations).toContain(caveat);

      const batch = await harness.mcp.callTool({
        name: "batch_decompile",
        arguments: { addresses: ["0x401000", bodyless] },
      });
      expect(batch.isError).not.toBe(true);
      const result = toolContract("batch_decompile").outputSchema.parse(
        batch.structuredContent,
      ).normalized_result;
      expect(result.items[0]).not.toHaveProperty("limitations");
      expect(result).toEqual({
        items: [
          expect.objectContaining({ address: "0x401000", status: "ok" }),
          expect.objectContaining({
            address: bodyless,
            status: "error",
            error: expect.objectContaining({
              code: "capability_unavailable",
              details: expect.objectContaining({ provider_id: "ghidra" }),
            }),
            limitations: [...new Set(observed.limitations)],
          }),
        ],
        total: 2,
        succeeded: 1,
        failed: 1,
      });
    } finally {
      await harness.close();
    }
  }, 30_000);
});
