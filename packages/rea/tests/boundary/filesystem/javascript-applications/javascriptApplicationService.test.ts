import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseEvidence } from "../../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { writeJavaScriptSourceSelectionFixture } from "../../../fixtures/javascriptSourceSelection.js";

import { ArtifactReaderFailure } from "../../../../src/artifacts/ArtifactReader.js";
import { scanCanonicalArtifactInventory } from "../../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { AnalysisCancelledError } from "../../../../src/domain/analysisErrorCore.js";
import {
  analyzeJavaScriptApplication,
  readJavaScriptArtifactFiles,
} from "../../../support/javascriptApplicationScope.js";
import { createJavaScriptArtifactReader } from "../../../../src/artifacts/javascript/JavaScriptArtifactReader.js";
import { createJavaScriptSourceAnalysis } from "../../../../src/artifacts/javascript/JavaScriptSourceAnalysis.js";
import { analyzeAndAdoptJavaScriptArtifactFiles } from "../../../../src/application/javascript/JavaScriptArtifactAnalysis.js";
import { createJavaScriptSemanticGraphProjection } from "../../../../src/application/javascript/JavaScriptSemanticGraphBuilder.js";
import { immutableArtifactGraph } from "../../../fixtures/javascriptArtifactGraph.js";
import type { JavaScriptApplicationGraph } from "../../../../src/domain/javascript/javascriptApplicationGraph.js";
import { writeFixtureFiles } from "../../../support/javascriptApplicationFixture.js";

describe("JavaScript source selection cancellation boundary", () => {
  it("keeps unselected files outside scope when the real worker cancels after the last selected file", async () => {
    const root = await createTestTempDirectory(
      "rea-js-selected-last-cancellation-",
    );
    await writeJavaScriptSourceSelectionFixture(root);
    const snapshot = await scanCanonicalArtifactInventory(root, {});
    const reader = createJavaScriptArtifactReader(root, "directory");
    const controller = new AbortController();
    const reason = { request: "caller cancelled selected sources" };
    const sourcePaths = ["main.mjs"];
    try {
      const files = await readJavaScriptArtifactFiles(
        reader,
        snapshot,
        controller.signal,
        sourcePaths,
      );
      const worker = await createJavaScriptSourceAnalysis(
        { heapMb: 512, timeoutMs: 30_000 },
        1,
      );
      let outcome: Awaited<
        ReturnType<typeof analyzeAndAdoptJavaScriptArtifactFiles>
      >;
      try {
        const realWorker = worker.analyze.bind(worker);
        outcome = await analyzeAndAdoptJavaScriptArtifactFiles(
          files,
          {
            analyze: async (...args) => {
              const result = await realWorker(...args);
              controller.abort(reason);
              return result;
            },
          },
          createJavaScriptSemanticGraphProjection(),
          async () => {},
          controller.signal,
        );
      } finally {
        await worker.close();
      }
      expect(outcome.interruption).toBeInstanceOf(AnalysisCancelledError);
      expect(outcome.interruption?.cause).toBe(reason);
      const unselected = outcome.analysis.files.filter(
        ({ file }) =>
          !file.text.included && file.text.reason === "outside-analysis-scope",
      );
      expect(unselected).toHaveLength(5);
      expect(
        unselected.every(
          ({ analysis_failure }) => analysis_failure === undefined,
        ),
      ).toBe(true);
      expect(
        outcome.analysis.files.find(({ file }) => file.path === "main.mjs")
          ?.javascript,
      ).toMatchObject({ parse_status: "complete" });
    } finally {
      await reader.close();
    }
  });
});

