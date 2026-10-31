import {
  primitiveCandidateExpansionExpression,
  primitiveByteExpansionSource,
} from "../../../fixtures/javascriptPrimitiveExpansion.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackageWithOptions } from "@electron/asar";
import { expect, it } from "vitest";
import { AnalysisError } from "../../../../src/domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import {
  reconstructJavaScriptArtifact,
  readJavaScriptArtifactFiles,
} from "../../../support/javascriptApplicationScope.js";
import { analyzeAndAdoptJavaScriptArtifactFiles } from "../../../../src/application/javascript/JavaScriptArtifactAnalysis.js";
import {
  analyzeArtifactFiles,
  withArtifactFileAnalyzer,
} from "../../../fixtures/javascriptArtifactAnalysis.js";
import type { JavaScriptAnalyzedSource } from "../../../../src/domain/javascript/javascriptSourceAnalysis.js";
import { immutableArtifactGraph } from "../../../fixtures/javascriptArtifactGraph.js";
import { createJavaScriptSemanticGraphProjection } from "../../../../src/application/javascript/JavaScriptSemanticGraphBuilder.js";
import type { JavaScriptModuleSemanticIr } from "../../../../src/domain/javascript/javascriptModuleSemanticIr.js";
import type { JavaScriptStaticAnalysis } from "../../../../src/domain/javascript/javascriptStaticAnalysisTypes.js";
import { analyzeJavaScriptStaticSource } from "../../../../src/domain/javascript/javascriptStaticAnalysis.js";
import type { JavaScriptArtifactFile } from "../../../../src/domain/javascript/javascriptArtifactFiles.js";
import { completeJavaScriptAnalysisSteps } from "../../../../src/application/javascript/JavaScriptAnalysisControl.js";
import { buildImmutableJavaScriptArtifactGraphSteps } from "../../../../src/application/javascript/JavaScriptArtifactGraphBuilder.js";
import {
  writeJavaScriptAnalysisTransfer,
  readJavaScriptAnalysisTransfer,
} from "../../../../src/javascript/analysis/JavaScriptAnalysisTransfer.js";
import { javaScriptWorkerStaticAnalysisSchema } from "../../../../src/javascript/analysis/JavaScriptAnalysisWorkerSchemas.js";
import { createJavaScriptArtifactReader } from "../../../../src/artifacts/javascript/JavaScriptArtifactReader.js";
import { createJavaScriptSourceAnalysis } from "../../../../src/artifacts/javascript/JavaScriptSourceAnalysis.js";
import {
  scanCanonicalArtifactInventory,
  withArtifactResourceScope,
  scanArtifactInventory,
} from "../../../fixtures/artifactInventory.js";
import {
  parseJavaScriptApplicationGraph,
  type JavaScriptApplicationGraph,
} from "../../../../src/domain/javascript/javascriptApplicationGraph.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import {
  createJavaScriptSemanticGraph,
  isValidatedImmutableJavaScriptSemanticGraph,
  javaScriptSemanticGraphSchema,
  type JavaScriptSemanticGraph,
} from "../../../../src/domain/javascript/javascriptSemanticGraph.js";
import { writeJavaScriptArtifactFixture } from "../../../fixtures/javascriptArtifactApplication.js";
import { writeFixtureFiles } from "../../../support/javascriptApplicationFixture.js";

it("does not let a known-absent optional import erase another application's page", async () => {
  const root = await createTestTempDirectory("rea-absent-optional-owner-");
  await writeFixtureFiles(root, {
    "a/package.json": JSON.stringify({ main: "main.cjs" }),
    "b/package.json": JSON.stringify({ main: "main.cjs" }),
    "a/main.cjs":
      'const {BrowserWindow} = require("electron"); const w = new BrowserWindow(); w.loadFile("index.html");',
    "b/main.cjs": 'try { require("./optional.cjs"); } catch {}',
    "a/index.html": "valid page",
    "index.html": "root decoy",
  });
  const result = await reconstructJavaScriptArtifact({
    input_path: root,
    format: "directory",
  });
  const role = result.graph.nodes.find(
    ({ kind }) => kind === "electron-renderer",
  );
  expect(role?.observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({
          resolved_path: "a/index.html",
          resolution_status: "resolved",
        }),
      }),
    ]),
  );
  expect(
    result.graph.edges.filter(
      ({ source_node_id, relation }) =>
        source_node_id === role?.node_id && relation === "maps_to",
    ),
  ).toHaveLength(1);
});

it.each([
  "unselected",
  "unavailable",
  "dynamic",
  "unavailable-json",
  "unavailable-package-json",
  "unavailable-uppercase-json",
  "unavailable-main",
  "unavailable-default-main",
  "unavailable-json-main",
  "resolved-html",
  "resolved-uppercase-json",
  "resolved-json",
  "resolved-package-json",
  "resolved-html-main",
  "unavailable-package-metadata",
  "unavailable-directory-main",
] as const)(
  "distinguishes hidden imports from inert data through %s",
  async (omission) => {
    const root = await createTestTempDirectory("rea-competing-gap-");
    const targetPaths: Partial<Record<typeof omission, string>> = {
      "unavailable-default-main": "b/index.js",
      "unavailable-json-main": "b/config.json",
      "unavailable-main": "b/main.cjs",
      "unavailable-json": "b/config.json",
      "unavailable-package-json": "b/node_modules/pkg/package.json",
      "unavailable-uppercase-json": "shared/bridge.JSON",
      "resolved-html": "shared/bridge.html",
      "resolved-uppercase-json": "shared/bridge.JSON",
      "resolved-json": "b/config.json",
      "resolved-package-json": "b/node_modules/pkg/package.json",
      "resolved-html-main": "b/main.html",
      "unavailable-package-metadata": "b/node_modules/pkg/package.json",
      "unavailable-directory-main": "b/node_modules/pkg/package.json",
    };
    const targetPath = targetPaths[omission] ?? "shared/bridge.cjs";
    const inertJson = [
      "unavailable-json",
      "unavailable-package-json",
      "unavailable-json-main",
      "resolved-json",
      "resolved-package-json",
    ].includes(omission);
    await writeFixtureFiles(root, {
      "a/package.json": JSON.stringify({ main: "main.cjs" }),
      "b/package.json": JSON.stringify(
        omission === "unavailable-default-main"
          ? {}
          : {
              main:
                omission === "unavailable-directory-main"
                  ? "node_modules/pkg"
                  : omission === "resolved-html-main"
                    ? "main.html"
                    : omission === "unavailable-json-main"
                      ? "config.json"
                      : "main.cjs",
            },
      ),
      "b/index.js": 'require("../shared/window.cjs");',
      "b/main.html": 'require("../shared/window.cjs");',
      "a/main.cjs": 'require("../shared/window.cjs");',
      "b/main.cjs":
        omission === "unavailable-package-metadata"
          ? 'require("pkg");'
          : omission === "unavailable-main"
            ? 'require("../shared/window.cjs");'
            : omission === "dynamic"
              ? "require(process.env.CHILD);"
              : `require(${JSON.stringify(targetPath.startsWith("b/") ? `./${targetPath.slice(2)}` : `../${targetPath}`)});`,
      "b/config.json": "{}",
      "b/node_modules/pkg/package.json": "{}",
      "b/node_modules/pkg/index.js": 'require("../../../shared/window.cjs");',
      "shared/bridge.JSON": 'require("./window.cjs");',
      "shared/bridge.html": 'require("./window.cjs");',
      "shared/bridge.cjs": 'require("./window.cjs");',
      "shared/window.cjs":
        'const {BrowserWindow} = require("electron"); const w = new BrowserWindow(); w.loadFile("index.html");',
      "a/index.html": "wrong unique owner",
      "b/index.html": "competing owner",
      "index.html": "root decoy",
    });
    const snapshot = await scanCanonicalArtifactInventory(root, {});
    const reader = createJavaScriptArtifactReader(root, "directory");
    try {
      const files = await readJavaScriptArtifactFiles(
        reader,
        snapshot,
        undefined,
        omission === "unselected"
          ? [
              "a/package.json",
              "b/package.json",
              "a/main.cjs",
              "b/main.cjs",
              "shared/window.cjs",
            ]
          : undefined,
      );
      const bridge = files.files.find(({ path }) => path === targetPath);
      if (bridge === undefined) throw new Error("Missing bridge");
      const partial = !omission.startsWith("unavailable")
        ? files
        : {
            ...files,
            files: files.files.filter(({ path }) => path !== bridge.path),
            unavailable_relevant_files: [
              ...files.unavailable_relevant_files,
              {
                path: bridge.path,
                container_sha256: bridge.container_sha256,
                sha256: null,
                bytes: null,
                inventory_artifact_id: bridge.inventory_artifact_id,
                kind: bridge.kind,
                hash_status: "unavailable" as const,
              },
            ],
          };
      const graph = await immutableArtifactGraph(
        snapshot,
        partial,
        (await analyzeArtifactFiles(partial)).analysis,
      );
      const roles = graph.nodes.filter(
        ({ kind }) => kind === "electron-renderer",
      );
      expect(roles).toHaveLength(1);
      expect(roles[0]?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              resolved_path: inertJson ? "a/index.html" : null,
              resolution_status: inertJson ? "resolved" : "unavailable",
            }),
          }),
        ]),
      );
      expect(
        graph.edges.filter(
          ({ source_node_id, relation }) =>
            source_node_id === roles[0]?.node_id && relation === "maps_to",
        ),
      ).toHaveLength(inertJson ? 1 : 0);
    } finally {
      await reader.close();
    }
  },
);

