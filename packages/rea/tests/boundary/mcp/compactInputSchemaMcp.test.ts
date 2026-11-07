import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import {
  TOOL_CONTRACTS,
  toolContract,
} from "../../../src/contracts/toolContracts.js";
import { PROMPT_CONTRACTS } from "../../../src/contracts/promptContracts.js";
import { advertisedInputJsonSchema } from "../../../src/contracts/toolSchemaMetadata.js";
import { presentAdvertisedInputSchema } from "../../../src/contracts/compactInputSchema.js";
import { createCatalogDigests } from "../../../src/catalogIdentity.js";
import {
  schemaArrays,
  schemaChildren,
  schemaMaps,
} from "../../../src/contracts/jsonSchemaKeywords.js";
import {
  COMPACT_INPUT_SCHEMA_BUDGET_BYTES,
  parseMcpInputSchemaProfile,
} from "../../../src/config/mcpInputSchemaProfile.js";
import { processScenarioSchema } from "../../../src/domain/process/processScenario.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";
import { createTestMcp } from "../../support/mcp/mcpFixture.js";
import {
  arrayItemSchemaError,
  strictGatewayItemSchemaErrors,
  unsupportedInputLiteralSchemaError,
} from "../../fixtures/mcpClientSchemaConstraints.js";

interface AdvertisedTool {
  readonly name: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown> | undefined;
  readonly description?: string | undefined;
}

const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

const schemaDepth = (value: unknown, depth = 0): number => {
  if (Array.isArray(value))
    return Math.max(
      depth,
      ...value.map((child) => schemaDepth(child, depth + 1)),
    );
  if (typeof value !== "object" || value === null) return depth;
  return Math.max(
    depth,
    ...Object.values(value).map((child) => schemaDepth(child, depth + 1)),
  );
};

const unsupportedDependencyKeywords = (
  schema: unknown,
  path = "$",
): readonly string[] => {
  if (Array.isArray(schema))
    return schema.flatMap((child, index) =>
      unsupportedDependencyKeywords(child, `${path}[${index}]`),
    );
  if (typeof schema !== "object" || schema === null) return [];
  return Object.entries(schema).flatMap(([key, value]) => {
    const childPath = `${path}.${key}`;
    if (key === "dependencies" || key === "dependentRequired")
      return [childPath];
    if (["const", "enum", "default", "examples"].includes(key)) return [];
    if (schemaMaps.has(key) && typeof value === "object" && value !== null)
      return Object.entries(value).flatMap(([name, child]) =>
        unsupportedDependencyKeywords(child, `${childPath}.${name}`),
      );
    if (schemaArrays.has(key) && Array.isArray(value))
      return unsupportedDependencyKeywords(value, childPath);
    if (schemaChildren.has(key))
      return unsupportedDependencyKeywords(value, childPath);
    return [];
  });
};

const listToolsThroughTransport = async (
  server: EvidenceMcpServer,
): Promise<readonly AdvertisedTool[]> => {
  const mcp = createTestMcp();
  onTestFinished(() => mcp.close());
  const client = await mcp.connect(server, {
    name: "compact-profile",
    version: "0",
  });
  return (await client.listTools()).tools;
};

const registerCatalog = (server: EvidenceMcpServer): void => {
  for (const contract of TOOL_CONTRACTS)
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async () => ({ content: [] }),
    );
};

const compactServer = (): EvidenceMcpServer =>
  new EvidenceMcpServer(
    { name: "compact-profile", version: "0" },
    { capabilities: {} },
    undefined,
    createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
    { budgetBytes: COMPACT_INPUT_SCHEMA_BUDGET_BYTES },
  );

const fullServer = (): EvidenceMcpServer =>
  new EvidenceMcpServer(
    { name: "full-profile", version: "0" },
    { capabilities: {} },
    undefined,
    createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
  );

