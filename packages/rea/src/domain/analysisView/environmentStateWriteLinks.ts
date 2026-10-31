import type { StateRecordChronology } from "./StateRecordChronology.js";
import type { JsonValue } from "../jsonValue.js";
import {
  ownMember,
  collectionPathOf,
  IDENTITY_NAMES,
  identityCandidates,
  isObject,
  isParam,
  lastSegmentValue,
  listItems,
  locateItem,
  locateList,
  normalizedPath,
  pathSegmentMatches,
  scalarText,
  segmentsOf,
  type StateEntity,
  type StateRecordFacts,
  type StateToolFacts,
  type StateView,
} from "./environmentStateRules.js";
import { ENTRY_BYTES, textBytes } from "./webNetworkRouteTemplates.js";
import {
  pathValuesOf,
  type FieldRule,
  type WriteEffect,
} from "./environmentStateWriteRules.js";

/** The shortest id that names one entity rather than counting one, or naming one of any type. */
const MIN_ID_LENGTH = 4;

/** Identity names that describe an entity rather than number it, so its own suffix-named id may sit beside them. */
const DESCRIPTIVE_NAMES: ReadonlySet<string> = new Set(["key", "slug", "name"]);

const succeeded = (record: StateRecordFacts): boolean =>
  record.status !== null && record.status >= 200 && record.status < 300;

/** An object's identity-named scalar members. */
const identityValues = (object: JsonValue | undefined): string[] =>
  isObject(object)
    ? IDENTITY_NAMES.flatMap((name) => {
        const value = scalarText(ownMember(object, name));
        return value === undefined ? [] : [value];
      })
    : [];

/** The one object a one-element array holds, else the value itself. */
const unwrapped = (value: JsonValue): JsonValue =>
  Array.isArray(value) && value.length === 1 ? value[0]! : value;

/**
 * The ids a write's response names for an entity it made: an identity-named member of the body or of
 * an object member (an envelope, or the one object of a one-element array member) at any length, or a
 * scalar body or sole scalar member long enough to name one.
 */
export const respondedIds = (body: JsonValue | undefined): string[] => {
  if (body === undefined || body === null) return [];
  const named = (value: JsonValue | undefined): string[] => {
    const text = scalarText(value);
    return text !== undefined && text.length >= MIN_ID_LENGTH ? [text] : [];
  };
  if (!isObject(body)) return named(body);
  const members = Object.values(body);
  return [
    ...new Set([
      ...identityValues(body),
      ...(members.length === 1 ? named(members[0]) : []),
      ...members.flatMap((member) => identityValues(unwrapped(member))),
    ]),
  ];
};

/** The identity-named scalar values a body shows at any depth. */
const identitiesIn = (root: JsonValue | undefined): Set<string> => {
  const shown = new Set<string>();
  const pending: JsonValue[] = root === undefined ? [] : [root];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    // One push per child: spreading a large array would exceed the engine's argument limit.
    if (Array.isArray(next)) for (const child of next) pending.push(child);
    else if (isObject(next)) {
      for (const id of identityValues(next)) shown.add(id);
      for (const child of Object.values(next)) pending.push(child);
    }
  }
  return shown;
};

/**
 * The ids a list read shows: its listed entities' own identity-named members and, across two or
 * more of them when no id-named field identifies them, the first suffix-named field (`projectId`)
 * distinct on each, so a foreign key beside an `id` is no id of theirs; any id it shows at any depth
 * when it lists none.
 */
const listedIds = (body: JsonValue | undefined): Set<string> => {
  const pointer = body === undefined ? undefined : locateList(body, undefined);
  const items =
    body === undefined || pointer === undefined
      ? undefined
      : listItems(body, pointer);
  if (items === undefined) return identitiesIn(body);
  const candidates = items.length < 2 ? [] : identityCandidates(items);
  const suffixed = candidates.some(
    (name) => IDENTITY_NAMES.includes(name) && !DESCRIPTIVE_NAMES.has(name),
  )
    ? undefined
    : candidates.find((name) => !IDENTITY_NAMES.includes(name));
  return new Set([
    ...items.flatMap(identityValues),
    ...(suffixed === undefined
      ? []
      : items.flatMap((item) => scalarText(ownMember(item, suffixed)) ?? [])),
  ]);
};