it.each(["unselected", "unavailable"] as const)(
  "keeps imported loadFile ownership unknown across an %s module",
  async (omission) => {
    const root = await createTestTempDirectory("rea-missing-module-owner-");
    await writeFixtureFiles(root, {
      "app/package.json": JSON.stringify({ main: "../shared/main.cjs" }),
      "shared/main.cjs": 'require("./window.cjs");',
      "shared/window.cjs":
        'const { BrowserWindow } = require("electron"); const win = new BrowserWindow(); win.loadFile("index.html");',
      "index.html": "artifact-root decoy",
      "app/index.html": "unproven application page",
    });
    const snapshot = await scanCanonicalArtifactInventory(root, {});
    const reader = createJavaScriptArtifactReader(root, "directory");
    try {
      const files = await readJavaScriptArtifactFiles(
        reader,
        snapshot,
        undefined,
        omission === "unselected"
          ? ["app/package.json", "shared/window.cjs"]
          : undefined,
      );
      const entry = files.files.find(({ path }) => path === "shared/main.cjs");
      if (entry === undefined) throw new Error("Missing inventoried entry");
      // The unavailable variant injects the reader boundary, not an actual I/O failure.
      const partial =
        omission === "unselected"
          ? files
          : {
              ...files,
              files: files.files.filter(({ path }) => path !== entry.path),
              unavailable_relevant_files: [
                ...files.unavailable_relevant_files,
                {
                  path: entry.path,
                  container_sha256: entry.container_sha256,
                  sha256: null,
                  bytes: null,
                  inventory_artifact_id: entry.inventory_artifact_id,
                  kind: entry.kind,
                  hash_status: "unavailable" as const,
                },
              ],
            };
      const graph = await immutableArtifactGraph(
        snapshot,
        partial,
        (await analyzeArtifactFiles(partial)).analysis,
      );
      const roles = graph.nodes.filter(
        ({ kind }) => kind === "electron-renderer",
      );
      expect(roles).toHaveLength(1);
      const role = roles[0];
      if (role === undefined) throw new Error("Missing renderer");
      expect(role.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              resolved_path: null,
              resolution_status: "unavailable",
            }),
          }),
        ]),
      );
      expect(
        graph.edges.filter(
          ({ source_node_id, relation }) =>
            source_node_id === role.node_id && relation === "maps_to",
        ),
      ).toEqual([]);
    } finally {
      await reader.close();
    }
  },
);

it("keeps imported loadFile ownership unknown across an application projection omission", async () => {
  const root = await createTestTempDirectory("rea-omitted-app-owner-");
  await writeFixtureFiles(root, {
    "app/package.json": JSON.stringify({ main: "../shared/main.cjs" }),
    "shared/main.cjs": 'require("./window.cjs");',
    "shared/window.cjs":
      'const { BrowserWindow } = require("electron"); const win = new BrowserWindow(); win.loadFile("index.html");',
    "index.html": "artifact-root decoy",
    "app/index.html": "unproven application page",
  });
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const entry = analysis.files.find(
      ({ file }) => file.path === "shared/main.cjs",
    );
    expect(
      entry?.javascript?.references.some(
        ({ specifier }) => specifier === "./window.cjs",
      ),
    ).toBe(true);
    // Exercise the production omission boundary without bypassing its memory guard.
    const graph = await immutableArtifactGraph(snapshot, files, {
      ...analysis,
      files: analysis.files.map((file) =>
        file.file.path === "shared/main.cjs"
          ? {
              ...file,
              application_projection_failure: {
                reason: "fixture projection omitted",
                error: null,
                limits: null,
              },
            }
          : file,
      ),
    });
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(1);
    const role = roles[0];
    if (role === undefined) throw new Error("Missing renderer");
    expect(role.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            resolved_path: null,
            resolution_status: "unavailable",
          }),
        }),
      ]),
    );
    expect(
      graph.edges.filter(
        ({ source_node_id, relation }) =>
          source_node_id === role.node_id && relation === "maps_to",
      ),
    ).toEqual([]);
  } finally {
    await reader.close();
  }
});

