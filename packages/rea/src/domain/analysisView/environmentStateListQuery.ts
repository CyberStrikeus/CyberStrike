import type { JsonValue } from "../jsonValue.js";
import { compareUnicodeCodePoints as compare } from "../unicodeCodePointOrder.js";
import { literalSubstringPredicate } from "../analysisSearch.js";
import { directionOf, orderRole } from "./environmentStateOrderParameters.js";
import {
  ownMember,
  isObject,
  recordedItemCount,
  formatItemCount,
  renderStateList,
  scalarText,
  type JsonObject,
  type StateEntity,
  type StateListView,
} from "./environmentStateRules.js";
import { counterAt, withCounter } from "./environmentStateCounters.js";

/** What one list query parameter does to a list, learned from the recorded lines it explains. */
export type QueryParameter =
  | { readonly role: "filter"; readonly field: string }
  | { readonly role: "search"; readonly fields: string[] }
  | { readonly role: "sort" }
  | { readonly role: "direction" }
  | { readonly role: "limit" }
  | { readonly role: "offset" }
  | { readonly role: "page"; readonly first: number }
  | { readonly role: "inert"; readonly values: string[] };

/** A list view's query model: each parameter's role, the checked lines it answers, and the members that count matches before paging. */
export interface ListQuery {
  readonly parameters: Record<string, QueryParameter>;
  readonly record_ordinals: number[];
  readonly totals: string[];
}

/** One recorded line a query may explain: its query values, the identities it listed in order, the roles each parameter may play and the collection's entities. */
export interface QueryLine {
  readonly ordinal: number;
  readonly values: ReadonlyMap<string, string>;
  readonly listed: readonly string[];
  readonly choices: readonly (readonly [string, readonly QueryParameter[]])[];
  readonly entities: readonly StateEntity[];
}

const LIMIT = new Set([
  "count",
  "itemsperpage",
  "limit",
  "max_results",
  "maxresults",
  "maxsize",
  "page_size",
  "pagesize",
  "per_page",
  "perpage",
  "size",
  "take",
]);
const OFFSET = new Set(["_start", "offset", "skip", "start"]);
const SEARCH = new Set([
  "keyword",
  "keywords",
  "q",
  "query",
  "search",
  "search_term",
  "searchterm",
  "term",
]);
const IDENTIFYING = ["id", "slug", "name"];
/** At most this many role combinations are tried for one line. */
const MAX_COMBINATIONS = 256;
/** A line with more query parameters than this is left unexplained, which bounds the search's depth and work. */
const MAX_QUERY_NAMES = 12;

/** Only plain substring terms are modeled; syntax-like operators require recorded replay. */
const plainSearch = (value: string): boolean =>
  !/[:#"()[\]{}<>|*?\\]/u.test(value) &&
  !/(?:^|\s)(?:AND|OR|NOT)(?:\s|$)/u.test(value) &&
  !/(?:^|\s)[+-]\S/u.test(value);

const textOf = (value: JsonValue | undefined): string | undefined =>
  typeof value === "boolean" ? String(value) : scalarText(value);

/** Whether a field holds a value: equal as text, or in an array directly or as an object's id, slug or name. */
const holds = (field: JsonValue | undefined, value: string): boolean => {
  const names = (item: JsonValue | undefined) =>
    isObject(item) &&
    IDENTIFYING.some((key) => textOf(ownMember(item, key)) === value);
  return Array.isArray(field)
    ? field.some((item) => textOf(item) === value || names(item))
    : textOf(field) === value || names(field);
};

const contains = (
  fields: readonly string[],
  term: string,
): ((entity: StateEntity) => boolean) => {
  if (term === "") return () => true;
  const matches = literalSubstringPredicate(term, false);
  return (entity) =>
    fields.some((field) => {
      const value = ownMember(entity.fields, field);
      return typeof value === "string" && matches(value);
    });
};

const normalized = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/gu, "");

