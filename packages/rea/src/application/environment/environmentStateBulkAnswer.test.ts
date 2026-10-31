import { describe, expect, it } from "vitest";

import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";
import type { TimedCaptureRow } from "../../../tests/fixtures/analysisView.js";
import {
  BOOK_INIT_ROWS,
  BOOK_NOT_FOUND,
  BOTH_BOOKS_RENAMED_ROWS,
  FIRST_BOOK,
  SECOND_BOOK,
  bothBooksDeleted,
  renamedBook,
  type Book,
} from "../../../tests/fixtures/environmentStateWrites.js";
import { servedCatalog } from "./environmentState.js";

const BULK_DELETE_ROWS: readonly TimedCaptureRow[] = [
  ...BOOK_INIT_ROWS,
  ["DELETE", "/api/books", [{ id: 2 }], 200, [{ id: 2 }]],
  ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
  ["GET", "/api/books", [FIRST_BOOK]],
];

const RENAMED_AT_3 = renamedBook(FIRST_BOOK, "Renamed Book", 3);

/** A bulk rename of the books an id array names, which the list after it confirms. */
const BULK_RENAME_ROWS: readonly TimedCaptureRow[] = [
  ...BOOK_INIT_ROWS,
  ["PATCH", "/api/books", "", 204, { ids: [1], name: "Renamed Book" }],
  ["GET", "/api/books/1", RENAMED_AT_3],
  ["GET", "/api/books", [RENAMED_AT_3, SECOND_BOOK]],
];

const DELETED_READS: TimedCaptureRow[] = [
  ["GET", "/api/books/1", BOOK_NOT_FOUND, 404],
  ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
  ["GET", "/api/books", []],
];

describe("bulk response records and rendering", () => {
  it.each([1, 2])(
    "serves a multi-entity delete recording for %s caller targets",
    (count) => {
      const books = servedFrom([
        ...BOOK_INIT_ROWS,
        [
          "DELETE",
          "/api/books",
          [{ id: 1 }, { id: 2 }],
          200,
          [{ id: 1 }, { id: 2 }],
        ],
        ...DELETED_READS,
      ]);
      expect(books.state.writes.get("delete_books")).toMatchObject({
        served: true,
        response: { shape: "entity", pointer: "/0" },
      });
      const body = count === 1 ? [{ id: 2 }] : [{ id: 1 }, { id: 2 }];
      expect(books.answer("delete_books", { body })).toMatchObject({
        body,
        state: { view: "delete" },
      });
      expect(
        books.store.ofType("/api/books").map((entity) => entity.id),
      ).toEqual(count === 1 ? ["1"] : []);
    },
  );

  it("serves multiple returned identities with their recorded scalar kind", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      ["DELETE", "/api/books", [1, 2], 200, { ids: [1, 2] }],
      ...DELETED_READS,
    ]);
    expect(books.state.writes.get("delete_books")).toMatchObject({
      served: true,
      response: { shape: "identity", pointer: "/0" },
    });
    expect(books.answer("delete_books", { body: { ids: [2] } }).body).toEqual([
      2,
    ]);
  });

  it("updates each returned entity without copying the first entity's fields to the others", () => {
    const renamed = [
      renamedBook(FIRST_BOOK, "Recorded", 3),
      renamedBook(SECOND_BOOK, "Recorded", 3),
    ];
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      ["PATCH", "/api/books", renamed, 200, { ids: [1, 2], name: "Recorded" }],
      ["GET", "/api/books/1", renamed[0]!],
      ["GET", "/api/books/2", renamed[1]!],
      ["GET", "/api/books", renamed],
    ]);
    expect(books.state.writes.get("patch_books")).toMatchObject({
      served: true,
    });
    expect(
      books.answer("patch_books", { body: { ids: [1, 2], name: "Changed" } })
        .body,
    ).toMatchObject([
      { id: 1, name: "Changed", created_at: FIRST_BOOK.created_at },
      { id: 2, name: "Changed", created_at: SECOND_BOOK.created_at },
    ]);
    expect(books.answer("get_books_by_id", { id: "2" }).body).toMatchObject({
      id: 2,
      name: "Changed",
    });
  });
});