it("keeps known IPC pairings when a different Electron value is dynamic", async () => {
  const root = await createTestTempDirectory("rea-partial-ipc-");
  await writeFixtureFiles(root, {
    "package.json": JSON.stringify({ main: "main.js" }),
    "main.js":
      'const { BrowserWindow, ipcMain } = require("electron"); new BrowserWindow({ webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true } }); ipcMain.handle("rea:ping", () => true);',
    "preload.js":
      'const { contextBridge, ipcRenderer } = require("electron"); contextBridge.exposeInMainWorld("rea", { ping: () => ipcRenderer.invoke("rea:ping") });',
    "hidden.js": "export const hidden = true;",
    "unrelated.js.map": JSON.stringify({
      version: 3,
      sources: [],
      names: [],
      mappings: "",
    }),
  });
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    await withArtifactFileAnalyzer(async (analyze) => {
      const files = await readJavaScriptArtifactFiles(reader, snapshot);
      const { analysis } = await analyze(files);
      expect(
        analysis.files.find(({ file }) => file.path === "main.js")?.javascript,
      ).toMatchObject({ parse_status: "partial", parse_error_count: 0 });
      const { graph, electronSummary } = await completeJavaScriptAnalysisSteps(
        buildImmutableJavaScriptArtifactGraphSteps(snapshot, files, analysis),
      );
      expect(graph.coverage.status).toBe("partial");
      expect(electronSummary.ipc).toMatchObject({
        paired_renderer_transmissions: 1,
        ambiguous_renderer_transmissions: 0,
      });

      // An unselected source map cannot hide an IPC handler.
      const withoutMap = await readJavaScriptArtifactFiles(
        reader,
        snapshot,
        undefined,
        ["package.json", "main.js", "preload.js", "hidden.js"],
      );
      const withoutMapAnalysis = (await analyze(withoutMap)).analysis;
      const nonJsResult = await completeJavaScriptAnalysisSteps(
        buildImmutableJavaScriptArtifactGraphSteps(
          snapshot,
          withoutMap,
          withoutMapAnalysis,
        ),
      );
      expect(nonJsResult.graph.coverage.status).toBe("partial");
      expect(
        nonJsResult.electronSummary.ipc.paired_renderer_transmissions,
      ).toBe(1);

      // A source outside the requested scope can hide a competing IPC handler,
      // even when the observed sender and handler have a known package owner.
      const selected = await readJavaScriptArtifactFiles(
        reader,
        snapshot,
        undefined,
        ["package.json", "main.js", "preload.js"],
      );
      const selectedAnalysis = (await analyze(selected)).analysis;
      const selectionResult = await completeJavaScriptAnalysisSteps(
        buildImmutableJavaScriptArtifactGraphSteps(
          snapshot,
          selected,
          selectedAnalysis,
        ),
      );
      expect(selectionResult.electronSummary.ipc).toMatchObject({
        paired_renderer_transmissions: 0,
        ambiguous_renderer_transmissions: 1,
      });

      const hidden = files.files.find(({ path }) => path === "hidden.js");
      if (hidden === undefined)
        throw new Error("Missing hidden source fixture");
      const unavailable = {
        ...files,
        files: files.files.filter(({ path }) => path !== hidden.path),
        unavailable_relevant_files: [
          ...files.unavailable_relevant_files,
          {
            path: hidden.path,
            container_sha256: hidden.container_sha256,
            sha256: hidden.sha256,
            bytes: hidden.bytes,
            inventory_artifact_id: hidden.inventory_artifact_id,
            kind: hidden.kind,
          },
        ],
      };
      const unavailableAnalysis = {
        ...analysis,
        files: analysis.files.filter(({ file }) => file.path !== hidden.path),
      };
      const unavailableResult = await completeJavaScriptAnalysisSteps(
        buildImmutableJavaScriptArtifactGraphSteps(
          snapshot,
          unavailable,
          unavailableAnalysis,
        ),
      );
      expect(unavailableResult.electronSummary.ipc).toMatchObject({
        paired_renderer_transmissions: 0,
        ambiguous_renderer_transmissions: 1,
      });
    });
  } finally {
    await reader.close();
  }
});

it("keeps IPC pairings uncertain when inline HTML scripts are not examined", async () => {
  const root = await createTestTempDirectory("rea-inline-ipc-");
  await writeFixtureFiles(root, {
    "package.json": JSON.stringify({ main: "main.js" }),
    "main.js":
      'const { ipcMain } = require("electron"); ipcMain.handle("rea:ping", () => true);',
    "preload.js":
      'const { ipcRenderer } = require("electron"); ipcRenderer.invoke("rea:ping");',
    "index.html":
      '<script>require("electron").ipcMain.handle("rea:ping", () => false)</script>',
  });
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    await withArtifactFileAnalyzer(async (analyze) => {
      const files = await readJavaScriptArtifactFiles(reader, snapshot);
      const { analysis } = await analyze(files);
      expect(analysis.html_inline_scripts.length).toBeGreaterThan(0);
      const result = await completeJavaScriptAnalysisSteps(
        buildImmutableJavaScriptArtifactGraphSteps(snapshot, files, analysis),
      );
      expect(result.electronSummary.ipc).toMatchObject({
        paired_renderer_transmissions: 0,
        ambiguous_renderer_transmissions: 1,
      });

      const selected = await readJavaScriptArtifactFiles(
        reader,
        snapshot,
        undefined,
        ["package.json", "main.js", "preload.js"],
      );
      const selectedAnalysis = (await analyze(selected)).analysis;
      const selectedResult = await completeJavaScriptAnalysisSteps(
        buildImmutableJavaScriptArtifactGraphSteps(
          snapshot,
          selected,
          selectedAnalysis,
        ),
      );
      expect(selectedResult.electronSummary.ipc).toMatchObject({
        paired_renderer_transmissions: 0,
        ambiguous_renderer_transmissions: 1,
      });
    });
  } finally {
    await reader.close();
  }
});

