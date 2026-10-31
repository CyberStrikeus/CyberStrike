import { createPackageWithOptions } from "@electron/asar";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createStrippedAsarAddon } from "../../fixtures/strippedAsarAddon.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import {
  findExportNode,
  findGraphEdge,
  findSourceModule,
  writeFixtureFiles,
} from "../../support/javascriptApplicationFixture.js";

cliTest(
  "keeps missing same-container package manifests unavailable until restored",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-missing-package-manifests-",
    );
    const sourceRoot = join(root, "source");
    const archive = join(root, "app.asar");
    const relativeManifest = '{"main":"public.js"}';
    const exportsManifest =
      '{"exports":{"import":"./import.js","require":"./require.js"}}';
    await writeFixtureFiles(sourceRoot, {
      "main.cjs": 'require("./relative");\nrequire("fixture");\n',
      "main.mjs": 'import "fixture";\n',
      "relative/package.json": relativeManifest,
      "relative/index.js": "export const fallback = true;\n",
      "relative/public.js": "export const publicEntry = true;\n",
      "node_modules/fixture/package.json": exportsManifest,
      "node_modules/fixture/index.js": "export const fallback = true;\n",
      "node_modules/fixture/import.js": "export const imported = true;\n",
      "node_modules/fixture/require.js": "module.exports = true;\n",
    });
    await createPackageWithOptions(sourceRoot, archive, {
      unpack: "package.json",
    });
    const unpacked = `${archive}.unpacked`;
    const relativeManifestPath = join(unpacked, "relative/package.json");
    const exportsManifestPath = join(
      unpacked,
      "node_modules/fixture/package.json",
    );
    await Promise.all([rm(relativeManifestPath), rm(exportsManifestPath)]);

    const analyze = async () => {
      const output = await cli.run({
        arguments: ["analyze-javascript-application", archive, "--json"],
      });
      expect(output.exitCode, output.stderr).toBe(0);
      return javascriptApplicationAnalysisResultSchema.parse(
        parseEvidence(output.json).normalized_result,
      );
    };
    const unavailable = await analyze();
    const cjs = findSourceModule(unavailable.graph, "main.cjs");
    const mjs = findSourceModule(unavailable.graph, "main.mjs");
    for (const [source, specifier] of [
      [cjs, "./relative"],
      [cjs, "fixture"],
      [mjs, "fixture"],
    ] as const)
      expect(
        unavailable.graph.edges.find(
          (edge) =>
            edge.source_node_id === source?.node_id &&
            edge.properties.specifier === specifier,
        )?.properties,
      ).toMatchObject({
        resolution_status: "unavailable",
        resolved_path: null,
      });
    expect(unavailable.graph.coverage.status).toBe("partial");

    await Promise.all([
      writeFile(relativeManifestPath, relativeManifest),
      writeFile(exportsManifestPath, exportsManifest),
    ]);
    const restored = await analyze();
    for (const [sourcePath, specifier, target] of [
      ["main.cjs", "./relative", "relative/public.js"],
      ["main.cjs", "fixture", "node_modules/fixture/require.js"],
      ["main.mjs", "fixture", "node_modules/fixture/import.js"],
    ] as const)
      expect(
        restored.graph.edges.find(
          (edge) =>
            edge.source_node_id ===
              findSourceModule(restored.graph, sourcePath)?.node_id &&
            edge.properties.specifier === specifier,
        )?.properties,
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: target,
      });
  },
);

cliTest(
  "resolves ESM specifiers containing whitespace using URL text semantics",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-esm-whitespace-path-");
    const rawSpecifier = "./feature\tname.js";
    const encodedSpecifier = "./feature%09name.js";
    await writeFixtureFiles(root, {
      "main.mjs": `import ${JSON.stringify(rawSpecifier)};\nimport ${JSON.stringify(encodedSpecifier)};\n`,
      "featurename.js": "export const plain = 1;\n",
      "feature\tname.js": "export const value = 1;\n",
    });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(
      findGraphEdge(
        result.graph,
        findSourceModule(result.graph, "main.mjs"),
        findSourceModule(result.graph, "featurename.js"),
        "imports",
      )?.properties,
    ).toMatchObject({
      specifier: rawSpecifier,
      resolved_path: "featurename.js",
    });
    expect(
      findGraphEdge(
        result.graph,
        findSourceModule(result.graph, "main.mjs"),
        findSourceModule(result.graph, "feature\tname.js"),
        "imports",
      )?.properties,
    ).toMatchObject({
      specifier: encodedSpecifier,
      resolved_path: "feature\tname.js",
    });
  },
);

