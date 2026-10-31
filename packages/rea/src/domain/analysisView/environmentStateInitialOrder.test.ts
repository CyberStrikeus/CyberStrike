import { describe, expect, it } from "vitest";

import { orderByWholeLines } from "./environmentStateInitialOrder.js";
import type {
  ObservedEntity,
  StateObservation,
} from "./environmentStateMerge.js";

/** One sighting: a list line's entry at `index`, or an item read when `item`. */
const sighting = (
  ordinal: number,
  index: number,
  item = false,
): StateObservation => ({
  position: ordinal,
  index,
  ordinal,
  tool: item ? "get_books_by_id" : "get_books",
  item,
  object: {},
});

const entity = (id: string, ...observations: StateObservation[]) => ({
  type: "/api/books",
  collection: "/api/books",
  id,
  order: [observations[0]!.position, observations[0]!.index] as const,
  observations,
});

/** The entities' ids in initial order once the whole lines rank them, given each line's query. */
const ordered = (
  entities: ObservedEntity[],
  queries: Readonly<Record<number, string>>,
): string[] => {
  orderByWholeLines(entities, (ordinal) => queries[ordinal]);
  return entities
    .toSorted(
      (left, right) =>
        left.order[0] - right.order[0] || left.order[1] - right.order[1],
    )
    .map((candidate) => candidate.id);
};

describe("initial order from whole lines", () => {
  it("takes the first whole line that applies no sort, random or seed parameter", () => {
    const queries = {
      0: "random=true",
      1: "sort[]=name",
      2: "sort-column=name",
      3: "sortKey=name",
      4: "orderDirection=desc",
      5: "seed=7",
      6: "page=1",
    };
    const lines = Object.keys(queries).map(Number);
    // Every line lists both; the earlier ones apply an order of their own.
    const at = (first: string) =>
      lines.map((ordinal) =>
        sighting(ordinal, (ordinal === 6) === (first === "b") ? 0 : 1),
      );
    expect(
      ordered([entity("a", ...at("a")), entity("b", ...at("b"))], queries),
    ).toEqual(["b", "a"]);
  });

  it("does not take a line that lists part of the collection, or an item read", () => {
    const entities = [
      entity("a", sighting(0, 0, true), sighting(2, 1)),
      entity("b", sighting(1, 0), sighting(2, 2)),
      entity("c", sighting(2, 0)),
    ];
    expect(ordered(entities, { 1: "name=b" })).toEqual(["c", "a", "b"]);
  });

  it("keeps the earliest sightings of a collection no whole default line lists", () => {
    const entities = [
      entity("a", sighting(1, 0), sighting(2, 1)),
      entity("b", sighting(0, 0, true), sighting(2, 0)),
    ];
    expect(ordered(entities, { 1: "status=open", 2: "sort=name" })).toEqual([
      "b",
      "a",
    ]);
  });
});