it("keeps IPC pairings uncertain when source examination is incomplete", async () => {
  const root = await createTestTempDirectory("rea-partial-ipc-examination-");
  await writeFixtureFiles(root, {
    "package.json": JSON.stringify({ main: "main.js" }),
    "main.js":
      'const { ipcMain } = require("electron"); ipcMain.handle("rea:ping", () => true);',
    "preload.js":
      'const { ipcRenderer } = require("electron"); ipcRenderer.invoke("rea:ping");',
    "hidden.js": "export const hidden = true;",
  });
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const complete = await completeJavaScriptAnalysisSteps(
      buildImmutableJavaScriptArtifactGraphSteps(snapshot, files, analysis),
    );
    expect(complete.electronSummary.ipc.paired_renderer_transmissions).toBe(1);
    const hidden = files.files.find(({ path }) => path === "hidden.js");
    if (hidden === undefined) throw new Error("Missing hidden source fixture");
    const hiddenSource = analysis.files.find(
      ({ file }) => file.path === hidden.path,
    );
    if (hiddenSource?.javascript?.analysis_coverage === undefined)
      throw new Error("Missing hidden source coverage");
    const hiddenStatic = hiddenSource.javascript;
    const { analysis_coverage: _ignoredCoverage, ...historicalStatic } =
      hiddenStatic;
    const limitedStatic = {
      ...hiddenStatic,
      analysis_coverage: {
        ...hiddenStatic.analysis_coverage!,
        examination: {
          ...hiddenStatic.analysis_coverage!.examination,
          status: "limited" as const,
          semantic_resource_limits: ["alias-selections" as const],
        },
      },
    };
    const wrapperLimitedStatic = {
      ...hiddenStatic,
      analysis_coverage: {
        ...hiddenStatic.analysis_coverage!,
        examination: {
          ...hiddenStatic.analysis_coverage!.examination,
          status: "limited" as const,
          electron_call_paths_limited: true,
        },
      },
    };
    for (const javascript of [
      historicalStatic,
      limitedStatic,
      wrapperLimitedStatic,
    ]) {
      const partialAnalysis = {
        ...analysis,
        files: analysis.files.map((item) =>
          item.file.path === hidden.path ? { ...item, javascript } : item,
        ),
      };
      const partialResult = await completeJavaScriptAnalysisSteps(
        buildImmutableJavaScriptArtifactGraphSteps(
          snapshot,
          files,
          partialAnalysis,
        ),
      );
      expect(partialResult.electronSummary.ipc).toMatchObject({
        paired_renderer_transmissions: 0,
        ambiguous_renderer_transmissions: 1,
      });
    }

    const failedAnalyses = [
      { ...hiddenSource, javascript: null, semantic: null },
      {
        ...hiddenSource,
        analysis_failure: {
          scope: {
            operation: "analyze-javascript-source" as const,
            authority: "ast-static-analysis" as const,
          },
          status: "interrupted" as const,
          reason: "fixture source analysis failed",
          error: null,
          limits: null,
        },
      },
      {
        ...hiddenSource,
        javascript: {
          ...hiddenStatic,
          parse_status: "partial" as const,
          parse_error_count: 1,
          analysis_coverage: {
            ...hiddenStatic.analysis_coverage!,
            syntax: { status: "recovered" as const, error_count: 1 },
          },
        },
      },
    ];
    for (const failed of failedAnalyses) {
      const partialAnalysis = {
        ...analysis,
        files: analysis.files.map((item) =>
          item.file.path === hidden.path ? failed : item,
        ),
      };
      const partialResult = await completeJavaScriptAnalysisSteps(
        buildImmutableJavaScriptArtifactGraphSteps(
          snapshot,
          files,
          partialAnalysis,
        ),
      );
      expect(partialResult.electronSummary.ipc).toMatchObject({
        paired_renderer_transmissions: 0,
        ambiguous_renderer_transmissions: 1,
      });
    }

    // An incomplete inventory may hide another JavaScript source altogether.
    const incomplete = {
      ...snapshot,
      coverage: { ...snapshot.coverage, status: "unknown" as const },
    };
    const inventoryResult = await completeJavaScriptAnalysisSteps(
      buildImmutableJavaScriptArtifactGraphSteps(incomplete, files, analysis),
    );
    expect(inventoryResult.electronSummary.ipc).toMatchObject({
      paired_renderer_transmissions: 0,
      ambiguous_renderer_transmissions: 1,
    });
  } finally {
    await reader.close();
  }
});

it("does not pair IPC when the Electron wrapper walk hits its depth limit", async () => {
  const root = await createTestTempDirectory("rea-limited-electron-ipc-");
  const source = (depth: number) => {
    const nested =
      Array.from({ length: depth }, (_, index) => `level${index}:{`).join("") +
      'deep:()=>{const register=(ipc)=>ipc.handle("rea:ping",()=>false);register(e.ipcMain)}' +
      "}".repeat(depth);
    return `const e=require("electron");e.contextBridge.exposeInMainWorld("desktop",{${nested}});`;
  };
  // Without the traversal limit, the same wrapper reveals a competing handler.
  const shallow = analyzeJavaScriptStaticSource(source(2));
  expect(shallow.electron.ipc).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        side: "main",
        operation: "handle",
        channel: "rea:ping",
      }),
    ]),
  );
  await writeFixtureFiles(root, {
    "package.json": JSON.stringify({ main: "main.js" }),
    "main.js":
      'const { ipcMain } = require("electron"); ipcMain.handle("rea:ping", () => true);',
    "preload.js":
      'const { ipcRenderer } = require("electron"); ipcRenderer.invoke("rea:ping");',
    "limited.js": source(130),
  });
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const limited = analysis.files.find(
      ({ file }) => file.path === "limited.js",
    );
    expect(limited?.javascript?.analysis_coverage?.examination).toMatchObject({
      electron_call_paths_limited: true,
      semantic_resource_limits: [],
    });
    expect(limited?.javascript?.electron.ipc).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: "rea:ping" }),
      ]),
    );
    const { electronSummary } = await completeJavaScriptAnalysisSteps(
      buildImmutableJavaScriptArtifactGraphSteps(snapshot, files, analysis),
    );
    expect(electronSummary.ipc).toMatchObject({
      paired_renderer_transmissions: 0,
    });
    expect(
      electronSummary.ipc.ambiguous_renderer_transmissions,
    ).toBeGreaterThanOrEqual(1);
  } finally {
    await reader.close();
  }
});

it("does not expand or pair IPC from a revoked application projection", async () => {
  const root = await createTestTempDirectory("rea-revoked-ipc-");
  await writeFixtureFiles(root, {
    "package.json": JSON.stringify({ main: "main.cjs" }),
    "main.cjs":
      'const { ipcMain } = require("electron"); ipcMain.handle("ping", () => 1);',
    "preload.cjs":
      'const { ipcRenderer } = require("electron"); ipcRenderer.invoke("ping");',
  });
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const handler = analysis.files.find(({ file }) => file.path === "main.cjs");
    expect(handler?.javascript?.electron.ipc).toHaveLength(1);
    const omitted = {
      ...analysis,
      files: analysis.files.map((file) =>
        file.file.path === "main.cjs"
          ? {
              ...file,
              application_projection_failure: {
                reason: "fixture projection revoked",
                error: null,
                limits: null,
              },
            }
          : file,
      ),
    };
    const { graph, electronSummary } = await completeJavaScriptAnalysisSteps(
      buildImmutableJavaScriptArtifactGraphSteps(snapshot, files, omitted),
    );
    expect(graph.coverage.status).toBe("partial");
    expect(electronSummary.ipc).toMatchObject({
      operations: 1,
      main_handlers: 0,
      paired_renderer_transmissions: 0,
      ambiguous_renderer_transmissions: 1,
      unpaired_literal_renderer_transmissions: 0,
    });
    expect(
      graph.nodes.some(({ observations }) =>
        observations.some(
          ({ properties }) =>
            properties.application_projection_failure !== undefined &&
            properties.static_analysis !== undefined,
        ),
      ),
    ).toBe(true);
  } finally {
    await reader.close();
  }
});

