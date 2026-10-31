import { z } from "zod";

import {
  isJsonLike,
  mediaTypeEssence,
} from "../../domain/analysisView/recordedMediaType.js";

import {
  analysisViewResultSchema,
  type AnalysisViewResult,
} from "../../domain/analysisView/analysisView.js";
import { scenarioCaptureRecords } from "../../domain/analysisView/scenarioCaptureRecords.js";
import {
  readRecordedResponseBody,
  type RecordedResponseBody,
} from "../../domain/analysisView/recordedResponseBody.js";
import {
  readRecordedRequestLine,
  type RecordedRequestLine,
} from "../../domain/analysisView/webNetworkRouteTemplates.js";
import { retainedBrowserScenarioCaptureSchema } from "../../domain/browserScenarioCapture.js";
import type { BrowserScenarioEvent } from "../../domain/browserScenarioCaptureValues.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  type AnalysisInputIssue,
} from "../../domain/analysisErrorCore.js";
import type { Evidence } from "../../domain/evidence.js";
import { safeParseImmutableEvidence } from "../../domain/evidenceValidation.js";
import { parseExactJson } from "../../domain/exactJsonNumber.js";
import { projectInputIssues } from "../../domain/inputIssueProjection.js";
import { immutableJsonSnapshotMember } from "../../domain/immutableJson.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  safeParseOwnedWebNetworkCapture,
  type WebNetworkCaptureRecord,
} from "../../domain/webNetworkCapture.js";

/** Operation name every refusal of the serve command reports. */
export const ENVIRONMENT_SERVE_OPERATION = "environment-serve";

export type EnvironmentManifest = Extract<
  AnalysisViewResult,
  { kind: "environment-manifest" }
>;
export type EnvironmentManifestTool = EnvironmentManifest["tools"][number];

/** One retained parent record reduced to what a replay returns; a cut body is reported truncated. */
export interface RecordedExchange extends RecordedResponseBody {
  readonly ordinal: number;
  readonly path: string;
  /** WHATWG query spelling including `?`, or null when the request had none. */
  readonly query: string | null;
  readonly status: number | null;
  readonly contentType: string | null;
}

/** Replayed bodies larger than this are cut at a UTF-8 boundary and flagged. */
export const REPLAY_BODY_LIMIT_BYTES = 256 * 1024;

/** How replay answers with an exchange's body; replay and tool descriptions both read it from here. */
export type ReplayedBody =
  | { readonly kind: "none" }
  /** Non-UTF-8 bytes as base64; `whole` when every recorded byte fits the replay limit. */
  | {
      readonly kind: "base64";
      readonly encoded: string;
      readonly whole: boolean;
    }
  /** UTF-8 text over the replay limit or cut when retained; replay answers with a prefix. */
  | { readonly kind: "cut"; readonly text: string }
  | { readonly kind: "json"; readonly value: JsonValue }
  | { readonly kind: "text"; readonly text: string };

/** Bytes a padded base64 string decodes to. */
const decodedBase64Bytes = (encoded: string): number =>
  Math.floor((encoded.length * 3) / 4) -
  (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);

/** Classify a retained body once: whole JSON-like UTF-8 text within the limit that parses exactly is JSON. */
export const replayedBody = (exchange: RecordedExchange): ReplayedBody => {
  const text = exchange.bodyText;
  if (text === null) return { kind: "none" };
  if (exchange.bodyEncoding === "base64")
    return {
      kind: "base64",
      encoded: text,
      whole:
        exchange.bodyCut !== true &&
        decodedBase64Bytes(text) <= REPLAY_BODY_LIMIT_BYTES,
    };
  if (
    exchange.bodyCut === true ||
    // UTF-8 never takes fewer bytes than UTF-16 units, so the length check avoids encoding huge text.
    text.length > REPLAY_BODY_LIMIT_BYTES ||
    Buffer.byteLength(text, "utf8") > REPLAY_BODY_LIMIT_BYTES
  )
    return { kind: "cut", text };
  const value =
    exchange.contentType !== null &&
    isJsonLike(mediaTypeEssence(exchange.contentType))
      ? parseExactJson(text)
      : undefined;
  return value === undefined ? { kind: "text", text } : { kind: "json", value };
};

