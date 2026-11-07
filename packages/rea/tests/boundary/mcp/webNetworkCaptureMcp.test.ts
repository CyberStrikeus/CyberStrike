import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, onTestFinished } from "vitest";
import { WebNetworkCaptureService } from "../../../src/application/WebNetworkCaptureService.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { sessionOutputSchemas } from "../../../src/contracts/toolOutputSchemaGroups.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import { webNetworkCaptureSchema } from "../../../src/domain/webNetworkCapture.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestMcp } from "../../support/mcp/mcpFixture.js";

const syntheticCaptureService = () =>
  new WebNetworkCaptureService({
    inspect: () =>
      Promise.resolve(
        ok({
          artifact: { path: "/capture.har", sha256: "a".repeat(64), bytes: 10 },
          format: "har",
          decoder: { id: "test-capture-port", name: "test port", version: "1" },
          container: {
            reported: { creator: "fixture", ["__proto__"]: { preserved: 7 } },
            numeric_literals: [],
            redactions: [],
            records_pointer: "/log/entries",
          },
          total_records: 0,
          records: [],
          runtime_attribution: "unknown",
          limitations: ["synthetic application port, no real decoder claim"],
        }),
      ),
  });

it("publishes valid SDK schemas and retains historical inline Evidence with the supplied session", async () => {
  const service = syntheticCaptureService();
  const session = createTestBinarySession(() => {
    throw new Error("Binary provider must not start");
  });
  const server = createServer(
    { kind: "session", session },
    { webNetworkCapture: service },
  );
  const client = new Client({
    name: "historical-capture-contract",
    version: "1",
  });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const advertised = (await client.listTools()).tools.find(
    (tool) => tool.name === "inspect_web_network_capture",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("Capture inspection must advertise both schemas");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const inputSchema: Record<string, unknown> = advertised.inputSchema;
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  expect(ajv.validateSchema(inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  const args = { capture_path: "/capture.har", format: "har" };
  expect(ajv.validate(inputSchema, args)).toBe(true);
  const response = await client.callTool({
    name: "inspect_web_network_capture",
    arguments: args,
  });
  expect(response.isError).not.toBe(true);
  expect(
    ajv.validate(outputSchema, response.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const parsed = toolContract("inspect_web_network_capture").outputSchema.parse(
    response.structuredContent,
  );
  const evidence = parseEvidence(parsed);
  const capture = webNetworkCaptureSchema.parse(parsed.normalized_result);
  expect(capture.container.reported).toEqual({
    creator: "fixture",
    ["__proto__"]: { preserved: 7 },
  });
  expect(Object.getPrototypeOf(capture.container.reported)).toBe(
    Object.prototype,
  );
  expect(Reflect.get(Object.prototype, "preserved")).toBeUndefined();
  expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);
  const invalid = await client.callTool({
    name: "inspect_web_network_capture",
    arguments: { ...args, capture_path: "relative.har" },
  });
  expect(parseMcpToolError(invalid).error).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
  });
  const invalidSensitive = await client.callTool({
    name: "inspect_web_network_capture",
    arguments: { ...args, sensitive_values: ["secret"], mysecret: true },
  });
  expect(parseMcpToolError(invalidSensitive)).toMatchObject({
    error: {
      code: "invalid_request",
      category: "invalid_input",
      details: { issues: [{ path: [] }] },
    },
  });
  expect(JSON.stringify(invalidSensitive)).not.toContain("secret");
  expect(ajv.validate(inputSchema, { ...args, mysecret: true })).toBe(false);
});

it.each([false, true])(
  "advertises offline capture inspection without a browser provider (browser load failure %s)",
  async (failed) => {
    const session = createTestBinarySession(() => {
      throw new Error("Binary provider must not start");
    });
    const mcp = createTestMcp();
    onTestFinished(async () => {
      await mcp.close();
      await session.close();
    });
    const client = await mcp.connect(
      createServer(
        { kind: "session", session },
        {
          webNetworkCapture: syntheticCaptureService(),
          ...(failed
            ? {
                optionalProviderLoadFailures: {
                  browserObservation: {
                    providerId: "rea-cdp-browser",
                    reason: "synthetic browser import failure",
                  },
                },
              }
            : {}),
        },
      ),
    );
    const status = await client.callTool({
      name: "binary_session",
      arguments: {},
    });
    const availability = expandToolAvailability(
      sessionOutputSchemas.binary_session.parse(status.structuredContent).result
        .tool_availability,
    );
    const entry = (name: string) =>
      availability.find((tool) => tool.name === name);
    expect(entry("inspect_web_network_capture")).toMatchObject({
      available: true,
      reason: "available",
    });
    expect(entry("list_browser_targets")).toMatchObject({
      available: false,
      reason: failed ? "provider_unavailable" : "provider_missing",
    });

    const response = await client.callTool({
      name: "inspect_web_network_capture",
      arguments: { capture_path: "/capture.har", format: "har" },
    });
    expect(response.isError).not.toBe(true);
    const capture = webNetworkCaptureSchema.parse(
      toolContract("inspect_web_network_capture").outputSchema.parse(
        response.structuredContent,
      ).normalized_result,
    );
    expect(capture).toMatchObject({ format: "har", total_records: 0 });
    const live = await client.callTool({
      name: "list_browser_targets",
      arguments: { cdp_endpoint: "http://127.0.0.1:9222" },
    });
    expect(live.isError).toBe(true);
  },
);
