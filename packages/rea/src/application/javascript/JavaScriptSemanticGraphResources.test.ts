import { javaScriptSemanticQueryInputSchema } from "../../domain/javascript/javascriptSemanticQuerySchemas.js";
import { expect, it } from "vitest";

import { graphForJavaScript as graphFor } from "../../../tests/fixtures/javascriptSemanticGraph.js";
import { createJavaScriptSemanticGraphProjection } from "./JavaScriptSemanticGraphBuilder.js";
import { queryJavaScriptSemanticGraph } from "../../domain/javascript/javascriptSemanticQuery.js";
import { resolveJavaScriptSemanticEvidence } from "../../domain/javascript/javascriptSemanticGraph.js";

const SHA256 = "a".repeat(64);
const GRAPH_ID = `jag_${"b".repeat(64)}`;

it("projects literal events and exact timer cancellation", () => {
  const graph = graphFor(`
      function run(bus, dynamicName) {
        const handle = setInterval(tick, 10);
        bus.on("ready", handler);
        bus.once(dynamicName, handler);
        bus.emit("ready");
        bus.removeListener("ready", handler);
        clearInterval(handle);
      }
    `);

  const relations = new Set(graph.relations.map(({ relation }) => relation));
  for (const expected of [
    "cancels-timer",
    "dispatches-candidate",
    "registers-listener",
    "removes-listener",
    "schedules-timer",
  ] as const)
    expect(relations.has(expected)).toBe(true);
  expect(
    graph.nodes.find(
      ({ kind, properties }) =>
        kind === "event" && properties.event_name === "ready",
    ),
  ).toBeDefined();
  expect(
    graph.unknowns.some(
      ({ family, detail }) =>
        family === "event" && detail.includes("Dynamic once event name"),
    ),
  ).toBe(true);
  expect(
    graph.coverage.families.find(({ family }) => family === "event"),
  ).toMatchObject({ status: "partial" });
  expect(
    graph.coverage.families.find(({ family }) => family === "timer"),
  ).toMatchObject({ status: "partial" });
});

it("projects child-process creation, I/O, listeners, and signals", () => {
  const graph = graphFor(`
      import { spawn } from "node:child_process";
      function run(command) {
        const child = spawn(
          command,
          ["--mode", "fast"],
          { env: process.env, stdio: "pipe" },
        );
        child.on("exit", onExit);
        child.once("error", onError);
        child.kill("SIGTERM");
      }
    `);

  const relations = new Set(graph.relations.map(({ relation }) => relation));
  for (const expected of [
    "connects-stdio",
    "forwards-signal",
    "listens-error",
    "listens-exit",
    "spawns",
    "supplies-argv",
    "supplies-env",
  ] as const)
    expect(relations.has(expected)).toBe(true);
  expect(
    graph.nodes.find(
      ({ kind, properties }) =>
        kind === "child-process" &&
        properties.method === "spawn" &&
        properties.command === null,
    ),
  ).toBeDefined();
  expect(
    graph.unknowns.some(
      ({ family, detail }) =>
        family === "child-process" &&
        detail.includes("command remains unresolved"),
    ),
  ).toBe(true);
  expect(
    graph.coverage.families.find(({ family }) => family === "child-process"),
  ).toMatchObject({ status: "partial" });
});

it("keeps destructured request, spawn, and timer results as projections", () => {
  const graph = graphFor(`
      import { spawn } from "node:child_process";
      async function run() {
        const { data } = await fetch("https://example.test");
        const [ child ] = spawn("worker", []);
        child.on("exit", done);
        const { handle } = setTimeout(done, 5);
        clearTimeout(handle);
        return data.json();
      }
    `);
  const projections = graph.relations.filter(
    ({ relation }) => relation === "destructures",
  );
  expect(
    projections.map(({ properties }) => properties.projection_path),
  ).toEqual(expect.arrayContaining([["data"], [0], ["handle"]]));
  expect(
    projections.every(
      ({ properties }) => properties.projection_resolution === "complete",
    ),
  ).toBe(true);
  expect(
    graph.relations.find(
      ({ relation, properties }) =>
        relation === "consumed-by" && properties.method === "json",
    ),
  ).toMatchObject({ resolution: "candidate" });
  expect(
    graph.relations.find(({ relation }) => relation === "listens-exit"),
  ).toMatchObject({ resolution: "candidate" });
  expect(
    graph.relations.find(({ relation }) => relation === "cancels-timer"),
  ).toMatchObject({ resolution: "candidate" });
  expect(
    graph.relations.some(
      ({ relation, resolution }) =>
        ["consumed-by", "listens-exit", "cancels-timer"].includes(relation) &&
        resolution === "resolved",
    ),
  ).toBe(false);
});

