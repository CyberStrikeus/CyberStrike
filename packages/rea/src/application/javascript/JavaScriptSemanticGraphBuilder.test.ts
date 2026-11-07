import { javaScriptSemanticQueryInputSchema } from "../../domain/javascript/javascriptSemanticQuerySchemas.js";
import {
  primitiveByteExpansionSource,
  primitiveCandidateExpansionExpression,
} from "../../../tests/fixtures/javascriptPrimitiveExpansion.js";
import { graphForJavaScript as graphFor } from "../../../tests/fixtures/javascriptSemanticGraph.js";
import * as t from "@babel/types";
import { expect, it } from "vitest";
import { aliasSelectionBudgetSource } from "../../../tests/fixtures/javascriptAliasSelectionBudget.js";

import {
  SEMANTIC_GRAPH_FILE_NODE_CEILING,
  SEMANTIC_GRAPH_NODE_CEILING,
  createJavaScriptSemanticGraphProjection,
  projectJavaScriptSemanticFileSteps,
} from "./JavaScriptSemanticGraphBuilder.js";
import {
  addSemanticGraphNode,
  constructSemanticGraphNode,
  createSemanticGraphProjectionState,
} from "./JavaScriptSemanticGraphConstruction.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { queryJavaScriptSemanticGraph } from "../../domain/javascript/javascriptSemanticQuery.js";
import {
  analyzeJavaScriptSemantics,
  analyzeParsedJavaScriptSemantics,
} from "../../domain/javascript/javascriptSemanticAnalysis.js";
import { parseJavaScriptSource } from "../../domain/javascript/javascriptSourceParser.js";
import { semanticCoverageResourceLimits } from "../../domain/javascript/javascriptSemanticCoverage.js";
import { getterExpansionSource } from "../../../tests/fixtures/javascriptGetterExpansion.js";

const SHA256 = "a".repeat(64);

it("retains direct call literals and resolves literal queries to their argument", () => {
  const source =
    'api.rpc("proc_0", 7, false, null, dynamic, ...values, `fixed`, -3);';
  const graph = graphFor(source);
  const call = graph.nodes.find(({ kind }) => kind === "call-site");
  const argumentsValue = call?.properties.arguments;
  expect(argumentsValue).toEqual([
    expect.objectContaining({
      index: 0,
      value: "proc_0",
      source_range: expect.any(Object),
    }),
    expect.objectContaining({ index: 1, value: 7 }),
    expect.objectContaining({ index: 2, value: false }),
    expect.objectContaining({ index: 3, value: null }),
    expect.objectContaining({ index: 6, value: "fixed" }),
    expect.objectContaining({ index: 7, value: -3 }),
  ]);
  if (call === undefined) throw new Error("Expected call site");
  const trace = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: "proc_0" },
      direction: "forward-influence",
    }),
  );
  expect(
    trace.nodes.find((node) => node.node_id === trace.seed_node_ids[0])?.label,
  ).toBe("argument 0");
  expect(trace.nodes.some((node) => node.node_id === call.node_id)).toBe(true);
});

it("reports the primitive byte bound when a direct argument is too large", () => {
  const source = `rpc(${JSON.stringify("x".repeat(175_000))});`;
  const ir = analyzeJavaScriptSemantics(source);
  expect(ir.coverage.resourceLimits).toContain("primitive-bytes");
  const graph = graphFor(source, ir);
  const call = graph.nodes.find(({ kind }) => kind === "call-site");
  expect(call?.properties.arguments).toBeUndefined();
  expect(graph.coverage.status).not.toBe("complete");
  const unknown = graph.unknowns.find(
    (entry) =>
      entry.node_id === call?.node_id && entry.reason === "resource-limit",
  );
  expect(unknown?.detail).toMatch(/primitive string-byte budget exceeded/i);
  expect(
    graph.evidence_contexts.find(
      (entry) => entry.context_id === unknown?.evidence.context_id,
    ),
  ).toMatchObject({
    coverage: {
      limits: expect.arrayContaining([
        expect.objectContaining({
          name: "javascript_semantic_primitive_bytes",
        }),
      ]),
    },
  });
});

it("keeps a large call's graph within the worker record limit and reports omitted arguments", () => {
  const value = JSON.stringify("x".repeat(140_000));
  const source = `rpc(${Array.from({ length: 64 }, () => value).join(",")});`;
  const graph = graphFor(source);
  const call = graph.nodes.find(({ kind }) => kind === "call-site");
  if (call === undefined) throw new Error("Expected call site");
  const values = call.properties.arguments;
  expect(Array.isArray(values)).toBe(true);
  if (!Array.isArray(values)) throw new Error("Expected retained arguments");
  expect(values.length).toBeGreaterThan(0);
  expect(values.length).toBeLessThan(64);
  expect(
    Buffer.byteLength(`${JSON.stringify({ kind: "node", value: call })}\n`),
  ).toBeLessThanOrEqual(8 * 1024 * 1024);
  const unknown = graph.unknowns.find(
    (entry) =>
      entry.node_id === call.node_id &&
      entry.detail.includes("worker transfer record ceiling"),
  );
  expect(unknown).toMatchObject({ reason: "resource-limit" });
  expect(
    graph.evidence_contexts.find(
      (entry) => entry.context_id === unknown?.evidence.context_id,
    ),
  ).toMatchObject({
    coverage: {
      limits: expect.arrayContaining([
        expect.objectContaining({
          name: "javascript_analysis_transfer_record_bytes",
          value: 8 * 1024 * 1024,
        }),
      ]),
    },
  });
});

it("projects bounded alias selection as a resource-limit unknown", () => {
  const source = aliasSelectionBudgetSource();
  const ir = analyzeJavaScriptSemantics(source);
  const graph = graphFor(source, ir);
  expect(ir.coverage).toMatchObject({
    status: "partial",
    resourceLimits: ["alias-selections"],
  });
  const unknown = graph.unknowns.find(
    ({ reason, detail }) =>
      reason === "resource-limit" && /Alias selection expansion/u.test(detail),
  );
  expect(unknown).toBeDefined();
  expect(
    graph.evidence_contexts.find(
      ({ context_id }) => context_id === unknown?.evidence.context_id,
    ),
  ).toMatchObject({
    coverage: {
      limits: expect.arrayContaining([
        {
          name: "javascript_semantic_alias_selections",
          value: 512,
          unit: "items",
        },
      ]),
    },
  });
});

