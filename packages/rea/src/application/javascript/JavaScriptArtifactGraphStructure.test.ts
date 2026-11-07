import { addElectronIpcBoundaries } from "./ElectronBoundaryGraphIpc.js";
import { createElectronIpcContext } from "./ElectronBoundaryAnalysis.js";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import type { ArtifactInventorySnapshot } from "../../domain/artifactInventorySnapshot.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { analyzeJavaScriptStaticSource } from "../../domain/javascript/javascriptStaticAnalysis.js";
import type {
  AnalyzedJavaScriptArtifactFile,
  JavaScriptArtifactAnalysis,
} from "./JavaScriptArtifactAnalysisTypes.js";
import { javascriptArtifactAnalysisScopes } from "./JavaScriptArtifactAnalysisTypes.js";
import { JavaScriptArtifactGraphAccumulator } from "./JavaScriptArtifactGraphAccumulator.js";
import type { JavaScriptArtifactGraphContext } from "./JavaScriptArtifactGraphContext.js";
import {
  addJavaScriptArtifactFiles,
  createJavaScriptArtifactRootNode,
} from "./JavaScriptArtifactGraphStructure.js";
import { addJavaScriptStaticFindingsSteps } from "./JavaScriptArtifactGraphFindings.js";
import { applicationContainerIdentity } from "./JavaScriptArtifactGraphContext.js";
import { JavaScriptJsonDocuments } from "./JavaScriptJsonDocuments.js";

const SHA256 = "a".repeat(64);
const REASON =
  "main.js: Resource constraint during analyze_javascript_application: Owned JavaScript worker exhausted its heap while analyzing main.js during static";

const skippedFile = (): JavaScriptArtifactFile => ({
  path: "main.js",
  container_sha256: SHA256,
  sha256: SHA256,
  bytes: 5000107,
  inventory_artifact_id: `art_${SHA256}`,
  kind: "javascript",
  unpacked: false,
  text: { included: true, value: "const {ipcMain}=require('electron');\n" },
});

const skippedEntry = (
  file: JavaScriptArtifactFile,
): AnalyzedJavaScriptArtifactFile => ({
  file,
  javascript: null,
  semantic: null,
  analysis_failure: {
    scope: javascriptArtifactAnalysisScopes["javascript"],
    status: "interrupted",
    reason: REASON,
    error: { code: "resource_constraint" },
    limits: null,
  },
});

const analysisFor = (
  entries: readonly AnalyzedJavaScriptArtifactFile[],
): JavaScriptArtifactAnalysis => ({
  jsonDocuments: new JavaScriptJsonDocuments(),
  files: entries,
  packages: [],
  json_modules: [],
  html_scripts: [],
  html_inline_scripts: [],
  source_maps: [],
  visited_ast_nodes: 0,
  findings: 0,
  modules: 0,
  parse_failures: 0,
  limitations: [],
});

const contextFor = (
  file: JavaScriptArtifactFile,
  analysis: JavaScriptArtifactAnalysis,
): JavaScriptArtifactGraphContext => {
  const accumulator = new JavaScriptArtifactGraphAccumulator();
  const snapshot = {
    manifest: {
      root_artifact_id: `art_${SHA256}`,
      root_sha256: SHA256,
      root_format: "directory",
      manifest_id: `agm_${SHA256}`,
      graph_sha256: SHA256,
    },
    nodes: [{ artifact_id: `art_${SHA256}`, sha256: SHA256, size: 1 }],
    // These fixtures model complete directory traversal; source-analysis gaps
    // remain on the individual files and do not imply missing inventory paths.
    coverage: { scope: "root", status: "complete" },
  } as unknown as ArtifactInventorySnapshot;
  const fileSet = {
    files: [file],
    unavailable_relevant_files: [],
    containers: [],
    text_bytes_read: file.bytes,
    invalid_utf8_files: 0,
  };
  return {
    accumulator,
    snapshot,
    fileSet,
    analysis,
    directoryPaths: new Set<string>(),
    root: createJavaScriptArtifactRootNode(accumulator, snapshot),
    filesByPath: new Map([[file.path, file]]),
    unanalyzedFiles: undefined,
    fileNodes: new Map(),
    assetNodes: new Map(),
    sourceModuleNodes: new Map(),
    chunkNodes: new Map(),
    moduleNodes: new Map(),
    containerNodes: new Map(),
    applicationRootsBySource: new Map(),
    applicationOwnershipUnknownContainers: new Set(),
    applicationModuleGapSources: new Map(),
    applicationPossibleRootsByContainer: new Map(),
    applicationModuleReferencesRetained: new Set(),
  };
};

