import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  javaScriptExportShapeComparisonResultSchema,
  projectedExportReturnShapesSchema,
} from "../../../src/domain/javascript/javascriptExportShapeComparisonSchemas.js";

import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { javaScriptSemanticTraceResultSchema } from "../../../src/domain/javascript/javascriptSemanticTraceSchemas.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each([
  {
    title: "deleting an absent slot",
    initializer: '{ kind: "r" }',
    mutation: "delete result.count;",
    uncertainPresence: true,
  },
  {
    title: "deleting an initialized slot",
    initializer: '{ kind: "r", count: 1 }',
    mutation: "delete result.count;",
    uncertainPresence: true,
  },
  {
    title: "assigning an absent slot",
    initializer: '{ kind: "r" }',
    mutation: "result.count = query();",
    uncertainPresence: true,
  },
  {
    title: "a known property after an unknown spread",
    initializer: '{ ...dynamic, kind: "r", count: 1 }',
    mutation: "",
    uncertainPresence: false,
  },
  {
    title: "an unknown spread after a known property",
    initializer: '{ count: 1, ...dynamic, kind: "r" }',
    mutation: "",
    uncertainPresence: false,
  },
  {
    title: "an unresolved value with known presence",
    initializer: '{ kind: "r", count: query() }',
    mutation: "",
    uncertainPresence: false,
  },
])(
  "respects property presence when tracing $title",
  async ({ initializer, mutation, uncertainPresence }) => {
    const root = await createTestTempDirectory("rea-mutation-presence-mcp-");
    await writeFile(
      join(root, "parser.mjs"),
      `export default function make() {
        const result = ${initializer};
        ${mutation}
        return result;
      }`,
    );
    const application = await analyzeJavaScriptApplication({
      input_path: root,
    });
    if (!application.ok) throw application.error;
    const graph = javascriptApplicationAnalysisResultSchema.parse(
      application.value.normalized_result,
    ).semantic_graph;
    const binding = graph.nodes.find(
      ({ kind, label }) => kind === "binding" && label === "result",
    );
    const uncertain = graph.nodes.find(
      ({ kind, properties }) =>
        kind === "property-slot" && properties.name === "count",
    );
    const known = graph.nodes.find(
      ({ kind, properties }) =>
        kind === "property-slot" && properties.name === "kind",
    );
    if (binding === undefined || uncertain === undefined || known === undefined)
      throw new Error("Expected binding and both property slots");

    const { client, close } = await createApplicationMcpHarness();
    onTestFinished(close);
    for (const includeCandidates of [false, true]) {
      const response = await client.callTool({
        name: "trace_javascript_semantics",
        arguments: {
          application: application.value,
          query: {
            seed: { kind: "semantic-node", node_id: binding.node_id },
            direction: "forward-influence",
            allowed_relations: ["writes-property"],
            include_ambiguous_dynamic_edges: includeCandidates,
          },
        },
      });
      expect(response.isError).not.toBe(true);
      const result = javaScriptSemanticTraceResultSchema.parse(
        parseEvidence(response.structuredContent).normalized_result,
      );
      const nodeIds = result.nodes.map(({ node_id }) => node_id);
      expect(nodeIds).toContain(known.node_id);
      expect(nodeIds.includes(uncertain.node_id)).toBe(
        includeCandidates || !uncertainPresence,
      );
      expect(result.relations).toContainEqual(
        expect.objectContaining({
          source_node_id: binding.node_id,
          target_node_id: known.node_id,
          relation: "writes-property",
          resolution: "resolved",
        }),
      );
      if (includeCandidates || !uncertainPresence)
        expect(result.relations).toContainEqual(
          expect.objectContaining({
            source_node_id: binding.node_id,
            target_node_id: uncertain.node_id,
            relation: "writes-property",
            resolution: uncertainPresence ? "candidate" : "resolved",
          }),
        );
    }
  },
);

const analyzedSource = async (source: string) => {
  const root = await createTestTempDirectory("rea-property-facts-mcp-");
  await writeFile(join(root, "parser.mjs"), source);
  const analyzed = await analyzeJavaScriptApplication({ input_path: root });
  if (!analyzed.ok) throw analyzed.error;
  return {
    evidence: analyzed.value,
    ...javascriptApplicationAnalysisResultSchema.parse(
      analyzed.value.normalized_result,
    ),
  };
};

it("selects full nested property paths through authenticated MCP semantic traces", async () => {
  const application = await analyzedSource(`
    const root = {a:{id:'left'}, b:{id:'right'}, 'a.id':'dotted', '': {'a/b~c':'escaped'}};
    const left = root.a.id;
    const right = root['b'].id;
    const missing = root.id;
    const dotted = root['a.id'];
    const escaped = root['']['a/b~c'];
  `);
  const { client, close } = await createApplicationMcpHarness();
  onTestFinished(close);
  for (const [pointer, expected] of [
    ["/a/id", "left"],
    ["/b/id", "right"],
    ["/a.id", "dotted"],
    ["//a~1b~0c", "escaped"],
    ["/id", null],
  ]) {
    const slot = application.semantic_graph.nodes.find(
      ({ kind, properties }) =>
        kind === "property-slot" && properties.property_pointer === pointer,
    );
    if (slot === undefined) throw new Error(`Missing property ${pointer}`);
    const response = await client.callTool({
      name: "trace_javascript_semantics",
      arguments: {
        application: application.evidence,
        query: {
          seed: { kind: "semantic-node", node_id: slot.node_id },
          direction: "backward-provenance",
          allowed_relations: ["defines"],
        },
      },
    });
    expect(response.isError).not.toBe(true);
    const trace = javaScriptSemanticTraceResultSchema.parse(
      parseEvidence(response.structuredContent).normalized_result,
    );
    expect(
      trace.nodes
        .filter(({ kind }) => kind === "literal")
        .map(({ properties }) => properties.value),
    ).toEqual(expected === null ? [] : [expected]);
    const reads = application.semantic_graph.relations.filter(
      ({ source_node_id, relation }) =>
        source_node_id === slot.node_id && relation === "reads-property",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.resolution).toBe(
      expected === null ? "candidate" : "resolved",
    );
  }
});

