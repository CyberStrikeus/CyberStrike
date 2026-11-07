import { expect, it } from "vitest";
import { WebSourceLocationService } from "../../../src/application/WebSourceLocationService.js";
import { WebModuleTraceService } from "../../../src/application/WebModuleTraceService.js";
import { AnalysisOutputError } from "../../../src/domain/analysisErrorCore.js";
import { err, ok } from "../../../src/domain/result.js";
import { webTraceObservationSchema } from "../../../src/domain/webTraceObservation.js";
import { traceSourceMap } from "../../../src/javascript/sourceMaps/TraceSourceMap.js";
import {
  webSourceLocationArgs,
  webSourceLocationFixture,
} from "../../fixtures/webSourceLocation.js";
import { webModuleArtifactsFixture } from "../../fixtures/webModuleTrace.js";

it("retains the exact admitted codec report on a late typed failure", async () => {
  const data = webSourceLocationFixture();
  const report = traceSourceMap(
    data.sourceMap.text,
    data.sourceMap.url,
    webSourceLocationArgs.generated_position,
  );
  const failure = new AnalysisOutputError(
    "trace_web_source_location",
    "late cleanup failure",
    { partialObservation: report },
  );
  const service = new WebSourceLocationService(
    { load: async () => ok(data) },
    { trace: async () => err(failure) },
  );
  const result = await service.trace(webSourceLocationArgs);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBe(failure);
  expect(
    webTraceObservationSchema.parse(result.error.partialObservation)
      .source_map_observation,
  ).toEqual({ association: "selected", report });
});

it("does not attribute a codec report to a different selected map", async () => {
  const data = webSourceLocationFixture();
  const report = traceSourceMap(
    data.sourceMap.text,
    "https://other.test/map",
    webSourceLocationArgs.generated_position,
  );
  const failure = new AnalysisOutputError(
    "trace_web_source_location",
    "codec failure",
    { partialObservation: report },
  );
  const service = new WebSourceLocationService(
    { load: async () => ok(data) },
    { trace: async () => err(failure) },
  );
  const result = await service.trace(webSourceLocationArgs);
  if (result.ok) throw new Error("expected failure");
  const observation = webTraceObservationSchema.parse(
    result.error.partialObservation,
  );
  expect(observation.source_map_observation).toEqual({
    association: "independent",
    report,
  });
  expect(observation.source).toEqual(data.sourceFile);
});

it("retains source identities on resolver failure without claiming native resolution", async () => {
  const data = {
    ...webModuleArtifactsFixture(),
    importMap: {
      file: {
        path: "/analysis/import-map.json",
        sha256: "c".repeat(64),
        bytes: 14,
      },
      baseUrl: "https://app.test/",
      value: { imports: {} },
    },
  };
  const failure = new AnalysisOutputError(
    "trace_web_module_imports",
    "resolver failed",
  );
  const service = new WebModuleTraceService(
    { load: async () => ok(data) },
    { resolve: async () => err(failure) },
  );
  const result = await service.trace({
    manifest_path: data.manifestFile.path,
    script_index: 0,
    import_map: {
      path: data.importMap.file.path,
      base_url: data.importMap.baseUrl,
    },
  });
  if (result.ok) throw new Error("expected failure");
  expect(result.error).toBe(failure);
  expect(
    webTraceObservationSchema.parse(result.error.partialObservation),
  ).toEqual({
    kind: "web-trace-observation",
    analysis: "incomplete",
    manifest: data.manifestFile,
    source: data.sourceFile,
    import_map: data.importMap.file,
  });
});

it("retains source identities but does not admit a changed selected map", async () => {
  const data = webSourceLocationFixture();
  data.sourceMap.file.path = "/different/map";
  const service = new WebSourceLocationService(
    { load: async () => ok(data) },
    {
      trace: async () => {
        throw new Error("codec must not run");
      },
    },
  );
  const result = await service.trace(webSourceLocationArgs);
  if (result.ok) throw new Error("expected failure");
  const observation = webTraceObservationSchema.parse(
    result.error.partialObservation,
  );
  expect(observation.source_map).toBeUndefined();
  expect(observation.source).toEqual(data.sourceFile);
});

it("retains independently attributed codec observations returned in a success carrier", async () => {
  const data = webSourceLocationFixture();
  const report = traceSourceMap(
    data.sourceMap.text,
    "https://other.test/map",
    webSourceLocationArgs.generated_position,
  );
  const service = new WebSourceLocationService(
    { load: async () => ok(data) },
    { trace: async () => ok(report) },
  );
  const result = await service.trace(webSourceLocationArgs);
  if (result.ok)
    throw new Error("foreign report must not establish selected point");
  expect(result.error).toBeInstanceOf(AnalysisOutputError);
  const observation = webTraceObservationSchema.parse(
    result.error.partialObservation,
  );
  expect(observation.source_map_observation).toEqual({
    association: "independent",
    report,
  });
  expect(observation.source_map).toEqual(data.sourceMap.file);
});