/** The field a sort value names and its direction: `name`, `-name`, `name:desc`, `name-ASC`; names match ignoring case and separators. */
const sortKey = (
  value: string,
  names: readonly string[],
): { readonly field: string; readonly descending: boolean } | undefined => {
  const field = (spelled: string) => {
    if (names.includes(spelled)) return spelled;
    const found = names.filter(
      (name) => normalized(name) === normalized(spelled),
    );
    return found.length === 1 ? found[0] : undefined;
  };
  if (names.includes(value)) return { field: value, descending: false };
  // A leading `-` descends; matching ignores separators, so it is read before the name is matched loosely.
  if (value.startsWith("-")) {
    const named = field(value.slice(1));
    return named === undefined ? undefined : { field: named, descending: true };
  }
  const whole = field(value);
  if (whole !== undefined) return { field: whole, descending: false };
  const suffixed = /^(.+?)[\s:_-](asc|desc)$/iu.exec(value);
  const named = suffixed === null ? undefined : field(suffixed[1]!);
  return named === undefined
    ? undefined
    : { field: named, descending: suffixed![2]!.toLowerCase() === "desc" };
};

/** Ascending order: numbers by value, text ignoring case, missing and null values last. */
const ascending = (
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): number => {
  const absent = (value: JsonValue | undefined) =>
    value === undefined || value === null;
  if (absent(left) || absent(right))
    return absent(left) ? (absent(right) ? 0 : 1) : -1;
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  const a = textOf(left) ?? JSON.stringify(left);
  const b = textOf(right) ?? JSON.stringify(right);
  return compare(a.toLowerCase(), b.toLowerCase());
};

const integer = (value: string): number | undefined => {
  const number = Number(value);
  return /^-?\d+$/u.test(value) && Number.isSafeInteger(number)
    ? number
    : undefined;
};

/** What a call's values ask of the collection, or undefined when one has no role or cannot apply. */
interface QueryCall {
  readonly selections: ((entity: StateEntity) => boolean)[];
  sort?: string;
  direction?: string;
  limit?: number | undefined;
  offset: number;
  page?: { readonly index: number; readonly first: number };
}

/** Roles that only sort or page an answer; one value sets each for a call, as two parameters in one would answer by whichever applied last. */
const PAGING_ROLES = new Set(["sort", "direction", "limit", "offset", "page"]);

const readCall = (
  parameters: Readonly<Record<string, QueryParameter>>,
  values: ReadonlyMap<string, string>,
): QueryCall | undefined => {
  const call: QueryCall = { selections: [], offset: 0 };
  const taken = new Set<string>();
  for (const [name, value] of values) {
    const parameter = Object.hasOwn(parameters, name)
      ? parameters[name]
      : undefined;
    const number = integer(value);
    if (parameter === undefined || taken.has(parameter.role)) return undefined;
    if (PAGING_ROLES.has(parameter.role)) taken.add(parameter.role);
    if (parameter.role === "filter")
      call.selections.push((entity) =>
        holds(ownMember(entity.fields, parameter.field), value),
      );
    else if (parameter.role === "search") {
      if (!plainSearch(value)) return undefined;
      call.selections.push(contains(parameter.fields, value));
    } else if (parameter.role === "sort") call.sort = value;
    else if (parameter.role === "direction") {
      const direction = directionOf(value);
      if (direction === undefined) return undefined;
      call.direction = direction;
    } else if (parameter.role === "inert") {
      if (!parameter.values.includes(value)) return undefined;
    } else if (number === undefined) return undefined;
    else if (parameter.role === "limit")
      call.limit = number > 0 ? number : undefined;
    else if (parameter.role === "offset" && number >= 0) call.offset = number;
    else if (parameter.role === "page" && number >= parameter.first)
      call.page = { index: number, first: parameter.first };
    else return undefined;
  }
  return call;
};