describe("MCP compact input schema profile", () => {
  it("matches profile digests to tools/list and excludes stripped annotations", async () => {
    const compactPresentation = {
      budgetBytes: COMPACT_INPUT_SCHEMA_BUDGET_BYTES,
    };
    const full = fullServer();
    const compact = compactServer();
    registerCatalog(full);
    registerCatalog(compact);
    const [fullTools, compactTools] = await Promise.all([
      listToolsThroughTransport(full),
      listToolsThroughTransport(compact),
    ]);
    const toolsByName = [
      new Map(fullTools.map((tool) => [tool.name, tool])),
      new Map(compactTools.map((tool) => [tool.name, tool])),
    ];
    for (const [index, presentation] of [
      undefined,
      compactPresentation,
    ].entries()) {
      for (const contract of TOOL_CONTRACTS) {
        expect(toolsByName[index]?.get(contract.name)?.inputSchema).toEqual(
          presentAdvertisedInputSchema(
            advertisedInputJsonSchema(contract),
            presentation,
          ),
        );
      }
    }

    const fullIdentity = createCatalogDigests();
    const compactIdentity = createCatalogDigests(
      TOOL_CONTRACTS,
      PROMPT_CONTRACTS,
      compactPresentation,
    );
    expect(full.catalogIdentity.digests).toEqual(fullIdentity);
    expect(compact.catalogIdentity.digests).toEqual(compactIdentity);
    expect(compactIdentity.tools_sha256).not.toBe(fullIdentity.tools_sha256);
    expect(
      createCatalogDigests(TOOL_CONTRACTS, PROMPT_CONTRACTS, {
        budgetBytes: 1,
      }).tools_sha256,
    ).not.toBe(compactIdentity.tools_sha256);

    const withoutExamples = TOOL_CONTRACTS.map((contract) =>
      contract.examples.length === 0 ? contract : { ...contract, examples: [] },
    );
    expect(createCatalogDigests(withoutExamples).tools_sha256).not.toBe(
      fullIdentity.tools_sha256,
    );
    expect(
      createCatalogDigests(
        withoutExamples,
        PROMPT_CONTRACTS,
        compactPresentation,
      ).tools_sha256,
    ).toBe(compactIdentity.tools_sha256);
  });
});

it("advertises every tool input schema within the provider budget", async () => {
  const server = compactServer();
  registerCatalog(server);
  const tools = await listToolsThroughTransport(server);
  expect(tools.map(({ name }) => name).sort()).toEqual(
    TOOL_CONTRACTS.map(({ name }) => name).sort(),
  );
  const oversized = tools.filter(
    ({ inputSchema }) =>
      serializedBytes(inputSchema) > COMPACT_INPUT_SCHEMA_BUDGET_BYTES,
  );
  expect(oversized.map(({ name }) => name)).toEqual([]);
  const tooDeep = tools.filter(
    ({ inputSchema }) => schemaDepth(inputSchema) > 10,
  );
  expect(
    tooDeep.map(({ name, inputSchema }) => [name, schemaDepth(inputSchema)]),
  ).toEqual([]);
  expect(
    tools.flatMap(({ name, inputSchema }) =>
      strictGatewayItemSchemaErrors(inputSchema, name),
    ),
  ).toEqual([]);
});

it("keeps output schemas and tool descriptions identical to the default profile", async () => {
  const compact = compactServer();
  const full = fullServer();
  registerCatalog(compact);
  registerCatalog(full);
  const [compactTools, fullTools] = await Promise.all([
    listToolsThroughTransport(compact),
    listToolsThroughTransport(full),
  ]);
  const fullByName = new Map(fullTools.map((tool) => [tool.name, tool]));
  expect(compactTools.length).toBe(fullTools.length);
  for (const tool of compactTools) {
    const reference = fullByName.get(tool.name);
    if (reference === undefined) throw new Error(`Missing ${tool.name}`);
    expect(tool.outputSchema, tool.name).toEqual(reference.outputSchema);
    expect(tool.description, tool.name).toBe(reference.description);
  }
});

it("detects missing client-required items in nested array alternatives", () => {
  const malformed = {
    type: "object",
    properties: {
      payload: {
        type: ["null", "array"],
        items: { type: ["string", "array"] },
      },
    },
  };
  expect(arrayItemSchemaError(malformed, "injected")).toBe(
    "injected.properties.payload.items: tool parameters array type must have items",
  );
  // `items: false` is valid JSON Schema, but the targeted Copilot
  // normalizer rejects it because it requires a truthy items schema.
  expect(arrayItemSchemaError({ type: "array", items: false }, "closed")).toBe(
    "closed: tool parameters array type must have items",
  );
});

