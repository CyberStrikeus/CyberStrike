import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { reconstructJavaScriptArtifact } from "../../support/javascriptApplicationScope.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  parseJavaScriptApplicationGraph,
  serializeJavaScriptApplicationGraph,
} from "../../../src/domain/javascript/javascriptApplicationGraph.js";

it.each(["\n", "\r\n", "\r", "\u2028", "\u2029"])(
  "preserves source-map graph evidence coordinates after %j",
  async (separator) => {
    const root = await createTestTempDirectory("rea-source-map-locations-");
    const directive = "//# sourceMappingURL=app.js.map";
    const source = `const marker = "😀";${separator}  ${directive}`;
    await writeFile(join(root, "app.js"), source);
    const result = await reconstructJavaScriptArtifact({ input_path: root });
    expect(result.statistics.parse_failures).toBe(0);
    const nodes = new Map(
      result.graph.nodes.map((node) => [node.node_id, node]),
    );
    const edge = result.graph.edges.find(
      ({ relation, target_node_id }) =>
        relation === "maps_to" &&
        nodes.get(target_node_id)?.kind === "source-map",
    );
    expect(edge).toMatchObject({
      properties: {
        declared_url_sha256: createHash("sha256")
          .update("app.js.map")
          .digest("hex"),
        resolved_path: null,
      },
      evidence: {
        state: "inferred",
        artifact: {
          sha256: createHash("sha256").update(source).digest("hex"),
        },
        location: {
          available: true,
          value: {
            kind: "source-range",
            source: "app.js",
            start: { line: 2, column: 2 },
            end: { line: 2, column: directive.length + 2 },
          },
        },
      },
    });
    expect(
      nodes
        .get(edge?.target_node_id ?? "")
        ?.observations.some(
          ({ properties }) => properties.declared_url === "app.js.map",
        ),
    ).toBe(true);
  },
);

it("owns an inline source-map URL once and recovers it from the target after JSON roundtrip", async () => {
  const root = await createTestTempDirectory("rea-inline-source-map-url-");
  const sourceContent = "source;".repeat(16_384);
  const sourceMap = JSON.stringify({
    version: 3,
    sources: ["src/app.js"],
    sourcesContent: [sourceContent],
    names: [],
    mappings: "AAAA",
  });
  const declaredUrl = `data:application/json;base64,${Buffer.from(sourceMap).toString("base64")}`;
  await writeFile(
    join(root, "app.js"),
    `const app = true;\n//# sourceMappingURL=${declaredUrl}\n`,
  );

  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const serialized = serializeJavaScriptApplicationGraph(result.graph);
  const graph = parseJavaScriptApplicationGraph(JSON.parse(serialized));
  const edge = graph.edges.find(
    ({ relation, target_node_id }) =>
      relation === "maps_to" &&
      graph.nodes.some(
        ({ kind, node_id }) =>
          kind === "source-map" && node_id === target_node_id,
      ),
  );
  const target = graph.nodes.find(
    ({ node_id }) => node_id === edge?.target_node_id,
  );

  const edgeUrlSha256 = edge?.properties.declared_url_sha256;
  const observation = target?.observations.find(
    ({ properties }) => properties.declared_url_sha256 === edgeUrlSha256,
  );
  expect(edgeUrlSha256).toBe(
    createHash("sha256").update(declaredUrl).digest("hex"),
  );
  expect(observation?.properties.declared_url).toBe(declaredUrl);
  expect(observation?.properties).toMatchObject({
    resolved_path: null,
    available: false,
  });
  expect(serialized.split(declaredUrl)).toHaveLength(2);
});

