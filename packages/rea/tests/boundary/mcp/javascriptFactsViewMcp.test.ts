import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import { advertisedInputJsonSchema } from "../../../src/contracts/toolSchemaMetadata.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  analysisViewJavaScriptAnalysis,
  analysisViewJavaScriptEvidence,
  analysisViewBindJavaScriptGraphs,
} from "../../fixtures/analysisView.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import {
  analysisViewResultSchema,
  type AnalysisViewResult,
} from "../../../src/domain/analysisView/analysisView.js";
import {
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
} from "../../../src/domain/javascript/javascriptApplicationGraph.js";

const connect = async () => {
  const harness = await createApplicationMcpHarness({
    session: createTestBinarySession(() => {
      throw new Error("Reading retained facts must not start a deep provider");
    }),
  });
  onTestFinished(() => harness.close());
  return harness;
};

const facts = async (
  harness: Awaited<ReturnType<typeof connect>>,
  source: unknown,
  view: unknown,
) => {
  const wire = await harness.client.callTool({
    name: "inspect_analysis_view",
    arguments: { source, view },
  });
  expect(wire.isError).not.toBe(true);
  const evidence = parseEvidence(wire.structuredContent);
  const page = analysisViewResultSchema.parse(evidence.normalized_result);
  if (page.kind !== "javascript-facts") throw new Error("Expected fact view");
  return { evidence, page, wire };
};

/** Summary counts and both Evidence lookup paths preserve selected/excluded source facts. */
const expectSelectedSourceCoverage = async (
  harness: Awaited<ReturnType<typeof connect>>,
  parent: Evidence,
  summary: Extract<
    AnalysisViewResult,
    { kind: "summary"; parent_operation: "analyze_javascript_application" }
  >,
): Promise<void> => {
  expect(summary.summary.coverage).toMatchObject({
    static_sources: {
      sources: 2,
      unmeasured_sources: 0,
      syntax: { complete: 1, "not-examined": 1 },
      examination: { complete: 1, "not-examined": 1 },
      electron_applicability: { observed: 0, unknown: 2 },
    },
  });
  const query = {
    kind: "javascript-facts",
    where: { paths: ["a.js", "b.js"], kinds: ["javascript-asset"] },
    property_keys: ["analysis_coverage"],
    limit: 64,
  };
  const retained = await facts(
    harness,
    { kind: "retained-evidence", evidence_id: parent.evidence_id },
    query,
  );
  const portable = await facts(
    harness,
    { kind: "inline", evidence: parent },
    query,
  );
  expect(portable.evidence).toEqual(retained.evidence);
  expect(
    retained.page.rows.map(({ properties }) => properties.analysis_coverage),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        syntax: { status: "complete", error_count: 0 },
      }),
      expect.objectContaining({
        syntax: { status: "not-examined", error_count: null },
        unexamined_reason:
          "Source is outside the caller-selected source_paths.",
      }),
    ]),
  );
};