const fileObservation = (context: JavaScriptArtifactGraphContext) => {
  const node = context.accumulator
    .nodes()
    .find(({ kind }) => kind === "javascript-asset");
  if (node === undefined) throw new Error("Expected a javascript-asset node");
  const observation = node.observations[0];
  if (observation === undefined) throw new Error("Expected a file observation");
  return observation.properties;
};

describe("skipped JavaScript parse reporting", () => {
  it("marks parse_status skipped for a JavaScript file whose worker analysis failed", () => {
    const file = skippedFile();
    const context = contextFor(file, analysisFor([skippedEntry(file)]));
    addJavaScriptArtifactFiles(context);
    expect(fileObservation(context).parse_status).toBe("skipped");
    expect(fileObservation(context).analysis_coverage).toMatchObject({
      syntax: { status: "not-examined", error_count: null },
      semantics: { unknown_findings: null },
      examination: { status: "not-examined" },
    });
  });

  it("keeps parse_status null for a JavaScript file never attempted", () => {
    const file = skippedFile();
    const entry: AnalyzedJavaScriptArtifactFile = {
      file,
      javascript: null,
      semantic: null,
    };
    const context = contextFor(file, analysisFor([entry]));
    addJavaScriptArtifactFiles(context);
    expect(fileObservation(context).parse_status).toBeNull();
  });

  it("keeps the parsed status for an analyzed JavaScript file", () => {
    const file = skippedFile();
    const javascript = analyzeJavaScriptStaticSource(
      "const {ipcMain}=require('electron');\n",
    );
    const entry: AnalyzedJavaScriptArtifactFile = {
      file,
      javascript,
      semantic: null,
    };
    const context = contextFor(file, analysisFor([entry]));
    addJavaScriptArtifactFiles(context);
    expect(fileObservation(context).parse_status).toBe(javascript.parse_status);
    expect(fileObservation(context).analysis_coverage).toEqual(
      javascript.analysis_coverage,
    );
  });

  it("does not reconstruct coverage from a historical overall summary", () => {
    const file = skippedFile();
    const { analysis_coverage: _coverage, ...javascript } =
      analyzeJavaScriptStaticSource(file.text.included ? file.text.value : "");
    const context = contextFor(
      file,
      analysisFor([{ file, javascript, semantic: null }]),
    );
    addJavaScriptArtifactFiles(context);
    expect(fileObservation(context)).not.toHaveProperty("analysis_coverage");
  });
});

it("preserves omitted inventory facts on an unavailable artifact", () => {
  const file = skippedFile();
  const base = contextFor(file, analysisFor([]));
  const context: JavaScriptArtifactGraphContext = {
    ...base,
    fileSet: {
      ...base.fileSet,
      files: [],
      unavailable_relevant_files: [
        {
          path: file.path,
          container_sha256: file.container_sha256,
          sha256: null,
          bytes: null,
          inventory_artifact_id: null,
        },
      ],
    },
  };
  addJavaScriptArtifactFiles(context);
  const entry = context.accumulator
    .nodes()
    .find(
      ({ identity }) =>
        identity.strategy === "canonical-path" && identity.path === file.path,
    );
  expect(entry?.observations[0]?.properties).toEqual({
    path: file.path,
    entry_sha256: null,
    bytes: null,
    inventory_artifact_id: null,
    content_available: false,
  });
  expect(
    context.accumulator
      .edges()
      .find(({ target_node_id }) => target_node_id === entry?.node_id)
      ?.properties,
  ).toEqual({ path: file.path, content_available: false });
});

