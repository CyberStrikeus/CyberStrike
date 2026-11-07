import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import type {
  JebAnalysisPort,
  JebAnalysisAvailability,
} from "../../../src/application/jeb/JebAnalysisPort.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";
import {
  expandToolAvailability,
  toolAvailabilityInventory,
} from "../../../src/contracts/toolOutputSchemaPrimitives.js";

import { JebProvider } from "../../../src/jeb/JebProvider.js";
import {
  startJebMcpFixture,
  jebPrimaryResponses,
} from "../../fixtures/jebMcp.js";

const identity = { id: "jeb", name: "JEB", version: "5.48.0" } as const;
const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());

it("discovers current JEB operation support and recovery through binary_session", async () => {
  let availability: JebAnalysisAvailability = {
    status: "unavailable",
    code: "not_configured",
    reason: "Start JEB at REA_JEB_MCP_URL",
    diagnostics: {},
  };
  let probes = 0;
  const provider: JebAnalysisPort = {
    async inspectAvailability() {
      probes += 1;
      return availability;
    },
    async close() {},
    async execute() {
      throw new Error("Status must not execute analysis");
    },
  };
  const session = createTestBinarySession(() => {
    throw new Error("Status must not start a deep provider");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    serverOptions: { environment: {}, jebAnalysis: provider },
    clientIdentity: { name: "jeb-availability", version: "1" },
    schemaValidator: schemaValidation,
  });
  const read = async () => {
    const result = await client.callTool({
      name: "binary_session",
      arguments: { detail: "complete" },
    });
    const status = toolContract("binary_session").outputSchema.parse(
      result.structuredContent,
    ).result;
    return expandToolAvailability(
      toolAvailabilityInventory.parse(status.tool_availability),
    ).filter((tool) => tool.surface === "jeb-provider");
  };
  const unavailable = await read();
  expect(unavailable).toHaveLength(4);
  expect(
    unavailable.every(
      (tool) => !tool.available && tool.remediation === availability.reason,
    ),
  ).toBe(true);
  availability = {
    status: "available",
    code: null,
    reason: null,
    diagnostics: {},
    supportedOperations: [
      "inspect_jeb_client",
      "list_jeb_units",
      "decompile_jeb_item",
    ],
  };
  const recovered = await read();
  expect(
    recovered
      .filter((tool) => tool.available)
      .map((tool) => tool.name)
      .sort(),
  ).toEqual(["decompile_jeb_item", "inspect_jeb_client", "list_jeb_units"]);
  expect(
    recovered.find((tool) => tool.name === "open_jeb_project"),
  ).toMatchObject({
    available: false,
    reason: "provider_unavailable",
    remediation: expect.stringContaining("does not advertise"),
  });
  expect(probes).toBe(2);
});

it("advertises exact valid JEB schemas and records inline evidence through MCP", async () => {
  const execution = createAnalysisExecution(
    {
      engine: {
        name: "jeb",
        version: "5.48.0",
        endpoint: "http://127.0.0.1:8425/mcp",
        gui_client: false,
      },
      startup_ts: 1791623439,
      message: null,
    },
    identity,
  );
  const provider: JebAnalysisPort = {
    async inspectAvailability() {
      return {
        status: "available",
        code: null,
        reason: null,
        diagnostics: {},
        supportedOperations: [
          "inspect_jeb_client",
          "list_jeb_units",
          "decompile_jeb_item",
        ],
      };
    },
    async close() {},
    async execute() {
      return ok(execution);
    },
  };
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    serverOptions: { jebAnalysis: provider },
    clientIdentity: { name: "jeb-contract", version: "1" },
    schemaValidator: schemaValidation,
  });
  const advertised = (await client.listTools()).tools.find(
    (tool) => tool.name === "inspect_jeb_client",
  );
  if (advertised?.inputSchema === undefined)
    throw new Error("JEB tools must publish both schemas");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(advertised.inputSchema)).toBe(true);
  const outputSchema: Record<string, unknown> = advertised.outputSchema ?? {};
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  expect(ajv.validate(advertised.inputSchema, {})).toBe(true);
  expect(ajv.validate(advertised.inputSchema, { unexpected: 1 })).toBe(false);

  const called = await client.callTool({
    name: "inspect_jeb_client",
    arguments: {},
  });
  expect(called.isError).not.toBe(true);
  const text = (called.content ?? [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  const evidence = parseEvidence(JSON.parse(text));
  expect(evidence.provider.id).toBe("jeb");
  expect(evidence.normalized_result).toEqual(execution.result);
});

