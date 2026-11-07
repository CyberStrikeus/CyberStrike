import {
  Client,
  type CallToolRequestOptions,
  type ClientOptions,
} from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished } from "vitest";
import { z } from "zod";

// validateSchema checks against the meta-schema without registering user $ids.
const schemaValidator = new Ajv2020({
  strict: false,
  validateFormats: false,
});
const validatedSchemas = new Set<string>();
const compiledValidators = new Map<string, ValidateFunction<unknown>>();

const compileValidator = (schema: unknown): ValidateFunction<unknown> => {
  const schemaRecord = z.record(z.string(), z.unknown()).parse(schema);
  const serialized = JSON.stringify(schemaRecord);
  const cached = compiledValidators.get(serialized);
  if (cached !== undefined) return cached;

  // Keep a private Ajv registry per schema: distinct tool schemas can carry
  // identical $id values, while this cache only reuses exact schema content.
  const validate = new Ajv2020({
    strict: false,
    validateFormats: false,
  }).compile<unknown>(schemaRecord);
  compiledValidators.set(serialized, validate);
  return validate;
};

/** Default to native tools while preserving explicit caller configuration. */
export const localToolsMcpEnvironment = (
  environment: Readonly<Record<string, string>> = {},
): Record<string, string> => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  REA_LOG_LEVEL: "silent",
  HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
  GHIDRA_INSTALL_DIR: process.execPath,
  ...environment,
});

/** Start the built production server without configuring deep binary providers. */
export async function connectLocalToolsMcp(
  environment: Readonly<Record<string, string>> = {},
  registerCleanup: (cleanup: () => Promise<void>) => void = onTestFinished,
  transportOptions: Readonly<Pick<StdioServerParameters, "maxBufferSize">> = {},
  jsonSchemaValidator?: NonNullable<ClientOptions["jsonSchemaValidator"]>,
) {
  const transport = new StdioClientTransport({
    ...transportOptions,
    command: process.execPath,
    args: [
      fileURLToPath(new URL("../../scripts/rea.mjs", import.meta.url)),
      "mcp",
    ],
    env: localToolsMcpEnvironment(environment),
    stderr: "pipe",
  });
  const client = new Client(
    { name: "local-tools-e2e", version: "1" },
    jsonSchemaValidator === undefined ? undefined : { jsonSchemaValidator },
  );
  registerCleanup(async () => {
    await client.close();
    await transport.close();
  });
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  for (const tool of tools)
    for (const [kind, schema] of [
      ["inputSchema", tool.inputSchema],
      ["outputSchema", tool.outputSchema],
    ] as const) {
      if (schema === undefined) continue;
      const serialized = JSON.stringify(schema);
      if (validatedSchemas.has(serialized)) continue;
      const schemaRecord = z.record(z.string(), z.unknown()).parse(schema);
      const valid = schemaValidator.validateSchema(schemaRecord);
      expect(
        valid,
        `${tool.name}.${kind}: ${schemaValidator.errorsText(schemaValidator.errors)}`,
      ).toBe(true);
      validatedSchemas.add(serialized);
    }
  const definitions = new Map(tools.map((tool) => [tool.name, tool]));
  const call = async (
    name: string,
    arguments_: Record<string, unknown>,
    options?: Pick<CallToolRequestOptions, "signal" | "onprogress">,
  ) => {
    const definition = definitions.get(name);
    if (definition !== undefined) compileValidator(definition.inputSchema);
    const response = await client.callTool(
      { name, arguments: arguments_ },
      {
        ...options,
        ...(definition === undefined ? {} : { toolDefinition: definition }),
      },
    );
    if (
      response.structuredContent !== undefined &&
      definition?.outputSchema !== undefined
    ) {
      const validate = compileValidator(definition.outputSchema);
      expect(
        validate(response.structuredContent),
        JSON.stringify(validate.errors),
      ).toBe(true);
    }
    return response;
  };
  return { client, call };
}
