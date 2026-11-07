import { describe, expect, it } from "vitest";
import { WebModuleTraceService } from "./WebModuleTraceService.js";
import { err, ok } from "../domain/result.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  webModuleTraceResultSchema,
  type WebModuleResolution,
  type WebModuleResolutionRequest,
} from "../domain/webModuleTrace.js";
import {
  webModuleArtifactsFixture,
  webModuleResolverFixture,
} from "../../tests/fixtures/webModuleTrace.js";

import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { parseEvidence } from "../domain/evidence.js";

const args = { manifest_path: "/analysis/manifest.json", script_index: 0 };
it.each([
  { ...args, importer_url: "file:///tmp/main.js" },
  { ...args, import_map: { path: "/map.json", base_url: "file:///tmp/maps/" } },
])(
  "distinguishes valid unsupported URL contexts from malformed input: %j",
  async (input) => {
    const result = await new WebModuleTraceService(
      {
        load: () => {
          throw new Error("must not acquire artifacts");
        },
      },
      webModuleResolverFixture,
    ).trace(input);
    if (result.ok) throw new Error("expected unsupported context");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "capability_unavailable",
      message: expect.stringContaining("file:"),
    });
  },
);
it("rejects source text changed across the artifact port while retaining the original digest", async () => {
  const artifacts = {
    ...webModuleArtifactsFixture("import(name)"),
    source: "import(other)",
  };
  const result = await new WebModuleTraceService(
    { load: () => Promise.resolve(ok(artifacts)) },
    {
      resolve: () => {
        throw new Error("must not acquire engine");
      },
    },
  ).trace(args);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error._tag).toBe("AnalysisOutputError");
});
it("rejects sparse resolver arrays rather than relabeling literal imports as computed unknowns", async () => {
  const artifacts = webModuleArtifactsFixture('import "./dep.js";');
  const resolutions: WebModuleResolution[] = [];
  resolutions.length = 1;
  const service = new WebModuleTraceService(
    { load: () => Promise.resolve(ok(artifacts)) },
    {
      resolve: () =>
        Promise.resolve(
          ok({
            engine: { id: "fixture", version: "1" },
            resolutions,
            diagnostics: [],
            rawResult: {},
          }),
        ),
    },
  );
  const result = await service.trace(args);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error._tag).toBe("AnalysisOutputError");
});
describe("selected module trace workflow", () => {
  it.each([
    { ...args, manifest_path: "relative.json" },
    {
      ...args,
      import_map: { path: "relative.json", base_url: "https://app.test/" },
    },
    { ...args, importer_url: "not a URL" },
    { ...args, import_map: { path: "/map.json", base_url: "relative" } },
  ])(
    "rejects malformed context before acquiring artifacts: %j",
    async (input) => {
      const service = new WebModuleTraceService(
        {
          load: () => {
            throw new Error("must not acquire");
          },
        },
        webModuleResolverFixture,
      );
      const response = await service.trace(input);
      if (response.ok) throw new Error("expected invalid input");
      expect(projectAnalysisError(response.error)).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [expect.objectContaining({ reason: "invalid_format" })],
        },
      });
    },
  );
  it("rejects incomplete resolution rather than fabricating unknown values", async () => {
    const artifacts = webModuleArtifactsFixture();
    const service = new WebModuleTraceService(
      { load: () => Promise.resolve(ok(artifacts)) },
      {
        resolve: () =>
          Promise.resolve(
            ok({
              engine: { id: "fixture", version: "1" },
              resolutions: [],
              diagnostics: [],
              rawResult: {},
            }),
          ),
      },
    );
    const response = await service.trace(args);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error._tag).toBe("AnalysisOutputError");
  });
  it("preserves an explicit selected importer context", async () => {
    const artifacts = webModuleArtifactsFixture();
    const result = await new WebModuleTraceService(
      { load: () => Promise.resolve(ok(artifacts)) },
      webModuleResolverFixture,
    ).trace({ ...args, importer_url: "https://selected.test/base/main.js" });
    if (!result.ok) throw result.error;
    expect(
      webModuleTraceResultSchema.parse(result.value.normalized_result)
        .imports[0]?.resolution,
    ).toEqual({ state: "resolved", url: "https://selected.test/base/dep.js" });
  });
  it("honors cancellation before any artifacts are acquired", async () => {
    const controller = new AbortController();
    controller.abort(null);
    const service = new WebModuleTraceService(
      {
        load: () => {
          throw new Error("must not acquire");
        },
      },
      webModuleResolverFixture,
    );
    const result = await service.trace(args, { signal: controller.signal });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.cause).toBeNull();
    }
  });
});