it("detects item schemas Gemini declarations reject in schema positions only", () => {
  // The #5201 report: `properties[functions].items.items: field predicate
  // failed: $type == Type.ARRAY` for an any-value element type list.
  expect(
    strictGatewayItemSchemaErrors(
      {
        type: "object",
        properties: {
          functions: {
            type: "array",
            items: {
              type: ["null", "boolean", "object", "array", "number", "string"],
              items: {},
            },
          },
          actions: {
            type: "array",
            items: { oneOf: [{ type: "object" }, { type: "string" }] },
          },
          nested: {
            type: "array",
            items: { type: "array", items: { type: "string" } },
          },
        },
        default: { items: {} },
        examples: [{ items: {} }],
      },
      "injected",
    ),
  ).toEqual([
    'injected.properties.functions.items.items is beside type ["null","boolean","object","array","number","string"]',
    "injected.properties.actions.items is an untyped union",
  ]);
});

it("preserves arbitrary nested JSON values at the converted SDK boundary", async () => {
  const contract = {
    ...toolContract("binary_session"),
    inputSchema: z.strictObject({ value: z.unknown() }),
  };
  const value = {
    deeply_nested: [[[[null, true, 7, "text"]]], { mixed: [[], [false]] }],
  };
  for (const profile of ["full", "compact"] as const) {
    const server = profile === "full" ? fullServer() : compactServer();
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async () => ({ content: [] }),
    );
    const tool = (await listToolsThroughTransport(server)).find(
      ({ name }) => name === contract.name,
    );
    if (tool === undefined) throw new Error("Probe tool was not advertised");
    const validate = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(tool.inputSchema);
    expect(contract.inputSchema.safeParse({ value }).success).toBe(true);
    expect(validate({ value }), `${profile} profile`).toBe(true);
  }
});

it("keeps SDK-converted schemas valid and accepting canonical examples", async () => {
  let checkedFullRestrictions = false;
  for (const profile of ["full", "compact"] as const) {
    const server = profile === "full" ? fullServer() : compactServer();
    registerCatalog(server);
    const tools = await listToolsThroughTransport(server);
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const contractsByName = new Map<string, (typeof TOOL_CONTRACTS)[number]>(
      TOOL_CONTRACTS.map((contract) => [contract.name, contract]),
    );
    for (const tool of tools) {
      expect(
        arrayItemSchemaError(tool.inputSchema, tool.name),
        `${profile} profile: ${tool.name}`,
      ).toBeUndefined();
      expect(
        unsupportedInputLiteralSchemaError(tool.inputSchema, tool.name),
      ).toBeUndefined();
      expect(
        ajv.validateSchema(tool.inputSchema),
        `${profile} profile, ${tool.name}: ${ajv.errorsText(ajv.errors)}`,
      ).toBe(true);
      const contract = contractsByName.get(tool.name);
      const validate = ajv.compile(tool.inputSchema);
      for (const example of contract?.examples ?? [])
        expect(
          validate(example.input),
          `${profile} profile, ${tool.name}: ${example.title}`,
        ).toBe(true);
    }
    if (profile === "full") {
      const adb = tools.find(({ name }) => name === "start_adb_activity");
      const managed = tools.find(
        ({ name }) => name === "inspect_managed_members",
      );
      const wasm = tools.find(({ name }) => name === "inspect_wasm_artifact");
      if (adb === undefined || managed === undefined || wasm === undefined)
        throw new Error("Missing ADB, managed member, or WASM inspection tool");
      const validateAdb = ajv.compile(adb.inputSchema);
      const activity = {
        serial: "emulator-5554",
        action: "android.intent.action.MAIN",
      };
      expect(
        validateAdb({
          ...activity,
          extras: [
            { key: "bool", type: "boolean", value: "false" },
            { key: "int", type: "int", value: "-3" },
            { key: "long", type: "long", value: "9007199254740993" },
            { key: "float", type: "float", value: "-1.25" },
          ],
        }),
      ).toBe(true);
      for (const [type, value] of [
        ["boolean", ""],
        ["boolean", "yes"],
        ["int", "1.5"],
        ["long", ""],
        ["float", "garbage"],
      ])
        expect(
          validateAdb({
            ...activity,
            extras: [{ key: "invalid", type, value }],
          }),
          `${type}: ${value}`,
        ).toBe(false);
      const validateManaged = ajv.compile(managed.inputSchema);
      expect(
        validateManaged({
          path: "/artifacts/program.dll",
          type_names: ["Fixture.Program", "Missing.Type"],
        }),
      ).toBe(true);
      expect(
        validateManaged({
          path: "/artifacts/program.dll",
          type_names: ["Fixture.Program", "Fixture.Program"],
        }),
      ).toBe(false);
      const validateWasm = ajv.compile(wasm.inputSchema);
      expect(
        validateWasm({ path: "/artifacts/program", detail: "summary" }),
      ).toBe(true);
      expect(
        validateWasm({ path: "/artifacts/program", detail: "brief" }),
      ).toBe(false);
      for (const command_timeout_ms of [1, 42_000, 2_147_483_647])
        expect(
          validateWasm({ path: "/artifacts/program", command_timeout_ms }),
        ).toBe(true);
      for (const command_timeout_ms of [
        0,
        -1,
        1.5,
        2_147_483_648,
        "1000",
        null,
      ])
        expect(
          validateWasm({ path: "/artifacts/program", command_timeout_ms }),
          String(command_timeout_ms),
        ).toBe(false);
      checkedFullRestrictions = true;
    }
  }
  expect(checkedFullRestrictions).toBe(true);
});