/** Entities in the order a sort value names, ties in state order, and those whose place state order decides: all without a sort, else those tied with a neighbour; undefined when it names no field. */
const sorted = (
  matched: readonly StateEntity[],
  entities: readonly StateEntity[],
  call: QueryCall,
):
  | {
      readonly entities: StateEntity[];
      readonly positional: readonly StateEntity[] | "all";
    }
  | undefined => {
  // Nothing to order: an emptied collection answers no entities rather than a recording.
  if (call.sort === undefined || matched.length === 0)
    return { entities: [...matched], positional: "all" };
  const names = [
    ...new Set(entities.flatMap((entity) => Object.keys(entity.fields))),
  ];
  const key = sortKey(call.sort, names);
  if (key === undefined) return undefined;
  const sign = (
    call.direction === undefined ? key.descending : call.direction === "desc"
  )
    ? -1
    : 1;
  const ordered = matched
    .map((entity, index) => ({ entity, index }))
    .sort(
      (left, right) =>
        sign *
          ascending(
            ownMember(left.entity.fields, key.field),
            ownMember(right.entity.fields, key.field),
          ) || left.index - right.index,
    )
    .map(({ entity }) => entity);
  const tied = (
    left: StateEntity | undefined,
    right: StateEntity | undefined,
  ) =>
    left !== undefined &&
    right !== undefined &&
    ascending(
      ownMember(left.fields, key.field),
      ownMember(right.fields, key.field),
    ) === 0;
  return {
    entities: ordered,
    positional: ordered.filter(
      (entity, index) =>
        tied(ordered[index - 1], entity) || tied(entity, ordered[index + 1]),
    ),
  };
};

/** The entities a query selects, in its order, and how many matched before paging; undefined when a value cannot be applied. */
export const evaluateQuery = (
  parameters: Readonly<Record<string, QueryParameter>>,
  values: ReadonlyMap<string, string>,
  entities: readonly StateEntity[],
):
  | {
      readonly page: StateEntity[];
      readonly total: number;
      /** The matches whose place in the answer state order decides: all without a sort, else those the sort leaves tied. */
      readonly positional: readonly StateEntity[] | "all";
    }
  | undefined => {
  const call = readCall(parameters, values);
  if (call === undefined) return undefined;
  const selection = sorted(
    entities.filter((entity) =>
      call.selections.every((selects) => selects(entity)),
    ),
    entities,
    call,
  );
  if (selection === undefined) return undefined;
  const matched = selection.entities;
  let { offset } = call;
  const { limit, page } = call;
  if (page !== undefined && page.index > page.first) {
    if (limit === undefined) return undefined;
    offset += (page.index - page.first) * limit;
  }
  return {
    page: matched.slice(
      offset,
      limit === undefined ? undefined : offset + limit,
    ),
    total: matched.length,
    positional: selection.positional,
  };
};

/** A query's answer and whether it shows the whole collection: every parameter only sorts or pages, and the page holds every match. */
export const answerQuery = (
  query: Pick<ListQuery, "parameters">,
  values: ReadonlyMap<string, string>,
  entities: readonly StateEntity[],
):
  | {
      readonly page: StateEntity[];
      readonly total: number;
      readonly positional: readonly StateEntity[] | "all";
      readonly whole: boolean;
    }
  | undefined => {
  const result = evaluateQuery(query.parameters, values, entities);
  return result === undefined
    ? undefined
    : {
        ...result,
        whole:
          result.page.length === result.total &&
          // Every name has its own role, or evaluating the call would have refused it.
          [...values.keys()].every((name) =>
            PAGING_ROLES.has(query.parameters[name]!.role),
          ),
      };
};

/** Fields every listed item holds the value in, those named like the parameter first. */
const filterFields = (
  items: readonly JsonObject[],
  name: string,
  value: string,
): string[] =>
  items.length === 0
    ? []
    : Object.keys(items[0]!)
        .filter((field) =>
          items.every((item) => holds(ownMember(item, field), value)),
        )
        .sort(
          (left, right) =>
            Number(normalized(right) === normalized(name)) -
            Number(normalized(left) === normalized(name)),
        )
        .slice(0, 4);

const isUrl = (value: string): boolean =>
  /^[a-z][a-z0-9+.-]*:\/\//iu.test(value);

/**
 * The string fields the term matched in the listed items: for each item the fields that contain it, ignoring case,
 * other than URLs, which a name or slug often repeats; an item the term matched only in URLs adds those.
 */
const searchFields = (items: readonly JsonObject[], term: string): string[] => {
  if (term === "") return [];
  const matchesTerm = literalSubstringPredicate(term, false);
  const fields = new Set<string>();
  for (const item of items) {
    const matching = Object.keys(item).filter((field) => {
      const value = item[field];
      return typeof value === "string" && matchesTerm(value);
    });
    const plain = matching.filter((field) => !isUrl(item[field] as string));
    for (const field of plain.length > 0 ? plain : matching) fields.add(field);
  }
  return [...fields].sort(compare);
};

