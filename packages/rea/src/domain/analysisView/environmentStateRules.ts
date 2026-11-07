import {
  iterateUrlQueryParameters,
  parseUrlQueryParameterNames,
} from "../recordedTransportUrl.js";
import type { OffsetDateTimeInstant } from "../offsetDateTime.js";
import type { StateRecordChronology } from "./StateRecordChronology.js";
import type { ListQuery } from "./environmentStateListQuery.js";
import { canonicalJson } from "../comparisonSemantics.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { JsonValue } from "../jsonValue.js";
import type { StateWritePlan } from "./environmentStateWriteRules.js";
import {
  respellClock,
  type ClockFormat,
} from "./environmentStateWriteValues.js";
import { ENTRY_BYTES, textBytes } from "./webNetworkRouteTemplates.js";
import { counterAt, withCounter } from "./environmentStateCounters.js";

/** How records are ordered: by recorded start time, or by record order when any start time is missing. */
export type StateTimeline = "recorded-start-time" | "record-order";

/** What extraction reads of one primary-origin record; times are timeline coordinates. */
export interface StateRecordFacts {
  readonly ordinal: number;
  readonly method: string;
  readonly path: string;
  /** WHATWG query spelling including `?`, or undefined when the request had none. */
  readonly query: string | undefined;
  readonly status: number | null;
  readonly timing: {
    readonly start:
      | { readonly instant: OffsetDateTimeInstant; readonly ms: number }
      | undefined;
    readonly endMs: number | undefined;
  };
}

/** The manifest tool facts extraction uses. */
export interface StateToolFacts {
  readonly name: string;
  readonly method: string;
  readonly path_template: string;
  readonly record_ordinals: readonly number[];
}

/** A record's response body as JSON, or unusable when absent, cut, not JSON, not exactly representable. */
export type ParsedBody =
  | { readonly kind: "json"; readonly value: JsonValue }
  | { readonly kind: "unusable" };

/** A request distinguishes confirmed absence from content the state cannot interpret. */
export type ParsedRequestBody = ParsedBody | { readonly kind: "absent" };

export const requestJson = (body: ParsedRequestBody): JsonValue | undefined =>
  body.kind === "json" ? body.value : undefined;

/** Budgeted access the accumulator lends extraction; null and false mean the budget is exhausted. */
export interface StateBudget {
  readonly body: (ordinal: number) => ParsedBody | null;
  /** Keep the request's parsing reservation until its consumer finishes. */
  readonly withRequestBody: <T>(
    ordinal: number,
    use: (body: ParsedRequestBody) => T,
  ) => T | null;
  /** Whether a record's response had no body. */
  readonly emptyResponse: (ordinal: number) => boolean;
  readonly retain: (bytes: number) => boolean;
  /** Mark the retained bytes; the returned call releases what was retained since, once none of it is held. */
  readonly checkpoint: () => () => void;
  /** Drop the temporary work of the body just read. */
  readonly release: () => void;
}

export type RecordedViewReason =
  | "query-body"
  | "method-replay"
  | "no-init-recording"
  | "body-unusable"
  | "no-identity"
  | "path-varies"
  | "query-varies"
  | "fields-differ"
  | "envelope-varies"
  | "list-differs"
  | "rendered-oversize";

/**
 * Recorded response text, and a document value rendered back to JSON, stay within this many UTF-8
 * bytes. A larger recorded body is not parsed; a parsed value whose JSON rendering exceeds it stays
 * a recorded replay (`rendered-oversize`) rather than a document the server would have to refuse.
 */
export const STATE_BODY_LIMIT_BYTES = 256 * 1024;

export interface StateType {
  readonly collection_template: string;
  readonly id_field: string;
  readonly id_basis: "path-parameter" | "field-name";
  readonly init_before_ordinal: number | null;
  readonly volatile_fields: string[];
}

export type JsonObject = Record<string, JsonValue>;

export interface StateEntity {
  readonly type: string;
  readonly collection: string;
  readonly id: string;
  readonly fields: JsonObject;
  readonly view_fields: {
    readonly tool: string;
    readonly fields: JsonObject;
  }[];
  readonly record_ordinals: number[];
}