it.each([
  ["plain export", "const answer = 42; export { answer };", 0],
  ["aliased export", "const answer = 42; export { answer as result };", 0],
  ["declaration only", "const answer = 42;", 0],
  ["genuine assignment", "let answer = 0; answer = 1;", 1],
])(
  "projects writes only for actual writes: %s",
  (_name, source, writeCount) => {
    const graph = graphFor(source);
    const binding = graph.nodes.find(
      ({ kind, label }) => kind === "binding" && label === "answer",
    );
    if (binding === undefined) throw new Error("Expected answer binding");
    const writes = graph.relations.filter(
      ({ relation, target_node_id }) =>
        relation === "writes" && target_node_id === binding.node_id,
    );
    expect(writes).toHaveLength(writeCount);
    const exportReference = graph.nodes.find(
      ({ identity }) => identity.role_key === "reference:0:export:answer",
    );
    if (source.includes("export {")) expect(exportReference).toBeDefined();

    const trace = queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "semantic-node", node_id: binding.node_id },
        direction: "backward-provenance",
        allowed_relations: ["writes"],
      }),
    );
    expect(trace.status).toBe("found");
    expect(trace.summary).toMatchObject({
      total_seed_matches: 1,
      traversed_relations: writeCount,
    });
    expect(trace.relations).toHaveLength(writeCount);
  },
);

it("projects closure and direct interprocedural flow without execution", () => {
  const graph = graphFor(`
      const outer = 2;
      function add(value) { return value + outer; }
      const input = 40;
      const answer = add(input);
    `);

  const relations = new Set(graph.relations.map(({ relation }) => relation));
  for (const expected of [
    "argument-to-parameter",
    "calls",
    "captures",
    "defines",
    "reads",
    "returns-to-call",
  ] as const)
    expect(relations.has(expected)).toBe(true);
  expect(graph.limitations).toContain(
    "The semantic graph contains static syntax observations and conservative relationship candidates; it does not claim runtime execution.",
  );
  const parameter = graph.nodes.find(
    ({ kind, label }) => kind === "parameter" && label === "value",
  );
  if (parameter === undefined) throw new Error("Expected parameter node");
  const provenance = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "semantic-node", node_id: parameter.node_id },
      direction: "backward-provenance",
      include_ambiguous_dynamic_edges: true,
    }),
  );
  expect(provenance.relations.map(({ relation }) => relation)).toEqual(
    expect.arrayContaining([
      "aliases",
      "argument-to-parameter",
      "defines",
      "reads",
    ]),
  );
});

it.each([
  ["direct assignment", "source.count = 2;"],
  ["destructuring assignment", "[source.count] = [2];"],
  ["for-of head", "for (source.count of [4]) {}"],
  ["for-in head", "for (source.count in { key: true }) {}"],
  ["delete", "delete source.count;"],
])("projects a %s member target as a property write", (_name, statement) => {
  const graph = graphFor(`const source = { count: 1 }; ${statement}`);
  const operations = graph.nodes.filter(
    ({ properties }) => properties.operation_kind !== undefined,
  );
  expect(operations.map(({ label }) => label)).toEqual(["write:/count"]);
  const write = operations[0];
  if (write === undefined) throw new Error("Expected write operation node");
  expect(graph.relations).toContainEqual(
    expect.objectContaining({
      source_node_id: write.node_id,
      relation: "writes-property",
    }),
  );
  expect(graph.relations).not.toContainEqual(
    expect.objectContaining({
      source_node_id: write.node_id,
      relation: "reads-property",
    }),
  );
});

it("continues to project an ordinary member access as a property read", () => {
  const graph = graphFor(`
    const source = { count: 1 };
    const value = source.count;
  `);
  expect(graph.relations).toContainEqual(
    expect.objectContaining({ relation: "reads-property" }),
  );
});

it("keeps a directly returned or passed property in backward provenance", () => {
  const source = `
    const settings = { index: "products" };
    function viaLocal() {
      const value = settings.index;
      return value;
    }
    function viaMember() {
      return settings.index;
    }
    function viaParen() {
      return (settings.index);
    }
    const arrow = () => settings.index;
    function take(value) { return value; }
    function added() { return settings.index + "!"; }
    const a = viaLocal();
    const b = viaMember();
    const direct = settings.index;
    const c = viaParen();
    const d = arrow();
    const e = take(settings.index);
    const g = take((settings.index));
    const kept = settings.index;
    const local = take(kept);
    const concatenated = added();
  `;
  const graph = graphFor(source);
  const provenance = (binding: string, candidates: boolean) => {
    const node = graph.nodes.find(
      (item) => item.kind === "binding" && item.label === binding,
    );
    if (node === undefined) throw new Error(`missing ${binding}`);
    const trace = queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "semantic-node", node_id: node.node_id },
        direction: "backward-provenance",
        include_ambiguous_dynamic_edges: candidates,
      }),
    );
    return trace.nodes.some(
      (item) => item.kind === "literal" && item.properties.value === "products",
    );
  };
  for (const binding of ["a", "b", "direct", "c", "d", "e", "g", "local"]) {
    expect(provenance(binding, false), binding).toBe(true);
    expect(provenance(binding, true), `${binding} candidates`).toBe(true);
  }
  expect(provenance("concatenated", false)).toBe(false);
  expect(provenance("concatenated", true)).toBe(false);
});

it("keeps dynamic calls explicit and returns complete deterministic results", () => {
  const graph = graphFor(`
      const handlers = { ready() { return 1; } };
      const key = process.argv[2];
      handlers[key]();
    `);
  expect(graph.unknowns.some(({ reason }) => reason === "dynamic-call")).toBe(
    true,
  );
  const seedNodeId = graph.relations.find(
    ({ relation }) => relation === "defines",
  )?.source_node_id;
  if (seedNodeId === undefined) throw new Error("Expected a definition seed");

  const first = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "semantic-node", node_id: seedNodeId },
      direction: "forward-influence",
      include_ambiguous_dynamic_edges: true,
    }),
  );
  const repeated = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "semantic-node", node_id: seedNodeId },
      direction: "forward-influence",
      include_ambiguous_dynamic_edges: true,
    }),
  );
  expect(repeated).toEqual(first);
});