/** Whether an item read's body shows the entity its path names, not an absence such as JSON null. */
const showsItem = (body: JsonValue | undefined, id: string): boolean =>
  body !== undefined && body !== null && locateItem(body, id) !== undefined;

/** The ids a read shows: its listed entities' for a list read, or its path's id for an item read that shows the item. */
const shownIds = (
  record: StateRecordFacts,
  item: boolean,
  body: JsonValue | undefined,
): Set<string> => {
  if (!item) return listedIds(body);
  const id = lastSegmentValue(record.path);
  return showsItem(body, id) ? new Set([id]) : new Set();
};

/** The shown ids a creation returned, each charged before it is kept. */
const keptIds = (
  shown: ReadonlySet<string>,
  returned: ReadonlySet<string>,
  retain: (bytes: number) => void,
): Set<string> => {
  const kept = new Set<string>();
  for (const id of shown)
    if (returned.has(id)) {
      retain(ENTRY_BYTES + textBytes(id.length));
      kept.add(id);
    }
  retain(ENTRY_BYTES);
  return kept;
};

/** One read of a type: where it ran, when it finished, whether it reads one item, and the ids it shows. */
interface ShownRead {
  readonly at: number;
  readonly end: number | undefined;
  readonly item: boolean;
  readonly ids: ReadonlySet<string>;
}

/**
 * The ids a POST at `post.at` made that a type's reads show only after it began, before `until`: a
 * read finished before the POST began shows what was there, and one still running may show its
 * effect. A short id may be any type's, so it counts only when the type was read before the POST
 * and an item read names it after.
 */
const freshIds = (
  ids: readonly string[],
  shown: readonly ShownRead[],
  post: { readonly at: number; readonly start: number | undefined },
  until: number,
): string[] => {
  const before = (read: ShownRead): boolean =>
    read.at < post.at &&
    read.end !== undefined &&
    post.start !== undefined &&
    read.end <= post.start;
  const seen = shown.some(before);
  return ids.filter((id) => {
    const short = id.length < MIN_ID_LENGTH;
    return (
      (!short || seen) &&
      !shown.some((read) => before(read) && read.ids.has(id)) &&
      shown.some(
        (read) =>
          !before(read) &&
          read.at < until &&
          (!short || read.item) &&
          read.ids.has(id),
      )
    );
  });
};

/** A successful POST and the ids its response named. */
export interface CreatedIds {
  readonly record: StateRecordFacts;
  readonly ids: readonly string[];
}

/** The successful POSTs among a timeline's writes, with the ids their responses named. */
export const createdIdsOf = (
  writes: readonly StateRecordFacts[],
  idsOf: (ordinal: number) => string[],
): CreatedIds[] =>
  writes.flatMap((record) => {
    if (record.method !== "POST" || !succeeded(record)) return [];
    const ids = idsOf(record.ordinal);
    return ids.length === 0 ? [] : [{ record, ids }];
  });

/** The state type a GET tool reads and whether it reads one item: its path less a trailing parameter. */
export const readType = (
  template: string,
): { readonly item: boolean; readonly type: string } => {
  const segments = segmentsOf(template);
  const item = segments.length > 0 && isParam(segments.at(-1)!);
  return {
    item,
    type: item
      ? `/${segments.slice(0, -1).join("/")}`
      : normalizedPath(template),
  };
};

/**
 * The earliest POST that made an entity a type's reads first show after it, before `until`: such a
 * POST changes the type although its path is elsewhere, so it bounds the type's initial recordings.
 */