it("omits Gemini-unsupported dependency keywords from both catalog profiles", async () => {
  const full = fullServer();
  const compact = compactServer();
  registerCatalog(full);
  registerCatalog(compact);
  const [fullTools, compactTools] = await Promise.all([
    listToolsThroughTransport(full),
    listToolsThroughTransport(compact),
  ]);
  for (const tools of [fullTools, compactTools])
    expect(
      tools.flatMap(({ name, inputSchema }) =>
        unsupportedDependencyKeywords(inputSchema).map(
          (path) => `${name}${path.slice(1)}`,
        ),
      ),
    ).toEqual([]);
  const sqlite = fullTools.find(
    ({ name }) => name === "inspect_sqlite_database",
  );
  expect(sqlite?.inputSchema.description).toContain(
    "When row_limit is provided, also provide table.",
  );
  for (const tools of [fullTools, compactTools])
    expect(
      tools.find(({ name }) => name === "inspect_sqlite_database")?.inputSchema
        .description,
    ).toContain("When schema_scope is selected_table, also provide table.");
});

it("retains parameter types and avoids client-side reference expansion", async () => {
  const server = compactServer();
  registerCatalog(server);
  const tools = await listToolsThroughTransport(server);
  for (const tool of tools) {
    // Kimi Code 2.1.1 expands references and defaults description-only
    // properties to string. Inline schemas with explicit shallow types
    // avoid both conversions for the structurally oversized tools.
    expect(JSON.stringify(tool.inputSchema), tool.name).not.toContain(
      '"$ref":',
    );
  }
  const comparison = tools.find(
    ({ name }) => name === "compare_managed_members",
  );
  expect(comparison?.inputSchema.properties).toMatchObject({
    left: { type: "object" },
  });
  const ledger = tools.find(
    ({ name }) => name === "build_reconstruction_obligation_ledger",
  );
  expect(ledger?.inputSchema.properties).toMatchObject({
    evidence_bundle: { type: "object" },
    reviewed_obligations: { type: "array" },
    manifest: { type: "object" },
  });
  const coverage = tools.find(
    ({ name }) => name === "evaluate_reconstruction_coverage",
  );
  expect(coverage?.inputSchema.properties).toMatchObject({
    coverage: { type: "object" },
    boundary_id: { type: "string" },
  });
});

it("parses the profile selection the server startup reads", () => {
  expect(parseMcpInputSchemaProfile("compact")).toEqual({
    ok: true,
    value: "compact",
  });
  expect(parseMcpInputSchemaProfile("surprise")).not.toHaveProperty("value");
});

