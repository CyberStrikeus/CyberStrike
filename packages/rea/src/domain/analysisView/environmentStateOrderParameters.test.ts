import { describe, expect, it } from "vitest";

import {
  appliesOrder,
  directionOf,
  namesDirection,
  orderRole,
} from "./environmentStateOrderParameters.js";

describe("parameters that ask for an order", () => {
  it.each([
    "sort",
    "sort[]",
    "sort[0][field]",
    "sorters[0][field]",
    "_sort",
    "_order",
    "sort-column",
    "sort-direction",
    "sortKey",
    "sortDirection",
    "orderBy",
    "order_direction",
    "ordering",
    "dir",
    "reverse",
  ])("reads %s as asking for an order", (name) => {
    expect(appliesOrder(name)).toBe(true);
  });

  it.each(["order_id", "orderNumber", "sorted", "status", "q", "reversed"])(
    "reads %s as asking for none",
    (name) => {
      expect(appliesOrder(name)).toBe(false);
    },
  );
});

describe("directions", () => {
  it.each([
    "dir",
    "sortDirection",
    "sort-direction",
    "order_direction",
    "sort_order",
    "reverse",
    "_order",
  ])("reads %s as naming only a direction", (name) => {
    expect(namesDirection(name)).toBe(true);
  });

  it.each(["order", "sort", "_sort", "sortKey", "orderBy"])(
    "reads %s as naming a sort field",
    (name) => {
      expect(namesDirection(name)).toBe(false);
    },
  );

  it("takes json-server's `_order` as a direction only, and `order` given a field as the sort", () => {
    expect([
      orderRole("_order", "DESC"),
      orderRole("_order", "title"),
      orderRole("order", "title"),
      orderRole("order", "asc"),
    ]).toEqual(["direction", undefined, "sort", "direction"]);
  });

  it("reads a direction in short or long spelling", () => {
    expect(
      ["ASC", "descending", "Ascending", "newest"].map(directionOf),
    ).toEqual(["asc", "desc", "asc", undefined]);
  });
});
