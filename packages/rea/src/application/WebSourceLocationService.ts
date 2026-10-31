import { closeOwnedWebResources } from "./closeOwnedWebResources.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  primaryAnalysisError,
  type AnalysisError,
} from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../domain/evidence.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  selectedWebScriptArtifactsSchema,
  webArtifactFileSchema,
} from "../domain/webScriptArtifacts.js";
import {
  DEFAULT_WEB_SOURCE_MAP_DECODE_TIMEOUT_MS,
  WEB_SOURCE_MAP_LIMITS,
  webSourceLocationInputSchema,
  webSourceLocationResultSchema,
  webSourceMapReportSchema,
  type WebSourceLocationInput,
  type WebSourceMapReport,
} from "../domain/webSourceLocation.js";
import type { WebTraceObservation } from "../domain/webTraceObservation.js";
import { webSourceOffset } from "../domain/webSourcePosition.js";
import type { ExecutionOptions } from "./AnalysisProvider.js";
import {
  capturedWebManifestIdentity,
  validateSelectedWebScript,
} from "./ValidateSelectedWebScript.js";
import type {
  WebSourceLocationArtifactPort,
  WebSourceMapPort,
} from "./WebSourceLocationPorts.js";
import { completeProviderEvidence } from "./ProviderOperationExecution.js";
import { parseAnalysisInput } from "./AnalysisInput.js";

const OPERATION = "trace_web_source_location";
const artifactsSchema = selectedWebScriptArtifactsSchema.extend({
  sourceMap: z.strictObject({
    file: webArtifactFileSchema,
    url: z.string().min(1),
    text: z.string(),
  }),
});
const LIMITATIONS = [
  "The source/map pairing and source-map URL context are caller-selected. Deployment authenticity and execution remain unknown.",
  "Capture metadata and its Evidence reference are historical context; this trace independently verifies only the selected manifest, script and map bytes.",
  "Source names and sourceRoot are reported declarations. REA derives resolved URLs using WHATWG URL resolution; the pinned upstream codec decodes mappings. No original source is fetched or executed.",
  "Embedded source hashes identify the UTF-8 encoding of decoded sourcesContent text, not an independently retained original file. Missing or out-of-range original content positions remain explicit.",
  "Lookup returns all segments at the greatest generated position not greater than the selected point, including earlier lines and generated-only segments. A mapped point does not establish an executed range or UI causality.",
  "Regular maps and inline indexed sections are supported. External section URLs are unsupported; unknown extensions are retained in raw map text and are not interpreted.",
];
const codecBudget = (timeoutMs: number): string =>
  `Complete evidence has a 4 MiB map, 32 MiB reply and a ${String(WEB_SOURCE_MAP_LIMITS.decodedRecords)}-record shared decoder budget for generated rows, mapping segments, leaf maps, source and name declarations, sourcesContent entries, and indexed sections. Generated rows and mapping segments have separate ${String(WEB_SOURCE_MAP_LIMITS.decodedRows)} and ${String(WEB_SOURCE_MAP_LIMITS.decodedSegments)} limits, and indexed maps have a ${String(WEB_SOURCE_MAP_LIMITS.sectionDepth)}-level section budget. The owned codec has a ${String(timeoutMs)} ms decode_timeout_ms deadline`;
/** Bun accepts but ignores the codec's V8 heap flags; Windows enforces a commit limit instead. */
const codecBudgetLimitation = (
  runtime: WebSourceMapReport["runtime"],
  timeoutMs: number,
): string => {
  const budget = codecBudget(timeoutMs);
  if (runtime.id === "node-v8")
    return `${budget}, ${String(WEB_SOURCE_MAP_LIMITS.codecHeapMiB)} MiB old-generation heap and one V8 worker; cleanup may extend the deadline. V8 heap limits do not establish aggregate RSS limits.`;
  return runtime.process_memory_limit_bytes === null
    ? `${budget}; cleanup may extend the deadline. The codec ran on Bun, which does not enforce REA's V8 heap flags, so no codec heap limit is established.`
    : `${budget}; cleanup may extend the deadline. The codec ran on Bun, which does not enforce REA's V8 heap flags; a Windows Job Object limited its committed memory to ${String(runtime.process_memory_limit_bytes)} bytes, which is not a heap or RSS limit.`;
};

/** Join verified captured bytes with an explicitly selected source-map point. */
export class WebSourceLocationService {
  constructor(
    readonly artifacts: WebSourceLocationArtifactPort,
    readonly decoder: WebSourceMapPort,
  ) {}

  close(): Promise<void> {
    return closeOwnedWebResources(
      [
        this.artifacts.close?.bind(this.artifacts),
        this.decoder.close?.bind(this.decoder),
      ],
      "Web source-location cleanup failed",
    );
  }

