import type { Filter } from "incur";

import { err, ok, type Result } from "../domain/result.js";

import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { jsonParts } from "../domain/jsonSerialization.js";

/** Reserved control-record marker, not an advertised external JSON Schema. */
export const JSON_LINES_PROTOCOL = "jsonl/v1";

interface JsonLinesErrorRecord {
  readonly $rea: typeof JSON_LINES_PROTOCOL;
  readonly type: "error";
  readonly ok: false;
  readonly result: unknown;
}

interface JsonLinesMetadataRecord {
  readonly $rea: typeof JSON_LINES_PROTOCOL;
  readonly type: "metadata";
  readonly records: {
    readonly path: readonly string[];
    readonly emitted: number;
    readonly source: number | null;
    readonly filter?: string;
  };
  readonly context: Readonly<Record<string, unknown>> | null;
}

const COLLECTION_KEYS = ["rows", "items", "records", "occurrences"] as const;

const RECORD_BOUNDARIES =
  "JSON Lines needs a top-level array, or exactly one rows, items, records, or occurrences array directly in the result, under page, or under normalized_result.";

/** Objects whose collection fields JSON Lines admits, relative to the result. */
const RECORD_BOUNDARY_PATHS = [
  [],
  ["page"],
  ["normalized_result"],
  ["normalized_result", "page"],
] as const;

/** Recovery for every JSON Lines selection refusal; the analysis result itself is valid. */
export const JSON_LINES_SELECTION_REMEDIATION =
  "Use --format json for the complete document, or select one record collection with --filter-output.";

interface Collection {
  readonly records: readonly unknown[];
  readonly path: readonly string[];
}

/** Parsed once, before output or token counting acquires the stream. */
export interface JsonLinesPlan extends Collection {
  readonly context: Readonly<Record<string, unknown>> | undefined;
  readonly sourceRecords: number | null;
  readonly filter: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const atPath = (value: unknown, path: readonly string[]): unknown => {
  for (const key of path) {
    if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
};

interface BoundaryExamination {
  readonly found: readonly Collection[];
  /** Collection fields that exist but are not arrays. */
  readonly rejected: readonly Observation[];
}

/** Examine exactly the documented record boundaries, once, for admission and refusal. */
const examineBoundaries = (
  value: unknown,
  fullOutput: boolean,
): BoundaryExamination => {
  const prefix = fullOutput ? ["data"] : [];
  const data = atPath(value, prefix);
  const found: Collection[] = [];
  const rejected: Observation[] = [];
  for (const boundary of RECORD_BOUNDARY_PATHS) {
    const object = atPath(data, boundary);
    const path = [...prefix, ...boundary];
    // A result or normalized_result may itself be the array; a page is a container.
    if (Array.isArray(object) && boundary.at(-1) !== "page")
      found.push({ records: object, path });
    if (!isRecord(object)) continue;
    for (const key of COLLECTION_KEYS) {
      if (!Object.hasOwn(object, key)) continue;
      const records = object[key];
      if (Array.isArray(records)) found.push({ records, path: [...path, key] });
      else rejected.push(observe([...path, key], records));
    }
  }
  return { found, rejected };
};

type Shape =
  | "absent"
  | "null"
  | "array"
  | "object"
  | "string"
  | "number"
  | "boolean";

/** One examined value that JSON Lines refused, at its emitted-document path. */
interface Observation {
  readonly path: readonly (string | number)[];
  readonly shape: Shape;
}

const shapeOf = (value: unknown): Shape => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "object":
      return "object";
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "number":
    case "bigint":
      return "number";
    default:
      // JSON omits undefined, functions and symbols.
      return "absent";
  }
};

const observe = (
  path: readonly (string | number)[],
  value: unknown,
): Observation => ({ path, shape: shapeOf(value) });

const describe = ({ path, shape }: Observation): string =>
  `${path.length === 0 ? "the result" : path.join(".")} is ${
    shape === "absent" || shape === "null"
      ? shape
      : shape === "array" || shape === "object"
        ? `an ${shape}`
        : `a ${shape}`
  }`;

/** Caller-visible key paths, before any slice, selected by --filter-output. */
const selectionPaths = (
  paths: ReturnType<typeof Filter.parse> | undefined,
): string[][] => {
  const selected = new Map<string, string[]>();
  for (const path of paths ?? []) {
    const keys: string[] = [];
    for (const segment of path) {
      if (!("key" in segment)) break;
      keys.push(segment.key);
    }
    selected.set(JSON.stringify(keys), keys);
  }
  return [...selected.values()];
};

/** Shallow copies only ancestors of the emitted array; every other fact survives. */
const withoutRecords = (
  source: unknown,
  selected: unknown,
  path: readonly string[],
  filtered: boolean,
): Record<string, unknown> | undefined => {
  if (path.length === 0 || !isRecord(source)) return undefined;
  const context = { ...source };
  const selectedObject = isRecord(selected) ? selected : undefined;
  // A data filter intentionally excludes raw observation payloads. Keep its
  // selected raw value if requested, while always retaining Evidence provenance.
  if (
    filtered &&
    Object.hasOwn(source, "evidence_id") &&
    typeof source.evidence_id === "string" &&
    Object.hasOwn(source, "normalized_result")
  ) {
    if (selectedObject && Object.hasOwn(selectedObject, "raw_result"))
      context.raw_result = selectedObject.raw_result;
    else delete context.raw_result;
  }
  const [key, ...rest] = path;
  if (key === undefined) return context;
  if (rest.length === 0) delete context[key];
  else
    context[key] = withoutRecords(
      source[key],
      selectedObject?.[key],
      rest,
      filtered,
    );
  return context;
};