it("preserves primitive candidate budget unknowns in semantic graph coverage", () => {
  const source = `const answer = ${primitiveCandidateExpansionExpression()};`;
  const ir = analyzeJavaScriptSemantics(source);
  const graph = graphFor(source, ir);

  expect(ir.coverage).toMatchObject({
    status: "partial",
    resourceLimits: ["primitive-candidates"],
  });
  expect(
    graph.unknowns.filter(({ reason }) => reason === "resource-limit"),
  ).toEqual([
    expect.objectContaining({
      family: "data-flow",
      reason: "resource-limit",
      detail: expect.stringMatching(/primitive candidate budget exceeded/i),
    }),
  ]);
});

it("preserves derived string-byte limit reasons in semantic graph unknowns", () => {
  const source = primitiveByteExpansionSource();
  const ir = analyzeJavaScriptSemantics(source);
  const graph = graphFor(source, ir);

  expect(semanticCoverageResourceLimits(ir.coverage)).toContain(
    "primitive-bytes",
  );
  expect(graph.unknowns).toContainEqual(
    expect.objectContaining({
      reason: "resource-limit",
      detail: expect.stringMatching(/primitive string-byte budget exceeded/i),
    }),
  );
});

it("retains resource-limit reasons at nested object property slots", () => {
  const source = `const answer = { nested: { value: ${primitiveCandidateExpansionExpression()} } };`;
  const ir = analyzeJavaScriptSemantics(source);
  const graph = graphFor(source, ir);

  expect(semanticCoverageResourceLimits(ir.coverage)).toEqual([
    "primitive-candidates",
  ]);
  expect(graph.unknowns).toContainEqual(
    expect.objectContaining({
      family: "data-flow",
      relation_kinds: ["defines"],
      reason: "resource-limit",
      detail: expect.stringMatching(
        /Unknown value at property:\/nested\/value/u,
      ),
    }),
  );
});

it("preserves deep expression resource reasons through graph projection", () => {
  const source = "const answer = true;";
  const parsed = parseJavaScriptSource(source);
  const declaration = parsed?.program.body[0];
  const declarator = t.isVariableDeclaration(declaration)
    ? declaration.declarations[0]
    : undefined;
  if (parsed === null || !t.isVariableDeclarator(declarator))
    throw new Error("Expected parsed binding initializer");
  let expression: t.Expression = t.booleanLiteral(true);
  for (let index = 0; index < 5_000; index += 1)
    expression = t.unaryExpression("!", expression, true);
  declarator.init = expression;
  const ir = analyzeParsedJavaScriptSemantics(parsed);
  const graph = graphFor(source, ir);

  expect(semanticCoverageResourceLimits(ir.coverage)).toEqual([
    "expression-depth",
  ]);
  expect(
    graph.unknowns.filter(({ reason }) => reason === "resource-limit"),
  ).toEqual([
    expect.objectContaining({
      reason: "resource-limit",
      detail: expect.stringMatching(/expression depth budget exceeded/i),
    }),
  ]);
});

it("keeps ambiguous interprocedural flow out of the default traversal", () => {
  const graph = graphFor(`
      function left(value) { return value; }
      function right(value) { return value; }
      const input = 1;
      const selected = Math.random() ? left : right;
      selected(input);
    `);
  const input = graph.nodes.find(
    ({ kind, label }) => kind === "binding" && label === "input",
  );
  if (input === undefined) throw new Error("Expected input binding");
  const query = {
    seed: { kind: "semantic-node" as const, node_id: input.node_id },
    direction: "forward-influence" as const,
    allowed_relations: [
      "reads" as const,
      "aliases" as const,
      "argument-to-parameter" as const,
    ],
  };
  const strict = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse(query),
  );
  expect(
    strict.relations.some(
      ({ relation }) => relation === "argument-to-parameter",
    ),
  ).toBe(false);
  expect(strict.status).toBe("ambiguous");
  const admitted = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      ...query,
      include_ambiguous_dynamic_edges: true,
    }),
  );
  expect(
    admitted.relations.filter(
      ({ relation }) => relation === "argument-to-parameter",
    ),
  ).toHaveLength(2);
  expect(admitted.status).toBe("ambiguous");
});

it("connects caller results, direct returns, parameters, and captures", () => {
  const graph = graphFor(`
      const outer = 2;
      function identity(value) { return value; }
      function readOuter() { return outer; }
      const input = 40;
      const output = identity(input);
    `);
  const binding = (label: string) =>
    graph.nodes.find(
      ({ kind, label: nodeLabel }) =>
        ["binding", "parameter"].includes(kind) && nodeLabel === label,
    );
  const output = binding("output");
  const input = binding("input");
  const outer = binding("outer");
  const readOuter = graph.nodes.find(
    ({ kind, label }) => kind === "function" && label === "readOuter",
  );
  if (
    output === undefined ||
    input === undefined ||
    outer === undefined ||
    readOuter === undefined
  )
    throw new Error("Expected semantic flow nodes");
  const provenance = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "semantic-node", node_id: output.node_id },
      direction: "backward-provenance",
    }),
  );
  expect(provenance.nodes.map(({ node_id }) => node_id)).toContain(
    input.node_id,
  );
  const influence = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "semantic-node", node_id: outer.node_id },
      direction: "forward-influence",
      allowed_relations: ["captures"],
    }),
  );
  expect(influence.nodes.map(({ node_id }) => node_id)).toContain(
    readOuter.node_id,
  );
  const capture = graph.relations.find(
    ({ relation }) => relation === "captures",
  );
  expect(capture?.evidence.location).toMatchObject({
    available: true,
    value: { kind: "source-range", source: "app.js" },
  });
  expect(capture?.evidence.location).not.toEqual(readOuter.evidence.location);
});

it("reports complete graph coverage for deeply nested static values", () => {
  const nesting = 40;
  const nestedValue =
    Array.from({ length: nesting }, () => "{ next: ").join("") +
    '"value"' +
    " }".repeat(nesting);
  const graph = graphFor(`const nested = ${nestedValue};`);
  expect(graph.coverage).toMatchObject({
    truncated: false,
    omitted_nodes: 0,
    omitted_relations: 0,
    limits: [],
  });
});

