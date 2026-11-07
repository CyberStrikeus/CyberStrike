import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "vitest";

import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { webModuleArtifactsFixture } from "../fixtures/webModuleTrace.js";
import { cliTest } from "../support/cli/cliFixture.js";

const capturedSource = async (bytes: Buffer, reportedUrl: string) => {
  const root = await createTestTempDirectory("rea-web-error-provenance-");
  const { manifest } = webModuleArtifactsFixture("import(name)");
  const script = manifest.scripts[0];
  if (script?.content.state !== "exported") throw new Error("Expected source");
  script.url = reportedUrl;
  script.content.sha256 = createHash("sha256").update(bytes).digest("hex");
  script.content.bytes = bytes.length;
  manifest.output_directory = root;
  manifest.analysis_input = {
    input_path: join(root, "files"),
    format: "directory",
  };
  const sourcePath = join(root, "files", script.content.relative_path);
  const manifestPath = join(root, "manifest.json");
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, bytes);
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, manifest, manifestPath, sourcePath };
};

cliTest(
  "attributes captured source faults and caller-selected map faults through CLI and stdio MCP",
  async ({ cli }) => {
    const { call } = await connectLocalToolsMcp();
    for (const reason of ["format", "path"] as const) {
      const fixture = await capturedSource(
        reason === "format"
          ? Buffer.from([255, 254])
          : Buffer.from("import(name)"),
        "https://app.test/main.js",
      );
      if (reason === "path") {
        const script = fixture.manifest.scripts[0];
        if (script?.content.state !== "exported")
          throw new Error("Expected source");
        script.content.relative_path = "../outside.js";
        await writeFile(fixture.manifestPath, JSON.stringify(fixture.manifest));
      }
      const mapPath = join(fixture.root, "main.js.map");
      await writeFile(
        mapPath,
        '{"version":3,"sources":[],"names":[],"mappings":""}',
      );
      const selections = [
        {
          operation: "trace_web_module_imports",
          arguments: [
            "trace-web-module-imports",
            fixture.manifestPath,
            "0",
            "--json",
          ],
          input: { manifest_path: fixture.manifestPath, script_index: 0 },
        },
        {
          operation: "trace_web_source_location",
          arguments: [
            "trace-web-source-location",
            fixture.manifestPath,
            "0",
            mapPath,
            "https://app.test/main.js.map",
            "1",
            "0",
            "--json",
          ],
          input: {
            manifest_path: fixture.manifestPath,
            script_index: 0,
            source_map: { path: mapPath, url: "https://app.test/main.js.map" },
            generated_position: { line: 1, column: 0 },
          },
        },
      ];
      for (const selection of selections) {
        const response = await cli.run({ arguments: selection.arguments });
        expect(response.exitCode, response.stdout + response.stderr).toBe(1);
        const mcp = parseMcpToolError(
          await call(selection.operation, selection.input),
        );
        for (const error of [response.json, mcp.error])
          expect(error).toMatchObject({
            code: "artifact_operation_failed",
            details: {
              operation: selection.operation,
              reason,
              detail: expect.stringContaining(
                reason === "format" ? fixture.sourcePath : "../outside.js",
              ),
            },
          });
      }
    }

    const fixture = await capturedSource(
      Buffer.from("import(name)"),
      "https://app.test/main.js",
    );
    const mapPath = join(fixture.root, "invalid.map");
    await writeFile(mapPath, Buffer.from([255, 254]));
    for (const selection of [
      {
        operation: "trace_web_module_imports",
        arguments: [
          "trace-web-module-imports",
          fixture.manifestPath,
          "0",
          "--import-map-path",
          mapPath,
          "--import-map-base-url",
          "https://app.test/",
          "--json",
        ],
        input: {
          manifest_path: fixture.manifestPath,
          script_index: 0,
          import_map: { path: mapPath, base_url: "https://app.test/" },
        },
        field: ["import_map", "path"],
      },
      {
        operation: "trace_web_source_location",
        arguments: [
          "trace-web-source-location",
          fixture.manifestPath,
          "0",
          mapPath,
          "https://app.test/main.js.map",
          "1",
          "0",
          "--json",
        ],
        input: {
          manifest_path: fixture.manifestPath,
          script_index: 0,
          source_map: { path: mapPath, url: "https://app.test/main.js.map" },
          generated_position: { line: 1, column: 0 },
        },
        field: ["source_map", "path"],
      },
    ]) {
      const response = await cli.run({ arguments: selection.arguments });
      expect(response.exitCode, response.stdout + response.stderr).toBe(1);
      const mcp = parseMcpToolError(
        await call(selection.operation, selection.input),
      );
      for (const error of [response.json, mcp.error])
        expect(error).toMatchObject({
          code: "invalid_request",
          details: {
            issues: [{ path: selection.field, reason: "invalid_format" }],
          },
        });
    }
  },
  120_000,
);

cliTest(
  "requires usable reported context and honors an explicit importer through CLI and stdio MCP",
  async ({ cli }) => {
    const { call } = await connectLocalToolsMcp();
    for (const reportedUrl of ["not a URL", "file:///captured/main.js"]) {
      const fixture = await capturedSource(
        Buffer.from("import(name)"),
        reportedUrl,
      );
      const response = await cli.run({
        arguments: [
          "trace-web-module-imports",
          fixture.manifestPath,
          "0",
          "--json",
        ],
      });
      expect(response.exitCode, response.stdout + response.stderr).toBe(1);
      const mcp = parseMcpToolError(
        await call("trace_web_module_imports", {
          manifest_path: fixture.manifestPath,
          script_index: 0,
        }),
      );
      for (const error of [response.json, mcp.error])
        expect(error).toMatchObject({
          code: "capability_unavailable",
          details: {
            reason: reportedUrl.startsWith("file:")
              ? "unsupported_context_scheme"
              : "reported_source_context_unavailable",
          },
        });
      const importerUrl = "https://selected.test/base/main.js";
      const selected = await cli.run({
        arguments: [
          "trace-web-module-imports",
          fixture.manifestPath,
          "0",
          "--importer-url",
          importerUrl,
          "--json",
        ],
      });
      expect(selected.exitCode, selected.stdout + selected.stderr).toBe(0);
      const selectedMcp = await call("trace_web_module_imports", {
        manifest_path: fixture.manifestPath,
        script_index: 0,
        importer_url: importerUrl,
      });
      expect(selectedMcp.isError).not.toBe(true);
      expect(selectedMcp.structuredContent).toEqual(selected.json);
      expect(selected.json).toMatchObject({
        parameters: { importer_url: importerUrl },
        normalized_result: {
          source: { script: { url: reportedUrl } },
          importer: { url: importerUrl, basis: "caller-selected" },
          engine: null,
        },
      });
    }
  },
  120_000,
);
