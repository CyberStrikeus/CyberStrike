import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { webSourceLocationFixture } from "../fixtures/webSourceLocation.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "delivers completed web acquisition identities through CLI and stdio MCP when a later map is missing",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-web-acquisition-cli-");
    const fixture = webSourceLocationFixture();
    const manifestPath = join(root, "manifest.json");
    const sourcePath = join(root, "files", "modules", "main.js");
    const mapPath = join(root, "missing.map");
    const manifest = JSON.stringify(fixture.manifest);
    await mkdir(join(root, "files", "modules"), { recursive: true });
    await writeFile(manifestPath, manifest);
    await writeFile(sourcePath, fixture.source);
    const environment = {
      REA_LOG_LEVEL: "silent",
      REA_BROWSER_EXECUTABLE: "relative-unconfigured-browser",
    };
    const result = await cli.run({
      arguments: [
        "trace-web-source-location",
        manifestPath,
        "0",
        mapPath,
        fixture.sourceMap.url,
        "1",
        "0",
        "--json",
      ],
      environment,
      timeoutMs: 30_000,
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: {
        partial_observation: {
          kind: "web-artifact-acquisition",
          analysis: "not-performed",
          files: [
            {
              role: "manifest",
              file: {
                path: manifestPath,
                sha256: createHash("sha256").update(manifest).digest("hex"),
                bytes: Buffer.byteLength(manifest),
              },
              admission: "manifest-validated",
            },
            {
              role: "source",
              file: {
                path: sourcePath,
                sha256: createHash("sha256")
                  .update(fixture.source)
                  .digest("hex"),
                bytes: Buffer.byteLength(fixture.source),
              },
              admission: "source-verified",
            },
          ],
        },
      },
    });
    const { call } = await connectLocalToolsMcp(environment);
    const response = await call("trace_web_source_location", {
      manifest_path: manifestPath,
      script_index: 0,
      source_map: { path: mapPath, url: fixture.sourceMap.url },
      generated_position: { line: 1, column: 0 },
    });
    expect(parseMcpToolError(response).error).toEqual(result.json);
    expect(response.structuredContent).toBeUndefined();
    expect(result.json).not.toHaveProperty("normalized_result");
  },
  90_000,
);