export interface StateDocument {
  readonly tool: string;
  readonly path: string;
  readonly value: JsonValue;
  readonly record_ordinal: number;
}

interface EntityViewPlan {
  readonly tool: string;
  readonly type: string;
  readonly pointer: string;
  readonly fields: string[];
  readonly required_fields: string[];
  readonly checked_record_ordinals: number[];
  /** How the view spells the clock fields it always spells otherwise than the entities' stored values. */
  readonly clock_formats?: Readonly<Record<string, ClockFormat>> | undefined;
  /** Fields whose string arrays the view lists in code-point order, whatever order they were written in. */
  readonly sorted_arrays?: string[] | undefined;
  /** The keys the view shows of object fields it shows with fewer keys than stored. */
  readonly nested_fields?: Readonly<Record<string, string[]>> | undefined;
  /** Envelope members each response there mints, which checks leave out and serving keeps as recorded. */
  readonly per_response_members?: string[] | undefined;
}

/** A query key that picks out replayed reads: a parameter, a parameter with one value, or a parameter left out. */
export interface ReplayKey {
  readonly name: string;
  readonly value?: string | undefined;
  readonly absent?: true | undefined;
}

/** Recorded reads a view leaves to replay, and the query keys that pick calls of them out. */
interface ReplayedReads {
  /** Reads that asked for some fields only, or show entities in another representation than the checked lines. */
  readonly projected_record_ordinals?: number[] | undefined;
  /** A call whose query matches one of these replays, a field selection by its values; absent on views that only left out projections. */
  readonly projected_query_keys?: ReplayKey[] | undefined;
}

export type StateItemView = EntityViewPlan &
  ReplayedReads & {
    readonly shape: "item";
    readonly envelope_ordinal: number;
    /** The member its reads set `true` on an entity the application soft-deleted and still answers by id. */
    readonly deleted_flag?: (typeof DELETED_FLAGS)[number] | undefined;
  };

/** A query parameter that asks for some fields only (`fields`, `fields[...]`, `select`, `$select`). */
export const isProjectionParameter = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower === "fields" ||
    lower.startsWith("fields[") ||
    lower === "select" ||
    lower === "$select"
  );
};

/** Whether a recorded query string names a projection parameter. */
export const projectsFields = (query: string | undefined): boolean => {
  for (const name of parseUrlQueryParameterNames(query ?? ""))
    if (isProjectionParameter(name)) return true;
  return false;
};

/** Whether a recorded query asks for some fields only: a projection parameter with a value other than `*`, which asks for all. */
export const selectsSomeFields = (query: string | undefined): boolean => {
  for (const [name, value] of iterateUrlQueryParameters(query ?? ""))
    if (isProjectionParameter(name) && value !== "*") return true;
  return false;
};

export type StateListView = EntityViewPlan &
  ReplayedReads & {
    readonly shape: "list";
    readonly membership: "all" | "recorded";
    /** With recorded membership, the checked lines that each list their whole collection. */
    readonly all_record_ordinals?: number[] | undefined;
    readonly counters: string[];
    /** Top-level envelope members that hold the listed entities' values of an identity field, in list order. */
    readonly listed_ids?: ListedIds[] | undefined;
    /** The query the view's other lines follow, when one explains any of them. */
    readonly query?: ListQuery | undefined;
  };

/** Members an application sets `true` on an entity it has soft-deleted but still answers for by id. */
export const DELETED_FLAGS = ["deleted", "isDeleted", "is_deleted"] as const;

/** The member an item read's object sets `true` to mark the entity soft-deleted, if it does. */
export const deletedFlag = (
  object: JsonValue | undefined,
): (typeof DELETED_FLAGS)[number] | undefined =>
  isObject(object)
    ? DELETED_FLAGS.find((name) => ownMember(object, name) === true)
    : undefined;

/** Whether an item read's object is one the application has soft-deleted, which says the entity is gone. */
export const markedDeleted = (object: JsonValue | undefined): boolean =>
  deletedFlag(object) !== undefined;

/** An envelope member listing an identity field of each listed entity, as Paperless's `all` lists ids. */
export interface ListedIds {
  readonly member: string;
  readonly field: string;
}

