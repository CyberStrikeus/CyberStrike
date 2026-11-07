import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { WebModuleTraceService } from "../../../src/application/WebModuleTraceService.js";
import { LocalWebModuleArtifacts } from "../../../src/browser/modules/WebModuleArtifacts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  webModuleTraceResultSchema,
  type WebModuleResolutionRequest,
} from "../../../src/domain/webModuleTrace.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  webModuleArtifactsFixture,
  webModuleResolverFixture,
} from "../../fixtures/webModuleTrace.js";

it.each([
  {
    source: 'const order = left < import("./dep.js") > (right);',
    expected: ["./dep.js"],
  },
  {
    source:
      'const fn = c ? x => import("./a.js") : y => import("./b.js"); import("./c.js");',
    expected: ["./a.js", "./b.js", "./c.js"],
  },
])(
  "retains JavaScript imports and requests resolution through public MCP: $source",
  async ({ source, expected }) => {
    const root = await createTestTempDirectory("rea-module-grammar-");
    const original = webModuleArtifactsFixture(source);
    const manifest = {
      ...original.manifest,
      output_directory: root,
      scripts: original.manifest.scripts.map((script) => ({
        ...script,
        url: "https://app.test/main.ts?build=1#entry",
      })),
    };
    const sourcePath = join(root, "files", "modules", "main.js");
    const manifestPath = join(root, "manifest.json");
    await mkdir(join(root, "files", "modules"), { recursive: true });
    await writeFile(sourcePath, source);
    const manifestText = JSON.stringify(manifest);
    await writeFile(manifestPath, manifestText);
    const requests: WebModuleResolutionRequest[] = [];
    const service = new WebModuleTraceService(new LocalWebModuleArtifacts(), {
      resolve: async (request) => {
        requests.push(request);
        return webModuleResolverFixture.resolve(request);
      },
    });
    const session = createTestBinarySession(() => {
      throw new Error(
        "Retained module tracing must not acquire a binary provider",
      );
    });
    const { client } = await createApplicationMcpHarness({
      session,
      serverOptions: { webModuleTrace: service },
      clientIdentity: { name: "module-grammar", version: "1" },
    });
    const response = await client.callTool({
      name: "trace_web_module_imports",
      arguments: { manifest_path: manifestPath, script_index: 0 },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const evidence = parseEvidence(response.structuredContent);
    const result = webModuleTraceResultSchema.parse(evidence.normalized_result);
    expect(requests).toEqual([
      {
        importerUrl: manifest.scripts[0]!.url,
        importMap: null,
        specifiers: expected,
      },
    ]);
    expect(result).toMatchObject({
      source: {
        path: sourcePath,
        sha256: original.sourceFile.sha256,
        bytes: original.sourceFile.bytes,
      },
      parser: { state: "parsed", diagnostics: [] },
      engine: { id: "fixture", version: "1" },
    });
    expect(
      result.imports.map(({ kind, specifier, resolution, execution }) => ({
        kind,
        specifier,
        resolution,
        execution,
      })),
    ).toEqual(
      expected.map((specifier) => ({
        kind: "dynamic-import",
        specifier,
        resolution: {
          state: "resolved",
          url: new URL(specifier, manifest.scripts[0]!.url).href,
        },
        execution: "unknown",
      })),
    );
    for (const reference of result.imports)
      expect(source.slice(reference.start.offset, reference.end.offset)).toBe(
        reference.expression,
      );
    expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);
    expect(await readFile(sourcePath, "utf8")).toBe(source);
    expect(await readFile(manifestPath, "utf8")).toBe(manifestText);
    await client.ping();
  },
);