/** A HAR inspected by inspect_web_network_capture, or a session recorded by capture_browser_scenario. */
export type EnvironmentCaptureKind = "web-network-capture" | "browser-scenario";

/** A manifest and the parent capture it cites, authenticated and cross-checked. */
export interface EnvironmentSource {
  readonly manifest: EnvironmentManifest;
  readonly manifestEvidenceId: string;
  readonly evidenceId: string;
  /** Which REA operation recorded the parent capture. */
  readonly captureKind: EnvironmentCaptureKind;
  /**
   * SHA-256 of the captured artifact for a web network capture, or of the scenario definition for a
   * browser scenario; null when the capture excluded it from Evidence.
   */
  readonly captureSha256: string | null;
  /** Parent records cited by at least one tool, keyed by producer ordinal. */
  readonly exchanges: ReadonlyMap<number, RecordedExchange>;
}

/** An input refusal whose issue paths name the offending file. */
export const inputError = (
  operation: string,
  issues: readonly AnalysisInputIssue[],
  userMessage?: string,
): AnalysisInputError =>
  new AnalysisInputError(
    operation,
    userMessage === undefined ? undefined : { userMessage },
    issues,
  );

/** Authenticate one Evidence file; schema failures name the file role in their paths. */
export const parseEvidenceFile = (
  operation: string,
  role: "manifest" | "evidence" | "state",
  value: unknown,
): Result<Evidence, AnalysisError> => {
  for (const key of ["parameters", "raw_result", "normalized_result"])
    immutableJsonSnapshotMember(value, key);
  const parsed = safeParseImmutableEvidence(value);
  return parsed.ok
    ? parsed
    : err(
        schemaInputError(
          operation,
          { prefix: [role], cause: parsed.error, value },
          `The ${role} file is not authenticated REA Evidence JSON.`,
        ),
      );
};

/** A schema refusal of `value`, found at `prefix`; issue paths extend the prefix and the schema failure is retained. */
const schemaInputError = (
  operation: string,
  failure: {
    readonly prefix: readonly (string | number)[];
    readonly cause: z.ZodError;
    readonly value: unknown;
  },
  userMessage: string,
): AnalysisInputError =>
  new AnalysisInputError(
    operation,
    { userMessage, cause: failure.cause },
    projectInputIssues(failure.cause.issues, failure.value).map((issue) => ({
      ...issue,
      path: [...failure.prefix, ...issue.path],
    })),
  );

/** Combine an already parsed request line with its record's retained response body. */
export const recordedExchange = (
  record: WebNetworkCaptureRecord,
  line: Extract<RecordedRequestLine, { readonly kind: "line" }>,
): RecordedExchange => ({
  ordinal: record.ordinal,
  path: line.path,
  query: line.query === undefined || line.query === "" ? null : line.query,
  status: line.status,
  contentType: line.rawMime === "" ? null : line.rawMime,
  ...readRecordedResponseBody(record, REPLAY_BODY_LIMIT_BYTES),
});

/** Authenticate a view Evidence file and require one view kind; a refusal names the file role. */
export const parseViewEvidence = <Kind extends AnalysisViewResult["kind"]>(
  operation: string,
  role: "manifest" | "state",
  value: unknown,
  kind: Kind,
): Result<
  {
    readonly view: Extract<AnalysisViewResult, { kind: Kind }>;
    readonly evidenceId: string;
  },
  AnalysisError
> => {
  const evidence = parseEvidenceFile(operation, role, value);
  if (!evidence.ok) return evidence;
  const message = `The ${role} file is not ${kind} view Evidence.`;
  if (evidence.value.operation !== "inspect_analysis_view")
    return err(
      inputError(
        operation,
        [
          {
            path: [role, "operation"],
            reason: "invalid_value",
            expected: "inspect_analysis_view",
            message: `The ${role} file must be inspect_analysis_view Evidence of kind ${kind}.`,
          },
        ],
        message,
      ),
    );
  const normalized = immutableJsonSnapshotMember(
    evidence.value,
    "normalized_result",
  );
  if (immutableJsonSnapshotMember(normalized, "kind") !== kind)
    return err(
      inputError(
        operation,
        [
          {
            path: [role, "normalized_result", "kind"],
            reason: "invalid_value",
            expected: kind,
            message: `The ${role} file must be inspect_analysis_view Evidence of kind ${kind}.`,
          },
        ],
        message,
      ),
    );
  // The discriminator selected the requested view, so any failure is in that view's payload.
  const view = analysisViewResultSchema.safeParse(normalized);
  if (!view.success)
    return err(
      schemaInputError(
        operation,
        {
          prefix: [role, "normalized_result"],
          cause: view.error,
          value: normalized,
        },
        message,
      ),
    );
  return ok({
    view: view.data as Extract<AnalysisViewResult, { kind: Kind }>,
    evidenceId: evidence.value.evidence_id,
  });
};

