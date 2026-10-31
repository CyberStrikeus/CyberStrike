import { z } from "zod";

import type { JsonValue } from "../jsonValue.js";
import type { ProcessCapture } from "./processCaptureParsing.js";
import { processSourceTruncated } from "./processCaptureCoverage.js";
import {
  comparableProcessObservationPayload,
  processObservationLocationSchema,
  projectProcessObservation,
  type ProcessObservationLocation,
  type ProcessObservationSource,
} from "./processObservation.js";
import {
  canonicalTraceJson,
  processTraceCardinalityBounds,
  processTraceIdentifierSchema,
  type ProcessTraceSpecification,
} from "./processTraceSpecification.js";

const matchedEventSchema = z.strictObject({
  event_id: processTraceIdentifierSchema,
  location: processObservationLocationSchema,
});

const sideResultShape = {
  satisfied_constraints: z.array(z.string()),
  raw_trace: z.array(matchedEventSchema),
};

const sideResultSchema = z.union([
  z.strictObject({
    ...sideResultShape,
    status: z.literal("pass"),
    matched_variant: processTraceIdentifierSchema.nullable(),
  }),
  z.strictObject({
    ...sideResultShape,
    status: z.enum(["fail", "unknown"]),
    matched_variant: z.null(),
  }),
]);

const diagnosticSchema = z.strictObject({
  kind: z.enum([
    "journal",
    "predicate",
    "cardinality",
    "edge",
    "prefix",
    "suffix",
    "trace",
  ]),
  side: z.enum(["left", "right"]),
  message: z.string(),
  event_ids: z.array(processTraceIdentifierSchema),
  locations: z.array(processObservationLocationSchema),
});

/** Structured verdict for one declared process trace language. */
export const processTraceComparisonResultSchema = z.strictObject({
  verdict: z.enum(["equivalent", "different", "nonconforming", "unknown"]),
  left: sideResultSchema,
  right: sideResultSchema,
  diagnostic: diagnosticSchema.nullable(),
});
export type ProcessTraceComparisonResult = z.infer<
  typeof processTraceComparisonResultSchema
>;

type TraceRecord = {
  readonly source: ProcessObservationSource;
  readonly payload: JsonValue;
  readonly location: ProcessObservationLocation;
};

const scopesFor = (
  sources: ReadonlySet<ProcessObservationSource>,
): ReadonlySet<string> =>
  new Set(
    [...sources].map((source) => {
      if (source.startsWith("terminal_")) return "terminal";
      if (source === "lifecycle") return "exit";
      if (source === "filesystem") return "filesystem";
      if (source === "process") return "process";
      return "interaction";
    }),
  );

const unknownSide = (
  rawTrace: z.infer<typeof matchedEventSchema>[] = [],
): z.infer<typeof sideResultSchema> => ({
  status: "unknown",
  matched_variant: null,
  satisfied_constraints: [],
  raw_trace: rawTrace,
});

export type EvaluatedSide = {
  readonly result: z.infer<typeof sideResultSchema>;
  readonly diagnostic: Omit<z.infer<typeof diagnosticSchema>, "side"> | null;
};

type FailureInput = {
  readonly kind: z.infer<typeof diagnosticSchema>["kind"];
  readonly message: string;
  readonly eventIds: readonly string[];
  readonly locations: readonly ProcessObservationLocation[];
  readonly rawTrace: z.infer<typeof matchedEventSchema>[];
};

const failure = (input: FailureInput): EvaluatedSide => ({
  result: {
    status: "fail",
    matched_variant: null,
    satisfied_constraints: [],
    raw_trace: input.rawTrace,
  },
  diagnostic: {
    kind: input.kind,
    message: input.message,
    event_ids: [...input.eventIds],
    locations: [...input.locations],
  },
});

type FiniteTraceEvaluation =
  | { readonly status: "pass"; readonly variant: string }
  | {
      readonly status: "fail";
      readonly eventIds: readonly string[];
      readonly locationIndexes: readonly number[];
    };

