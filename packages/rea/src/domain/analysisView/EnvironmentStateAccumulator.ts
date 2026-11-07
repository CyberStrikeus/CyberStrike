import { z } from "zod";
import type { AnalysisError } from "../analysisErrorBase.js";
import { parseExactJson } from "../exactJsonNumber.js";
import { MAX_JSON_DEPTH, type JsonValue } from "../jsonValue.js";
import {
  compareOffsetDateTimeInstants,
  readRecordedStart,
} from "../offsetDateTime.js";
import { ok, type Result } from "../result.js";
import {
  WEB_NETWORK_CAPTURE_LIMITS,
  type WebNetworkCaptureRecord,
} from "../webNetworkCapture.js";
import { EnvironmentManifestAccumulator } from "./EnvironmentManifestAccumulator.js";
import { isJsonLike, mediaTypeEssence } from "./recordedMediaType.js";
import { readRecordedRequestBody } from "./recordedExchangeBody.js";
import { EnvironmentStateExtraction } from "./EnvironmentStateExtraction.js";
import type { TemplateRule } from "./environmentManifestRules.js";
import {
  deeperThan,
  isStateWrite,
  STATE_BODY_LIMIT_BYTES,
  type ParsedBody,
  type ParsedRequestBody,
  type StateRecordFacts,
  type StateTimeline,
} from "./environmentStateRules.js";
import {
  base64PrefixChars,
  readRecordedResponseBody,
  readRecordedResponseDeclaration,
  recordedResponseBodyIsEmpty,
  type RecordedResponseBody,
} from "./recordedResponseBody.js";
import {
  ENTRY_BYTES,
  RECORD_SCRATCH_BYTES,
  type RecordedRequestLine,
  textBytes,
} from "./webNetworkRouteTemplates.js";

/**
 * Levels the state's own nesting adds above a recorded value: Evidence, a `data/get` reply and a
 * JSON-RPC response hold a body's members about ten levels down, so a body must leave this much
 * room under the JSON depth limit to be sealed and served.
 */
const STATE_NESTING_DEPTH = 16;

/** A recorded response body as state JSON: a JSON-like media type, complete UTF-8 text within the state body limit, exact numbers; otherwise undefined. */
export const stateBodyJson = (
  contentType: string | null,
  body: RecordedResponseBody,
): JsonValue | undefined => {
  if (
    contentType === null ||
    !isJsonLike(mediaTypeEssence(contentType)) ||
    body.bodyText === null ||
    body.bodyEncoding === "base64" ||
    body.bodyCut === true ||
    Buffer.byteLength(body.bodyText, "utf8") > STATE_BODY_LIMIT_BYTES
  )
    return undefined;
  const value = parseExactJson(body.bodyText);
  return value === undefined ||
    deeperThan(value, MAX_JSON_DEPTH - STATE_NESTING_DEPTH)
    ? undefined
    : value;
};

const startSchema = z.object({ startedDateTime: z.string() });
const durationSchema = z.object({ time: z.number().nonnegative() });
const redactedWriteSchema = z.object({
  request: z.object({ method: z.string() }),
  response: z.object({ status: z.number() }).optional(),
});
interface RecordEntry {
  readonly facts: StateRecordFacts;
  /** Null for a write whose URL was redacted: its target is unknown, so it bounds every type. */
  readonly origin: string | null;
  readonly contentType: string;
  readonly startInterpretation:
    | NonNullable<ReturnType<typeof readRecordedStart>>["interpretation"]
    | undefined;
  readonly record: WebNetworkCaptureRecord;
}

const UNKNOWNS = [
  {
    kind: "authorization-model" as const,
    statement:
      "Authorization headers and cookies are structurally excluded from captures; the state states no authorization model.",
  },
  {
    kind: "response-semantics" as const,
    statement:
      "Views reproduce their recorded responses from the state; they do not establish how the application computes responses, derived values or values copied outside entity objects.",
  },
  {
    kind: "state-transition" as const,
    statement:
      "The state is one snapshot from before the first related recorded write; write effects are modelled only from the calls the capture recorded, and served only where its later reads confirmed them.",
  },
];

/** The manifest's grouping plus the record facts and bodies the init state is extracted from. */
export class EnvironmentStateAccumulator extends EnvironmentManifestAccumulator {
  readonly #entries = new Map<number, RecordEntry>();
  readonly #bodyReleases: (() => void)[] = [];

  constructor(
    maximumBytes = WEB_NETWORK_CAPTURE_LIMITS.outputBytes,
    rules: readonly TemplateRule[] = [],
  ) {
    super(maximumBytes, true, rules, "Environment-state");
  }

  /** The state publishes no body shapes. */
  protected override get reportsBodyShapes(): boolean {
    return false;
  }

