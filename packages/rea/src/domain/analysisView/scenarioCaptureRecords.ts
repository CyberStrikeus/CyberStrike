import { AnalysisUnsupportedTargetError } from "../analysisErrorCore.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import type {
  BrowserNetworkBody,
  BrowserNetworkHeaders,
} from "../browserNetworkEvidence.js";
import {
  retainedBrowserScenarioCaptureSchema,
  type RetainedBrowserScenarioCapture,
} from "../browserScenarioCapture.js";
import type { BrowserScenarioEvent } from "../browserScenarioCaptureValues.js";
import {
  indexBrowserScenarioTransactions,
  type BrowserScenarioTransactionIndex,
} from "../browserScenarioTransactions.js";
import type { JsonValue } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";
import type { WebNetworkCaptureRecord } from "../webNetworkCapture.js";
import { analysisViewResultInputError } from "./analysisViewParent.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import type { WebNetworkProjectionAccumulator } from "./WebNetworkProjectionAccumulator.js";
import { ENTRY_BYTES, textBytes } from "./webNetworkRouteTemplates.js";

type RequestEvent = Extract<BrowserScenarioEvent, { kind: "request" }>;
type ContentEvent = Extract<BrowserScenarioEvent, { kind: "network-content" }>;
type CapturedBody = Extract<BrowserNetworkBody, { state: "captured" }>;

/** Response-byte retention, independent of whether the transaction has a usable request line. */
export type ScenarioResponseBodyRetention = "absent" | "retained" | "redacted";

/** A scenario capture's network transactions in the record shape HAR captures project from. */
export interface ScenarioCaptureRecords {
  readonly records: readonly WebNetworkCaptureRecord[];
  readonly totalRecords: number;
  readonly responseBodies: ReadonlyMap<number, ScenarioResponseBodyRetention>;
  readonly limitations: readonly string[];
}

/** The one content event of an exchange phase, or undefined when absent or ambiguous. */
const onlyContent = (
  index: BrowserScenarioTransactionIndex,
  sequence: number | undefined,
): ContentEvent | undefined => {
  const found =
    sequence === undefined ? undefined : index.contents.get(sequence);
  return found?.length === 1 ? found[0] : undefined;
};

const headerValue = (
  headers: BrowserNetworkHeaders | undefined,
  name: string,
): string | undefined => {
  if (headers?.state !== "captured") return undefined;
  let value: string | undefined;
  for (const item of headers.items) {
    if (item.name.toLowerCase() !== name) continue;
    // A singleton field has no certain value if declarations disagree or one
    // was excluded. Never let ordering choose an interpretation of Evidence.
    if (item.value === null || (value !== undefined && value !== item.value))
      return undefined;
    value = item.value;
  }
  return value;
};

const captured = (
  content: ContentEvent | undefined,
): CapturedBody | undefined =>
  content?.body.state === "captured" ? content.body : undefined;

/** A captured response body, unless redaction emptied it because a secret could not be cut out. */
const retainedBody = (
  content: ContentEvent | undefined,
): CapturedBody | undefined => {
  const body = captured(content);
  return body?.redacted === true && body.bytes === 0 ? undefined : body;
};

/** Strictly decoded text, keeping a byte-order mark; undefined for bytes that are not UTF-8. */
const utf8Text = (body: CapturedBody): string | undefined => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Buffer.from(body.content, "base64"),
    );
  } catch {
    return undefined;
  }
};

/** A content event's media type: its captured body's, else its retained Content-Type value. */
export const scenarioContentMediaType = (
  content: ContentEvent | undefined,
): string | undefined =>
  captured(content)?.media_type ??
  headerValue(content?.headers, "content-type");

/** Whether a request sent no body: Playwright exposed none and the request names no Content-Type, which the bodies browsers send carry. */
const unsentBody = (
  request: RequestEvent,
  content: ContentEvent | undefined,
): boolean =>
  content?.body.state === "not_exposed" &&
  !request.header_names.some((name) => name.toLowerCase() === "content-type");

/** The request object HAR readers expect; a redacted URL is withheld so no path is templated from it. */
const reportedRequest = (
  request: RequestEvent,
  content: ContentEvent | undefined,
  purpose: "manifest" | "replay",
): { readonly [key: string]: JsonValue } => {
  const body = purpose === "manifest" ? captured(content) : undefined;
  const text = body === undefined ? undefined : utf8Text(body);
  const mimeType = scenarioContentMediaType(content);
  const size =
    body !== undefined && !body.redacted
      ? body.bytes
      : purpose === "manifest" && unsentBody(request, content)
        ? 0
        : -1;
  return {
    method: request.method,
    bodySize: size,
    url: request.url.redacted ? null : request.url.url,
    ...(text === undefined || mimeType === undefined
      ? {}
      : { postData: { mimeType, text } }),
  };
};