it("preserves JEB provider failure reasons through the MCP boundary", async () => {
  const contract = toolContract("list_jeb_units");
  const provider: JebAnalysisPort = {
    async inspectAvailability() {
      return {
        status: "available",
        code: null,
        reason: null,
        diagnostics: {},
        supportedOperations: [
          "inspect_jeb_client",
          "list_jeb_units",
          "decompile_jeb_item",
        ],
      };
    },
    async close() {},
    async execute() {
      return ok(
        createAnalysisExecution(
          { engine: null, units: [], coverage: "complete" } as never,
          identity,
        ),
      );
    },
  };
  void contract;
  const unavailable: JebAnalysisPort = {
    ...provider,
    async execute() {
      const { AnalysisCapabilityUnavailableError } =
        await import("../../../src/domain/analysisErrorCore.js");
      return {
        ok: false as const,
        error: new AnalysisCapabilityUnavailableError(
          "jeb",
          "list_jeb_units",
          "connect ECONNREFUSED 127.0.0.1:8425",
          {
            userMessage:
              "Start a JEB client serving MCP (default http://127.0.0.1:8425/mcp) or set REA_JEB_MCP_URL to the running endpoint.",
          },
        ),
      };
    },
  };
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    serverOptions: { jebAnalysis: unavailable },
    clientIdentity: { name: "jeb-failure", version: "1" },
    schemaValidator: schemaValidation,
  });
  const failed = await client.callTool({
    name: "list_jeb_units",
    arguments: {},
  });
  expect(failed.isError).toBe(true);
  const text = (failed.content ?? [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  expect(text).toContain("ECONNREFUSED");
  expect(text).toContain("REA_JEB_MCP_URL");
});

it("keeps the MCP server usable when REA_JEB_MCP_URL is invalid", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    serverOptions: {
      environment: { REA_JEB_MCP_URL: "http://localhost:8425/mcp" },
    },
    clientIdentity: { name: "jeb-invalid-endpoint", version: "1" },
    schemaValidator: schemaValidation,
  });
  expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  const failed = await client.callTool({
    name: "inspect_jeb_client",
    arguments: {},
  });
  expect(failed.isError).toBe(true);
  const text = (failed.content ?? [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  expect(JSON.parse(text)).toMatchObject({
    error: {
      code: "configuration_invalid",
      details: {
        settings: [
          {
            setting: "REA_JEB_MCP_URL",
            constraint: expect.stringContaining("loopback"),
          },
        ],
      },
    },
  });
});

it.each(
  [
    { operation: "list_jeb_units", tool: "list_units", input: { count: 2 } },
    {
      operation: "decompile_jeb_item",
      tool: "decompile_code_item",
      input: {
        item_address: "LSample;->value()I",
        item_kind: "method",
        unit_path: "sample.dex",
      },
    },
    {
      operation: "open_jeb_project",
      tool: "open_project",
      input: { path: "sample.apk" },
    },
  ].flatMap((request) =>
    ["refusal", "unknown-version"].map((metadata) => ({
      ...request,
      metadata,
    })),
  ),
)(
  "preserves requested $operation through MCP with metadata $metadata",
  async ({ operation, tool, input, metadata }) => {
    let informationCalls = 0;
    const refusal = {
      success: false,
      message: "Client information temporarily refused",
      error: {
        code: "future_metadata_code",
        recovery_required_before_retry: true,
        recovery_tool: "get_client_information",
      },
    };
    const fixture = await startJebMcpFixture((name) => {
      if (name !== "get_client_information") return jebPrimaryResponses[name]!;
      informationCalls++;
      return metadata === "refusal" || informationCalls > 1
        ? refusal
        : { success: true, gui_client: false };
    });
    onTestFinished(() => fixture.close());
    const provider = new JebProvider({
      environment: { REA_JEB_MCP_URL: fixture.endpoint },
    });
    const session = createTestBinarySession(() => {
      throw new Error("JEB must not start a deep provider");
    });
    const { client } = await createApplicationMcpHarness({
      session,
      serverOptions: { jebAnalysis: provider, environment: {} },
      clientIdentity: { name: "jeb-attribution", version: "1" },
      schemaValidator: schemaValidation,
    });
    const call = () => client.callTool({ name: operation, arguments: input });
    if (metadata === "unknown-version") {
      for (let attempt = 0; attempt < 2; attempt++) {
        const called = await call();
        expect(called.isError).not.toBe(true);
        const text = called.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("");
        const evidence = parseEvidence(JSON.parse(text));
        expect(evidence.provider.version).toBeNull();
        expect(evidence.normalized_result).toMatchObject({
          engine: { version: null, gui_client: false },
        });
        expect(evidence.raw_result).toEqual(jebPrimaryResponses[tool]);
      }
      expect(fixture.calls).toEqual([tool, "get_client_information", tool]);
    } else {
      const failed = await client.callTool({
        name: operation,
        arguments: input,
      });
      expect(failed.isError).toBe(true);
      const text = failed.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
      expect(JSON.parse(text)).toMatchObject({
        error: {
          code: "execution_failure",
          message: refusal.message,
          details: {
            provider_id: "jeb",
            operation,
            diagnostics: {
              endpoint: fixture.endpoint,
              upstream_response: refusal,
            },
            partial_observation: {
              kind: "retained-evidence",
              evidence_id: expect.any(String),
            },
          },
        },
      });
      const partial = z
        .object({
          error: z.object({
            details: z.object({
              partial_observation: z.object({
                kind: z.literal("retained-evidence"),
                evidence_id: z.string(),
              }),
            }),
          }),
        })
        .parse(JSON.parse(text)).error.details.partial_observation;
      expect(session.evidenceById(partial.evidence_id)).toMatchObject({
        evidence_id: partial.evidence_id,
        operation,
        raw_result: jebPrimaryResponses[tool],
      });
      expect(fixture.calls).toEqual([tool, "get_client_information"]);
    }
  },
);
