import { javaScriptSemanticQueryInputSchema } from "../../domain/javascript/javascriptSemanticQuerySchemas.js";
import { expect, it } from "vitest";
import { graphForJavaScript } from "../../../tests/fixtures/javascriptSemanticGraph.js";
import { queryJavaScriptSemanticGraph } from "../../domain/javascript/javascriptSemanticQuery.js";

it("retains nested initializer literals as uncertain candidates after a dynamic-scope write", () => {
  const graph = graphForJavaScript(`
    const config = { nested: { flag: "before", items: ["inside"] }, stable: "unchanged" };
    with (env) { config.nested = replacement; }
  `);
  for (const [value, pointer] of [
    ["before", "/nested/flag"],
    ["inside", "/nested/items/0"],
  ]) {
    const trace = queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "literal", value },
        direction: "forward-influence",
        include_ambiguous_dynamic_edges: true,
      }),
    );
    const slot = trace.nodes.find(
      (node) =>
        node.kind === "property-slot" &&
        node.properties.property_pointer === pointer,
    );
    expect(slot?.properties.presence).toBe("unknown-coverage");
    expect(trace.relations).toContainEqual(
      expect.objectContaining({
        target_node_id: slot?.node_id,
        relation: "defines",
        resolution: "candidate",
      }),
    );
    expect(
      trace.unknowns.some((unknown) => unknown.reason === "unknown-value"),
    ).toBe(true);
  }
});

it.each([
  ["binding", "speed = accel; return speed;", "speed"],
  ["property", "state.speed = accel; return state.speed;", "read:/speed"],
  ["compound", "state.speed += accel; return state.speed;", "read:/speed"],
  ["logical", "state.speed ||= accel; return state.speed;", "read:/speed"],
  ["nested", "speed = (state.speed = accel); return speed;", "speed"],
  ["property input", "speed = input.accel; return speed;", "speed"],
])("traces assignment influence through %s", (_name, body, reached) => {
  const graph = graphForJavaScript(`
    const accel = 0.001;
    const input = { accel: 0.001 };
    let speed = 6;
    const state = { speed: 6 };
    export function update() { ${body} }
  `);
  const trace = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: 0.001 },
      direction: "forward-influence",
      include_ambiguous_dynamic_edges: true,
    }),
  );
  expect(trace.nodes.map((node) => node.label)).toContain(reached);
  expect(trace.nodes.map((node) => node.label)).toContain("return");
  expect(
    trace.relations.some(
      (edge) => edge.properties.assignment_operator !== undefined,
    ),
  ).toBe(true);
});

it("does not attribute deferred callback reads to an enclosing assignment", () => {
  const graph = graphForJavaScript(`
    const accel = 0.001;
    let callback;
    callback = () => accel;
  `);
  const trace = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: 0.001 },
      direction: "forward-influence",
      include_ambiguous_dynamic_edges: true,
    }),
  );
  expect(
    graph.relations.filter(
      (edge) => edge.properties.assignment_operator !== undefined,
    ),
  ).toEqual([]);
  expect(
    trace.nodes
      .filter((node) => node.kind === "binding")
      .map((node) => node.label),
  ).not.toContain("callback");
});

it("retains both compound operands without assigning the RHS value to the destination", () => {
  const graph = graphForJavaScript(`
    const accel = 0.001;
    let speed = 6;
    speed += accel;
  `);
  const edges = graph.relations.filter(
    (edge) => edge.properties.assignment_operator === "+=",
  );
  expect(edges).toHaveLength(2);
  expect(
    edges
      .map(
        (edge) =>
          graph.nodes.find((node) => node.node_id === edge.source_node_id)
            ?.label,
      )
      .sort(),
  ).toEqual(["accel", "speed"]);
  const speed = graph.nodes.find(
    (node) => node.kind === "binding" && node.label === "speed",
  );
  expect(
    graph.unknowns.some(
      (item) =>
        item.node_id === speed?.node_id && item.reason === "unknown-value",
    ),
  ).toBe(true);
});

it("reaches a property write by default and keeps uncertain later reads opt-in", () => {
  const graph = graphForJavaScript(
    "const accel = 0.001; const state = {speed: 6}; function update() { state.speed += accel; return state.speed; }",
  );
  const trace = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: 0.001 },
      direction: "forward-influence",
    }),
  );
  expect(
    trace.nodes.some(
      (node) => node.kind === "property-slot" && node.label === "speed",
    ),
  ).toBe(true);
  expect(trace.nodes.map((node) => node.label)).not.toContain("read:/speed");
  expect(trace.unknowns.length).toBeGreaterThan(0);
});

it.each([
  [
    "object",
    "const obj = { [speed = accel]() {} }; export function current() { return speed; }",
  ],
  [
    "class",
    "class Widget { [speed = accel]() {} } export function current() { return speed; }",
  ],
  [
    "enclosing function",
    "export function update() { const obj = { [speed = accel]() {} }; return speed; }",
  ],
])(
  "retains assignments in a computed method key in its %s owner",
  (_kind, body) => {
    const graph = graphForJavaScript(
      `const accel = 0.001; let speed = 6; ${body}`,
    );
    const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
    const assignment = graph.relations.find(
      (edge) =>
        edge.properties.assignment_operator === "=" &&
        nodes.get(edge.source_node_id)?.label === "accel" &&
        nodes.get(edge.target_node_id)?.label === "speed",
    );
    expect(assignment).toBeDefined();
    const trace = queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "literal", value: 0.001 },
        direction: "forward-influence",
        include_ambiguous_dynamic_edges: true,
      }),
    );
    expect(trace.nodes.map((node) => node.label)).toContain("return");
  },
);

it("keeps assignments in computed methods' parameter defaults in the method", () => {
  const graph = graphForJavaScript(`
    const accel = 0.001; let speed = 6;
    const obj = { ["tick"](value = (speed = accel)) { return speed; } };
  `);
  const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const assignment = graph.relations.find(
    (edge) => edge.properties.assignment_operator === "=",
  );
  expect(assignment).toBeDefined();
  const source = nodes.get(assignment!.source_node_id);
  const target = nodes.get(assignment!.target_node_id);
  expect(source?.function_node_id).toBeTypeOf("string");
  expect(source?.function_node_id).toBe(target?.function_node_id);
});

it("does not treat a callback body nested in a computed key as a key-time assignment input", () => {
  const graph = graphForJavaScript(`
    const accel = 0.001; let callback;
    const obj = { [(callback = () => accel)]() {} };
  `);
  expect(
    graph.relations.filter(
      (edge) => edge.properties.assignment_operator !== undefined,
    ),
  ).toEqual([]);
});

it("retains an assignment owned by a callback inside a computed key", () => {
  const graph = graphForJavaScript(`
    const accel = 0.001; let speed = 6;
    const obj = { [(() => { speed = accel; return "tick"; })()]() {} };
  `);
  const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const assignment = graph.relations.find(
    (edge) => edge.properties.assignment_operator === "=",
  );
  expect(assignment).toBeDefined();
  const source = nodes.get(assignment!.source_node_id);
  const target = nodes.get(assignment!.target_node_id);
  expect(source?.label).toBe("accel");
  expect(target?.label).toBe("speed");
  expect(source?.function_node_id).toBeTypeOf("string");
  expect(source?.function_node_id).toBe(target?.function_node_id);
});
