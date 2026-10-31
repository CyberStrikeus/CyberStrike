import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { parseJavaScriptApplicationGraph } from "../../../../src/domain/javascript/javascriptApplicationGraph.js";
import { compareJavaScriptApplicationVersions } from "../../../../src/domain/javascript/javascriptApplicationVersionComparison.js";
import { semanticResourceLimitReason } from "../../../../src/domain/javascript/javascriptSemanticResourceLimits.js";
import { getterExpansionSource } from "../../../fixtures/javascriptGetterExpansion.js";
import { primitiveCandidateExpansionExpression } from "../../../fixtures/javascriptPrimitiveExpansion.js";
import { scanCanonicalArtifactInventory } from "../../../fixtures/artifactInventory.js";
import { readJavaScriptArtifactFiles } from "../../../support/javascriptApplicationScope.js";
import { createJavaScriptArtifactReader } from "../../../../src/artifacts/javascript/JavaScriptArtifactReader.js";
import { analyzeArtifactFiles } from "../../../fixtures/javascriptArtifactAnalysis.js";
import { immutableArtifactGraph } from "../../../fixtures/javascriptArtifactGraph.js";

import {
  findExportNode,
  findRelationshipEdge,
  findSourceModule,
  reconstructJavaScriptFixture,
  writeFixtureFiles,
} from "../../../support/javascriptApplicationFixture.js";

const relationshipGraph = async (root: string) => {
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    return await immutableArtifactGraph(snapshot, files, analysis);
  } finally {
    await reader.close();
  }
};

it.each(["browser", "module", "renderer", "main"] as const)(
  "distinguishes %s package metadata from an imported module's application owner",
  async (field) => {
    const root = await createTestTempDirectory("rea-frontend-package-owner-");
    await writeFixtureFiles(root, {
      "package.json": JSON.stringify({ main: "main.cjs" }),
      "main.cjs": 'require("./lib/window.cjs");',
      "lib/package.json": JSON.stringify({ [field]: "window.cjs" }),
      "lib/window.cjs":
        'const {BrowserWindow} = require("electron"); const w = new BrowserWindow(); w.loadFile("index.html");',
      "lib/orphan.cjs":
        'const {BrowserWindow} = require("electron"); const w = new BrowserWindow(); w.loadFile("orphan.html");',
      "index.html": "root application page",
      "lib/index.html": "frontend package decoy",
      "orphan.html": "root application fallback",
      "lib/orphan.html": "frontend package fallback decoy",
    });
    const graph = await relationshipGraph(root);
    const actualMain = field === "main";
    for (const declaredPath of ["index.html", "orphan.html"]) {
      const renderer = graph.nodes.find(
        ({ kind, observations }) =>
          kind === "electron-renderer" &&
          observations.some(
            ({ properties }) => properties.declared_path === declaredPath,
          ),
      );
      expect(renderer?.observations[0]?.properties).toMatchObject({
        resolved_path: actualMain ? null : declaredPath,
        resolution_status: actualMain ? "unavailable" : "resolved",
      });
      expect(
        graph.edges.filter(
          ({ source_node_id, relation }) =>
            source_node_id === renderer?.node_id && relation === "maps_to",
        ),
      ).toHaveLength(actualMain ? 0 : 1);
    }
    if (!actualMain)
      expect(
        graph.nodes.some(
          ({ kind, observations }) =>
            kind === "electron-renderer" &&
            observations.some(
              ({ properties }) =>
                properties.mechanism === `package.json:${field}` &&
                properties.resolved_path === "lib/window.cjs",
            ),
        ),
      ).toBe(true);
  },
);

