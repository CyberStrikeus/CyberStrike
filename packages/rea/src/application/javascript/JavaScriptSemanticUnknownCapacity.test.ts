import { javaScriptSemanticQueryInputSchema } from "../../domain/javascript/javascriptSemanticQuerySchemas.js";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { analyzeJavaScriptSemantics } from "../../domain/javascript/javascriptSemanticAnalysis.js";
import {
  javaScriptSemanticGraphSchema,
  createJavaScriptSemanticGraph,
} from "../../domain/javascript/javascriptSemanticGraph.js";
import { queryJavaScriptSemanticGraph } from "../../domain/javascript/javascriptSemanticQuery.js";
import {
  createJavaScriptSemanticGraphProjection,
  projectJavaScriptSemanticFileSteps,
} from "./JavaScriptSemanticGraphBuilder.js";
import {
  createSemanticGraphProjectionState,
  addSemanticGraphUnknown,
} from "./JavaScriptSemanticGraphConstruction.js";
import { unknownSemanticEvidence } from "./JavaScriptSemanticGraphEvidence.js";

const digest = "a".repeat(64);
const application = { graph_id: `jag_${"b".repeat(64)}`, nodes: [] };
const text = "globalThis.u.p(globalThis.v[k]);\n".repeat(4);
const source = (path = "app.js", value = text): JavaScriptArtifactFile => ({
  path,
  sha256: createHash("sha256").update(value).digest("hex"),
  container_sha256: digest,
  bytes: Buffer.byteLength(value),
  inventory_artifact_id: `art_${digest}`,
  kind: "javascript",
  unpacked: false,
  text: { included: true, value },
});
const fileProjection = (file = source(), nodes = 200, unknowns = 200) => {
  if (!file.text.included) throw new Error("Expected inert source");
  const steps = projectJavaScriptSemanticFileSteps(
    file,
    analyzeJavaScriptSemantics(file.text.value),
    { nodes, unknowns },
  );
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};

it("bounds unknowns independently of retained nodes and accounts for examined omissions", () => {
  const complete = fileProjection();
  const bounded = fileProjection(source(), 200, 2);
  expect(complete.unknowns.length).toBeGreaterThan(2);
  expect(bounded.nodes).toEqual(complete.nodes);
  expect(bounded.relations).toEqual(complete.relations);
  expect(bounded.unknowns).toHaveLength(2);
  expect(
    bounded.omittedUnknownOccurrences!.reduce(
      (sum, row) => sum + row.occurrences,
      0,
    ),
  ).toBe(complete.unknowns.length - 2);
  const projection = createJavaScriptSemanticGraphProjection({
    totalUnknowns: 2,
    fileUnknowns: 2,
  });
  projection.adoptFileProjection(bounded);
  const graph = projection.finish(digest, application);
  expect(graph.coverage).toMatchObject({
    truncated: true,
    status: "partial",
    omitted_nodes: 0,
  });
  expect(graph.coverage.limits).toEqual(
    expect.arrayContaining([
      { name: "semantic_graph_unknown_ceiling", value: 2, unit: "items" },
      { name: "semantic_graph_file_unknown_ceiling", value: 2, unit: "items" },
      { name: "max_semantic_unknowns", value: 2, unit: "items" },
      { name: "max_semantic_unknowns_per_file", value: 2, unit: "items" },
    ]),
  );
  expect(graph.limitations.join("\n")).toContain("max_semantic_unknowns is 2");
  expect(graph.limitations.join("\n")).toContain(
    "max_semantic_unknowns_per_file is 2",
  );
  expect(graph.limitations.join("\n")).toContain(
    "Omission coverage counts examined emission occurrences",
  );
  expect(javaScriptSemanticGraphSchema.parse(graph)).toEqual(graph);
  expect(
    queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "property", name: "missing" },
        direction: "backward-provenance",
      }),
    ),
  ).toMatchObject({ status: "partial", coverage: { status: "partial" } });
});

it("keeps unknowns bounded even after their semantic nodes are dropped", () => {
  const projection = fileProjection(source(), 1, 2);
  expect(projection.nodesTruncated).toBe(true);
  expect(projection.nodes).toHaveLength(1);
  expect(projection.unknowns).toHaveLength(2);
  expect(projection.omittedUnknownOccurrences!.length).toBeGreaterThan(0);
});

