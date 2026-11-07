import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  BOOK_INIT_ROWS,
  BOOK_NOT_FOUND,
  BOTH_BOOKS_RENAMED_ROWS,
  FIRST_BOOK,
  SECOND_BOOK,
  bothBooksDeleted,
  environmentStateViewOf,
  renamedBook,
  type Book,
} from "../../../tests/fixtures/environmentStateWrites.js";

const planOf = (rows: readonly TimedCaptureRow[], tool: string) => {
  const plan = environmentStateViewOf(timedCaptureEvidence(rows)).writes.find(
    (candidate) => candidate.tool === tool,
  );
  if (plan === undefined) throw new Error(`No write plan for ${tool}`);
  return plan;
};

const RENAMED_AT_3 = renamedBook(FIRST_BOOK, "Renamed Book", 3);

/** A book with an `archived` flag, which an item action sets. */
const shelved = (entity: Book, archived: boolean) => ({ ...entity, archived });

const SHELVED_INIT_ROWS: readonly TimedCaptureRow[] = [
  [
    "GET",
    "/api/books",
    [shelved(FIRST_BOOK, false), shelved(SECOND_BOOK, false)],
  ],
  ["GET", "/api/books/1", shelved(FIRST_BOOK, false)],
  ["GET", "/api/books/2", shelved(SECOND_BOOK, false)],
];

describe("bulk writes at a collection", () => {
  it("serves a delete whose body names its rows, as the reads after it confirm", () => {
    expect(
      planOf(
        [
          ...BOOK_INIT_ROWS,
          ["DELETE", "/api/books", [{ id: 2 }], 200, [{ id: 2 }]],
          ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
          ["GET", "/api/books", [FIRST_BOOK]],
        ],
        "delete_books",
      ),
    ).toMatchObject({
      effect: "delete",
      target: "/api/books",
      served: true,
      address: { by: "elements", member: null },
      response: { ordinal: 3, shape: "entity", pointer: "/0" },
      checked_record_ordinals: [4, 5],
    });
  });

  it("updates each id a body's id array names with the members it shares", () => {
    expect(
      planOf(
        [
          ...BOOK_INIT_ROWS,
          ["PATCH", "/api/books", "", 204, { ids: [1], name: "Renamed Book" }],
          ["GET", "/api/books/1", RENAMED_AT_3],
          ["GET", "/api/books", [RENAMED_AT_3, SECOND_BOOK]],
        ],
        "patch_books",
      ),
    ).toMatchObject({
      effect: "update",
      target: "/api/books",
      served: true,
      address: { by: "ids", member: "ids" },
      observation: { ordinal: 4, pointer: "" },
      checked_record_ordinals: [5],
    });
  });

  it("serves no bulk call whose response names its ids in a form serving cannot render for others", () => {
    expect(
      planOf(
        [
          ...BOOK_INIT_ROWS,
          ["DELETE", "/api/books", { deleted: [2] }, 200, { ids: [2] }],
          ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
        ],
        "delete_books",
      ),
    ).toMatchObject({ served: false, reason: "body-unusable" });
  });
  it("models no bulk call sent with another query than the exemplar's, which may do something else", () => {
    // A delete sent with force=false kept book 1, which a modelled delete would have removed.
    expect(
      planOf(
        [
          ...BOOK_INIT_ROWS,
          ["DELETE", "/api/books?force=true", [{ id: 2 }], 200, [{ id: 2 }]],
          ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
          ["DELETE", "/api/books?force=false", [{ id: 1 }], 200, [{ id: 1 }]],
          ["GET", "/api/books/1", FIRST_BOOK],
        ],
        "delete_books",
      ),
    ).toMatchObject({ served: true, checked_record_ordinals: [4] });
  });

  it("serves no bulk call whose recorded response counts the entities it wrote", () => {
    expect(
      planOf(
        [
          ...BOOK_INIT_ROWS,
          ["DELETE", "/api/books", { deleted: 1 }, 200, { ids: [2] }],
          ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
        ],
        "delete_books",
      ),
    ).toMatchObject({ served: false, reason: "body-unusable" });
  });
});