it("projects bounded Promise ownership and unresolved sources", () => {
  const graph = graphFor(`
      async function run(value) {
        const owned = new Promise((resolve) => resolve(value));
        await Promise.resolve(owned);
        Promise.resolve(value).then(work).finally(cleanup);
        value.then(work);
        return Promise.all([owned, Promise.resolve(value)]);
      }
    `);

  const relations = new Set(graph.relations.map(({ relation }) => relation));
  for (const expected of [
    "aggregates",
    "awaits",
    "chains",
    "creates-promise",
    "detaches-task",
    "owns",
    "returns-task",
  ] as const)
    expect(relations.has(expected)).toBe(true);
  expect(graph.nodes.filter(({ kind }) => kind === "promise")).not.toHaveLength(
    0,
  );
  expect(
    graph.nodes.find(
      ({ kind, properties }) =>
        kind === "promise" &&
        properties.method === "all" &&
        properties.ownership === "returned",
    ),
  ).toBeDefined();
  expect(
    graph.unknowns.some(
      ({ family, reason }) =>
        family === "promise-ownership" && reason === "ambiguous-target",
    ),
  ).toBe(true);
  expect(
    graph.coverage.families.find(
      ({ family }) => family === "promise-ownership",
    ),
  ).toMatchObject({ status: "partial" });
});

it("keeps duplicate function fingerprints ambiguous", () => {
  const graph = graphFor(`
      function first(value) { return value + 1; }
      function second(input) { return input + 1; }
    `);

  expect(graph.fingerprints).toHaveLength(2);
  const digest = graph.fingerprints[0]?.fingerprint_sha256;
  expect(digest).toBeDefined();
  expect(graph.fingerprints[1]?.fingerprint_sha256).toBe(digest);
  if (digest === undefined) throw new Error("Expected fingerprint");
  const query = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "function", fingerprint_sha256: digest },
      direction: "forward-influence",
    }),
  );
  expect(query.status).toBe("ambiguous");
  expect(query.summary.total_seed_matches).toBe(2);
});

it("selects analyzer-produced boundaries by their method field", () => {
  const graph = graphFor("const port = Number(process.env.PORT);");
  const boundary = graph.nodes.find(({ kind }) => kind === "boundary");
  if (boundary === undefined) throw new Error("Expected a boundary node");

  expect(boundary.properties).toMatchObject({
    boundary_kind: "coerce",
    field: "Number",
    method: "Number",
  });
  expect(
    queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "boundary-field", field: "Number" },
        direction: "forward-influence",
      }),
    ),
  ).toMatchObject({
    seed_node_ids: [boundary.node_id],
    summary: { total_seed_matches: 1 },
  });
  expect(
    queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "boundary-field", field: "missing-field" },
        direction: "forward-influence",
      }),
    ).summary.total_seed_matches,
  ).toBe(0);
});

it.each(["Number", "JSON.parse"])(
  "connects a resolved %s boundary to its assigned result and later read",
  (method) => {
    const graph = graphFor(
      `function parse(raw) { const n = ${method}(raw); return n; }`,
    );
    const boundary = graph.nodes.find(
      (node) => node.kind === "boundary" && node.label === method,
    );
    const binding = graph.nodes.find(
      (node) => node.kind === "binding" && node.label === "n",
    );
    const raw = graph.nodes.find(
      (node) => node.kind === "parameter" && node.label === "raw",
    );
    const read = graph.nodes.find((node) =>
      node.identity.role_key.endsWith("read:n"),
    );
    if (!boundary || !binding || !raw || !read)
      throw new Error("Expected boundary, input, result binding, and read");
    expect(graph.relations).toContainEqual(
      expect.objectContaining({
        source_node_id: boundary.node_id,
        target_node_id: binding.node_id,
        relation: "defines",
        resolution: "resolved",
      }),
    );
    const query = (
      nodeId: string,
      direction: "forward-influence" | "backward-provenance",
    ) =>
      queryJavaScriptSemanticGraph(
        graph,
        javaScriptSemanticQueryInputSchema.parse({
          seed: { kind: "semantic-node", node_id: nodeId },
          direction,
        }),
      );
    expect(query(boundary.node_id, "forward-influence").nodes).toEqual(
      expect.arrayContaining([binding, read]),
    );
    expect(query(read.node_id, "backward-provenance").nodes).toEqual(
      expect.arrayContaining([boundary, raw]),
    );
  },
);

it.each([
  "function parse(raw) { const n = Number(raw) + 1; return n; }",
  "function parse(raw) { let n = 1; n += Number(raw); return n; }",
  "function parse(raw) { let n = 1; n ||= Number(raw); return n; }",
])(
  "does not treat a transformed or conditional boundary as its assigned value: %s",
  (source) => {
    const graph = graphFor(source);
    const boundary = graph.nodes.find((node) => node.kind === "boundary");
    const binding = graph.nodes.find(
      (node) => node.kind === "binding" && node.label === "n",
    );
    if (!boundary || !binding) throw new Error("Expected boundary and binding");
    expect(graph.relations).not.toContainEqual(
      expect.objectContaining({
        source_node_id: boundary.node_id,
        target_node_id: binding.node_id,
        relation: "defines",
      }),
    );
  },
);

it("keeps uncertain parser results as candidates and ignores shadowed coercions", () => {
  const graph = graphFor(`
    function run(raw, parser, Number) {
      const parsed = parser.parse(raw);
      const shadowed = Number(raw);
      return parsed;
    }
  `);
  const parser = graph.nodes.find(
    (node) => node.kind === "boundary" && node.label === "parse",
  );
  const parsed = graph.nodes.find(
    (node) => node.kind === "binding" && node.label === "parsed",
  );
  if (!parser || !parsed)
    throw new Error("Expected parser boundary and binding");
  expect(graph.relations).toContainEqual(
    expect.objectContaining({
      source_node_id: parser.node_id,
      target_node_id: parsed.node_id,
      relation: "defines",
      resolution: "candidate",
    }),
  );
  expect(
    graph.nodes.some(
      (node) => node.kind === "boundary" && node.label === "Number",
    ),
  ).toBe(false);
});

const semanticNodeFor = (roleKey: string) => {
  const file: JavaScriptArtifactFile = {
    path: "budget.js",
    container_sha256: SHA256,
    sha256: SHA256,
    bytes: 0,
    inventory_artifact_id: `art_${SHA256}`,
    kind: "javascript",
    unpacked: false,
    text: { included: true, value: "" },
  };
  const state = createSemanticGraphProjectionState();
  return constructSemanticGraphNode(
    file,
    {
      kind: "expression",
      roleKey,
      location: null,
      label: roleKey,
      functionNodeId: null,
    },
    state,
  );
};