  protected override onRecordedRequestLine(
    record: WebNetworkCaptureRecord,
    line: RecordedRequestLine,
  ): Result<void, AnalysisError> {
    const started = startSchema.safeParse(record.reported);
    const duration = durationSchema.safeParse(record.reported);
    // Admit normalization and fraction parsing before materializing their strings.
    if (
      started.success &&
      !this.scratch(
        RECORD_SCRATCH_BYTES +
          textBytes(started.data.startedDateTime.length + 6) * 3,
      )
    )
      return this.overBudget();
    const reading = started.success
      ? readRecordedStart(started.data.startedDateTime)
      : undefined;
    const startInstant = reading?.instant;
    // Keep the established millisecond interval policy independently of sorting.
    const startMs =
      startInstant === undefined
        ? undefined
        : startInstant.epochSecond * 1000 +
          Number(startInstant.fraction.slice(0, 3).padEnd(3, "0"));
    const end =
      startMs === undefined || !duration.success
        ? undefined
        : startMs + duration.data.time;
    const timing: StateRecordFacts["timing"] = {
      start:
        startInstant === undefined || startMs === undefined
          ? undefined
          : { instant: startInstant, ms: startMs },
      endMs: end !== undefined && Number.isFinite(end) ? end : undefined,
    };
    // A fraction substring may retain its normalized timestamp's backing store,
    // including trailing zeroes removed from the exact comparison value.
    const instantBytes =
      started.success && startInstant !== undefined
        ? ENTRY_BYTES + textBytes(started.data.startedDateTime.length + 6)
        : 0;
    if (line.kind === "excluded")
      return line.reason === "url-redacted"
        ? this.#redactedWrite(
            record,
            timing,
            instantBytes,
            reading?.interpretation,
          )
        : ok(undefined);
    // The entry keeps the line's strings and a reference to the already admitted record.
    if (
      !this.retain(
        ENTRY_BYTES * 8 +
          instantBytes +
          textBytes(
            line.method.length +
              line.origin.length +
              line.path.length +
              (line.query?.length ?? 0) +
              line.rawMime.length,
          ),
      )
    )
      return this.overBudget();
    this.#entries.set(record.ordinal, {
      facts: {
        ordinal: record.ordinal,
        method: line.method,
        path: line.path,
        query: line.query === "" ? undefined : line.query,
        status: line.status,
        timing,
      },
      origin: line.origin,
      contentType: line.rawMime,
      startInterpretation: reading?.interpretation,
      record,
    });
    return ok(undefined);
  }

  /** Keep a successful write whose URL was redacted, with an empty path whose root relates to every type. */
  #redactedWrite(
    record: WebNetworkCaptureRecord,
    timing: StateRecordFacts["timing"],
    instantBytes: number,
    startInterpretation: RecordEntry["startInterpretation"],
  ): Result<void, AnalysisError> {
    const parsed = redactedWriteSchema.safeParse(record.reported);
    if (!parsed.success) return ok(undefined);
    const status = parsed.data.response?.status ?? 0;
    const facts: StateRecordFacts = {
      ordinal: record.ordinal,
      method: parsed.data.request.method,
      path: "",
      query: undefined,
      status: status > 0 ? status : null,
      timing,
    };
    if (!isStateWrite(facts)) return ok(undefined);
    if (
      !this.retain(
        ENTRY_BYTES * 8 + textBytes(facts.method.length) + instantBytes,
      )
    )
      return this.overBudget();
    this.#entries.set(record.ordinal, {
      facts,
      origin: null,
      contentType: "",
      startInterpretation,
      record,
    });
    return ok(undefined);
  }

  /** Parse one retained response body as state JSON, charging its decoding and tree as temporary work. */
  #body(ordinal: number): ParsedBody | null {
    this.#bodyReleases.push(this.temporaryCheckpoint());
    const entry = this.#entries.get(ordinal);
    // A body that is not JSON-like is refused before its decoding is charged.
    if (entry === undefined || !isJsonLike(mediaTypeEssence(entry.contentType)))
      return { kind: "unusable" };
    const declaration = readRecordedResponseDeclaration(entry.record.reported);
    const content = declaration?.content;
    if (typeof content?.text !== "string") return { kind: "unusable" };
    // Larger bodies are never parsed; within the limit, decoding copies at most the retained text and the tree is linear in it.
    const length = content.text.length;
    if (length > base64PrefixChars(STATE_BODY_LIMIT_BYTES))
      return { kind: "unusable" };
    if (!this.temporary(RECORD_SCRATCH_BYTES + textBytes(length) * 4))
      return null;
    const value = stateBodyJson(
      entry.contentType,
      readRecordedResponseBody(
        entry.record,
        STATE_BODY_LIMIT_BYTES,
        declaration,
      ),
    );
    return value === undefined ? { kind: "unusable" } : { kind: "json", value };
  }

  /** Parse one recorded request body as state JSON, as response bodies are admitted. */
  #withRequestBody<T>(
    ordinal: number,
    use: (body: ParsedRequestBody) => T,
  ): T | null {
    const entry = this.#entries.get(ordinal);
    const request = readRecordedRequestBody(entry?.record.reported);
    if (
      entry === undefined ||
      request.kind !== "request" ||
      request.bodySize.kind === "invalid"
    )
      return use({ kind: "unusable" });
    const { postData, bodySize } = request;
    const zeroSize = bodySize.kind === "number" && bodySize.value === 0;
    if (postData.kind === "missing")
      return use({ kind: zeroSize ? "absent" : "unusable" });
    if (
      postData.kind !== "object" ||
      postData.text === undefined ||
      postData.mimeType === undefined ||
      postData.params.kind === "invalid"
    )
      return use({ kind: "unusable" });
    const { mimeType, text, params } = postData;
    if (
      zeroSize &&
      text === "" &&
      (params.kind === "array" ? params.count : 0) === 0
    )
      return use({ kind: "absent" });
    if (
      !isJsonLike(mediaTypeEssence(mimeType)) ||
      Buffer.byteLength(text, "utf8") > STATE_BODY_LIMIT_BYTES
    )
      return use({ kind: "unusable" });
    const release = this.temporaryCheckpoint();
    try {
      if (!this.temporary(RECORD_SCRATCH_BYTES + textBytes(text.length) * 4))
        return null;
      const value = stateBodyJson(mimeType, { bodyText: text });
      return use(
        value === undefined ? { kind: "unusable" } : { kind: "json", value },
      );
    } finally {
      release();
    }
  }

  /** State inference accepts a 204 or known decoded empty content, independently of manifest eligibility. */
  #emptyResponse(ordinal: number): boolean {
    const entry = this.#entries.get(ordinal);
    if (entry === undefined) return false;
    if (entry.facts.status === 204) return true;
    return recordedResponseBodyIsEmpty(entry.record);
  }

  /** Project the init state of the manifest's primary origin; records keep timeline order. */
  finishState() {
    const manifest = this.finish();
    if (!manifest.ok) return manifest;
    const entries = [...this.#entries.values()].filter(
      (entry) =>
        entry.origin === manifest.value.origin || entry.origin === null,
    );
    const redactedWrites = entries.filter(
      (entry) => entry.origin === null,
    ).length;
    const timeline: StateTimeline =
      entries.length > 0 &&
      entries.every((entry) => entry.facts.timing.start !== undefined)
        ? "recorded-start-time"
        : "record-order";
    const records = entries
      .sort((left, right) =>
        timeline === "record-order"
          ? left.facts.ordinal - right.facts.ordinal
          : compareOffsetDateTimeInstants(
              left.facts.timing.start!.instant,
              right.facts.timing.start!.instant,
            ) || left.facts.ordinal - right.facts.ordinal,
      )
      .map((entry) => entry.facts);
    const state = new EnvironmentStateExtraction({
      tools: manifest.value.tools,
      records,
      timeline,
      budget: {
        body: (ordinal) => this.#body(ordinal),
        withRequestBody: (ordinal, use) => this.#withRequestBody(ordinal, use),
        emptyResponse: (ordinal) => this.#emptyResponse(ordinal),
        retain: (bytes) => this.retain(bytes),
        checkpoint: () => this.retainedCheckpoint(),
        release: () => this.#bodyReleases.pop()?.(),
      },
    }).run();
    if (state === null) return this.overBudget();
    const limitations = this.addLimitations([
      ...(entries.some((entry) => entry.startInterpretation === "native-date")
        ? [
            "Some recorded start spellings use native Date parsing at millisecond precision; spellings without an explicit zone depend on the host timezone.",
          ]
        : []),
      ...(redactedWrites > 0
        ? [
            `${String(redactedWrites)} of the recorded writes had a redacted URL; each ends the initial state of every type, since its target is unknown.`,
          ]
        : []),
      ...(timeline === "record-order"
        ? [
            "Some records carry no start time, so the state's timeline is record order and overlapping requests are not detected.",
          ]
        : []),
      ...(timeline === "recorded-start-time" &&
      records.some((record) => record.timing.endMs === undefined)
        ? [
            "Some records carry no usable request duration; their completion and overlap remain unknown.",
          ]
        : []),
      ...(state.views.some((view) => view.shape === "recorded")
        ? [
            "Tools whose recordings do not reproduce from the extracted state are listed as recorded views with the reason; they replay their recordings.",
          ]
        : []),
    ]);
    if (!limitations.ok) return limitations;
    return ok({
      origin: manifest.value.origin,
      name: manifest.value.name,
      timeline,
      ...state,
      unknowns: UNKNOWNS.map((unknown) => ({ ...unknown })),
      coverage: manifest.value.coverage,
      limitations: this.sortedLimitations(),
    });
  }
}