describe("bulk response proof and refusals", () => {
  it("withholds delete responses whose values differ from the held entities", () => {
    const held = [FIRST_BOOK, SECOND_BOOK].map((entry) => ({
      ...entry,
      deleted: false,
    }));
    const books = servedFrom([
      ["GET", "/api/books", held],
      ["GET", "/api/books/1", held[0]!],
      ["GET", "/api/books/2", held[1]!],
      [
        "DELETE",
        "/api/books",
        held.map((entry) => ({ ...entry, deleted: true })),
        200,
        { ids: [1, 2] },
      ],
      ...DELETED_READS,
    ]);
    expect(books.state.writes.get("delete_books")).toMatchObject({
      served: false,
      reason: "body-unusable",
    });
  });

  it("withholds an unparsed acknowledgement instead of treating unknown contents as absent", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      [
        "DELETE",
        "/api/books",
        "unparsed acknowledgement",
        200,
        { ids: [1, 2] },
      ],
      ...DELETED_READS,
    ]);
    expect(books.state.writes.get("delete_books")).toMatchObject({
      served: false,
      reason: "body-unusable",
    });
  });

  it("serves a recorded acknowledgement that names and counts no targets", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      ["DELETE", "/api/books", { ok: true }, 200, { ids: [1, 2] }],
      ...DELETED_READS,
    ]);
    expect(books.state.writes.get("delete_books")).toMatchObject({
      served: true,
    });
    expect(books.answer("delete_books", { body: { ids: [2] } }).body).toEqual({
      ok: true,
    });
    expect(books.store.ofType("/api/books").map((entity) => entity.id)).toEqual(
      ["1"],
    );
  });

  it.each([
    { response: [{ id: 2 }, { id: 1 }] },
    { response: [{ id: 1 }, { id: 2, name: "Second" }] },
  ])(
    "withholds a response the shared first-element renderer cannot reproduce: %j",
    ({ response }) => {
      const books = servedFrom([
        ...BOOK_INIT_ROWS,
        ["DELETE", "/api/books", response, 200, [{ id: 1 }, { id: 2 }]],
        ...DELETED_READS,
      ]);
      expect(books.state.writes.get("delete_books")).toMatchObject({
        served: false,
        reason: "body-unusable",
      });
    },
  );

  it("withholds a tool whose later response changes its modelled shape", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      ["DELETE", "/api/books", [{ id: 2 }], 200, [{ id: 2 }]],
      ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
      ["GET", "/api/books", [FIRST_BOOK]],
      ["DELETE", "/api/books", { ok: true }, 200, [{ id: 1 }]],
      ["GET", "/api/books/1", BOOK_NOT_FOUND, 404],
      ["GET", "/api/books", []],
    ]);
    expect(books.state.writes.get("delete_books")).toMatchObject({
      served: false,
      reason: "body-unusable",
    });
  });
});

/** A book with an `archived` flag, which an item action sets. */
const shelved = (entity: Book, archived: boolean) => ({ ...entity, archived });

describe("served bulk writes", () => {
  it("deletes every row a call names, answering one element per row", () => {
    const books = servedFrom(BULK_DELETE_ROWS);
    expect(
      books.answer("delete_books", { body: [{ id: 1 }, { id: 2 }] }),
    ).toMatchObject({
      status: 200,
      body: [{ id: 1 }, { id: 2 }],
      state: {
        source: "state",
        view: "delete",
        type: "/api/books",
        ids: ["1", "2"],
      },
    });
    expect(books.store.ofType("/api/books")).toEqual([]);
  });

  it("refuses a call naming a row the state does not hold, leaving the state unchanged", () => {
    const books = servedFrom(BULK_DELETE_ROWS);
    const before = books.snapshot();
    expect(
      books.refusal("delete_books", { body: [{ id: 1 }, { id: 9 }] }),
    ).toMatchObject({
      message: expect.stringContaining("holds no /api/books entity 9"),
    });
    expect(books.snapshot()).toBe(before);
  });

  it("advertises the body a bulk delete takes as the array its recording sent", () => {
    const books = servedFrom(BULK_DELETE_ROWS);
    const catalog = servedCatalog(books.source, books.state, "books");
    if (!catalog.ok) throw catalog.error;
    const tool = catalog.value.tools.find(
      (definition) => definition.name === "delete_books",
    );
    expect(tool?.inputSchema.properties["body"]).toMatchObject({
      type: "array",
      items: { type: "object" },
    });
  });
});