it.each([
  {
    title: "spread before an explicit field",
    body: 'const result = {...dynamic, kind:"r", count:1};',
    path: "/count",
    presence: "present",
    valueState: "literal",
    change: "changed",
    baseline: 'const result = {kind:"r",count:2};',
  },
  {
    title: "spread after an explicit field",
    body: 'const result = {count:1, ...dynamic, kind:"r"};',
    path: "/count",
    presence: "present",
    valueState: "unknown",
    change: "unknown",
    baseline: 'const result = {kind:"r",count:2};',
  },
  {
    title: "deletion",
    body: 'const result = {kind:"r",count:1}; delete result.count;',
    path: "/count",
    presence: "unknown-coverage",
    valueState: "unknown",
    change: "unknown",
    baseline: 'const result = {kind:"r",count:2};',
  },
  {
    title: "uncertain mutation",
    body: 'const result = {kind:"r"}; if(flag) result.count=2;',
    path: "/count",
    presence: "unknown-coverage",
    valueState: "unknown",
    change: "unknown",
    baseline: 'const result = {kind:"r",count:2};',
  },
  {
    title: "array length mutation",
    body: 'const items = [1]; items.length = query(); const result = {kind:"r", length: items.length, items};',
    path: "/length",
    presence: "present",
    valueState: "unknown",
    change: "unknown",
    baseline: 'const result = {kind:"r",length:1,items:[2]};',
  },
  {
    title: "array length mutation followed by another write",
    body: 'const items = [1]; items.length = 0; items[0] = 9; const result = {kind:"r", length: items.length, items};',
    path: "/length",
    presence: "present",
    valueState: "unknown",
    change: "unknown",
    baseline: 'const result = {kind:"r",length:1,items:[2]};',
  },
  {
    title: "an array hole",
    body: 'const result = {kind:"r",items:[,]};',
    path: "/items/0",
    presence: "absent",
    valueState: "unknown",
    change: "added",
    baseline: 'const result = {kind:"r",items:[2]};',
  },
])(
  "agrees on slot presence across export comparison and semantic tracing for $title",
  async ({ body, path, presence, valueState, change, baseline }) => {
    const left = await analyzedSource(
      `export default function make() { ${body} return result; }`,
    );
    const right = await analyzedSource(
      `export default function make() { ${baseline} return result; }`,
    );
    const slot = left.semantic_graph.nodes.find(
      ({ kind, properties }) =>
        kind === "property-slot" && properties.property_pointer === path,
    );
    if (slot === undefined) throw new Error(`Missing property ${path}`);
    expect(slot.properties).toMatchObject({
      presence,
      value_status: valueState,
    });
    const observation = left.graph.nodes
      .flatMap(({ observations }) => observations)
      .find(
        ({ properties }) => properties.semantic_role === "export-return-shapes",
      );
    const projection = projectedExportReturnShapesSchema.parse(
      observation?.properties,
    );
    expect(projection.static_return_shapes[0]?.fields).toContainEqual(
      expect.objectContaining({ path, presence, state: valueState }),
    );
    if (path === "/length")
      expect(
        projection.static_return_shapes[0]?.property_coverage,
      ).toContainEqual({ path: "/items", status: "partial", omitted: null });
    const { client, close } = await createApplicationMcpHarness();
    onTestFinished(close);
    const traced = await client.callTool({
      name: "trace_javascript_semantics",
      arguments: {
        application: left.evidence,
        query: {
          seed: { kind: "semantic-node", node_id: slot.node_id },
          direction: "backward-provenance",
          allowed_relations: ["defines"],
        },
      },
    });
    expect(traced.isError).not.toBe(true);
    const trace = javaScriptSemanticTraceResultSchema.parse(
      parseEvidence(traced.structuredContent).normalized_result,
    );
    expect(
      trace.nodes
        .filter(({ kind }) => kind === "literal")
        .map(({ properties }) => properties.value),
    ).toEqual(valueState === "literal" ? [1] : []);
    const compared = await client.callTool({
      name: "compare_javascript_export_shapes",
      arguments: {
        left: left.evidence,
        right: right.evidence,
        left_module_path: "parser.mjs",
        left_export_name: "default",
        right_module_path: "parser.mjs",
        right_export_name: "default",
      },
    });
    expect(compared.isError).not.toBe(true);
    const comparison = javaScriptExportShapeComparisonResultSchema.parse(
      parseEvidence(compared.structuredContent).normalized_result,
    );
    expect(comparison.changes).toContainEqual(
      expect.objectContaining({
        path,
        status: change,
        presence: { left: presence, right: "present" },
      }),
    );
  },
);
