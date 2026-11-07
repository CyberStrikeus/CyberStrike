import { describe, expect, it, expectTypeOf } from "vitest";

import {
  parseMcpToolFamilies,
  type McpToolFamilies,
} from "../../../src/config/mcpToolFamilies.js";
import {
  TOOL_FAMILY_IDS,
  type ToolFamilyId,
} from "../../../src/contracts/toolFamilyIds.js";

describe("MCP tool families configuration", () => {
  it("accepts an unset scope and every valid family selection", () => {
    expect(parseMcpToolFamilies(undefined)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(parseMcpToolFamilies("session")).toEqual({
      ok: true,
      value: ["session"],
    });
    expect(parseMcpToolFamilies("session,application")).toEqual({
      ok: true,
      value: ["session", "application"],
    });
    expect(parseMcpToolFamilies(" session , application ,session ")).toEqual({
      ok: true,
      value: ["session", "application"],
    });
    expect(parseMcpToolFamilies(TOOL_FAMILY_IDS.join(","))).toEqual({
      ok: true,
      value: [...TOOL_FAMILY_IDS],
    });
  });

  it.each(["", " ", ",", "session,typo", "SESSION", "all"])(
    "rejects unknown or empty selections: %j",
    (value) => {
      const parsed = parseMcpToolFamilies(value);
      if (parsed.ok) throw new Error("Expected invalid selection");
      expect(parsed.error.message).toContain("REA_MCP_TOOL_FAMILIES");
    },
  );

  it("retains the published family-id type in the parsed result", () => {
    expectTypeOf<McpToolFamilies>().toEqualTypeOf<ToolFamilyId[]>();
    const parsed = parseMcpToolFamilies("session");
    if (!parsed.ok) throw new Error("Expected valid selection");
    expectTypeOf(parsed.value).toEqualTypeOf<McpToolFamilies | undefined>();
  });
});
