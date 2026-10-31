import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const runtimeSource = (
  runtime: string,
  name: string,
  entry = 1,
  dependency = 2,
) => `
  globalThis.${runtime}.push([["main"], {
    ${String(entry)}: (module, exports, req) => {
      req(${String(dependency)}); req.e("lazy"); fetch("/${name}");
      localStorage.setItem("${name}", "value");
      const { BrowserWindow } = require("electron"); new BrowserWindow({});
    },
    ${String(dependency)}: (module) => { module.exports = "${name}"; }
  }, (req) => req(${String(entry)})]);
  globalThis.${runtime}.push([["lazy"], {9: () => {}}]);
`;

const appA = runtimeSource("webpackChunkAppA", "a");
const appB = runtimeSource("webpackChunkAppB", "b");

cliTest(
  "keeps source-derived runtime, module and chunk tuples collision-free",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-bundler-runtime-tuple-");
    const registrations = [
      {
        runtime: "webpackChunkA",
        module: "x\0y",
        chunk: "x\0lazy",
        endpoint: "/a",
      },
      {
        runtime: "webpackChunkA\0x",
        module: "y",
        chunk: "lazy",
        endpoint: "/b",
      },
    ];
    const source = registrations
      .map(
        ({ runtime, module, chunk, endpoint }) => `
    globalThis[${JSON.stringify(runtime)}].push([["main"], {
      [${JSON.stringify(module)}]: (m, e, req) => { fetch(${JSON.stringify(endpoint)}); req.e(${JSON.stringify(chunk)}); }
    }, (req) => req(${JSON.stringify(module)})]);
    globalThis[${JSON.stringify(runtime)}].push([[${JSON.stringify(chunk)}], {}]);
  `,
      )
      .join("\n");
    await writeFixtureFiles(root, { "bundle.js": source });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode).toBe(0);
    const { graph } = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
    for (const { runtime, module, chunk, endpoint } of registrations) {
      const entry = graph.edges.find(
        (edge) =>
          edge.properties.kind === "bundler-entry-module" &&
          edge.properties.runtime === runtime,
      );
      expect(nodes.get(entry?.target_node_id ?? "")?.identity).toMatchObject({
        namespace: `${runtime}:module`,
        key: module,
      });
      const call = graph.edges.find(
        (edge) =>
          edge.relation === "calls" &&
          nodes.get(edge.target_node_id)?.observations[0]?.properties.value ===
            endpoint,
      );
      expect(call?.source_node_id).toBe(entry?.target_node_id);
      const lazy = graph.edges.find(
        (edge) =>
          edge.source_node_id === entry?.target_node_id &&
          edge.properties.specifier === `chunk:${chunk}`,
      );
      expect(
        nodes.get(lazy?.target_node_id ?? "")?.observations[0]?.properties,
      ).toMatchObject({ runtime, chunk_keys: [chunk] });
    }
  },
);

for (const scenario of [
  {
    name: "colliding module IDs",
    source: appA + appB,
    runtimes: ["webpackChunkAppA", "webpackChunkAppB"],
    keys: [1, 1],
  },
  {
    name: "reversed registrations",
    source: appB + appA,
    runtimes: ["webpackChunkAppA", "webpackChunkAppB"],
    keys: [1, 1],
  },
  {
    name: "single runtime",
    source: appA,
    runtimes: ["webpackChunkAppA"],
    keys: [1],
  },
  {
    name: "disjoint module IDs",
    source: appA + runtimeSource("webpackChunkAppB", "b", 3, 4),
    runtimes: ["webpackChunkAppA", "webpackChunkAppB"],
    keys: [1, 3],
  },
  {
    name: "Webpack and Rspack collision",
    source: appA + runtimeSource("rspackChunkAppB", "b"),
    runtimes: ["webpackChunkAppA", "rspackChunkAppB"],
    keys: [1, 1],
  },
]) {
  cliTest(
    `keeps bundled relationships within their runtime for ${scenario.name}`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-bundler-runtime-scope-");
      await writeFixtureFiles(root, { "bundle.js": scenario.source });
      const output = await cli.run({
        arguments: ["analyze-javascript-application", root, "--json"],
      });
      expect(output.exitCode).toBe(0);
      const { graph } = javascriptApplicationAnalysisResultSchema.parse(
        parseEvidence(output.json).normalized_result,
      );
      const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
      expect(graph.coverage.status).toBe("complete");
      for (const [index, runtime] of scenario.runtimes.entries()) {
        const name = index === 0 ? "a" : "b";
        const key = String(scenario.keys[index]);
        const module = graph.nodes.find(
          (node) =>
            node.identity.strategy === "artifact-local-key" &&
            node.identity.namespace === `${runtime}:module` &&
            node.identity.key === key,
        );
        expect(module).toBeDefined();
        const entry = graph.edges.find(
          (edge) =>
            edge.properties.kind === "bundler-entry-module" &&
            edge.properties.runtime === runtime,
        );
        expect(entry?.target_node_id).toBe(module?.node_id);
        expect(entry?.properties.resolution_status).toBe("resolved");
        const ownedEdges = graph.edges.filter(
          (edge) => edge.source_node_id === module?.node_id,
        );
        expect(
          ownedEdges.find(
            (edge) =>
              edge.relation === "calls" &&
              nodes.get(edge.target_node_id)?.observations[0]?.properties
                .value === `/${name}`,
          ),
        ).toBeDefined();
        expect(
          ownedEdges.find(
            (edge) =>
              edge.relation === "persists_to" &&
              nodes.get(edge.target_node_id)?.observations[0]?.properties
                .name === name,
          ),
        ).toBeDefined();
        expect(
          ownedEdges.find(
            (edge) =>
              edge.relation === "contains" &&
              nodes.get(edge.target_node_id)?.kind === "browser-window",
          ),
        ).toBeDefined();
        const dependency = ownedEdges.find(
          (edge) =>
            edge.properties.kind === "require" &&
            edge.properties.specifier === String(Number(key) + 1),
        );
        expect(
          nodes.get(dependency?.target_node_id ?? "")?.identity,
        ).toMatchObject({
          namespace: `${runtime}:module`,
          key: String(Number(key) + 1),
        });
        const lazy = ownedEdges.find(
          (edge) => edge.properties.specifier === "chunk:lazy",
        );
        expect(
          nodes.get(lazy?.target_node_id ?? "")?.observations[0]?.properties,
        ).toMatchObject({ runtime, chunk_keys: ["lazy"] });
      }
    },
  );
}

cliTest(
  "shares module IDs across chunks only within the same runtime",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-bundler-shared-runtime-");
    await writeFixtureFiles(root, {
      "bundle.js": `
    globalThis.webpackChunkApp.push([["main"], {1: (module, exports, req) => { req(2); }} , (req) => req(1)]);
    globalThis.webpackChunkApp.push([["other"], {2: (module) => { module.exports = "dependency"; }}]);
  `,
    });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode).toBe(0);
    const { graph } = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    const module = (key: string) =>
      graph.nodes.find(
        (node) =>
          node.identity.strategy === "artifact-local-key" &&
          node.identity.namespace === "webpackChunkApp:module" &&
          node.identity.key === key,
      );
    expect(
      graph.edges.find(
        (edge) =>
          edge.properties.kind === "require" &&
          edge.properties.specifier === "2",
      ),
    ).toMatchObject({
      source_node_id: module("1")?.node_id,
      target_node_id: module("2")?.node_id,
    });
  },
);