describe("served bulk write queries and capacity", () => {
  it("applies a bulk delete's recorded query when a call leaves it out, and refuses another", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      ["DELETE", "/api/books?force=true", [{ id: 2 }], 200, [{ id: 2 }]],
      ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
      ["GET", "/api/books", [FIRST_BOOK]],
    ]);
    const before = books.snapshot();
    expect(
      books.refusal("delete_books", { force: "false", body: [{ id: 1 }] })
        .message,
    ).toContain("takes only the query its recording sent (force=true)");
    expect(books.snapshot()).toBe(before);
    expect(books.answer("delete_books", { body: [{ id: 1 }] })).toMatchObject({
      status: 200,
      body: [{ id: 1 }],
    });
    expect(books.store.ofType("/api/books").map((book) => book.id)).toEqual([
      "2",
    ]);
  });

  it("refuses a bulk update the state cannot hold, leaving every entity as it was", () => {
    const books = servedFrom(BULK_RENAME_ROWS);
    const before = books.snapshot();
    // Each renamed book grows by twice the name, slug included; two of them pass the intake limit, one does not.
    const name = "x".repeat(9 * 1024 * 1024);
    expect(
      books.refusal("patch_books", { body: { ids: [1, 2], name } }),
    ).toMatchObject({ code: "resource_constraint" });
    expect(books.snapshot()).toBe(before);
  });
});

describe("served bulk write targets", () => {
  it.each(["part/one", "%31", "A\uD800"])(
    "resolves a literal JSON body identity without turning it into a URL: %j",
    (id) => {
      const unusual = { ...SECOND_BOOK, id };
      const books = servedFrom([
        ["GET", "/api/books", [FIRST_BOOK, unusual]],
        ["GET", "/api/books/1", FIRST_BOOK],
        ["DELETE", "/api/books", "", 204, { ids: [id] }],
        ["GET", "/api/books", [FIRST_BOOK]],
      ]);
      expect(books.state.writes.get("delete_books")).toMatchObject({
        served: true,
      });
      expect(
        books.answer("delete_books", { body: { ids: [id] } }),
      ).toMatchObject({ state: { ids: [id] } });
      expect(
        books.store.ofType("/api/books").map((entity) => entity.id),
      ).toEqual(["1"]);
    },
  );

  it.each(["number", "string"] as const)(
    "refuses ids whose JSON kind differs from the recorded %s array, without changing state",
    (kind) => {
      const books = servedFrom([
        ...BOOK_INIT_ROWS,
        [
          "PATCH",
          "/api/books",
          "",
          204,
          { ids: [kind === "number" ? 1 : "1"], name: "Renamed Book" },
        ],
        ["GET", "/api/books/1", RENAMED_AT_3],
        ["GET", "/api/books", [RENAMED_AT_3, SECOND_BOOK]],
      ]);
      const before = books.snapshot();
      expect(
        books.call("patch_books", {
          body: { ids: [kind === "number" ? "1" : 1], name: "Changed" },
        }).ok,
      ).toBe(false);
      expect(books.snapshot()).toBe(before);
      expect(
        books.call("patch_books", {
          body: { ids: [kind === "number" ? 1 : "1"], name: "Changed" },
        }).ok,
      ).toBe(true);
      expect(books.answer("get_books_by_id", { id: "1" }).body).toMatchObject({
        name: "Changed",
      });
    },
  );

  it("takes a body's ids as written, refusing one that only decodes to a held id", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      ["PATCH", "/api/books", "", 204, { ids: ["1"], name: "Renamed Book" }],
      ["GET", "/api/books/1", RENAMED_AT_3],
      ["GET", "/api/books", [RENAMED_AT_3, SECOND_BOOK]],
    ]);
    const before = books.snapshot();
    expect(
      books.refusal("patch_books", { body: { ids: ["1", "%31"], name: "B" } }),
    ).toMatchObject({
      message: expect.stringContaining("holds no /api/books entity %31"),
    });
    expect(books.snapshot()).toBe(before);
  });

  it("keeps the size data/get writes when one replacement names an entity twice", () => {
    const { store } = servedFrom(BULK_RENAME_ROWS);
    const held = store.ofType("/api/books")[0]!;
    const renamed = (name: string) => ({
      ...held,
      fields: { ...held.fields, name },
    });
    const updated = store.updateAll([renamed("A"), renamed("B")]);
    expect(updated.ok).toBe(true);
    expect(store.byteLength()).toBe(
      Buffer.byteLength(JSON.stringify(store.snapshot()), "utf8"),
    );
  });
});

