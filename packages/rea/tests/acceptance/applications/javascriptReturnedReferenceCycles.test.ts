import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { findSourceModule } from "../../support/javascriptApplicationFixture.js";

const verify = (value: unknown) => {
  const result = javascriptApplicationAnalysisResultSchema.parse(
    parseEvidence(value).normalized_result,
  );
  expect(result.statistics).toMatchObject({
    parsed_javascript_files: 5,
    skipped_javascript_files: 0,
    parse_failures: 0,
  });
  const endpoints = result.graph.nodes
    .filter(({ kind }) => kind === "endpoint")
    .flatMap(({ observations }) =>
      observations.map(({ properties }) => ({
        value: properties.value,
        interpretation: properties.interpretation,
      })),
    );
  expect(endpoints).toContainEqual({
    value: "/preserved",
    interpretation: undefined,
  });
  expect(endpoints).toContainEqual({
    value: "/possibly-patched",
    interpretation: "candidate",
  });
  expect(endpoints).toContainEqual({
    value: "/growing",
    interpretation: "candidate",
  });
  expect(endpoints.some(({ value }) => value === "/intrinsic")).toBe(false);
  expect(endpoints).toContainEqual({
    value: "/copied-factory",
    interpretation: undefined,
  });
  expect(endpoints).toContainEqual({
    value: "/copied-module",
    interpretation: undefined,
  });
  for (const [path, expression] of [
    ["copied-factory.cjs", 'box.make().require("./possible.cjs")'],
    ["copied-module.cjs", 'box.loader.require("./possible.cjs")'],
  ] as const) {
    const source = findSourceModule(result.graph, path);
    expect(source).toBeDefined();
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        source_node_id: source?.node_id,
        relation: "imports",
        properties: expect.objectContaining({ specifier: null, expression }),
      }),
    );
  }
  expect(result.semantic_graph.unknowns).toContainEqual(
    expect.objectContaining({
      reason: "dynamic-property",
      detail: expect.stringContaining("returned-reference projections"),
    }),
  );
};

cliTest(
  "retains static facts and possible prototype effects across a recursive alias web in CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-returned-reference-cycles-",
    );
    await writeFile(
      join(root, "cycles.js"),
      `function local() { return {}; }
function exposed() { return Map.prototype; }
let a = local, b = exposed;
function patch(flag) {
  ${Array.from({ length: 28 }, (_, index) =>
    index % 2 === 0 ? "a = b;" : "b = a;",
  ).join("\n")}
  a().get = fetch;
}
fetch("/preserved");
new Map().get("/possibly-patched");`,
    );
    await writeFile(
      join(root, "independent.js"),
      'const records = new Map(); records.get("/intrinsic");',
    );
    await writeFile(
      join(root, "growing.js"),
      `function expose() { return Map.prototype; }
let cursor = { target: expose };
function walk(flag) {
  while (flag) cursor = cursor.next;
  patch(cursor.target());
}
new Map().get("/growing");`,
    );
    await writeFile(
      join(root, "copied-factory.cjs"),
      `let box={make:()=>module};
while(flag) box={...box};
box.make().require("./possible.cjs");
fetch("/copied-factory");`,
    );
    await writeFile(
      join(root, "copied-module.cjs"),
      `let box={loader:module};
while(flag) box={...box};
box.loader.require("./possible.cjs");
fetch("/copied-module");`,
    );
    const response = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--max-heap-mb",
        "256",
        "--analysis-timeout-ms",
        "30000",
        "--format",
        "json",
      ],
    });
    expect(response.exitCode, response.stderr).toBe(0);
    verify(response.json);

    const { call } = await connectLocalToolsMcp();
    const analyzed = await call("analyze_javascript_application", {
      input_path: root,
      max_heap_mb: 256,
      analysis_timeout_ms: 30_000,
    });
    expect(analyzed.isError, JSON.stringify(analyzed.content)).not.toBe(true);
    verify(analyzed.structuredContent);
  },
  90_000,
);
