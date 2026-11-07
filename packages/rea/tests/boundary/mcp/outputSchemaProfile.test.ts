import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";
import { expect, it } from "vitest";

import {
  TOOL_CONTRACTS,
  toolContract,
} from "../../../src/contracts/toolContracts.js";
import { COMPACT_OUTPUT_SCHEMA_BUDGET_BYTES } from "../../../src/config/mcpOutputSchemaProfile.js";
import { COMPACT_INPUT_SCHEMA_BUDGET_BYTES } from "../../../src/config/mcpInputSchemaProfile.js";
import type { CompactInputSchemaPresentation } from "../../../src/contracts/compactInputSchema.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import type { ToolContract } from "../../../src/contracts/toolContractTypes.js";
import { FULL_CATALOG_IDENTITY } from "../../../src/catalogIdentity.js";
import type { McpOutputSchemaProfile } from "../../../src/config/mcpOutputSchemaProfile.js";
import { advertisedSchemaErrors } from "../../fixtures/mcpAdvertisedSchemaValidity.js";
import { advertisedInputJsonSchema } from "../../../src/contracts/toolSchemaMetadata.js";

const createServer = (
  outputSchemaProfile: McpOutputSchemaProfile,
  compactInputPresentation:
    | CompactInputSchemaPresentation
    | undefined = undefined,
) =>
  new EvidenceMcpServer(
    { name: "output-schema-fixture", version: "1" },
    { capabilities: {} },
    undefined,
    createToolResultDelivery(10 * 1024 * 1024),
    compactInputPresentation,
    outputSchemaProfile,
  );

it("omits only output schema advertisements and keeps canonical MCP output validation", async () => {
  const server = createServer("off");
  expect(server.catalogIdentity.digests.combined_sha256).not.toBe(
    FULL_CATALOG_IDENTITY.digests.combined_sha256,
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "schema-profile-test", version: "1" });
  const contract = {
    ...toolContract("comment"),
    name: "output_schema_fixture",
    inputSchema: z.strictObject({}),
    outputSchema: z.strictObject({ value: z.string() }),
  } satisfies ToolContract;
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async () => ({
      content: [{ type: "text" as const, text: "fixture" }],
      structuredContent: { value: "complete" },
    }),
  );
  const invalidContract = {
    ...contract,
    name: "invalid_output_schema_fixture",
  } satisfies ToolContract;
  server.registerTool(
    invalidContract.name,
    toolRegistrationOptions(invalidContract),
    async () => ({
      content: [{ type: "text" as const, text: "invalid fixture" }],
      structuredContent: { value: 42 },
    }),
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(2);
    expect(tools.every((tool) => tool.outputSchema === undefined)).toBe(true);
    const success = await client.callTool({
      name: contract.name,
      arguments: {},
    });
    expect(success.isError).not.toBe(true);
    expect(success.structuredContent).toEqual({ value: "complete" });
    const invalid = await client.callTool({
      name: invalidContract.name,
      arguments: {},
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Output validation error"),
      }),
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

it("bounds output schema advertisements and keeps canonical MCP output validation", async () => {
  const server = createServer("compact");
  expect(server.catalogIdentity.digests.combined_sha256).not.toBe(
    FULL_CATALOG_IDENTITY.digests.combined_sha256,
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "compact-output-test", version: "1" });
  const contract = {
    ...toolContract("comment"),
    name: "compact_output_schema_fixture",
    inputSchema: z.strictObject({}),
    outputSchema: z.strictObject({
      value: z.string().describe("Nested guidance leaves."),
      nested: z
        .object({ count: z.number().int() })
        .describe("Nested guidance leaves."),
    }),
  } satisfies ToolContract;
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async () => ({
      content: [{ type: "text" as const, text: "fixture" }],
      structuredContent: { value: "complete", nested: { count: 1 } },
    }),
  );
  const invalidContract = {
    ...contract,
    name: "invalid_compact_output_schema_fixture",
  } satisfies ToolContract;
  server.registerTool(
    invalidContract.name,
    toolRegistrationOptions(invalidContract),
    async () => ({
      content: [{ type: "text" as const, text: "invalid fixture" }],
      structuredContent: { value: 42, nested: { count: 1 } },
    }),
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(2);
    const advertised = tools.find((tool) => tool.name === contract.name)!
      .outputSchema as Record<string, unknown>;
    expect(advertised.type).toBe("object");
    expect(advertised.$id).toBeUndefined();
    expect((advertised.properties as Record<string, unknown>).value).toEqual({
      type: "string",
    });
    expect(
      (advertised.properties as Record<string, unknown>).nested,
    ).toMatchObject({ type: "object" });

    const success = await client.callTool({
      name: contract.name,
      arguments: {},
    });
    expect(success.isError).not.toBe(true);
    expect(success.structuredContent).toEqual({
      value: "complete",
      nested: { count: 1 },
    });
    const invalid = await client.callTool({
      name: invalidContract.name,
      arguments: {},
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Output validation error"),
      }),
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

it("keeps the default compact-input catalog below a measured one-megabyte frame", async () => {
  const compactInput: CompactInputSchemaPresentation = {
    budgetBytes: COMPACT_INPUT_SCHEMA_BUDGET_BYTES,
  };
  const canonicalInputs = new Map<string, Record<string, unknown>>(
    TOOL_CONTRACTS.map((contract) => [
      contract.name,
      advertisedInputJsonSchema(contract),
    ]),
  );
  const measure = async (
    profile: McpOutputSchemaProfile,
    inputPresentation: CompactInputSchemaPresentation | undefined,
  ): Promise<number> => {
    const server = createServer(profile, inputPresentation);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "catalog-size-test", version: "1" });
    for (const contract of TOOL_CONTRACTS)
      server.registerTool(
        contract.name,
        toolRegistrationOptions(contract),
        async () => ({
          content: [{ type: "text" as const, text: "unused" }],
        }),
      );
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(canonicalInputs.size);
      expect(new Set(listed.tools.map((tool) => tool.name))).toEqual(
        new Set(canonicalInputs.keys()),
      );
      if (inputPresentation === undefined)
        for (const tool of listed.tools)
          expect(tool.inputSchema, tool.name).toEqual(
            canonicalInputs.get(tool.name),
          );
      if (profile === "off")
        expect(
          listed.tools.every((tool) => tool.outputSchema === undefined),
        ).toBe(true);
      if (profile === "compact") {
        // Validate the advertised documents as the client receives them, not
        // just their bytes: a projection that broke a reference or left an
        // invalid schema would otherwise still pass the budget assertion.
        expect(
          advertisedSchemaErrors(
            listed.tools.map((tool) => ({
              name: tool.name,
              inputSchema: tool.inputSchema,
              outputSchema: tool.outputSchema,
            })),
          ),
        ).toEqual([]);
        for (const tool of listed.tools) {
          expect(tool.outputSchema).toBeDefined();
          expect(
            Buffer.byteLength(JSON.stringify(tool.outputSchema), "utf8"),
          ).toBeLessThanOrEqual(COMPACT_OUTPUT_SCHEMA_BUDGET_BYTES);
        }
      }
      return Buffer.byteLength(JSON.stringify(listed), "utf8");
    } finally {
      await client.close();
      await server.close();
    }
  };

  const fullBytes = await measure("full", undefined);
  const compactBytes = await measure("compact", compactInput);
  const offBytes = await measure("off", compactInput);
  const fullInputOffBytes = await measure("off", undefined);
  expect(fullBytes).toBeGreaterThan(1024 * 1024);
  expect(compactBytes).toBeLessThan(1024 * 1024);
  expect(offBytes).toBeLessThan(1024 * 1024);
  // Full input is an explicit guidance choice, not the bounded compatibility
  // profile. Omitting output schemas must preserve those complete inputs.
  expect(fullInputOffBytes).toBeGreaterThan(offBytes);
  expect(fullInputOffBytes).toBeLessThan(fullBytes);
  expect(compactBytes).toBeLessThan(fullBytes);
  expect(compactBytes).toBeGreaterThan(offBytes);
});

