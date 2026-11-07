import {
  ownMember,
  allLines,
  collectionPathOf,
  collectionMatch,
  segmentsOf,
  type SuppliedSegment,
  type StateListView,
} from "../../domain/analysisView/environmentStateRules.js";
import { pagesOnly } from "../../domain/analysisView/environmentStatePaging.js";
import {
  selectReplayExchange,
  selectsRecordedLine,
  type ObservedQuery,
  type ReplayArguments,
} from "./environmentReplay.js";
import type {
  EnvironmentManifestTool,
  EnvironmentSource,
  RecordedExchange,
} from "./environmentSource.js";
import { environmentToolArguments } from "./environmentTools.js";

/** A call's path segments: template literals and supplied values, or undefined when a path argument is missing. */
export const callSegments = (
  tool: EnvironmentManifestTool,
  args: ReplayArguments,
): SuppliedSegment[] | undefined => {
  const names = environmentToolArguments(tool).path;
  const params = new Map(tool.params.map((param) => [param.index, param]));
  const segments: SuppliedSegment[] = [];
  // Use the collection's path parser so repeated separators remain meaningful.
  for (const [index, text] of segmentsOf(tool.path_template).entries()) {
    const param = params.get(index);
    if (param === undefined) {
      segments.push({ text, supplied: false });
      continue;
    }
    const value = ownMember(args, names.get(param.name) ?? param.name);
    if (typeof value !== "string") return undefined;
    segments.push({ text: value, supplied: true });
  }
  return segments;
};

/** The checked recorded line a list or document call names exactly, chosen among them as replay chooses; later or filtered recordings never qualify. */
export const checkedLine = (
  source: EnvironmentSource,
  tool: EnvironmentManifestTool,
  checked: readonly number[],
  args: ReplayArguments,
  observedQuery?: ObservedQuery,
): RecordedExchange | undefined => {
  const lines = new Map<number, RecordedExchange>();
  for (const ordinal of checked) {
    const exchange = source.exchanges.get(ordinal);
    if (
      exchange !== undefined &&
      selectsRecordedLine(tool, exchange, args, observedQuery)
    )
      lines.set(ordinal, exchange);
  }
  return selectReplayExchange(tool, lines, args, observedQuery)?.exchange;
};

/** For a list of a whole collection, a call that supplies no query argument answers from a checked line of the collection its path arguments name that only pages it, chosen as replay chooses; a requested page answers from its recording. */
export const unfilteredLine = (
  source: EnvironmentSource,
  tool: EnvironmentManifestTool,
  checked: readonly number[],
  args: ReplayArguments,
  observedQuery?: ObservedQuery,
): RecordedExchange | undefined => {
  const query = environmentToolArguments(tool).query;
  const segments = callSegments(tool, args);
  if (
    segments === undefined ||
    [...query.values()].some(
      (argument) => ownMember(args, argument) !== undefined,
    )
  )
    return undefined;
  const lines = new Map<number, RecordedExchange>();
  for (const ordinal of checked) {
    const exchange = source.exchanges.get(ordinal);
    if (
      exchange !== undefined &&
      pagesOnly(exchange.query ?? undefined) &&
      collectionMatch(collectionPathOf(exchange, false), segments) !== undefined
    )
      lines.set(ordinal, exchange);
  }
  return selectReplayExchange(tool, lines, args, observedQuery)?.exchange;
};

/** A call's query arguments by parameter name. */
export const callQuery = (
  tool: EnvironmentManifestTool,
  args: ReplayArguments,
): Map<string, string> =>
  new Map(
    [...environmentToolArguments(tool).query].flatMap(
      ([name, argument]): [string, string][] => {
        const value = ownMember(args, argument);
        return value === undefined ? [] : [[name, String(value)]];
      },
    ),
  );

/** For a list with a query, a call whose every query argument has a role answers on a query or whole line of the collection its path arguments name. */
export const queryLine = (
  source: EnvironmentSource,
  tool: EnvironmentManifestTool,
  view: StateListView,
  args: ReplayArguments,
  observedQuery?: ObservedQuery,
): RecordedExchange | undefined => {
  const query = view.query;
  const segments = callSegments(tool, args);
  if (
    query === undefined ||
    segments === undefined ||
    [...callQuery(tool, args).keys()].some(
      (name) => !Object.hasOwn(query.parameters, name),
    )
  )
    return undefined;
  const lines = new Map<number, RecordedExchange>();
  for (const ordinal of [...query.record_ordinals, ...allLines(view)]) {
    const exchange = source.exchanges.get(ordinal);
    if (
      exchange !== undefined &&
      collectionMatch(collectionPathOf(exchange, false), segments) !== undefined
    )
      lines.set(ordinal, exchange);
  }
  return selectReplayExchange(tool, lines, args, observedQuery)?.exchange;
};
