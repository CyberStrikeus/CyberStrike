import { describe, expect, it } from "vitest";

import type { JsonValue } from "../jsonValue.js";
import type { StateEntity } from "./environmentStateRules.js";
import { sortableFields } from "./environmentStateWriteSorted.js";

const VIEW = { tool: "get_books", fields: ["id", "tags"] };

/** Books whose `tags` hold these values, as the initial state does. */
const books = (...values: JsonValue[]): StateEntity[] =>
  values.map((tags, index) => ({
    type: "/api/books",
    collection: "/api/books",
    id: String(index + 1),
    fields: { id: index + 1, tags },
    view_fields: [],
    record_ordinals: [],
  }));

describe("array fields a view could list sorted", () => {
  it("offers a field every entity shows as a sorted string array or null, one with two distinct values", () => {
    expect(
      sortableFields(VIEW, books(["alpha", "beta"], null, ["gamma"])),
    ).toEqual(["tags"]);
  });

  it.each([
    ["an unsorted array", [["beta", "alpha"], ["gamma"]]],
    [
      "mixed types",
      [
        ["alpha", 3],
        ["beta", "gamma"],
      ],
    ],
    ["arrays of objects", [[{ name: "alpha" }, { name: "beta" }]]],
    ["no two distinct values", [["alpha"], ["beta", "beta"]]],
    ["a value that is no array", [["alpha", "beta"], "gamma"]],
  ])("offers none for %s", (_, values) => {
    expect(sortableFields(VIEW, books(...(values as JsonValue[])))).toEqual([]);
  });
});
