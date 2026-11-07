import type { JsonValue } from "../jsonValue.js";
import { compareUnicodeCodePoints as compare } from "../unicodeCodePointOrder.js";
import {
  same,
  type JsonObject,
  type StateEntity,
} from "./environmentStateRules.js";

/** One entity object as one tool recorded it. */
export interface StateObservation {
  readonly position: number;
  /** Where in its read the entity was listed; 0 for an item read. */
  readonly index: number;
  readonly ordinal: number;
  readonly tool: string;
  readonly item: boolean;
  readonly object: JsonObject;
}

/** Every init observation of one entity, with where it was first seen. */
export interface ObservedEntity {
  readonly type: string;
  readonly collection: string;
  readonly id: string;
  /** The earliest recorded sighting: timeline position, then position in its list. */
  order: readonly [number, number];
  readonly observations: StateObservation[];
}

/** Collection order: type, collection, then first sighting. */
export const compareObservedEntities = (
  left: ObservedEntity,
  right: ObservedEntity,
): number =>
  compare(left.type, right.type) ||
  compare(left.collection, right.collection) ||
  left.order[0] - right.order[0] ||
  left.order[1] - right.order[1];

/** One entity: item views' latest values win over list views', and a view whose latest values differ keeps them. */
export const mergeObservedEntity = (entity: ObservedEntity): StateEntity => {
  const latest = new Map<string, StateObservation>();
  for (const observation of entity.observations)
    latest.set(observation.tool, observation);
  const fields = new Map<string, JsonValue>();
  const ranked = [...latest.values()].sort(
    (left, right) =>
      Number(left.item) - Number(right.item) || left.position - right.position,
  );
  for (const observation of ranked)
    for (const [name, value] of Object.entries(observation.object))
      fields.set(name, value);
  return {
    type: entity.type,
    collection: entity.collection,
    id: entity.id,
    fields: Object.fromEntries(fields),
    view_fields: [...latest.values()]
      .map((observation) => ({
        tool: observation.tool,
        fields: Object.fromEntries(
          Object.entries(observation.object).filter(
            ([name, value]) => !same(fields.get(name), value),
          ),
        ),
      }))
      .filter((view) => Object.keys(view.fields).length > 0)
      .sort((left, right) => compare(left.tool, right.tool)),
    // Cited in timeline order, whichever plan observed them first.
    record_ordinals: [
      ...new Set(
        entity.observations
          .toSorted((left, right) => left.position - right.position)
          .map((observation) => observation.ordinal),
      ),
    ],
  };
};

/**
 * How observed values changed, per entity in timeline order. A shared field that differs from the
 * previous repeat of the same request line is volatile, unless a recorded write lies between them;
 * a field that differs from its previous observation on another line across a write rewrites the
 * type. Either across a write means the reads do not agree on one initial state; each such pair of
 * observations is a span the type's initial reads can end before.
 */
export const classifyEntityChanges = (
  entities: Iterable<ObservedEntity>,
  lineOf: (observation: StateObservation) => readonly string[],
  writeBetween: (earlier: StateObservation, later: StateObservation) => boolean,
): {
  readonly rewritten: ReadonlySet<string>;
  readonly volatile: ReadonlyMap<string, Set<string>>;
  readonly spans: readonly {
    readonly type: string;
    readonly earlier: number;
    readonly later: number;
  }[];
} => {
  const rewritten = new Set<string>();
  const volatile = new Map<string, Set<string>>();
  const spans: { type: string; earlier: number; later: number }[] = [];
  const rewrite = (
    type: string,
    earlier: StateObservation,
    later: StateObservation,
  ) => {
    rewritten.add(type);
    spans.push({ type, earlier: earlier.ordinal, later: later.ordinal });
  };
  const changed = (before: StateObservation, after: StateObservation) =>
    Object.keys(after.object).filter(
      (name) =>
        Object.hasOwn(before.object, name) &&
        !same(before.object[name], after.object[name]),
    );
  for (const entity of entities) {
    const timeline = [...entity.observations].sort(
      (left, right) => left.position - right.position,
    );
    const lastOfLine = new Map<string, StateObservation>();
    // Sparse projections do not erase where each field was last observed.
    const lastOfField = new Map<
      string,
      { readonly observation: StateObservation; readonly line: string }
    >();
    timeline.forEach((after) => {
      const line = JSON.stringify(lineOf(after));
      const repeat = lastOfLine.get(line);
      if (repeat !== undefined) {
        if (writeBetween(repeat, after)) {
          // Key additions/removals are changes too, even when every shared field is unchanged.
          if (!same(repeat.object, after.object))
            rewrite(entity.type, repeat, after);
        } else
          for (const name of changed(repeat, after))
            volatile.set(
              entity.type,
              (volatile.get(entity.type) ?? new Set()).add(name),
            );
      }
      const sighting = { observation: after, line };
      for (const name of Object.keys(after.object)) {
        const previous = lastOfField.get(name);
        if (
          previous !== undefined &&
          previous.line !== line &&
          !same(previous.observation.object[name], after.object[name]) &&
          writeBetween(previous.observation, after)
        )
          rewrite(entity.type, previous.observation, after);
        lastOfField.set(name, sighting);
      }
      lastOfLine.set(line, after);
    });
  }
  return { rewritten, volatile, spans };
};
