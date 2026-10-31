import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { advertisedInputExamples } from "../../../src/contracts/advertisedInputExamples.js";
import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import { emptyArraySchema } from "../../../src/domain/emptyArraySchema.js";
import { processScenarioSchema } from "../../../src/domain/process/processScenario.js";
import { GENERATED_MCP_TOOL_CATALOG } from "../../fixtures/mcpToolCatalog.js";
import {
  arrayItemSchemaError,
  unsupportedInputLiteralSchemaError,
} from "../../fixtures/mcpClientSchemaConstraints.js";
import { advertisedSchemaErrors } from "../../fixtures/mcpAdvertisedSchemaValidity.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";
import { servedCatalog } from "../../../src/application/environment/environmentState.js";
import { servedFrom } from "../../fixtures/environmentStateServing.js";
import type { TimedCaptureRow } from "../../fixtures/analysisView.js";
import {
  BOOK_INIT_ROWS,
  BOOK_NOT_FOUND,
  FIRST_BOOK,
  THIRD_BOOK,
} from "../../fixtures/environmentStateWrites.js";

interface ToolSchemas {
  readonly name: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown> | undefined;
  readonly annotations?: Record<string, unknown> | undefined;
}

function expectStrictInputSchemaParity(
  tools: readonly ToolSchemas[],
  ajv: Ajv2020,
): void {
  const advertised = new Map(tools.map((tool) => [tool.name, tool]));
  const names = [
    "inspect_managed_artifact",
    "inspect_managed_members",
    "inspect_managed_native_boundaries",
    "list_browser_targets",
    "open_binary",
    "close_binary",
    "binary_session",
    "find_changed_behavior",
    "build_call_path",
    "record_unknown",
    "update_unknown",
  ];
  for (const name of names) {
    const contract = TOOL_CONTRACTS.find(
      ({ name: toolName }) => toolName === name,
    );
    const tool = advertised.get(name);
    const example = contract?.examples[0];
    if (contract === undefined || tool === undefined || example === undefined)
      throw new Error(`${name} did not have an advertised example`);
    const malformed = { ...example.input, __unexpected_root_key__: true };
    expect(contract.inputSchema.safeParse(malformed).success, name).toBe(false);
    expect(ajv.compile(tool.inputSchema)(malformed), name).toBe(false);
  }
}

function expectKnownAuthorityHints(tools: readonly ToolSchemas[]): void {
  const advertised = new Map(tools.map((tool) => [tool.name, tool]));
  const expected = {
    read_bytes: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    annotate_native_function: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    unset_bookmark: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    open_binary: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    close_binary: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    start_gdb_session: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    export_web_scripts: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    analyze_javascript_application: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    capture_process_scenario: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    observe_native_calls: {
      readOnlyHint: false,
      destructiveHint: true,
    },
    uninstall_adb_package: {
      readOnlyHint: false,
      destructiveHint: true,
    },
    start_adb_app: {
      readOnlyHint: false,
      destructiveHint: true,
    },
    export_evidence_bundle: {
      readOnlyHint: false,
      destructiveHint: true,
    },
    import_evidence_bundle: {
      readOnlyHint: false,
      destructiveHint: false,
    },
    execute_rizin_command: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  } as const;

  for (const [name, annotations] of Object.entries(expected))
    expect(advertised.get(name), name).toMatchObject({ annotations });
}