it("preserves getter expansion limits in semantic graph coverage", () => {
  const source = getterExpansionSource();
  const graph = graphFor(source, analyzeJavaScriptSemantics(source));
  const module = graph.nodes.find(({ kind }) => kind === "module");
  if (module === undefined) throw new Error("Expected module node");
  expect(
    graph.unknowns.filter(({ reason }) => reason === "resource-limit"),
  ).toEqual([
    expect.objectContaining({
      node_id: module.node_id,
      family: "data-flow",
      reason: "resource-limit",
      detail: expect.stringMatching(
        /getter expansion was conservatively bounded/i,
      ),
    }),
  ]);
  expect(graph.coverage.status).toBe("unknown");
});

it.each([
  "const value = consume(Promise.resolve(1));",
  "async function run() { await consume(Promise.resolve(1)); }",
  "function run() { return consume(Promise.resolve(1)); }",
  "const value = Promise.all([{ promise: Promise.resolve(1) }]);",
])(
  "does not claim direct Promise ownership through an enclosing expression: %s",
  (source) => {
    const graph = graphFor(source);
    const promise = graph.nodes.find(
      ({ kind, properties }) =>
        kind === "promise" && properties.method === "resolve",
    );
    expect(promise?.properties.ownership).toBe("unknown");
    expect(
      graph.relations.filter(
        ({ target_node_id, relation }) =>
          target_node_id === promise?.node_id &&
          ["owns", "awaits", "returns-task", "aggregates"].includes(relation),
      ),
    ).toEqual([]);
  },
);

it.each([
  "const routes = {'': 'HOME'}; const root = routes[''];",
  "const routes = {'': 'HOME'}; const {'': root} = routes;",
])(
  "preserves empty property identities with valid display labels: %s",
  (source) => {
    const graph = graphFor(source);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "property-slot",
          label: '""',
          properties: expect.objectContaining({ name: "" }),
        }),
      ]),
    );
    const root = graph.nodes.find(
      ({ kind, label }) => kind === "binding" && label === "root",
    );
    const literal = graph.nodes.find(
      ({ kind, identity, properties }) =>
        kind === "literal" &&
        properties.value === "HOME" &&
        identity.role_key.includes(":binding:root:"),
    );
    expect(literal).toBeDefined();
    expect(graph.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_node_id: literal?.node_id,
          target_node_id: root?.node_id,
          relation: "defines",
          resolution: "resolved",
        }),
      ]),
    );
  },
);
it("keeps exact empty environment keys distinct from dynamic keys", () => {
  const graph = graphFor(`
      const empty = process.env[''];
      const named = process.env.HOME;
      const dynamic = process.env[name];
    `);
  const sources = graph.nodes
    .filter(({ kind }) => kind === "config-source")
    .map(({ label, properties }) => ({ label, key: properties.key }));
  expect(sources).toEqual(
    expect.arrayContaining([
      { label: '""', key: "" },
      { label: "HOME", key: "HOME" },
      { label: "environment", key: null },
    ]),
  );
  expect(sources).toHaveLength(3);
});

it("labels exact empty method names without inventing computed names", () => {
  const graph = graphFor(`
      const target = {
        ['']() { return 42; },
        ['""']() { return 2; },
        [key]() { return 1; },
      };
    `);
  const functions = graph.nodes
    .filter(({ kind }) => kind === "function")
    .map(({ label, properties }) => ({ label, name: properties.name }));
  // Both exact names display as `""`; only `properties.name` tells them apart.
  expect(functions).toEqual(
    expect.arrayContaining([
      { label: '""', name: "" },
      { label: '""', name: '""' },
    ]),
  );
  expect(
    functions.filter(({ label }) => label?.startsWith("[computed@")),
  ).toHaveLength(1);
});

it.each([
  "Promise.resolve(1)",
  "(Promise.resolve(1) as Promise<number>)",
  "(Promise.resolve(1) satisfies Promise<number>)",
  "Promise.resolve(1)!",
  "((Promise.resolve(1) as Promise<number>)!)",
  "(new Promise(resolve => resolve(1)) as Promise<number>)",
  "(Promise.all([Promise.resolve(1)]) as Promise<number[]>)",
  "(Promise.resolve(1).then(value => value) as Promise<number>)",
])("projects a traversable returned-task link for %s", (expression) => {
  const graph = graphFor(`const run = () => ${expression};`);
  const promise = graph.nodes.find(
    ({ kind, properties }) =>
      kind === "promise" && properties.ownership === "returned",
  );
  const relation = graph.relations.find(
    ({ relation: kind }) => kind === "returns-task",
  );
  expect(promise).toBeDefined();
  expect(relation).toMatchObject({
    target_node_id: promise?.node_id,
    resolution: "resolved",
  });
  const returnNode = graph.nodes.find(
    ({ node_id }) => node_id === relation?.source_node_id,
  );
  expect(returnNode?.kind).toBe("return-site");
  if (returnNode === undefined)
    throw new Error("Expected the linked return site");
  const query = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "semantic-node", node_id: returnNode.node_id },
      direction: "forward-influence",
      allowed_relations: ["returns-task"],
    }),
  );
  expect(query.relations).toContainEqual(relation);
  expect(query.nodes.map(({ node_id }) => node_id)).toContain(promise?.node_id);
});