/** Whether a value lists the items' values of a field, in their order. */
export const listsIds = (
  value: JsonValue | undefined,
  items: readonly JsonObject[],
  field: string,
): boolean =>
  Array.isArray(value) &&
  value.length === items.length &&
  items.every((item, index) => {
    const id = ownMember(item, field);
    return id !== undefined && same(value[index], id);
  });

/** Whether a list view answers on a checked line with every entity of the collection. */
export const listsAll = (view: StateListView, ordinal: number): boolean =>
  view.membership === "all" ||
  (view.all_record_ordinals?.includes(ordinal) ?? false);

/** The checked lines a list view answers with every entity of the collection. */
export const allLines = (view: StateListView): readonly number[] =>
  view.membership === "all"
    ? view.checked_record_ordinals
    : (view.all_record_ordinals ?? []);

export type StateView =
  | StateItemView
  | StateListView
  | {
      readonly tool: string;
      readonly shape: "document";
      readonly checked_record_ordinals: number[];
      readonly per_response_members?: string[] | undefined;
    }
  | {
      readonly tool: string;
      readonly shape: "recorded";
      readonly reason: RecordedViewReason;
    };

export interface ExtractedState {
  readonly types: StateType[];
  readonly entities: StateEntity[];
  readonly documents: StateDocument[];
  readonly views: StateView[];
  readonly writes: StateWritePlan[];
  /** The instant a served clock starts from: the end of the capture's last timed record, or null without times. */
  readonly write_clock: string | null;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** HTTP safe methods share read-only classification across state and MCP views. */
export const isSafeHttpMethod = (method: string): boolean =>
  method === "GET" ||
  method === "HEAD" ||
  method === "OPTIONS" ||
  method === "TRACE";
/** A POST whose path names one of these segments queries state rather than changing it. */
export const QUERY_SEGMENTS = new Set([
  "search",
  "query",
  "list",
  "find",
  "fuzzy",
  "lookup",
  "count",
  "aggregate",
  "stats",
  "_search",
  "_count",
  "_msearch",
]);
/** Identity field names tried, in order, when no path parameter proves one. */
export const IDENTITY_NAMES = [
  "id",
  "uid",
  "uuid",
  "_id",
  "ID",
  "UID",
  "Id",
  "guid",
  "key",
  "slug",
  "name",
];
const VERSION_SEGMENT = /^v\d+(?:\.\d+)*$/u;

export const segmentsOf = (path: string): string[] => {
  const segments = path.split("/");
  if (segments[0] === "") segments.shift();
  if (segments.at(-1) === "") segments.pop();
  return segments;
};
export const isParam = (segment: string): boolean =>
  segment.startsWith("{") && segment.endsWith("}");
export const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const scalarText = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : undefined;
/** A JSON dictionary lookup observes only its own members, preserving absent fields. */
export const ownMember = <Value>(
  object: Readonly<Record<string, Value>> | undefined,
  member: string,
): Value | undefined =>
  object !== undefined && Object.hasOwn(object, member)
    ? object[member]
    : undefined;

/** Write one JSON member without interpreting its name as an inherited setter. */
export const setOwnMember = (
  object: JsonObject,
  member: string,
  value: JsonValue,
): void => {
  Object.defineProperty(object, member, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
};

/** Equal JSON values; object member order carries no meaning. */
export const same = (
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): boolean =>
  left === undefined || right === undefined
    ? left === right
    : canonicalJson(left, "Environment state") ===
      canonicalJson(right, "Environment state");

/** A path segment percent-decoded, or as written when it does not decode. */
export const decodedSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * Whether two path spellings name one segment: they are equal, or either decodes once to the other.
 * Decoding both would make `book%2531` match `book1`.
 */
export const pathSegmentMatches = (segment: string, value: string): boolean =>
  segment === value ||
  decodedSegment(segment) === value ||
  decodedSegment(value) === segment;

/** One segment of a call: a template literal, or a supplied path value. */
export interface SuppliedSegment {
  readonly text: string;
  readonly supplied: boolean;
}

/** How many supplied segments a held collection matches verbatim, when it matches the call under the path rule. */
export const collectionMatch = (
  collection: string,
  segments: readonly SuppliedSegment[],
): number | undefined => {
  const held = segmentsOf(collection);
  if (held.length !== segments.length) return undefined;
  let verbatim = 0;
  for (const [index, { text, supplied }] of segments.entries()) {
    const segment = held[index]!;
    if (supplied ? !pathSegmentMatches(segment, text) : segment !== text)
      return undefined;
    if (supplied && segment === text) verbatim += 1;
  }
  return verbatim;
};

/** The collection a create writes: the candidate with the most verbatim supplied segments, the earliest on a tie, else the call with each supplied segment encoded. */
export const selectedCollection = (
  segments: readonly SuppliedSegment[],
  candidates: readonly string[],
): string => {
  let chosen: string | undefined;
  let verbatim = -1;
  for (const collection of candidates) {
    const matched = collectionMatch(collection, segments);
    if (matched !== undefined && matched > verbatim) {
      chosen = collection;
      verbatim = matched;
    }
  }
  return (
    chosen ??
    `/${segments
      .map(({ text, supplied }) => (supplied ? encodeURIComponent(text) : text))
      .join("/")}`
  );
};

/** The decoded final path segment, which an item request names its entity by. */
export const lastSegmentValue = (path: string): string =>
  decodedSegment(segmentsOf(path).at(-1) ?? "");

/** A path's segments, preserving repeated separators; one trailing slash names the same collection. */
export const normalizedPath = (path: string): string =>
  `/${segmentsOf(path).join("/")}`;

/** An item record's collection is its path without the identity segment; a list record's is its path. */
export const collectionPathOf = (
  record: Pick<StateRecordFacts, "path">,
  item: boolean,
): string =>
  item
    ? `/${segmentsOf(record.path).slice(0, -1).join("/")}`
    : normalizedPath(record.path);

/** A POST whose path names a query segment observes state rather than changing it. */
export const isQueryPost = (method: string, path: string): boolean =>
  method === "POST" &&
  segmentsOf(path).some((segment) => QUERY_SEGMENTS.has(segment.toLowerCase()));

/** Whether a request with this method and path may change state: a write method that is not a query POST. */
export const changesState = (method: string, path: string): boolean =>
  WRITE_METHODS.has(method) && !isQueryPost(method, path);

/** Whether a record may change state: a successful or unanswered request that `changesState` names. */
export const isStateWrite = (record: StateRecordFacts): boolean =>
  changesState(record.method, record.path) &&
  (record.status === null || (record.status >= 200 && record.status < 400));

/** Index possible write interference without inventing completion for unknown intervals. */
export const writeSpanIndex = (
  writes: readonly StateRecordFacts[],
  chronology: StateRecordChronology,
): ((
  earlier: StateRecordFacts,
  later: StateRecordFacts,
) => number | undefined) => {
  const reach: (number | undefined)[] = [];
  const starts: (number | undefined)[] = [];
  let maximum: number | undefined;
  let unknown = false;
  for (const write of writes) {
    const end = chronology.endMs(write);
    if (end === undefined) unknown = true;
    else maximum = maximum === undefined ? end : Math.max(maximum, end);
    reach.push(unknown ? undefined : maximum);
    starts.push(chronology.startMs(write));
  }
  return (earlier, later) => {
    const beginning = chronology.startMs(earlier);
    const ending = chronology.endMs(later);
    let low = 0;
    let high = writes.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const end = reach[middle];
      if (beginning === undefined || end === undefined || end > beginning)
        high = middle;
      else low = middle + 1;
    }
    const start = starts[low];
    return low < writes.length &&
      (ending === undefined || start === undefined || start < ending)
      ? low
      : undefined;
  };
};

/** Whether a write may overlap the span; unknown completion cannot prove absence. */
export const writeSpanCheck = (
  writes: readonly StateRecordFacts[],
  chronology: StateRecordChronology,
): ((earlier: StateRecordFacts, later: StateRecordFacts) => boolean) => {
  const index = writeSpanIndex(writes, chronology);
  return (earlier, later) => index(earlier, later) !== undefined;
};

/** Literal leading segments shared by every template with the same first segment: each path's API base. */
export const apiBaseLengths = (
  templates: readonly string[],
): ReadonlyMap<string, number> => {
  const groups = new Map<string, string[][]>();
  for (const template of templates) {
    const segments = segmentsOf(template);
    const first = segments[0] ?? "";
    const group = groups.get(first);
    if (group === undefined) groups.set(first, [segments]);
    else group.push(segments);
  }
  return new Map(
    [...groups.entries()].map(([first, members]) => {
      const head = members[0] ?? [];
      let length = 0;
      while (
        length < head.length &&
        !isParam(head[length]!) &&
        members.every((segments) => segments[length] === head[length])
      )
        length += 1;
      return [first, length];
    }),
  );
};

/** The path's API base, then any version segments, then one segment: the scope a write may affect. */
export const rootOf = (
  path: string,
  bases: ReadonlyMap<string, number>,
): string[] => {
  const segments = segmentsOf(path);
  let end = Math.min(bases.get(segments[0] ?? "") ?? 0, segments.length);
  while (end < segments.length && VERSION_SEGMENT.test(segments[end]!))
    end += 1;
  return segments.slice(0, end + 1);
};

/** Value bytes as retained state, charged before a value is kept. */
export const stateValueRetentionBytes = (value: JsonValue): number => {
  if (typeof value === "string") return textBytes(value.length);
  if (Array.isArray(value))
    return value.reduce<number>(
      (sum, item) => sum + stateValueRetentionBytes(item),
      ENTRY_BYTES,
    );
  if (isObject(value))
    return Object.entries(value).reduce<number>(
      (sum, [name, item]) =>
        sum + textBytes(name.length) + stateValueRetentionBytes(item),
      ENTRY_BYTES,
    );
  return ENTRY_BYTES;
};

/** Whether a JSON value nests more than `limit` levels below its root. */
export const deeperThan = (value: JsonValue, limit: number): boolean => {
  const pending: { readonly value: JsonValue; readonly depth: number }[] = [
    { value, depth: 0 },
  ];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.depth > limit) return true;
    const children = Array.isArray(next.value)
      ? next.value
      : isObject(next.value)
        ? Object.values(next.value)
        : [];
    for (const child of children)
      pending.push({ value: child, depth: next.depth + 1 });
  }
  return false;
};

