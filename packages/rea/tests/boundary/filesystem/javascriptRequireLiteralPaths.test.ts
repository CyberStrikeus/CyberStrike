import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { parseApplicationGraphEvidence } from "../../../src/application/javascript/JavaScriptApplicationEvidenceGraph.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const analyze = async (root: string) => {
  const result = await analyzeJavaScriptApplication({
    input_path: root,
    format: "directory",
  });
  if (!result.ok) throw result.error;
  const parsed = parseApplicationGraphEvidence(result.value);
  if (!parsed.ok) throw new Error("Analysis Evidence must parse");
  const authenticated = parsed.value;
  return {
    graph: authenticated.graph,
    result: javascriptApplicationAnalysisResultSchema.parse(
      authenticated.evidence.normalized_result,
    ),
  };
};

const analyzeLoaderSuffixCase = async () => {
  const root = await createTestTempDirectory("rea-require-suffix-case-");
  const javascript = 'module.exports = { loadedBy: "javascript" };';
  // Case-insensitive hosts cannot hold both spellings in one directory.
  await mkdir(join(root, "lower"));
  await Promise.all([
    writeFile(
      join(root, "main.cjs"),
      ["./data.JSON", "./addon.NODE", "./lower/data.json", "./lower/addon.node"]
        .map((specifier) => `require(${JSON.stringify(specifier)});`)
        .join("\n"),
    ),
    writeFile(join(root, "data.JSON"), javascript),
    writeFile(join(root, "addon.NODE"), javascript),
    writeFile(join(root, "lower", "data.json"), '{"loadedBy":"json"}'),
    writeFile(join(root, "lower", "addon.node"), Buffer.from([0, 1, 2, 3])),
  ]);
  // Node matches registered loader extensions case-sensitively.
  const nodeRequire = createRequire(join(root, "main.cjs"));
  expect(nodeRequire("./data.JSON")).toEqual({ loadedBy: "javascript" });
  expect(nodeRequire("./addon.NODE")).toEqual({ loadedBy: "javascript" });
  const { graph } = await analyze(root);
  return (specifier: string) =>
    graph.edges.filter((edge) => edge.properties.specifier === specifier);
};

describe("literal CommonJS paths in application graphs", () => {
  it("agrees with Node for both require projections while preserving ESM suffixes", async () => {
    const root = await createTestTempDirectory("rea-literal-require-");
    const specifier = "./dep.cjs#literal.cjs";
    await Promise.all([
      writeFile(
        join(root, "main.cjs"),
        `const value = require(${JSON.stringify(specifier)}); module.exports = value;`,
      ),
      writeFile(
        join(root, "imports.mjs"),
        `import value from ${JSON.stringify(specifier)}; export { value };`,
      ),
      writeFile(join(root, "dep.cjs"), "module.exports = 'stripped';"),
      writeFile(
        join(root, "dep.cjs#literal.cjs"),
        "module.exports = 'literal';",
      ),
    ]);
    const expected = relative(
      root,
      createRequire(join(root, "main.cjs")).resolve(specifier),
    )
      .split(sep)
      .join("/");
    expect(expected).toBe("dep.cjs#literal.cjs");
    const { graph } = await analyze(root);
    const properties = graph.edges
      .filter((edge) => edge.properties.specifier === specifier)
      .map((edge) => edge.properties);
    expect(properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module_link_kind: "require",
          resolved_path: expected,
        }),
        expect.objectContaining({ kind: "require", resolved_path: expected }),
        expect.objectContaining({
          module_link_kind: "import",
          resolved_path: "dep.cjs",
        }),
        expect.objectContaining({
          kind: "static-import",
          resolved_path: "dep.cjs",
        }),
      ]),
    );
    expect(graph.coverage.status).toBe("complete");
  });

  it("attaches JSON loader status only to Node's exact .json suffix", async () => {
    const edges = await analyzeLoaderSuffixCase();
    const relationship = (specifier: string) =>
      edges(specifier).find(
        (edge) => edge.properties.module_link_kind === "require",
      )?.properties;
    expect(relationship("./data.JSON")).toMatchObject({
      resolved_path: "data.JSON",
      target_file_kind: "json",
      target_json_status: null,
    });
    expect(relationship("./lower/data.json")).toMatchObject({
      resolved_path: "lower/data.json",
      target_file_kind: "json",
      target_json_status: "included",
    });
  });

  it("emits a native loads edge only for Node's exact .node suffix", async () => {
    const edges = await analyzeLoaderSuffixCase();
    const relations = (specifier: string) =>
      edges(specifier)
        .filter((edge) => edge.properties.kind === "require")
        .map((edge) => edge.relation);
    expect(relations("./addon.NODE")).toEqual(["imports"]);
    expect(relations("./lower/addon.node")).toEqual(["loads"]);
  });

  it.each(["literal", "stripped", "both"] as const)(
    "keeps native graph/count projections aligned with %s files",
    async (layout) => {
      const root = await createTestTempDirectory("rea-literal-native-");
      const specifier = "./addon.node#literal.node";
      await Promise.all([
        writeFile(
          join(root, "main.cjs"),
          `const addon = require(${JSON.stringify(specifier)}); module.exports = require(${JSON.stringify(specifier)}); throw new Error('must not execute');`,
        ),
        writeFile(
          join(root, "imports.mjs"),
          `import addon from ${JSON.stringify(specifier)}; export { default } from ${JSON.stringify(specifier)}; throw new Error('must not execute');`,
        ),
        ...(layout !== "stripped"
          ? [
              writeFile(
                join(root, "addon.node#literal.node"),
                Buffer.from([0, 1, 2, 3]),
              ),
            ]
          : []),
        ...(layout !== "literal"
          ? [writeFile(join(root, "addon.node"), Buffer.from([0, 4, 5, 6]))]
          : []),
      ]);
      const { graph, result } = await analyze(root);
      const bindings = graph.nodes
        .filter(({ kind }) => kind === "native-export")
        .flatMap(({ observations }) => observations)
        .map((observation) => ({
          source:
            observation.evidence.location.available &&
            observation.evidence.location.value.kind === "source-range"
              ? observation.evidence.location.value.source
              : null,
          binding: observation.properties.binding_kind,
          path: observation.properties.resolved_path,
        }));
      const required = layout !== "stripped" ? "addon.node#literal.node" : null;
      const imported = layout !== "literal" ? "addon.node" : null;
      expect(bindings).toHaveLength(4);
      expect(bindings).toEqual(
        expect.arrayContaining([
          { source: "main.cjs", binding: "require", path: required },
          { source: "main.cjs", binding: "re-export", path: required },
          { source: "imports.mjs", binding: "import", path: imported },
          { source: "imports.mjs", binding: "re-export", path: imported },
        ]),
      );
      expect(result.summary).toMatchObject({
        native_addon_bindings: 4,
        resolved_native_addon_bindings: layout === "both" ? 4 : 2,
      });
    },
  );
});

