import type { Client } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import type { BinarySession } from "../../src/application/binary/BinarySession.js";

interface AdvertisedSchemaAssertions {
  readonly errors?: unknown;
  validateSchema(schema: Record<string, unknown>): boolean | Promise<unknown>;
  validate(
    schema: Record<string, unknown>,
    value: unknown,
  ): boolean | Promise<unknown>;
}

/** Verify actual advertised schemas; callers may own file-local preparation. */
export const advertisedMcpToolSchemas = async (
  client: Client,
  name: string,
  ajv: AdvertisedSchemaAssertions = new Ajv2020({
    strict: false,
    validateFormats: false,
  }),
) => {
  const matches = (await client.listTools()).tools.filter(
    (tool) => tool.name === name,
  );
  if (matches.length > 1)
    throw new Error(`${name} has multiple advertised definitions`);
  const advertised = matches[0];
  if (advertised?.outputSchema === undefined)
    throw new Error(`${name} must publish both schemas`);
  const inputSchema: Record<string, unknown> = advertised.inputSchema;
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  expect(ajv.validateSchema(inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  return {
    name: advertised.name,
    toolDefinition: advertised,
    ajv,
    inputSchema,
    outputSchema,
  };
};

/** Keep public output, provenance and session retention checks together. */
export const assertRecordedMcpEvidence = (
  response: Awaited<ReturnType<Client["callTool"]>>,
  name:
    | "inspect_wasm_artifact"
    | "inspect_binary_layout"
    | "inspect_evm_interface"
    | "inspect_native_exports",
  schemas: Awaited<ReturnType<typeof advertisedMcpToolSchemas>>,
  session: BinarySession,
  expected: { readonly artifact: { readonly sha256: string } },
  confidence: ReturnType<typeof parseEvidence>["confidence"],
) => {
  expect(response.isError).not.toBe(true);
  expect(
    schemas.ajv.validate(schemas.outputSchema, response.structuredContent),
    JSON.stringify(schemas.ajv.errors),
  ).toBe(true);
  const parsed = toolContract(name).outputSchema.parse(
    response.structuredContent,
  );
  const evidence = parseEvidence(parsed);
  expect(evidence.confidence).toBe(confidence);
  expect(evidence.subject?.digest.sha256).toBe(expected.artifact.sha256);
  expect(parsed.normalized_result).toEqual(expected);
  expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);
  return evidence;
};
