import type { JsonValue } from "../jsonValue.js";
import type { StateRecordChronology } from "./StateRecordChronology.js";
import {
  ownMember,
  at,
  collectionPathOf,
  isObject,
  lastSegmentValue,
  listItems,
  pointerTo,
  projectsFields,
  same,
  scalarText,
  type JsonObject,
  type StateEntity,
  type StateRecordFacts,
  type StateView,
} from "./environmentStateRules.js";
import { queryValues, replayReason } from "./environmentStateVariants.js";
import { readClock } from "./environmentStateWriteValues.js";

/** A read a create's observation takes fields from: an item read's respell the response's clocks and add fields, a list read's only add fields. */
export interface ObservedRead {
  readonly ordinal: number;
  readonly pointer: string;
  readonly shape: "item" | "list";
  /** Pointers into the entity to values the response had not loaded and the item read shows loaded, or members the read adds inside an object the response showed. */
  readonly unloaded?: string[];
}

/** Whether two clocks agree at the coarser recorded fraction precision, retaining all digits through nanoseconds. */
export const respelledInstant = (
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): boolean => {
  const [a, b] = [readClock(left), readClock(right)];
  if (a?.format.kind !== "iso" || b?.format.kind !== "iso") return false;
  const [fine, coarse] =
    a.format.fraction >= b.format.fraction ? [a, b] : [b, a];
  if (coarse.format.kind !== "iso") return false;
  const unit = 10 ** (9 - coarse.format.fraction);
  const fraction = (clock: typeof fine) =>
    (((clock.ms % 1000) + 1000) % 1000) * 1_000_000 + clock.subMillisecond;
  return (
    Math.floor(fine.ms / 1000) === Math.floor(coarse.ms / 1000) &&
    Math.floor(fraction(fine) / unit) * unit === fraction(coarse)
  );
};

/** Go's zero `time.Time`, which a response shows for a time it has not loaded. */
const ZERO_TIME = /^0001-01-01T00:00:00(?:\.0+)?(?:Z|[+-]00:?00)$/u;

/** A value a create's response holds where it has not loaded the stored one: empty, zero, false or Go's zero time. */
const unloaded = (value: JsonValue | undefined): boolean =>
  value === null ||
  value === "" ||
  value === 0 ||
  value === false ||
  (typeof value === "string" && ZERO_TIME.test(value)) ||
  (Array.isArray(value)
    ? value.length === 0
    : isObject(value) && Object.keys(value).length === 0);

/** Whether a later item read shows what a create's response showed, respelled or loaded: the same value, the same instant, a value for an unloaded one, or an object whose members each are. */
export const loadedLater = (
  response: JsonValue | undefined,
  read: JsonValue | undefined,
): boolean =>
  same(response, read) ||
  respelledInstant(response, read) ||
  (read !== undefined && unloaded(response)) ||
  (isObject(response) &&
    isObject(read) &&
    Object.keys(response).every((key) =>
      loadedLater(response[key], ownMember(read, key)),
    ));

/** Pointers to the values a create's response had not loaded where a later read shows others, and to members a read adds inside an object the response showed, within nested objects too. */
export const unloadedPointers = (
  response: JsonObject,
  read: JsonObject,
  prefix = "",
): string[] => [
  ...Object.entries(response).flatMap(([key, value]) => {
    const loaded = ownMember(read, key);
    const pointer = `${prefix}${pointerTo(key)}`;
    if (loaded === undefined || same(value, loaded)) return [];
    if (isObject(value) && isObject(loaded) && Object.keys(value).length > 0)
      return unloadedPointers(value, loaded, pointer);
    return unloaded(value) ? [pointer] : [];
  }),
  ...(prefix === ""
    ? []
    : Object.keys(read)
        .filter((key) => !Object.hasOwn(response, key))
        .map((key) => `${prefix}${pointerTo(key)}`)),
];