it("resolves lazy package and JSON facts without completing their skipped observations", async () => {
  const root = await createTestTempDirectory("rea-js-lazy-json-facts-");
  await writeFixtureFiles(root, {
    "app/first.cjs": 'require("late-pkg"); require("./config.json");\n',
    "app/second.cjs": "module.exports = 2;\n",
    "app/config.json": "true",
    "app/node_modules/late-pkg/package.json": JSON.stringify({
      main: "index.cjs",
    }),
    "app/node_modules/late-pkg/index.cjs": "module.exports = 1;\n",
    "app/vendor/package.json": JSON.stringify({ main: "vendor.cjs" }),
  });
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  const controller = new AbortController();
  const reason = { request: "stop before structured files" };
  const sourcePaths = [
    "app/first.cjs",
    "app/second.cjs",
    "app/node_modules/late-pkg/package.json",
    "app/node_modules/late-pkg/index.cjs",
    "app/config.json",
  ];
  try {
    const files = await readJavaScriptArtifactFiles(
      reader,
      snapshot,
      controller.signal,
      sourcePaths,
    );
    const worker = await createJavaScriptSourceAnalysis(
      { heapMb: 512, timeoutMs: 30_000 },
      1,
    );
    let outcome: Awaited<
      ReturnType<typeof analyzeAndAdoptJavaScriptArtifactFiles>
    >;
    let completedWorkers = 0;
    const projection = createJavaScriptSemanticGraphProjection();
    try {
      const realWorker = worker.analyze.bind(worker);
      outcome = await analyzeAndAdoptJavaScriptArtifactFiles(
        files,
        {
          analyze: async (...args) => {
            const result = await realWorker(...args);
            completedWorkers += 1;
            if (completedWorkers === 2) controller.abort(reason);
            return result;
          },
        },
        projection,
        async () => {},
        controller.signal,
      );
    } finally {
      await worker.close();
    }

    expect(completedWorkers).toBe(2);
    expect(outcome.interruption).toBeInstanceOf(AnalysisCancelledError);
    expect(outcome.interruption?.cause).toBe(reason);
    const analysisByPath = new Map(
      outcome.analysis.files.map((entry) => [entry.file.path, entry]),
    );
    for (const path of sourcePaths.slice(0, 2))
      expect(analysisByPath.get(path)?.javascript).toMatchObject({
        parse_status: "complete",
      });
    for (const path of [
      "app/node_modules/late-pkg/package.json",
      "app/config.json",
    ])
      expect(analysisByPath.get(path)?.analysis_failure?.status).toBe(
        "not-started",
      );
    expect(
      outcome.analysis.packages.some(
        ({ path }) => path === "app/node_modules/late-pkg/package.json",
      ),
    ).toBe(false);
    expect(
      outcome.analysis.json_modules.some(
        ({ path }) => path === "app/config.json",
      ),
    ).toBe(false);

    const graph = await immutableArtifactGraph(
      snapshot,
      files,
      outcome.analysis,
    );
    expect(graph.coverage.status).toBe("partial");
    const packageRelationships = graph.edges.filter(
      ({ relation, properties }) =>
        relation === "imports" &&
        properties.module_link_kind === "require" &&
        properties.specifier === "late-pkg",
    );
    expect(packageRelationships).toHaveLength(1);
    expect(packageRelationships[0]?.properties).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/late-pkg/index.cjs",
    });
    const jsonRelationships = graph.edges.filter(
      ({ relation, properties }) =>
        relation === "imports" &&
        properties.module_link_kind === "require" &&
        properties.specifier === "./config.json",
    );
    expect(jsonRelationships).toHaveLength(1);
    expect(jsonRelationships[0]?.properties).toMatchObject({
      target_file_kind: "json",
      target_json_status: "included",
    });
    for (const [path, operation] of [
      ["app/node_modules/late-pkg/package.json", "parse-package-json"],
      ["app/config.json", "parse-json-module"],
    ] as const)
      expectSkippedStructuredSource(graph, path, operation);
    const excluded = analysisByPath.get("app/vendor/package.json");
    expect(excluded?.file.text).toMatchObject({
      included: false,
      reason: "outside-analysis-scope",
    });
    expect(excluded?.analysis_failure).toBeUndefined();
    expect(
      unknownScopeObservation(graph, "app/vendor/package.json"),
    ).toMatchObject({
      properties: { operation: "select-javascript-sources" },
      evidence: { confidence: "unknown", state: "unavailable" },
    });
  } finally {
    await reader.close();
  }
});

const unknownScopeObservation = (
  graph: JavaScriptApplicationGraph,
  path: string,
) =>
  graph.nodes
    .filter(({ kind }) => kind === "unknown")
    .flatMap(({ observations }) => observations)
    .find(({ properties }) => properties.path === path);

const expectSkippedStructuredSource = (
  graph: JavaScriptApplicationGraph,
  path: string,
  operation: string,
): void => {
  expect(
    graph.nodes.some(
      ({ kind, observations }) =>
        kind === "package" &&
        observations.some(({ properties }) => properties.path === path),
    ),
  ).toBe(false);
  expect(
    graph.nodes
      .filter(({ kind }) => kind === "artifact")
      .flatMap(({ observations }) => observations)
      .find(({ properties }) => properties.path === path),
  ).toMatchObject({ properties: { json_parse_status: null } });
  expect(unknownScopeObservation(graph, path)).toMatchObject({
    properties: { operation, analysis_status: "not-started" },
  });
};

