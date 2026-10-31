import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import {
  ownMember,
  pathSegmentMatches,
} from "../../domain/analysisView/environmentStateRules.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import {
  iterateUrlQueryParameters,
  recordedPathSegments,
} from "../../domain/recordedTransportUrl.js";
import { err, ok, type Result } from "../../domain/result.js";
import { environmentToolArguments } from "./environmentTools.js";
import {
  REPLAY_BODY_LIMIT_BYTES,
  ENVIRONMENT_SERVE_OPERATION,
  replayedBody,
  type EnvironmentManifestTool,
  type EnvironmentSource,
  type RecordedExchange,
} from "./environmentSource.js";

/** Caller arguments as the MCP tool receives them. */
export type ReplayArguments = Readonly<Record<string, unknown>>;
/** Raw query spelling from an observed request; null means no `?` delimiter. */
export type ObservedQuery = string | null;

/** What one tool call returns: the recorded response and where it came from. */
export interface ReplayResult {
  readonly status: number | null;
  readonly content_type: string | null;
  readonly body: JsonValue;
  readonly replay: {
    readonly record_ordinal: number;
    readonly evidence_id: string;
    readonly exact_match: boolean;
    readonly recorded_path: string;
    readonly recorded_query: string | null;
    /** Set when the recorded path or query was cut to REPLAY_METADATA_LIMIT_BYTES; the Evidence record keeps it whole. */
    readonly recorded_line_truncated: boolean;
    readonly content_type_truncated: boolean;
    readonly body_recorded: boolean;
    readonly body_encoding: "utf-8" | "base64";
    readonly truncated: boolean;
  };
}

interface MatchScore {
  readonly pathMatches: number;
  /** Path matches whose recorded segment equals the value as given, not only after decoding. */
  readonly verbatimMatches: number;
  readonly queryMatches: number;
  readonly observedOrderMatches: number;
  readonly exact: boolean;
}

/** Count how many supplied path and query values the recorded request line satisfies. */
const scoreExchange = (
  tool: EnvironmentManifestTool,
  pathArguments: ReadonlyMap<string, string>,
  queryArguments: ReadonlyMap<string, string>,
  exchange: RecordedExchange,
  args: ReplayArguments,
  observedQuery?: ObservedQuery,
): MatchScore => {
  const providedPaths: { index: number; value: string }[] = [];
  for (const param of tool.params) {
    const value = ownMember(args, pathArguments.get(param.name) ?? param.name);
    if (typeof value === "string")
      providedPaths.push({ index: param.index, value });
  }
  const segments =
    providedPaths.length === 0
      ? new Map<number, string>()
      : recordedPathSegments(
          exchange.path,
          providedPaths.map((param) => param.index),
        );
  const pathProvided = providedPaths.length;
  let pathMatches = 0;
  let verbatimMatches = 0;
  for (const { index, value } of providedPaths) {
    const segment = segments.get(index);
    if (segment === value) verbatimMatches += 1;
    if (segment !== undefined && pathSegmentMatches(segment, value))
      pathMatches += 1;
  }
  const supplied = new Map<string, readonly string[]>();
  for (const [name, argument] of queryArguments) {
    const value = ownMember(args, argument);
    if (typeof value === "string") supplied.set(name, [value]);
    else if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    )
      supplied.set(name, value);
  }
  const recorded = new Map<string, string[]>();
  const inspectQuery = supplied.size > 0 || observedQuery !== undefined;
  const recordedPairs = inspectQuery
    ? [
        ...iterateUrlQueryParameters(
          exchange.query ?? "",
          observedQuery === undefined ? supplied : queryArguments,
        ),
      ]
    : [];
  for (const [name, value] of recordedPairs) {
    const values = recorded.get(name) ?? [];
    values.push(value);
    recorded.set(name, values);
  }
  const matched = new Set<string>();
  for (const [name, values] of supplied) {
    const actual = recorded.get(name);
    if (
      actual !== undefined &&
      actual.length === values.length &&
      actual.every((value, index) => value === values[index])
    )
      matched.add(name);
  }
  const queryProvided = supplied.size;
  const queryMatches = matched.size;
  const observedOccurrences = new Map<string, number>();
  const observedPairs =
    observedQuery === undefined
      ? undefined
      : [...iterateUrlQueryParameters(observedQuery ?? "", queryArguments)].map(
          ([name, rawValue]) => {
            const occurrence = observedOccurrences.get(name) ?? 0;
            observedOccurrences.set(name, occurrence + 1);
            const argument = queryArguments.get(name);
            const value =
              argument === undefined ? undefined : ownMember(args, argument);
            const normalized =
              typeof value === "string"
                ? occurrence === 0
                  ? value
                  : rawValue
                : Array.isArray(value) && typeof value[occurrence] === "string"
                  ? value[occurrence]
                  : rawValue;
            return [name, normalized] as const;
          },
        );
  const observedOrderMatches =
    observedPairs === undefined
      ? 0
      : Number(
          (observedQuery === null) === (exchange.query === null) &&
            observedPairs.length === recordedPairs.length &&
            observedPairs.every(
              ([name, value], index) =>
                recordedPairs[index]?.[0] === name &&
                recordedPairs[index]?.[1] === value,
            ),
        );
  return {
    pathMatches,
    verbatimMatches,
    queryMatches,
    observedOrderMatches,
    exact:
      pathMatches === pathProvided &&
      queryMatches === queryProvided &&
      (observedPairs === undefined || observedOrderMatches === 1),
  };
};

