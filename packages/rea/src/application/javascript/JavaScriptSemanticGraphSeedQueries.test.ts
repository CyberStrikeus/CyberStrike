import { javaScriptSemanticQueryInputSchema } from "../../domain/javascript/javascriptSemanticQuerySchemas.js";
import { expect, it } from "vitest";

import { graphForJavaScript } from "../../../tests/fixtures/javascriptSemanticGraph.js";
import { queryJavaScriptSemanticGraph } from "../../domain/javascript/javascriptSemanticQuery.js";

it.each([
  "function read() { return this.speed; }",
  "class Game { read() { return this.config.speed; } }",
])(
  "matches retained slotless property accesses and their unknowns: %s",
  (source) => {
    const graph = graphForJavaScript(source);
    const accesses = graph.nodes.filter(
      ({ kind, properties }) =>
        kind === "expression" &&
        properties.property_slot_resolution === "unresolved" &&
        Array.isArray(properties.property_path) &&
        properties.property_path.at(-1) === "speed",
    );
    expect(accesses.length).toBeGreaterThan(0);
    const trace = queryJavaScriptSemanticGraph(
      graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "property", name: "speed" },
        direction: "forward-influence",
      }),
    );
    expect(trace.seed_node_ids).toEqual(
      accesses.map(({ node_id }) => node_id).sort(),
    );
    const relevant = graph.unknowns.filter(({ node_id }) =>
      accesses.some((node) => node.node_id === node_id),
    );
    expect(relevant.length).toBeGreaterThan(0);
    expect(trace.unknowns.map(({ unknown_id }) => unknown_id)).toEqual(
      expect.arrayContaining(relevant.map(({ unknown_id }) => unknown_id)),
    );
    expect(
      queryJavaScriptSemanticGraph(
        graph,
        javaScriptSemanticQueryInputSchema.parse({
          seed: { kind: "property", name: "absent" },
          direction: "forward-influence",
        }),
      ).seed_node_ids,
    ).toEqual([]);
  },
);

it("keeps resolved property seeds on their slot without duplicating access occurrences", () => {
  const graph = graphForJavaScript(
    "const state = { speed: 1 }; const result = state.speed;",
  );
  const trace = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "property", name: "speed" },
      direction: "backward-provenance",
    }),
  );
  expect(trace.seed_node_ids).toHaveLength(1);
  expect(
    graph.nodes.find(({ node_id }) => node_id === trace.seed_node_ids[0])?.kind,
  ).toBe("property-slot");
});

it("queries an empty event name as an exact retained event identity", () => {
  const graph = graphForJavaScript(
    'const { EventEmitter } = require("node:events"); const bus = new EventEmitter(); bus.on("", function emptyListener() {}); bus.on("data", function dataListener() {});',
  );
  const trace = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "event", name: "" },
      direction: "forward-influence",
    }),
  );
  expect(trace.seed_node_ids.length).toBeGreaterThan(0);
  const seeds = trace.nodes.filter(({ node_id }) =>
    trace.seed_node_ids.includes(node_id),
  );
  expect(seeds.map(({ node_id }) => node_id).sort()).toEqual(
    [...trace.seed_node_ids].sort(),
  );
  expect(seeds.every(({ properties }) => properties.event_name === "")).toBe(
    true,
  );
});