describe("MCP compact input schema canonical enforcement", () => {
  it("still rejects canonical-invalid arguments the compact advertisement accepts", async () => {
    const server = compactServer();
    const contract = TOOL_CONTRACTS.find(
      ({ name }) => name === "capture_process_scenario",
    );
    if (contract === undefined)
      throw new Error("Process capture contract was not registered");
    let handlerCalled = false;
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async () => {
        handlerCalled = true;
        return {
          content: [{ type: "text" as const, text: "handler ran" }],
          isError: true,
        };
      },
    );
    const mcp = createTestMcp();
    onTestFinished(() => mcp.close());
    const client = await mcp.connect(server, {
      name: "compact-validation",
      version: "0",
    });
    const advertised = (await client.listTools()).tools.find(
      ({ name }) => name === contract.name,
    );
    if (advertised === undefined)
      throw new Error("Process capture tool was not advertised");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const validate = ajv.compile(advertised.inputSchema);
    const valid = { executable: "node", environment: { APP_MODE: "test" } };
    const reserved = {
      executable: "node",
      environment: { REA_PROCESS_RUN_ID: "caller-value" },
    };
    expect(validate(valid)).toBe(true);
    expect(processScenarioSchema.safeParse(valid).success).toBe(true);
    expect(processScenarioSchema.safeParse(reserved).success).toBe(false);
    const result = await client.callTool({
      name: contract.name,
      arguments: reserved,
    });
    expect(result.isError).toBe(true);
    expect(handlerCalled).toBe(false);
  });

  it("compacts plain standard schemas that are not Zod instances", async () => {
    // Mirrors registerWebNetworkCaptureTool: a plain standard schema reusing
    // the advertised projection while owning its own permissive validator.
    const server = compactServer();
    const contract = TOOL_CONTRACTS.find(
      ({ name }) => name === "inspect_web_network_capture",
    );
    if (contract === undefined)
      throw new Error("Network capture contract was not registered");
    const registration = toolRegistrationOptions(contract);
    const inputSchema = {
      "~standard": {
        ...registration.inputSchema["~standard"],
        vendor: "rea-application",
        validate: (value: unknown) => ({ value }),
      },
    };
    server.registerTool(
      contract.name,
      { ...registration, inputSchema },
      async () => ({ content: [] }),
    );
    const tools = await listToolsThroughTransport(server);
    const advertised = tools.find(({ name }) => name === contract.name);
    if (advertised === undefined)
      throw new Error("Network capture tool was not advertised");
    expect(serializedBytes(advertised.inputSchema)).toBeLessThanOrEqual(
      COMPACT_INPUT_SCHEMA_BUDGET_BYTES,
    );
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(ajv.validateSchema(advertised.inputSchema)).toBe(true);
  });
});

it.each(["full", "compact"] as const)(
  "preserves nested resource validation through the %s SDK catalog and canonical handler",
  async (profile) => {
    const source = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://example.test/root.json",
      type: "object",
      definitions: {
        value: { type: "string" },
        child: {
          $id: "child.json",
          type: "object",
          definitions: { value: { type: "number" } },
          properties: { value: { $ref: "#/definitions/value" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
      properties: { child: { $ref: "#/definitions/child" } },
      required: ["child"],
      additionalProperties: false,
    };
    const canonical = new Ajv2020({ strict: false }).compile(source);
    const registration = toolRegistrationOptions(
      toolContract("binary_session"),
    );
    const inputSchema = {
      "~standard": {
        ...registration.inputSchema["~standard"],
        vendor: "rea-resource-fixture",
        jsonSchema: {
          ...registration.inputSchema["~standard"].jsonSchema,
          input: () => source,
        },
        validate: (value: unknown) =>
          canonical(value)
            ? { value }
            : { issues: [{ message: "Invalid resource value" }] },
      },
    };
    const server = profile === "compact" ? compactServer() : fullServer();
    let calls = 0;
    server.registerTool("resource_fixture", { inputSchema }, async () => {
      calls++;
      return { content: [{ type: "text", text: "accepted" }] };
    });
    const mcp = createTestMcp();
    onTestFinished(() => mcp.close());
    const client = await mcp.connect(server, {
      name: "resource-scope",
      version: "1",
    });
    const definition = (await client.listTools()).tools.find(
      ({ name }) => name === "resource_fixture",
    );
    if (definition === undefined) throw new Error("Missing resource fixture");
    const advertised = new Ajv2020({ strict: false }).compile(
      definition.inputSchema,
    );
    for (const value of [7, "seven"]) {
      const args = { child: { value } };
      expect(advertised(args)).toBe(canonical(args));
      const result = await client.callTool({
        name: "resource_fixture",
        arguments: args,
      });
      expect(result.isError === true).toBe(!canonical(args));
    }
    expect(calls).toBe(1);
  },
);