describe("Selected JavaScript source failure diagnostics", () => {
  it("analyzes selected files in first-request order and reports only selected progress", async () => {
    const root = await createTestTempDirectory("rea-js-selected-priority-");
    await writeJavaScriptSourceSelectionFixture(root);
    await writeFile(join(root, "z-later.mjs"), "export const later = 1;\n");
    const progress: string[] = [];
    const result = await analyzeJavaScriptApplication(
      {
        input_path: root,
        source_paths: ["z-later.mjs", "main.mjs", "z-later.mjs"],
      },
      {
        progress: {
          report: async (event) => {
            if (event.phase === "parse_javascript_source")
              progress.push(event.message);
          },
        },
      },
    );
    if (!result.ok) throw result.error;
    const analysis = javascriptApplicationAnalysisResultSchema.parse(
      result.value.normalized_result,
    );
    expect(analysis.source_selection).toEqual({
      requested_paths: ["z-later.mjs", "main.mjs", "z-later.mjs"],
      unselected_files: 5,
    });
    expect(analysis.statistics.parsed_javascript_files).toBe(2);
    expect(progress).toEqual([
      expect.stringContaining("z-later.mjs"),
      expect.stringContaining("main.mjs"),
    ]);
  });

  it("verifies unselected bytes against the inventoried identity without decoding them", async () => {
    const root = await createTestTempDirectory("rea-js-unselected-integrity-");
    await writeJavaScriptSourceSelectionFixture(root);
    const result = await analyzeJavaScriptApplication(
      { input_path: root, source_paths: ["main.mjs"] },
      {
        progress: {
          report: async (event) => {
            if (event.phase === "read_javascript_artifacts")
              await writeFile(
                join(root, "vendor.js"),
                "changed after inventory\n",
              );
          },
        },
      },
    );
    if (result.ok)
      throw new Error(
        "Unselected content changes must still fail integrity verification",
      );
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "artifact_operation_failed",
      details: { reason: "integrity" },
    });
  });

  it("retains selected facts and unselected scope after cancellation between selected sources", async () => {
    const root = await createTestTempDirectory("rea-js-selected-cancellation-");
    await writeJavaScriptSourceSelectionFixture(root);
    await writeFile(join(root, "z-later.mjs"), "export const later = 1;\n");
    const controller = new AbortController();
    const reason = { request: "caller cancelled selected sources" };
    const source_paths = ["main.mjs", "z-later.mjs"];
    const result = await analyzeJavaScriptApplication(
      { input_path: root, source_paths },
      {
        signal: controller.signal,
        progress: {
          report: async (event) => {
            if (
              event.phase === "parse_javascript_source" &&
              event.message.includes("z-later.mjs")
            )
              controller.abort(reason);
          },
        },
      },
    );
    if (result.ok) throw new Error("Expected selected-source cancellation");
    expect(result.error.cause).toBe(reason);
    expect(projectAnalysisError(result.error).code).toBe("cancelled");
    const evidence = parseEvidence(result.error.partialObservation);
    const partial = javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    );
    expect(partial.source_selection).toEqual({
      requested_paths: source_paths,
      unselected_files: 5,
    });
    expect(
      partial.semantic_graph.nodes.some(
        ({ kind, label }) => kind === "function" && label === "selected",
      ),
    ).toBe(true);
    expect(partial.statistics.parsed_javascript_files).toBe(1);
    expect(partial.graph.coverage.status).toBe("partial");
    expect(
      partial.graph.nodes
        .flatMap(({ observations }) =>
          observations.map(({ properties }) => properties),
        )
        .filter(
          (properties) => properties.text_status === "outside-analysis-scope",
        ),
    ).toHaveLength(5);
  });
});