it("associates each source-map URL with its edge when aliases share one physical map", async () => {
  const root = await createTestTempDirectory("rea-source-map-aliases-");
  await mkdir(join(root, "dist"));
  await writeFile(
    join(root, "dist", "app.js.map"),
    JSON.stringify({ version: 3, sources: [], names: [], mappings: "" }),
  );
  await writeFile(
    join(root, "dist", "one.js"),
    "//# sourceMappingURL=app.js.map\n",
  );
  await writeFile(
    join(root, "dist", "two.js"),
    "//# sourceMappingURL=./app.js.map\n",
  );

  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const serialized = serializeJavaScriptApplicationGraph(result.graph);
  const graph = parseJavaScriptApplicationGraph(JSON.parse(serialized));
  const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const mapEdges = graph.edges.filter(
    ({ relation, target_node_id }) =>
      relation === "maps_to" &&
      nodes.get(target_node_id)?.kind === "source-map",
  );
  expect(mapEdges).toHaveLength(2);
  expect(mapEdges[0]?.target_node_id).toBe(mapEdges[1]?.target_node_id);
  // Edge order follows content-derived edge IDs, so pair each edge with the
  // script whose comment declared it.
  const declaredBySource = new Map(
    mapEdges.map((edge) => {
      const target = nodes.get(edge.target_node_id);
      const observation = target?.observations.find(
        ({ properties }) =>
          properties.declared_url_sha256 ===
          edge.properties.declared_url_sha256,
      );
      const location = edge.evidence.location;
      return [
        location.available && location.value.kind === "source-range"
          ? location.value.source
          : null,
        {
          declared_url: observation?.properties.declared_url,
          resolved_path: edge.properties.resolved_path,
        },
      ];
    }),
  );
  expect(Object.fromEntries(declaredBySource)).toEqual({
    "dist/one.js": {
      declared_url: "app.js.map",
      resolved_path: "dist/app.js.map",
    },
    "dist/two.js": {
      declared_url: "./app.js.map",
      resolved_path: "dist/app.js.map",
    },
  });
});

it("resolves a bare source-map file name and module worker URL next to the script", async () => {
  const root = await createTestTempDirectory("rea-source-map-relative-");
  await mkdir(join(root, "dist"));
  await writeFile(
    join(root, "dist", "app.js"),
    [
      'new Worker(new URL("worker.js", import.meta.url));',
      'navigator.serviceWorker.register("sw.js");',
      "//# sourceMappingURL=app.js.map",
    ].join("\n"),
  );
  await writeFile(
    join(root, "dist", "worker.js"),
    "self.onmessage = () => {};",
  );
  await writeFile(join(root, "dist", "sw.js"), "self.onfetch = () => {};");
  await writeFile(
    join(root, "dist", "app.js.map"),
    JSON.stringify({
      version: 3,
      sources: ["../src/app.js"],
      sourcesContent: ['new Worker("worker.js");'],
      names: [],
      mappings: "AAAA",
    }),
  );
  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const nodes = new Map(result.graph.nodes.map((node) => [node.node_id, node]));
  const mapEdge = result.graph.edges.find(
    ({ relation, target_node_id }) =>
      relation === "maps_to" &&
      nodes.get(target_node_id)?.kind === "source-map",
  );
  expect(mapEdge?.properties).toEqual({
    declared_url_sha256: createHash("sha256")
      .update("app.js.map")
      .digest("hex"),
    resolved_path: "dist/app.js.map",
    resolution_status: "resolved",
  });
  expect(
    nodes
      .get(mapEdge?.target_node_id ?? "")
      ?.observations.some(
        ({ properties }) =>
          properties.declared_url === "app.js.map" &&
          properties.resolved_path === "dist/app.js.map" &&
          properties.available === true,
      ),
  ).toBe(true);
  expect(nodes.get(mapEdge?.target_node_id ?? "")?.identity.strategy).toBe(
    "content-digest",
  );
  const workerEdge = result.graph.edges.find(
    ({ relation, source_node_id }) =>
      relation === "maps_to" && nodes.get(source_node_id)?.kind === "worker",
  );
  expect(workerEdge?.properties).toMatchObject({
    resolved_path: "dist/worker.js",
  });
  // A service worker URL is relative to the unestablished document base.
  expect(
    result.graph.edges.some(
      ({ relation, source_node_id }) =>
        relation === "maps_to" &&
        nodes.get(source_node_id)?.kind === "service-worker",
    ),
  ).toBe(false);
});