const outranks = (score: MatchScore, best: MatchScore): boolean =>
  score.pathMatches !== best.pathMatches
    ? score.pathMatches > best.pathMatches
    : score.verbatimMatches !== best.verbatimMatches
      ? score.verbatimMatches > best.verbatimMatches
      : score.queryMatches !== best.queryMatches
        ? score.queryMatches > best.queryMatches
        : score.observedOrderMatches > best.observedOrderMatches;

/** Choose the record whose path segments, then verbatim spellings, then query values best match the call; ties keep manifest order. */
export const selectReplayExchange = (
  tool: EnvironmentManifestTool,
  exchanges: ReadonlyMap<number, RecordedExchange>,
  args: ReplayArguments,
  observedQuery?: ObservedQuery,
):
  | { readonly exchange: RecordedExchange; readonly exact: boolean }
  | undefined => {
  let best: { exchange: RecordedExchange; score: MatchScore } | undefined;
  const argumentsMap = environmentToolArguments(tool);
  for (const ordinal of tool.record_ordinals) {
    const exchange = exchanges.get(ordinal);
    if (exchange === undefined) continue;
    const score = scoreExchange(
      tool,
      argumentsMap.path,
      argumentsMap.query,
      exchange,
      args,
      observedQuery,
    );
    if (best === undefined || outranks(score, best.score))
      best = { exchange, score };
  }
  if (best === undefined) return undefined;
  const suppliedQueryNames = new Set(
    [...argumentsMap.query].flatMap(([name, argument]) =>
      ownMember(args, argument) === undefined ? [] : [name],
    ),
  );
  const queryWasSupplied = suppliedQueryNames.size > 0;
  const canInspectQuery = observedQuery !== undefined || queryWasSupplied;
  const bestPairs = canInspectQuery
    ? [
        ...iterateUrlQueryParameters(
          best.exchange.query ?? "",
          suppliedQueryNames,
        ),
      ]
    : [];
  const orderAmbiguous =
    observedQuery === undefined &&
    queryWasSupplied &&
    best.score.exact &&
    tool.record_ordinals.some((ordinal) => {
      const candidate = exchanges.get(ordinal);
      if (
        candidate === undefined ||
        candidate.ordinal === best.exchange.ordinal
      )
        return false;
      const score = scoreExchange(
        tool,
        argumentsMap.path,
        argumentsMap.query,
        candidate,
        args,
      );
      if (
        score.pathMatches !== best.score.pathMatches ||
        score.verbatimMatches !== best.score.verbatimMatches ||
        !score.exact
      )
        return false;
      const pairs = [
        ...iterateUrlQueryParameters(candidate.query ?? "", suppliedQueryNames),
      ];
      return (
        pairs.length !== bestPairs.length ||
        pairs.some(
          ([name, value], index) =>
            bestPairs[index]?.[0] !== name || bestPairs[index]?.[1] !== value,
        )
      );
    });
  return {
    exchange: best.exchange,
    exact: best.score.exact && !orderAmbiguous,
  };
};