/** What replay needs from a parent capture once its payload has been validated. */
interface CaptureFacts {
  readonly records: readonly WebNetworkCaptureRecord[];
  readonly captureKind: EnvironmentCaptureKind;
  readonly captureSha256: string | null;
  /** Whether the capture recorded response bodies: a browser scenario does only when they were selected. */
  readonly responseBodies: boolean;
  /** Whether the capture recorded request bodies, likewise. */
  readonly requestBodies: boolean;
  /** A browser scenario's retained events, including those no record represents; null for a HAR. */
  readonly scenarioEvents: readonly BrowserScenarioEvent[] | null;
}

/** Authenticated capture identity and the facts derived from its validated payload. */
export interface ParsedEnvironmentCapture extends CaptureFacts {
  readonly evidenceId: string;
}

/** Issue paths of a capture payload refusal start here. */
const CAPTURE_PAYLOAD_PATH = ["evidence", "normalized_result"] as const;

/** Validate a capture_browser_scenario payload; its failures name the payload fields. */
const parseScenarioCapture = (
  operation: string,
  normalized: unknown,
  parameters: unknown,
  purpose: "manifest" | "replay",
): Result<CaptureFacts, AnalysisError> => {
  const scenario = retainedBrowserScenarioCaptureSchema.safeParse(normalized);
  if (!scenario.success)
    return err(
      schemaInputError(
        operation,
        {
          prefix: CAPTURE_PAYLOAD_PATH,
          cause: scenario.error,
          value: normalized,
        },
        "The evidence file is not a complete browser scenario capture.",
      ),
    );
  const definition = z
    .object({ scenario_sha256: z.string() })
    .safeParse(parameters);
  return ok({
    records: scenarioCaptureRecords(scenario.data, purpose).records,
    captureKind: "browser-scenario",
    captureSha256: definition.success ? definition.data.scenario_sha256 : null,
    responseBodies: scenario.data.scenario.network_content.response_body,
    requestBodies: scenario.data.scenario.network_content.request_body,
    scenarioEvents: scenario.data.events.items,
  });
};

/** Validate an inspect_web_network_capture payload as HAR; its failures name the payload fields. */
const parseHarCapture = (
  operation: string,
  normalized: unknown,
): Result<CaptureFacts, AnalysisError> => {
  const records = immutableJsonSnapshotMember(normalized, "records");
  if (Array.isArray(records))
    for (let index = 0; index < records.length; index += 1) {
      const record = immutableJsonSnapshotMember(records, String(index));
      immutableJsonSnapshotMember(record, "reported");
    }
  // An owned snapshot is validated once and borrowed, so deriving the state reuses this validation.
  const capture = safeParseOwnedWebNetworkCapture(normalized);
  if (!capture.success)
    return err(
      schemaInputError(
        operation,
        {
          prefix: CAPTURE_PAYLOAD_PATH,
          cause: capture.error,
          value: normalized,
        },
        "The evidence file is not a complete web network capture.",
      ),
    );
  // The manifest view projects HAR captures only, and replay reads HAR's response fields.
  if (capture.data.format !== "har")
    return err(
      inputError(
        operation,
        [
          {
            path: [...CAPTURE_PAYLOAD_PATH, "format"],
            reason: "invalid_value",
            expected: "har",
            message: `Agent environments replay HAR captures; this capture's format is ${capture.data.format}.`,
          },
        ],
        "The evidence file is not a HAR capture.",
      ),
    );
  return ok({
    records: capture.data.records,
    captureKind: "web-network-capture",
    captureSha256: capture.data.artifact.sha256,
    responseBodies: true,
    requestBodies: true,
    scenarioEvents: null,
  });
};