interface JsonLinesOptions {
  readonly command: string;
  readonly source?: unknown;
  readonly filter?: string;
  /** Parsed --filter-output paths, used only to name the refused selection. */
  readonly filterPaths?: ReturnType<typeof Filter.parse>;
  readonly fullOutput?: boolean;
}

/**
 * Choose the one clear collection, or refuse the caller's selection. The
 * structured `observed` facts are the contract; the message derives from them.
 */
const selectCollection = (
  selected: unknown,
  source: unknown,
  options: JsonLinesOptions,
  { found, rejected }: BoundaryExamination,
): Result<Collection, AnalysisInputError> => {
  const prefix = options.fullOutput === true ? ["data"] : [];
  const filtered = options.filter !== undefined;
  const selections = selectionPaths(options.filterPaths).filter(
    (path) => path.length > 0,
  );
  const subject =
    filtered && selections.length > 0
      ? `The --filter-output selection ${selections.map((path) => path.join(".")).join(", ")}`
      : "The command result";
  const refuse = (
    statement: string,
    observed: readonly Observation[],
    rule: string,
  ) => {
    const observation = `${subject} ${statement}: ${observed.map(describe).join("; ")}.`;
    return err(
      new AnalysisInputError(
        options.command,
        {
          userMessage: `${observation} ${rule}`,
          remediationAction: JSON_LINES_SELECTION_REMEDIATION,
        },
        [
          {
            path: [filtered ? "filter-output" : "format"],
            reason: "invalid_value",
            message: observation,
            observed: observed.map(({ path, shape }) => ({
              path: [...path],
              shape,
            })),
          },
        ],
      ),
    );
  };
  if (found.length > 1)
    return refuse(
      "is not one JSON Lines record collection",
      found.map(({ path }) => observe(path, [])),
      "Select one with --filter-output.",
    );
  const [collection] = found;
  if (collection === undefined) {
    const [selection] = selections;
    // A non-array collection field is the most specific fact. Otherwise one
    // named selection is described by its source value, since a filter that
    // matches nothing leaves no selected value to describe.
    const observed =
      rejected.length > 0
        ? rejected
        : [
            selections.length === 1 && selection !== undefined
              ? observe(
                  [...prefix, ...selection],
                  atPath(atPath(source, prefix), selection),
                )
              : observe(prefix, atPath(selected, prefix)),
          ];
    return refuse(
      "is not a JSON Lines record collection",
      observed,
      RECORD_BOUNDARIES,
    );
  }
  for (const [index, record] of collection.records.entries()) {
    if (isRecord(record) && Object.hasOwn(record, "$rea"))
      return refuse(
        "uses the field JSON Lines reserves for control records",
        [observe([...collection.path, index, "$rea"], record.$rea)],
        "Nested $rea values are ordinary data.",
      );
  }
  return ok(collection);
};

/**
 * Project a clear collection without interpreting or whitelisting its context.
 * A refusal is the caller's output selection, not a failed analysis: the same
 * result remains available through --format json.
 */
export const prepareJsonLines = (
  selected: unknown,
  options: JsonLinesOptions,
): Result<JsonLinesPlan, AnalysisInputError> => {
  const fullOutput = options.fullOutput === true;
  const examination = examineBoundaries(selected, fullOutput);
  const source = Object.hasOwn(options, "source") ? options.source : selected;
  const chosen = selectCollection(selected, source, options, examination);
  if (!chosen.ok) return chosen;
  const collection = chosen.value;
  const originalRecords = atPath(source, collection.path);
  const sourceMatches = Array.isArray(originalRecords);
  let context = withoutRecords(
    sourceMatches ? source : selected,
    selected,
    collection.path,
    options.filter !== undefined,
  );
  if (options.filter !== undefined && sourceMatches) {
    // Excluded peer rows are data, not context. A filter can disambiguate them
    // without restoring an unselected collection into the final record.
    for (const peer of examineBoundaries(source, fullOutput).found) {
      if (peer.path.join(".") !== collection.path.join("."))
        context = withoutRecords(context, selected, peer.path, true);
    }
  }
  return ok({
    ...collection,
    context,
    sourceRecords: sourceMatches ? originalRecords.length : null,
    filter: options.filter,
  });
};

/** The caller supplies the outcome; error-shaped data is never reclassified here. */
export const jsonLinesErrorRecord = (
  result: unknown,
): JsonLinesErrorRecord => ({
  $rea: JSON_LINES_PROTOCOL,
  type: "error" as const,
  ok: false as const,
  result,
});

export function* jsonLinesParts(plan: JsonLinesPlan): Generator<string> {
  for (const record of jsonLinesRecords(plan)) {
    yield* jsonLineParts(record);
  }
}

/** One record stays one line even when the record itself is an array. */
export function* jsonLineParts(record: unknown): Generator<string> {
  yield* jsonParts(record);
  yield "\n";
}

/** Newline-separated records also bound the token estimator's working set. */
export function* jsonLinesRecords(plan: JsonLinesPlan): Generator<unknown> {
  yield* plan.records;
  if (plan.context !== undefined || plan.path.length > 0) {
    const metadata: JsonLinesMetadataRecord = {
      $rea: JSON_LINES_PROTOCOL,
      type: "metadata",
      records: {
        path: plan.path,
        emitted: plan.records.length,
        source: plan.sourceRecords,
        ...(plan.filter === undefined ? {} : { filter: plan.filter }),
      },
      context: plan.context ?? null,
    };
    yield metadata;
  }
}
