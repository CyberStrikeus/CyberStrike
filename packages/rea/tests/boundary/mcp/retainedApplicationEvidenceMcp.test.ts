import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { afterAll, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import {
  JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
  JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE,
  SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE,
} from "../../../src/contracts/javascript/javascriptApplicationWorkflowExamples.js";
import { JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE } from "../../../src/contracts/javascript/javascriptExportShapeComparisonExample.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";

const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());
const retained = (evidence_id: string) => ({
  kind: "retained-evidence",
  evidence_id,
});
const application = JAVASCRIPT_FEATURE_TRACE_EXAMPLE.application;
const pair = JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE;
const exportPair = JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE;

async function connect(profile?: "full" | "compact") {
  const session = createTestBinarySession(() => {
    throw new Error("references must not launch a provider");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "retained-evidence-test", version: "1" },
    schemaValidator: schemaValidation,
    serverOptions: {
      environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: profile },
    },
  });
  return { client, session };
}

it("advertises semantic discovery paging and validates the returned Evidence", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  const tool = tools.find(({ name }) => name === "trace_application_feature");
  if (tool?.outputSchema === undefined)
    throw new Error("Missing feature trace output schema");
  const input = {
    application,
    seed: { kind: "string", value: "missing-semantic-name", match: "exact" },
    semantic_page: { offset: 0, limit: 1 },
  };
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const outputSchema = tool.outputSchema as AnySchema;
  expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  expect(ajv.compile(tool.inputSchema)(input)).toBe(true);
  const result = await client.callTool({ name: tool.name, arguments: input });
  expect(result.isError).not.toBe(true);
  expect(ajv.compile(outputSchema)(result.structuredContent)).toBe(true);
  expect(result.structuredContent).toMatchObject({
    normalized_result: { semantic_discovery: { total: 0, next_offset: null } },
  });
});

it.each(["full", "compact"] as const)(
  "advertises the primitive literal seeds accepted by semantic tracing (%s)",
  async (profile) => {
    const { client } = await connect(profile);
    const { tools } = await client.listTools();
    const tool = tools.find(
      ({ name }) => name === "trace_javascript_semantics",
    );
    if (tool === undefined) throw new Error("Semantic trace tool is missing");
    const validate = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(tool.inputSchema);
    const cases = [
      { value: "literal", expectedPrimitive: true },
      { value: 42, expectedPrimitive: true },
      { value: true, expectedPrimitive: true },
      { value: null, expectedPrimitive: true },
      { value: {}, expectedPrimitive: false },
      { value: [], expectedPrimitive: false },
    ] as const;
    let malformedChecks = 0;
    for (const { value, expectedPrimitive } of cases) {
      const arguments_ = {
        application,
        query: {
          seed: { kind: "literal", value },
          direction: "backward-provenance",
        },
      };
      if (expectedPrimitive || profile === "full")
        expect(validate(arguments_), JSON.stringify(value)).toBe(
          expectedPrimitive,
        );
      const result = await client.callTool({
        name: tool.name,
        arguments: arguments_,
      });
      if (expectedPrimitive) expect(result.isError).not.toBe(true);
      else {
        malformedChecks += 1;
        expect(parseMcpToolError(result).error).toMatchObject({
          code: "invalid_request",
          category: "invalid_input",
        });
      }
    }
    expect(malformedChecks).toBe(2);
  },
);

it("runs the same trace/compare workflows with inline and retained application Evidence", async () => {
  const { client, session } = await connect();
  expect(session.recordEvidence(pair.left).ok).toBe(true);
  expect(session.recordEvidence(pair.right).ok).toBe(true);
  expect(session.recordEvidence(exportPair.left).ok).toBe(true);
  expect(session.recordEvidence(exportPair.right).ok).toBe(true);
  const scenarios = [
    {
      name: "trace_application_feature",
      inline: JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
      refs: {
        ...JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
        application: retained(application.evidence_id),
      },
    },
    {
      name: "compare_application_versions",
      inline: pair,
      refs: {
        left: retained(pair.left.evidence_id),
        right: retained(pair.right.evidence_id),
      },
    },
    {
      name: "compare_javascript_export_shapes",
      inline: JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE,
      refs: {
        ...JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE,
        left: retained(exportPair.left.evidence_id),
        right: retained(exportPair.right.evidence_id),
      },
    },
    {
      name: "compare_source_to_bundle",
      inline: SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE,
      refs: {
        ...SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE,
        application: retained(application.evidence_id),
      },
    },
    {
      name: "trace_javascript_semantics",
      inline: {
        application,
        query: {
          seed: { kind: "literal", value: true },
          direction: "backward-provenance",
        },
      },
      refs: {
        application: retained(application.evidence_id),
        query: {
          seed: { kind: "literal", value: true },
          direction: "backward-provenance",
        },
      },
    },
  ];
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const { tools } = await client.listTools();
  for (const scenario of scenarios) {
    const tool = tools.find(({ name }) => name === scenario.name);
    if (tool === undefined) throw new Error("missing advertised tool");
    expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
    const validate = ajv.compile(tool.inputSchema);
    expect(validate(scenario.inline), scenario.name).toBe(true);
    expect(validate(scenario.refs), scenario.name).toBe(true);
    const inline = await client.callTool({
      name: scenario.name,
      arguments: scenario.inline,
    });
    expect(inline.isError, scenario.name).not.toBe(true);
    const recordsBefore = session.exportEvidenceBundle().records;
    const referenced = await client.callTool({
      name: scenario.name,
      arguments: scenario.refs,
    });
    expect(referenced.isError, scenario.name).not.toBe(true);
    expect(referenced.structuredContent).toEqual(inline.structuredContent);
    expect(session.exportEvidenceBundle().records).toEqual(recordsBefore);
  }
  const mixed = await client.callTool({
    name: "compare_application_versions",
    arguments: { left: pair.left, right: retained(pair.right.evidence_id) },
  });
  expect(mixed.isError).not.toBe(true);
});