describe("bulk responses listing each written entity", () => {
  it("serves a delete answering one element per row it names", () => {
    expect(
      planOf(
        bothBooksDeleted([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }]),
        "delete_books",
      ),
    ).toMatchObject({
      served: true,
      response: { ordinal: 3, shape: "entity", pointer: "/0" },
      checked_record_ordinals: [4, 5, 6],
    });
  });

  it("serves a delete answering the ids it named", () => {
    expect(planOf(bothBooksDeleted([1, 2]), "delete_books")).toMatchObject({
      served: true,
      response: { ordinal: 3, shape: "identity", pointer: "/0" },
    });
  });

  it("serves an update answering every entity it wrote", () => {
    expect(planOf(BOTH_BOOKS_RENAMED_ROWS, "patch_books")).toMatchObject({
      served: true,
      response: { ordinal: 3, shape: "entity", pointer: "/0" },
    });
  });

  it("serves no bulk call whose response lists its entities in an order or form serving does not render", () => {
    for (const response of [
      [{ id: 2 }, { id: 1 }],
      [{ id: 1, name: "First Book" }, { id: 2 }],
      [{ id: 1 }, { id: 2, deleted: true }],
      [{ id: 1 }, { id: 3, parent: 2 }],
      [1, "2"],
      [{ book: { id: 1 } }, { book: { id: 2 } }],
      { data: [{ id: 1 }, { id: 2 }] },
    ])
      expect(planOf(bothBooksDeleted(response), "delete_books")).toMatchObject({
        served: false,
        reason: "body-unusable",
      });
  });
});

describe("item actions", () => {
  const ARCHIVED = shelved(FIRST_BOOK, true);

  it("serves an action once a call shows it sets, not toggles, what it changed", () => {
    expect(
      planOf(
        [
          ...SHELVED_INIT_ROWS,
          ["POST", "/api/books/1/archive", ARCHIVED],
          ["GET", "/api/books/1", ARCHIVED],
          ["POST", "/api/books/1/archive", ARCHIVED],
          ["GET", "/api/books/1", ARCHIVED],
        ],
        "post_books_archive_by_id",
      ),
    ).toMatchObject({
      effect: "update",
      target: "/api/books",
      served: true,
      address: { by: "action", segment: "archive" },
      rules: [{ field: "archived", rule: "set", value: true }],
      // The second call finds the book archived already, so the read after it shows nothing of it.
      checked_record_ordinals: [4],
    });
  });

  it("serves no action seen changing its field only once, which may toggle it", () => {
    expect(
      planOf(
        [
          ...SHELVED_INIT_ROWS,
          ["POST", "/api/books/1/star", ARCHIVED],
          ["GET", "/api/books/1", ARCHIVED],
          ["POST", "/api/books/1/star", "", 204],
          ["GET", "/api/books", [shelved(SECOND_BOOK, false)]],
        ],
        "post_books_star_by_id",
      ),
    ).toMatchObject({ served: false, reason: "unconfirmed" });
  });

  it("serves no action that only stamps a time, as a refresh does", () => {
    const refreshed = { ...FIRST_BOOK, updated_at: "2026-10-17T18:00:03Z" };
    expect(
      planOf(
        [
          ...BOOK_INIT_ROWS,
          ["POST", "/api/books/1/publish", refreshed],
          ["GET", "/api/books/1", refreshed],
        ],
        "post_books_publish_by_id",
      ),
    ).toMatchObject({ served: false });
  });

  it("refuses an action whose call changed a nested object, which another write denormalised", () => {
    const shelf = (name: string) => ({
      ...shelved(FIRST_BOOK, false),
      shelf: { id: 4, name },
    });
    expect(
      planOf(
        [
          ["GET", "/api/books", [shelf("Old"), shelved(SECOND_BOOK, false)]],
          ["GET", "/api/books/1", shelf("Old")],
          ["GET", "/api/books/2", shelved(SECOND_BOOK, false)],
          ["POST", "/api/books/1/archive", { ...shelf("New"), archived: true }],
          ["GET", "/api/books/1", { ...shelf("New"), archived: true }],
        ],
        "post_books_archive_by_id",
      ),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
  });

  it("takes a POST answering another entity, a 201 or one sharing the path's id, for a sub-resource", () => {
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      [
        "POST",
        "/api/books/1/comments",
        { id: 1, text: "Nice" },
        201,
        {
          text: "Nice",
        },
      ],
      [
        "POST",
        "/api/books/1/notes",
        { id: 1, text: "Kept" },
        200,
        {
          text: "Kept",
        },
      ],
    ];
    expect(planOf(rows, "post_books_comments_by_id")).toMatchObject({
      effect: "none",
      reason: "no-state-target",
    });
    expect(planOf(rows, "post_books_notes_by_id")).toMatchObject({
      effect: "none",
      reason: "no-state-target",
    });
  });

  it("leaves an action unmodelled where another write to the entity still awaits the read after it", () => {
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["PATCH", "/api/books/1", RENAMED_AT_3, 200, { name: "Renamed Book" }],
      ["POST", "/api/books/1/publish", "", 204],
      ["GET", "/api/books/1", RENAMED_AT_3],
    ];
    expect(planOf(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
    expect(planOf(rows, "post_books_publish_by_id")).toMatchObject({
      effect: "update",
      served: false,
      reason: "no-observation",
    });
  });
});
