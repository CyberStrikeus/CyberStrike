import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/workspace/writeFixtureFiles.js";

const createPackageSubpathFixture = async () => {
  const root = await createTestTempDirectory("rea-package-subpaths-");
  const source = [
    'const {BrowserWindow} = require("electron"); const nearest = require("fixture/parser");',
    'const nested = require("nested/parser");',
    'const parser = require("exported/parser");',
    'const directory = require("exported/parser/");',
    'const hidden = require("exported/hidden");',
    'const missing = require("exported/missing");',
    'new BrowserWindow({webPreferences:{preload:"exported/parser"}});',
    'const file = require("fixture");',
    'const packageDirectory = require("fixture/");',
    'const selected = require("@scope/selected");',
    'const blocked = require("blocked");',
    'const literal = require("fi%xture");',
    'const scalar = require("scalar");',
    'const self = require("../node_modules/fi%xture/run.cjs");',
    'const uri = require("file:///src/uri-dep.cjs");',
    'const relativeUri = require("./uri-dep.cjs");',
  ].join("\n");
  const selfSource = 'const self = require("fi%xture"); module.exports = self;';
  const importSource = [
    'import literal from "fi%xture";',
    'import uri from "FILE:///src/uri-dep.cjs?token=%2F#entry";',
  ].join("\n");
  const files = {
    "src/main.cjs": source,
    "src/imports.mjs": importSource,
    "src/uri-dep.cjs": "module.exports = 42;",
    "src/node_modules/fixture/parser.js": "module.exports = 1;",
    "src/node_modules/fixture.js": "module.exports = 'file';",
    "src/node_modules/fixture/index.js": "module.exports = 'directory';",
    "node_modules/fixture/package.json": "{}",
    "node_modules/fixture/parser.js": "module.exports = 2;",
    "node_modules/nested/package.json": "{}",
    "node_modules/nested/parser/package.json": JSON.stringify({
      main: "./entry.js",
      exports: "./decoy.js",
    }),
    "node_modules/nested/parser/entry.js": "module.exports = 3;",
    "node_modules/nested/parser/index.js": "module.exports = 4;",
    "node_modules/nested/parser/decoy.js": "module.exports = 5;",
    "node_modules/exported/package.json": JSON.stringify({
      exports: {
        "./parser": "./parser.cjs",
        "./parser/": "./parser.cjs",
        "./missing": "./missing.cjs",
      },
    }),
    "node_modules/exported/parser.cjs": "module.exports = 6;",
    "node_modules/exported/hidden.js": "module.exports = 7;",
    "node_modules/exported/missing/index.js": "module.exports = 8;",
    "node_modules/@scope/selected.js": "module.exports = 'sibling';",
    "node_modules/@scope/selected/package.json": JSON.stringify({
      exports: { require: "./actual.cjs" },
    }),
    "node_modules/@scope/selected/actual.cjs": "module.exports = 'export';",
    "node_modules/blocked.js": "module.exports = 'sibling';",
    "node_modules/blocked/package.json": JSON.stringify({
      exports: { ".": null },
    }),
    "node_modules/fi%xture.js": "module.exports = 'literal sibling';",
    "node_modules/fi%xture/package.json": JSON.stringify({
      name: "fi%xture",
      exports: "./actual.cjs",
      main: "./legacy.cjs",
    }),
    "node_modules/fi%xture/actual.cjs": "module.exports = 'export';",
    "node_modules/fi%xture/legacy.cjs": "module.exports = 'legacy';",
    "node_modules/fi%xture/run.cjs": selfSource,
    "node_modules/scalar.js": "module.exports = 'scalar sibling';",
    "node_modules/scalar/package.json": JSON.stringify({ exports: false }),
  };
  await writeFixtureFiles(root, files);
  return { root, source, selfSource, importSource };
};