it("bounds semantic node projection and reports the ceiling in coverage", () => {
  // A bundled vendor library can emit tens of thousands of semantic nodes on its
  // own (measured: 135,286 from one minified editor bundle). Without a ceiling the
  // projection exhausts the heap and the result cannot be serialized. The bound
  // must be reported through coverage rather than dropping data silently.
  const statements = Array.from(
    { length: 4_000 },
    (_, index) =>
      `const value${index} = { a: ${index}, b: [${index}, ${index + 1}] };`,
  ).join("\n");
  const graph = graphFor(statements);

  expect(graph.nodes.length).toBeLessThanOrEqual(SEMANTIC_GRAPH_NODE_CEILING);
  expect(graph.coverage.truncated).toBe(true);
  expect(graph.coverage.status).toBe("partial");
  expect(graph.coverage.omitted_nodes).toBeNull();
  expect(graph.coverage.omitted_relations).toBeNull();
  expect(
    graph.coverage.families.every(
      ({ omitted_relations }) => omitted_relations === null,
    ),
  ).toBe(true);
  expect(
    graph.coverage.limits.some(
      ({ name }) => name === "semantic_graph_node_ceiling",
    ),
  ).toBe(true);
  expect(graph.coverage.limits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "max_semantic_nodes" }),
      expect.objectContaining({ name: "max_semantic_nodes_per_file" }),
    ]),
  );
  expect(graph.limitations.join("\n")).toContain(
    "max_semantic_nodes_per_file is 20000",
  );
  expect(graph.limitations.join("\n")).not.toContain(
    "max_semantic_nodes is 100000",
  );
  expect(graph.limitations.join("\n")).toContain("1 to 1000000");
  expect(graph.coverage.limits).toEqual(
    expect.arrayContaining([
      { name: "semantic_graph_node_ceiling", value: 100_000, unit: "items" },
      {
        name: "semantic_graph_file_node_ceiling",
        value: 20_000,
        unit: "items",
      },
      { name: "max_semantic_nodes", value: 100_000, unit: "items" },
      { name: "max_semantic_nodes_per_file", value: 20_000, unit: "items" },
    ]),
  );
});

const semanticApplication = {
  graph_id: `jag_${"b".repeat(64)}`,
  nodes: [],
};

const semanticFile = (path: string, value: string): JavaScriptArtifactFile => ({
  path,
  container_sha256: SHA256,
  sha256: SHA256,
  bytes: Buffer.byteLength(value),
  inventory_artifact_id: `art_${SHA256}`,
  kind: "javascript",
  unpacked: false,
  text: { included: true, value },
});

const finishSources = (
  limits: {
    readonly totalNodes: number;
    readonly fileNodes: number;
  },
  sources: readonly { readonly path: string; readonly text: string }[],
) => {
  const projection = createJavaScriptSemanticGraphProjection(limits);
  for (const source of sources)
    projection.projectFile(
      semanticFile(source.path, source.text),
      analyzeJavaScriptSemantics(source.text),
    );
  return projection.finish(SHA256, semanticApplication);
};

it("names only the node ceiling that stopped retention", () => {
  const references = (count: number) => "external;\n".repeat(count);
  const perFile = finishSources({ totalNodes: 10, fileNodes: 3 }, [
    { path: "only.js", text: references(5) },
  ]);
  expect(perFile.nodes).toHaveLength(3);
  expect(perFile.limitations.join("\n")).toContain(
    "max_semantic_nodes_per_file is 3",
  );
  expect(perFile.limitations.join("\n")).not.toContain(
    "max_semantic_nodes is 10",
  );
  expect(perFile.coverage.limits).toEqual(
    expect.arrayContaining([
      { name: "semantic_graph_node_ceiling", value: 10, unit: "items" },
      { name: "semantic_graph_file_node_ceiling", value: 3, unit: "items" },
      { name: "max_semantic_nodes", value: 10, unit: "items" },
      { name: "max_semantic_nodes_per_file", value: 3, unit: "items" },
    ]),
  );

  const skipped = finishSources({ totalNodes: 4, fileNodes: 10 }, [
    { path: "first.js", text: references(3) },
    { path: "second.js", text: references(3) },
  ]);
  expect(skipped.nodes).toHaveLength(4);
  expect(
    skipped.nodes.filter((node) => node.identity.module_path === "second.js"),
  ).toHaveLength(0);
  expect(skipped.limitations.join("\n")).toContain("max_semantic_nodes is 4");
  expect(skipped.limitations.join("\n")).not.toContain(
    "max_semantic_nodes_per_file is 10",
  );

  const remaining = finishSources({ totalNodes: 5, fileNodes: 4 }, [
    { path: "first.js", text: references(2) },
    { path: "second.js", text: references(3) },
  ]);
  expect(remaining.nodes).toHaveLength(5);
  expect(remaining.limitations.join("\n")).toContain("max_semantic_nodes is 5");
  expect(remaining.limitations.join("\n")).not.toContain(
    "max_semantic_nodes_per_file is 4",
  );

  const both = finishSources({ totalNodes: 5, fileNodes: 3 }, [
    { path: "first.js", text: references(5) },
    { path: "second.js", text: references(3) },
  ]);
  expect(both.nodes).toHaveLength(5);
  expect(both.limitations.join("\n")).toContain("max_semantic_nodes is 5");
  expect(both.limitations.join("\n")).toContain(
    "max_semantic_nodes_per_file is 3",
  );
  expect(both.limitations.join("\n")).toContain(
    "Set max_semantic_nodes and max_semantic_nodes_per_file",
  );
});

it("attributes an adopted file to the ceiling that bounded its offer", () => {
  const text = "external;\n".repeat(5);
  const projection = createJavaScriptSemanticGraphProjection({
    totalNodes: 10,
    fileNodes: 3,
  });
  const steps = projectJavaScriptSemanticFileSteps(
    semanticFile("adopted.js", text),
    analyzeJavaScriptSemantics(text),
    projection.remainingFileCapacity(),
  );
  let step = steps.next();
  while (!step.done) step = steps.next();
  projection.adoptFileProjection(step.value);
  const limitation = projection
    .finish(SHA256, semanticApplication)
    .limitations.join("\n");
  expect(limitation).toContain("max_semantic_nodes_per_file is 3");
  expect(limitation).not.toContain("max_semantic_nodes is 10");
});

it("leaves a small application complete and untruncated", () => {
  const graph = graphFor("const answer = 40 + 2;");
  expect(graph.coverage.truncated).toBe(false);
  expect(graph.coverage.omitted_nodes).toBe(0);
  expect(graph.coverage.omitted_relations).toBe(0);
  expect(graph.coverage.limits).toEqual([]);
});

it("does not mark a file truncated when it exactly fills its budget", () => {
  // Each unbound reference projects one expression, plus the module root.
  const graph = graphFor(
    "external;\n".repeat(SEMANTIC_GRAPH_FILE_NODE_CEILING - 1),
  );
  expect(graph.nodes).toHaveLength(SEMANTIC_GRAPH_FILE_NODE_CEILING);
  expect(graph.coverage).toMatchObject({
    truncated: false,
    omitted_nodes: 0,
    omitted_relations: 0,
    limits: [],
  });
});

