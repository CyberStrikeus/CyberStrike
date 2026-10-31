import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";
import {
  findChunkNode,
  findGraphEdge,
  writeFixtureFiles,
} from "../../support/javascriptApplicationFixture.js";

/** Analyze one fixture and check the graph-wide self-reference invariants. */
const analyzeBundle = async (
  cli: TestCli,
  prefix: string,
  files: Readonly<Record<string, string>>,
) => {
  const root = await createTestTempDirectory(prefix);
  await writeFixtureFiles(root, files);
  const output = await cli.run({
    arguments: ["analyze-javascript-application", root, "--json"],
  });
  expect(output.exitCode).toBe(0);
  const result = javascriptApplicationAnalysisResultSchema.parse(
    parseEvidence(output.json).normalized_result,
  );
  expect(
    result.graph.edges.filter(
      (edge) => edge.source_node_id === edge.target_node_id,
    ),
  ).toEqual([]);
  expect(result.limitations).toEqual(
    expect.arrayContaining(result.graph.limitations),
  );
  return result.graph;
};

for (const scenario of [
  { runtime: "webpackChunkdemo", keys: [1], omitted: 1 },
  { runtime: "rspackChunkdemo", keys: [1, 2, 3], omitted: 3 },
] as const) {
  cliTest(
    `preserves ${scenario.runtime} evidence when a chunk requests its own IDs`,
    async ({ cli }) => {
      const graph = await analyzeBundle(cli, "rea-bundler-self-", {
        "runtime.js": `
          (self.${scenario.runtime} = self.${scenario.runtime} || []).push([
            ${JSON.stringify(scenario.keys)},
            {10(e,t,r){
              ${scenario.keys.map((key) => `r.e(${String(key)});`).join("\n")}
              r.e(4); r.e(99);
            }}
          ]);
          (self.${scenario.runtime} = self.${scenario.runtime} || []).push([
            [4], {40(e,t,r){r.r(t)}}
          ]);
        `,
      });
      expect(graph.limitations).toContainEqual(
        expect.stringMatching(
          new RegExp(
            `^${String(scenario.omitted)} bundler async-chunk references? .*omitted;`,
            "u",
          ),
        ),
      );
      const source = findChunkNode(graph, scenario.runtime, "1");
      expect(source?.observations[0]?.properties.async_chunk_keys).toEqual(
        expect.arrayContaining([...scenario.keys.map(String), "4", "99"]),
      );
      expect(source?.observations[0]?.evidence.location).toMatchObject({
        available: true,
        value: { kind: "source-range", source: "runtime.js" },
      });
      expect(
        findGraphEdge(
          graph,
          source,
          findChunkNode(graph, scenario.runtime, "4"),
          "imports",
        )?.properties,
      ).toMatchObject({
        kind: "bundler-async-chunk",
        chunk_key: "4",
        resolution_status: "resolved",
      });
      expect(
        graph.edges.find(
          (edge) =>
            edge.source_node_id === source?.node_id &&
            edge.properties.chunk_key === "99",
        )?.properties,
      ).toMatchObject({
        kind: "bundler-async-chunk",
        resolution_status: "not-found",
      });
    },
  );
}

cliTest(
  "preserves bundle evidence when a module requires its own key",
  async ({ cli }) => {
    const graph = await analyzeBundle(cli, "rea-bundler-self-require-", {
      "runtime.js": `
        (self.webpackChunkdemo = self.webpackChunkdemo || []).push([
          [5], {50(e,t,r){r(50); r(51)}, 51(e,t,r){r.r(t)}}
        ]);
      `,
    });
    expect(graph.limitations).toContainEqual(
      expect.stringMatching(
        /^1 static reference resolved back to the referencing module itself and was omitted;/u,
      ),
    );
    expect(
      graph.edges.filter(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.kind === "require" &&
          ["50", "51"].includes(String(properties.specifier)),
      ),
    ).toEqual([
      expect.objectContaining({
        properties: expect.objectContaining({ specifier: "51" }),
      }),
    ]);
  },
);