/** Distinguish pure omissions from displaced successors, without relaxing the language. */
const finiteTraceOmissions = (
  ids: readonly string[],
  tokens: Extract<
    ProcessTraceSpecification["language"],
    { kind: "finite_traces" }
  >["variants"][number]["trace"],
): readonly string[] | undefined => {
  let observed = 0;
  const missing: string[] = [];
  for (const token of tokens) {
    const remaining = new Map<string, number>();
    for (const id of typeof token === "string" ? [token] : token.unordered)
      remaining.set(id, (remaining.get(id) ?? 0) + 1);
    while (observed < ids.length) {
      const id = ids[observed];
      const count = id === undefined ? 0 : (remaining.get(id) ?? 0);
      if (id === undefined || count === 0) break;
      if (count === 1) remaining.delete(id);
      else remaining.set(id, count - 1);
      observed++;
    }
    for (const [id, count] of remaining)
      for (let index = 0; index < count; index++) missing.push(id);
  }
  return observed === ids.length && missing.length > 0 ? missing : undefined;
};

/** Match variants once, retaining the best-prefix mismatch for attribution. */
const evaluateFiniteTrace = (
  ids: readonly string[],
  language: Extract<
    ProcessTraceSpecification["language"],
    { kind: "finite_traces" }
  >,
): FiniteTraceEvaluation => {
  let bestPrefix = -1;
  const bestEventIds = new Set<string>();
  const bestLocationIndexes = new Set<number>();

  const recordMismatch = (
    offset: number,
    missing: readonly string[],
    unexpected: readonly { readonly id: string; readonly index: number }[],
  ): void => {
    if (offset > bestPrefix) {
      bestPrefix = offset;
      bestEventIds.clear();
      bestLocationIndexes.clear();
    }
    if (offset !== bestPrefix) return;
    for (const eventId of missing) bestEventIds.add(eventId);
    for (const { id, index } of unexpected) {
      bestEventIds.add(id);
      bestLocationIndexes.add(index);
    }
  };

  for (const variant of language.variants) {
    let offset = 0;
    let mismatched = false;
    for (const token of variant.trace) {
      const expected = typeof token === "string" ? [token] : token.unordered;
      const actual = ids.slice(offset, offset + expected.length);
      const remaining = new Map<string, number>();
      for (const eventId of expected)
        remaining.set(eventId, (remaining.get(eventId) ?? 0) + 1);
      const unexpected: Array<{ readonly id: string; readonly index: number }> =
        [];
      for (const [index, eventId] of actual.entries()) {
        const count = remaining.get(eventId) ?? 0;
        if (count === 0)
          unexpected.push({ id: eventId, index: offset + index });
        else if (count === 1) remaining.delete(eventId);
        else remaining.set(eventId, count - 1);
      }
      const missing = [...remaining].flatMap(([eventId, count]) =>
        Array.from({ length: count }, () => eventId),
      );
      if (
        missing.length > 0 ||
        unexpected.length > 0 ||
        actual.length < expected.length
      ) {
        const omitted = finiteTraceOmissions(ids, variant.trace);
        recordMismatch(
          offset,
          omitted ?? missing,
          omitted === undefined ? unexpected : [],
        );
        mismatched = true;
        break;
      }
      offset += expected.length;
    }

    if (mismatched) continue;
    if (offset === ids.length) return { status: "pass", variant: variant.id };
    const unexpected = ids[offset];
    recordMismatch(
      offset,
      [],
      unexpected === undefined ? [] : [{ id: unexpected, index: offset }],
    );
  }

  return {
    status: "fail",
    eventIds: [...bestEventIds],
    locationIndexes: [...bestLocationIndexes],
  };
};

type MatchedTrace = {
  readonly rawTrace: z.infer<typeof matchedEventSchema>[];
  readonly locationsById: ReadonlyMap<string, ProcessObservationLocation[]>;
};

const collectRecords = (
  capture: ProcessCapture,
  sources: ReadonlySet<ProcessObservationSource>,
): readonly TraceRecord[] => {
  const records: TraceRecord[] = [];
  for (const location of capture.event_journal) {
    const record = projectProcessObservation(capture, location);
    if (record !== null && sources.has(record.source))
      records.push({
        source: record.source,
        payload: record.payload,
        location,
      });
  }
  return records;
};