/** The roles a parameter may play on a line that listed `items`, most specific first; inert last. */
const choicesFor = (
  name: string,
  value: string,
  items: readonly JsonObject[],
): QueryParameter[] => {
  const key = name.toLowerCase();
  const choices: QueryParameter[] = [];
  const number = integer(value);
  if (
    ((LIMIT.has(key) || OFFSET.has(key) || key === "page") &&
      (number === undefined ||
        ((OFFSET.has(key) || key === "page") && number < 0))) ||
    (SEARCH.has(key) && !plainSearch(value))
  )
    return [];
  const order = orderRole(name, value);
  if (order !== undefined) return order === "none" ? [] : [{ role: order }];
  if (LIMIT.has(key)) choices.push({ role: "limit" });
  else if (OFFSET.has(key)) choices.push({ role: "offset" });
  else if (key === "page")
    choices.push({ role: "page", first: 1 }, { role: "page", first: 0 });
  else if (SEARCH.has(key)) {
    // An empty or unmatched term shows no searchable field, so it stays inert until a term matches one.
    const fields = searchFields(items, value);
    if (fields.length > 0) choices.push({ role: "search", fields });
  }
  if (choices.length === 0 || SEARCH.has(key))
    for (const field of filterFields(items, name, value))
      choices.push({ role: "filter", field });
  choices.push({ role: "inert", values: [value] });
  return choices;
};

/** The roles each of a line's parameters may play, read from the items it listed. */
export const lineChoices = (
  values: ReadonlyMap<string, string>,
  items: readonly JsonObject[],
): [string, QueryParameter[]][] =>
  values.size > MAX_QUERY_NAMES
    ? []
    : [...values].map(([name, value]) => [
        name,
        choicesFor(name, value, items),
      ]);

const listsAsRecorded = (
  line: QueryLine,
  parameters: Readonly<Record<string, QueryParameter>>,
): boolean => {
  const result = evaluateQuery(parameters, line.values, line.entities);
  return (
    result !== undefined &&
    result.page.length === line.listed.length &&
    result.page.every((entity, index) => entity.id === line.listed[index])
  );
};

/** A filter that keeps every entity of the line's collection shows nothing a flag would not: it stays inert for that value. */
const withoutIdleFilters = (
  line: QueryLine,
  chosen: Record<string, QueryParameter>,
): Record<string, QueryParameter> =>
  Object.fromEntries(
    Object.entries(chosen).map(([name, role]) => {
      const value = line.values.get(name)!;
      return role.role === "filter" &&
        line.entities.every((entity) =>
          holds(ownMember(entity.fields, role.field), value),
        )
        ? [name, { role: "inert", values: [value] }]
        : [name, role];
    }),
  );