/** A create's response object with a read's fields: an item read's values win, a list read only adds fields the response lacks. */
export const withRead = (
  response: JsonObject,
  read: JsonObject,
  shape: ObservedRead["shape"],
): JsonObject =>
  shape === "item" ? { ...response, ...read } : { ...read, ...response };

/** Where an observed entity object was found: the record and a JSON pointer into its response. */
export interface Observed {
  readonly ordinal: number;
  readonly pointer: string;
  readonly object: JsonObject;
  readonly id: string;
  /** A create's later read whose fields the object adds to the response's, and whose clock spellings an item read lends it. */
  readonly read?: ObservedRead;
}

/** Objects a response carries where an entity may be, in precedence tiers: the root, one member, then the element of a one-element array at the root or in one member. */
const entitySlots = (body: JsonValue): [string, JsonValue][][] => {
  const members = isObject(body) ? Object.entries(body) : [];
  const elements: [string, JsonValue][] =
    Array.isArray(body) && body.length === 1 ? [["/0", body[0]!]] : [];
  for (const [name, item] of members)
    if (Array.isArray(item) && item.length === 1)
      elements.push([`${pointerTo(name)}/0`, item[0]!]);
  return [
    [["", body]],
    members.map(([name, item]): [string, JsonValue] => [pointerTo(name), item]),
    elements,
  ];
};

/** The entity object a response carries with an identity value the state does not hold yet: the only one in the first tier that has one. */
export const newEntityIn = (
  ordinal: number,
  body: JsonValue | undefined,
  idField: string,
  held: (id: string) => boolean,
): Observed | undefined => {
  if (body === undefined) return undefined;
  for (const tier of entitySlots(body)) {
    const found = tier.flatMap(([pointer, object]) => {
      const id = isObject(object)
        ? scalarText(ownMember(object, idField))
        : undefined;
      // An object holding only the identity names the entity without showing it.
      return isObject(object) &&
        id !== undefined &&
        !held(id) &&
        Object.keys(object).some((key) => key !== idField)
        ? [{ ordinal, pointer, object, id }]
        : [];
    });
    if (found.length > 0) return found.length === 1 ? found[0] : undefined;
  }
  return undefined;
};

/** The fields an item or list view shows; undefined for any other view. */
export const viewFields = (
  view: StateView | undefined,
): readonly string[] | undefined =>
  view?.shape === "item" || view?.shape === "list" ? view.fields : undefined;

/** The fields of the view a read observed an entity with, when that view had shown the entity before. */
export const shownBefore = (
  viewOf: (ordinal: number) => StateView | undefined,
  entity: Pick<StateEntity, "record_ordinals">,
  ordinal: number,
): readonly string[] => {
  const view = viewOf(ordinal);
  const shown = entity.record_ordinals.some(
    (earlier) => viewOf(earlier)?.tool === view?.tool,
  );
  return (shown ? viewFields(view) : undefined) ?? [];
};

/** What a forward search for an observation reads: records after a position, read views and response bodies. */
export interface ObservationSearch {
  readonly records: readonly StateRecordFacts[];
  readonly from: number;
  /** Completion must be established before a read may supply a write observation. */
  readonly chronology: StateRecordChronology;
  readonly viewOf: (ordinal: number) => StateView | undefined;
  readonly withBody: <T>(
    ordinal: number,
    use: (body: JsonValue | undefined) => T,
  ) => T;
  readonly queryOf: (ordinal: number) => string | null | undefined;
}

/** Whether a successful read neither checks the state nor observes a write: serving replays it, or it asked for some fields only and shows no whole entity. */
export const projectedRead = (
  view: StateView,
  record: StateRecordFacts,
  io: Pick<ObservationSearch, "withBody" | "queryOf">,
): boolean => {
  if (view.shape !== "item" && view.shape !== "list") return false;
  // An absence or error holds no entity, so it is never a partial one and stays evidence.
  if (!succeeded(record)) return false;
  if (replayReason(view, queryValues(record.query), io.queryOf) !== undefined)
    return true;
  // Serving answers such a selection with the whole entity, which part of one can neither confirm nor check.
  if (!projectsFields(record.query)) return false;
  return io.withBody(record.ordinal, (body) => {
    const objects =
      body === undefined || body === null
        ? []
        : view.shape === "item"
          ? [at(body, view.pointer)]
          : (listItems(body, view.pointer) ?? []);
    return objects.some(
      (object) =>
        !isObject(object) ||
        view.required_fields.some((field) => !Object.hasOwn(object, field)),
    );
  });
};

