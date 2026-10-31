import { McpServer } from "@modelcontextprotocol/server";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, expectTypeOf, it } from "vitest";

import { COMPACT_INPUT_SCHEMA_BUDGET_BYTES } from "../../../src/config/mcpInputSchemaProfile.js";
import { presentAdvertisedInputSchema } from "../../../src/contracts/compactInputSchema.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { transformAdvertisedInputJsonSchema } from "../../../src/contracts/toolSchemaMetadata.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";
import { advertisedSchemaErrors } from "../../fixtures/mcpAdvertisedSchemaValidity.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";

describe("Evidence input SDK boundaries", () => {
  it("borrows SDK Evidence inputs while leaving ordinary request constraints active", async () => {
    const contract = toolContract("build_call_path");
    const registration = toolRegistrationOptions(contract);
    const source = Object.defineProperty({}, "normalized_result", {
      get: () => {
        throw new Error("SDK must not clone the unadmitted payload");
      },
    });
    const input = {
      functions: [source],
      start: { address: "0x1000" },
      goal: { address: "0x1001" },
    };
    const validated =
      await registration.inputSchema["~standard"].validate(input);
    expect(validated.issues).toBeUndefined();
    if (validated.issues !== undefined) throw new Error("valid frame rejected");
    expectTypeOf(validated.value.functions[0]).toBeUnknown();
    expect(validated.value.functions[0]).toBe(source);
    const invalid = await registration.inputSchema["~standard"].validate({
      ...input,
      start: { address: 1 },
    });
    expect(invalid.issues).toBeDefined();
  });

  mcpTest.for(["full", "compact"] as const)(
    "advertises valid reference inputs after actual SDK conversion (%s)",
    async (profile, { mcp }) => {
      const contract = toolContract("build_call_path");
      const registration = toolRegistrationOptions(contract);
      const inputSchema =
        profile === "compact"
          ? transformAdvertisedInputJsonSchema(
              registration.inputSchema,
              (schema) =>
                presentAdvertisedInputSchema(schema, {
                  budgetBytes: COMPACT_INPUT_SCHEMA_BUDGET_BYTES,
                }),
            )
          : registration.inputSchema;
      const server = new McpServer({ name: "evidence-contract", version: "1" });
      server.registerTool(contract.name, { inputSchema }, async () => ({
        content: [],
      }));
      const client = await mcp.connect(server, {
        name: "evidence-contract",
        version: "1",
      });
      const { tools } = await client.listTools();
      expect(advertisedSchemaErrors(tools)).toEqual([]);
      const tool = tools.find(({ name }) => name === contract.name);
      if (tool === undefined) throw new Error("named contract not advertised");
      expect(tool.inputSchema.description).toContain(
        '{"kind":"retained-evidence","evidence_id":"ev_..."}',
      );
      expect(tool.inputSchema.description).toContain("parent_evidence_id");
      const validate = new Ajv2020({
        strict: false,
        validateFormats: false,
      }).compile(tool.inputSchema);
      expect(
        validate({
          functions: [
            {
              kind: "retained-evidence",
              evidence_id: `ev_${"a".repeat(64)}`,
            },
          ],
          start: { address: "0x1000" },
          goal: { address: "0x1001" },
        }),
        JSON.stringify(validate.errors),
      ).toBe(true);
    },
  );
});