it.each([false, true])(
  "retains possible setter owners independently of proven imports (possible owner: %s)",
  (possibleOwner) => {
    const window: JavaScriptArtifactFile = {
      ...skippedFile(),
      path: "b/window.cjs",
      sha256: "b".repeat(64),
    };
    const setter: JavaScriptArtifactFile = {
      ...skippedFile(),
      path: "shared/change.cjs",
      sha256: "c".repeat(64),
    };
    const page: JavaScriptArtifactFile = {
      ...skippedFile(),
      path: "b/index.html",
      sha256: "d".repeat(64),
      kind: "html",
    };
    const analysis = analysisFor([
      {
        file: setter,
        javascript: analyzeJavaScriptStaticSource(
          'const { app } = require("electron"); app.setAppPath("/changed");',
        ),
        semantic: null,
      },
      {
        file: window,
        javascript: analyzeJavaScriptStaticSource(
          'const { BrowserWindow } = require("electron"); new BrowserWindow().loadFile("index.html");',
        ),
        semantic: null,
      },
      { file: page, javascript: null, semantic: null },
    ]);
    const base = contextFor(window, analysis);
    const files = [setter, window, page];
    const context: JavaScriptArtifactGraphContext = {
      ...base,
      fileSet: { ...base.fileSet, files },
      filesByPath: new Map(files.map((file) => [file.path, file])),
    };
    context.applicationRootsBySource.set(setter.path, new Set(["a"]));
    context.applicationRootsBySource.set(window.path, new Set(["b"]));
    if (possibleOwner)
      context.applicationPossibleRootsByContainer.set(
        applicationContainerIdentity(context.fileSet, setter),
        new Set(["b"]),
      );
    addJavaScriptArtifactFiles(context);
    const steps = addJavaScriptStaticFindingsSteps(context);
    let step = steps.next();
    while (!step.done) step = steps.next();
    const role = context.accumulator
      .nodes()
      .find(({ kind }) => kind === "electron-renderer");
    expect(role?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            resolved_path: possibleOwner ? null : "b/index.html",
            resolution_status: possibleOwner ? "unavailable" : "resolved",
          }),
        }),
      ]),
    );
  },
);

it.each([
  "unselected",
  "transitive-unselected",
  "invalid-utf8",
  "worker-failure",
  "parse-failed",
  "opaque",
  "unknown-loader",
  "read-inert",
  "unreferenced",
  "json",
  "missing",
] as const)(
  "does not prove an unchanged application path across a reachable %s load gap",
  (gap) => {
    const makeFile = (
      path: string,
      kind: JavaScriptArtifactFile["kind"] = "javascript",
    ): JavaScriptArtifactFile => ({
      ...skippedFile(),
      path,
      sha256: createHash("sha256").update(path).digest("hex"),
      kind,
    });
    const main = makeFile("a/main.cjs");
    const other = makeFile("b/main.cjs");
    const target = makeFile(
      gap === "json" ? "a/change.json" : "a/change.cjs",
      gap === "json" ? "json" : "javascript",
    );
    const page = makeFile("a/index.html", "html");
    const otherPage = makeFile("b/index.html", "html");
    const window =
      'const {BrowserWindow}=require("electron");new BrowserWindow().loadFile("index.html");';
    const statement =
      gap === "unknown-loader"
        ? "require(process.env.CHANGE);"
        : gap === "transitive-unselected"
          ? 'require("./middle.cjs");'
          : gap === "unreferenced"
            ? ""
            : `require("./${gap === "json" ? "change.json" : "change.cjs"}");`;
    const entry: AnalyzedJavaScriptArtifactFile =
      gap === "worker-failure"
        ? skippedEntry(target)
        : {
            file:
              gap === "invalid-utf8"
                ? {
                    ...target,
                    text: { included: false, reason: "invalid-utf8" },
                  }
                : target,
            javascript:
              gap === "read-inert"
                ? analyzeJavaScriptStaticSource("module.exports=42;")
                : gap === "parse-failed"
                  ? {
                      ...analyzeJavaScriptStaticSource(""),
                      parse_status: "failed",
                      parse_error_count: 1,
                    }
                  : null,
            semantic: null,
          };
    const entries: AnalyzedJavaScriptArtifactFile[] = [
      {
        file: main,
        javascript: analyzeJavaScriptStaticSource(statement + window),
        semantic: null,
      },
      {
        file: other,
        javascript: analyzeJavaScriptStaticSource(window),
        semantic: null,
      },
      ...(gap === "transitive-unselected"
        ? [
            {
              file: makeFile("a/middle.cjs"),
              javascript: analyzeJavaScriptStaticSource(
                'require("./change.cjs");',
              ),
              semantic: null,
            },
          ]
        : []),
      ...(gap === "missing" || gap === "opaque" ? [] : [entry]),
      { file: page, javascript: null, semantic: null },
      { file: otherPage, javascript: null, semantic: null },
    ];
    const analysis = analysisFor(entries);
    const base = contextFor(main, analysis);
    const files = entries.map(({ file }) => file);
    const context: JavaScriptArtifactGraphContext = {
      ...base,
      fileSet: { ...base.fileSet, files },
      filesByPath: new Map(files.map((file) => [file.path, file])),
      unanalyzedFiles:
        gap === "opaque"
          ? {
              get: (path) => (path === target.path ? target : undefined),
              coverage: base.snapshot.coverage,
              hasDirectory: () => false,
            }
          : undefined,
      applicationModuleReferencesRetained: new Set([
        main.path,
        other.path,
        ...(gap === "transitive-unselected" ? ["a/middle.cjs"] : []),
        ...(gap === "read-inert" ? [target.path] : []),
      ]),
    };
    context.applicationRootsBySource.set(main.path, new Set(["a"]));
    context.applicationRootsBySource.set(other.path, new Set(["b"]));
    addJavaScriptArtifactFiles(context);
    const steps = addJavaScriptStaticFindingsSteps(context);
    while (!steps.next().done) {}
    const roles = context.accumulator
      .nodes()
      .filter(({ kind }) => kind === "electron-renderer");
    expect(roles).toHaveLength(2);
    const changed = !["read-inert", "unreferenced", "json", "missing"].includes(
      gap,
    );
    for (const [path, expected] of [
      [main.path, changed ? null : "a/index.html"],
      // Existing loader ownership also allows an unchecked source to import
      // the other app's module; no process isolation has been established.
      [other.path, changed ? null : "b/index.html"],
    ] as const) {
      const role = roles.find(({ observations }) =>
        observations.some(
          ({ evidence }) =>
            evidence.location.available &&
            evidence.location.value.kind === "source-range" &&
            evidence.location.value.source === path,
        ),
      );
      expect(role?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              resolved_path: expected,
              resolution_status: expected === null ? "unavailable" : "resolved",
            }),
          }),
        ]),
      );
    }
  },
);