it("does not alias nested call arguments to an outer assigned result", () => {
  const graph = graphFor(`
      import { spawn } from "node:child_process";
      function run() {
        const child = wrap(spawn("worker", []));
        child.on("exit", done);
        const handle = String(setTimeout(done, 5));
        clearTimeout(handle);
      }
    `);
  expect(
    graph.relations.some(({ relation }) =>
      ["listens-exit", "cancels-timer", "destructures"].includes(relation),
    ),
  ).toBe(false);
});

it("projects config precedence, request fields, and boundaries", () => {
  const graph = graphFor(`
      import { readFileSync } from "node:fs";
      async function run(schema) {
        const endpoint = process.env.API_URL ?? "https://fallback.test";
        const raw = readFileSync("./config.json", "utf8");
        const parsed = JSON.parse(raw);
        const port = Number(process.argv[2]);
        const validated = schema.parse(parsed);
        const response = await fetch(endpoint, {
          method: "POST",
          body: validated,
        });
        return response.json();
      }
    `);

  const relations = new Set(graph.relations.map(({ relation }) => relation));
  for (const expected of [
    "coerces",
    "constructs-request",
    "consumed-by",
    "defaults",
    "overrides",
    "parses",
    "reads-argv",
    "reads-config",
    "reads-environment",
    "supplies-request-field",
  ] as const)
    expect(relations.has(expected)).toBe(true);
  expect(
    graph.nodes.find(
      ({ kind, properties }) =>
        kind === "request" && properties.method === "fetch",
    ),
  ).toBeDefined();
  expect(
    graph.nodes.filter(({ kind }) => kind === "boundary"),
  ).not.toHaveLength(0);
  expect(
    graph.coverage.families.find(({ family }) => family === "configuration"),
  ).toMatchObject({ status: "partial" });
  expect(
    graph.coverage.families.find(({ family }) => family === "request"),
  ).toMatchObject({ status: "partial" });
  expect(
    graph.coverage.families.find(({ family }) => family === "boundary"),
  ).toMatchObject({ status: "partial" });
});

it("projects built-in resource acquisition and release", () => {
  const graph = graphFor(`
      import { open } from "node:fs/promises";
      import { connect } from "node:net";
      async function run(path) {
        const file = await open(path);
        const socket = connect({ port: 9000 });
        await file.close();
        socket.end();
      }
    `);

  const relations = new Set(graph.relations.map(({ relation }) => relation));
  expect(relations.has("acquires")).toBe(true);
  expect(relations.has("releases")).toBe(true);
  expect(graph.nodes.filter(({ kind }) => kind === "resource")).toHaveLength(2);
  expect(
    graph.coverage.families.find(
      ({ family }) => family === "resource-lifecycle",
    ),
  ).toMatchObject({ status: "partial" });
});

it.each(["+= 1", "++"])(
  "projects both property dependencies for %s",
  (operator) => {
    const graph = graphFor(`
      const source = { count: 1 };
      source.count ${operator};
    `);
    const relations = graph.relations.map(({ relation }) => relation);
    expect(relations).toContain("reads-property");
    expect(relations).toContain("writes-property");
  },
);
it("does not project a literal property slot for dynamic destructuring", () => {
  const graph = graphFor(`
    const source = { token: "TOKEN" };
    const key = getKey();
    const { [key]: value } = source;
  `);

  expect(
    graph.relations.filter(({ relation }) => relation === "destructures"),
  ).toEqual([]);
  expect(
    graph.nodes.find(
      ({ kind, properties }) =>
        kind === "property-slot" && properties.name === "key",
    ),
  ).toBeUndefined();
});

