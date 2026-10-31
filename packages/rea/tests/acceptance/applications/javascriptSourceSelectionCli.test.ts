import { createPackageWithOptions } from "@electron/asar";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { JAVASCRIPT_SEMANTIC_RELATION_FAMILIES } from "../../../src/domain/javascript/javascriptSemanticGraphSchemas.js";
import { writeJavaScriptSourceSelectionFixture } from "../../fixtures/javascriptSourceSelection.js";
import {
  asarHeaderBytes,
  prependAsarJsonWhitespace,
} from "../../fixtures/asarHeader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for([
  { format: "directory", command: "analyze" },
  { format: "asar", command: "analyze-javascript-application" },
])(
  "analyzes selected $format sources through $command with complete artifact identity",
  { timeout: 60_000 },
  async ({ format, command }, { cli }) => {
    const directory = await createTestTempDirectory("rea-js-source-selection-");
    const files = await writeJavaScriptSourceSelectionFixture(directory);
    let input = directory;
    if (format === "asar") {
      input = join(
        await createTestTempDirectory("rea-js-selected-asar-"),
        "app.asar",
      );
      await createPackageWithOptions(directory, input, {});
    }
    const requested = ["main.mjs", "package.json", "main.mjs"];
    const response = await cli.run({
      arguments: [
        command,
        input,
        ...requested.flatMap((path) => ["--source-path", path]),
        "--format",
        "json",
      ],
    });
    expect(response.exitCode).toBe(0);
    const evidence = parseEvidence(response.json);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    );
    expect(result.source_selection).toEqual({
      requested_paths: requested,
      unselected_files: 4,
    });
    expect(evidence.parameters.source_paths).toEqual(requested);
    expect(result.statistics).toMatchObject({
      relevant_files: 6,
      parsed_javascript_files: 1,
      invalid_utf8_files: 0,
      parse_failures: 0,
      text_bytes_read:
        files.get("main.mjs")!.length + files.get("package.json")!.length,
    });
    expect(result.graph.coverage.status).toBe("partial");
    expect(result.semantic_graph.coverage).toMatchObject({
      status: "partial",
      truncated: false,
    });
    expect(
      result.semantic_graph.nodes.some(
        ({ kind, label }) => kind === "function" && label === "selected",
      ),
    ).toBe(true);
    expect(
      result.semantic_graph.unknowns.some(
        ({ reason, detail }) =>
          reason === "incomplete-module" &&
          detail.includes("caller-selected source_paths"),
      ),
    ).toBe(true);
    for (const [path, bytes] of files) {
      const properties = result.graph.nodes
        .flatMap(({ observations }) =>
          observations.map(({ properties }) => properties),
        )
        .find(
          (properties) =>
            properties.path === path && properties.text_status !== undefined,
        );
      expect(properties?.text_status).toBe(
        requested.includes(path) ? "included" : "outside-analysis-scope",
      );
      expect(properties?.parse_status).toBe(
        path === "main.mjs" ? "complete" : null,
      );
      if (/\.(?:mjs|js)$/u.test(path))
        expect(properties?.analysis_coverage).toMatchObject({
          syntax: {
            status: requested.includes(path) ? "complete" : "not-examined",
          },
          examination: {
            status: requested.includes(path) ? "complete" : "not-examined",
          },
        });
      expect(Buffer.compare(await readFile(join(directory, path)), bytes)).toBe(
        0,
      );
    }
    const fullResponse = await cli.run({
      arguments: [command, input, "--format", "json"],
    });
    expect(fullResponse.exitCode).toBe(0);
    const full = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(fullResponse.json).normalized_result,
    );
    expect(full.source_selection).toBeUndefined();
    expect(full.statistics.invalid_utf8_files).toBe(1);
    const unavailableModule = full.semantic_graph.nodes.find(
      ({ kind, identity }) =>
        kind === "module" && identity.module_path === "invalid.mjs",
    );
    expect(unavailableModule).toBeDefined();
    expect(
      full.semantic_graph.unknowns.filter(
        ({ node_id, detail }) =>
          node_id === unavailableModule?.node_id &&
          detail.includes("not valid UTF-8"),
      ),
    ).toHaveLength(JAVASCRIPT_SEMANTIC_RELATION_FAMILIES.length);
    const unparsedModule = full.semantic_graph.nodes.find(
      ({ kind, identity }) =>
        kind === "module" && identity.module_path === "vendor.js",
    );
    expect(unparsedModule).toBeDefined();
    expect(
      full.semantic_graph.unknowns.filter(
        ({ node_id, detail, reason }) =>
          node_id === unparsedModule?.node_id &&
          reason === "incomplete-module" &&
          detail.includes("syntax could not be parsed"),
      ),
    ).toHaveLength(JAVASCRIPT_SEMANTIC_RELATION_FAMILIES.length);
    expect(full.semantic_graph.coverage).toMatchObject({
      status: "partial",
      truncated: false,
      omitted_nodes: null,
      omitted_relations: null,
    });
    expect(full.statistics.parse_failures).toBeGreaterThan(0);
    expect([
      result.root_artifact_sha256,
      result.inventory_manifest_id,
      result.inventory_graph_sha256,
    ]).toEqual([
      full.root_artifact_sha256,
      full.inventory_manifest_id,
      full.inventory_graph_sha256,
    ]);
    if (format === "asar")
      expect(result.root_artifact_sha256).toBe(
        createHash("sha256")
          .update(await readFile(input))
          .digest("hex"),
      );
  },
);