export const pointerTo = (name: string): string =>
  `/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
/** The unescaped reference tokens of a pointer. */
export const pointerTokens = (pointer: string): string[] =>
  pointer === ""
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));

const memberOf = (
  body: JsonValue | undefined,
  name: string,
): JsonValue | undefined =>
  isObject(body) ? ownMember(body, name) : undefined;

/** The element of a one-element array. */
const soleElement = (value: JsonValue | undefined): JsonValue | undefined =>
  Array.isArray(value) && value.length === 1 ? value[0] : undefined;

/** The value at a pointer: the root, one member, or element 0 of a one-element array at the root or in one member. */
export const at = (body: JsonValue, pointer: string): JsonValue | undefined => {
  const [first, second, ...rest] = pointerTokens(pointer);
  if (first === undefined) return body;
  if (second !== undefined)
    return second === "0" && rest.length === 0
      ? soleElement(memberOf(body, first))
      : undefined;
  return Array.isArray(body)
    ? first === "0"
      ? soleElement(body)
      : undefined
    : memberOf(body, first);
};

/** A copy of `body` with the value `at` reads at the pointer replaced; unchanged when it reads none. */
export const replaceAt = (
  body: JsonValue,
  pointer: string,
  value: JsonValue,
): JsonValue => {
  const [first, second] = pointerTokens(pointer);
  if (first === undefined) return value;
  if (at(body, pointer) === undefined) return body;
  if (!isObject(body)) return [value];
  const replaced = second === undefined ? value : [value];
  return Object.fromEntries(
    Object.entries(body).map(([key, item]) => [
      key,
      key === first ? replaced : item,
    ]),
  );
};

const matchingKeys = (object: JsonObject, value: string): string[] =>
  Object.keys(object).filter((key) => scalarText(object[key]) === value);

/** The entity object an item response carries with the keys repeating its path value: at the root or in one wrapper member, else as the element of a one-element array there. */
export const locateItem = (
  body: JsonValue,
  value: string,
): { readonly pointer: string; readonly keys: string[] } | undefined => {
  const located = (
    object: JsonValue | undefined,
    pointer: string,
    named = false,
  ) => {
    const keys = isObject(object)
      ? matchingKeys(object, value).filter(
          (key) => !named || IDENTITY_NAMES.includes(key),
        )
      : [];
    return keys.length > 0 ? [{ pointer, keys }] : [];
  };
  const members = isObject(body) ? Object.entries(body) : [];
  // Objects take precedence; an array element needs an identity name, since a filtered list may
  // answer with one element that repeats its parent's value.
  const tiers = [
    located(body, ""),
    members.flatMap(([name, item]) => located(item, pointerTo(name))),
    located(soleElement(body), "/0", true),
    members.flatMap(([name, item]) =>
      located(soleElement(item), `${pointerTo(name)}/0`, true),
    ),
  ];
  const chosen = tiers.find((tier) => tier.length > 0);
  return chosen?.length === 1 ? chosen[0] : undefined;
};

/** Whether every item carries `name` as a distinct string or number. */
export const identifies = (
  items: readonly JsonObject[],
  name: string,
): boolean => {
  // Stop at the first missing or repeated value, so a sparse list costs one read per field.
  const seen = new Set<string>();
  for (const item of items) {
    const value = scalarText(ownMember(item, name));
    if (value === undefined || seen.has(value)) return false;
    seen.add(value);
  }
  return true;
};

/** Fields ending in one of these may identify listed items that no identity name identifies. */
const IDENTITY_SUFFIX = /(?:Id|_id)$/u;

/** Keys of the first item, in its order, that end like an identity field and identify every item. */
const suffixIdentities = (items: readonly JsonObject[]): string[] =>
  Object.keys(items[0] ?? {}).filter(
    (name) =>
      IDENTITY_SUFFIX.test(name) &&
      !IDENTITY_NAMES.includes(name) &&
      identifies(items, name),
  );

/** Fields that identify every listed item, in precedence order: identity names, then suffix-named fields. */
export const identityCandidates = (items: readonly JsonObject[]): string[] => [
  ...IDENTITY_NAMES.filter((name) => identifies(items, name)),
  ...suffixIdentities(items),
];

/** The array of entity objects a list response carries, at the root or in one property of an envelope that is not itself an entity. */
export const locateList = (
  body: JsonValue,
  idField: string | undefined,
): string | undefined => {
  if (Array.isArray(body)) return body.every(isObject) ? "" : undefined;
  if (
    !isObject(body) ||
    IDENTITY_NAMES.some(
      (name) => scalarText(ownMember(body, name)) !== undefined,
    )
  )
    return undefined;
  const arrays = Object.entries(body).filter(
    (entry): entry is [string, JsonObject[]] =>
      Array.isArray(entry[1]) && entry[1].every(isObject),
  );
  const carrying = (test: (items: JsonObject[]) => boolean) =>
    arrays.filter(([, items]) => items.length > 0 && test(items));
  // Identity names take precedence over suffix-named fields, which need two items to show
  // distinct values; with neither, the one array of objects.
  const tiers =
    idField === undefined
      ? [
          carrying((items) =>
            IDENTITY_NAMES.some((name) => identifies(items, name)),
          ),
          carrying(
            (items) => items.length > 1 && suffixIdentities(items).length > 0,
          ),
          arrays,
        ]
      : [carrying((items) => identifies(items, idField)), arrays];
  const chosen = tiers.find((entries) => entries.length > 0);
  return chosen?.length === 1 ? pointerTo(chosen[0]![0]) : undefined;
};

export const listItems = (
  body: JsonValue,
  pointer: string,
): JsonObject[] | undefined => {
  const items = at(body, pointer);
  return Array.isArray(items) && items.every(isObject) ? items : undefined;
};

/** An observed item count, retaining the original value separately for rendering. */
export const recordedItemCount = (
  value: JsonValue | undefined,
): number | undefined =>
  typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/u.test(value)
      ? Number(value)
      : undefined;

/** Spell a changed count with the recorded numeric/string type and digit width. */
export const formatItemCount = (
  count: number,
  observed: JsonValue,
): JsonValue =>
  typeof observed === "string"
    ? String(count).padStart(observed.length, "0")
    : count;

/** One entity as a view shows it: the view's fields it has, view-specific values first; volatile fields take `observed` values when given. */
export const renderStateEntity = (
  entity: StateEntity,
  view: Pick<
    EntityViewPlan,
    "tool" | "fields" | "clock_formats" | "sorted_arrays" | "nested_fields"
  >,
  volatileFields: ReadonlySet<string>,
  observed?: JsonObject,
): JsonObject => {
  const own =
    entity.view_fields.find((candidate) => candidate.tool === view.tool)
      ?.fields ?? {};
  const formats = view.clock_formats ?? {};
  const nested = view.nested_fields ?? {};
  const sorted = new Set(view.sorted_arrays);
  return Object.fromEntries(
    view.fields.flatMap((name): [string, JsonValue][] => {
      const source =
        observed !== undefined && volatileFields.has(name)
          ? observed
          : Object.hasOwn(own, name)
            ? own
            : entity.fields;
      if (!Object.hasOwn(source, name)) return [];
      // A stored value the view never recorded, such as a written one, takes the view's spelling and keys.
      const value =
        source !== entity.fields
          ? source[name]!
          : Object.hasOwn(formats, name)
            ? respellClock(source[name]!, formats[name]!)
            : Object.hasOwn(nested, name)
              ? shownKeys(source[name]!, nested[name]!)
              : source[name]!;
      return [[name, sorted.has(name) ? inSetOrder(value) : value]];
    }),
  );
};

/** An object with only the keys a view shows of it, in the view's order; any other value as it is. */
const shownKeys = (value: JsonValue, keys: readonly string[]): JsonValue =>
  isObject(value)
    ? Object.fromEntries(
        keys.flatMap((key) =>
          Object.hasOwn(value, key) ? [[key, value[key]!]] : [],
        ),
      )
    : value;

/** Whether a value is an array of strings. */
export const isStringArray = (value: JsonValue): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** A string array in code-point order, as a view that keeps the field as a set lists it; any other value as it is. */
const inSetOrder = (value: JsonValue): JsonValue =>
  isStringArray(value) ? value.toSorted(compareUnicodeCodePoints) : value;

/** The fields every recording of a view carried that the entity, as serving renders it, lacks; serving refuses to answer with such an entity. */
export const missingRequiredFields = (
  entity: StateEntity,
  view: Pick<EntityViewPlan, "tool" | "fields" | "required_fields">,
  volatileFields: ReadonlySet<string>,
): string[] => {
  const shown = renderStateEntity(entity, view, volatileFields);
  return view.required_fields.filter((name) => !Object.hasOwn(shown, name));
};

/**
 * A list response rendered from `base`: its array replaced by `items`, and set to their number each counter that
 * counted the items `base` listed; one that did not, such as a partial page's total, keeps its recorded value. Each
 * member that listed the ids of the items `base` listed lists theirs, unless `items` are a page of more matches.
 */
export const renderStateList = (
  view: Pick<StateListView, "pointer" | "counters" | "listed_ids">,
  base: JsonValue,
  items: readonly JsonObject[],
  whole = true,
): JsonValue => {
  const shown = listItems(base, view.pointer);
  const listed = shown?.length;
  const counted = view.counters.reduce(
    (body, name) => {
      const observed = counterAt(base, name);
      if (listed === undefined || recordedItemCount(observed) !== listed)
        return body;
      return withCounter(body, name, formatItemCount(items.length, observed!));
    },
    replaceAt(base, view.pointer, [...items]),
  );
  if (!whole || shown === undefined || !isObject(counted)) return counted;
  const lists = (view.listed_ids ?? []).filter(
    ({ member, field }) =>
      isObject(base) &&
      listsIds(ownMember(base, member), shown, field) &&
      items.every((item) => ownMember(item, field) !== undefined),
  );
  if (lists.length === 0) return counted;
  const body: JsonObject = { ...counted };
  for (const { member, field } of lists)
    setOwnMember(
      body,
      member,
      items.map((item) => ownMember(item, field)!),
    );
  return body;
};