function expectMeaningfulPropertyDescriptions(
  schema: unknown,
  path: string,
  root: unknown = schema,
  active: ReadonlySet<string> = new Set(),
): void {
  if (!isRecord(schema)) return;
  if (typeof schema.$ref === "string" && !active.has(schema.$ref))
    expectMeaningfulPropertyDescriptions(
      resolveReference(root, schema.$ref),
      `${path}.${schema.$ref}`,
      root,
      new Set([...active, schema.$ref]),
    );
  if (isRecord(schema.properties)) {
    for (const [property, child] of Object.entries(schema.properties)) {
      // Omit a description rather than restate the property name.
      const description = isRecord(child) ? child.description : undefined;
      if (description !== undefined)
        expect(description, `${path}.${property}`).toEqual(
          expect.not.stringMatching(/^(?:Value for .*)?$/u),
        );
      expectMeaningfulPropertyDescriptions(
        child,
        `${path}.${property}`,
        root,
        active,
      );
    }
  }

  for (const key of ["items", "additionalProperties"])
    if (schema[key] !== undefined)
      expectMeaningfulPropertyDescriptions(schema[key], path, root, active);
  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
    const children = schema[key];
    if (Array.isArray(children))
      children.forEach((child: unknown, index: number) =>
        expectMeaningfulPropertyDescriptions(
          child,
          `${path}.${key}[${index}]`,
          root,
          active,
        ),
      );
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function resolveReference(schema: unknown, reference: string): unknown {
  if (reference === "#") return schema;
  if (!reference.startsWith("#/")) return undefined;
  let value = schema;
  for (const token of reference.slice(2).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (
      typeof value !== "object" ||
      value === null ||
      !Object.hasOwn(value, key)
    )
      return undefined;
    value = Reflect.get(value, key);
  }
  return value;
}

/** Follow SDK-shared local definitions at each schema path component. */
function schemaAt(
  root: unknown,
  path: readonly string[],
  node: unknown = root,
): unknown {
  const resolve = (value: unknown): unknown => {
    while (isRecord(value) && typeof value.$ref === "string")
      value = resolveReference(root, value.$ref);
    return value;
  };
  for (const key of path) {
    node = resolve(node);
    if (!isRecord(node)) return undefined;
    node = node[key];
  }
  return resolve(node);
}

/** Validate retained locals facts through the output schema the SDK actually advertised. */
function expectManagedLocalSignatureSchema(
  tool: ToolSchemas | undefined,
): void {
  const managedOutput = tool?.outputSchema;
  if (managedOutput === undefined)
    throw new Error("Missing managed member output schema");
  const managedAlternatives = schemaAt(managedOutput, [
    "properties",
    "normalized_result",
    "anyOf",
  ]);
  if (!Array.isArray(managedAlternatives))
    throw new Error("Missing managed result alternatives");
  const inventory = managedAlternatives.find(
    (alternative: unknown) =>
      schemaAt(managedOutput, ["properties", "methods"], alternative) !==
      undefined,
  );
  const locals = schemaAt(
    managedOutput,
    [
      "properties",
      "methods",
      "items",
      "properties",
      "body",
      "properties",
      "local_var_signature",
    ],
    inventory,
  );
  if (!isRecord(locals))
    throw new Error("Missing advertised local signature facts");
  const validateLocals = new Ajv2020({
    strict: false,
    validateFormats: false,
  }).compile({
    ...locals,
    $defs: managedOutput.$defs,
  });
  expect(validateLocals(null)).toBe(true);
  expect(
    validateLocals({
      raw_sha256: "a".repeat(64),
      has_context_dependent_types: false,
    }),
  ).toBe(true);
  expect(
    validateLocals({
      raw_sha256: "a".repeat(64),
      has_context_dependent_types: true,
    }),
  ).toBe(true);
  expect(
    validateLocals({
      raw_sha256: "a".repeat(64),
      has_context_dependent_types: "false",
    }),
  ).toBe(false);
  expect(validateLocals({ has_context_dependent_types: false })).toBe(false);
}

function recursiveReferences(tools: readonly ToolSchemas[]): string[] {
  return tools.flatMap((tool) =>
    (["inputSchema", "outputSchema"] as const).flatMap((kind) => {
      const schema = tool[kind];
      const found = new Set<string>();
      const visit = (node: unknown, active: readonly string[]): void => {
        if (typeof node !== "object" || node === null) return;
        for (const [key, child] of Object.entries(node)) {
          if (
            [
              "$defs",
              "definitions",
              "examples",
              "default",
              "const",
              "enum",
            ].includes(key)
          )
            continue;
          if (key !== "$ref" || typeof child !== "string") visit(child, active);
          else if (active.includes(child)) found.add(child);
          else visit(resolveReference(schema, child), [...active, child]);
        }
      };
      visit(schema, []);
      return [...found].map(
        (reference) => `${tool.name}.${kind}: ${reference}`,
      );
    }),
  );
}

const schemaMapKeywords = new Set([
  "$defs",
  "definitions",
  "properties",
  "patternProperties",
  "dependentSchemas",
  "dependencies",
]);
const schemaArrayKeywords = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const schemaChildKeywords = new Set([
  "items",
  "additionalItems",
  "contains",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
]);

function localInputReferences(tools: readonly ToolSchemas[]): string[] {
  return tools.flatMap((tool) => {
    const references: string[] = [];
    const visit = (node: unknown, path: string): void => {
      if (!isRecord(node)) return;
      if (typeof node.$ref === "string") references.push(`${path}.$ref`);
      for (const [key, value] of Object.entries(node)) {
        if (schemaMapKeywords.has(key) && isRecord(value)) {
          for (const [name, schema] of Object.entries(value))
            visit(schema, `${path}.${key}.${name}`);
        } else if (schemaArrayKeywords.has(key) && Array.isArray(value)) {
          value.forEach((schema, index) =>
            visit(schema, `${path}.${key}[${index}]`),
          );
        } else if (schemaChildKeywords.has(key)) {
          if (Array.isArray(value))
            value.forEach((schema, index) =>
              visit(schema, `${path}.${key}[${index}]`),
            );
          else visit(value, `${path}.${key}`);
        }
      }
    };
    visit(tool.inputSchema, `${tool.name}.inputSchema`);
    return references;
  });
}

it("finds references only in input schema positions, not literal data", () => {
  const schema = {
    type: "object",
    properties: {
      $ref: { type: "string" },
      default: { type: "array", items: { type: "string" } },
    },
    default: { $ref: "literal data" },
    examples: [{ $defs: { field: { $ref: "literal data" } } }],
  };
  expect(
    localInputReferences([{ name: "literal", inputSchema: schema }]),
  ).toEqual([]);
  expect(
    localInputReferences([
      {
        name: "nested",
        inputSchema: {
          type: "object",
          properties: {
            default: { type: "array", items: { $ref: "#/definitions/value" } },
          },
        },
      },
    ]),
  ).toEqual(["nested.inputSchema.properties.default.items.$ref"]);
});

const advertiseAndEnforceProcessEnvironmentKeyConstraint =
  async (): Promise<void> => {
    const contract = TOOL_CONTRACTS.find(
      ({ name }) => name === "capture_process_scenario",
    );
    if (contract === undefined)
      throw new Error("Process capture contract was not registered");

    let handlerCalled = false;
    const server = new McpServer({ name: "process-schema", version: "0" });
    server.registerTool(
      contract.name,
      {
        title: contract.title,
        description: contract.description,
        inputSchema: processScenarioSchema.shape,
      },
      async () => {
        handlerCalled = true;
        return {
          content: [{ type: "text" as const, text: "handler ran" }],
          isError: true,
        };
      },
    );
    const client = new Client({ name: "process-schema", version: "0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const advertised = (await client.listTools()).tools.find(
        ({ name }) => name === contract.name,
      );
      if (advertised === undefined)
        throw new Error("Process capture tool was not advertised");

      const validate = new Ajv2020({
        strict: false,
        validateFormats: false,
      }).compile(advertised.inputSchema);
      const valid = { executable: "node", environment: { APP_MODE: "test" } };
      const reserved = {
        executable: "node",
        environment: { REA_PROCESS_RUN_ID: "caller-value" },
      };
      const reservedWithTrailingNewline = {
        executable: "node",
        environment: { "REA_PROCESS_RUN_ID\n": "caller-value" },
      };
      expect(validate(valid)).toBe(true);
      expect(contract.inputSchema.safeParse(valid).success).toBe(true);
      expect(validate(reserved)).toBe(false);
      expect(contract.inputSchema.safeParse(reserved).success).toBe(false);
      expect(validate(reservedWithTrailingNewline)).toBe(true);
      expect(
        contract.inputSchema.safeParse(reservedWithTrailingNewline).success,
      ).toBe(true);

      const result = await client.callTool({
        name: contract.name,
        arguments: reserved,
      });
      expect(result.isError).toBe(true);
      expect(handlerCalled).toBe(false);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  };

describe("served environment catalogs", () => {
  it("advertises served environment catalogs in schemas clients accept: bulk bodies, pinned queries and fixed members", () => {
    const edition = { format: "HC", featured: 1 };
    const stored = { ...THIRD_BOOK, ...edition };
    const captures: readonly (readonly TimedCaptureRow[])[] = [
      [
        ...BOOK_INIT_ROWS,
        ["DELETE", "/api/books", [{ id: 2 }], 200, [{ id: 2 }]],
        ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
        ["GET", "/api/books", [FIRST_BOOK]],
      ],
      [
        ["GET", "/api/books", [{ ...FIRST_BOOK, ...edition }]],
        ["GET", "/api/books/1", { ...FIRST_BOOK, ...edition }],
        [
          "POST",
          "/api/books?notify=quiet",
          stored,
          201,
          {
            books: [
              { name: "Third Book", format: "hardcover", featured: true },
            ],
          },
        ],
        ["GET", "/api/books/3", stored],
      ],
    ];
    const tools = captures.flatMap((rows) => {
      const served = servedFrom(rows);
      const catalog = servedCatalog(served.source, served.state, "books");
      if (!catalog.ok) throw catalog.error;
      return catalog.value.tools;
    });
    const create = tools.find((tool) => tool.name === "post_books");
    expect(create?.inputSchema.properties["notify"]).toMatchObject({
      enum: ["quiet"],
    });
    expect(JSON.stringify(create?.inputSchema)).toContain(
      '"const":"hardcover"',
    );
    expect(tools.some((tool) => tool.name === "delete_books")).toBe(true);
    expect(
      advertisedSchemaErrors(
        tools.map((tool) => ({
          name: tool.name,
          inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
        })),
      ),
    ).toEqual([]);
  });
});

describe("MCP JSON Schema validity", () => {
  it("preserves empty-array validation in the advertised representation", () => {
    const schema = z.toJSONSchema(emptyArraySchema);
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(ajv.validateSchema(schema)).toBe(true);
    const validate = ajv.compile(schema);
    expect(validate([])).toBe(true);
    for (const value of [
      [null],
      ["candidate"],
      [0],
      [false],
      [{}],
      [[]],
      null,
      {},
    ])
      expect(validate(value)).toBe(false);
  });

  it("advertises valid input and output schemas for every canonical tool", async () => {
    const server = new McpServer({ name: "schema-validation", version: "0" });
    const client = new Client({ name: "schema-validation", version: "0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    for (const contract of TOOL_CONTRACTS)
      server.registerTool(
        contract.name,
        toolRegistrationOptions(contract),
        async () => ({
          content: [],
        }),
      );
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      expect(tools.map(({ name }) => name).sort()).toEqual(
        TOOL_CONTRACTS.map(({ name }) => name).sort(),
      );
      expect(advertisedSchemaErrors(tools)).toEqual([]);
      expect(localInputReferences(tools)).toEqual([]);
      expect(recursiveReferences(tools)).toEqual([]);
      expectKnownAuthorityHints(tools);
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      expectManagedLocalSignatureSchema(byName.get("inspect_managed_members"));
      const comparison = byName.get("compare_web_captures")?.inputSchema;
      for (const side of ["before", "after"])
        expect(comparison).toHaveProperty(
          ["properties", side, "properties", "inspection"],
          {
            type: "object",
            description: expect.stringContaining(
              "complete canonical observation",
            ),
          },
        );
      const catalogProjection = tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      }));
      expect(catalogProjection).toEqual(
        GENERATED_MCP_TOOL_CATALOG.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
        })),
      );
      for (const contract of TOOL_CONTRACTS) {
        const tool = byName.get(contract.name);
        expect(tool?.title?.trim(), contract.name).toBeTruthy();
        expect(tool?.description?.trim(), contract.name).toBeTruthy();
        const examples = advertisedInputExamples(contract);
        expect(tool?.inputSchema.examples, contract.name).toEqual(
          examples.length === 0 ? undefined : examples,
        );
        for (const example of contract.examples)
          expect(
            contract.inputSchema.safeParse(example.input).success,
            `${contract.name}: ${example.title}`,
          ).toBe(true);
        expectMeaningfulPropertyDescriptions(tool?.inputSchema, contract.name);
      }
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});