it.each([
  ["getter-expansion", getterExpansionSource()],
  [
    "primitive-candidates",
    `const result = ${primitiveCandidateExpansionExpression()};`,
  ],
] as const)(
  "deduplicates %s limitations on import and export relationships",
  async (limit, source) => {
    const root = await createTestTempDirectory("rea-module-limit-evidence-");
    await writeFixtureFiles(root, {
      "entry.js": `import imported from "./dep.js"; ${source} export { result };`,
      "dep.js": "export default 42;",
    });
    const graph = await relationshipGraph(root);
    const module = findSourceModule(graph, "entry.js");
    const relationships = graph.edges.filter(
      ({ source_node_id, relation, properties }) =>
        source_node_id === module?.node_id &&
        (relation === "exposes" ||
          (relation === "imports" && properties.module_link_kind === "import")),
    );
    expect(relationships.map(({ relation }) => relation).sort()).toEqual([
      "exposes",
      "imports",
    ]);
    for (const { evidence } of relationships) {
      expect(
        evidence.limitations.filter(
          (reason) => reason === semanticResourceLimitReason(limit),
        ),
      ).toEqual([semanticResourceLimitReason(limit)]);
      expect(evidence.coverage.status).toBe("partial");
      expect(evidence.limitations).toContain(
        "Static syntax does not prove that this relationship executes at runtime.",
      );
      expect(evidence.limitations).toContain(
        "Values and aliases were recovered from inert syntax only; no JavaScript was executed.",
      );
    }
  },
);

describe("cross-version source module identity", () => {
  it("keeps exact source identity without claiming unchanged unresolved relationships", async () => {
    const root = await createTestTempDirectory("rea-source-module-sibling-");
    const mainSource = 'require("./util.js");\n';
    const sourceSha256 = createHash("sha256").update(mainSource).digest("hex");
    const versions = await Promise.all(
      ["left", "right"].map(async (name) => {
        const path = join(root, name);
        await writeFixtureFiles(path, {
          "main.js": mainSource,
          "util.js": `module.exports = ${JSON.stringify(name)};\n`,
        });
        return reconstructJavaScriptFixture(path);
      }),
    );
    const [left, right] = versions;
    if (left === undefined || right === undefined)
      throw new Error("Missing JavaScript application version");
    const leftModule = findSourceModule(left.graph, "main.js");
    const rightModule = findSourceModule(right.graph, "main.js");
    if (leftModule === undefined || rightModule === undefined)
      throw new Error("Missing main source module");
    const leftObservation = leftModule.observations.find(
      ({ properties }) => properties.semantic_role === "source-module",
    );
    const rightObservation = rightModule.observations.find(
      ({ properties }) => properties.semantic_role === "source-module",
    );
    if (leftObservation === undefined || rightObservation === undefined)
      throw new Error("Missing main source observation");
    expect(left.root_artifact_sha256).not.toBe(right.root_artifact_sha256);
    expect(leftModule.node_id).not.toBe(rightModule.node_id);
    expect(leftObservation.properties).not.toHaveProperty("container_sha256");
    expect(rightObservation.properties).not.toHaveProperty("container_sha256");
    const { file_occurrence: leftOccurrence, ...leftSourceFacts } =
      leftObservation.properties;
    const { file_occurrence: rightOccurrence, ...rightSourceFacts } =
      rightObservation.properties;
    expect(leftOccurrence).toEqual({
      container_sha256: left.root_artifact_sha256,
      path: "main.js",
      sha256: sourceSha256,
    });
    expect(rightOccurrence).toEqual({
      container_sha256: right.root_artifact_sha256,
      path: "main.js",
      sha256: sourceSha256,
    });
    expect(leftSourceFacts).toEqual(rightSourceFacts);
    expect(leftSourceFacts.source_sha256).toBe(sourceSha256);
    expect(leftObservation.evidence).toEqual(rightObservation.evidence);
    expect(leftObservation.evidence.artifact).toMatchObject({
      available: true,
      artifact_id: `art_${sourceSha256}`,
      sha256: sourceSha256,
    });

    const comparison = compareJavaScriptApplicationVersions({
      left: {
        evidenceId: `ev_${"a".repeat(64)}`,
        rootArtifactSha256: left.root_artifact_sha256,
        graph: left.graph,
      },
      right: {
        evidenceId: `ev_${"b".repeat(64)}`,
        rootArtifactSha256: right.root_artifact_sha256,
        graph: right.graph,
      },
      leftNativeEvidence: [],
      rightNativeEvidence: [],
    });

    const item = comparison.items.find(
      ({ left_node_id }) => left_node_id === leftModule.node_id,
    );
    expect(item).toMatchObject({
      status: "unknown",
      right_node_id: rightModule.node_id,
      match: {
        status: "matched",
        basis: "exact-module-source-digest",
        confidence: "exact",
      },
    });
    expect(item?.dimensions).not.toContain("content");
    expect(item?.dimensions).not.toContain("properties");
    expect(item?.limitations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /Incomplete graph coverage|Relationship target identity remains unresolved/,
        ),
      ]),
    );
  });
});