/** The first combination of roles, most specific first, that lists exactly what the line recorded. */
export const explainLine = (
  line: QueryLine,
): Record<string, QueryParameter> | undefined => {
  const options = line.choices;
  let tried = 0;
  const search = (
    index: number,
    chosen: Record<string, QueryParameter>,
  ): Record<string, QueryParameter> | undefined => {
    if (index === options.length) {
      tried += 1;
      return listsAsRecorded(line, chosen)
        ? withoutIdleFilters(line, chosen)
        : undefined;
    }
    const [name, choices] = options[index]!;
    for (const choice of choices) {
      if (tried >= MAX_COMBINATIONS) return undefined;
      const found = search(index + 1, { ...chosen, [name]: choice });
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const found = search(0, {});
  if (found === undefined) return undefined;
  // An empty/out-of-range page can fit both conventions. Do not turn a
  // preferred candidate's position into evidence of a zero-/one-based API.
  for (const [name, role] of Object.entries(found)) {
    if (role.role !== "page") continue;
    for (const candidate of line.choices.find(([key]) => key === name)?.[1] ??
      []) {
      if (candidate.role !== "page" || candidate.first === role.first) continue;
      if (tried >= MAX_COMBINATIONS) return undefined;
      tried++;
      if (listsAsRecorded(line, { ...found, [name]: candidate }))
        return undefined;
    }
  }
  return found;
};

/** One role per parameter across the lines that explained it: inert values gather, search fields unite, and any other disagreement drops the parameter. */
const mergeRoles = (
  explained: readonly Record<string, QueryParameter>[],
): Record<string, QueryParameter> => {
  const roles = new Map<string, QueryParameter[]>();
  for (const parameters of explained)
    for (const [name, role] of Object.entries(parameters))
      roles.set(name, [...(roles.get(name) ?? []), role]);
  // Entries become own members even for names such as `__proto__`, which assignment would treat as the prototype.
  const merged: [string, QueryParameter][] = [];
  for (const [name, seen] of roles) {
    const active = seen.filter((role) => role.role !== "inert");
    if (active.length === 0) {
      merged.push([
        name,
        {
          role: "inert",
          values: [
            ...new Set(
              seen.flatMap((role) =>
                role.role === "inert" ? role.values : [],
              ),
            ),
          ].sort(compare),
        },
      ]);
      continue;
    }
    const [first] = active;
    if (first!.role === "search") {
      if (active.every((role) => role.role === "search"))
        merged.push([
          name,
          {
            role: "search",
            fields: [
              ...new Set(
                active.flatMap((role) =>
                  role.role === "search" ? role.fields : [],
                ),
              ),
            ].sort(compare),
          },
        ]);
      continue;
    }
    if (active.every((role) => JSON.stringify(role) === JSON.stringify(first)))
      merged.push([name, first!]);
  }
  return Object.fromEntries(merged);
};

/** Whether a filtered field is named like its parameter, an id suffix aside: `category`, `site_id` for `site`. */
const namedLike = (field: string, name: string): boolean => {
  const [left, right] = [normalized(field), normalized(name)];
  return left === right || right === `${left}id` || left === `${right}id`;
};

/** The roles less any filter on a field named unlike its parameter that only one recorded value supports, since one line can match by coincidence. */
const trustedRoles = (
  parameters: Record<string, QueryParameter>,
  explained: readonly {
    readonly line: QueryLine;
    readonly parameters: Record<string, QueryParameter>;
  }[],
): Record<string, QueryParameter> =>
  Object.fromEntries(
    Object.entries(parameters).filter(([name, role]) => {
      if (role.role !== "filter" || namedLike(role.field, name)) return true;
      const values = new Set(
        explained
          .filter(
            (entry) => ownMember(entry.parameters, name)?.role === "filter",
          )
          .map((entry) => entry.line.values.get(name)),
      );
      return values.size >= 2;
    }),
  );

/** The query model that lists exactly what each explained line recorded, or undefined when none does. */
export const learnQuery = (
  lines: readonly QueryLine[],
): Pick<ListQuery, "parameters" | "record_ordinals"> | undefined => {
  const explained = lines.flatMap((line) => {
    const parameters = explainLine(line);
    return parameters === undefined ? [] : [{ line, parameters }];
  });
  if (explained.length === 0) return undefined;
  const parameters = trustedRoles(
    mergeRoles(explained.map((entry) => entry.parameters)),
    explained,
  );
  const record_ordinals = lines
    .filter((line) => listsAsRecorded(line, parameters))
    .map((line) => line.ordinal);
  return record_ordinals.length === 0
    ? undefined
    : { parameters, record_ordinals };
};

/** A count whose numeric or canonical decimal-string representation can be reproduced without guessing formatting. */
export const queryTotalCount = (
  value: JsonValue | undefined,
): number | undefined => {
  const count = recordedItemCount(value);
  return count !== undefined &&
    Number.isSafeInteger(count) &&
    count >= 0 &&
    (typeof value !== "string" || String(count) === value)
    ? count
    : undefined;
};

/** A query answer: the base line's envelope with the selected entities, counters at the number listed and totals at the number matched. */
export const renderQueryList = (
  view: Pick<StateListView, "pointer" | "counters" | "listed_ids"> & {
    readonly query: Pick<ListQuery, "totals">;
  },
  base: JsonValue,
  items: readonly JsonObject[],
  total: number,
): JsonValue =>
  view.query.totals.reduce(
    (body, name) => {
      const recorded = counterAt(base, name);
      return queryTotalCount(recorded) === undefined
        ? body
        : withCounter(body, name, formatItemCount(total, recorded!));
    },
    renderStateList(view, base, items, total === items.length),
  );