it("enforces per-file and total unknown capacities across transferred files", () => {
  const projection = createJavaScriptSemanticGraphProjection({
    totalUnknowns: 3,
    fileUnknowns: 2,
  });
  for (const path of ["a.js", "b.js", "c.js"]) {
    const capacity = projection.remainingFileCapacity();
    const file = source(path);
    const steps = projectJavaScriptSemanticFileSteps(
      file,
      analyzeJavaScriptSemantics(text),
      capacity,
    );
    let step = steps.next();
    while (!step.done) step = steps.next();
    projection.adoptFileProjection(step.value);
  }
  expect(projection.remainingFileCapacity().unknowns).toBe(0);
  const graph = projection.finish(digest, application);
  expect(graph.unknowns).toHaveLength(3);
  expect(
    graph.unknowns.filter(
      (row) =>
        row.evidence.location.available &&
        row.evidence.location.value.kind === "source-range" &&
        row.evidence.location.value.source === "a.js",
    ),
  ).toHaveLength(2);
  expect(
    graph.coverage.omitted_unknown_occurrences!.reduce(
      (sum, row) => sum + row.occurrences,
      0,
    ),
  ).toBe(fileProjection().unknowns.length * 3 - 3);
  expect(graph.limitations.join("\n")).toContain("max_semantic_unknowns is 3");
  expect(graph.limitations.join("\n")).toContain(
    "max_semantic_unknowns_per_file is 2",
  );
  expect(graph.coverage.limits).toEqual(
    expect.arrayContaining([
      { name: "semantic_graph_unknown_ceiling", value: 3, unit: "items" },
      { name: "semantic_graph_file_unknown_ceiling", value: 2, unit: "items" },
      { name: "max_semantic_unknowns", value: 3, unit: "items" },
      { name: "max_semantic_unknowns_per_file", value: 2, unit: "items" },
    ]),
  );
});

it("names only the unknown ceiling that stopped retention", () => {
  const perFile = createJavaScriptSemanticGraphProjection({
    totalUnknowns: 50,
    fileUnknowns: 2,
  });
  perFile.projectFile(source(), analyzeJavaScriptSemantics(text));
  const perFileGraph = perFile.finish(digest, application);
  expect(perFileGraph.limitations.join("\n")).toContain(
    "max_semantic_unknowns_per_file is 2",
  );
  expect(perFileGraph.limitations.join("\n")).not.toContain(
    "max_semantic_unknowns is 50",
  );
  expect(perFileGraph.coverage.limits).toEqual(
    expect.arrayContaining([
      { name: "semantic_graph_unknown_ceiling", value: 50, unit: "items" },
      { name: "semantic_graph_file_unknown_ceiling", value: 2, unit: "items" },
      { name: "max_semantic_unknowns", value: 50, unit: "items" },
      { name: "max_semantic_unknowns_per_file", value: 2, unit: "items" },
    ]),
  );

  const total = createJavaScriptSemanticGraphProjection({
    totalUnknowns: 2,
    fileUnknowns: 50,
  });
  total.projectFile(source(), analyzeJavaScriptSemantics(text));
  const totalLimitation = total
    .finish(digest, application)
    .limitations.join("\n");
  expect(totalLimitation).toContain("max_semantic_unknowns is 2");
  expect(totalLimitation).not.toContain("max_semantic_unknowns_per_file is 50");

  const unavailable = createJavaScriptSemanticGraphProjection({
    totalUnknowns: 20,
    fileUnknowns: 2,
  });
  unavailable.recordUnavailableFile(
    source(),
    "Source unavailable",
    null,
    "incomplete-module",
  );
  const unavailableLimitation = unavailable
    .finish(digest, application)
    .limitations.join("\n");
  expect(unavailableLimitation).toContain(
    "max_semantic_unknowns_per_file is 2",
  );
  expect(unavailableLimitation).not.toContain("max_semantic_unknowns is 20");
});

it("rejects excess transferred unknowns before adopting any file facts", () => {
  const projection = createJavaScriptSemanticGraphProjection({
    totalUnknowns: 1,
    fileUnknowns: 1,
  });
  const before = projection.remainingFileCapacity();
  expect(() => projection.adoptFileProjection(fileProjection())).toThrow(
    "Transferred semantic unknowns exceed",
  );
  expect(projection.remainingFileCapacity()).toEqual(before);
});