it("attaches sender validation to the innermost handler after a long minified line", () => {
  const source = `const {ipcMain}=require('electron');/*${"x".repeat(2_000_010)}*/ipcMain.handle('outer', event=>{
  ipcMain.handle('inner', event=>{ if(event.senderFrame.url === 'https://trusted.test') return true; });
});`;
  const file = {
    ...skippedFile(),
    bytes: Buffer.byteLength(source),
    text: { included: true as const, value: source },
  };
  const javascript = analyzeJavaScriptStaticSource(source);
  expect(javascript.electron.sender_validations).toHaveLength(1);
  const analysis = analysisFor([{ file, javascript, semantic: null }]);
  const context = contextFor(file, analysis);
  addJavaScriptArtifactFiles(context);
  addElectronIpcBoundaries(
    context,
    createElectronIpcContext(analysis, () => "app"),
  );
  const handlers = context.accumulator
    .nodes()
    .filter(({ kind }) => kind === "ipc-handler");
  const validated = handlers.filter(({ observations }) =>
    observations.some(
      ({ properties }) =>
        properties.fact_kind === "sender-validation-candidate",
    ),
  );
  expect(validated).toHaveLength(1);
  expect(
    validated[0]?.observations.some(
      ({ properties }) => properties.channel === "inner",
    ),
  ).toBe(true);
});

it("projects package parse status from the package observation", () => {
  const file = {
    ...skippedFile(),
    path: "package.json",
    kind: "package-json" as const,
  };
  const entry: AnalyzedJavaScriptArtifactFile = {
    file,
    javascript: null,
    semantic: null,
  };
  const analysis = {
    ...analysisFor([entry]),
    packages: [
      {
        path: file.path,
        sha256: file.sha256,
        status: "included" as const,
        name: "fixture",
        version: null,
        main: null,
        main_status: "default" as const,
        main_entrypoint: "index.js",
        renderer_declarations: {},
        renderer_entrypoint: null,
        limitation: null,
      },
    ],
  };
  const context = contextFor(file, analysis);
  addJavaScriptArtifactFiles(context);
  const observation = context.accumulator
    .nodes()
    .flatMap(({ observations }) => observations)
    .find(({ properties }) => properties.file_kind === "package-json");
  expect(observation?.properties).toMatchObject({
    file_kind: "package-json",
    package_parse_status: "included",
    json_parse_status: null,
  });
});