describe("TypeScript source module loader semantics", () => {
  it("publishes each source module's own content digest", async () => {
    const root = await createTestTempDirectory("rea-source-module-digest-");
    const source = "module.exports = 42;\n";
    await writeFixtureFiles(root, { "main.js": source });

    const { graph } = await reconstructJavaScriptFixture(root);
    const sourceModule = findSourceModule(graph, "main.js");
    const digest = createHash("sha256").update(source).digest("hex");

    expect(
      sourceModule?.observations.find(
        ({ properties }) => properties.semantic_role === "source-module",
      )?.properties,
    ).toMatchObject({ source_sha256: digest });
  });

  it("keeps whole type-only declarations out of runtime module relationships", async () => {
    const root = await createTestTempDirectory("rea-type-module-links-");
    await writeFixtureFiles(root, {
      "main.ts": `
        import type { Whole } from "./whole";
        export type { Remote } from "./remote";
        import { type Inline } from "./inline";
        export type LocalType = string;
        export interface LocalInterface { value: string }
      `,
      "whole.ts": "export interface Whole { value: string }",
      "remote.ts": "export interface Remote { value: string }",
      "inline.ts": "export interface Inline { value: string }",
    });

    const { graph } = await reconstructJavaScriptFixture(root);
    const source = findSourceModule(graph, "main.ts");
    const sourceProperties = source?.observations.find(
      ({ properties }) => properties.semantic_role === "source-module",
    )?.properties;

    expect(sourceProperties).toMatchObject({
      import_relationships: 0,
      type_relationships: 5,
      export_names: [],
      type_export_names: ["LocalInterface", "LocalType", "Remote"],
    });
    expect(
      graph.edges.filter(
        ({ relation, properties }) =>
          relation === "imports" &&
          ["./whole", "./remote"].includes(String(properties.specifier)),
      ),
    ).toEqual([]);
    expect(
      graph.edges.find(
        ({ source_node_id, relation, properties }) =>
          source_node_id === source?.node_id &&
          relation === "imports" &&
          properties.kind === "static-import" &&
          properties.specifier === "./inline",
      ),
    ).toBeDefined();
    expect(
      source?.observations
        .flatMap(({ evidence }) => evidence.limitations)
        .join(" "),
    ).toContain(
      "inline type-only imports or re-exports may preserve a module side-effect dependency",
    );
    expect(findExportNode(graph, "main.ts", "LocalType")).toBeUndefined();
    expect(findExportNode(graph, "main.ts", "LocalInterface")).toBeUndefined();
  });

  it("uses emitted TypeScript loader semantics without changing dynamic imports", async () => {
    const root = await createTestTempDirectory("rea-cts-module-loader-");
    await writeFixtureFiles(root, {
      "package.json": '{"type":"module"}',
      "main.cts": `
        import local = require("./local");
        import selected from "conditional";
        export { retained } from "conditional";
        void import("conditional");
        void local;
        void selected;
      `,
      "consumer.mts": `
        import local = require("./local");
        export { local };
      `,
      "local.js": "module.exports = 42;",
      "node_modules/conditional/package.json": JSON.stringify({
        exports: {
          ".": {
            import: "./esm.mjs",
            require: "./cjs.cjs",
          },
        },
      }),
      "node_modules/conditional/esm.mjs": "export const retained = 'esm';",
      "node_modules/conditional/cjs.cjs": "exports.retained = 'cjs';",
    });

    const { graph } = await reconstructJavaScriptFixture(root);
    const localRequireEdge = (sourcePath: string) => {
      const source = findSourceModule(graph, sourcePath);
      return graph.edges.find(
        ({ source_node_id, relation, properties }) =>
          source_node_id === source?.node_id &&
          relation === "imports" &&
          properties.module_link_kind === "require" &&
          properties.specifier === "./local",
      );
    };

    expect(
      findSourceModule(graph, "main.cts")?.observations[0]?.properties,
    ).toMatchObject({ module_format: "commonjs" });
    expect(localRequireEdge("main.cts")).toMatchObject({
      properties: { resolved_path: "local.js", local_name: "local" },
    });
    expect(
      findRelationshipEdge(graph, {
        kind: "import",
        specifier: "conditional",
        resolvedPath: "node_modules/conditional/cjs.cjs",
        localName: "selected",
      }),
    ).toBeDefined();
    expect(
      findRelationshipEdge(graph, {
        kind: "re-export",
        specifier: "conditional",
        resolvedPath: "node_modules/conditional/cjs.cjs",
      }),
    ).toBeDefined();
    expect(
      graph.edges.find(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.kind === "dynamic-import" &&
          properties.specifier === "conditional",
      ),
    ).toMatchObject({
      properties: {
        resolved_path: "node_modules/conditional/esm.mjs",
      },
    });
    expect(
      findSourceModule(graph, "consumer.mts")?.observations[0]?.properties,
    ).toMatchObject({ module_format: "esm" });
    expect(localRequireEdge("consumer.mts")).toMatchObject({
      properties: { resolved_path: "local.js", local_name: "local" },
    });
  });
});