const matchRecords = (
  records: readonly TraceRecord[],
  specification: ProcessTraceSpecification,
): MatchedTrace | EvaluatedSide => {
  const rawTrace: z.infer<typeof matchedEventSchema>[] = [];
  const locationsById = new Map<string, ProcessObservationLocation[]>();
  const ignoredFieldsBySource = new Map<
    ProcessObservationSource,
    readonly string[]
  >();
  const eventsByKey = new Map<
    string,
    ProcessTraceSpecification["events"][number]
  >();
  for (const event of specification.events) {
    const ignoredFields = event.ignore_fields ?? [];
    ignoredFieldsBySource.set(event.source, ignoredFields);
    eventsByKey.set(
      `${event.source}\0${canonicalTraceJson(
        comparableProcessObservationPayload(event.exact, ignoredFields),
      )}`,
      event,
    );
  }
  for (const record of records) {
    const match = eventsByKey.get(
      `${record.source}\0${canonicalTraceJson(
        comparableProcessObservationPayload(
          record.payload,
          ignoredFieldsBySource.get(record.source),
        ),
      )}`,
    );
    if (match === undefined)
      return failure({
        kind: "predicate",
        message: "Observed event does not match any declared exact predicate.",
        eventIds: [],
        locations: [record.location],
        rawTrace,
      });
    rawTrace.push({ event_id: match.id, location: record.location });
    const locations = locationsById.get(match.id) ?? [];
    locations.push(record.location);
    locationsById.set(match.id, locations);
  }
  return { rawTrace, locationsById };
};

const cardinalityFailure = (
  trace: MatchedTrace,
  specification: ProcessTraceSpecification,
): EvaluatedSide | null => {
  for (const event of specification.events) {
    const [minimum, maximum] = processTraceCardinalityBounds(event.cardinality);
    const locations = trace.locationsById.get(event.id) ?? [];
    if (locations.length < minimum || locations.length > maximum)
      return failure({
        kind: "cardinality",
        message: `${event.id} observed ${String(locations.length)} times; expected ${String(minimum)}..${String(maximum)}.`,
        eventIds: [event.id],
        locations,
        rawTrace: trace.rawTrace,
      });
  }
  return null;
};

type PartialOrderLanguage = Extract<
  ProcessTraceSpecification["language"],
  { readonly kind: "partial_order" }
>;

const evaluateOrderingConstraints = (
  trace: MatchedTrace,
  language: PartialOrderLanguage,
): { readonly failure: EvaluatedSide | null; readonly satisfied: string[] } => {
  const satisfied: string[] = [];
  const failures: FailureInput[] = [];
  for (const edge of language.happens_before) {
    const before = trace.locationsById.get(edge.before) ?? [];
    const after = trace.locationsById.get(edge.after) ?? [];
    const lastBefore = before.at(-1);
    const firstAfter = after[0];
    if (lastBefore === undefined && firstAfter !== undefined)
      failures.push({
        kind: "edge",
        message: `${edge.before} is required when ${edge.after} occurs.`,
        eventIds: [edge.before, edge.after],
        locations: [firstAfter],
        rawTrace: trace.rawTrace,
      });
    else if (
      lastBefore !== undefined &&
      firstAfter !== undefined &&
      lastBefore.capture_order >= firstAfter.capture_order
    )
      failures.push({
        kind: "edge",
        message: `${edge.before} must happen before ${edge.after}.`,
        eventIds: [edge.before, edge.after],
        locations: [lastBefore, firstAfter],
        rawTrace: trace.rawTrace,
      });
    else satisfied.push(`happens_before:${edge.before}:${edge.after}`);
  }
  for (const constraint of language.not_before) {
    const events = trace.locationsById.get(constraint.event) ?? [];
    const anchors = trace.locationsById.get(constraint.anchor) ?? [];
    const firstEvent = events[0];
    const firstAnchor = anchors[0];
    if (firstEvent !== undefined && firstAnchor === undefined)
      failures.push({
        kind: "edge",
        message: `${constraint.anchor} is required when ${constraint.event} occurs.`,
        eventIds: [constraint.event, constraint.anchor],
        locations: [firstEvent],
        rawTrace: trace.rawTrace,
      });
    else if (
      firstEvent !== undefined &&
      firstAnchor !== undefined &&
      firstEvent.capture_order < firstAnchor.capture_order
    )
      failures.push({
        kind: "edge",
        message: `${constraint.event} must not occur before ${constraint.anchor}.`,
        eventIds: [constraint.event, constraint.anchor],
        locations: [firstEvent, firstAnchor],
        rawTrace: trace.rawTrace,
      });
    else satisfied.push(`not_before:${constraint.event}:${constraint.anchor}`);
  }
  if (failures.length === 0) return { failure: null, satisfied };
  const unique = <T>(values: readonly T[], key: (value: T) => string): T[] => [
    ...new Map(values.map((value) => [key(value), value])).values(),
  ];
  return {
    failure: failure({
      kind: "edge",
      message: failures.map(({ message }) => message).join(" "),
      eventIds: unique(
        failures.flatMap(({ eventIds }) => eventIds),
        String,
      ),
      locations: unique(
        failures.flatMap(({ locations }) => locations),
        ({ collection, index }) => `${collection}:${String(index)}`,
      ),
      rawTrace: trace.rawTrace,
    }),
    satisfied,
  };
};

