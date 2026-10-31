import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { createWebModuleTraceService } from "../../src/composition/webModules.js";
import { createServer } from "../../src/server/createServer.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { webModuleArtifactsFixture } from "../fixtures/webModuleTrace.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "accepts zero-based numeric source indices and returns the same engine-free CLI/MCP trace",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-module-cli-");
    const artifacts = webModuleArtifactsFixture("import(name)");
    const manifest = {
      ...artifacts.manifest,
      output_directory: root,
      analysis_input: { input_path: join(root, "files"), format: "directory" },
    };
    await mkdir(join(root, "files", "modules"), { recursive: true });
    await writeFile(
      join(root, "files", "modules", "main.js"),
      artifacts.source,
    );
    let manifestPath = join(root, "manifest.json").replaceAll("\\", "/");
    await writeFile(manifestPath, JSON.stringify(manifest));
    if (process.platform !== "win32") {
      await mkdir(join(root, "lexical"));
      await mkdir(join(root, "nested"));
      await symlink(join(root, "nested"), join(root, "lexical", "link"));
      manifestPath = `${root}/lexical/link/../manifest.json`;
    }
    const environment = {
      REA_LOG_LEVEL: "silent",
      REA_BROWSER_EXECUTABLE: "relative-missing-browser",
    };
    const cliResponse = await cli.run({
      arguments: ["trace-web-module-imports", manifestPath, "0", "--json"],
      environment: {
        ...environment,
        // This single CLI invocation cannot reuse a newly written cache.
        NODE_DISABLE_COMPILE_CACHE: "1",
      },
      timeoutMs: 15000,
    });
    expect(cliResponse.exitCode, cliResponse.stdout + cliResponse.stderr).toBe(
      0,
    );
    expect(cliResponse.json).toMatchObject({
      normalized_result: {
        engine: null,
        manifest: { path: manifestPath, reported_output_directory: root },
        source: {
          script_index: 0,
          path: join(root, "files", "modules", "main.js"),
        },
        imports: [
          { resolution: { state: "unknown", reason: "computed-specifier" } },
        ],
      },
    });
    const session = createTestBinarySession(() => {
      throw new Error("no binary acquisition");
    });
    const server = createServer(
      { kind: "session", session },
      {
        webModuleTrace: createWebModuleTraceService(environment),
      },
    );
    const client = new Client({ name: "module-cli-parity", version: "1" });
    onTestFinished(async () => {
      await client.close();
      await server.close();
      await session.close();
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: "trace_web_module_imports",
      arguments: { manifest_path: manifestPath, script_index: 0 },
    });
    expect(response.isError).not.toBe(true);
    const expected = cliResponse.json;
    expect(response.structuredContent).toEqual(expected);
  },
);

cliTest(
  "returns a failing outcome when the selected source digest disagrees",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-module-integrity-");
    const artifacts = webModuleArtifactsFixture("export const a = 1;");
    const files = join(root, "files");
    await mkdir(join(files, "modules"), { recursive: true });
    await writeFile(join(files, "modules", "main.js"), "export const a = 2;");
    const manifest = join(root, "manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({
        ...artifacts.manifest,
        output_directory: root,
        analysis_input: { input_path: files, format: "directory" },
      }),
    );
    for (const full of [false, true]) {
      const result = await cli.run({
        arguments: [
          "trace-web-module-imports",
          manifest,
          "0",
          "--json",
          ...(full ? ["--full-output"] : []),
        ],
      });
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      const failure = {
        code: "artifact_integrity_mismatch",
        details: {
          partial_observation: {
            kind: "web-artifact-acquisition",
            analysis: "not-performed",
          },
        },
      };
      if (full)
        expect(result.json).toMatchObject({
          ok: false,
          error: failure,
        });
      else expect(result.json).toMatchObject(failure);
    }
  },
);

cliTest(
  "retains an invalid caller-selected browser path in trace errors",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-module-browser-config-");
    const artifacts = webModuleArtifactsFixture('import "./dep.js"');
    const files = join(root, "files");
    await mkdir(join(files, "modules"), { recursive: true });
    await writeFile(join(files, "modules", "main.js"), artifacts.source);
    const manifest = join(root, "manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({
        ...artifacts.manifest,
        output_directory: root,
        analysis_input: { input_path: files, format: "directory" },
      }),
    );
    const result = await cli.run({
      arguments: ["trace-web-module-imports", manifest, "0", "--json"],
      environment: { REA_BROWSER_EXECUTABLE: "relative/chromium" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "capability_unavailable",
      details: {
        reason: "invalid_browser_executable",
        diagnostics: { executable: "relative/chromium" },
      },
    });
  },
);
