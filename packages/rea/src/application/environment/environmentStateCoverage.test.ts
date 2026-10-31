import { describe, expect, it } from "vitest";
import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";
import type { TimedCaptureRow } from "../../../tests/fixtures/analysisView.js";

const first = { id: 1, name: "First", detail: "seeded" };
const second = { id: 2, name: "Second", detail: "seeded" };
const initial: readonly TimedCaptureRow[] = [
  ["GET", "/api/books", [first, second]],
  ["GET", "/api/books/1", first],
  ["GET", "/api/books/2", second],
];

describe("projection and omission coverage across writes", () => {
  it("records a late identity-free projection without seeding its values into initial state", () => {
    const renamed = { ...first, name: "Renamed" };
    const books = servedFrom([
      ...initial,
      ["PATCH", "/api/books/1", renamed, 200, { name: "Renamed" }],
      ["GET", "/api/books/1", renamed],
      ["GET", "/api/books/1?fields=name", { name: "Renamed" }],
    ]);
    expect(books.store.state.views.get("get_books_by_id")).toMatchObject({
      shape: "item",
      checked_record_ordinals: [1, 2],
      projected_record_ordinals: [5],
    });
    expect(
      books.store
        .snapshot()
        .rea_state.entities.find((entity) => entity.id === "1")?.fields.name,
    ).toBe("First");
    books.answer("patch_books_by_id", { id: "1", body: { name: "Changed" } });
    expect(
      books.answer("get_books_by_id", { id: "1", fields: "name" }),
    ).toMatchObject({
      body: { name: "Renamed" },
      replay: { record_ordinal: 5 },
      state: { source: "recording", reason: "projection" },
    });
  });

  it("uses established omissions when a full projection is the only update observation", () => {
    const third = { id: 3, name: "Third" };
    const books = servedFrom([
      ...initial,
      ["POST", "/api/books", third, 201, { name: "Third" }],
      ["GET", "/api/books/3", third],
      [
        "PATCH",
        "/api/books/3",
        { ...third, name: "Renamed" },
        200,
        { name: "Renamed" },
      ],
      ["GET", "/api/books/3?fields=*", { ...third, name: "Renamed" }],
    ]);
    expect(books.store.state.writes.get("patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [6],
    });
    expect(books.store.state.views.get("get_books_by_id")).not.toMatchObject({
      required_fields: expect.arrayContaining(["detail"]),
    });
    books.answer("post_books", { body: { name: "New" } });
    books.answer("patch_books_by_id", { id: "3", body: { name: "Changed" } });
    expect(
      books.answer("get_books_by_id", { id: "3", fields: "*" }),
    ).toMatchObject({
      body: { id: 3, name: "Changed" },
      state: { source: "state" },
    });
  });

  it("uses established omissions when observing a later bodiless update through a full projection", () => {
    const third = { id: 3, name: "Third" };
    const renamed = { ...third, name: "Renamed" };
    const again = { ...third, name: "Again" };
    const books = servedFrom([
      ...initial,
      ["POST", "/api/books", third, 201, { name: "Third" }],
      ["GET", "/api/books/3", third],
      ["PATCH", "/api/books/3", renamed, 200, { name: "Renamed" }],
      ["GET", "/api/books/3", renamed],
      ["PATCH", "/api/books/3", "", 204, { name: "Again" }],
      ["GET", "/api/books/3?fields=*", again],
      ["GET", "/api/books", [first, second, again]],
    ]);
    expect(books.store.state.writes.get("patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [6, 9],
    });
  });

  it("does not hide an absence contradicting a confirmed update behind a projection", () => {
    const renamed = { ...first, name: "Renamed" };
    const books = servedFrom([
      ...initial,
      ["GET", "/api/books/2?fields=name", { name: "Second" }],
      ["PATCH", "/api/books/1", renamed, 200, { name: "Renamed" }],
      ["GET", "/api/books/1", renamed],
      [
        "PATCH",
        "/api/books/1",
        { ...first, name: "Again" },
        200,
        { name: "Again" },
      ],
      ["GET", "/api/books/1?fields=name", { detail: "Not found." }, 404],
    ]);
    expect(books.store.state.writes.get("patch_books_by_id")).toMatchObject({
      served: false,
    });
  });

  it("confirms a delete through a projected absence without needing a body", () => {
    const books = servedFrom([
      ...initial,
      ["GET", "/api/books/2?fields=name", { name: "Second" }],
      ["DELETE", "/api/books/1", "", 204],
      ["GET", "/api/books/1?fields=name", { detail: "Not found." }, 404],
    ]);
    expect(books.store.state.writes.get("delete_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });
});
