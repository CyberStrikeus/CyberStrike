import { expect, it } from "vitest";
import {
  webSourceLocationArgs as args,
  webSourceLocationFixture,
  webSourceMapDecoderFixture as decoder,
} from "../../tests/fixtures/webSourceLocation.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { parseEvidence } from "../domain/evidence.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { ok } from "../domain/result.js";
import {
  DEFAULT_WEB_SOURCE_MAP_DECODE_TIMEOUT_MS,
  webSourceLocationResultSchema,
} from "../domain/webSourceLocation.js";
import { WebSourceLocationService } from "./WebSourceLocationService.js";
import type { WebSourceMapPort } from "./WebSourceLocationPorts.js";

const service = (data = webSourceLocationFixture(), port = decoder) =>
  new WebSourceLocationService({ load: () => Promise.resolve(ok(data)) }, port);
const expectCodecDeadline = (
  evidence: {
    readonly limitations: readonly string[];
    readonly normalized_result: unknown;
  },
  timeoutMs: number,
): void => {
  const phrase = `${String(timeoutMs)} ms decode_timeout_ms deadline`;
  const result = webSourceLocationResultSchema.parse(
    evidence.normalized_result,
  );
  expect(
    evidence.limitations.filter((text) => text.includes(phrase)),
  ).toHaveLength(1);
  expect(
    result.limitations.filter((text) => text.includes(phrase)),
  ).toHaveLength(1);
};
it("passes an explicit decode deadline and omits the default from Evidence", async () => {
  const seen: Array<number | undefined> = [];
  const port: WebSourceMapPort = {
    trace: (input) => {
      seen.push(input.decodeTimeoutMs);
      return decoder.trace(input);
    },
  };
  const explicit = await service(undefined, port).trace({
    ...args,
    decode_timeout_ms: 250,
  });
  if (!explicit.ok) throw explicit.error;
  expect(explicit.value.parameters.decode_timeout_ms).toBe(250);
  expectCodecDeadline(explicit.value, 250);
  const omitted = await service(undefined, port).trace(args);
  if (!omitted.ok) throw omitted.error;
  expect(omitted.value.parameters).not.toHaveProperty("decode_timeout_ms");
  expectCodecDeadline(omitted.value, DEFAULT_WEB_SOURCE_MAP_DECODE_TIMEOUT_MS);
  expect(seen).toEqual([250, undefined]);
});

it("reports shared decoder record costs in result and Evidence limitations", async () => {
  const response = await service().trace(args);
  if (!response.ok) throw response.error;
  const result = webSourceLocationResultSchema.parse(
    response.value.normalized_result,
  );
  for (const limitations of [response.value.limitations, result.limitations]) {
    expect(limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "shared decoder budget for generated rows, mapping segments, leaf maps, source and name declarations, sourcesContent entries, and indexed sections",
        ),
      ]),
    );
  }
});

