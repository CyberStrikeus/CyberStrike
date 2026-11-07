import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { expect, onTestFinished } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { webSourceLocationFixture } from "../fixtures/webSourceLocation.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "accepts numeric UTF-16 coordinates and runs the actual owned source-map codec without a browser",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-source-map-cli-");
    const fixture = webSourceLocationFixture(
      JSON.stringify({
        version: 3,
        sources: ["dir/original.ts", "dir//original.ts"],
        sourcesContent: ["original", "second"],
        names: [],
        mappings: "AAAA,ACAA",
      }),
    );
    await mkdir(join(root, "files", "modules"), { recursive: true });
    await writeFile(join(root, "files", "modules", "main.js"), fixture.source);
    let manifest = join(root, "manifest.json").replaceAll("\\", "/");
    const map = join(root, "app.js.map");
    await writeFile(manifest, JSON.stringify(fixture.manifest));
    if (process.platform !== "win32") {
      await mkdir(join(root, "lexical"));
      await mkdir(join(root, "nested"));
      await symlink(join(root, "nested"), join(root, "lexical", "link"));
      manifest = `${root}/lexical/link/../manifest.json`;
    }
    await writeFile(map, fixture.sourceMap.text);
    const response = await cli.run({
      arguments: [
        "trace-web-source-location",
        manifest,
        "0",
        map,
        fixture.sourceMap.url,
        "1",
        "0",
        "--json",
      ],
      environment: {
        REA_LOG_LEVEL: "silent",
        REA_BROWSER_EXECUTABLE: "relative-unconfigured-browser",
        CLANG_MODULE_CACHE_PATH: map,
      },
      timeoutMs: 45000,
    });
    expect(response.exitCode, response.stdout + response.stderr).toBe(0);
    expect(response.json).toMatchObject({
      normalized_result: {
        manifest: {
          path: manifest,
          reported_output_directory: fixture.manifest.output_directory,
        },
        source: {
          script_index: 0,
          path: join(root, "files", "modules", "main.js"),
        },
        source_map: { association: "caller-selected" },
        generated_offset: 0,
        execution: "unknown",
        matches: [
          {
            source_index: 0,
            resolved_url: "https://app.test/dir/original.ts",
            content: { text: "original" },
          },
          {
            source_index: 1,
            resolved_url: "https://app.test/dir//original.ts",
            content: { text: "second" },
          },
        ],
        runtime: {
          id: process.versions.bun === undefined ? "node-v8" : "bun",
        },
      },
    });
    const limitation =
      "Source names and sourceRoot are reported declarations. REA derives resolved URLs using WHATWG URL resolution; the pinned upstream codec decodes mappings. No original source is fetched or executed.";
    expect(response.json).toMatchObject({
      limitations: expect.arrayContaining([limitation]),
      normalized_result: { limitations: expect.arrayContaining([limitation]) },
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(new URL("../../scripts/rea.mjs", import.meta.url)),
        "mcp",
      ],
      env: {
        ...getDefaultEnvironment(),
        REA_LOG_LEVEL: "silent",
        CLANG_MODULE_CACHE_PATH: map,
      },
      stderr: "pipe",
    });
    const client = new Client({
      name: "source-location-cli-parity",
      version: "1",
    });
    onTestFinished(async () => {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    });
    await client.connect(transport);
    const mcpResponse = await client.callTool({
      name: "trace_web_source_location",
      arguments: {
        manifest_path: manifest,
        script_index: 0,
        source_map: { path: map, url: fixture.sourceMap.url },
        generated_position: { line: 1, column: 0 },
      },
    });
    expect(mcpResponse.isError, JSON.stringify(mcpResponse)).not.toBe(true);
    expect(mcpResponse.structuredContent).toEqual(response.json);
    const invalid = await cli.run({
      arguments: [
        "trace-web-source-location",
        manifest,
        "0",
        map,
        fixture.sourceMap.url,
        "2",
        "0",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
      timeoutMs: 45000,
    });
    expect(invalid.exitCode).toBe(1);
    expect(invalid.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [{ path: ["generated_position"] }],
        partial_observation: {
          kind: "web-trace-observation",
          analysis: "incomplete",
          manifest: { path: manifest },
          source: { path: join(root, "files", "modules", "main.js") },
          source_map: {
            path: map,
            sha256: createHash("sha256")
              .update(fixture.sourceMap.text)
              .digest("hex"),
          },
        },
      },
    });
  },
  // Allow cold CLI and MCP ownership preparation across the full parity sequence.
  180_000,
);

