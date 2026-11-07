import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import type { AnalysisOperationPort } from "../../../src/application/AnalysisProvider.js";
import {
  JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE,
  JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
  SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE,
} from "../../../src/contracts/javascript/javascriptApplicationWorkflowExamples.js";
import { JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE } from "../../../src/contracts/javascript/javascriptExportShapeComparisonExample.js";
import { JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE } from "../../../src/contracts/javascript/javascriptRuntimeReconciliationExample.js";
import {
  ANDROID_APPLICATION_GRAPH_EXAMPLE,
  APPLE_APPLICATION_GRAPH_EXAMPLE,
  HARMONY_APPLICATION_GRAPH_EXAMPLE,
} from "../../../src/contracts/mobileApplicationGraphExamples.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

// These authenticated catalog examples are authored fixtures, not real-provider
// verification. Their complete requests fit the default 1,024-element policy;
// the largest is the 750-element export-shape pair. No input allowance is raised.
const application = JAVASCRIPT_FEATURE_TRACE_EXAMPLE.application;
const semanticInput = {
  application,
  query: {
    seed: { kind: "literal", value: true },
    direction: "backward-provenance",
  },
};
const scenarios = [
  {
    name: "trace_application_feature",
    input: JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
    sourceIds: [application.evidence_id],
    facts: { summary: { matched_seeds: 1, traced_nodes: 1 } },
  },
  {
    name: "trace_javascript_semantics",
    input: semanticInput,
    sourceIds: [application.evidence_id],
    facts: { source_evidence_id: application.evidence_id },
  },
  {
    name: "compare_application_versions",
    input: JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE,
    sourceIds: [
      JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE.left.evidence_id,
      JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE.right.evidence_id,
    ],
    facts: {
      left: {
        evidence_id:
          JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE.left.evidence_id,
      },
      right: {
        evidence_id:
          JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE.right.evidence_id,
      },
    },
  },
  {
    name: "compare_source_to_bundle",
    input: SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE,
    sourceIds: [SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE.application.evidence_id],
    facts: {
      application: {
        evidence_id:
          SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE.application.evidence_id,
      },
    },
  },
  {
    name: "compare_javascript_export_shapes",
    input: JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE,
    sourceIds: [
      JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE.left.evidence_id,
      JAVASCRIPT_EXPORT_SHAPE_COMPARISON_EXAMPLE.right.evidence_id,
    ],
    facts: { coverage: { status: "partial" } },
  },
  {
    name: "reconcile_javascript_runtime",
    input: JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE,
    sourceIds: [
      ...JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.static_layers.map(
        ({ analysis }) => analysis.evidence_id,
      ),
      ...JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.runtime_observations.map(
        ({ evidence_id }) => evidence_id,
      ),
    ],
    facts: {
      source_map_authority: { used_for_primary_matching: false },
    },
  },
  ...(
    [
      {
        name: "project_android_application_graph",
        input: ANDROID_APPLICATION_GRAPH_EXAMPLE,
      },
      {
        name: "project_apple_application_graph",
        input: APPLE_APPLICATION_GRAPH_EXAMPLE,
      },
      {
        name: "project_harmony_application_graph",
        input: HARMONY_APPLICATION_GRAPH_EXAMPLE,
      },
    ] as const
  ).map(({ name, input }) => ({
    name,
    input,
    sourceIds: input.inventory_evidence.map(({ evidence_id }) => evidence_id),
    facts: {
      source_evidence_ids: input.inventory_evidence.map(
        ({ evidence_id }) => evidence_id,
      ),
      coverage: { status: "partial", inventory_complete: true },
    },
  })),
] as const;

const execute = vi.fn<AnalysisOperationPort["execute"]>(() => {
  throw new Error("Fixed Evidence composition must not execute a provider");
});
const observe = vi.fn(() => {
  throw new Error("Fixed Evidence composition must not observe a live runtime");
});
const providerIdentity = () => ({
  id: "fixed-composition-fixture",
  name: "Fixed composition fixture",
  version: "1",
});
const server = createServer(
  { kind: "fixed", analysis: { execute } },
  {
    environment: { REA_MCP_TOOL_FAMILIES: "application,electron" },
    electronObservation: {
      identity: providerIdentity,
      listTargets: observe,
      inspectPage: observe,
    },
    javascriptRuntimeObservation: {
      identity: providerIdentity,
      listTargets: observe,
      observe,
    },
  },
);
const client = new Client({ name: "fixed-evidence-fixtures", version: "1" });

beforeAll(async () => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const names = new Set(
    (await client.listTools()).tools.map(({ name }) => name),
  );
  for (const scenario of scenarios) expect(names.has(scenario.name)).toBe(true);
  expect(names.has("inspect_analysis_view")).toBe(true);
  expect(names.has("get_evidence_bundle")).toBe(false);
});