describe("JavaScript module relationships", () => {
  it("composes bindings, re-exports, dynamic imports, and JSON modules", async () => {
    const root = await moduleFixture();
    const first = await reconstructJavaScriptFixture(root);
    const second = await reconstructJavaScriptFixture(root);
    const graph = first.graph;

    expect(second.graph).toEqual(graph);
    expect(findSourceModule(graph, "main.cjs")).toBeDefined();
    expect(findSourceModule(graph, "consumer.mjs")).toBeDefined();
    expect(findSourceModule(graph, "dependency.mjs")).toBeDefined();

    expect(
      findRelationshipEdge(graph, {
        kind: "require",
        specifier: "./dependency.mjs",
        resolvedPath: "dependency.mjs",
        importedName: "value",
        localName: "importedValue",
      }),
    ).toBeDefined();
    expect(
      graph.edges.filter(
        ({ relation, properties }) =>
          relation === "imports" && properties.specifier === "fixture-package",
      ),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({ resolved_path: null }),
        }),
      ]),
    );
    expect(
      findRelationshipEdge(graph, {
        kind: "require",
        specifier: "fixture-package",
        resolvedPath: "node_modules/fixture-package/cjs.cjs",
        localName: "packageValue",
      }),
    ).toBeDefined();
    expect(
      findRelationshipEdge(graph, {
        kind: "import",
        specifier: "fixture-package",
        resolvedPath: "node_modules/fixture-package/esm.mjs",
        importedName: "default",
        localName: "packageDefault",
      }),
    ).toBeDefined();
    expect(
      findRelationshipEdge(graph, {
        kind: "import",
        specifier: "./values.js",
        resolvedPath: "values.js",
        importedName: "value",
        localName: "alias",
      }),
    ).toBeDefined();
    expect(
      findRelationshipEdge(graph, {
        kind: "re-export",
        specifier: "./star.js",
        resolvedPath: "star.js",
        importedName: "*",
        exportedName: "*",
      }),
    ).toBeDefined();

    const forwarded = findExportNode(graph, "main.cjs", "forwarded");
    expect(forwarded).toBeDefined();
    expect(
      graph.edges.some(
        ({ source_node_id, relation, properties }) =>
          source_node_id === forwarded?.node_id &&
          relation === "imports" &&
          properties.resolved_path === "dependency.mjs" &&
          properties.imported_name === "value",
      ),
    ).toBe(true);

    expect(
      graph.edges.find(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.kind === "dynamic-import" &&
          properties.resolved_path === "lazy.js",
      ),
    ).toMatchObject({
      source_node_id: findSourceModule(graph, "consumer.mjs")?.node_id,
    });

    expect(
      findRelationshipEdge(graph, {
        kind: "require",
        specifier: "./data.json",
        resolvedPath: "data.json",
      })?.properties,
    ).toMatchObject({
      target_file_kind: "json",
      target_json_status: "included",
    });
    expect(
      findRelationshipEdge(graph, {
        kind: "require",
        specifier: "./broken.json",
        resolvedPath: "broken.json",
      })?.properties,
    ).toMatchObject({
      target_file_kind: "json",
      target_json_status: "invalid",
    });
    expect(
      findRelationshipEdge(graph, {
        kind: "require",
        specifier: "electron",
      })?.properties,
    ).toMatchObject({ resolution_status: "external", resolved_path: null });
    expect(
      graph.edges.find(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.kind === "require" &&
          properties.specifier === null,
      )?.properties,
    ).toMatchObject({ resolved_path: null });

    expect(first.statistics.parse_failures).toBe(1);
    expect(graph.coverage).toMatchObject({
      status: "partial",
      truncated: false,
    });
    expect(graph.limitations.join(" ")).toMatch(/incomplete/iu);
  });
});