it("only records node loss when the budget rejects a new identity", () => {
  // The truncation signal must record blocked node creation, not a zero
  // remaining budget: a file using exactly its share drops nothing.
  const state = createSemanticGraphProjectionState();
  state.fileNodeBudget = 2;
  state.fileNodesDropped = false;
  const first = addSemanticGraphNode(state, semanticNodeFor("first"));
  const second = addSemanticGraphNode(state, semanticNodeFor("second"));
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(state.fileNodeBudget).toBe(0);
  expect(state.fileNodesDropped).toBe(false);

  expect(addSemanticGraphNode(state, semanticNodeFor("first"))).toBe(first);
  expect(state.fileNodesDropped).toBe(false);

  const blocked = addSemanticGraphNode(state, semanticNodeFor("third"));
  expect(blocked).toBeNull();
  expect(state.fileNodesDropped).toBe(true);
});

it("keeps full static property identities distinct through backward provenance", () => {
  const graph = graphFor(`
    const root = { a: { id: 'left' }, b: { id: 'right' }, 'a.id': 'dotted', '': { 'a/b~c': 'escaped' } };
    const left = root.a.id;
    const right = root['b']['id'];
    const missing = root.id;
    const dotted = root['a.id'];
    const escaped = root['']['a/b~c'];
  `);
  const slots = graph.nodes.filter(({ kind }) => kind === "property-slot");
  for (const [pointer, literal] of [
    ["/a/id", "left"],
    ["/b/id", "right"],
    ["/a.id", "dotted"],
    ["//a~1b~0c", "escaped"],
    ["/id", null],
  ]) {
    const slot = slots.find(
      ({ properties }) => properties.property_pointer === pointer,
    );
    if (slot === undefined) throw new Error(`Missing slot ${pointer}`);
    expect(slot.properties.presence).toBe(
      literal === null ? "absent" : "present",
    );
    const trace = queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "semantic-node", node_id: slot.node_id },
        direction: "backward-provenance",
        allowed_relations: ["defines"],
      }),
    );
    expect(
      trace.nodes
        .filter(({ kind }) => kind === "literal")
        .map(({ properties }) => properties.value),
    ).toEqual(literal === null ? [] : [literal]);
    const reads = graph.relations.filter(
      ({ source_node_id, relation }) =>
        source_node_id === slot.node_id && relation === "reads-property",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.resolution).toBe(
      literal === null ? "candidate" : "resolved",
    );
  }
});

it("targets nested writes and destructuring without inventing leaf-level root slots", () => {
  const graph = graphFor(`
    const root = { left: { id: 'before' }, right: { id: 'untouched' } };
    root.left.id = produce();
    const { right: { id: selected } } = root;
    const [first, missing] = [1, , 3];
  `);
  const rootSlots = graph.nodes.filter(
    ({ kind, properties }) =>
      kind === "property-slot" && properties.name === "id",
  );
  expect(
    rootSlots.map(({ properties }) => properties.property_pointer).sort(),
  ).toEqual(["/left/id", "/right/id"]);
  const left = rootSlots.find(
    ({ properties }) => properties.property_pointer === "/left/id",
  );
  const right = rootSlots.find(
    ({ properties }) => properties.property_pointer === "/right/id",
  );
  expect(left?.properties.presence).toBe("unknown-coverage");
  const write = graph.nodes.find(
    ({ kind, properties }) =>
      kind === "expression" && properties.operation_kind === "write",
  );
  expect(graph.relations).toContainEqual(
    expect.objectContaining({
      source_node_id: write?.node_id,
      target_node_id: left?.node_id,
      relation: "writes-property",
      resolution: "resolved",
    }),
  );
  const selected = graph.nodes.find(
    ({ kind, label }) => kind === "binding" && label === "selected",
  );
  expect(graph.relations).toContainEqual(
    expect.objectContaining({
      source_node_id: right?.node_id,
      target_node_id: selected?.node_id,
      relation: "destructures",
      resolution: "resolved",
    }),
  );
});

it("keeps dynamic intermediate receivers unresolved instead of selecting a static leaf", () => {
  const graph = graphFor(`
    const root = { id: 'root', a: { id: 'nested' } };
    const selected = root[key].id;
  `);
  expect(
    graph.relations.filter(({ relation }) => relation === "reads-property"),
  ).toEqual([]);
  expect(graph.unknowns).toContainEqual(
    expect.objectContaining({
      family: "object-flow",
      relation_kinds: ["reads-property"],
    }),
  );
  const selected = graph.nodes.find(
    ({ kind, label }) => kind === "binding" && label === "selected",
  );
  if (selected === undefined) throw new Error("Missing selected binding");
  const trace = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "semantic-node", node_id: selected.node_id },
      direction: "backward-provenance",
      allowed_relations: ["defines"],
    }),
  );
  expect(trace.nodes.filter(({ kind }) => kind === "literal")).toEqual([]);
});

it.each([
  {
    initializer: "{}",
    path: "missing.id",
    pointer: "/missing/id",
    resolved: false,
  },
  {
    initializer: "{ a: null }",
    path: "a.id",
    pointer: "/a/id",
    resolved: false,
  },
  { initializer: "{ a: 1 }", path: "a.id", pointer: "/a/id", resolved: false },
  { initializer: "{ a: {} }", path: "a.id", pointer: "/a/id", resolved: true },
  { initializer: "{ a: [] }", path: "a[0]", pointer: "/a/0", resolved: true },
])(
  "admits a write only through a retained container receiver: $initializer.$path",
  ({ initializer, path, pointer, resolved }) => {
    const graph = graphFor(
      `const root = ${initializer}; root.${path} = produce();`,
    );
    const write = graph.nodes.find(
      ({ kind, properties }) =>
        kind === "expression" && properties.operation_kind === "write",
    );
    const slot = graph.nodes.find(
      ({ kind, properties }) =>
        kind === "property-slot" && properties.property_pointer === pointer,
    );
    if (write === undefined || slot === undefined)
      throw new Error("Expected write and target slot");
    expect(graph.relations).toContainEqual(
      expect.objectContaining({
        source_node_id: write.node_id,
        target_node_id: slot.node_id,
        relation: "writes-property",
        resolution: resolved ? "resolved" : "candidate",
      }),
    );
    const trace = queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "semantic-node", node_id: write.node_id },
        direction: "forward-influence",
        allowed_relations: ["writes-property"],
      }),
    );
    expect(trace.nodes.some(({ node_id }) => node_id === slot.node_id)).toBe(
      resolved,
    );
    if (!resolved)
      expect(graph.unknowns).toContainEqual(
        expect.objectContaining({
          node_id: slot.node_id,
          relation_kinds: ["writes-property"],
          detail: expect.stringContaining(
            "receiver is unresolved or not a retained container",
          ),
        }),
      );
  },
);