it("bounds unavailable-file frontiers through the same owner", () => {
  const projection = createJavaScriptSemanticGraphProjection({
    totalUnknowns: 2,
    fileUnknowns: 2,
  });
  projection.recordUnavailableFile(
    source(),
    "Source unavailable",
    null,
    "incomplete-module",
  );
  const graph = projection.finish(digest, application);
  expect(graph.unknowns).toHaveLength(2);
  expect(
    graph.coverage.omitted_unknown_occurrences!.reduce(
      (sum, row) => sum + row.occurrences,
      0,
    ),
  ).toBe(10);
});

it("does not intern omitted provenance and counts repeated omitted emissions as occurrences", () => {
  const state = createSemanticGraphProjectionState();
  state.unknownCapacity = 1;
  const file = source();
  for (const detail of ["retained", "omitted", "omitted"])
    addSemanticGraphUnknown(state, {
      node_id: null,
      family: "data-flow",
      relation_kinds: ["defines"],
      reason: "unknown-value",
      detail,
      candidate_node_ids: [],
      evidence: {
        ...unknownSemanticEvidence(file, null),
        limitations: [detail],
      },
    });
  expect(state.unknowns.size).toBe(1);
  expect(state.evidenceContexts.contexts).toHaveLength(1);
  expect([...state.unknownOmissions.values()]).toEqual([
    { family: "data-flow", reason: "unknown-value", occurrences: 2 },
  ]);
});

it("preserves omission-free graph identity and refuses contradictory omission coverage", () => {
  const projection = createJavaScriptSemanticGraphProjection();
  projection.adoptFileProjection(fileProjection());
  const graph = projection.finish(digest, application);
  expect(Object.hasOwn(graph.coverage, "omitted_unknown_occurrences")).toBe(
    false,
  );
  const { graph_id: _id, ...input } = graph;
  expect(createJavaScriptSemanticGraph(input).graph_id).toBe(graph.graph_id);
  const omission = {
    family: "data-flow",
    reason: "unknown-value",
    occurrences: 1,
  };
  expect(() =>
    createJavaScriptSemanticGraph({
      ...input,
      coverage: { ...graph.coverage, omitted_unknown_occurrences: [omission] },
    }),
  ).toThrow("Omitted unknown occurrences require");
  expect(() =>
    createJavaScriptSemanticGraph({
      ...input,
      coverage: {
        ...graph.coverage,
        status: "partial",
        truncated: true,
        limits: [{ name: "authored", value: 1, unit: "items" }],
        omitted_unknown_occurrences: [omission, omission],
      },
    }),
  ).toThrow("Unknown omission coverage");
});

it("applies the same unknown admission in direct and transferred construction", () => {
  const direct = createJavaScriptSemanticGraphProjection({
    totalUnknowns: 3,
    fileUnknowns: 2,
  });
  const transferred = createJavaScriptSemanticGraphProjection({
    totalUnknowns: 3,
    fileUnknowns: 2,
  });
  for (const name of ["a.js", "b.js"]) {
    const file = source(name);
    direct.projectFile(file, analyzeJavaScriptSemantics(text));
    const steps = projectJavaScriptSemanticFileSteps(
      file,
      analyzeJavaScriptSemantics(text),
      transferred.remainingFileCapacity(),
    );
    let step = steps.next();
    while (!step.done) step = steps.next();
    transferred.adoptFileProjection(step.value);
  }
  expect(direct.finish(digest, application)).toEqual(
    transferred.finish(digest, application),
  );
});

it("bounds reads within unmodeled nested operator operands", () => {
  const body = `const base = "token"; const value = ${"wrap(".repeat(30)}base${")".repeat(30)} + "/x";`;
  const bounded = fileProjection(source("app.js", body), 200, 1);
  expect(bounded.unknowns.length).toBeLessThanOrEqual(1);
  expect(bounded.omittedUnknownOccurrences?.length).toBeGreaterThan(0);
  const projection = createJavaScriptSemanticGraphProjection({
    totalUnknowns: 1,
    fileUnknowns: 1,
  });
  projection.adoptFileProjection(bounded);
  const graph = projection.finish(digest, application);
  expect(graph.coverage.truncated).toBe(true);
  const trace = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: "token" },
      direction: "forward-influence",
    }),
  );
  expect(trace.status).not.toBe("found");
});