it("pages selected real filesystem observations with shared identities and portable/retained parity", async () => {
  const root = await createTestTempDirectory("rea-retained-file-facts-");
  await Promise.all(
    (
      [
        ["a.js", "export const observed = 7;"],
        ["b.js", "export const excluded = true;"],
        ["first.node", Buffer.from([0, 1, 2, 3])],
        ["second.node", Buffer.from([0, 1, 2, 3])],
        ["package.json", '{"name":"file-facts","main":"a.js"}'],
      ] as const
    ).map(([path, value]) => writeFile(join(root, path), value)),
  );
  const harness = await connect();
  const preparation = await harness.client.callTool({
    name: "analyze_javascript_application",
    arguments: { input_path: root, source_paths: ["a.js"], detail: "summary" },
  });
  expect(preparation.isError).not.toBe(true);
  const summary = analysisViewResultSchema.parse(
    parseEvidence(preparation.structuredContent).normalized_result,
  );
  if (
    summary.kind !== "summary" ||
    summary.parent_operation !== "analyze_javascript_application"
  )
    throw new Error("Expected JavaScript summary view");
  const parent = harness.session.evidenceById(summary.parent_evidence_id);
  if (parent === undefined) throw new Error("Missing retained parent");
  const source = { kind: "retained-evidence", evidence_id: parent.evidence_id };
  await expectSelectedSourceCoverage(harness, parent, summary);
  const query = {
    kind: "javascript-facts",
    where: { paths: ["first.node", "second.node", "package.json", "missing"] },
    property_keys: ["bytes", "parse_status", "operation", "not_present"],
    limit: 64,
  };
  const { ajv, inputSchema, outputSchema } = await advertisedMcpToolSchemas(
    harness.client,
    "inspect_analysis_view",
  );
  expect(ajv.validate(inputSchema, { source, view: query })).toBe(true);
  const malformed = { source, view: { ...query, property_keys: [""] } };
  const fullInputSchema = advertisedInputJsonSchema(
    toolContract("inspect_analysis_view"),
  );
  expect(ajv.validate(fullInputSchema, malformed)).toBe(false);
  const rejected = await harness.client.callTool({
    name: "inspect_analysis_view",
    arguments: malformed,
  });
  expect(parseMcpToolError(rejected)).toMatchObject({
    error: { code: "invalid_request", category: "invalid_input" },
  });
  const full = await facts(harness, source, query);
  expect(ajv.validate(outputSchema, full.wire.structuredContent)).toBe(true);
  const portable = await facts(
    harness,
    { kind: "inline", evidence: parent },
    query,
  );
  expect(portable.evidence).toEqual(full.evidence);
  expect(full.page.source_coverage).toMatchObject({
    application: { status: "partial" },
    source_selection: { requested_paths: ["a.js"] },
  });
  const native = full.page.rows.filter(({ kind }) => kind === "native-addon");
  expect(new Set(native.map(({ node_id }) => node_id)).size).toBe(1);
  expect(new Set(native.map(({ observation_id }) => observation_id)).size).toBe(
    native.length,
  );
  expect(
    new Set(
      native.map(({ evidence }) =>
        evidence.location.available &&
        evidence.location.value.kind === "artifact-path"
          ? evidence.location.value.path
          : null,
      ),
    ),
  ).toEqual(new Set(["first.node", "second.node"]));
  expect(
    native
      .filter(({ properties }) => Object.hasOwn(properties, "parse_status"))
      .map(({ properties }) => properties.parse_status),
  ).toEqual([null, null]);
  expect(
    full.page.rows.every(
      ({ properties }) => !Object.hasOwn(properties, "not_present"),
    ),
  ).toBe(true);
  const nativeOnly = await facts(harness, source, {
    ...query,
    where: { ...query.where, kinds: ["native-addon"] },
  });
  expect(nativeOnly.page.rows).toEqual(native);
  const paged = [];
  let offset = 0;
  for (;;) {
    const { page } = await facts(harness, source, {
      ...query,
      offset,
      limit: 1,
    });
    paged.push(...page.rows);
    if (page.coverage.next_offset === null) break;
    offset = page.coverage.next_offset;
  }
  expect(paged).toEqual(full.page.rows);
  for (const where of [{ paths: [] }, { paths: ["missing"] }, { kinds: [] }]) {
    const { page } = await facts(harness, source, { ...query, where });
    expect(page.rows).toEqual([]);
    expect(page.coverage).toMatchObject({ total: 0, exhausted: true });
    expect(page.source_coverage).toEqual(full.page.source_coverage);
  }
  const identityOnly = await facts(harness, source, {
    ...query,
    property_keys: [],
  });
  expect(
    identityOnly.page.rows.every(
      ({ properties }) => Object.keys(properties).length === 0,
    ),
  ).toBe(true);
  expect(identityOnly.page.rows.map(({ evidence }) => evidence)).toEqual(
    full.page.rows.map(({ evidence }) => evidence),
  );
  const discoveryQuery = {
    ...query,
    property_keys: [],
    include_available_property_keys: true,
  };
  expect(ajv.validate(inputSchema, { source, view: discoveryQuery })).toBe(
    true,
  );
  const discovery = await facts(harness, source, discoveryQuery);
  expect(ajv.validate(outputSchema, discovery.wire.structuredContent)).toBe(
    true,
  );
});

