import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, expect, it } from "vitest";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";

import { FUNCTION_COMPARISON_EXAMPLE } from "../../../src/contracts/functionComparisonExample.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";
import type { RelationshipCoverage } from "../../../src/domain/relationshipCoverage.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const observe = (relationshipCoverage: RelationshipCoverage) => {
  const template = FUNCTION_COMPARISON_EXAMPLE.left;
  if (template.subject === null)
    throw new Error("Expected artifact-bound fixture");
  const dossier = functionDossierSchema.parse(template.normalized_result);
  return createEvidence(
    {
      path: template.subject.local_path,
      sha256: template.subject.digest.sha256,
      format: template.subject.format,
    },
    template.provider,
    {
      operation: "analyze_function",
      parameters: template.parameters,
      result: { ...dossier, callees: [], unresolved_calls: [] },
      confidence: template.confidence,
      authority: template.authority,
      relationshipCoverage,
    },
  );
};

const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());

const profiles = ["full", "compact"] as const;
it.each(profiles)("preserves directional gaps (%s)", async (profile) => {
  const session = createTestBinarySession(() => {
    throw new Error("Offline call paths must not launch a provider");
  });
  const server = createServer(
    { kind: "session", session },
    { environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: profile } },
  );
  const client = new Client(
    { name: "function-call-directions", version: "1" },
    { jsonSchemaValidator: schemaValidation },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const advertised = (await client.listTools()).tools.find(
      ({ name }) => name === "build_call_path",
    );
    if (advertised === undefined)
      throw new Error("Missing build_call_path contract");
    const ajv = schemaValidation.assertions;
    expect(ajv.validateSchema(advertised.inputSchema)).toBe(true);
    for (const { directions, status, exhaustive } of [
      {
        directions: ["callers"] as ["callers"],
        status: "not_found",
        exhaustive: true,
      },
      {
        directions: ["callees"] as ["callees"],
        status: "unknown",
        exhaustive: false,
      },
      {
        directions: ["callers", "callees"] as ["callers", "callees"],
        status: "unknown",
        exhaustive: false,
      },
    ]) {
      const limitation =
        "An observed call reference is absent from the inventory.";
      const coverage: RelationshipCoverage = {
        status: "partial",
        limitations: [limitation],
        limited_directions: directions,
      };
      const observation = observe(coverage);
      expect(session.recordEvidence(observation).ok).toBe(true);
      const input = {
        functions: [observation],
        start: { address: "0x1000" },
        goal: { address: "0x9999" },
      };
      expect(
        ajv.validate(advertised.inputSchema, input),
        JSON.stringify(ajv.errors),
      ).toBe(true);
      for (const limited_directions of [
        [],
        ["callers", "callers"],
        ["callees", "callees"],
        ["callers", "callees", "callers"],
        ["incoming"],
      ]) {
        const malformed = {
          ...input,
          functions: [
            {
              ...observation,
              relationship_coverage: {
                ...coverage,
                limited_directions,
              },
            },
          ],
        };
        if (profile === "full")
          expect(ajv.validate(advertised.inputSchema, malformed)).toBe(false);
        const rejected = await client.callTool({
          name: "build_call_path",
          arguments: malformed,
        });
        // Source admission belongs to the Evidence owner in both profiles;
        // malformed supplied records fail integrity instead of SDK validation.
        expect(parseMcpToolError(rejected)).toMatchObject({
          error: {
            code: "evidence_integrity_mismatch",
            category: "integrity_mismatch",
            message: expect.stringContaining("relationship_coverage"),
          },
        });
      }
      const result = await client.callTool({
        name: "build_call_path",
        arguments: input,
      });
      if (result.isError) throw new Error(JSON.stringify(result));
      expect(result.structuredContent).toMatchObject({
        normalized_result: {
          status,
          search_scope: { exhaustive },
          limitations: expect.arrayContaining([limitation]),
        },
      });
      const comparison = await client.callTool({
        name: "compare_functions",
        arguments: { left: observation, right: observation },
      });
      if (comparison.isError) throw new Error(JSON.stringify(comparison));
      expect(comparison.structuredContent).toMatchObject({
        normalized_result: {
          dimensions: expect.arrayContaining([
            expect.objectContaining({ dimension: "calls", status: "unknown" }),
          ]),
        },
      });
      // Each scenario owns its Evidence and residual-unknown ledger.
      const closed = await session.close();
      if (!closed.ok) throw closed.error;
    }
  } finally {
    await Promise.allSettled([session.close(), client.close(), server.close()]);
  }
});