it("keeps references session-scoped and expires them when close_binary clears the ledger", async () => {
  const first = await connect();
  const second = await connect();
  expect(first.session.recordEvidence(application).ok).toBe(true);
  const request = {
    name: "trace_application_feature",
    arguments: {
      ...JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
      application: retained(application.evidence_id),
    },
  };
  const foreign = await second.client.callTool(request);
  expect(parseMcpToolError(foreign)).toMatchObject({
    error: {
      details: {
        evidence_id: application.evidence_id,
        reason: "missing",
        actual: null,
      },
    },
  });
  const bundle = first.session.exportEvidenceBundle();
  expect(second.session.importEvidenceBundle(bundle).ok).toBe(true);
  expect((await second.client.callTool(request)).isError).not.toBe(true);
  const closed = await first.client.callTool({
    name: "close_binary",
    arguments: {},
  });
  expect(closed.isError).not.toBe(true);
  expect(parseMcpToolError(await first.client.callTool(request))).toMatchObject(
    { error: { details: { reason: "missing" } } },
  );
  for (const harness of [first, second]) {
    const portable = await harness.client.callTool({
      name: "trace_application_feature",
      arguments: JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
    });
    expect(portable.isError).not.toBe(true);
    expect((await harness.client.callTool(request)).structuredContent).toEqual(
      portable.structuredContent,
    );
  }
});

it("preserves validation for the referenced record's operation, predicate, and semantic identity", async () => {
  const { client, session } = await connect();
  for (const record of [
    createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      { operation: "inventory_artifact", parameters: {}, result: {} },
    ),
    createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "analyze_javascript_application",
        predicateType: "wrong-predicate",
        parameters: {},
        result: {},
      },
    ),
  ]) {
    expect(session.recordEvidence(record).ok).toBe(true);
    const response = await client.callTool({
      name: "trace_application_feature",
      arguments: {
        ...JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
        application: retained(record.evidence_id),
      },
    });
    expect(parseMcpToolError(response)).toMatchObject({
      error: { code: "invalid_request", category: "invalid_input" },
    });
  }
  for (const reference of [
    { evidence_id: application.evidence_id },
    { ...retained(application.evidence_id), kind: "another-session" },
    retained("ev_short"),
    { ...retained(application.evidence_id), session_id: "foreign" },
    { ...retained(application.evidence_id), normalized_result: {} },
  ]) {
    const rejected = await client.callTool({
      name: "trace_application_feature",
      arguments: {
        ...JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
        application: reference,
      },
    });
    expect(rejected.isError).toBe(true);
  }
  const tampered = {
    ...application,
    provider: { ...application.provider, id: "tampered" },
  };
  expect(() => parseEvidence(tampered)).toThrow();
  expect(session.recordEvidence(tampered).ok).toBe(false);
  const response = await client.callTool({
    name: "trace_application_feature",
    arguments: { ...JAVASCRIPT_FEATURE_TRACE_EXAMPLE, application: tampered },
  });
  expect(response.isError).toBe(true);
});

it("projects a retained JavaScript summary without graph or semantic_graph", async () => {
  const { client, session } = await connect();
  expect(session.recordEvidence(application).ok).toBe(true);
  const inline = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: { kind: "inline", evidence: application },
      view: { kind: "summary" },
    },
  });
  const referenced = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: retained(application.evidence_id),
      view: { kind: "summary" },
    },
  });
  expect(inline.isError).not.toBe(true);
  expect(referenced.structuredContent).toEqual(inline.structuredContent);
  expect(inline.structuredContent).not.toHaveProperty(
    "normalized_result.summary.semantic_graph",
  );
});