/**
 * Authenticate the evidence file and require complete capture Evidence of
 * either kind. Only an operation no capture schema owns blames the operation;
 * a recognized operation's payload failures name the payload fields. A browser
 * capture's request bodies are kept only for the manifest purpose.
 */
export const parseCaptureEvidence = (
  operation: string,
  value: unknown,
  purpose: "manifest" | "replay" = "replay",
): Result<ParsedEnvironmentCapture, AnalysisError> => {
  const evidence = parseEvidenceFile(operation, "evidence", value);
  if (!evidence.ok) return evidence;
  const normalized = immutableJsonSnapshotMember(
    evidence.value,
    "normalized_result",
  );
  const capture =
    evidence.value.operation === "capture_browser_scenario"
      ? parseScenarioCapture(
          operation,
          normalized,
          evidence.value.parameters,
          purpose,
        )
      : evidence.value.operation === "inspect_web_network_capture"
        ? parseHarCapture(operation, normalized)
        : err(
            inputError(
              operation,
              [
                {
                  path: ["evidence", "operation"],
                  reason: "invalid_value",
                  expected:
                    "inspect_web_network_capture or capture_browser_scenario",
                  message:
                    "The evidence file must be inspect_web_network_capture or capture_browser_scenario Evidence.",
                },
              ],
              "The evidence file is not web network capture or browser scenario Evidence.",
            ),
          );
  return capture.ok
    ? ok({ ...capture.value, evidenceId: evidence.value.evidence_id })
    : capture;
};

/**
 * Reduce every record a tool cites to its replayable exchange. Authentication
 * already proves the capture is the manifest's parent, so every cited ordinal
 * is a record with a request line; a record that still yields none is left
 * out and the tool refuses at call time.
 */
const indexExchanges = (
  manifest: EnvironmentManifest,
  records: readonly WebNetworkCaptureRecord[],
): ReadonlyMap<number, RecordedExchange> => {
  const byOrdinal = new Map(records.map((record) => [record.ordinal, record]));
  const exchanges = new Map<number, RecordedExchange>();
  for (const tool of manifest.tools)
    for (const ordinal of tool.record_ordinals) {
      if (exchanges.has(ordinal)) continue;
      const record = byOrdinal.get(ordinal);
      if (record === undefined) continue;
      const line = readRecordedRequestLine(record.reported, true, () => true);
      if (line?.kind === "line")
        exchanges.set(ordinal, recordedExchange(record, line));
    }
  return exchanges;
};

/**
 * Load the manifest Evidence and its parent capture Evidence, refusing any pair
 * that does not belong together; refusals name the command that loaded them.
 */
export const loadEnvironmentSource = (
  manifestValue: unknown,
  evidenceValue: unknown,
  operation: string = ENVIRONMENT_SERVE_OPERATION,
): Result<EnvironmentSource, AnalysisError> => {
  const manifest = parseViewEvidence(
    operation,
    "manifest",
    manifestValue,
    "environment-manifest",
  );
  if (!manifest.ok) return manifest;
  const capture = parseCaptureEvidence(operation, evidenceValue);
  if (!capture.ok) return capture;
  return composeEnvironmentSource(manifest.value, capture.value, operation);
};

/** Cross-check admitted manifest and capture facts, retaining only the replay source. */
export const composeEnvironmentSource = (
  manifest: {
    readonly view: EnvironmentManifest;
    readonly evidenceId: string;
  },
  capture: ParsedEnvironmentCapture,
  operation: string = ENVIRONMENT_SERVE_OPERATION,
): Result<EnvironmentSource, AnalysisError> => {
  const parentId = manifest.view.parent_evidence_id;
  if (parentId !== capture.evidenceId)
    return err(
      inputError(
        operation,
        [
          {
            path: ["evidence", "evidence_id"],
            reason: "invalid_value",
            expected: parentId,
            message: `The manifest cites parent Evidence ${parentId}; the evidence file is ${capture.evidenceId}.`,
          },
        ],
        "The manifest was projected from a different capture than the supplied evidence file.",
      ),
    );
  return ok({
    manifest: manifest.view,
    manifestEvidenceId: manifest.evidenceId,
    evidenceId: capture.evidenceId,
    captureKind: capture.captureKind,
    captureSha256: capture.captureSha256,
    exchanges: indexExchanges(manifest.view, capture.records),
  });
};