describe("reported module context provenance", () => {
  it.each(["", "not a URL", "https://user:password@app.test/main.js"])(
    "retains unusable reported context as a capability limitation: %s",
    async (reportedUrl) => {
      const artifacts = webModuleArtifactsFixture();
      const script = artifacts.manifest.scripts[0];
      if (script === undefined) throw new Error("fixture script missing");
      script.url = reportedUrl;
      const service = new WebModuleTraceService(
        { load: () => Promise.resolve(ok(artifacts)) },
        {
          resolve: () => {
            throw new Error("must not resolve without a usable context");
          },
        },
      );
      const response = await service.trace(args);
      if (response.ok) throw new Error("expected unavailable context");
      expect(projectAnalysisError(response.error)).toMatchObject({
        code: "capability_unavailable",
        message: expect.stringContaining("Select importer_url explicitly"),
        details: { reason: "reported_source_context_unavailable" },
      });
      expect(projectAnalysisError(response.error).details).not.toHaveProperty(
        "issues",
      );
    },
  );
  it("keeps an unsupported reported scheme distinct from malformed context", async () => {
    const artifacts = webModuleArtifactsFixture();
    const script = artifacts.manifest.scripts[0];
    if (script === undefined) throw new Error("fixture script missing");
    script.url = "file:///captured/main.js";
    const response = await new WebModuleTraceService(
      { load: async () => ok(artifacts) },
      webModuleResolverFixture,
    ).trace(args);
    if (response.ok) throw new Error("expected unsupported context");
    expect(projectAnalysisError(response.error)).toMatchObject({
      code: "capability_unavailable",
      message: expect.stringContaining("reported source URL"),
      details: { reason: "unsupported_context_scheme" },
    });
  });
  it("honors an explicit context while retaining the unusable reported source URL", async () => {
    const artifacts = webModuleArtifactsFixture();
    const script = artifacts.manifest.scripts[0];
    if (script === undefined) throw new Error("fixture script missing");
    script.url = "not a URL";
    const result = await new WebModuleTraceService(
      { load: async () => ok(artifacts) },
      webModuleResolverFixture,
    ).trace({ ...args, importer_url: "https://selected.test/base/main.js" });
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      parameters: { importer_url: "https://selected.test/base/main.js" },
      normalized_result: {
        source: { script: { url: "not a URL" } },
        importer: {
          url: "https://selected.test/base/main.js",
          basis: "caller-selected",
        },
        imports: expect.arrayContaining([
          expect.objectContaining({
            resolution: {
              state: "resolved",
              url: "https://selected.test/base/dep.js",
            },
          }),
        ]),
      },
    });
  });
});

it.each([null, { request: "opaque cancellation" }])(
  "retains completed module Evidence and the exact late abort reason: %j",
  async (reason) => {
    const controller = new AbortController();
    const artifacts = webModuleArtifactsFixture();
    const service = new WebModuleTraceService(
      { load: async () => ok(artifacts) },
      {
        resolve: async (input) => {
          const result = await webModuleResolverFixture.resolve(input);
          controller.abort(reason);
          return result;
        },
      },
    );
    const result = await service.trace(args, { signal: controller.signal });
    if (result.ok) throw new Error("expected cancelled completion");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "trace_web_module_imports",
      confidence: "derived",
      normalized_result: {
        source: artifacts.sourceFile,
        imports: [
          {
            resolution: { state: "resolved", url: "https://app.test/dep.js" },
            execution: "unknown",
          },
          {
            resolution: { state: "unknown", reason: "computed-specifier" },
            execution: "unknown",
          },
        ],
      },
      raw_result: { fixture: true },
    });
  },
);

it("does not start the native resolver after cancellation during artifact admission", async () => {
  const controller = new AbortController();
  const reason = { request: "cancelled local artifact read" };
  const result = await new WebModuleTraceService(
    {
      load: async () => {
        controller.abort(reason);
        return ok(webModuleArtifactsFixture());
      },
    },
    {
      resolve: async () => {
        throw new Error("must not start resolver");
      },
    },
  ).trace(args, { signal: controller.signal });
  if (result.ok) throw new Error("expected cancelled admission");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
});

it.each(["incomplete", "provider-failure"])(
  "keeps resolver %s ahead of late cancellation",
  async (kind) => {
    const controller = new AbortController();
    const primary = new AnalysisOutputError(
      "trace_web_module_imports",
      "controlled resolver failure",
    );
    const result = await new WebModuleTraceService(
      { load: async () => ok(webModuleArtifactsFixture()) },
      {
        resolve: async () => {
          controller.abort({ request: "late cancellation" });
          return kind === "provider-failure"
            ? err(primary)
            : ok({
                engine: { id: "fixture", version: "1" },
                resolutions: [],
                diagnostics: [],
                rawResult: {},
              });
        },
      },
    ).trace(args, { signal: controller.signal });
    if (result.ok) throw new Error("expected original failure");
    expect(result.error).toBeInstanceOf(AnalysisOutputError);
    if (kind === "provider-failure") expect(result.error).toBe(primary);
    expect(result.error.partialObservation).toMatchObject({
      kind: "web-trace-observation",
      analysis: "incomplete",
    });
  },
);