describe("served bulk writes whose recordings answered every entity", () => {
  it("answers an update with each entity it wrote, in the call's order", () => {
    const books = servedFrom(BOTH_BOOKS_RENAMED_ROWS);
    const answer = books.answer("patch_books", {
      body: { ids: [2, 1], name: "Other Book" },
    });
    expect(answer).toMatchObject({
      body: [
        { id: 2, name: "Other Book", slug: "other-book" },
        { id: 1, name: "Other Book", slug: "other-book" },
      ],
      state: { source: "state", view: "update", ids: ["2", "1"] },
    });
    expect(answer.body).toEqual(
      ["2", "1"].map((id) => books.answer("get_books_by_id", { id }).body),
    );
  });

  it("answers a delete with the rows or ids it names, never the recorded ones", () => {
    const rows = servedFrom(
      bothBooksDeleted([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }]),
    );
    expect(rows.answer("delete_books", { body: [{ id: 2 }] }).body).toEqual([
      { id: 2 },
    ]);
    expect(rows.store.ofType("/api/books").map((entry) => entry.id)).toEqual([
      "1",
    ]);
    const ids = servedFrom(bothBooksDeleted([1, 2], { ids: [1, 2] }));
    expect(ids.answer("delete_books", { body: { ids: [2] } }).body).toEqual([
      2,
    ]);
  });
});

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A book holding child rows, which an update gives fresh ids. */
const withRows = (id: number, name: string, row: number) => ({
  id,
  name,
  rows: [{ id: uuid(row) }],
});

/** A card whose edit info an update restamps. */
const card = (id: number, name: string, at: string | null) => ({
  id,
  name,
  edit: at === null ? null : { at, by: "rea" },
});
const EDITED_AT = "2026-10-01T09:00:00.000Z";
const CARDS = [
  card(1, "One", EDITED_AT),
  card(2, "Two", EDITED_AT),
  card(3, "Three", null),
];
/** The first card as the bulk update recorded at exchange 4 stored it. */
const EDITED_CARD = card(
  1,
  "Edited",
  new Date(Date.parse("2026-10-17T18:00:04.000Z") + 53).toISOString(),
);

describe("served bulk updates of what each entity holds", () => {
  it("renews the child rows the written entity holds", () => {
    const books = servedFrom([
      ["GET", "/api/books", [withRows(1, "One", 1), withRows(2, "Two", 2)]],
      ["GET", "/api/books/1", withRows(1, "One", 1)],
      ["GET", "/api/books/2", withRows(2, "Two", 2)],
      ["PATCH", "/api/books", "", 204, { ids: [1], name: "After" }],
      ["GET", "/api/books/1", withRows(1, "After", 3)],
      ["GET", "/api/books", [withRows(1, "After", 3), withRows(2, "Two", 2)]],
    ]);
    expect(books.state.writes.get("patch_books")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        expect.objectContaining({ field: "rows", rule: "renewed" }),
      ]),
    });
    books.answer("patch_books", { body: { ids: [2], name: "Changed" } });
    const rows = (
      books.answer("get_books_by_id", { id: "2" }).body as {
        rows: { id: string }[] | null;
      }
    ).rows;
    expect(rows).toEqual([{ id: expect.any(String) }]);
    expect(rows![0]!.id).not.toBe(uuid(2));
  });

  it("restamps the nested clock each entity holds, refusing one holding no object", () => {
    const cards = servedFrom([
      ["GET", "/api/cards", CARDS],
      ...CARDS.map((entry): TimedCaptureRow => [
        "GET",
        `/api/cards/${String(entry.id)}`,
        entry,
      ]),
      ["PATCH", "/api/cards", "", 204, { ids: [1], name: "Edited" }],
      ["GET", "/api/cards/1", EDITED_CARD],
      ["GET", "/api/cards", [EDITED_CARD, ...CARDS.slice(1)]],
    ]);
    expect(cards.state.writes.get("patch_cards")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        expect.objectContaining({ field: "edit", rule: "nested-clock" }),
      ]),
    });
    // A loaded state can hold an edit object another editor wrote.
    const loaded = cards.store.snapshot();
    expect(
      cards.store.replace({
        rea_state: {
          ...loaded.rea_state,
          entities: loaded.rea_state.entities.map((entity) =>
            entity.id === "2"
              ? {
                  ...entity,
                  fields: {
                    ...entity.fields,
                    edit: { at: EDITED_AT, by: "ops" },
                  },
                }
              : entity,
          ),
        },
      }).ok,
    ).toBe(true);
    cards.answer("patch_cards", { body: { ids: [2], name: "Edited" } });
    expect(cards.answer("get_cards_by_id", { id: "2" }).body).toMatchObject({
      edit: { by: "ops" },
    });
    const before = cards.snapshot();
    expect(
      cards.refusal("patch_cards", { body: { ids: [3], name: "Edited" } }),
    ).toMatchObject({
      message: expect.stringContaining("holds no edit object"),
    });
    expect(cards.snapshot()).toBe(before);
  });
});