const succeeded = (record: StateRecordFacts): boolean =>
  record.status !== null && record.status >= 200 && record.status < 300;

/**
 * The first later read, before the next write, that shows a written entity: an item read of
 * `id` when given, else an item read of an unheld id or a collection read listing exactly one.
 * A read begun while the write still ran may show the earlier state, so it is not chosen.
 */
export const laterObservation = (
  search: ObservationSearch,
  target: {
    readonly type: string;
    readonly collection: string;
    readonly idField: string;
    readonly id?: string;
    readonly held: (id: string) => boolean;
    readonly isWrite: (record: StateRecordFacts) => boolean;
    /** An item read matches by this instead of equal collection strings. */
    readonly sameItem?: (record: StateRecordFacts) => boolean;
    /** Skip read views that do not cover the facts needed by this observation. */
    readonly covers?: (
      view: Extract<StateView, { readonly shape: "item" | "list" }>,
    ) => boolean;
  },
): Observed | undefined => {
  for (const record of search.records.slice(search.from + 1)) {
    if (target.isWrite(record)) return undefined;
    // The same overlap the check path ignores: the write was still running when this read began.
    if (
      !search.chronology.completedBefore(search.records[search.from]!, record)
    )
      continue;
    const view = search.viewOf(record.ordinal);
    if (
      !succeeded(record) ||
      (view?.shape !== "item" && view?.shape !== "list") ||
      view.type !== target.type ||
      projectedRead(view, record, search)
    )
      continue;
    if (target.covers !== undefined && !target.covers(view)) continue;
    const found =
      view.shape === "item"
        ? itemObservation(search, record, view.pointer, target)
        : listObservation(search, record, view.pointer, target);
    if (found !== undefined) return found;
  }
  return undefined;
};

const itemObservation = (
  search: ObservationSearch,
  record: StateRecordFacts,
  pointer: string,
  target: Parameters<typeof laterObservation>[1],
): Observed | undefined => {
  const pathId = lastSegmentValue(record.path);
  const named =
    target.sameItem?.(record) ??
    (collectionPathOf(record, true) === target.collection &&
      (target.id === undefined ? !target.held(pathId) : pathId === target.id));
  if (!named) return undefined;
  const id = target.id ?? pathId;
  return search.withBody(record.ordinal, (body) => {
    const object =
      body === undefined
        ? undefined
        : entitySlots(body)
            .flat()
            .find(([at]) => at === pointer)?.[1];
    return isObject(object) &&
      scalarText(ownMember(object, target.idField)) === id
      ? { ordinal: record.ordinal, pointer, object, id }
      : undefined;
  });
};

const listObservation = (
  search: ObservationSearch,
  record: StateRecordFacts,
  pointer: string,
  target: Parameters<typeof laterObservation>[1],
): Observed | undefined => {
  if (collectionPathOf(record, false) !== target.collection) return undefined;
  return search.withBody(record.ordinal, (body) => {
    const items = body === undefined ? undefined : listItems(body, pointer);
    const unheld = (items ?? [])
      .map((object, index) => ({
        object,
        index,
        id: scalarText(ownMember(object, target.idField)),
      }))
      .filter(
        (entry): entry is { object: JsonObject; index: number; id: string } =>
          entry.id !== undefined &&
          !target.held(entry.id) &&
          (target.id === undefined || entry.id === target.id),
      );
    return unheld.length === 1
      ? {
          ordinal: record.ordinal,
          pointer: `${pointer}/${String(unheld[0]!.index)}`,
          object: unheld[0]!.object,
          id: unheld[0]!.id,
        }
      : undefined;
  });
};