cliTest(
  "rejects source selection when an explicit provider chooses the native lane",
  async ({ cli }) => {
    const directory = await createTestTempDirectory(
      "rea-js-source-native-refusal-",
    );
    await writeJavaScriptSourceSelectionFixture(directory);
    const response = await cli.run({
      arguments: [
        "analyze",
        directory,
        "--provider",
        "ghidra",
        "--source-path",
        "main.mjs",
        "--format",
        "json",
      ],
    });
    expect(response.exitCode).toBe(1);
    expect(response.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [{ path: ["source_paths"], reason: "invalid_value" }],
      },
    });
  },
);

cliTest.for([
  { command: "analyze", source: "file", format: "asar" },
  {
    command: "analyze-javascript-application",
    source: "inline",
    format: "directory",
  },
])(
  "appends $source --source-paths-json selections for $format through $command",
  { timeout: 60_000 },
  async ({ command, source, format }, { cli }) => {
    const directory = await createTestTempDirectory(
      "rea-js-source-paths-json-",
    );
    await writeJavaScriptSourceSelectionFixture(directory);
    let target = directory;
    if (format === "asar") {
      target = join(
        await createTestTempDirectory("rea-js-json-selected-asar-"),
        "app.asar",
      );
      await createPackageWithOptions(directory, target, {});
    }
    const listed = ["main.mjs", "package.json"];
    let sourcePathsJson = JSON.stringify(listed);
    if (source === "file") {
      sourcePathsJson = join(
        await createTestTempDirectory("rea-js-source-paths-list-"),
        "paths.json",
      );
      await writeFile(sourcePathsJson, JSON.stringify(listed));
    }
    const response = await cli.run({
      arguments: [
        command,
        target,
        "--source-path",
        "package.json",
        "--source-paths-json",
        sourcePathsJson,
        "--format",
        "json",
      ],
    });
    expect(response.exitCode).toBe(0);
    const evidence = parseEvidence(response.json);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    );
    const requested = ["package.json", ...listed];
    expect(result.source_selection).toEqual({
      requested_paths: requested,
      unselected_files: 4,
    });
    expect(evidence.parameters.source_paths).toEqual(requested);
    expect(result.statistics.parsed_javascript_files).toBe(1);
    if (format === "asar") {
      expect(evidence.subject).toMatchObject({
        local_path: target,
        digest: {
          sha256: createHash("sha256")
            .update(await readFile(target))
            .digest("hex"),
        },
      });
    }
  },
);

cliTest.for([
  { label: "an object", value: '{"paths":["main.mjs"]}', path: [] },
  { label: "an empty array", value: "[]", path: [] },
  { label: "a blank entry", value: '["main.mjs",""]', path: [1] },
])(
  "rejects --source-paths-json holding $label",
  async ({ value, path }, { cli }) => {
    const directory = await createTestTempDirectory(
      "rea-js-source-paths-json-invalid-",
    );
    await writeJavaScriptSourceSelectionFixture(directory);
    const response = await cli.run({
      arguments: [
        "analyze-javascript-application",
        directory,
        "--source-paths-json",
        value,
        "--format",
        "json",
      ],
    });
    expect(response.exitCode).toBe(1);
    expect(response.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [{ path: ["source_paths_json", ...path] }],
      },
    });
  },
);

cliTest(
  "rejects --source-paths-json when an explicit provider chooses the native lane",
  async ({ cli }) => {
    const directory = await createTestTempDirectory(
      "rea-js-source-paths-json-native-refusal-",
    );
    await writeJavaScriptSourceSelectionFixture(directory);
    const response = await cli.run({
      arguments: [
        "analyze",
        directory,
        "--provider",
        "ghidra",
        "--source-paths-json",
        '["main.mjs"]',
        "--format",
        "json",
      ],
    });
    expect(response.exitCode).toBe(1);
    expect(response.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [{ path: ["source_paths"], reason: "invalid_value" }],
      },
    });
  },
);

cliTest(
  "accepts legal ASAR JSON whitespace while preserving selected-source identity",
  { timeout: 60_000 },
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-asar-whitespace-");
    await writeJavaScriptSourceSelectionFixture(root);
    const archive = join(
      await createTestTempDirectory("rea-js-asar-whitespace-output-"),
      "app.asar",
    );
    await createPackageWithOptions(root, archive, {});

    for (const prefix of [" \t\r\n", " ".repeat(9_001)]) {
      await prependAsarJsonWhitespace(archive, prefix);
      const response = await cli.run({
        arguments: [
          "analyze-javascript-application",
          archive,
          "--source-path",
          "main.mjs",
          "--format",
          "json",
        ],
      });
      expect(response.exitCode).toBe(0);
      const evidence = parseEvidence(response.json);
      const result = javascriptApplicationAnalysisResultSchema.parse(
        evidence.normalized_result,
      );
      expect(result.statistics).toMatchObject({
        nested_asar_containers: 0,
        parsed_javascript_files: 1,
        parse_failures: 0,
      });
      expect(result.semantic_graph.nodes).toContainEqual(
        expect.objectContaining({ kind: "function", label: "selected" }),
      );
      expect(result.root_artifact_sha256).toBe(
        createHash("sha256")
          .update(await readFile(archive))
          .digest("hex"),
      );
    }
  },
);

cliTest(
  "does not parse ASAR-looking JSON beyond the declared JSON extent",
  async ({ cli }) => {
    const archive = join(
      await createTestTempDirectory("rea-js-asar-padding-output-"),
      "opaque.asar",
    );
    await writeFile(
      archive,
      asarHeaderBytes("  ", {
        padding: Buffer.from('{"files":{"main.mjs":{"size":0,"offset":"0"}}}'),
      }),
    );
    const response = await cli.run({
      arguments: [
        "analyze-javascript-application",
        archive,
        "--format",
        "json",
      ],
    });
    expect(response.exitCode).toBe(1);
    expect(response.json).toMatchObject({
      code: "artifact_operation_failed",
      details: { reason: "format" },
    });
  },
);