it.each(["", "root.length = 0;", "root.length = query(); root[0] = 9;"])(
  "retains array length presence without inventing an exact length after %s",
  (mutation) => {
    const graph = graphFor(
      `const root = [, 1]; ${mutation} const length = root.length;`,
    );
    const slot = graph.nodes.find(
      ({ kind, properties }) =>
        kind === "property-slot" && properties.property_pointer === "/length",
    );
    expect(slot?.properties).toMatchObject({
      name: "length",
      presence: "present",
      value_status: "unknown",
    });
    const trace = queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "property", name: "length" },
        direction: "forward-influence",
        allowed_relations: ["reads-property"],
      }),
    );
    expect(trace.seed_node_ids).toEqual([slot?.node_id]);
    expect(trace.relations).toContainEqual(
      expect.objectContaining({
        source_node_id: slot?.node_id,
        relation: "reads-property",
        resolution: "resolved",
      }),
    );
    expect(
      graph.relations.some(
        ({ target_node_id, relation }) =>
          target_node_id === slot?.node_id && relation === "defines",
      ),
    ).toBe(false);
  },
);

it.each([
  ["object spread", 'const root = { known: "value", ...dynamic };'],
  ["array spread", 'const root = ["value", ...dynamic];'],
])(
  "keeps omitted initializer coverage on the owning binding: %s",
  (_label, source) => {
    const graph = graphFor(source);
    const root = graph.nodes.find(
      ({ kind, label }) => kind === "binding" && label === "root",
    );
    if (root === undefined) throw new Error("Expected root binding");
    const result = queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "semantic-node", node_id: root.node_id },
        direction: "forward-influence",
      }),
    );

    expect(result.coverage.status).toBe("partial");
    expect(result.unknowns).toContainEqual(
      expect.objectContaining({
        node_id: root.node_id,
        family: "object-flow",
        reason: "ambiguous-target",
        detail: expect.stringContaining("Initializer container has unknown"),
      }),
    );
  },
);

it.each([
  ["bare if", 'if (flag) alias = { mode: "other" }; alias.mode = "updated";'],
  [
    "logical expression",
    'flag && (alias = { mode: "other" }); alias.mode = "updated";',
  ],
  [
    "logical assignment",
    'flag ||= (alias = { mode: "other" }); alias.mode = "updated";',
  ],
  ["or assignment", 'alias ||= { mode: "other" }; alias.mode = "updated";'],
  [
    "nullish assignment",
    'alias ??= { mode: "other" }; alias.mode = "updated";',
  ],
  [
    "conditional mutation",
    'alias = { mode: "other" }; if (flag) alias.mode = "updated";',
  ],
  [
    "short-circuit mutation",
    'alias = { mode: "other" }; flag && (alias.mode = "updated");',
  ],
])(
  "preserves possible alias mutation uncertainty in queries: %s",
  (_label, body) => {
    const graph = graphFor(`
    const shared = { mode: "initial" };
    let alias = shared;
    ${body}
  `);
    const sharedMode = graph.nodes.find(
      ({ kind, identity, properties }) =>
        kind === "property-slot" &&
        properties.property_pointer === "/mode" &&
        identity.role_key.includes("binding:shared"),
    );
    if (sharedMode === undefined) throw new Error("Expected shared mode slot");
    const result = queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "semantic-node", node_id: sharedMode.node_id },
        direction: "backward-provenance",
      }),
    );

    expect(sharedMode.properties.presence).toBe("unknown-coverage");
    expect(result.nodes).toContainEqual(
      expect.objectContaining({ node_id: sharedMode.node_id }),
    );
    expect(result.coverage.status).toBe("partial");
  },
);

it.each(["{}", "unknownRoot", "{ a: null }"])(
  "preserves the requested deep leaf name after a blocked prefix: %s",
  (initializer) => {
    const graph = graphFor(
      `const root = ${initializer}; const selected = root.a.b.c;`,
    );
    const slot = graph.nodes.find(
      ({ kind, properties }) =>
        kind === "property-slot" && properties.property_pointer === "/a/b/c",
    );
    expect(slot).toMatchObject({
      label: "c",
      properties: {
        name: "c",
        property_path: ["a", "b", "c"],
        presence: "unknown-coverage",
        value_status: "unknown",
      },
    });
    const trace = queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "property", name: "c" },
        direction: "backward-provenance",
        allowed_relations: ["defines"],
      }),
    );
    expect(trace.seed_node_ids).toEqual([slot?.node_id]);
    expect(trace.nodes.filter(({ kind }) => kind === "literal")).toEqual([]);
  },
);

it("projects and adopts more than the default per-file capacity when explicitly offered", () => {
  const text = "external;\n".repeat(20_001);
  const file: JavaScriptArtifactFile = {
    path: "large.js",
    container_sha256: SHA256,
    sha256: SHA256,
    bytes: Buffer.byteLength(text),
    inventory_artifact_id: `art_${SHA256}`,
    kind: "javascript",
    unpacked: false,
    text: { included: true, value: text },
  };
  const steps = projectJavaScriptSemanticFileSteps(
    file,
    analyzeJavaScriptSemantics(text),
    { nodes: 20_002, unknowns: 20_002 },
  );
  let result = steps.next();
  while (!result.done) result = steps.next();
  expect(result.value.nodes).toHaveLength(20_002);
  expect(result.value.nodesTruncated).toBe(false);
  const projection = createJavaScriptSemanticGraphProjection({
    totalNodes: 20_010,
    fileNodes: 20_002,
  });
  projection.adoptFileProjection(result.value);
  expect(projection.remainingFileCapacity().nodes).toBe(8);
  const graph = projection.finish(SHA256, {
    graph_id: `jag_${"b".repeat(64)}`,
    nodes: [],
  });
  expect(graph.coverage).toMatchObject({
    truncated: false,
    omitted_nodes: 0,
    omitted_relations: 0,
  });
  const bounded = createJavaScriptSemanticGraphProjection({
    totalNodes: 20_001,
    fileNodes: 20_002,
  });
  expect(() => bounded.adoptFileProjection(result.value)).toThrow(
    "exceed the offered tree capacity",
  );
});