it("keeps a loadFile owner unknown when a sibling manifest is unavailable in the inventory projection", async () => {
  const root = await createTestTempDirectory("rea-unavailable-app-owner-");
  await writeFixtureFiles(root, {
    "app/package.json": JSON.stringify({ main: "../shared/main.cjs" }),
    "shared/main.cjs":
      'const { BrowserWindow } = require("electron"); const win = new BrowserWindow(); win.loadFile("index.html");',
    "index.html": "artifact-root decoy",
    "app/index.html": "unproven app page",
  });
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const manifest = files.files.find(
      ({ path }) => path === "app/package.json",
    );
    if (manifest === undefined) throw new Error("Missing inventoried manifest");
    // Inject the reader boundary's unavailable projection, not a fabricated graph.
    const partial = {
      ...files,
      files: files.files.filter(({ path }) => path !== manifest.path),
      unavailable_relevant_files: [
        ...files.unavailable_relevant_files,
        {
          path: manifest.path,
          container_sha256: manifest.container_sha256,
          sha256: null,
          bytes: null,
          inventory_artifact_id: manifest.inventory_artifact_id,
          kind: manifest.kind,
          hash_status: "unavailable" as const,
        },
      ],
    };
    const graph = await immutableArtifactGraph(
      snapshot,
      partial,
      (await analyzeArtifactFiles(partial)).analysis,
    );
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(1);
    const role = roles[0];
    if (role === undefined) throw new Error("Missing renderer");
    expect(role.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            resolved_path: null,
            resolution_status: "unavailable",
          }),
        }),
      ]),
    );
    expect(
      graph.edges.filter(
        ({ source_node_id, relation }) =>
          source_node_id === role.node_id && relation === "maps_to",
      ),
    ).toEqual([]);
  } finally {
    await reader.close();
  }
});

it("keeps excluded non-JavaScript files out of the semantic graph", async () => {
  const root = await createTestTempDirectory("rea-js-semantic-applicability-");
  await Promise.all(
    (
      [
        ["a.js", "export const observed = 7;"],
        ["b.js", "export const excluded = true;"],
        ["native.node", Buffer.from([0, 1, 2, 3])],
        ["data.json", '{"observed":7}'],
        ["index.html", '<script src="./a.js"></script>'],
        ["package.json", '{"name":"applicability","main":"a.js"}'],
        [
          "a.js.map",
          JSON.stringify({ version: 3, sources: [], names: [], mappings: "" }),
        ],
      ] as const
    ).map(([path, content]) => writeFile(join(root, path), content)),
  );
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(
      reader,
      snapshot,
      undefined,
      ["a.js"],
    );
    expect(
      files.files.filter(({ text }) => !text.included).map(({ path }) => path),
    ).toEqual([
      "a.js.map",
      "b.js",
      "data.json",
      "index.html",
      "native.node",
      "package.json",
    ]);
    const result = await reconstructJavaScriptArtifact({
      input_path: root,
      source_paths: ["a.js"],
    });
    const graph = result.semantic_graph;
    expect(
      graph.nodes
        .filter(({ kind }) => kind === "module")
        .map(({ identity }) => identity.module_path)
        .sort(),
    ).toEqual(["a.js", "b.js"]);
    expect(graph.coverage.status).toBe("partial");
    expect(graph.unknowns.length).toBeGreaterThan(0);
    expect(
      new Set(graph.nodes.map(({ identity }) => identity.module_path)),
    ).toEqual(new Set(["a.js", "b.js"]));
  } finally {
    await reader.close();
  }
});

it("reports file progress and honors cancellation before the next source", async () => {
  const root = await fixtureDirectory();
  const controller = new AbortController();
  const reason = { request: "cancel before the next source" };
  const progress: string[] = [];
  const failure = await reconstructJavaScriptArtifact(
    { input_path: root },
    controller.signal,
    {
      report: async (event) => {
        if (event.phase === "parse_javascript_source") {
          progress.push(event.message);
          if (progress.length === 2) controller.abort(reason);
        }
      },
    },
  ).then(
    () => {
      throw new Error("Expected cancellation before the next source");
    },
    (cause: unknown) => cause,
  );
  if (!(failure instanceof AnalysisError)) throw failure;
  expect(failure.cause).toBe(reason);
  expect(projectAnalysisError(failure)).toMatchObject({
    code: "cancelled",
    category: "cancelled",
    details: {
      partial_observation: { operation: "analyze_javascript_application" },
    },
  });
  expect(progress).toHaveLength(2);
  expect(progress[0]).not.toBe(progress[1]);
});

it("preserves graph commitments and export shapes through worker adoption", async () => {
  const root = await fixtureDirectory();
  await writeFile(
    join(root, "exports.mjs"),
    `
    import { readFile } from "node:fs";
    export { readFile as read };
    export function create(value) { return { value, nested: { enabled: true } }; }
    export function configured(condition) { return { values: [1, null, undefined], choice: condition ? 1 : 2, ...external }; }
    function unexported() { return "private"; }
  `,
  );
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const projection = createJavaScriptSemanticGraphProjection();
    const sources = new Map<string, JavaScriptAnalyzedSource>();
    const outcome = await withArtifactResourceScope(async (scope) => {
      const worker = await createJavaScriptSourceAnalysis(
        { heapMb: 512, timeoutMs: 30_000 },
        files.files.filter(
          (file) => file.kind === "javascript" && file.text.included,
        ).length,
        { scope },
      );
      scope.retain({
        kind: "javascript-source-analysis",
        resource: "worker adoption fixture analyzer",
        analysis: worker,
      });
      return analyzeAndAdoptJavaScriptArtifactFiles(
        files,
        {
          analyze: async (...args) => {
            const result = await worker.analyze(...args);
            if (result.ok) sources.set(args[0].path, result.value);
            return result;
          },
        },
        projection,
        async () => {},
      );
    });
    if (outcome.interruption !== null) throw outcome.interruption;
    const compact = outcome.analysis;
    const graph = await immutableArtifactGraph(snapshot, files, compact);
    const semantic = await completeJavaScriptAnalysisSteps(
      projection.finishImmutableSteps(snapshot.manifest.root_sha256, graph),
    );
    expect(parseJavaScriptApplicationGraph(graph)).toEqual(graph);
    expect(semantic.application_graph_id).toBe(graph.graph_id);
    expect(semantic.root_artifact_sha256).toBe(snapshot.manifest.root_sha256);
    const exported = compact.files.find(
      ({ file }) => file.path === "exports.mjs",
    );
    if (exported === undefined)
      throw new Error("Expected exports source facts");
    expect(exported.semantic?.ir.callables.map(({ name }) => name)).toEqual([
      "create",
      "configured",
    ]);
    expectWorkerExportFacts(graph, semantic, exported.file);
    expect(javaScriptSemanticGraphSchema.parse(semantic)).toEqual(semantic);
    const transferred = createJavaScriptSemanticGraphProjection();
    const wireRoot = await createTestTempDirectory("rea-javascript-transfer-");
    const decodedModules = new Map<string, JavaScriptModuleSemanticIr>();
    const decodedStatic = new Map<string, JavaScriptStaticAnalysis>();
    let rejectedInvalidTransfer = false;
    for (const [index, analyzed] of compact.files.entries()) {
      const source = sources.get(analyzed.file.path);
      if (source === undefined) continue;
      if (analyzed.javascript !== null) {
        const raw: unknown = JSON.parse(JSON.stringify(analyzed.javascript));
        const decodedFacts = javaScriptWorkerStaticAnalysisSchema.parse(raw);
        expect(decodedFacts).toEqual(analyzed.javascript);
        decodedStatic.set(analyzed.file.path, decodedFacts);
      }
      if (source.projection === null || source.module === null) continue;
      const fragment = source.projection;
      const module = source.module;
      const wirePath = join(wireRoot, `${String(index)}.jsonl`);
      const descriptor = await writeJavaScriptAnalysisTransfer(
        wirePath,
        module,
        fragment,
      );
      const decoded = await readJavaScriptAnalysisTransfer(
        wirePath,
        descriptor,
        analyzed.file,
      );
      expect(decoded.module).toEqual(module);
      decodedModules.set(analyzed.file.path, decoded.module);
      transferred.adoptFileProjection(decoded.projection);
      if (!rejectedInvalidTransfer) {
        await rejectInvalidTransfer(
          wirePath,
          descriptor,
          analyzed.file,
          wireRoot,
        );
        rejectedInvalidTransfer = true;
      }
    }
    expect(rejectedInvalidTransfer).toBe(true);
    const decodedGraph = await immutableArtifactGraph(snapshot, files, {
      ...compact,
      files: compact.files.map((analyzed) => {
        const module = decodedModules.get(analyzed.file.path);
        return {
          ...analyzed,
          javascript:
            decodedStatic.get(analyzed.file.path) ?? analyzed.javascript,
          semantic: module === undefined ? analyzed.semantic : { ir: module },
        };
      }),
    });
    expect(decodedGraph).toEqual(graph);
    const resealed = await completeJavaScriptAnalysisSteps(
      transferred.finishImmutableSteps(
        snapshot.manifest.root_sha256,
        decodedGraph,
      ),
    );
    expect(resealed).toEqual(semantic);
    expect(isValidatedImmutableJavaScriptSemanticGraph(resealed)).toBe(true);
  } finally {
    await reader.close();
  }
});