it("rejects canonical-invalid output that the reduced advertisement accepts", async () => {
  // Enough nested detail that the compact projection cannot inline the
  // canonical schema within the budget, so the advertised form is the shallow
  // root shape rather than the complete validation structure.
  const nestedDetail = Object.fromEntries(
    Array.from({ length: 150 }, (_, index) => [
      `nested_${String(index).padStart(3, "0")}`,
      z.string().optional(),
    ]),
  );
  const outputSchema = z.strictObject({
    value: z.string(),
    payload: z.object({
      inner: z.string(),
      count: z.number().int(),
      ...nestedDetail,
    }),
  });
  const server = createServer("compact");
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "reduced-output-test", version: "1" });
  const contract = {
    ...toolContract("comment"),
    name: "reduced_output_schema_fixture",
    inputSchema: z.strictObject({}),
    outputSchema,
  } satisfies ToolContract;
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async () => ({
      content: [{ type: "text" as const, text: "fixture" }],
      structuredContent: {
        value: "complete",
        payload: { inner: "text", count: 1 },
      },
    }),
  );
  // `payload.inner` is a string canonically. The shallow advertisement keeps
  // only `payload: {type: "object"}`, so it accepts the malformed value.
  const malformed = {
    value: "complete",
    payload: { inner: 42, count: 1 },
  };
  const invalidContract = {
    ...contract,
    name: "invalid_reduced_output_schema_fixture",
  } satisfies ToolContract;
  server.registerTool(
    invalidContract.name,
    toolRegistrationOptions(invalidContract),
    async () => ({
      content: [{ type: "text" as const, text: "invalid fixture" }],
      structuredContent: malformed,
    }),
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = (await client.listTools()).tools;
    const advertised = tools.find((tool) => tool.name === contract.name)!
      .outputSchema as Record<string, unknown>;
    expect(advertised.description).toContain("reduced form");
    expect((advertised.properties as Record<string, unknown>).payload).toEqual({
      type: "object",
    });
    expect(
      Buffer.byteLength(JSON.stringify(advertised), "utf8"),
    ).toBeLessThanOrEqual(COMPACT_OUTPUT_SCHEMA_BUDGET_BYTES);
    // The regression this guards: the advertisement accepts a value the
    // canonical contract rejects, so validating results against the
    // advertisement instead of the contract would deliver malformed output.
    const validateAdvertised = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(advertised);
    expect(validateAdvertised(malformed)).toBe(true);

    const success = await client.callTool({
      name: contract.name,
      arguments: {},
    });
    expect(success.isError).not.toBe(true);
    expect(success.structuredContent).toEqual({
      value: "complete",
      payload: { inner: "text", count: 1 },
    });
    const invalid = await client.callTool({
      name: invalidContract.name,
      arguments: {},
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Output validation error"),
      }),
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