  /** Shared CLI/MCP workflow preserves raw declarations and every equal-position match. */
  async trace(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const parsed = parseAnalysisInput(
      OPERATION,
      rawInput,
      webSourceLocationInputSchema,
      options?.signal,
    );
    if (!parsed.ok) return parsed;
    const input = parsed.value;
    const admitted = admitContext(input);
    if (!admitted.ok) return admitted;
    const loaded = await this.artifacts.load(input, options);
    if (!loaded.ok) return loaded;
    const verified = artifactsSchema.safeParse(loaded.value);
    if (!verified.success)
      return invalidOutput(
        "Artifact port returned malformed source/map evidence.",
      );
    const data = verified.data;
    const bound = validateSelectedWebScript(input, data, OPERATION);
    if (!bound.ok) return bound;
    const map = data.sourceMap;
    const observation: WebTraceObservation = {
      kind: "web-trace-observation",
      analysis: "incomplete",
      manifest: data.manifestFile,
      source: data.sourceFile,
    };
    const incomplete = (error: AnalysisError): Result<never, AnalysisError> => {
      const retained = webSourceMapReportSchema.safeParse(
        error.partialObservation,
      );
      error.partialObservation = {
        ...observation,
        ...(retained.success
          ? {
              source_map_observation: {
                association:
                  observation.source_map !== undefined &&
                  matchesSelectedReport(input, map.file.sha256, retained.data)
                    ? ("selected" as const)
                    : ("independent" as const),
                report: retained.data,
              },
            }
          : {}),
      };
      primaryAnalysisError(error).partialObservation = error.partialObservation;
      return err(error);
    };
    const pairing = verifyPairing(input, data);
    if (!pairing.ok) return incomplete(pairing.error);
    observation.source_map = map.file;
    const generatedOffset = webSourceOffset(
      data.source,
      input.generated_position,
    );
    if (generatedOffset === undefined)
      return incomplete(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["generated_position"],
            reason: "invalid_format",
            message:
              "Selected generated position is outside the retained script text (one-based lines; zero-based UTF-16 columns).",
          },
        ]),
      );
    if (options?.signal?.aborted)
      return incomplete(
        new AnalysisCancelledError(OPERATION, { cause: options.signal.reason }),
      );
    const traced = await this.decoder.trace(
      {
        text: map.text,
        path: map.file.path,
        url: map.url,
        position: input.generated_position,
        ...(input.decode_timeout_ms === undefined
          ? {}
          : { decodeTimeoutMs: input.decode_timeout_ms }),
      },
      options,
    );
    if (!traced.ok) return incomplete(traced.error);
    const report = verifyReport(input, map.file.sha256, traced.value);
    if (!report.ok) return incomplete(report.error);
    const decodeTimeoutMs =
      input.decode_timeout_ms ?? DEFAULT_WEB_SOURCE_MAP_DECODE_TIMEOUT_MS;
    const limitations = [
      ...LIMITATIONS,
      codecBudgetLimitation(report.value.runtime, decodeTimeoutMs),
    ];
    const normalized = webSourceLocationResultSchema.safeParse({
      ...report.value,
      manifest: capturedWebManifestIdentity(data),
      source: {
        ...data.sourceFile,
        script_index: input.script_index,
        script: bound.value,
      },
      source_map: { ...map.file, url: map.url, association: "caller-selected" },
      generated_offset: generatedOffset,
      source_authenticity: "unknown",
      execution: "unknown",
      limitations,
    });
    if (!normalized.success)
      return incomplete(
        new AnalysisOutputError(OPERATION, normalized.error.message),
      );
    return completeProviderEvidence(
      createEvidence(
        {
          path: data.sourceFile.path,
          sha256: data.sourceFile.sha256,
          format: "file",
        },
        {
          id: "rea-web-source-location",
          name: "REA captured source-map point trace",
          version: "1",
        },
        {
          operation: OPERATION,
          parameters: input,
          result: normalized.data,
          rawResult: { source_map_text: map.text },
          confidence: "derived",
          authority: "historical-reference",
          limitations,
          locations: [
            data.sourceFile.path,
            data.manifestFile.path,
            map.file.path,
          ].map((path) => ({ kind: "artifact-path", path })),
          evidenceLinks:
            data.manifest.source_evidence_id === null
              ? []
              : [data.manifest.source_evidence_id],
        },
      ),
      options?.signal,
    );
  }
}

const invalidOutput = (message: string): Result<never, AnalysisError> =>
  err(new AnalysisOutputError(OPERATION, message));
const invalid = (
  path: readonly string[],
  message: string,
): Result<never, AnalysisError> =>
  err(
    new AnalysisInputError(OPERATION, undefined, [
      { path, reason: "invalid_format", message },
    ]),
  );

const admitContext = (
  input: WebSourceLocationInput,
): Result<null, AnalysisError> => {
  if (!URL.canParse(input.source_map.url))
    return invalid(
      ["source_map", "url"],
      "Expected an absolute source-map URL context. Select its deployment context explicitly; no URL is fetched.",
    );
  return ok(null);
};

const verifyPairing = (
  input: WebSourceLocationInput,
  data: z.output<typeof artifactsSchema>,
): Result<null, AnalysisError> => {
  const map = data.sourceMap;
  if (
    map.file.path !== input.source_map.path ||
    map.url !== input.source_map.url ||
    Buffer.byteLength(map.text) !== map.file.bytes ||
    createHash("sha256").update(map.text).digest("hex") !== map.file.sha256 ||
    map.file.bytes > WEB_SOURCE_MAP_LIMITS.mapBytes
  )
    return invalidOutput(
      "Artifact port changed the selected source-map byte identity or URL context.",
    );
  return ok(null);
};

const verifyReport = (
  input: WebSourceLocationInput,
  sha256: string,
  value: unknown,
): Result<WebSourceMapReport, AnalysisError> => {
  const report = webSourceMapReportSchema.safeParse(value);
  if (!report.success)
    return invalidOutput(
      "Codec port returned malformed source-map point evidence.",
    );
  if (!matchesSelectedReport(input, sha256, report.data))
    return err(
      new AnalysisOutputError(
        OPERATION,
        "Codec port changed the selected map, URL context or generated point.",
        { partialObservation: report.data },
      ),
    );
  return ok(report.data);
};

const matchesSelectedReport = (
  input: WebSourceLocationInput,
  sha256: string,
  report: WebSourceMapReport,
): boolean =>
  report.source_map_sha256 === sha256 &&
  report.url_context === input.source_map.url &&
  report.lookup.requested.line === input.generated_position.line &&
  report.lookup.requested.column === input.generated_position.column;
