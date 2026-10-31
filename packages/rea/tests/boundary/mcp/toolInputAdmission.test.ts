import type { CallToolResult } from "@modelcontextprotocol/server";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { describe, expect } from "vitest";
import { mcpTest } from "../../support/mcp/mcpFixture.js";

import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import { COMPACT_INPUT_SCHEMA_BUDGET_BYTES } from "../../../src/config/mcpInputSchemaProfile.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";

const createServer = (profile: "full" | "compact"): EvidenceMcpServer =>
  new EvidenceMcpServer(
    { name: "tool-input-admission-test", version: "0" },
    { capabilities: {} },
    undefined,
    createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
    profile === "compact"
      ? { budgetBytes: COMPACT_INPUT_SCHEMA_BUDGET_BYTES }
      : undefined,
  );

// These tests cover the registered SDK boundary with deterministic sentinel
// handlers. They establish canonical rejection before dispatch; they do not
// exercise providers, targets, or the shape of SDK-generated error text.
describe("catalog-wide MCP input admission", () => {
  mcpTest.for(["full", "compact"] as const)(
    "rejects unknown root keys before dispatch with the %s advertised profile",
    async (profile, { mcp }) => {
      const server = createServer(profile);
      const dispatches = new Map<string, number>();
      for (const contract of TOOL_CONTRACTS) {
        server.registerTool(
          contract.name,
          toolRegistrationOptions(contract),
          async (): Promise<CallToolResult> => {
            dispatches.set(
              contract.name,
              (dispatches.get(contract.name) ?? 0) + 1,
            );
            return {
              content: [{ type: "text", text: "sentinel handler reached" }],
              isError: true,
            };
          },
        );
      }

      const client = await mcp.connect(server, {
        name: "tool-input-admission-test",
        version: "0",
      });

      expect(TOOL_CONTRACTS.length).toBeGreaterThan(0);
      for (const contract of TOOL_CONTRACTS) {
        const input = {
          ...contract.examples[0]?.input,
          __rea_unknown_admission_probe__: true,
        };
        expect(contract.inputSchema.safeParse(input).success).toBe(false);

        const result = await client.callTool({
          name: contract.name,
          arguments: input,
        });
        expect(result.isError, contract.name).toBe(true);
        expect(dispatches.has(contract.name), contract.name).toBe(false);
      }

      const firstWithExample = TOOL_CONTRACTS.find(
        (contract) => contract.examples[0] !== undefined,
      );
      const liveExample = firstWithExample?.examples[0];
      if (firstWithExample === undefined || liveExample === undefined)
        throw new Error(
          "No canonical example is available for the liveness check",
        );
      const live = await client.callTool({
        name: firstWithExample.name,
        arguments: liveExample.input,
      });
      expect(live.isError).toBe(true);
      expect(dispatches.get(firstWithExample.name)).toBe(1);
    },
  );
});