it("projects literal seeds and static object flow", () => {
  const graph = graphFor(`
      const source = { token: "TOKEN", count: 1 };
      const { token } = source;
      const copy = { ...source };
      source.count = 2;
      const read = source.token;
    `);

  const relations = new Set(graph.relations.map(({ relation }) => relation));
  for (const expected of [
    "destructures",
    "reads-property",
    "spreads",
    "writes-property",
  ] as const)
    expect(relations.has(expected)).toBe(true);
  expect(
    graph.nodes.find(
      ({ kind, properties }) =>
        kind === "property-slot" && properties.name === "token",
    ),
  ).toBeDefined();
  const literal = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: "TOKEN" },
      direction: "forward-influence",
    }),
  );
  expect(literal.status).toBe("ambiguous");
  const targetName = (targetId: string): string => {
    const target = graph.nodes.find(({ node_id }) => node_id === targetId);
    if (target === undefined) throw new Error("Missing value target");
    if (target.kind === "binding" && target.label !== null) return target.label;
    const owner = graph.relations.find(
      ({ relation, target_node_id }) =>
        relation === "writes-property" && target_node_id === target.node_id,
    );
    const binding = graph.nodes.find(
      ({ node_id }) => node_id === owner?.source_node_id,
    );
    if (binding === undefined) throw new Error("Missing property owner");
    return `${binding.label}.${String(target.properties.name)}`;
  };
  const literalTargets = graph.relations
    .filter(
      ({ relation, source_node_id }) =>
        relation === "defines" &&
        literal.seed_node_ids.includes(source_node_id),
    )
    .map(({ target_node_id }) => targetName(target_node_id));
  expect(literalTargets.sort()).toEqual([
    "copy.token",
    "read",
    "source.token",
    "token",
  ]);
  expect(literal.summary.total_seed_matches).toBe(literalTargets.length);
  const property = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "property", name: "token" },
      direction: "forward-influence",
    }),
  );
  expect(property.status).toBe("ambiguous");
  expect(property.seed_node_ids.map(targetName).sort()).toEqual([
    "copy.token",
    "source.token",
  ]);
  expect(property.unknowns).toEqual([]);
  expect(property.relations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        relation: "destructures",
        resolution: "resolved",
      }),
      expect.objectContaining({
        relation: "reads-property",
        resolution: "resolved",
      }),
    ]),
  );
});

it("does not promote transformed return expressions to resolved aliases", () => {
  const graph = graphFor(`
      function increment(value) { return value + 1; }
      const input = 1;
      const output = increment(input);
    `);
  const returnNode = graph.nodes.find(({ kind }) => kind === "return-site");
  if (returnNode === undefined) throw new Error("Expected return site");
  expect(
    graph.relations.filter(
      ({ relation, target_node_id }) =>
        relation === "aliases" && target_node_id === returnNode.node_id,
    ),
  ).toEqual([]);
  expect(
    graph.relations.filter(
      ({ relation, target_node_id }) =>
        relation === "influences" && target_node_id === returnNode.node_id,
    ),
  ).toEqual([expect.objectContaining({ resolution: "resolved" })]);
  const output = graph.nodes.find(
    ({ kind, label }) => kind === "binding" && label === "output",
  );
  const input = graph.nodes.find(
    ({ kind, label }) => kind === "binding" && label === "input",
  );
  if (output === undefined || input === undefined)
    throw new Error("Expected caller bindings");
  const strict = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "semantic-node", node_id: output.node_id },
      direction: "backward-provenance",
    }),
  );
  expect(strict.nodes.map(({ node_id }) => node_id)).toContain(input.node_id);
  expect(strict.status).toBe("partial");
});

it("uses unavailable evidence when no source produced semantic IR", () => {
  const graph = createJavaScriptSemanticGraphProjection().finish(SHA256, {
    graph_id: GRAPH_ID,
    nodes: [],
  });
  const root = graph.nodes[0];
  if (root === undefined) throw new Error("Expected unavailable semantic root");
  expect(resolveJavaScriptSemanticEvidence(graph, root.evidence)).toMatchObject(
    {
      authority: "unknown",
      state: "unavailable",
      location: { available: false, reason: "not-observed" },
    },
  );
});
