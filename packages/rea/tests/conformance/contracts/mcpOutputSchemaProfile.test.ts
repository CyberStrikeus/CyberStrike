import { describe, expect, it } from "vitest";

import {
  COMPACT_OUTPUT_SCHEMA_BUDGET_BYTES,
  compactPresentationForMcpOutputSchemaProfile,
  parseMcpOutputSchemaProfile,
} from "../../../src/config/mcpOutputSchemaProfile.js";

describe("MCP output schema profile configuration", () => {
  it("accepts the full, compact, and off presentations", () => {
    expect(parseMcpOutputSchemaProfile(undefined)).toEqual({
      ok: true,
      value: undefined,
    });
    for (const value of ["full", "compact", "off"] as const)
      expect(parseMcpOutputSchemaProfile(value)).toEqual({
        ok: true,
        value,
      });
  });

  it.each(["", "FULL", "compact ", "off ", "minimal", "0"])(
    "rejects unknown profiles: %j",
    (value) => {
      const parsed = parseMcpOutputSchemaProfile(value);
      if (parsed.ok) throw new Error("Expected invalid profile");
      expect(parsed.error.message).toContain("REA_MCP_OUTPUT_SCHEMA_PROFILE");
    },
  );

  it("selects a bounded presentation only for compact", () => {
    expect(compactPresentationForMcpOutputSchemaProfile("compact")).toEqual({
      budgetBytes: COMPACT_OUTPUT_SCHEMA_BUDGET_BYTES,
    });
    expect(compactPresentationForMcpOutputSchemaProfile(undefined)).toBe(
      undefined,
    );
    expect(compactPresentationForMcpOutputSchemaProfile("full")).toBe(
      undefined,
    );
    expect(compactPresentationForMcpOutputSchemaProfile("off")).toBe(undefined);
  });
});
