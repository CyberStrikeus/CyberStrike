import { describe, expect, it } from "vitest";

import {
  ADDED_EMPTY_REFERENCE_ROWS,
  BOOKMARK_TOGGLE_ROWS,
  ITEM_LOCATIONS,
  ITEM_REFERENCES_ROWS,
  ITEM_TAGS,
} from "../../../tests/fixtures/environmentStateItemWrites.js";
import { FILED_ROWS } from "../../../tests/fixtures/environmentStateDerivedValues.js";
import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";

describe("served item writes", () => {
  it("answers a create with the parent and tags its ids name, in the order sent", () => {
    const items = servedFrom(ITEM_REFERENCES_ROWS);
    const body = items.answer("post_items", {
      body: {
        name: "Snow shovel",
        parentId: ITEM_LOCATIONS[0]!["id"]!,
        tagIds: [ITEM_TAGS[1]!["id"]!, ITEM_TAGS[0]!["id"]!],
      },
    }).body;
    expect(body).toMatchObject({
      name: "Snow shovel",
      parent: ITEM_LOCATIONS[0],
      tags: [ITEM_TAGS[1], ITEM_TAGS[0]],
    });
  });

  it("answers a create naming no parent and no tags with none", () => {
    const items = servedFrom(ITEM_REFERENCES_ROWS);
    expect(
      items.answer("post_items", { body: { name: "Spare fuse" } }).body,
    ).toMatchObject({
      name: "Spare fuse",
      parent: null,
      tags: [],
    });
  });

  it("answers a create sending no parent and no tags as a recorded create sent them", () => {
    const items = servedFrom(ITEM_REFERENCES_ROWS);
    expect(
      items.answer("post_items", {
        body: { name: "Spare fuse", parentId: null, tagIds: [] },
      }).body,
    ).toMatchObject({ name: "Spare fuse", parent: null, tags: [] });
  });

  it("answers a create leaving out a parent the first create left out with none, and one sending null with null", () => {
    const items = servedFrom(ADDED_EMPTY_REFERENCE_ROWS);
    const left = items.answer("post_items", { body: { name: "Spare fuse" } })
      .body as Record<string, unknown>;
    expect(left).toMatchObject({ name: "Spare fuse" });
    expect(Object.hasOwn(left, "parent")).toBe(false);
    expect(
      items.answer("post_items", {
        body: { name: "Spare bulb", parentId: null },
      }).body,
    ).toMatchObject({ name: "Spare bulb", parent: null });
    expect(
      items.answer("post_items", {
        body: { name: "Spare cord", parentId: ITEM_LOCATIONS[0]!["id"]! },
      }).body,
    ).toMatchObject({ name: "Spare cord", parent: ITEM_LOCATIONS[0] });
  });

  it("refuses a create naming no shelf when every recorded create named one", () => {
    const books = servedFrom(FILED_ROWS);
    expect(
      books.refusal("post_books", { body: { name: "Loose", shelf_id: null } }),
    ).toMatchObject({ message: expect.stringContaining("shelf_id") });
  });

  it("refuses a create naming a tag the environment does not hold", () => {
    const items = servedFrom(ITEM_REFERENCES_ROWS);
    expect(
      items.refusal("post_items", {
        body: {
          name: "Mystery",
          tagIds: ["3b9f2a10-0009-4000-8000-000000000009"],
        },
      }),
    ).toMatchObject({ message: expect.stringContaining("tagIds") });
  });

  it("flips an entry's flag on each body-less call", () => {
    const entries = servedFrom(BOOKMARK_TOGGLE_ROWS);
    const starred = () =>
      (
        entries.answer("get_entries_by_id", { id: "2" }).body as {
          starred: boolean;
        }
      ).starred;
    expect(starred()).toBe(false);
    entries.answer("put_entries_bookmark_by_id", { id: "2" });
    expect(starred()).toBe(true);
    entries.answer("put_entries_bookmark_by_id", { id: "2" });
    expect(starred()).toBe(false);
  });
});