it.each([
  "matching",
  "importer",
  "map-base",
  "map-value",
  "specifiers",
  "missing-resolution",
])(
  "adopts only a complete resolution for the exact selected request: %s",
  async (kind) => {
    const artifacts = webModuleArtifactsFixture();
    const importMap = {
      file: { path: "/analysis/map.json", sha256: "c".repeat(64), bytes: 2 },
      baseUrl: "https://app.test/maps/",
      value: { imports: { dep: "./dep.js" } },
    };
    let failure: AnalysisCancelledError | undefined;
    const result = await new WebModuleTraceService(
      { load: async () => ok({ ...artifacts, importMap }) },
      {
        resolve: async (request) => {
          const resolved = await webModuleResolverFixture.resolve(request);
          if (!resolved.ok) throw resolved.error;
          let observed: WebModuleResolutionRequest = request;
          if (kind === "importer")
            observed = { ...request, importerUrl: "https://other.test/" };
          if (kind === "map-base")
            observed = {
              ...request,
              importMap: {
                baseUrl: "https://other.test/",
                value: importMap.value,
              },
            };
          if (kind === "map-value")
            observed = {
              ...request,
              importMap: {
                baseUrl: importMap.baseUrl,
                value: { imports: { dep: "./other.js" } },
              },
            };
          if (kind === "specifiers")
            observed = { ...request, specifiers: ["./other.js"] };
          failure = new AnalysisCancelledError("trace_web_module_imports", {
            cause: null,
            partialObservation: {
              kind: "web-module-resolution",
              request: observed,
              batch:
                kind === "missing-resolution"
                  ? { ...resolved.value, resolutions: [] }
                  : resolved.value,
            },
          });
          return err(failure);
        },
      },
    ).trace({
      ...args,
      import_map: { path: importMap.file.path, base_url: importMap.baseUrl },
    });
    if (result.ok) throw new Error("expected original cancellation");
    expect(result.error).toBe(failure);
    expect(result.error.cause).toBeNull();
    if (kind === "matching") {
      expect(parseEvidence(result.error.partialObservation)).toMatchObject({
        operation: "trace_web_module_imports",
        normalized_result: {
          import_map: {
            path: importMap.file.path,
            base_url: importMap.baseUrl,
          },
          imports: [
            {
              resolution: { state: "resolved", url: "https://app.test/dep.js" },
            },
            { resolution: { state: "unknown", reason: "computed-specifier" } },
          ],
        },
      });
    } else
      expect(result.error.partialObservation).toHaveProperty(
        "resolver_observation.kind",
        "web-module-resolution",
      );
  },
);

it("retains a completed engine-free trace when artifact loading finishes under cancellation", async () => {
  const controller = new AbortController();
  const reason = { request: "engine-free completion" };
  const result = await new WebModuleTraceService(
    {
      load: async () => {
        controller.abort(reason);
        return ok(webModuleArtifactsFixture("import(name)"));
      },
    },
    {
      resolve: async () => {
        throw new Error("no literal imports to resolve");
      },
    },
  ).trace(args, { signal: controller.signal });
  if (result.ok) throw new Error("expected cancelled completion");
  expect(result.error.cause).toBe(reason);
  expect(parseEvidence(result.error.partialObservation)).toMatchObject({
    operation: "trace_web_module_imports",
    normalized_result: {
      engine: null,
      imports: [
        { resolution: { state: "unknown", reason: "computed-specifier" } },
      ],
    },
  });
});

it("resolves imports from relational JavaScript using the selected source grammar", async () => {
  const artifacts = webModuleArtifactsFixture(
    'const order = left < import("./dep.js") > (right);',
  );
  const result = await new WebModuleTraceService(
    { load: async () => ok(artifacts) },
    webModuleResolverFixture,
  ).trace(args);
  if (!result.ok) throw result.error;
  expect(
    webModuleTraceResultSchema.parse(result.value.normalized_result),
  ).toMatchObject({
    parser: { state: "parsed", diagnostics: [] },
    imports: [
      {
        kind: "dynamic-import",
        specifier: "./dep.js",
        resolution: { state: "resolved", url: "https://app.test/dep.js" },
      },
    ],
  });
});