describe("Compiler-dependent TypeScript resolution", () => {
  it("retains only compiler-independent targets for .ts static imports", async () => {
    const root = await createTestTempDirectory("rea-ts-conditional-loader-");
    await writeFixtureFiles(root, {
      "package.json": '{"type":"commonjs"}',
      "main.ts": `import { value as different } from "different";
import { value as same } from "same";
void different; void same;`,
      "node_modules/different/package.json": JSON.stringify({
        exports: {
          ".": {
            import: "./import.mjs",
            require: "./require.cjs",
          },
        },
      }),
      "node_modules/different/import.mjs": "export const value = 'import';",
      "node_modules/different/require.cjs": "exports.value = 'require';",
      "node_modules/same/package.json": JSON.stringify({
        exports: { ".": { import: "./shared.js", require: "./shared.js" } },
      }),
      "node_modules/same/shared.js": "export const value = 'shared';",
    });

    const { graph } = await reconstructJavaScriptFixture(root);
    const different = findRelationshipEdge(graph, {
      kind: "import",
      specifier: "different",
      localName: "different",
    });
    const same = findRelationshipEdge(graph, {
      kind: "import",
      specifier: "same",
      localName: "same",
      resolvedPath: "node_modules/same/shared.js",
    });
    const staticFinding = (specifier: string) =>
      graph.edges.find(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.kind === "static-import" &&
          properties.specifier === specifier,
      );

    expect(
      findSourceModule(graph, "main.ts")?.observations[0]?.properties,
    ).toMatchObject({ module_format: "unknown" });
    expect(different).toMatchObject({
      properties: {
        resolution_mode: "compiler-dependent",
        resolution_status: "unavailable",
        resolved_path: null,
        conditional_resolutions: [
          {
            mode: "import",
            resolution_status: "resolved",
            resolved_path: "node_modules/different/import.mjs",
          },
          {
            mode: "require",
            resolution_status: "resolved",
            resolved_path: "node_modules/different/require.cjs",
          },
        ],
      },
    });
    expect(same).toMatchObject({
      properties: {
        resolution_mode: "compiler-dependent",
        resolved_path: "node_modules/same/shared.js",
        resolution_status: "resolved",
      },
      evidence: {
        limitations: expect.arrayContaining([
          expect.stringContaining(
            "compiler-dependent without retained compiler options",
          ),
        ]),
      },
    });
    expect(staticFinding("different")).toMatchObject({
      properties: {
        resolution_mode: "compiler-dependent",
        resolution_status: "unavailable",
        conditional_resolutions: [
          {
            mode: "import",
            resolved_path: "node_modules/different/import.mjs",
          },
          {
            mode: "require",
            resolved_path: "node_modules/different/require.cjs",
          },
        ],
      },
      evidence: {
        limitations: expect.arrayContaining([
          expect.stringContaining(
            "compiler-dependent without retained compiler options",
          ),
        ]),
      },
    });
    expect(staticFinding("same")).toMatchObject({
      properties: { resolved_path: "node_modules/same/shared.js" },
      evidence: {
        limitations: expect.arrayContaining([
          expect.stringContaining(
            "compiler-dependent without retained compiler options",
          ),
        ]),
      },
    });
  });
});