const expectWorkerExportFacts = (
  graph: JavaScriptApplicationGraph,
  semantic: JavaScriptSemanticGraph,
  file: JavaScriptArtifactFile,
): void => {
  // File-local projection precedes pruning to exported module facts.
  const privateFunction = semantic.nodes.find(
    ({ kind, label, identity }) =>
      kind === "function" &&
      label === "unexported" &&
      identity.module_path === "exports.mjs",
  );
  expect(privateFunction?.identity.artifact_sha256).toBe(file.sha256);
  const exports = graph.nodes.flatMap((node) =>
    node.observations
      .filter(
        ({ properties }) =>
          properties.semantic_role === "export-binding" &&
          properties.module_path === "exports.mjs",
      )
      .map(({ properties }) => ({ node, name: properties.exported_name })),
  );
  expect(exports.map(({ name }) => name).sort()).toEqual([
    "configured",
    "create",
    "read",
  ]);
  const createExport = exports.find(({ name }) => name === "create");
  const createFunction = semantic.nodes.find(
    ({ kind, label, identity }) =>
      kind === "function" &&
      label === "create" &&
      identity.module_path === "exports.mjs",
  );
  if (createExport === undefined || createFunction === undefined)
    throw new Error("Expected create export and semantic callable");
  expect(createFunction.application_node_ids).toContain(
    createExport.node.node_id,
  );
  const returnShapes = graph.nodes.flatMap(({ observations }) =>
    observations
      .map(({ properties }) => properties)
      .filter(
        (properties) =>
          properties.semantic_role === "export-return-shapes" &&
          properties.module_path === "exports.mjs",
      ),
  );
  expect(returnShapes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        exported_name: "create",
        static_return_shapes: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                path: "/nested/enabled",
                state: "literal",
                value: true,
              }),
            ]),
          }),
        ],
      }),
      expect.objectContaining({
        exported_name: "configured",
        static_return_shapes: [
          expect.objectContaining({
            property_coverage: expect.arrayContaining([
              { path: "", status: "partial", omitted: null },
            ]),
          }),
        ],
      }),
    ]),
  );
};

const rejectInvalidTransfer = async (
  wirePath: string,
  descriptor: Awaited<ReturnType<typeof writeJavaScriptAnalysisTransfer>>,
  file: JavaScriptArtifactFile,
  wireRoot: string,
): Promise<void> => {
  await expect(
    readJavaScriptAnalysisTransfer(wirePath, descriptor, {
      ...file,
      sha256: "0".repeat(64),
    }),
  ).rejects.toThrow("different artifact source");
  await expect(
    readJavaScriptAnalysisTransfer(
      wirePath,
      { ...descriptor, sha256: "0".repeat(64) },
      file,
    ),
  ).rejects.toThrow("digest does not match");
  const wire = await readFile(wirePath, "utf8");
  const duplicate = wire
    .split("\n")
    .find((line) => line.startsWith('{"kind":"node"'));
  if (duplicate === undefined)
    throw new Error("Fixture emitted no semantic node record");
  const invalid = `${wire}${duplicate}\n`;
  const invalidPath = join(wireRoot, "duplicate.jsonl");
  await writeFile(invalidPath, invalid);
  await expect(
    readJavaScriptAnalysisTransfer(
      invalidPath,
      {
        ...descriptor,
        bytes: Buffer.byteLength(invalid),
        records: descriptor.records + 1,
        graph_bytes: descriptor.graph_bytes + Buffer.byteLength(duplicate) + 1,
        graph_records: descriptor.graph_records + 1,
        sha256: createHash("sha256").update(invalid).digest("hex"),
      },
      file,
    ),
  ).rejects.toThrow("Duplicate JavaScript transfer node identity");
};

it("reports semantic value resource limits in application graph coverage", async () => {
  const root = await createTestTempDirectory("rea-javascript-semantic-limit-");
  await writeFile(
    join(root, "app.js"),
    `const answer = { nested: ${primitiveCandidateExpansionExpression()} };`,
  );
  await writeFile(join(root, "growth.js"), primitiveByteExpansionSource());
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const graph = await immutableArtifactGraph(snapshot, files, analysis);

    expect(graph.coverage).toMatchObject({
      status: "partial",
      omitted_count: null,
      limits: expect.arrayContaining([
        expect.objectContaining({
          name: "javascript_semantic_primitive_candidates",
          unit: "items",
        }),
        expect.objectContaining({
          name: "javascript_semantic_primitive_bytes",
          unit: "bytes",
        }),
      ]),
    });
    const sourceModuleLimits = graph.nodes
      .filter(({ kind }) => kind === "javascript-module")
      .flatMap(({ observations }) => observations)
      .filter(
        ({ evidence }) =>
          evidence.extractor.operation === "recover-source-module",
      )
      .flatMap(({ evidence }) => evidence.coverage.limits);
    expect(sourceModuleLimits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "javascript_semantic_primitive_candidates",
          unit: "items",
        }),
        expect.objectContaining({
          name: "javascript_semantic_primitive_bytes",
          unit: "bytes",
        }),
      ]),
    );
    expect(graph.limitations).toContain(
      "Primitive candidate budget exceeded (maximum 256 alternatives).",
    );
    expect(graph.limitations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/primitive string-byte budget exceeded/i),
      ]),
    );
  } finally {
    await reader.close();
  }
});