it.each([
  { ...args, manifest_path: "relative.json" },
  { ...args, script_index: -1 },
  { ...args, source_map: { ...args.source_map, path: "relative.map" } },
  { ...args, source_map: { ...args.source_map, url: "relative.map" } },
  { ...args, generated_position: { line: 0, column: 0 } },
])(
  "rejects invalid selected context before acquiring artifacts: %j",
  async (input) => {
    const response = await new WebSourceLocationService(
      {
        load: () => {
          throw new Error("must not acquire");
        },
      },
      decoder,
    ).trace(input);
    if (response.ok) throw new Error("expected invalid input");
    expect(projectAnalysisError(response.error).code).toBe("invalid_request");
  },
);
it.each([
  "file:///analysis/app.map",
  "webpack:///bundle/app.map",
  "https://selected-user:selected-value@app.test/maps/app.map",
])(
  "retains an absolute inert map context without fetching: %s",
  async (url) => {
    const fixture = webSourceLocationFixture();
    const data = { ...fixture, sourceMap: { ...fixture.sourceMap, url } };
    const response = await service(data).trace({
      ...args,
      source_map: { ...args.source_map, url },
    });
    if (!response.ok) throw response.error;
    expect(
      webSourceLocationResultSchema.parse(response.value.normalized_result)
        .url_context,
    ).toBe(url);
  },
);
it.each(["source", "map", "map-path", "map-url"])(
  "rejects changed artifact identity before decoding: %s",
  async (variant) => {
    const fixture = webSourceLocationFixture();
    const data = {
      ...fixture,
      source: variant === "source" ? "different" : fixture.source,
      sourceMap: { ...fixture.sourceMap },
    };
    if (variant === "map") data.sourceMap.text += " ";
    if (variant === "map-path") data.sourceMap.file.path = "/other.map";
    if (variant === "map-url") data.sourceMap.url = "https://other.test/";
    const response = await service(data, {
      trace: () => {
        throw new Error("must not decode");
      },
    }).trace(args);
    if (response.ok) throw new Error("expected changed identity failure");
    expect(response.error._tag).toBe("AnalysisOutputError");
  },
);
it.each(["digest", "url", "point"])(
  "rejects changed codec identity: %s",
  async (variant) => {
    const port: WebSourceMapPort = {
      trace: async (input) => {
        const decoded = await decoder.trace(input);
        if (!decoded.ok) return decoded;
        const report = decoded.value;
        if (variant === "digest") report.source_map_sha256 = "f".repeat(64);
        if (variant === "url") report.url_context = "https://other.test/";
        if (variant === "point") report.lookup.requested.column += 1;
        return Promise.resolve(ok(report));
      },
    };
    const response = await service(undefined, port).trace(args);
    if (response.ok) throw new Error("expected changed codec identity failure");
    expect(response.error._tag).toBe("AnalysisOutputError");
  },
);
it.each([
  {
    runtime: {
      id: "node-v8",
      version: "v24.18.0",
      v8_heap_limit_bytes: 201326592,
    },
    limitation: "192 MiB old-generation heap and one V8 worker",
  },
  {
    runtime: {
      id: "bun",
      version: "1.4.2",
      node_compatibility_version: "24.3.0",
      v8_heap_limit_bytes: null,
      process_memory_limit_bytes: 738197504,
    },
    limitation:
      "a Windows Job Object limited its committed memory to 738197504 bytes",
  },
  {
    runtime: {
      id: "bun",
      version: "1.4.2",
      node_compatibility_version: "24.3.0",
      v8_heap_limit_bytes: null,
      process_memory_limit_bytes: null,
    },
    limitation: "so no codec heap limit is established",
  },
] as const)(
  "states the codec memory bound its runtime enforced: $limitation",
  async ({ runtime, limitation }) => {
    const response = await service(undefined, {
      trace: async (input) => {
        const decoded = await decoder.trace(input);
        if (!decoded.ok) return decoded;
        return ok({ ...decoded.value, runtime });
      },
    }).trace(args);
    if (!response.ok) throw response.error;
    expect(
      response.value.limitations.filter((text) => text.includes(limitation)),
    ).toHaveLength(1);
  },
);
it("honors cancellation both before acquisition and across decoder completion", async () => {
  const first = new AbortController();
  const firstReason = { caller: "before source-map acquisition" };
  first.abort(firstReason);
  const response = await new WebSourceLocationService(
    {
      load: () => {
        throw new Error("must not acquire");
      },
    },
    decoder,
  ).trace(args, { signal: first.signal });
  expect(response.ok).toBe(false);
  if (!response.ok) expect(response.error.cause).toBe(firstReason);
  const controller = new AbortController();
  const lateReason = { caller: "after source-map provider completion" };
  const late = await service(undefined, {
    trace: (input) => {
      controller.abort(lateReason);
      return decoder.trace(input);
    },
  }).trace(args, { signal: controller.signal });
  if (late.ok) throw new Error("expected cancellation");
  expect(late.error).toBeInstanceOf(AnalysisCancelledError);
  expect(late.error.cause).toBe(lateReason);
  expect(parseEvidence(late.error.partialObservation)).toMatchObject({
    operation: "trace_web_source_location",
    confidence: "derived",
  });

  const malformedDecoder: WebSourceMapPort = {
    trace: async (input, options) => {
      const decoded = await decoder.trace(input, options);
      return decoded.ok
        ? ok({ ...decoded.value, source_map_sha256: "b".repeat(64) })
        : decoded;
    },
  };
  const malformed = await new WebSourceLocationService(
    { load: () => Promise.resolve(ok(webSourceLocationFixture())) },
    malformedDecoder,
  ).trace(args);
  expect(malformed.ok).toBe(false);
  if (!malformed.ok)
    expect(malformed.error).toBeInstanceOf(AnalysisOutputError);

  const invalidController = new AbortController();
  const malformedLate = await new WebSourceLocationService(
    { load: () => Promise.resolve(ok(webSourceLocationFixture())) },
    {
      trace: async (input, options) => {
        const decoded = await decoder.trace(input, options);
        invalidController.abort();
        return decoded.ok
          ? ok({ ...decoded.value, source_map_sha256: "b".repeat(64) })
          : decoded;
      },
    },
  ).trace(args, { signal: invalidController.signal });
  expect(malformedLate.ok).toBe(false);
  if (!malformedLate.ok)
    expect(malformedLate.error).toBeInstanceOf(AnalysisOutputError);
});