cliTest(
  "applies the shared version constraint to nested indexed maps through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-indexed-map-version-");
    const fixture = webSourceLocationFixture();
    await mkdir(join(root, "files", "modules"), { recursive: true });
    await writeFile(join(root, "files", "modules", "main.js"), fixture.source);
    const manifest = join(root, "manifest.json").replaceAll("\\", "/");
    await writeFile(manifest, JSON.stringify(fixture.manifest));
    const { call } = await connectLocalToolsMcp({
      REA_BROWSER_EXECUTABLE: "relative-unconfigured-browser",
    });
    const leaf: unknown = JSON.parse(fixture.sourceMap.text);
    for (const [index, version] of [3, 2, null, undefined, "3"].entries()) {
      const text = JSON.stringify({
        version: 3,
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: {
              version,
              sections: [{ offset: { line: 0, column: 0 }, map: leaf }],
            },
          },
        ],
      });
      const path = join(root, `nested-${index}.map`);
      await writeFile(path, text);
      const result = await cli.run({
        arguments: [
          "trace-web-source-location",
          manifest,
          "0",
          path,
          fixture.sourceMap.url,
          "1",
          "0",
          "--json",
        ],
        environment: {
          REA_LOG_LEVEL: "silent",
          REA_BROWSER_EXECUTABLE: "relative-unconfigured-browser",
        },
        timeoutMs: 45_000,
      });
      const response = await call("trace_web_source_location", {
        manifest_path: manifest,
        script_index: 0,
        source_map: { path, url: fixture.sourceMap.url },
        generated_position: { line: 1, column: 0 },
      });
      if (version === 3) {
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.json).toMatchObject({
          normalized_result: {
            matches: [
              {
                state: "mapped",
                section_path: [0, 0],
                content: { text: "original" },
              },
            ],
          },
        });
        expect(response.isError, JSON.stringify(response)).not.toBe(true);
        expect(response.structuredContent).toEqual(result.json);
      } else {
        const failure = {
          code: "invalid_request",
          details: {
            partial_observation: {
              kind: "web-trace-observation",
              analysis: "incomplete",
              manifest: {
                path: manifest,
                sha256: createHash("sha256")
                  .update(JSON.stringify(fixture.manifest))
                  .digest("hex"),
              },
              source: {
                path: join(root, "files", "modules", "main.js"),
                sha256: createHash("sha256")
                  .update(fixture.source)
                  .digest("hex"),
              },
              source_map: {
                path,
                sha256: createHash("sha256").update(text).digest("hex"),
                bytes: Buffer.byteLength(text),
              },
            },
            issues: [
              {
                path: ["source_map", "path"],
                reason: "invalid_format",
                message: expect.stringContaining(
                  "not a version 3 map. Section path: [0].",
                ),
              },
            ],
          },
        };
        expect(result.exitCode).toBe(1);
        expect(result.json).toMatchObject(failure);
        expect(result.json).not.toHaveProperty("normalized_result");
        expect(parseMcpToolError(response).error).toMatchObject(failure);
        expect(response.structuredContent).toBeUndefined();
      }
    }
  },
  180_000,
);