it("reconstructs package, Electron roles, Webpack/Rspack modules, and cross-layer facts without execution", async () => {
  const root = await fixtureDirectory();
  Reflect.deleteProperty(globalThis, "__rea_bundle_executed");

  const result = await reconstructJavaScriptArtifact({
    input_path: root,
  });
  const graph = parseJavaScriptApplicationGraph(result.graph);
  const semanticGraph = javaScriptSemanticGraphSchema.parse(
    result.semantic_graph,
  );

  expect(Reflect.get(globalThis, "__rea_bundle_executed")).toBeUndefined();
  expect(result.input_path).toBe(root);
  expect(result.statistics).toMatchObject({
    modules: 4,
    parse_failures: 0,
    relevant_files: expect.any(Number),
    text_bytes_read: expect.any(Number),
  });
  expect(graph.nodes.map(({ kind }) => kind)).toEqual(
    expect.arrayContaining([
      "package",
      "artifact",
      "electron-main",
      "electron-preload",
      "electron-renderer",
      "javascript-asset",
      "javascript-chunk",
      "javascript-module",
      "worker",
      "service-worker",
      "endpoint",
      "storage",
      "source-map",
      "source-module",
      "native-addon",
    ]),
  );
  expect(graph.nodes.filter(({ kind }) => kind === "javascript-chunk")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({ bundler: "webpack" }),
          }),
        ]),
      }),
      expect.objectContaining({
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({ bundler: "rspack" }),
          }),
        ]),
      }),
    ]),
  );
  expect(
    graph.nodes.filter(({ kind }) => kind === "javascript-module"),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              module_key: "1",
              structural_fingerprint_algorithm: "babel-ast-v3",
            }),
          }),
        ]),
      }),
    ]),
  );
  expect(graph.edges.map(({ relation }) => relation)).toEqual(
    expect.arrayContaining([
      "contains",
      "loads",
      "imports",
      "maps_to",
      "exposes",
      "calls",
      "persists_to",
    ]),
  );
  assertSemanticLinks(result, graph, semanticGraph);
});

it("produces deterministic ASAR graphs with unpacked native linkage and complete paths/digests", async () => {
  const root = await createTestTempDirectory("rea-javascript-asar-");
  const source = join(root, "source");
  await mkdir(source);
  await writeJavaScriptArtifactFixture(source);
  const archive = join(root, "app.asar");
  await createPackageWithOptions(source, archive, { unpack: "*.node" });

  const first = await reconstructJavaScriptArtifact({
    input_path: archive,
    format: "asar",
  });
  const second = await reconstructJavaScriptArtifact({
    input_path: archive,
    format: "asar",
  });

  expect(first.graph).toEqual(second.graph);
  expect(first.inventory_graph_sha256).toBe(second.inventory_graph_sha256);
  expect(first.graph.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "asar-entry",
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              entry_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
              inventory_artifact_id:
                expect.stringMatching(/^art_[a-f0-9]{64}$/u),
            }),
          }),
        ]),
      }),
      expect.objectContaining({
        kind: "native-addon",
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              path: "native/addon.node",
              unpacked: true,
            }),
          }),
        ]),
      }),
    ]),
  );
  expect(first.graph.edges).toContainEqual(
    expect.objectContaining({
      relation: "loads",
      properties: expect.objectContaining({
        resolved_path: "native/addon.node",
      }),
    }),
  );
});

it("keeps suffix-named ASAR directories in the graph and analyzes their files", async () => {
  const root = await createTestTempDirectory(
    "rea-javascript-asar-suffix-directory-",
  );
  const source = join(root, "source");
  const zipDirectory = join(source, "node_modules", "@zip.js");
  await mkdir(zipDirectory, { recursive: true });
  await writeJavaScriptArtifactFixture(source);
  await writeFile(
    join(zipDirectory, "entry.js"),
    "export const packed = true;\n",
  );
  const archive = join(root, "app.asar");
  await createPackageWithOptions(source, archive, {});

  const snapshot = await scanArtifactInventory(archive);
  const zipDirectoryOccurrence = snapshot.occurrences.find(
    ({ logical_path }) => logical_path === "node_modules/@zip.js",
  );
  expect(zipDirectoryOccurrence).toMatchObject({
    entry_kind: "directory",
    artifact_id: expect.stringMatching(/^art_[a-f0-9]{64}$/u),
  });
  expect(
    snapshot.nodes.some(
      ({ artifact_id }) => artifact_id === zipDirectoryOccurrence?.artifact_id,
    ),
  ).toBe(true);

  await reconstructAsarArchive(archive, [
    expect.objectContaining({
      kind: "javascript-asset",
      observations: expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            path: "node_modules/@zip.js/entry.js",
          }),
        }),
      ]),
    }),
  ]);
});

it("keeps ASAR analysis usable when unpacked native companion bytes are absent", async () => {
  const root = await createTestTempDirectory("rea-javascript-asar-missing-");
  const source = join(root, "source");
  await mkdir(source);
  await writeJavaScriptArtifactFixture(source);
  const archive = join(root, "app.asar");
  await createPackageWithOptions(source, archive, { unpack: "*.node" });
  await rm(join(`${archive}.unpacked`, "native", "addon.node"));

  const snapshot = await scanArtifactInventory(archive);
  const missingNative = snapshot.occurrences.find(
    ({ logical_path }) => logical_path === "native/addon.node",
  );

  expect(missingNative).toMatchObject({
    artifact_id: null,
    hash_status: "unavailable",
    limitations: expect.arrayContaining([
      "ASAR unpacked companion bytes were unavailable; no content hash or child artifact was produced.",
    ]),
  });
  if (missingNative === undefined)
    throw new Error("Inventory omitted the unavailable native companion");

  const result = await reconstructAsarArchive(archive, [
    expect.objectContaining({ kind: "javascript-asset" }),
  ]);
  const missingEntry = result.graph.nodes.find(
    ({ kind, observations }) =>
      kind === "asar-entry" &&
      observations.some(({ label }) => label === missingNative.logical_path),
  );
  expect(missingEntry).toMatchObject({
    identity: {
      strategy: "canonical-path",
      stability: "artifact-version",
      artifact_sha256: snapshot.manifest.root_sha256,
      path: missingNative.logical_path,
    },
    observations: [
      expect.objectContaining({
        label: missingNative.logical_path,
        properties: expect.objectContaining({
          entry_sha256: null,
          bytes: missingNative.declared_size,
          inventory_artifact_id: null,
          inventory_occurrence_id: missingNative.occurrence_id,
          hash_status: "unavailable",
          artifact_kind: "native-addon",
          kind: "native-addon",
          content_available: false,
        }),
        evidence: expect.objectContaining({
          limitations: expect.arrayContaining([
            "ASAR unpacked companion bytes were unavailable; no content hash or child artifact was produced.",
            "The inventoried native-addon entry has unavailable bytes; no content artifact identity can be established.",
          ]),
        }),
      }),
    ],
  });
  const unavailableAddon = result.graph.nodes.find(
    ({ kind, observations }) =>
      kind === "native-addon" &&
      observations.some(({ label }) => label === missingNative.logical_path),
  );
  expect(unavailableAddon).toMatchObject({
    identity: {
      strategy: "canonical-path",
      stability: "artifact-version",
      artifact_sha256: snapshot.manifest.root_sha256,
      path: missingNative.logical_path,
    },
    observations: [
      expect.objectContaining({
        label: missingNative.logical_path,
        properties: expect.objectContaining({
          availability: "unavailable",
          hash_status: "unavailable",
          artifact_kind: "native-addon",
          bytes: missingNative.declared_size,
          inventory_artifact_id: null,
          inventory_occurrence_id: missingNative.occurrence_id,
        }),
      }),
    ],
  });
});

