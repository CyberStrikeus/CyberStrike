import { z } from "zod";

import { readRecordedRequestBody } from "../../domain/analysisView/recordedExchangeBody.js";
import {
  isJsonLike,
  mediaTypeEssence,
} from "../../domain/analysisView/recordedMediaType.js";
import {
  primaryOrigin,
  type OriginStats,
} from "../../domain/analysisView/environmentManifestOrigin.js";
import {
  readRecordedRequestLine,
  type RecordedRequestLine,
  type RequestLineExclusion,
} from "../../domain/analysisView/webNetworkRouteTemplates.js";
import { parseExactJson } from "../../domain/exactJsonNumber.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import {
  compareOffsetDateTimeInstants,
  readRecordedStart,
  type OffsetDateTimeInstant,
} from "../../domain/offsetDateTime.js";
import type { WebNetworkCaptureRecord } from "../../domain/webNetworkCapture.js";
import type { Answer } from "./environmentCompareDiff.js";
import type { ProbeRequest } from "./environmentCompareMatch.js";
import {
  recordedExchange,
  replayedBody,
  type ReplayedBody,
} from "./environmentSource.js";

/** A probe record left uncompared: without a usable request line, or at another origin than the application's, it is not replayed either; without an answer it is replayed, so the state follows, but nothing is compared. */
export interface UnobservedRecord {
  readonly ordinal: number;
  readonly reason: RequestLineExclusion | "other-origin" | "no-response";
}

/** One probe request with the application's answer, absent when the probe recorded none. */
export interface ProbeStep {
  readonly ordinal: number;
  readonly request: ProbeRequest;
  readonly live?: Answer;
}

/** Statuses whose answers carry no body, so a missing body is known to be empty. */
const BODYLESS_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

const startedSchema = z.object({ startedDateTime: z.string() });
const methodSchema = z.object({ request: z.object({ method: z.string() }) });

const startedInstant = (
  record: WebNetworkCaptureRecord,
): OffsetDateTimeInstant | undefined => {
  const started = startedSchema.safeParse(record.reported);
  if (!started.success) return undefined;
  return readRecordedStart(started.data.startedDateTime)?.instant;
};

/** Whether a probe makes calls that carry a request body: a POST, PUT or PATCH. */
export const sendsBodies = (
  records: readonly WebNetworkCaptureRecord[],
): boolean =>
  records.some((record) => {
    const parsed = methodSchema.safeParse(record.reported);
    return (
      parsed.success &&
      ["POST", "PUT", "PATCH"].includes(parsed.data.request.method)
    );
  });

/** The JSON a request body holds, its text when it is not JSON, or undefined without one. */
export const requestBody = (
  record: WebNetworkCaptureRecord,
): JsonValue | undefined => {
  const facts = readRecordedRequestBody(record.reported);
  if (facts.kind !== "request" || facts.postData.kind !== "object")
    return undefined;
  const { mimeType, text } = facts.postData;
  if (mimeType === undefined || text === undefined) return undefined;
  return isJsonLike(mediaTypeEssence(mimeType))
    ? (parseExactJson(text) ?? text)
    : text;
};

/** The application's answer as an environment answer carries it: JSON, text, or null when it is empty; a body the probe did not record is marked. */
const liveAnswer = (
  method: string,
  status: number,
  body: ReplayedBody,
): Answer => {
  if (body.kind === "none")
    return method === "HEAD" || BODYLESS_STATUSES.has(status)
      ? { status, body }
      : { status, body, unobserved: true };
  if (body.kind === "text" && body.text === "")
    return { status, body: { kind: "none" } };
  return { status, body };
};

/** The origin a probe calls the application at, chosen as the manifest chooses its own. */
const probeOrigin = (
  lines: ReadonlyMap<number, RecordedRequestLine | null>,
): string | null => {
  const origins = new Map<string, OriginStats>();
  for (const line of lines.values()) {
    if (line?.kind !== "line") continue;
    const stats = origins.get(line.origin) ?? { records: 0, jsonLike: 0 };
    stats.records += 1;
    if (isJsonLike(mediaTypeEssence(line.rawMime))) stats.jsonLike += 1;
    origins.set(line.origin, stats);
  }
  return primaryOrigin(origins);
};

/** The probe's requests in the order they were made, each with the application's answer, and the records left uncompared. */
export const probeRequests = (
  records: readonly WebNetworkCaptureRecord[],
): { steps: ProbeStep[]; unobserved: UnobservedRecord[] } => {
  const steps: ProbeStep[] = [];
  const unobserved: UnobservedRecord[] = [];
  // Without a start time for every record the probe keeps its recorded order, as state extraction does.
  const starts = new Map(
    records.map((record) => [record.ordinal, startedInstant(record)]),
  );
  const timed = [...starts.values()].every((instant) => instant !== undefined);
  const ordered = [...records].sort(
    (left, right) =>
      (timed
        ? compareOffsetDateTimeInstants(
            starts.get(left.ordinal)!,
            starts.get(right.ordinal)!,
          )
        : 0) || left.ordinal - right.ordinal,
  );
  const lines = new Map(
    records.map((record) => [
      record.ordinal,
      readRecordedRequestLine(record.reported, true, () => true),
    ]),
  );
  // Another origin's request goes to some other server, so it neither calls nor changes the environment.
  const origin = probeOrigin(lines);
  for (const record of ordered) {
    const line = lines.get(record.ordinal);
    const { ordinal } = record;
    if (line?.kind === "line" && line.origin !== origin)
      unobserved.push({ ordinal, reason: "other-origin" });
    else if (line?.kind !== "line")
      unobserved.push({
        ordinal,
        reason: line?.kind === "excluded" ? line.reason : "request-unavailable",
      });
    else {
      const exchange = recordedExchange(record, line);
      const request = {
        method: line.method,
        path: exchange.path,
        query: exchange.query,
        body: requestBody(record),
      };
      // A request whose answer was lost may still have changed the application, so it is made but not compared.
      if (exchange.status === null) {
        unobserved.push({ ordinal, reason: "no-response" });
        steps.push({ ordinal, request });
      } else
        steps.push({
          ordinal,
          request,
          live: liveAnswer(
            line.method,
            exchange.status,
            replayedBody(exchange),
          ),
        });
    }
  }
  return { steps, unobserved };
};