describe("JavaScript application failure diagnostics", () => {
  it("identifies the rejected result field in caller-visible diagnostics", async () => {
    const inputPath = await createTestTempDirectory("rea-js-schema-failure-");
    await writeFile(join(inputPath, "main.js"), "export const value = 1;\n");
    const cause = new z.ZodError([
      {
        code: "custom",
        path: ["semantic_graph", "nodes", 42, "application_node_ids", 0],
        message: "Semantic node references an absent application node",
      },
    ]);
    const result = await analyzeJavaScriptApplication(
      { input_path: inputPath, format: "directory" },
      {
        progress: {
          report: async (event) => {
            if (event.terminal) throw cause;
          },
        },
      },
    );

    if (result.ok) throw new Error("Expected analysis failure");
    expect(result.error.cause).toBe(cause);
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unreadable_output",
      details: {
        operation: "analyze_javascript_application",
        reason:
          "Result schema rejected 1 issue at /semantic_graph/nodes/42/application_node_ids/0 (custom)",
      },
    });
  });

  it("retains unexpected failures and their input identity in caller-visible diagnostics", async () => {
    const inputPath = await createTestTempDirectory("rea-js-failure-");
    await writeFile(join(inputPath, "main.js"), "export const value = 1;\n");
    const cause = new RangeError("Invalid string length");
    // Retain the original failure locally, but never serialize its object graph.
    cause.cause = cause;
    const result = await analyzeJavaScriptApplication(
      { input_path: inputPath, format: "directory" },
      {
        progress: {
          report: async (event) => {
            if (event.terminal) throw cause;
          },
        },
      },
    );
    if (result.ok) throw new Error("Expected analysis failure");
    expect(result.error.cause).toBe(cause);
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "execution_failure",
      details: {
        provider_id: "rea-javascript-application",
        operation: "analyze_javascript_application",
        diagnostics: {
          input_path: inputPath,
          error_name: "RangeError",
          error_message: "Invalid string length",
        },
      },
    });
    const projection = projectAnalysisError(result.error);
    expect(JSON.parse(JSON.stringify(projection))).toEqual(projection);
  });

  it("reports a missing selection as invalid input, not an engine failure", async () => {
    const root = await createTestTempDirectory("rea-js-missing-");
    const result = await analyzeJavaScriptApplication({
      input_path: join(root, "missing"),
      format: "directory",
    });
    if (result.ok) throw new Error("Expected missing artifact failure");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "analyze_javascript_application",
        issues: [{ path: ["input_path"], reason: "invalid_value" }],
      },
    });
  });

  it.each(["reported failure", null])(
    "retains non-Error failures (%s)",
    async (cause) => {
      const inputPath = await createTestTempDirectory("rea-js-non-error-");
      await writeFile(join(inputPath, "main.js"), "export const value = 1;\n");
      const result = await analyzeJavaScriptApplication(
        { input_path: inputPath, format: "directory" },
        {
          progress: {
            report: async (event) => {
              if (event.terminal) throw cause;
            },
          },
        },
      );
      if (result.ok) throw new Error("Expected analysis failure");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "execution_failure",
        details: {
          diagnostics: {
            error_name: "UnknownError",
            error_message:
              typeof cause === "string"
                ? cause
                : "JavaScript analysis failed with a non-Error value",
          },
        },
      });
    },
  );

  it.each([new Error("x".repeat(10_000)), "y".repeat(10_000)])(
    "preserves long failure messages through JSON projection (%#)",
    async (cause) => {
      const inputPath = await createTestTempDirectory("rea-js-oversized-");
      await writeFile(join(inputPath, "main.js"), "export const value = 1;\n");
      const message = cause instanceof Error ? cause.message : cause;
      const result = await analyzeJavaScriptApplication(
        { input_path: inputPath, format: "directory" },
        {
          progress: {
            report: async (event) => {
              if (event.terminal) throw cause;
            },
          },
        },
      );
      if (result.ok) throw new Error("Expected analysis failure");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "execution_failure",
        details: {
          diagnostics: {
            error_message: message,
          },
        },
      });
      const projection = projectAnalysisError(result.error);
      expect(JSON.parse(JSON.stringify(projection))).toEqual(projection);
    },
  );
});

describe("JavaScript application cleanup diagnostics", () => {
  it("preserves cleanup and a complete inventory when translating reader failures", async () => {
    const inputPath = await createTestTempDirectory("rea-js-cleanup-failure-");
    await writeFile(join(inputPath, "main.js"), "export const value = 1;\n");
    const inventory = await scanCanonicalArtifactInventory(inputPath);
    const cleanup = {
      reason: "reader remains open",
      resources: [`JavaScript artifact reader for ${inputPath}`],
    };
    const partialObservation = {
      kind: "artifact-inventory" as const,
      inventory,
    };
    const failure = new ArtifactReaderFailure("io", "Reader cleanup failed", {
      cleanup,
      partialObservation,
    });

    const result = await analyzeJavaScriptApplication(
      { input_path: inputPath, format: "directory" },
      {
        progress: {
          report: async () => {
            throw failure;
          },
        },
      },
    );

    if (result.ok) throw new Error("Expected reader failure");
    expect(result.error).toMatchObject({
      _tag: "ArtifactOperationError",
      cleanup,
      partialObservation,
    });
  });
});