afterEach(() => {
  expect(execute).not.toHaveBeenCalled();
  expect(observe).not.toHaveBeenCalled();
});

afterAll(async () => {
  const closed = await Promise.allSettled([client.close(), server.close()]);
  const failures = closed.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, "Fixed fixture MCP cleanup failed");
});

it.each(scenarios)(
  "composes complete caller-owned $name sources without a recorder",
  async ({ name, input, sourceIds, facts }) => {
    const reply = await client.callTool({ name, arguments: input });
    expect(reply.isError, JSON.stringify(reply.structuredContent)).not.toBe(
      true,
    );
    const evidence = parseEvidence(reply.structuredContent);
    expect(toolContract(name).outputSchema.safeParse(evidence).success).toBe(
      true,
    );
    expect(evidence.operation).toBe(name);
    expect(evidence.evidence_links.toSorted()).toEqual(
      [...new Set(sourceIds)].sort(),
    );
    expect(evidence.normalized_result).toMatchObject(facts);
  },
);

it("projects a caller-owned inline source directly through inspect_analysis_view", async () => {
  const reply = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: { kind: "inline", evidence: application },
      view: { kind: "summary" },
    },
  });
  expect(reply.isError, JSON.stringify(reply.structuredContent)).not.toBe(true);
  const evidence = parseEvidence(reply.structuredContent);
  expect(
    toolContract("inspect_analysis_view").outputSchema.safeParse(evidence)
      .success,
  ).toBe(true);
  expect(evidence.evidence_links).toEqual([application.evidence_id]);
  expect(evidence.normalized_result).toMatchObject({
    kind: "summary",
    parent_evidence_id: application.evidence_id,
    parent_operation: application.operation,
    summary: { format: "directory" },
  });
  expect(evidence.normalized_result).not.toHaveProperty("summary.graph");
});

it("keeps a direct inspect_analysis_view retained source missing on the fixed server", async () => {
  const reply = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: {
        kind: "retained-evidence",
        evidence_id: application.evidence_id,
      },
      view: { kind: "summary" },
    },
  });
  expect(parseMcpToolError(reply)).toMatchObject({
    error: {
      details: { evidence_id: application.evidence_id, reason: "missing" },
    },
  });
});

it("does not turn caller-owned inline sources into a hidden fixed-server ledger", async () => {
  const reply = await client.callTool({
    name: "trace_application_feature",
    arguments: {
      ...JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
      application: {
        kind: "retained-evidence",
        evidence_id: application.evidence_id,
      },
    },
  });
  expect(parseMcpToolError(reply)).toMatchObject({
    error: {
      details: { evidence_id: application.evidence_id, reason: "missing" },
    },
  });
});

it("requires an explicit retaining session for a source-to-bundle summary view", async () => {
  const reply = await client.callTool({
    name: "compare_source_to_bundle",
    arguments: {
      ...SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE,
      view: { kind: "summary" },
    },
  });
  expect(parseMcpToolError(reply)).toMatchObject({
    error: {
      code: "capability_unavailable",
      message: expect.stringContaining("does not retain Evidence"),
    },
  });
});

it.each([
  {
    name: "trace_application_feature",
    input: {
      ...JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
      application: ANDROID_APPLICATION_GRAPH_EXAMPLE.inventory_evidence[0],
    },
    issue: { path: ["application", "operation"], reason: "invalid_value" },
  },
  {
    name: "project_android_application_graph",
    input: { inventory_evidence: [application] },
    issue: {
      path: ["inventory_evidence", 0, "operation"],
      reason: "invalid_value",
    },
  },
  {
    name: "reconcile_javascript_runtime",
    input: {
      ...JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE,
      static_layers: [
        {
          analysis: ANDROID_APPLICATION_GRAPH_EXAMPLE.inventory_evidence[0],
        },
      ],
    },
    issue: {
      path: ["static_layers", 0, "analysis", "normalized_result", "input_path"],
      reason: "missing_argument",
    },
  },
])(
  "rejects an authenticated source with the wrong role in $name",
  async ({ name, input, issue }) => {
    const reply = await client.callTool({ name, arguments: input });
    expect(parseMcpToolError(reply)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          operation: name,
          issues: expect.arrayContaining([expect.objectContaining(issue)]),
        },
      },
    });
    await client.ping();
  },
);

it("keeps the default input admission before fixed-server source decoding", async () => {
  const reply = await client.callTool({
    name: "trace_application_feature",
    arguments: {
      ...JAVASCRIPT_FEATURE_TRACE_EXAMPLE,
      native_observations: Array.from({ length: 1_025 }, () => ({})),
    },
  });
  expect(parseMcpToolError(reply)).toMatchObject({
    error: {
      code: "resource_constraint",
      details: { reported_limits: { max_input_elements: 1_024 } },
    },
  });
  await client.ping();
});