cliTest.for(["CLI", "stdio MCP"] as const)(
  "resolves package subpaths with source provenance through %s",
  async (surface, { cli }) => {
    const { root, source, selfSource, importSource } =
      await createPackageSubpathFixture();
    const nativeRequire = createRequire(join(root, "src/main.cjs"));
    const expectedTargets = {
      "fixture/parser": "src/node_modules/fixture/parser.js",
      fixture: "src/node_modules/fixture.js",
      "fixture/": "src/node_modules/fixture/index.js",
      "nested/parser": "node_modules/nested/parser/entry.js",
      "exported/parser": "node_modules/exported/parser.cjs",
      "@scope/selected": "node_modules/@scope/selected/actual.cjs",
      "fi%xture": "node_modules/fi%xture.js",
      scalar: "node_modules/scalar.js",
      "../node_modules/fi%xture/run.cjs": "node_modules/fi%xture/run.cjs",
      "./uri-dep.cjs": "src/uri-dep.cjs",
    };
    for (const [specifier, target] of Object.entries(expectedTargets))
      expect(
        relative(root, nativeRequire.resolve(specifier)).replaceAll("\\", "/"),
      ).toBe(target);
    expect(nativeRequire("./uri-dep.cjs")).toBe(42);
    for (const specifier of [
      "file:///src/uri-dep.cjs",
      pathToFileURL(join(root, "src/uri-dep.cjs")).href,
    ])
      expect(() => nativeRequire.resolve(specifier)).toThrow(
        expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
      );
    for (const specifier of ["exported/parser/", "exported/hidden", "blocked"])
      expect(() => nativeRequire.resolve(specifier)).toThrow(
        expect.objectContaining({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }),
      );
    expect(() => nativeRequire.resolve("exported/missing")).toThrow(
      expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
    );
    const selfPath = "node_modules/fi%xture/run.cjs";
    expect(
      relative(
        root,
        createRequire(join(root, selfPath)).resolve("fi%xture"),
      ).replaceAll("\\", "/"),
    ).toBe("node_modules/fi%xture/actual.cjs");

    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(graph.coverage.status).toBe("complete");
    const requireFileUrl = graph.edges.find(
      ({ properties }) =>
        properties.module_link_kind === "require" &&
        properties.specifier === "file:///src/uri-dep.cjs",
    );
    expect(requireFileUrl?.evidence.limitations.length).toBeGreaterThan(0);
    const imports = graph.edges.filter(
      ({ properties }) => properties.module_link_kind === "require",
    );
    for (const observation of [
      { sourcePath: "src/main.cjs", source, targets: expectedTargets },
      {
        sourcePath: selfPath,
        source: selfSource,
        targets: { "fi%xture": "node_modules/fi%xture/actual.cjs" },
      },
    ])
      expectResolvedImports(imports, observation);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        relation: "imports",
        properties: expect.objectContaining({
          module_link_kind: "require",
          specifier: "file:///src/uri-dep.cjs",
          resolved_path: null,
          resolution_status: "external",
        }),
        evidence: sourceEvidence("src/main.cjs", source),
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        relation: "imports",
        properties: expect.objectContaining({
          kind: "require",
          specifier: "file:///src/uri-dep.cjs",
          resolved_path: null,
        }),
        evidence: sourceEvidence("src/main.cjs", source),
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        relation: "imports",
        properties: expect.objectContaining({
          module_link_kind: "import",
          specifier: "FILE:///src/uri-dep.cjs?token=%2F#entry",
          resolved_path: null,
          resolution_status: "unavailable",
        }),
        evidence: sourceEvidence("src/imports.mjs", importSource),
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          module_link_kind: "import",
          specifier: "fi%xture",
          resolved_path: null,
          resolution_status: "rejected",
        }),
        evidence: sourceEvidence("src/imports.mjs", importSource),
      }),
    );
    for (const [specifier, status] of [
      ["exported/parser/", "external"],
      ["exported/hidden", "external"],
      ["exported/missing", "not-found"],
      ["blocked", "external"],
    ])
      expect(imports).toContainEqual(
        expect.objectContaining({
          properties: expect.objectContaining({
            specifier,
            resolved_path: null,
            resolution_status: status,
          }),
        }),
      );
    const preloads = graph.nodes.filter(
      ({ kind }) => kind === "electron-preload",
    );
    expect(preloads).toHaveLength(1);
    expect(preloads[0]?.identity).toMatchObject({
      key: "electron-preload:module-specifier:node_modules/exported/parser.cjs",
    });
    expect(preloads[0]?.observations.length).toBeGreaterThan(0);
    for (const observation of preloads[0]?.observations ?? [])
      expect(observation).toMatchObject({
        properties: {
          declared_path: "exported/parser",
          resolution_context: "module-specifier",
          resolved_path: "node_modules/exported/parser.cjs",
        },
        evidence: {
          location: {
            available: true,
            value: { source: "src/main.cjs", start: { line: 7 } },
          },
        },
      });
  },
);

const expectResolvedImports = (
  imports: z.infer<
    typeof javascriptApplicationAnalysisResultSchema
  >["graph"]["edges"],
  observation: {
    readonly sourcePath: string;
    readonly source: string;
    readonly targets: Readonly<Record<string, string>>;
  },
): void => {
  for (const [specifier, target] of Object.entries(observation.targets))
    expect.soft(imports).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          specifier,
          resolved_path: target,
          resolution_status: "resolved",
        }),
        evidence: sourceEvidence(observation.sourcePath, observation.source),
      }),
    );
};

const sourceEvidence = (sourcePath: string, source: string): unknown =>
  expect.objectContaining({
    artifact: expect.objectContaining({
      available: true,
      sha256: createHash("sha256").update(source).digest("hex"),
    }),
    location: expect.objectContaining({
      available: true,
      value: expect.objectContaining({
        kind: "source-range",
        source: sourcePath,
      }),
    }),
  });