interface BrowserTiming {
  readonly started_at?: string | undefined;
  readonly elapsed_ms?: number | undefined;
}

/** Each transaction's browser-reported start and duration, from its single finished or failed event. */
const timingByTransaction = (
  events: RetainedBrowserScenarioCapture["events"]["items"],
): ReadonlyMap<string, BrowserTiming> => {
  const timing = new Map<string, BrowserTiming>();
  for (const event of events) {
    if (event.kind !== "request-finished" && event.kind !== "request-failed")
      continue;
    // A transaction ending twice has no single start or duration.
    timing.set(
      event.transaction_id,
      timing.has(event.transaction_id)
        ? {}
        : { started_at: event.started_at, elapsed_ms: event.elapsed_ms },
    );
  }
  return timing;
};

/**
 * HAR timing for a record: the browser's start when it reported one, else the
 * request observation. Preserve duration independently; omission is not zero.
 */
const recordTiming = (
  request: RequestEvent,
  timing: ReadonlyMap<string, BrowserTiming>,
):
  | { readonly startedDateTime?: string; readonly time?: number }
  | undefined => {
  const browser = timing.get(request.transaction_id);
  const started = browser?.started_at ?? request.observed_at;
  return started === undefined && browser?.elapsed_ms === undefined
    ? undefined
    : {
        ...(started === undefined ? {} : { startedDateTime: started }),
        ...(browser?.elapsed_ms === undefined
          ? {}
          : { time: browser.elapsed_ms }),
      };
};

const record = (
  ordinal: number,
  observed: { readonly event: RequestEvent; readonly item: number },
  index: BrowserScenarioTransactionIndex,
  purpose: "manifest" | "replay",
  timing: ReturnType<typeof recordTiming>,
): {
  readonly record: WebNetworkCaptureRecord;
  readonly responseBody: ScenarioResponseBodyRetention;
} => {
  const { item, event: request } = observed;
  const location = {
    kind: "json-pointer" as const,
    pointer: `/events/items/${String(item)}`,
  };
  const empty = {
    binary_fields: [],
    numeric_literals: [],
    redactions: [],
    limitations: [],
  };
  const responses = index.responses.get(request.transaction_id) ?? [];
  const response = responses.length === 1 ? responses[0] : undefined;
  // One request, at most one response and one content event per phase: otherwise the
  // transaction cannot be attributed and is left unrepresented.
  if (
    index.requestCounts.get(request.transaction_id) !== 1 ||
    responses.length > 1 ||
    (index.contents.get(request.sequence)?.length ?? 0) > 1 ||
    (response !== undefined &&
      (index.contents.get(response.sequence)?.length ?? 0) > 1)
  )
    return {
      record: { ordinal, location, reported: {}, ...empty },
      responseBody: "absent",
    };
  const requestContent = onlyContent(index, request.sequence);
  const responseContent = onlyContent(index, response?.sequence);
  const body = retainedBody(responseContent);
  const mimeType = scenarioContentMediaType(responseContent) ?? "";
  return {
    record: {
      ordinal,
      location,
      reported: {
        ...timing,
        request: reportedRequest(request, requestContent, purpose),
        ...(response === undefined
          ? {}
          : {
              response: {
                status: response.status,
                content:
                  body === undefined
                    ? { mimeType }
                    : { mimeType, text: body.content, encoding: "base64" },
              },
            }),
      },
      ...empty,
      binary_fields:
        body === undefined
          ? []
          : [
              {
                pointer: "/response/content/text",
                representation: "har-base64-content",
                state: "retained",
                bytes: body.bytes,
                sha256: body.sha256,
                content_base64: body.content,
              },
            ],
    },
    responseBody:
      body === undefined ? "absent" : body.redacted ? "redacted" : "retained",
  };
};