cliTest(
  "retains an inventoried native addon when its ASAR companion is missing",
  async ({ cli }) => {
    const { archive, addon } = await createStrippedAsarAddon();
    await rm(join(`${archive}.unpacked`, addon));
    const output = await cli.run({
      arguments: ["analyze-javascript-application", archive, "--json"],
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(result.graph.coverage.status).toBe("partial");
    expect(
      result.graph.nodes.some(
        (node) =>
          node.kind === "native-addon" &&
          node.observations.some(
            ({ label, properties }) =>
              label === addon && properties.availability === "unavailable",
          ),
      ),
    ).toBe(true);
  },
);

cliTest(
  "resolves emitted module imports without substituting Electron runtime paths",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-typescript-runtime-paths-");
    await writeFixtureFiles(root, {
      "package.json": JSON.stringify({ main: "main.ts" }),
      "main.ts": `import { BrowserWindow, utilityProcess } from "electron";
        import "./worker.js";
        import "./config.mjs";
        import "./legacy.cjs";
        import "./view.js";
        import "./runtime.js";
        const win = new BrowserWindow({webPreferences:{preload:"./worker.js"}});
        win.loadURL("./renderer.js");
        utilityProcess.fork("./worker.js");
        utilityProcess.fork("./runtime.js");
        throw new Error("source must stay inert");`,
      "worker.ts": "export const worker = 1;",
      "config.mts": "export const config = 1;",
      "legacy.cts": "export const legacy = 1;",
      "view.tsx": "export const view = <div />;",
      "renderer.ts": "export const renderer = 1;",
      "runtime.ts": "export const source = 1;",
      "runtime.js": "throw new Error('runtime must stay inert');",
    });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    const { graph } = result;
    const source = findSourceModule(graph, "main.ts");
    for (const [specifier, target] of [
      ["./worker.js", "worker.ts"],
      ["./config.mjs", "config.mts"],
      ["./legacy.cjs", "legacy.cts"],
      ["./view.js", "view.tsx"],
      ["./runtime.js", "runtime.js"],
    ] as const)
      expect(
        findGraphEdge(graph, source, findSourceModule(graph, target), "imports")
          ?.properties,
      ).toMatchObject({ specifier, resolved_path: target });
    expect(result.summary).toMatchObject({
      utility_processes: 2,
      resolved_utility_entrypoints: 1,
    });
    expect(
      graph.edges.find(
        (edge) =>
          edge.evidence.extractor.operation ===
          "associate-browser-window-preload",
      )?.properties,
    ).toMatchObject({
      declared_path: "./worker.js",
      resolved_path: null,
      resolution_status: "not-found",
    });
    expect(
      graph.edges
        .filter(
          (edge) =>
            edge.properties.declared_path === "./worker.js" ||
            edge.properties.declared_path === "./renderer.js",
        )
        .some((edge) => edge.properties.resolved_path != null),
    ).toBe(false);
  },
);

cliTest(
  "returns literal self-import evidence while preserving sibling imports and self-re-exports",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-self-import-");
    await writeFixtureFiles(root, {
      "a.js":
        'import "./a.js";\nexport const value = 1;\nexport { value as forwarded } from "./a.js";\n',
      "b.js": 'import { value } from "./a.js";\nconsole.log(value);\n',
    });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode).toBe(0);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    const { graph } = result;
    expect(
      graph.edges.filter((edge) => edge.source_node_id === edge.target_node_id),
    ).toEqual([]);
    expect(graph.limitations).toContainEqual(
      expect.stringMatching(/^1 import specifier .*was omitted;/u),
    );
    expect(result.limitations).toEqual(
      expect.arrayContaining(graph.limitations),
    );
    const source = findSourceModule(graph, "a.js");
    expect(source).toBeDefined();
    expect(
      findGraphEdge(graph, findSourceModule(graph, "b.js"), source, "imports")
        ?.properties,
    ).toMatchObject({
      specifier: "./a.js",
      resolution_status: "resolved",
    });
    expect(
      findGraphEdge(
        graph,
        findExportNode(graph, "a.js", "forwarded"),
        source,
        "imports",
      )?.properties,
    ).toMatchObject({
      specifier: "./a.js",
      resolution_status: "resolved",
    });
    expect(
      graph.edges.find(
        (edge) =>
          edge.source_node_id === source?.node_id &&
          edge.properties.kind === "static-import" &&
          edge.properties.specifier === "./a.js" &&
          edge.evidence.location.available &&
          edge.evidence.location.value.kind === "source-range" &&
          edge.evidence.location.value.start.line === 1,
      )?.evidence.location,
    ).toMatchObject({
      available: true,
      value: { kind: "source-range", source: "a.js", start: { line: 1 } },
    });
  },
);

cliTest(
  "discloses CommonJS and TypeScript self-imports including emitted-name rewrites",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-self-require-");
    await writeFixtureFiles(root, {
      "c.cjs": 'const self = require("./c.cjs");\nmodule.exports = self;\n',
      "util.ts":
        'import "./util.ts";\nimport "./util.js";\nexport const value = 1;\n',
    });
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode).toBe(0);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    const { graph } = result;
    expect(
      graph.edges.filter((edge) => edge.source_node_id === edge.target_node_id),
    ).toEqual([]);
    // ./util.ts is a literal self-import and ./util.js resolves under NodeNext
    // emitted-name semantics back to util.ts itself, as ./c.cjs does for CJS.
    expect(graph.limitations).toContainEqual(
      expect.stringMatching(/^3 import specifiers .*were omitted;/u),
    );
    expect(result.limitations).toEqual(
      expect.arrayContaining(graph.limitations),
    );
    for (const [path, specifier] of [
      ["c.cjs", "./c.cjs"],
      ["util.ts", "./util.ts"],
    ] as const) {
      const source = findSourceModule(graph, path);
      expect(source).toBeDefined();
      expect(
        graph.edges.find(
          (edge) =>
            edge.source_node_id === source?.node_id &&
            edge.properties.specifier === specifier &&
            edge.properties.resolved_path === path,
        )?.evidence.location,
      ).toMatchObject({
        available: true,
        value: { kind: "source-range", source: path, start: { line: 1 } },
      });
      expect(
        graph.nodes.some((node) =>
          node.observations.some(
            ({ properties }) =>
              properties.semantic_role === "module-reference" &&
              properties.declared_specifier === specifier,
          ),
        ),
      ).toBe(false);
    }
    expect(
      graph.edges.some(
        (edge) =>
          edge.properties.specifier === "./util.js" &&
          (edge.properties.module_link_kind === "import" ||
            edge.properties.resolution_status === "not-found"),
      ),
    ).toBe(false);
    expect(
      graph.nodes.some((node) =>
        node.observations.some(
          ({ properties }) =>
            properties.semantic_role === "module-reference" &&
            properties.declared_specifier === "./util.js",
        ),
      ),
    ).toBe(false);
  },
);