describe("served bulk delete options", () => {
  it("deletes only with the members its recording sent besides the ids, as it sent them", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      ["DELETE", "/api/books", "", 204, { ids: [2], dry_run: false }],
      ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
      ["GET", "/api/books", [FIRST_BOOK]],
    ]);
    const before = books.snapshot();
    for (const [body, message] of [
      [{ ids: [1], dry_run: true }, "Member dry_run is accepted only"],
      [{ ids: [1], dry_run: false, force: true }, "Member force is not one"],
      [{ ids: [1] }, "lacks required members"],
    ] as const)
      expect(books.refusal("delete_books", { body }).message).toContain(
        message,
      );
    expect(books.snapshot()).toBe(before);
    expect(
      books.answer("delete_books", { body: { ids: [1], dry_run: false } }),
    ).toMatchObject({ status: 204 });
    expect(books.store.ofType("/api/books").map((book) => book.id)).toEqual([
      "2",
    ]);
  });

  it("pins the members each recorded element sends besides its id", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      ["DELETE", "/api/books", "", 204, [{ id: 2, cascade: true }]],
      ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
      ["GET", "/api/books", [FIRST_BOOK]],
    ]);
    const before = books.snapshot();
    expect(
      books.refusal("delete_books", { body: [{ id: 1, cascade: false }] })
        .message,
    ).toContain("Member cascade is accepted only");
    expect(books.snapshot()).toBe(before);
    expect(
      books.answer("delete_books", { body: [{ id: 1, cascade: true }] }),
    ).toMatchObject({ status: 204 });
  });

  it("models a recorded call with other members as unknown rather than as a delete", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      ["DELETE", "/api/books", "", 204, { ids: [2], dry_run: false }],
      ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
      ["DELETE", "/api/books", "", 204, { ids: [1], dry_run: true }],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books", [FIRST_BOOK]],
    ]);
    expect(books.state.writes.get("delete_books")).toMatchObject({
      served: true,
      body: { fixed: [{ member: "dry_run", sent: false }] },
    });
  });
});

describe("served item actions", () => {
  it("sets what the action changed on the entity the path names", () => {
    const books = servedFrom([
      [
        "GET",
        "/api/books",
        [shelved(FIRST_BOOK, false), shelved(SECOND_BOOK, false)],
      ],
      ["GET", "/api/books/1", shelved(FIRST_BOOK, false)],
      ["GET", "/api/books/2", shelved(SECOND_BOOK, false)],
      ["POST", "/api/books/1/archive", shelved(FIRST_BOOK, true)],
      ["GET", "/api/books/1", shelved(FIRST_BOOK, true)],
      ["POST", "/api/books/1/archive", shelved(FIRST_BOOK, true)],
      ["GET", "/api/books/1", shelved(FIRST_BOOK, true)],
    ]);
    expect(books.answer("post_books_archive_by_id", { id: "2" })).toMatchObject(
      {
        status: 200,
        body: shelved(SECOND_BOOK, true),
        state: { source: "state", view: "update", id: "2" },
      },
    );
    expect(books.answer("get_books_by_id", { id: "2" })).toMatchObject({
      body: shelved(SECOND_BOOK, true),
      state: { source: "state" },
    });
  });
});