const evidenceWithMixedLocations = () => {
  const analysis = analysisViewJavaScriptAnalysis();
  const original = analysis.graph.nodes[0];
  const observation = original?.observations[0];
  if (original === undefined || observation === undefined)
    throw new Error("Missing canonical fixture");
  const locations = [
    { kind: "artifact-path", path: "literal.js" },
    {
      kind: "source-range",
      source: "file:///app.js?x#y",
      start: { line: 1, column: 0 },
      end: { line: 1, column: 1 },
    },
  ] as const;
  const node = createJavaScriptApplicationNode({
    kind: original.kind,
    identity: original.identity,
    observations: [
      ...locations.map((value) => ({
        label: "display text",
        properties: {
          path: "looks-known",
          nullable: null,
          omitted: "unselected_large_field".repeat(4096),
        },
        evidence: {
          ...observation.evidence,
          location: {
            available: true as const,
            value,
          },
        },
      })),
      {
        label: "unknown location",
        properties: { path: "looks-known", nullable: null },
        evidence: {
          ...observation.evidence,
          authority: "unknown",
          state: "unknown",
          confidence: "unknown",
          location: {
            available: false,
            reason: "not-observed",
            detail: "Location was not captured",
          },
          limitations: ["Location was not captured"],
        },
      },
      {
        label: "a URL location is distinct from a source-range source",
        properties: { nullable: null },
        evidence: {
          ...observation.evidence,
          location: {
            available: true,
            value: { kind: "url", url: "file:///app.js?x#y" },
          },
        },
      },
    ],
  });
  const graph = createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: [node.node_id],
    nodes: [node],
    edges: [],
    coverage: {
      status: "partial",
      truncated: false,
      omitted_count: null,
      limits: [],
    },
    limitations: ["One observation has an uncaptured source location"],
  });
  const parent = analysisViewJavaScriptEvidence(
    analysisViewBindJavaScriptGraphs(analysis, graph),
  );
  return { parent, node, locations };
};

it("uses exact evidence locations without normalizing display properties or dropping unknown observations", async () => {
  const { parent, node, locations } = evidenceWithMixedLocations();
  const harness = await connect();
  const recorded = harness.session.recordEvidence(parent);
  if (!recorded.ok) throw recorded.error;
  const source = { kind: "retained-evidence", evidence_id: parent.evidence_id };
  const query = {
    kind: "javascript-facts",
    property_keys: ["nullable", "missing", "nullable"],
    limit: 64,
  };
  const all = await facts(harness, source, query);
  expect(all.page.rows).toHaveLength(4);
  expect(
    all.page.rows.every(
      (row) => !Object.hasOwn(row, "available_property_keys"),
    ),
  ).toBe(true);
  const discovery = await facts(harness, source, {
    ...query,
    property_keys: [],
    include_available_property_keys: true,
  });
  expect(
    discovery.page.rows.map(
      ({ available_property_keys }) => available_property_keys,
    ),
  ).toEqual(
    node.observations.map(({ properties }) => Object.keys(properties).sort()),
  );
  expect(
    discovery.page.rows.every(
      ({ properties }) => Object.keys(properties).length === 0,
    ),
  ).toBe(true);
  expect(JSON.stringify(discovery.wire)).not.toContain(
    "unselected_large_field",
  );
  expect(discovery.page.rows.map(({ evidence }) => evidence)).toEqual(
    all.page.rows.map(({ evidence }) => evidence),
  );
  expect(all.page.rows.map(({ properties }) => properties)).toEqual(
    all.page.rows.map(() => ({ nullable: null })),
  );
  expect(all.page.rows.map(({ evidence }) => evidence)).toEqual(
    node.observations.map(({ evidence }) => evidence),
  );
  for (const value of locations) {
    const path = value.kind === "artifact-path" ? value.path : value.source;
    const { page } = await facts(harness, source, {
      ...query,
      where: { paths: [path] },
    });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.evidence.location).toEqual({
      available: true,
      value,
    });
  }
  const malformed = await harness.client.callTool({
    name: "inspect_analysis_view",
    arguments: { source, view: { ...query, where: { paths: [null] } } },
  });
  expect(malformed.isError).toBe(true);
  const filtered = await facts(harness, source, {
    ...query,
    where: { paths: ["looks-known", "file:///app.js", ""] },
  });
  expect(filtered.page.rows).toEqual([]);
  const exhausted = await facts(harness, source, { ...query, offset: 999 });
  expect(exhausted.page.coverage).toMatchObject({
    total: 4,
    examined: 0,
    exhausted: true,
    next_offset: null,
  });
});