cliTest(
  "traces empty equal-offset sections while rejecting decreasing offsets and represented overlaps",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-empty-indexed-map-");
    const fixture = webSourceLocationFixture();
    await mkdir(join(root, "files", "modules"), { recursive: true });
    await writeFile(join(root, "files", "modules", "main.js"), fixture.source);
    const manifest = join(root, "manifest.json").replaceAll("\\", "/");
    await writeFile(manifest, JSON.stringify(fixture.manifest));
    const { call } = await connectLocalToolsMcp();
    const leaf: unknown = JSON.parse(fixture.sourceMap.text);
    const empty = { version: 3, sources: [], names: [], mappings: "" };
    const nestedEmpty = {
      version: 3,
      sections: [{ offset: { line: 0, column: 0 }, map: empty }],
    };
    for (const [index, sample] of [
      { first: empty, firstColumn: 0, nextColumn: 0, succeeds: true },
      { first: nestedEmpty, firstColumn: 0, nextColumn: 0, succeeds: true },
      { first: empty, firstColumn: 0, nextColumn: 1, succeeds: true },
      { first: leaf, firstColumn: 0, nextColumn: 0, succeeds: false },
      { first: empty, firstColumn: 1, nextColumn: 0, succeeds: false },
    ].entries()) {
      const path = join(root, `empty-${index}.map`);
      await writeFile(
        path,
        JSON.stringify({
          version: 3,
          sections: [
            {
              offset: { line: 0, column: sample.firstColumn },
              map: sample.first,
            },
            { offset: { line: 0, column: sample.nextColumn }, map: leaf },
          ],
        }),
      );
      const result = await cli.run({
        arguments: [
          "trace-web-source-location",
          manifest,
          "0",
          path,
          fixture.sourceMap.url,
          "1",
          String(sample.nextColumn),
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
        timeoutMs: 45_000,
      });
      const response = await call("trace_web_source_location", {
        manifest_path: manifest,
        script_index: 0,
        source_map: { path, url: fixture.sourceMap.url },
        generated_position: { line: 1, column: sample.nextColumn },
      });
      if (sample.succeeds) {
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.json).toMatchObject({
          normalized_result: {
            lookup: {
              matched_generated_position: {
                line: 1,
                column: sample.nextColumn,
              },
            },
            matches: [
              {
                state: "mapped",
                section_path: [1],
                content: { text: "original" },
              },
            ],
          },
        });
        expect(response.isError, JSON.stringify(response)).not.toBe(true);
        expect(response.structuredContent).toEqual(result.json);
      } else {
        const failure = {
          code: "invalid_request",
          details: {
            issues: [
              {
                path: ["source_map", "path"],
                reason: "invalid_format",
                message: expect.stringMatching(/overlap|nondecreasing/u),
              },
            ],
          },
        };
        expect(result.exitCode).toBe(1);
        expect(result.json).toMatchObject(failure);
        expect(parseMcpToolError(response).error).toMatchObject(failure);
      }
    }
  },
  180_000,
);

cliTest(
  "resolves empty-sourceRoot sources against the map URL through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-empty-source-root-");
    // webpack 5 and tsc emit `"sourceRoot": ""` for map-relative sources.
    const text = JSON.stringify({
      version: 3,
      sourceRoot: "",
      sources: ["../src/a.ts", "webpack://app/./src/b.ts", "dir//c.ts"],
      sourcesContent: ["a", "b", "c"],
      names: [],
      mappings: "AAAA,ACAA,ACAA",
    });
    const fixture = webSourceLocationFixture(text);
    await mkdir(join(root, "files", "modules"), { recursive: true });
    await writeFile(join(root, "files", "modules", "main.js"), fixture.source);
    const manifest = join(root, "manifest.json").replaceAll("\\", "/");
    await writeFile(manifest, JSON.stringify(fixture.manifest));
    const map = join(root, "app.js.map");
    await writeFile(map, text);
    const url = "https://cdn.test/npm/app@1/dist/app.js.map";
    const result = await cli.run({
      arguments: [
        "trace-web-source-location",
        manifest,
        "0",
        map,
        url,
        "1",
        "0",
        "--json",
      ],
      environment: {
        REA_LOG_LEVEL: "silent",
        REA_BROWSER_EXECUTABLE: "relative-unconfigured-browser",
      },
      timeoutMs: 45_000,
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(result.json).toMatchObject({
      normalized_result: {
        matches: [
          {
            source_index: 0,
            reported_source_root: "",
            resolved_url: "https://cdn.test/npm/app@1/src/a.ts",
          },
          {
            source_index: 1,
            reported_source_root: "",
            resolved_url: "webpack://app/src/b.ts",
          },
          {
            source_index: 2,
            reported_source_root: "",
            resolved_url: "https://cdn.test/npm/app@1/dist/dir//c.ts",
          },
        ],
      },
    });
    const { call } = await connectLocalToolsMcp({
      REA_BROWSER_EXECUTABLE: "relative-unconfigured-browser",
    });
    const response = await call("trace_web_source_location", {
      manifest_path: manifest,
      script_index: 0,
      source_map: { path: map, url },
      generated_position: { line: 1, column: 0 },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(response.structuredContent).toEqual(result.json);
  },
  180_000,
);