const boundaryFailure = (
  trace: MatchedTrace,
  kind: "prefix" | "suffix",
  expected: readonly string[],
): EvaluatedSide | null => {
  const ids = trace.rawTrace.map(({ event_id }) => event_id);
  const actual =
    kind === "prefix"
      ? ids.slice(0, expected.length)
      : expected.length === 0
        ? []
        : ids.slice(-expected.length);
  if (canonicalTraceJson(actual) === canonicalTraceJson(expected)) return null;
  const locations =
    kind === "prefix"
      ? trace.rawTrace.slice(0, expected.length)
      : trace.rawTrace.slice(-expected.length);
  return failure({
    kind,
    message: `Observed trace does not satisfy the declared ${kind}.`,
    eventIds: expected,
    locations: locations.map(({ location }) => location),
    rawTrace: trace.rawTrace,
  });
};

const evaluatePartialOrder = (
  trace: MatchedTrace,
  language: PartialOrderLanguage,
): EvaluatedSide => {
  const ordering = evaluateOrderingConstraints(trace, language);
  if (ordering.failure !== null) return ordering.failure;
  const prefixFailure = boundaryFailure(trace, "prefix", language.prefix);
  if (prefixFailure !== null) return prefixFailure;
  const suffixFailure = boundaryFailure(trace, "suffix", language.suffix);
  if (suffixFailure !== null) return suffixFailure;
  const satisfied = ordering.satisfied;
  satisfied.push(
    ...language.unordered_groups.map(
      ({ events }) => `unordered:${events.join(":")}`,
    ),
  );
  if (language.prefix.length > 0)
    satisfied.push(`prefix:${language.prefix.join(":")}`);
  if (language.suffix.length > 0)
    satisfied.push(`suffix:${language.suffix.join(":")}`);
  return {
    result: {
      status: "pass",
      matched_variant: null,
      satisfied_constraints: satisfied,
      raw_trace: trace.rawTrace,
    },
    diagnostic: null,
  };
};

const evaluateMatchedTrace = (
  trace: MatchedTrace,
  specification: ProcessTraceSpecification,
): EvaluatedSide => {
  const invalidCardinality = cardinalityFailure(trace, specification);
  if (invalidCardinality !== null) return invalidCardinality;
  if (specification.language.kind === "partial_order")
    return evaluatePartialOrder(trace, specification.language);
  const ids = trace.rawTrace.map(({ event_id }) => event_id);
  const evaluation = evaluateFiniteTrace(ids, specification.language);
  return evaluation.status === "fail"
    ? failure({
        kind: "trace",
        message: "Observed events do not match any finite trace variant.",
        eventIds: evaluation.eventIds,
        locations: evaluation.locationIndexes.flatMap((index) => {
          const location = trace.rawTrace[index]?.location;
          return location === undefined ? [] : [location];
        }),
        rawTrace: trace.rawTrace,
      })
    : {
        result: {
          status: "pass",
          matched_variant: evaluation.variant,
          satisfied_constraints: [`variant:${evaluation.variant}`],
          raw_trace: trace.rawTrace,
        },
        diagnostic: null,
      };
};

export const evaluateProcessTraceSide = (
  capture: ProcessCapture,
  specification: ProcessTraceSpecification,
): EvaluatedSide => {
  const sources = new Set(specification.events.map(({ source }) => source));
  const relevantScopes = scopesFor(sources);
  const incomplete =
    [...sources].some((source) => processSourceTruncated(capture, source)) ||
    capture.residual_unknowns.some(({ scope }) => relevantScopes.has(scope));
  if (capture.event_journal.length === 0)
    return {
      result: unknownSide(),
      diagnostic: {
        kind: "journal",
        message: "Capture has no cross-source event journal.",
        event_ids: [],
        locations: [],
      },
    };
  const matched = matchRecords(collectRecords(capture, sources), specification);
  if (incomplete)
    return {
      result: unknownSide(
        "rawTrace" in matched ? matched.rawTrace : matched.result.raw_trace,
      ),
      diagnostic: null,
    };
  return "rawTrace" in matched
    ? evaluateMatchedTrace(matched, specification)
    : matched;
};
