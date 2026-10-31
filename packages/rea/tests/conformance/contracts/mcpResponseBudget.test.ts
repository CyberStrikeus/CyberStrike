import { describe, expect, it } from "vitest";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";

import {
  MINIMUM_RESPONSE_BYTES,
  nodeStringCeilingRecovery,
  parseMcpResponseBudget,
  stdioResponseBudgetRecovery,
} from "../../../src/config/mcpResponseBudget.js";

describe("MCP response budget configuration", () => {
  it("requires the override to accommodate the pinned transport's default frames", () => {
    expect(
      parseMcpResponseBudget(String(STDIO_DEFAULT_MAX_BUFFER_SIZE)).ok,
    ).toBe(true);
    expect(
      parseMcpResponseBudget(String(STDIO_DEFAULT_MAX_BUFFER_SIZE - 1)).ok,
    ).toBe(false);
  });

  it("names the effective stdio budget without claiming it raises the string ceiling", () => {
    expect(MINIMUM_RESPONSE_BYTES).toBe(10_485_760);
    const reserved = 536_869_864;
    const nodeCeiling = 536_870_888;
    const recovery = stdioResponseBudgetRecovery(
      20_971_520,
      reserved,
      nodeCeiling,
    );
    expect(recovery).toMatch(/REA_MCP_MAX_RESPONSE_BYTES[^.]*20971520 bytes/u);
    expect(recovery).toMatch(/floor 10485760 bytes, 10 MiB/u);
    expect(recovery).toMatch(/restart\w* the REA process/u);
    const nodeRecovery = nodeStringCeilingRecovery(reserved, nodeCeiling);
    expect(nodeRecovery).toMatch(/below Node's single-string ceiling/u);
    for (const guidance of [recovery, nodeRecovery]) {
      expect(guidance).toMatch(
        new RegExp(
          `REA's reserved single-string limit [^.]*${String(reserved)} UTF-16 code units`,
          "u",
        ),
      );
      expect(guidance).toMatch(
        new RegExp(
          `Node's single-string ceiling [^.]*${String(nodeCeiling)} UTF-16 code units`,
          "u",
        ),
      );
      expect(guidance).toContain("REA_MCP_MAX_RESPONSE_BYTES");
      expect(guidance).toMatch(/does not raise/u);
      expect(guidance).toMatch(/no runtime override/u);
    }
  });

  it.each(["", "1.5", "1e8", " 10485760", "9007199254740992"])(
    "rejects malformed or unusable budgets: %j",
    (value) => {
      const parsed = parseMcpResponseBudget(value);
      if (parsed.ok) throw new Error("Expected invalid budget");
      expect(parsed.error.message).toContain("REA_MCP_MAX_RESPONSE_BYTES");
    },
  );
});
