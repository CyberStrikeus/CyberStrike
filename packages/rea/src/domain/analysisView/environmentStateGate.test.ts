import { describe, expect, it } from "vitest";
import {
  checkItemPlan,
  type StateGateContext,
} from "./environmentStateGate.js";
import type {
  JsonObject,
  StateEntity,
  StateRecordFacts,
} from "./environmentStateRules.js";

/** Exercise the production gate's retention contract independently of capture/body allocation. */
const check = (
  clocks: readonly (readonly [string, string])[],
  limit = Infinity,
) => {
  let bytes = 0;
  const records: StateRecordFacts[] = clocks.map((_, ordinal) => ({
    ordinal,
    method: "GET",
    path: `/api/books/${ordinal + 1}`,
    query: undefined,
    status: 200,
    timing: { start: undefined, endMs: undefined },
  }));
  const bodies: JsonObject[] = clocks.map(([, stamp], index) => ({
    id: index + 1,
    stamp,
  }));
  const entities: StateEntity[] = clocks.map(([stamp], index) => ({
    type: "/api/books",
    collection: "/api/books",
    id: String(index + 1),
    fields: { id: index + 1, stamp },
    view_fields: [
      { tool: "get_books_by_id", fields: { stamp: clocks[index]![1] } },
    ],
    record_ordinals: [index],
  }));
  const context: StateGateContext = {
    withBody: (ordinal, use) => use(bodies[ordinal]),
    retain: (amount) => {
      bytes += amount;
      if (bytes > limit) throw new Error("gate budget exhausted");
    },
    entity: (_type, _collection, id) => entities[Number(id) - 1],
    inCollection: () => entities,
    volatileOf: () => new Set(),
    idField: () => "id",
    minted: new Map(),
  };
  const view = checkItemPlan(context, {
    tool: {
      name: "get_books_by_id",
      method: "GET",
      path_template: "/api/books/{id}",
      record_ordinals: records.map((r) => r.ordinal),
    },
    item: true,
    type: "/api/books",
    pointer: "",
    recordings: records,
    latest: records,
  });
  return { view, bytes };
};

describe("clock spelling facts at the read gate", () => {
  it.each([
    ["2026-10-21T17:06:13.123456Z", "2026-10-21T17:06:13.123789+00:00"],
    ["2026-10-21T17:06:13.123456789Z", "2026-10-21T17:06:13.123456788+00:00"],
  ])(
    "does not learn a spelling from distinct sub-millisecond instants (%s)",
    (stored, shown) => {
      expect(check([[stored, shown]]).view).not.toHaveProperty("clock_formats");
    },
  );

  it("learns matching nanosecond instants across offsets and trailing zeros", () => {
    expect(
      check([
        ["2026-10-21T17:06:13.123456Z", "2026-10-21T19:06:13.123456000+02:00"],
      ]).view,
    ).toMatchObject({
      clock_formats: { stamp: { kind: "iso", fraction: 9, zone: "+02:00" } },
    });
  });

  it("charges clock facts and their output before they escape a tight gate budget", () => {
    const baseline = check([["not a clock", "not a clock"]]).bytes;
    const clocks = [
      ["2026-10-21T17:06:13Z", "2026-10-21T17:06:13+00:00"],
    ] as const;
    expect(() => check(clocks, baseline)).toThrow("gate budget exhausted");
    expect(check(clocks).bytes).toBeGreaterThan(baseline);
    const unmatched = check([[clocks[0][0], "2026-10-20T17:06:13+00:00"]]);
    expect(check(clocks).bytes).toBeGreaterThan(unmatched.bytes);
    expect(() => check(clocks, unmatched.bytes)).toThrow(
      "gate budget exhausted",
    );
  });

  it("keeps only a mixed marker after incompatible other-instant formats", () => {
    const clocks = (count: number) =>
      Array.from(
        { length: count },
        (_, index) =>
          [
            "2026-10-21T17:06:13Z",
            `2026-10-20T17:06:13+${String(Math.floor(index / 60) % 24).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`,
          ] as const,
      );
    const small = check(clocks(4));
    const large = check(clocks(1024));
    expect(large.view).not.toHaveProperty("clock_formats");
    expect(large.bytes).toBe(small.bytes);
  });
});