describe("literal CommonJS percent bytes in application graphs", () => {
  it("agrees with Node for requests whose literal names contain %2e or %2F", async () => {
    const root = await createTestTempDirectory("rea-literal-percent-require-");
    const files = {
      "app/lit%2eb.js": "module.exports = 'lit%2eb.js';",
      "app/x%2Fy.js": "module.exports = 'x%2Fy.js';",
      "app/sub/%2e%2e/x.js": "module.exports = 'sub/%2e%2e/x.js';",
      "app/x.js": "module.exports = 'decoy for a decoded parent';",
      "app/pkg/package.json": JSON.stringify({ main: "lit%2eb" }),
      "app/pkg/lit%2eb.js": "module.exports = 'pkg/lit%2eb.js';",
      "app/node_modules/dep/package.json": JSON.stringify({ name: "dep" }),
      "app/node_modules/dep/lit%2eb.js": "module.exports = 'dep/lit%2eb.js';",
      "escape.js": "module.exports = 'decoy outside the request directory';",
    };
    const specifiers = [
      "./lit%2eb",
      "./x%2Fy",
      "./sub/%2e%2e/x",
      "./pkg",
      "dep/lit%2eb",
    ];
    // CommonJS reads %2e%2e as a directory name, never as a parent segment.
    const literalSegment = "./%2e%2e/escape";
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const main = join(root, "app", "main.cjs");
    await writeFile(
      main,
      [...specifiers, literalSegment]
        .map((specifier) => `require(${JSON.stringify(specifier)});`)
        .join("\n"),
    );
    const nodeRequire = createRequire(main);
    const nodePath = (specifier: string) =>
      relative(root, nodeRequire.resolve(specifier)).split(sep).join("/");
    expect(() => nodeRequire.resolve(literalSegment)).toThrow(
      /Cannot find module/u,
    );

    const { graph } = await analyze(root);
    const requests = (specifier: string) =>
      graph.edges.filter(
        (edge) =>
          edge.relation === "imports" &&
          edge.properties.specifier === specifier,
      );
    for (const specifier of specifiers) {
      const edges = requests(specifier);
      expect(edges.length, specifier).toBeGreaterThan(0);
      for (const edge of edges)
        expect(edge.properties.resolved_path, specifier).toBe(
          nodePath(specifier),
        );
    }
    const unresolved = requests(literalSegment);
    expect(unresolved.length).toBeGreaterThan(0);
    for (const edge of unresolved)
      expect(edge.properties.resolved_path).toBeNull();
  });
});

it("reports a present non-JavaScript require target as unavailable with inventory identity", async () => {
  const present = await createTestTempDirectory("rea-require-opaque-present-");
  const absent = await createTestTempDirectory("rea-require-opaque-absent-");
  const bytes = Buffer.from([0xde, 0xc0, 0x17, 0x0b, 0x00, 0x01, 0x02]);
  const main = 'require("./core.jsc");';
  await Promise.all([
    writeFile(join(present, "main.cjs"), main),
    writeFile(join(present, "core.jsc"), bytes),
    writeFile(join(absent, "main.cjs"), main),
  ]);
  const edge = async (root: string) => {
    const { graph } = await analyze(root);
    return graph.edges.find(
      ({ properties }) =>
        properties.specifier === "./core.jsc" &&
        properties.module_link_kind === "require",
    );
  };
  const presentEdge = await edge(present);
  expect(presentEdge?.properties).toMatchObject({
    resolution_status: "unavailable",
    candidate_path: "core.jsc",
    resolved_path: null,
  });
  expect(presentEdge?.evidence.limitations).toContainEqual(
    expect.stringContaining(
      `core.jsc exists in the inventoried artifact container (sha256 ${createHash("sha256").update(bytes).digest("hex")}, ${String(bytes.length)} bytes)`,
    ),
  );
  expect((await edge(absent))?.properties).toMatchObject({
    resolution_status: "not-found",
    resolved_path: null,
  });
});