it("recurses into filesystem-backed ASAR containers without losing container-relative paths", async () => {
  const root = await createTestTempDirectory("rea-javascript-nested-asar-");
  const source = await fixtureDirectory();
  const outer = join(root, "outer");
  const resources = join(outer, "resources");
  await mkdir(resources, { recursive: true });
  await createPackageWithOptions(source, join(resources, "app.asar"), {
    unpack: "*.node",
  });

  const result = await reconstructJavaScriptArtifact({
    input_path: outer,
  });

  expect(result.statistics.nested_asar_containers).toBe(1);
  expect(result.statistics.modules).toBe(4);
  expect(result.graph.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "artifact",
        observations: expect.arrayContaining([
          expect.objectContaining({
            label: "resources/app.asar",
            properties: expect.objectContaining({ format: "asar" }),
          }),
        ]),
      }),
      expect.objectContaining({
        kind: "javascript-asset",
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              path: "resources/app.asar/main.js",
            }),
          }),
        ]),
      }),
    ]),
  );
});

const assertSemanticLinks = (
  result: Awaited<ReturnType<typeof reconstructJavaScriptArtifact>>,
  graph: ReturnType<typeof parseJavaScriptApplicationGraph>,
  semanticGraph: JavaScriptSemanticGraph,
) => {
  expect(semanticGraph.application_graph_id).toBe(graph.graph_id);
  const { graph_id: _semanticGraphId, ...semanticGraphInput } = semanticGraph;
  const mismatchedSemanticGraph = createJavaScriptSemanticGraph({
    ...semanticGraphInput,
    application_graph_id: `jag_${"f".repeat(64)}`,
  });
  const { electron_summary: summary, ...analysisResult } = result;
  expect(() =>
    javascriptApplicationAnalysisResultSchema.parse({
      ...analysisResult,
      summary,
      semantic_graph: mismatchedSemanticGraph,
    }),
  ).toThrow(/must commit the containing application graph/u);
  expect(
    semanticGraph.nodes.some(
      ({ application_node_ids: identifiers }) => identifiers.length > 0,
    ),
  ).toBe(true);
  expect(semanticGraph.relations.length).toBeGreaterThan(0);
  const roles = ["electron-main", "electron-preload"].map((kind) =>
    graph.nodes.find((node) => node.kind === kind),
  );
  expect(roles[0]?.observations[0]?.properties).toMatchObject({
    declared_path: "main.js",
    resolution_context: "package-entrypoint",
    resolved_path: "main.js",
    resolution_status: "resolved",
    limitations: [],
  });
  expect(roles[1]?.observations[0]?.properties).toMatchObject({
    declared_path: "preload.js",
    resolution_context: "filesystem-expression",
    resolved_path: "preload.js",
    resolution_status: "resolved",
    limitations: [],
  });
  const mainAsset = graph.nodes.find(
    (node) =>
      node.kind === "javascript-asset" &&
      node.observations.some(
        ({ evidence }) =>
          evidence.location.available &&
          evidence.location.value.kind === "artifact-path" &&
          evidence.location.value.path === "main.js",
      ),
  );
  if (mainAsset === undefined)
    throw new Error("Expected main JavaScript asset");
  const mainSemanticNodes = semanticGraph.nodes.filter(
    ({ identity }) => identity.module_path === "main.js",
  );
  const linkedMainSemanticNodes = mainSemanticNodes.filter(
    ({ application_node_ids: identifiers }) =>
      identifiers.includes(mainAsset.node_id),
  );
  expect(linkedMainSemanticNodes.length).toBeGreaterThan(0);
  expect(linkedMainSemanticNodes.length).toBeLessThan(mainSemanticNodes.length);
  for (const role of roles) {
    expect(role).toBeDefined();
    expect(
      graph.edges.some(
        (edge) =>
          edge.source_node_id === role?.node_id && edge.relation === "maps_to",
      ),
    ).toBe(true);
  }
  const endpointJson = JSON.stringify(
    graph.nodes.filter(({ kind }) => kind === "endpoint"),
  );
  expect(endpointJson).toContain("token=fixture-secret");
};

const reconstructAsarArchive = async (
  archive: string,
  expectedNodes: readonly unknown[],
): Promise<Awaited<ReturnType<typeof reconstructJavaScriptArtifact>>> => {
  const result = await reconstructJavaScriptArtifact({
    input_path: archive,
    format: "asar",
  });
  expect(result.statistics.parsed_javascript_files).toBeGreaterThan(0);
  expect(result.graph.nodes).toEqual(
    expect.arrayContaining([...expectedNodes]),
  );
  return result;
};

const fixtureDirectory = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-javascript-artifact-");
  await writeJavaScriptArtifactFixture(root);
  return root;
};

for (const extension of ["ts", "tsx", "mts", "cts", "js", "mjs", "cjs"]) {
  it.each(["directory", "asar"] as const)(
    `retains ${extension} source facts from a real %s artifact`,
    async (format) => {
      const root = await createTestTempDirectory("rea-nodenext-artifacts-");
      const directory = join(root, "source");
      await mkdir(directory);
      const path = `selected.${extension}`;
      const parameter = ["ts", "tsx", "mts", "cts"].includes(extension)
        ? "value: string"
        : "value";
      const source = `
        globalThis.__rea_nodenext_executed = true;
        throw new Error("fixture must remain inert");
        export function selected_feature(${parameter}) { return { value }; }
      `;
      await writeFile(join(directory, path), source);
      let inputPath = directory;
      if (format === "asar") {
        inputPath = join(root, "application.asar");
        await createPackageWithOptions(directory, inputPath, {});
      }
      Reflect.deleteProperty(globalThis, "__rea_nodenext_executed");
      const result = await reconstructJavaScriptArtifact({
        input_path: inputPath,
        format,
      });
      expect(
        Reflect.get(globalThis, "__rea_nodenext_executed"),
      ).toBeUndefined();
      expect(result.statistics).toMatchObject({
        relevant_files: 1,
        parsed_javascript_files: 1,
        text_bytes_read: Buffer.byteLength(source),
        parse_failures: 0,
      });
      const asset = result.graph.nodes.find(
        ({ kind, observations }) =>
          kind === "javascript-asset" &&
          observations.some(({ properties }) => properties.path === path),
      );
      expect(asset?.identity).toMatchObject({
        sha256: createHash("sha256").update(source).digest("hex"),
      });
      expect(asset?.observations[0]?.properties).toMatchObject({
        path,
        bytes: Buffer.byteLength(source),
        file_kind: "javascript",
        parse_status: "complete",
      });
      expect(
        result.semantic_graph.nodes.some(
          ({ identity }) => identity.module_path === path,
        ),
      ).toBe(true);
      expect(result.graph.coverage).toMatchObject({
        status: "complete",
        truncated: false,
      });
    },
  );
}