/** Project each network transaction, in request order, as one record; the ordinal is its zero-based position. */
export const scenarioCaptureRecords = (
  capture: RetainedBrowserScenarioCapture,
  purpose: "manifest" | "replay",
): ScenarioCaptureRecords => {
  const index = indexBrowserScenarioTransactions(capture.events.items);
  const timings = timingByTransaction(capture.events.items);
  const records: WebNetworkCaptureRecord[] = [];
  const responseBodies = new Map<number, ScenarioResponseBodyRetention>();
  let timed = false;
  let unknownDurations = 0;
  for (const [item, event] of capture.events.items.entries()) {
    if (event.kind !== "request") continue;
    const timing = recordTiming(event, timings);
    if (timing?.time === undefined) unknownDurations += 1;
    timed ||= timing !== undefined;
    const projected = record(
      records.length,
      { event, item },
      index,
      purpose,
      timing,
    );
    records.push(projected.record);
    if (purpose === "manifest")
      responseBodies.set(projected.record.ordinal, projected.responseBody);
  }
  return {
    records,
    totalRecords: records.length,
    responseBodies,
    limitations: [
      "Scenario records are the capture's network transactions in request order; each record ordinal is the transaction's zero-based position.",
      ...(timed
        ? [
            "Scenario record start times, when available, are the browser's own from a unique terminal event, or when the provider observed the request where the browser reported none; durations retain only values reported by a unique terminal event.",
          ]
        : []),
      ...(unknownDurations === 0
        ? []
        : [
            `${String(unknownDurations)} scenario request(s) had no unique reported duration; their duration is omitted and does not establish zero-length execution.`,
          ]),
      ...(capture.events.dropped > 0
        ? [
            `The scenario capture omitted ${String(capture.events.dropped)} events; the manifest covers only retained transactions.`,
          ]
        : []),
    ],
  };
};

/** An own data member of admitted parent data; the clone admission already refused accessors. */
const member = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && Object.hasOwn(value, key)
    ? (value as Readonly<Record<string, unknown>>)[key]
    : undefined;

/**
 * Bytes the manifest derives from a borrowed scenario: validation decodes and re-encodes one body at
 * a time (two bytes per base64 character), and projection keeps the decoded text of every request
 * body. Response bodies stay borrowed, as HAR response text does; retention metadata is keyed
 * by each request ordinal.
 */
const derivedTextBytes = (value: unknown): number => {
  const items = member(member(value, "events"), "items");
  let largestBody = 0;
  let requestText = 0;
  let responseBodyEntries = 0;
  // Each event is read on its own, so a body without content leaves the others counted.
  for (const event of Array.isArray(items) ? items : []) {
    if (member(event, "kind") === "request") responseBodyEntries += 1;
    const content = member(member(event, "body"), "content");
    if (
      member(event, "kind") !== "network-content" ||
      typeof content !== "string"
    )
      continue;
    largestBody = Math.max(largestBody, content.length);
    if (member(event, "phase") === "request")
      requestText += textBytes(Math.ceil((content.length * 3) / 4));
  }
  return 64 + largestBody * 2 + requestText + responseBodyEntries * ENTRY_BYTES;
};

/** Admit a capture_browser_scenario parent whose network content identifies response media types; state also needs bodies. */
export const admitScenarioCaptureParent = (
  parent: AnalysisViewParent,
  viewKind: "environment-manifest" | "environment-state",
  accumulator: WebNetworkProjectionAccumulator,
): Result<ScenarioCaptureRecords, AnalysisError> => {
  const admitted = accumulator.admitCaptureClone(parent.normalizedResult);
  if (!admitted.ok) return admitted;
  // Reserve body validation and request text before either allocation, even for a parent read from
  // a file, without charging the borrowed response bodies a large capture is made of.
  const derived = accumulator.admitDerivedBytes(
    derivedTextBytes(parent.normalizedResult),
  );
  if (!derived.ok) return derived;
  const parsed = retainedBrowserScenarioCaptureSchema.safeParse(
    parent.normalizedResult,
  );
  if (!parsed.success)
    return err(
      analysisViewResultInputError(parent.normalizedResult, parsed.error),
    );
  const content = parsed.data.scenario.network_content;
  // Tools are chosen by response media type, which only bodies or header values carry; state is read from bodies.
  if (
    viewKind === "environment-state"
      ? !content.response_body
      : !content.response_body && !content.header_values
  )
    return err(
      new AnalysisUnsupportedTargetError(
        "inspect_analysis_view",
        parent.evidenceId,
        viewKind === "environment-state"
          ? "environment-state needs a capture_browser_scenario capture with capture.network.response_body selected."
          : "environment-manifest needs a capture_browser_scenario capture with capture.network.response_body or header_values selected.",
      ),
    );
  return ok(scenarioCaptureRecords(parsed.data, "manifest"));
};