export const creationLimit = (
  creations: readonly CreatedIds[],
  reads: {
    readonly type: string;
    readonly chronology: StateRecordChronology;
    readonly tools: readonly StateToolFacts[];
    readonly records: ReadonlyMap<number, StateRecordFacts>;
    readonly position: (record: StateRecordFacts) => number;
    readonly withBody: <T>(
      ordinal: number,
      use: (body: JsonValue | undefined) => T,
    ) => T;
    readonly retain: (bytes: number) => void;
  },
  until: StateRecordFacts | undefined,
): StateRecordFacts | undefined => {
  if (creations.length === 0) return undefined;
  // Only the ids some creation returned can be fresh, so each read keeps those alone, charged.
  const returned = new Set(creations.flatMap((creation) => creation.ids));
  const end = until === undefined ? Infinity : reads.position(until);
  const readers = reads.tools.flatMap((tool) => {
    const read = readType(tool.path_template);
    return tool.method === "GET" && read.type === reads.type
      ? [{ tool, item: read.item }]
      : [];
  });
  // A read at or after `end` is no counted creation's read before or after it, so it is not parsed.
  const shown: ShownRead[] = readers.flatMap(({ tool, item }) =>
    tool.record_ordinals.flatMap((ordinal) => {
      const record = reads.records.get(ordinal);
      if (record === undefined || !succeeded(record)) return [];
      const at = reads.position(record);
      if (at >= end) return [];
      const ids = reads.withBody(ordinal, (body) =>
        shownIds(record, item, body),
      );
      return [
        {
          at,
          end: reads.chronology.endMs(record),
          item,
          ids: keptIds(ids, returned, reads.retain),
        },
      ];
    }),
  );
  for (const creation of [...creations].sort(
    (left, right) => reads.position(left.record) - reads.position(right.record),
  )) {
    const at = reads.position(creation.record);
    if (at >= end) break;
    const post = { at, start: reads.chronology.startMs(creation.record) };
    if (freshIds(creation.ids, shown, post, end).length > 0)
      return creation.record;
  }
  return undefined;
};

/**
 * The state type and collection a POST whose path names none creates into: that of the first later
 * successful item read naming an id its first successful call returned, before any other tool's
 * write, when neither the initial state nor any read finished before the call of that id, its
 * type's lists or its collection showed that id. A short id may be any type's, so it links only to a type read before the call.
 */
export const linkedCreate = (input: {
  readonly tool: StateToolFacts;
  readonly chronology: StateRecordChronology;
  readonly records: readonly StateRecordFacts[];
  readonly isWrite: (record: StateRecordFacts) => boolean;
  readonly viewOf: (ordinal: number) => StateView | undefined;
  readonly entities: readonly StateEntity[];
  readonly respondedIds: (ordinal: number) => readonly string[];
  readonly shownIds: (ordinal: number) => ReadonlySet<string>;
  readonly showsItem: (ordinal: number, id: string) => boolean;
}): { readonly type: string; readonly collection: string } | undefined => {
  const { tool, records } = input;
  const own = new Set(tool.record_ordinals);
  const first = records.findIndex(
    (record) => own.has(record.ordinal) && succeeded(record),
  );
  if (first === -1) return undefined;
  const post = records[first]!;
  const ids = new Set(input.respondedIds(post.ordinal));
  if (ids.size === 0) return undefined;
  // Only a read finished before the call began shows what was there before it, as `freshIds` decides.
  const before = records
    .slice(0, first)
    .filter((record) => input.chronology.completedBefore(record, post));
  for (const record of records.slice(first + 1)) {
    // Another write may have made what a later read shows, so the search ends there.
    if (!own.has(record.ordinal) && input.isWrite(record)) return undefined;
    const view = input.viewOf(record.ordinal);
    // A read naming the id but showing no entity, such as JSON null, says nothing of where the call created.
    if (
      record.method !== "GET" ||
      !succeeded(record) ||
      view?.shape !== "item" ||
      !ids.has(lastSegmentValue(record.path)) ||
      !input.showsItem(record.ordinal, lastSegmentValue(record.path))
    )
      continue;
    const id = lastSegmentValue(record.path);
    const collection = collectionPathOf(record, true);
    // An earlier read of the id under another type or collection names another entity.
    const readBefore = before.some((earlier) => {
      const read = input.viewOf(earlier.ordinal);
      return (
        earlier.method === "GET" &&
        succeeded(earlier) &&
        lastSegmentValue(earlier.path) === id &&
        ((read?.shape === "item" && read.type === view.type) ||
          normalizedPath(collectionPathOf(earlier, true)) ===
            normalizedPath(collection)) &&
        input.showsItem(earlier.ordinal, id)
      );
    });
    const held =
      readBefore ||
      input.entities.some(
        (entity) => entity.type === view.type && entity.id === id,
      ) ||
      before.some((earlier) => {
        const read = input.viewOf(earlier.ordinal);
        return (
          earlier.method === "GET" &&
          succeeded(earlier) &&
          ((read?.shape === "list" && read.type === view.type) ||
            normalizedPath(earlier.path) === normalizedPath(collection)) &&
          input.shownIds(earlier.ordinal).has(id)
        );
      });
    const unseen =
      id.length < MIN_ID_LENGTH &&
      !before.some((earlier) => {
        const read = input.viewOf(earlier.ordinal);
        return (
          earlier.method === "GET" &&
          succeeded(earlier) &&
          (read?.shape === "item" || read?.shape === "list") &&
          read.type === view.type
        );
      });
    return held || unseen ? undefined : { type: view.type, collection };
  }
  return undefined;
};

