import { expect, it, vi } from "vitest";

import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";

it.each(["first", "last"] as const)(
  "rejects an ambiguous advertised schema when the duplicate is %s",
  async (position) => {
    const { client } = await createApplicationMcpHarness();
    const schemas = await advertisedMcpToolSchemas(client, "binary_session");
    const result = await client.callTool(
      { name: "binary_session", arguments: {} },
      { toolDefinition: schemas.toolDefinition },
    );
    expect(result.isError).not.toBe(true);
    expect(
      schemas.ajv.validate(schemas.outputSchema, result.structuredContent),
    ).toBe(true);
    expect(schemas.ajv.validate(schemas.outputSchema, { bogus: true })).toBe(
      false,
    );

    const listing = await client.listTools();
    const permissive = {
      ...schemas.toolDefinition,
      outputSchema: { type: "object" },
    };
    expect(schemas.ajv.validate(permissive.outputSchema, { bogus: true })).toBe(
      true,
    );
    vi.spyOn(client, "listTools").mockResolvedValue({
      ...listing,
      tools:
        position === "first"
          ? [permissive, ...listing.tools]
          : [...listing.tools, permissive],
    });

    await expect(
      advertisedMcpToolSchemas(client, "binary_session"),
    ).rejects.toThrow("binary_session has multiple advertised definitions");
  },
);