describe("MCP root input schemas", () => {
  it("advertises object roots while enforcing union requirements at runtime", async () => {
    const server = new McpServer({ name: "schema-constraints", version: "0" });
    const client = new Client({ name: "schema-constraints", version: "0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    for (const contract of TOOL_CONTRACTS)
      server.registerTool(
        contract.name,
        toolRegistrationOptions(contract),
        async () => ({ content: [] }),
      );
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      const advertised = new Map(tools.map((tool) => [tool.name, tool]));
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      const graphContract = TOOL_CONTRACTS.find(
        ({ name }) => name === "project_managed_application_graph",
      );
      const graphTool = advertised.get("project_managed_application_graph");
      if (graphContract === undefined || graphTool === undefined)
        throw new Error("Managed application graph tool was not advertised");
      expect(graphContract.inputSchema.safeParse({}).success).toBe(false);
      expect(graphTool.inputSchema).toMatchObject({ type: "object" });
      expect(ajv.compile(graphTool.inputSchema)({})).toBe(false);
      expect(ajv.compile(graphTool.inputSchema)({ unrelated: true })).toBe(
        false,
      );
      expect(graphTool.inputSchema.description).toContain(
        "Provide a complete input group",
      );
      expect(graphTool.inputSchema.description).not.toContain("exactly one");

      for (const contract of TOOL_CONTRACTS) {
        const inputSchema = advertised.get(contract.name)!.inputSchema;
        expect(inputSchema.type, contract.name).toBe("object");
        expect(inputSchema.properties, contract.name).toBeDefined();
        // Anthropic tool input schemas reject root combinators.
        for (const combinator of ["anyOf", "oneOf", "allOf"])
          expect(inputSchema, contract.name).not.toHaveProperty(combinator);
        const validate = ajv.compile(inputSchema);
        for (const example of contract.examples)
          expect(
            validate(example.input),
            `${contract.name}: ${example.title}`,
          ).toBe(true);
      }

      expectStrictInputSchemaParity(tools, ajv);

      for (const name of ["inspect_web_page", "analyze_web_bundle"]) {
        const contract = TOOL_CONTRACTS.find((tool) => tool.name === name);
        const tool = advertised.get(name);
        if (contract === undefined || tool === undefined)
          throw new Error(`${name} was not advertised`);
        const validate = ajv.compile(tool.inputSchema);
        const base = {
          cdp_endpoint: "http://127.0.0.1:9222",
          target_id: "target",
        };
        for (const flag of [undefined, false, true, "false", null]) {
          const input =
            flag === undefined
              ? base
              : { ...base, include_script_sources: flag };
          const accepted =
            flag === undefined ||
            flag === true ||
            (name === "inspect_web_page" && flag === false);
          const parsed = contract.inputSchema.safeParse(input);
          expect(parsed.success, `${name}: ${String(flag)}`).toBe(accepted);
          // The advertisement relaxes Boolean literals; the canonical parser
          // still rejects false when this operation requires script sources.
          expect(validate(input), `${name}: ${String(flag)}`).toBe(
            flag === undefined || typeof flag === "boolean",
          );
          if (parsed.success && flag === undefined)
            expect(parsed.data).toMatchObject({
              include_script_sources: name === "analyze_web_bundle",
            });
        }
      }

      const nativeObservation = TOOL_CONTRACTS.find(
        ({ name }) => name === "observe_native_ui",
      );
      const nativeScenario = TOOL_CONTRACTS.find(
        ({ name }) => name === "capture_native_ui_scenario",
      );
      const nativeObservationTool = advertised.get("observe_native_ui");
      const nativeScenarioTool = advertised.get("capture_native_ui_scenario");
      if (
        nativeObservation === undefined ||
        nativeScenario === undefined ||
        nativeObservationTool === undefined ||
        nativeScenarioTool === undefined
      )
        throw new Error("Native UI tools were not registered");
      const target = { pid: 123, window_id: 456 };
      const scenario = {
        ...target,
        steps: [{ kind: "wait", milliseconds: 100 }],
      };
      const observationResult = nativeObservation.inputSchema.safeParse(target);
      const scenarioResult = nativeScenario.inputSchema.safeParse(scenario);
      expect(observationResult.success).toBe(true);
      expect(scenarioResult.success).toBe(true);
      expect(ajv.compile(nativeObservationTool.inputSchema)(target)).toBe(true);
      expect(ajv.compile(nativeScenarioTool.inputSchema)(scenario)).toBe(true);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});

it(
  "advertises and enforces the process-owned environment key constraint",
  advertiseAndEnforceProcessEnvironmentKeyConstraint,
);

const advertiseAndEnforceItemSelectorCollectionConstraints =
  async (): Promise<void> => {
    const contract = TOOL_CONTRACTS.find(
      ({ name }) => name === "inspect_analysis_view",
    );
    if (contract === undefined)
      throw new Error("inspect_analysis_view contract was not registered");

    const server = new McpServer({
      name: "item-selector-schema",
      version: "0",
    });
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async () => ({
        content: [],
      }),
    );
    const client = new Client({ name: "item-selector-schema", version: "0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const advertised = (await client.listTools()).tools.find(
        ({ name }) => name === contract.name,
      );
      if (advertised === undefined)
        throw new Error("inspect_analysis_view tool was not advertised");

      const validate = new Ajv2020({
        strict: false,
        validateFormats: false,
      }).compile(advertised.inputSchema);
      const source = {
        kind: "retained-evidence",
        evidence_id: `ev_${"a".repeat(64)}`,
      };
      const itemInput = (collection: string, selector: unknown) => ({
        source,
        view: { kind: "item", collection, selector },
      });
      const nodeId = `jag_node_${"b".repeat(64)}`;
      // Collection-specific selector constraints must survive JSON Schema
      // conversion: the advertised schema rejects exactly what runtime
      // input validation rejects.
      const invalid: ReadonlyArray<readonly [string, unknown]> = [
        ["modules", { index: 0 }],
        ["modules", { name: "entry" }],
        ["sections", { path: "/src/entry.js" }],
        ["symbols", { node_id: nodeId }],
      ];
      const valid: ReadonlyArray<readonly [string, unknown]> = [
        ["modules", { path: "/src/entry.js" }],
        ["modules", { node_id: nodeId }],
        ["sections", { index: 0 }],
        ["sections", { name: ".text" }],
        ["symbols", { index: 0 }],
        ["symbols", { name: "main" }],
      ];
      for (const [collection, selector] of invalid) {
        const input = itemInput(collection, selector);
        const label = `${collection}/${Object.keys(selector as object)[0]}`;
        expect(contract.inputSchema.safeParse(input).success, label).toBe(
          false,
        );
        expect(validate(input), `advertised schema rejects ${label}`).toBe(
          false,
        );
      }
      for (const [collection, selector] of valid) {
        const input = itemInput(collection, selector);
        const label = `${collection}/${Object.keys(selector as object)[0]}`;
        expect(contract.inputSchema.safeParse(input).success, label).toBe(true);
        expect(validate(input), `advertised schema accepts ${label}`).toBe(
          true,
        );
      }
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  };

it(
  "advertises and enforces the item selector collection constraints",
  advertiseAndEnforceItemSelectorCollectionConstraints,
);

describe("MCP process input JSON Schema", () => {
  it("advertises process strings without weakening terminal input", async () => {
    const server = new McpServer({
      name: "process-schema-validation",
      version: "0",
    });
    const client = new Client({
      name: "process-schema-validation",
      version: "0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    for (const contract of TOOL_CONTRACTS)
      server.registerTool(
        contract.name,
        toolRegistrationOptions(contract),
        async () => ({ content: [] }),
      );
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const processContract = TOOL_CONTRACTS.find(
        ({ name }) => name === "capture_process_scenario",
      );
      const processTool = (await client.listTools()).tools.find(
        ({ name }) => name === "capture_process_scenario",
      );
      if (processContract === undefined || processTool === undefined)
        throw new Error("Process scenario tool was not advertised");
      const validate = new Ajv2020({
        strict: false,
        validateFormats: false,
      }).compile(processTool.inputSchema);
      const base = { executable: "/usr/bin/true" };
      for (const input of [
        { ...base, executable: "/usr/bin/true\0" },
        { ...base, arguments: ["\0"] },
        { ...base, working_directory: "/tmp\0" },
        { ...base, environment: { KEY: "value\0" } },
        { ...base, filesystem_observation_paths: ["/tmp\0"] },
      ]) {
        expect(processContract.inputSchema.safeParse(input).success).toBe(
          false,
        );
        expect(validate(input)).toBe(false);
      }
      const terminalInput = {
        ...base,
        events: [{ type: "input", at_ms: 0, data: "\0" }],
      };
      expect(processContract.inputSchema.safeParse(terminalInput).success).toBe(
        true,
      );
      expect(validate(terminalInput)).toBe(true);
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});

it("ships nonrecursive input and output schemas in the generated catalog", () => {
  expect(advertisedSchemaErrors(GENERATED_MCP_TOOL_CATALOG)).toEqual([]);
  expect(recursiveReferences(GENERATED_MCP_TOOL_CATALOG)).toEqual([]);
});

it("ships input schemas without local references in the generated catalog", () => {
  expect(localInputReferences(GENERATED_MCP_TOOL_CATALOG)).toEqual([]);
});

it("rejects unresolved output-schema references even for uncalled tools", () => {
  const errors = advertisedSchemaErrors([
    {
      name: "dangling",
      inputSchema: { type: "object" },
      outputSchema: { $ref: "#/$defs/missing" },
    },
  ]);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("dangling.outputSchema");
});

it("validates each tool independently when output schema IDs repeat", () => {
  const outputSchema = { $id: "urn:rea:test:shared-output", type: "string" };
  const errors = advertisedSchemaErrors([
    { name: "first", inputSchema: { type: "object" }, outputSchema },
    {
      name: "second",
      inputSchema: { type: "object" },
      outputSchema: { ...outputSchema },
    },
    {
      name: "broken",
      inputSchema: { type: "object" },
      outputSchema: { $id: outputSchema.$id, $ref: "#/$defs/missing" },
    },
  ]);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("broken.outputSchema");
  expect(errors[0]).toContain("missing");
});

it("checks client array constraints in schema positions while preserving literal metadata", () => {
  const schema = {
    type: "object",
    properties: { examples: { type: "array", items: { type: "string" } } },
    examples: [{ type: "array" }],
    default: { type: "array" },
    const: { type: "array" },
    enum: [{ type: "array" }],
  };
  expect(arrayItemSchemaError(schema, "literal")).toBeUndefined();
  expect(
    arrayItemSchemaError(
      { ...schema, properties: { examples: { type: "array" } } },
      "broken",
    ),
  ).toBe(
    "broken.properties.examples: tool parameters array type must have items",
  );
  const booleanMetadata = {
    type: "object",
    properties: { default: { type: "boolean", const: false } },
    default: { const: true },
    examples: [{ enum: [false] }],
  };
  expect(
    unsupportedInputLiteralSchemaError(
      { ...booleanMetadata, properties: {} },
      "literal",
    ),
  ).toBeUndefined();
  expect(unsupportedInputLiteralSchemaError(booleanMetadata, "literal")).toBe(
    "literal.properties.default.const is boolean",
  );
  for (const [literal, reason] of [
    [{ const: "" }, "const is an empty string"],
    [{ enum: ["named", ""] }, "enum contains an empty string"],
  ] as const) {
    expect(
      unsupportedInputLiteralSchemaError(
        {
          type: "object",
          properties: { value: literal },
          default: { const: "" },
          examples: [{ enum: [""] }],
        },
        "literal",
      ),
    ).toBe(`literal.properties.value.${reason}`);
  }
});

it.each([false, true])(
  "rejects references to another tool's nested IDs (earlier compilation fails: %s)",
  (invalidPrevious) => {
    const nestedId = "urn:rea:test:nested-output";
    const errors = advertisedSchemaErrors([
      {
        name: "first",
        inputSchema: { type: "object" },
        outputSchema: {
          $defs: { shared: { $id: nestedId, type: "string" } },
          ...(invalidPrevious ? { pattern: "[" } : {}),
        },
      },
      {
        name: "broken",
        inputSchema: { type: "object" },
        outputSchema: {
          $ref: nestedId,
          $defs: { shared: { type: "number" } },
        },
      },
    ]);
    expect(errors).toHaveLength(invalidPrevious ? 2 : 1);
    const brokenErrors = errors.filter((error) =>
      error.startsWith("broken.outputSchema:"),
    );
    expect(brokenErrors).toHaveLength(1);
    expect(brokenErrors[0]).toContain(nestedId);
  },
);

it("distinguishes recursive references from shared definitions", () => {
  const diamond = {
    type: "object",
    properties: {
      left: { $ref: "#/$defs/shared" },
      right: { $ref: "#/$defs/shared" },
    },
    $defs: { shared: { type: "string" } },
  };
  expect(
    recursiveReferences([{ name: "diamond", inputSchema: diamond }]),
  ).toEqual([]);
  expect(
    recursiveReferences([{ name: "root", inputSchema: { $ref: "#" } }]),
  ).toEqual(["root.inputSchema: #"]);
  const escaped = {
    $ref: "#/$defs/a~1b",
    $defs: { "a/b": { $ref: "#/$defs/a~1b" } },
  };
  expect(
    recursiveReferences([{ name: "escaped", inputSchema: escaped }]),
  ).toEqual(["escaped.inputSchema: #/$defs/a~1b"]);
});