/** Whether the arguments name one recorded request line exactly: every path value supplied and matching, every supplied query value matching, and every recorded query parameter supplied with its recorded value. */
export const selectsRecordedLine = (
  tool: EnvironmentManifestTool,
  exchange: RecordedExchange,
  args: ReplayArguments,
  observedQuery?: ObservedQuery,
): boolean => {
  const argumentsMap = environmentToolArguments(tool);
  if (
    !tool.params.every(
      (param) =>
        typeof ownMember(
          args,
          argumentsMap.path.get(param.name) ?? param.name,
        ) === "string",
    ) ||
    !scoreExchange(
      tool,
      argumentsMap.path,
      argumentsMap.query,
      exchange,
      args,
      observedQuery,
    ).exact
  )
    return false;
  const recorded = new Map<string, string[]>();
  for (const [name, value] of iterateUrlQueryParameters(exchange.query ?? "")) {
    const values = recorded.get(name) ?? [];
    values.push(value);
    recorded.set(name, values);
  }
  for (const [name, values] of recorded) {
    const argument = argumentsMap.query.get(name);
    const supplied = ownMember(args, argument ?? "");
    if (
      argument === undefined ||
      (typeof supplied === "string"
        ? values.length !== 1 || values[0] !== supplied
        : !Array.isArray(supplied) ||
          supplied.length !== values.length ||
          !supplied.every((value, index) => value === values[index]))
    )
      return false;
  }
  return true;
};

/** The longest prefix of text whose UTF-8 encoding fits the byte limit, encoding only that prefix. */
const utf8Prefix = (text: string, maxBytes: number): string => {
  // encodeInto stops before the first character that does not fit, so `read` ends on a boundary.
  const { read } = new TextEncoder().encodeInto(text, new Uint8Array(maxBytes));
  return text.slice(0, read);
};

/** Base64 characters, in whole groups, whose bytes fit the replay limit. */
const BASE64_LIMIT_CHARS = Math.floor(REPLAY_BODY_LIMIT_BYTES / 3) * 4;

interface ReplayBody {
  readonly body: JsonValue;
  readonly truncated: boolean;
}

/** The reply body and whether it was cut, as the source classifies the retained body. */
const replayBody = (exchange: RecordedExchange): ReplayBody => {
  const body = replayedBody(exchange);
  switch (body.kind) {
    case "none":
      return { body: null, truncated: false };
    case "base64":
      return body.whole
        ? { body: body.encoded, truncated: false }
        : { body: body.encoded.slice(0, BASE64_LIMIT_CHARS), truncated: true };
    case "cut":
      return {
        body: utf8Prefix(body.text, REPLAY_BODY_LIMIT_BYTES),
        truncated: true,
      };
    case "json":
      return { body: body.value, truncated: false };
    case "text":
      return { body: body.text, truncated: false };
  }
};

/** Recorded paths and queries are cut to this many UTF-8 bytes in replies. */
export const REPLAY_METADATA_LIMIT_BYTES = 1024;

/** Replay one tool call from the retained record that best matches its arguments. */
export const replayEnvironmentTool = (
  source: EnvironmentSource,
  tool: EnvironmentManifestTool,
  args: ReplayArguments,
  observedQuery?: ObservedQuery,
): Result<ReplayResult, AnalysisError> => {
  const selected = selectReplayExchange(
    tool,
    source.exchanges,
    args,
    observedQuery,
  );
  if (selected === undefined)
    return err(
      new AnalysisInputError(
        ENVIRONMENT_SERVE_OPERATION,
        {
          userMessage: `Tool ${tool.name} cites no retained record to replay.`,
        },
        [{ path: ["tool"], reason: "invalid_value", expected: tool.name }],
      ),
    );
  return ok(replayAnswer(source, selected.exchange, selected.exact));
};

/** A tool answer with one recorded exchange's status, content type and provenance; the body defaults to the recorded one. */
export const replayAnswer = (
  source: EnvironmentSource,
  exchange: RecordedExchange,
  exact: boolean,
  { body, truncated }: ReplayBody = replayBody(exchange),
): ReplayResult => {
  const recordedPath = utf8Prefix(exchange.path, REPLAY_METADATA_LIMIT_BYTES);
  const recordedQuery =
    exchange.query === null
      ? null
      : utf8Prefix(exchange.query, REPLAY_METADATA_LIMIT_BYTES);
  const contentType =
    exchange.contentType === null
      ? null
      : utf8Prefix(exchange.contentType, REPLAY_METADATA_LIMIT_BYTES);
  return {
    status: exchange.status,
    content_type: contentType,
    body,
    replay: {
      record_ordinal: exchange.ordinal,
      evidence_id: source.evidenceId,
      exact_match: exact,
      recorded_path: recordedPath,
      recorded_query: recordedQuery,
      recorded_line_truncated:
        recordedPath.length < exchange.path.length ||
        (recordedQuery?.length ?? 0) < (exchange.query?.length ?? 0),
      content_type_truncated: contentType !== exchange.contentType,
      body_recorded: exchange.bodyText !== null,
      body_encoding: exchange.bodyEncoding ?? "utf-8",
      truncated,
    },
  };
};
