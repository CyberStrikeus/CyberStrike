import { createHash } from "node:crypto";
import type {
  WebModuleArtifacts,
  WebModuleResolutionPort,
} from "../../src/application/WebModulePorts.js";
import { webScriptExportManifestSchema } from "../../src/domain/webScriptExport.js";
import { ok } from "../../src/domain/result.js";

/** Pure source-owned artifact fixture; no runtime loading is asserted. */
export const webModuleArtifactsFixture = (
  source = 'import "./dep.js"; import(name);',
): WebModuleArtifacts => {
  const path = "/analysis/modules/main.js";
  const sha256 = createHash("sha256").update(source).digest("hex");
  const bytes = Buffer.byteLength(source);
  const manifest = webScriptExportManifestSchema.parse({
    capture_path: "/capture.json",
    capture_sha256: "a".repeat(64),
    capture_kind: "browser-scenario",
    source_evidence_id: null,
    capture_completeness: {
      status: "complete",
      equality_eligible: true,
      missing_sections: [],
      truncated_sections: [],
    },
    output_directory: "/analysis",
    analysis_input: { input_path: "/analysis", format: "directory" },
    limitations: [],
    scripts: [
      {
        url: "https://app.test/main.js?build=1#entry",
        source: {
          kind: "scenario-response",
          transaction_id: "txn",
          request_sequence: 1,
          response_sequence: 2,
          status: 200,
        },
        content: {
          state: "exported",
          relative_path: "modules/main.js",
          layout: "isolated",
          layout_reason: "fixture",
          sha256,
          bytes,
          media_type: "text/javascript",
          redacted: false,
          representation: "browser-decoded-response-bytes",
        },
      },
    ],
  });
  return {
    source,
    manifest,
    manifestFile: {
      path: "/analysis/manifest.json",
      sha256: "b".repeat(64),
      bytes: 100,
    },
    sourceFile: { path, sha256, bytes },
    importMap: null,
  };
};

/** Deterministic port seam for orchestration/schema tests, not native engine proof. */
export const webModuleResolverFixture: WebModuleResolutionPort = {
  resolve: (input) =>
    Promise.resolve(
      ok({
        engine: { id: "fixture", version: "1" },
        resolutions: input.specifiers.map((specifier) => ({
          state: "resolved",
          url: new URL(specifier, input.importerUrl).href,
        })),
        diagnostics: [],
        rawResult: { fixture: true },
      }),
    ),
};

/** Controlled SDK seam for provider finalization, not real Chromium qualification. */
export const completedModuleResolverLauncher =
  (
    request: Parameters<WebModuleResolutionPort["resolve"]>[0],
    close: () => Promise<void>,
  ): import("../../src/browser/modules/NativeModuleResolver.js").ModuleResolverLauncher =>
  async () => {
    const report = {
      importer_url: request.importerUrl,
      entries: request.specifiers.map((specifier) => ({
        specifier,
        resolution: {
          state: "resolved",
          url: new URL(specifier, request.importerUrl).href,
        },
      })),
    };
    const evaluations: unknown[] = [undefined, false, report, undefined];
    return {
      version: () => "controlled-browser",
      newContext: async () => ({
        route: async () => ({
          dispose: async () => undefined,
          [Symbol.asyncDispose]: async () => undefined,
        }),
        newPage: async () => ({
          on: () => {},
          goto: async () => null,
          evaluate: async () => evaluations.shift(),
          waitForFunction: async () => {},
        }),
      }),
      close,
    };
  };