/** The collection a create plan writes into when its tool's own path names no state type: the one its returned id was read under. */
export const linkedCollection = (
  plan: {
    readonly effect: string;
    readonly target: string | null;
    readonly collection: string | null;
  },
  template: string,
): string | undefined =>
  plan.effect === "create" &&
  plan.target !== null &&
  plan.collection !== null &&
  plan.target !== normalizedPath(template)
    ? plan.collection
    : undefined;

/**
 * The values a recorded path gives its template's parameters as spelled, undecoded, by segment
 * position, since a template may name two parameters alike; undefined when it does not fit.
 */
export const recordedPathValues = (
  template: string,
  path: string,
): Map<number, string> | undefined => {
  if (pathValuesOf(template, path) === undefined) return undefined;
  const segments = segmentsOf(path);
  return new Map(
    segmentsOf(template).flatMap((segment, index) =>
      isParam(segment) ? [[index, segments[index]!] as const] : [],
    ),
  );
};

/** Whether a linked create may take any path arguments: it creates into its type's own collection, whose path has no parameters, and stores each path value in a field, so none changes where it creates. */
export const anyLinkedSource = (
  plan: {
    readonly target: string | null;
    readonly collection: string | null;
    readonly rules: readonly FieldRule[];
  },
  template: string,
): boolean =>
  plan.target !== null &&
  plan.collection !== null &&
  normalizedPath(plan.collection) === plan.target &&
  !segmentsOf(plan.target).some(isParam) &&
  segmentsOf(template)
    .filter(isParam)
    .every((segment) =>
      plan.rules.some(
        (rule) => rule.rule === "path" && rule.from === segment.slice(1, -1),
      ),
    );

/**
 * Whether a linked create's call sends the path values its exemplar did, each as recorded or in the
 * other spelling once percent-decoded: the read that linked its target followed only that call. The
 * call's values come as spelled, so neither side is decoded twice.
 */
export const sameLinkedSource = (
  template: string,
  exemplar: string | undefined,
  call: ReadonlyMap<number, string> | undefined,
): boolean => {
  const recorded =
    exemplar === undefined ? undefined : recordedPathValues(template, exemplar);
  if (recorded === undefined || call === undefined) return false;
  return (
    recorded.size === call.size &&
    [...recorded].every(([index, value]) => {
      const given = call.get(index);
      return given !== undefined && pathSegmentMatches(value, given);
    })
  );
};

/** A write's effect and target, where a POST its path gives no target becomes a create into the type its returned id is first read under. */
export const linkedTarget = (
  tool: StateToolFacts,
  classified: { readonly effect: WriteEffect; readonly target: string | null },
  input: {
    readonly records: readonly StateRecordFacts[];
    readonly chronology: StateRecordChronology;
    readonly isWrite: (record: StateRecordFacts) => boolean;
    readonly viewOf: (ordinal: number) => StateView | undefined;
    readonly entities: readonly StateEntity[];
    readonly io: {
      readonly withBody: <T>(
        ordinal: number,
        use: (body: JsonValue | undefined) => T,
      ) => T;
    };
  },
): {
  readonly effect: WriteEffect;
  readonly target: string | null;
  readonly collection?: string;
} => {
  const link =
    classified.effect === "none" && tool.method === "POST"
      ? linkedCreate({
          tool,
          records: input.records,
          chronology: input.chronology,
          isWrite: input.isWrite,
          viewOf: input.viewOf,
          entities: input.entities,
          respondedIds: (ordinal) => input.io.withBody(ordinal, respondedIds),
          shownIds: (ordinal) => input.io.withBody(ordinal, listedIds),
          showsItem: (ordinal, id) =>
            input.io.withBody(ordinal, (body) => showsItem(body, id)),
        })
      : undefined;
  return link === undefined
    ? classified
    : { effect: "create", target: link.type, collection: link.collection };
};