it("does not assign one module origin to an export with colliding path encodings", async () => {
  const root = await createTestTempDirectory("rea-ambiguous-module-origin-");
  await writeFixtureFiles(root, {
    "index.js": String.raw`
        import * as ns from "./fixture.js";
        const selected = choice ? ns["a\0b"] : ns.a.b;
        export { selected };
      `,
    "fixture.js": "export const fixture = true;\n",
  });
  const { graph } = await reconstructJavaScriptFixture(root);
  const applicationGraph = parseJavaScriptApplicationGraph(
    JSON.parse(JSON.stringify(graph)),
  );
  const selectedExport = findExportNode(
    applicationGraph,
    "index.js",
    "selected",
  );
  if (selectedExport === undefined)
    throw new Error("Expected the selected export node");

  expect(
    applicationGraph.edges.filter(
      ({ relation, source_node_id, properties }) =>
        relation === "imports" &&
        source_node_id === selectedExport.node_id &&
        properties.local_name === "selected",
    ),
  ).toEqual([]);
});

describe("complete static application projections", () => {
  it("retains exports and JSON keys beyond the former projection prefix", async () => {
    const root = await moduleFixture();
    const exportNames = Array.from(
      { length: 140 },
      (_, index) =>
        `export const retained_${String(index).padStart(3, "0")} = ${index};`,
    );
    const jsonKeys = Object.fromEntries(
      Array.from({ length: 140 }, (_, index) => [`key_${index}`, index]),
    );
    await Promise.all([
      writeFile(join(root, "many-exports.mjs"), exportNames.join("\n")),
      writeFile(join(root, "many.json"), JSON.stringify(jsonKeys)),
    ]);

    const { graph } = await reconstructJavaScriptFixture(root);
    const module = findSourceModule(graph, "many-exports.mjs");
    const exportObservation = module?.observations.find(
      ({ properties }) => properties.semantic_role === "source-module",
    );
    const json = graph.nodes.find((node) =>
      node.observations.some(
        ({ properties }) => properties.path === "many.json",
      ),
    );
    const jsonObservation = json?.observations.find(
      ({ properties }) => properties.path === "many.json",
    );

    expect(exportObservation?.properties.export_names).toHaveLength(140);
    expect(exportObservation?.properties.omitted_export_names).toBe(0);
    expect(jsonObservation?.properties.json_top_level_keys).toHaveLength(140);
    expect(jsonObservation?.properties.omitted_json_top_level_keys).toBe(0);
  });
});

const moduleFixture = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-module-relationships-");
  await writeFixtureFiles(root, {
    "package.json": '{"main":"main.cjs"}',
    "main.cjs": `
        const { value: importedValue } = require("./dependency.mjs");
        const data = require("./data.json");
        const broken = require("./broken.json");
        const electron = require("electron");
        const packageValue = require("fixture-package");
        module.exports.forwarded = importedValue;
        exports.data = data;
        exports.broken = broken;
        exports.electron = electron;
        exports.packageValue = packageValue;
        require(dynamicName);
      `,
    "dependency.mjs": `
        export { value } from "./values.js";
        export * from "./star.js";
      `,
    "consumer.mjs": `
        import { value as alias } from "./values.js";
        import packageDefault from "fixture-package";
        export { alias as relayed };
        void import("./lazy.js");
        void packageDefault;
      `,
    "values.js": "export const value = 42;",
    "star.js": "export const extra = true;",
    "lazy.js": "export default 'lazy';",
    "data.json": '{"name":"fixture","value":42}',
    "broken.json": '{"name":',
    "node_modules/fixture-package/package.json": JSON.stringify({
      exports: {
        ".": {
          import: "./esm.mjs",
          require: "./cjs.cjs",
        },
      },
    }),
    "node_modules/fixture-package/esm.mjs": "export default 'esm';",
    "node_modules/fixture-package/cjs.cjs": "module.exports = 'cjs';",
  });
  return root;
};
