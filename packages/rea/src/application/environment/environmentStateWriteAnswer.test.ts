import { describe, expect, it, vi } from "vitest";

import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  environmentStateServeFixture,
  environmentStateServeInputs,
} from "../../../tests/fixtures/environmentServe.js";
import {
  servedFrom,
  type Served,
} from "../../../tests/fixtures/environmentStateServing.js";
import {
  ASSET_ROWS,
  BOOK_INIT_ROWS,
  BOOK_NOT_FOUND,
  BOOK_ROWS,
  DELETE_NOT_FOUND,
  DETAILED_LIST_ROWS,
  EXPANDED_LIST_ROWS,
  FIRST_BOOK,
  OMITTED_FIELD_ROWS,
  PROJECTED_ROWS,
  AUTHORED_ROWS,
  CHAPTER_AUTHOR,
  CONTENTS_ROWS,
  HANDLE_ROWS,
  LIST_LINE_ROWS,
  QUERY_ROWS,
  OFFSET_LIST_ROWS,
  SECOND_BOOK,
  THIRD_BOOK,
  assetBook,
  book,
  bookClock,
  detailedBook,
  expandedBook,
  UNCHAPTERED_ROWS,
  VERSIONED_ROWS,
  numberedUuid,
  bookPage,
  offsetListed,
  renamedBook,
  type Book,
} from "../../../tests/fixtures/environmentStateWrites.js";
import { seededUuid } from "../../domain/analysisView/environmentStateWriteValues.js";
import type { StateWritePlan } from "../../domain/analysisView/environmentStateWriteRules.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import type { ReplayArguments } from "./environmentReplay.js";
import { servedCatalog } from "./environmentState.js";
import { describeWrite } from "./environmentStateWriteDescription.js";
import { EnvironmentStateStore } from "./environmentStateStore.js";
import { environmentToolAnswer } from "./environmentToolAnswer.js";
import {
  environmentToolArguments,
  environmentToolDefinitions,
} from "./environmentTools.js";

/** The book the first served create of "New Book" makes: the next id, one second past the served clock's start. */
const NEW_BOOK = book(3, "New Book", bookClock(13));
const CREATE_NEW_BOOK = { body: { name: "New Book" } };

const entityOf = (books: Served, id: string) =>
  books.store.snapshot().rea_state.entities.find((entity) => entity.id === id);

/** Load what data/get reports back through data/add: the state must come back byte for byte. */
const expectReloadsUnchanged = (books: Served): void => {
  const before = books.snapshot();
  expect(books.store.replace(JSON.parse(before)).ok).toBe(true);
  expect(books.snapshot()).toBe(before);
};

describe("confirmed write response bodies", () => {
  it.each<{
    name: string;
    status?: number;
    content: Record<string, JsonValue>;
    shape: "recorded" | "empty";
    bodyRecorded: boolean;
  }>([
    {
      name: "unsupported encoding with empty text",
      content: {
        mimeType: "application/json",
        text: "",
        encoding: "custom-json",
      },
      shape: "recorded",
      bodyRecorded: false,
    },
    {
      name: "omitted text with nonzero content size",
      content: { mimeType: "application/json", size: 25 },
      shape: "recorded",
      bodyRecorded: false,
    },
    {
      name: "205 without retained text",
      status: 205,
      content: { mimeType: "text/html" },
      shape: "recorded",
      bodyRecorded: false,
    },
    ...[undefined, null].map((text) => ({
      name: `zero-size HTML with ${text === null ? "null" : "omitted"} text`,
      content: {
        mimeType: "text/html",
        size: 0,
        ...(text === null ? { text } : {}),
      },
      shape: "recorded" as const,
      bodyRecorded: false,
    })),
    {
      name: "known empty text",
      content: { mimeType: "application/json", size: 0, text: "" },
      shape: "empty",
      bodyRecorded: true,
    },
  ])(
    "preserves $name when serving a confirmed document write",
    ({ content, shape, bodyRecorded, status = 200 }) => {
      const entries: Record<string, JsonValue>[] = [
        {
          request: { method: "GET", url: "http://app.example/api/settings" },
          response: {
            status: 200,
            content: {
              mimeType: "application/json",
              text: '{"theme":"light","lang":"en"}',
            },
          },
        },
        {
          request: {
            method: "PATCH",
            url: "http://app.example/api/settings",
            postData: {
              mimeType: "application/json",
              text: '{"theme":"dark"}',
            },
          },
          response: { status, content },
        },
        {
          request: { method: "GET", url: "http://app.example/api/settings" },
          response: {
            status: 200,
            content: {
              mimeType: "application/json",
              text: '{"theme":"dark","lang":"en"}',
            },
          },
        },
      ];
      const capture = analysisViewCaptureEvidence(
        environmentManifestCaptureFixture(
          entries.map((entry, index) => ({
            ...entry,
            startedDateTime: `2026-10-17T18:00:0${String(index)}.000Z`,
            time: 5,
          })),
        ),
      );
      const { source, state } = environmentStateServeInputs(
        environmentStateServeFixture(capture),
      );
      const store = new EnvironmentStateStore(state);
      expect(store.state.writes.get("patch_settings")).toMatchObject({
        effect: "document",
        served: true,
        response: { ordinal: 1, shape, pointer: null },
        checked_record_ordinals: [2],
      });
      const respond = environmentToolAnswer(source, store);
      const patch = source.manifest.tools.find(
        (tool) => tool.name === "patch_settings",
      );
      const get = source.manifest.tools.find(
        (tool) => tool.name === "get_settings",
      );
      if (patch === undefined || get === undefined)
        throw new Error("Expected settings tools");
      const write = respond(patch, { body: { theme: "blue" } });
      if (!write.ok) throw write.error;
      expect(write.value).toMatchObject({
        status,
        body: null,
        replay: {
          record_ordinal: 1,
          evidence_id: source.evidenceId,
          body_recorded: bodyRecorded,
        },
        state: { source: "state", view: "document-write" },
      });
      const read = respond(get, {});
      if (!read.ok) throw read.error;
      expect(read.value.body).toEqual({ theme: "blue", lang: "en" });
    },
  );
});

it("refuses an unrepresentable generated clock without changing the held state", () => {
  const books = servedFrom();
  const pending = books.store.pendingWrite();
  const pendingWrite = books.store.pendingWrite.bind(books.store);
  vi.spyOn(books.store, "pendingWrite").mockImplementation(() => ({
    ...pendingWrite(),
    clockMs: Date.parse("0000-01-01T00:00:00+01:00"),
  }));
  const before = books.snapshot();
  const refusal = books.refusal("post_books", CREATE_NEW_BOOK);
  expect(JSON.stringify(refusal)).toContain(
    "outside its recorded four-digit year format",
  );
  expect(books.snapshot()).toBe(before);
  expect(books.store.pendingWrite().count).toBe(pending.count);
});

describe("served creates", () => {
  it("refuses an exhausted generated-value collision search without changing state", () => {
    const existing = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      ref: "223e4567-e89b-42d3-a456-426614174000",
      name: "Existing",
    };
    const created = {
      id: "323e4567-e89b-42d3-a456-426614174000",
      ref: "423e4567-e89b-42d3-a456-426614174000",
      name: "Created",
    };
    const books = servedFrom([
      ["GET", "/api/items", [existing]],
      ["GET", `/api/items/${existing.id}`, existing],
      ["POST", "/api/items", created, 201, { name: "Created" }],
      ["GET", `/api/items/${created.id}`, created],
      ["GET", "/api/items", [existing, created]],
    ]);
    const plan = books.store.state.writes.get("post_items");
    if (plan?.served !== true)
      throw new Error("Expected post_items to be served");
    const rule = plan.rules.find((candidate) => candidate.rule === "unique");
    expect(rule).toMatchObject({ field: "ref", rule: "unique" });
    if (rule?.rule !== "unique") throw new Error("Expected a unique ref rule");
    const candidates = Array.from({ length: 65 }, (_, attempt) =>
      seededUuid(
        `${books.state.evidenceId}:${plan.tool}:${rule.field}:1:${String(attempt)}`,
        created.ref,
      ),
    );
    const snapshot = books.store.snapshot();
    const collisions = candidates.map((ref, index) => ({
      type: "/api/items",
      collection: "/api/items",
      id: `collision-${String(index)}`,
      fields: { id: `collision-${String(index)}`, ref, name: "Collision" },
      view_fields: [],
      record_ordinals: [],
    }));
    const loaded = {
      ...snapshot,
      rea_state: {
        ...snapshot.rea_state,
        entities: [...snapshot.rea_state.entities, ...collisions],
      },
    };
    const replaced = books.store.replace(loaded);
    if (!replaced.ok) throw new Error(JSON.stringify(replaced.error));
    const before = books.snapshot();
    const pending = books.store.pendingWrite();

    const refusal = books.refusal(plan.tool, { body: { name: "Created" } });

    expect(JSON.stringify(refusal)).toContain(
      "Could not generate a unique value for ref after 64 attempts",
    );
    expect(books.snapshot()).toBe(before);
    expect(books.store.pendingWrite()).toEqual(pending);
  });
  it("creates a book with the next id, the served clock and a derived slug, which later reads show", () => {
    const books = servedFrom();
    const created = books.answer("post_books", CREATE_NEW_BOOK);
    expect(created).toMatchObject({
      status: 201,
      content_type: "application/json",
      state: {
        source: "state",
        view: "create",
        type: "/api/books",
        collection: "/api/books",
        id: "3",
      },
    });
    expect(created.body).toEqual(NEW_BOOK);
    expect(books.answer("get_books_by_id", { id: "3" })).toMatchObject({
      status: 200,
      body: NEW_BOOK,
      state: { source: "state", view: "item", id: "3" },
    });
    expect(books.answer("get_books")).toMatchObject({
      body: [FIRST_BOOK, SECOND_BOOK, NEW_BOOK],
      state: { source: "state", view: "list", membership: "all", listed: 3 },
    });
  });

  it("reports a created book in data/get without record citations and loads it back unchanged", () => {
    const books = servedFrom();
    books.answer("post_books", CREATE_NEW_BOOK);
    expect(entityOf(books, "3")).toEqual({
      type: "/api/books",
      collection: "/api/books",
      id: "3",
      fields: NEW_BOOK,
      view_fields: [],
      record_ordinals: [],
    });
    expectReloadsUnchanged(books);
    expect(books.answer("get_books_by_id", { id: "3" }).body).toEqual(NEW_BOOK);
  });
});

describe("served updates and deletes", () => {
  it("keeps an entity's identity when the application ignored the id an update sent", () => {
    const renamed = renamedBook(FIRST_BOOK, "Renamed Book", 3);
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      [
        "PATCH",
        "/api/books/1",
        renamed,
        200,
        { id: 999, name: "Renamed Book" },
      ],
      ["GET", "/api/books/1", renamed],
    ]);
    const answer = books.answer("patch_books_by_id", {
      id: "2",
      body: { id: 999, name: "Second Edition" },
    });
    expect(answer.body).toMatchObject({ id: 2, name: "Second Edition" });
    expect(books.answer("get_books_by_id", { id: "2" }).body).toMatchObject({
      id: 2,
    });
  });

  const SECOND_EDITION = renamedBook(SECOND_BOOK, "Second Edition", 13);
  const RENAME_SECOND = { id: "2", body: { name: "Second Edition" } };

  it("changes only the sent members, the slug that follows them and the clock", () => {
    const books = servedFrom();
    expect(books.answer("patch_books_by_id", RENAME_SECOND)).toMatchObject({
      status: 200,
      body: SECOND_EDITION,
      state: { source: "state", view: "update", id: "2" },
    });
    expect(books.answer("get_books_by_id", { id: "2" }).body).toEqual(
      SECOND_EDITION,
    );
    expect(books.answer("get_books").body).toEqual([
      FIRST_BOOK,
      SECOND_EDITION,
    ]);
  });

  it("cites no records for an updated book in data/get, so it loads back unchanged", () => {
    const books = servedFrom();
    books.answer("patch_books_by_id", RENAME_SECOND);
    expect(entityOf(books, "2")).toMatchObject({
      fields: SECOND_EDITION,
      record_ordinals: [],
    });
    expectReloadsUnchanged(books);
  });

  it("removes a deleted book; a later read answers the recorded 404 as a missing entity", () => {
    const books = servedFrom();
    expect(books.answer("delete_books_by_id", { id: "2" })).toMatchObject({
      status: 204,
      body: null,
      state: { source: "state", view: "delete", id: "2" },
    });
    expect(books.answer("get_books_by_id", { id: "2" })).toMatchObject({
      status: 404,
      body: BOOK_NOT_FOUND,
      state: {
        source: "state",
        view: "missing",
        type: "/api/books",
        collection: "/api/books",
        id: "2",
      },
    });
    expect(books.answer("get_books").body).toEqual([FIRST_BOOK]);
  });

  it("answers an update or delete of a missing book with a recorded 404, else refuses it", () => {
    const books = servedFrom();
    const before = books.snapshot();
    // The update recorded no absence, so it answers the item view's; the delete answers its own.
    expect(
      books.answer("patch_books_by_id", { id: "99", body: { name: "Ghost" } }),
    ).toMatchObject({
      status: 404,
      body: BOOK_NOT_FOUND,
      state: { view: "missing", id: "99" },
    });
    expect(books.answer("delete_books_by_id", { id: "99" })).toMatchObject({
      status: 404,
      body: DELETE_NOT_FOUND,
      state: { view: "missing", id: "99" },
    });
    expect(books.snapshot()).toBe(before);
    const unrecorded = servedFrom(
      BOOK_ROWS.filter(([, , , status]) => status !== 404),
    );
    for (const [name, args] of [
      ["patch_books_by_id", { id: "99", body: { name: "Ghost" } }],
      ["delete_books_by_id", { id: "99" }],
    ] as const)
      expect(unrecorded.refusal(name, args)).toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining(
          "holds no /api/books entity 99 in /api/books",
        ),
      });
  });
});

describe("wider write coverage", () => {
  it("serves a created book without the field the application leaves out of it, and keeps it on the seeded ones", () => {
    const books = servedFrom(OMITTED_FIELD_ROWS);
    const created = books.answer("post_books", CREATE_NEW_BOOK).body as Book;
    expect(created).not.toHaveProperty("detail");
    expect(books.answer("get_books_by_id", { id: "3" }).body).toEqual(created);
    expect(books.answer("get_books_by_id", { id: "1" }).body).toEqual(
      detailedBook(FIRST_BOOK),
    );
  });

  it("replays a call that asks for some fields only, and answers the rest from the state", () => {
    const books = servedFrom(PROJECTED_ROWS);
    expect(
      books.answer("get_books_by_id", { id: "2", fields: "name" }),
    ).toMatchObject({
      body: { name: "Second Book" },
      state: { source: "recording", reason: "projection" },
    });
    expect(books.answer("get_books_by_id", { id: "2" })).toMatchObject({
      body: SECOND_BOOK,
      state: { source: "state", view: "item" },
    });
  });

  it("replays a call naming a parameter only the expanded line names, and lists a served create on the plain one", () => {
    const books = servedFrom(EXPANDED_LIST_ROWS);
    const created = books.answer("post_books", CREATE_NEW_BOOK).body as Book;
    expect(books.answer("get_books")).toMatchObject({
      body: [FIRST_BOOK, SECOND_BOOK, created],
      state: { source: "state", view: "list" },
    });
    expect(books.answer("get_books", { expand: "shelf" })).toMatchObject({
      body: [FIRST_BOOK, SECOND_BOOK].map(expandedBook),
      state: { source: "recording", reason: "variant" },
    });
  });

  it("numbers created books after the largest held asset number, in its digit groups", () => {
    const books = servedFrom(ASSET_ROWS);
    const create = (name: string) =>
      books.answer("post_books", { body: { name } }).body as Book;
    expect(create("Fifth Book")).toMatchObject({ asset: "000-003" });
    expect(create("Sixth Book")).toMatchObject({ asset: "000-004" });
    expect(books.answer("get_books_by_id", { id: "1" }).body).toEqual(
      assetBook(FIRST_BOOK, "000-001"),
    );
  });
});

describe("items only a replayed line showed", () => {
  it("replays the recorded read of an item only a variant line showed, and still finds an unrecorded one missing", () => {
    const books = servedFrom([
      ["GET", "/api/books", [FIRST_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/1?expand=shelf", expandedBook(FIRST_BOOK)],
      ["GET", "/api/books/2?expand=shelf", expandedBook(SECOND_BOOK)],
    ]);
    expect(
      books.answer("get_books_by_id", { id: "2", expand: "shelf" }),
    ).toMatchObject({
      status: 200,
      body: expandedBook(SECOND_BOOK),
      state: { source: "recording", reason: "variant" },
    });
    expect(
      books.call("get_books_by_id", { id: "3", expand: "shelf" }),
    ).not.toMatchObject({ ok: true, value: { status: 200 } });
  });
});

describe("items a served write made and removed", () => {
  it("finds an item a served create made and a served delete removed missing, though a variant line recorded it", () => {
    const created = book(3, "Third Book", bookClock(4));
    const books = servedFrom([
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["GET", "/api/books/1?expand=shelf", expandedBook(FIRST_BOOK)],
      ["POST", "/api/books", created, 201, { name: "Third Book" }],
      ["GET", "/api/books/3", created],
      ["GET", "/api/books/3?expand=shelf", expandedBook(created)],
      ["DELETE", "/api/books/3", "", 204],
      ["GET", "/api/books/3", BOOK_NOT_FOUND, 404],
    ]);
    expect(books.state.writes.get("post_books")).toMatchObject({
      served: true,
    });
    expect(books.state.writes.get("delete_books_by_id")).toMatchObject({
      served: true,
    });
    books.answer("post_books", { body: { name: "Third Book" } });
    books.answer("delete_books_by_id", { id: "3" });
    const read = books.call("get_books_by_id", { id: "3", expand: "shelf" });
    expect(read.ok && read.value.status === 200).toBe(false);
  });
});

describe("field selections beside replayed reads", () => {
  it("replays a field selection no checked line gave, and answers a selection of every field from the state", () => {
    const books = servedFrom([
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1?fields=*", FIRST_BOOK],
      ["GET", "/api/books/2?fields=*", SECOND_BOOK],
      ["GET", "/api/books/2?fields=name", { name: "Second Book" }],
    ]);
    expect(
      books.answer("get_books_by_id", { id: "1", fields: "id" }),
    ).toMatchObject({ state: { source: "recording", reason: "projection" } });
    expect(
      books.answer("get_books_by_id", { id: "1", fields: "*" }),
    ).toMatchObject({
      body: FIRST_BOOK,
      state: { source: "state", view: "item" },
    });
  });

  it("replays a field selection a replayed read gave, beside a variant key and a checked line giving it too", () => {
    // One read asking for a book's name answered it whole; another left the id out.
    const books = servedFrom([
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/1?fields=name", FIRST_BOOK],
      ["GET", "/api/books/2?fields=name", { name: "Second Book" }],
      ["GET", "/api/books/1?expand=shelf", expandedBook(FIRST_BOOK)],
    ]);
    expect(
      books.answer("get_books_by_id", { id: "2", fields: "name" }),
    ).toMatchObject({
      body: { name: "Second Book" },
      state: { source: "recording", reason: "projection" },
    });
    expect(
      books.answer("get_books_by_id", { id: "1", expand: "shelf" }),
    ).toMatchObject({ state: { source: "recording", reason: "variant" } });
    expect(books.answer("get_books_by_id", { id: "2" })).toMatchObject({
      body: SECOND_BOOK,
      state: { source: "state", view: "item" },
    });
  });
});

describe("write coverage limits", () => {
  it("numbers past a mask's width again after the state is saved and loaded", () => {
    const books = servedFrom([
      [
        "GET",
        "/api/books",
        [assetBook(FIRST_BOOK, "99-97"), assetBook(SECOND_BOOK, "99-98")],
      ],
      ["GET", "/api/books/1", assetBook(FIRST_BOOK, "99-97")],
      ["GET", "/api/books/2", assetBook(SECOND_BOOK, "99-98")],
      [
        "POST",
        "/api/books",
        assetBook(THIRD_BOOK, "99-99"),
        201,
        { name: "Third Book" },
      ],
      ["GET", "/api/books/3", assetBook(THIRD_BOOK, "99-99")],
    ]);
    const create = (name: string) =>
      books.answer("post_books", { body: { name } }).body;
    expect(create("Fifth Book")).toMatchObject({ asset: "99-99" });
    expect(create("Sixth Book")).toMatchObject({ asset: "100-00" });
    // Loading what data/get wrote clears the sequence counter, so the held numbers alone carry it on.
    const { rea_state } = books.store.snapshot();
    expect(books.store.replace({ rea_state }).ok).toBe(true);
    expect(create("Seventh Book")).toMatchObject({ asset: "100-01" });
  });

  it("replays a call naming a projection parameter, even an empty one", () => {
    expect(
      servedFrom(PROJECTED_ROWS).answer("get_books_by_id", {
        id: "2",
        fields: "",
      }),
    ).toMatchObject({ state: { source: "recording", reason: "projection" } });
  });

  it("answers a projection of a book the state no longer holds as a missing one", () => {
    const books = servedFrom([
      ...PROJECTED_ROWS,
      ...BOOK_ROWS.slice(BOOK_INIT_ROWS.length),
    ]);
    books.answer("delete_books_by_id", { id: "2" });
    expect(
      books.answer("get_books_by_id", { id: "2", fields: "name" }),
    ).toMatchObject({
      status: 404,
      body: BOOK_NOT_FOUND,
      state: { source: "state", view: "missing", id: "2" },
    });
  });

  it("lists a created book without the field an item read showed the application leaves out", () => {
    const books = servedFrom(DETAILED_LIST_ROWS);
    const created = books.answer("post_books", CREATE_NEW_BOOK).body as Book;
    expect(created).not.toHaveProperty("detail");
    expect(books.answer("get_books").body).toEqual([
      detailedBook(FIRST_BOOK),
      detailedBook(SECOND_BOOK),
      created,
    ]);
  });
});

describe("values the application assigns", () => {
  it("gives each update a fresh version and new chapter ids, keeping the chapters' other values", () => {
    const books = servedFrom(VERSIONED_ROWS);
    const rename = (name: string) =>
      books.answer("patch_books_by_id", {
        id: "2",
        body: { name, version_id: "any version" },
      }).body as Book;
    const first = rename("Second Edition");
    const second = rename("Third Edition");
    const held = [1, 2, 3, 4, 5, 6, 7, 8].map(numberedUuid);
    for (const answer of [first, second]) {
      expect(held).not.toContain(answer.version_id);
      expect(answer.chapters).toEqual([
        { id: expect.not.stringMatching(numberedUuid(4)), title: "Opening" },
      ]);
    }
    expect(second.version_id).not.toBe(first.version_id);
    expect(books.answer("get_books_by_id", { id: "2" }).body).toEqual(second);
  });

  it("renews chapter ids alone, keeping the author each chapter names", () => {
    const answer = servedFrom(AUTHORED_ROWS).answer("patch_books_by_id", {
      id: "2",
      body: { name: "Second Edition", version_id: "any version" },
    }).body as Book;
    expect(answer.chapters).toEqual([
      {
        id: expect.not.stringMatching(numberedUuid(4)),
        title: "Opening",
        author_id: CHAPTER_AUTHOR,
      },
    ]);
  });

  it("renews a chapter id alike wherever an update renews it", () => {
    const answer = servedFrom(CONTENTS_ROWS).answer("patch_books_by_id", {
      id: "2",
      body: { name: "Second Edition", version_id: "any version" },
    }).body as {
      chapters: [{ id: string }];
      contents: [{ chapter_id: string }];
    };
    expect(answer.chapters[0].id).not.toBe(numberedUuid(4));
    expect(answer.contents[0].chapter_id).toBe(answer.chapters[0].id);
  });

  it("gives no chapter rows to a book the state holds without them", () => {
    const books = servedFrom(UNCHAPTERED_ROWS);
    const before = books.snapshot();
    expect(
      books.refusal("patch_books_by_id", {
        id: "2",
        body: { name: "Second Edition", version_id: "any version" },
      }).message,
    ).toContain("lacks chapters");
    expect(books.snapshot()).toBe(before);
  });

  it("refuses a handle of another JSON type than the code it is stored as", () => {
    const books = servedFrom(HANDLE_ROWS);
    for (const handle of [{ not: "a string" }, null])
      expect(
        books.refusal("post_books", { body: { name: "Fifth Book", handle } })
          .message,
      ).toContain("Member handle must be a JSON string");
  });

  it("stores a sent handle as the code and rebuilds the link around it", () => {
    const books = servedFrom(HANDLE_ROWS);
    expect(
      books.answer("post_books", {
        body: { name: "Fifth Book", handle: "fifth-handle" },
      }).body,
    ).toMatchObject({
      id: 3,
      code: "fifth-handle",
      link: "https://books.example.test/b/fifth-handle",
    });
  });
});

describe("clock spellings per view", () => {
  it("lists a created book with the list's clock spelling and reads it back with the item's", () => {
    const books = servedFrom(OFFSET_LIST_ROWS);
    // The served clock starts after the sixth recorded exchange.
    const created = book(3, "New Book", bookClock(7));
    books.answer("post_books", CREATE_NEW_BOOK);
    expect(books.answer("get_books").body).toEqual(
      [FIRST_BOOK, SECOND_BOOK, created].map(offsetListed),
    );
    expect(books.answer("get_books_by_id", { id: "3" }).body).toEqual(created);
  });
});

describe("refusals", () => {
  it("refuses a body the capture does not support and leaves the state unchanged", () => {
    const books = servedFrom();
    const before = books.snapshot();
    const refused: [string, ReplayArguments, string][] = [
      [
        "post_books",
        { body: { name: "Extra", color: "red" } },
        "Member color is not one the capture showed stored",
      ],
      ["post_books", { body: {} }, 'lacks required members "name"'],
      [
        "post_books",
        { body: { name: 42 } },
        "Member name must be a JSON string",
      ],
      ["post_books", { body: ["New Book"] }, "takes a JSON object body"],
      [
        "patch_books_by_id",
        { id: "1", body: "New Book" },
        "takes a JSON object body",
      ],
      ["patch_books_by_id", { id: "1", body: {} }, "sends none of the members"],
      [
        "patch_books_by_id",
        { id: "1", body: { title: "New" } },
        "Member title is not one",
      ],
    ];
    for (const [name, args, message] of refused) {
      expect(books.refusal(name, args)).toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining(message),
      });
      expect(books.snapshot()).toBe(before);
    }
  });

  it("accepts a member the application stored differently only with the value the capture sent", () => {
    const bound = (entry: Book, format: string): Book => ({ ...entry, format });
    const books = servedFrom([
      [
        "GET",
        "/api/books",
        [bound(FIRST_BOOK, "PAPERBACK"), bound(SECOND_BOOK, "PAPERBACK")],
      ],
      ["GET", "/api/books/1", bound(FIRST_BOOK, "PAPERBACK")],
      ["GET", "/api/books/2", bound(SECOND_BOOK, "PAPERBACK")],
      [
        "POST",
        "/api/books",
        bound(THIRD_BOOK, "HARDCOVER"),
        201,
        { name: "Third Book", format: "hardcover" },
      ],
      ["GET", "/api/books/3", bound(THIRD_BOOK, "HARDCOVER")],
    ]);
    const before = books.snapshot();
    expect(
      books.refusal("post_books", {
        body: { name: "Soft", format: "softcover" },
      }),
    ).toMatchObject({
      message: expect.stringContaining(
        "Member format is accepted only with the value the capture sent",
      ),
    });
    expect(books.snapshot()).toBe(before);
    expect(
      books.answer("post_books", {
        body: { name: "Hard", format: "hardcover" },
      }).body,
    ).toMatchObject({ id: 3, name: "Hard", format: "HARDCOVER" });
  });

  it("holds a member a later update first stored to the JSON type it stored", () => {
    const shelved = { ...SECOND_BOOK, tags: ["a"] };
    const renamed = renamedBook(FIRST_BOOK, "Renamed Book", 3);
    const retagged = { ...shelved, tags: ["x"], updated_at: bookClock(5) };
    // The rename the plan was built from shows no tags, which the first book never had.
    const books = servedFrom([
      ["GET", "/api/books", [FIRST_BOOK, shelved]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", shelved],
      ["PATCH", "/api/books/1", renamed, 200, { name: "Renamed Book" }],
      ["GET", "/api/books/1", renamed],
      ["PATCH", "/api/books/2", retagged, 200, { tags: ["x"] }],
      ["GET", "/api/books/2", retagged],
    ]);
    expect(books.state.writes.get("patch_books_by_id")).toMatchObject({
      served: true,
      body: { kinds: [{ member: "tags", kind: "array" }] },
    });
    const before = books.snapshot();
    expect(
      books.refusal("patch_books_by_id", { id: "1", body: { tags: "x" } }),
    ).toMatchObject({
      message: expect.stringContaining("Member tags must be a JSON array"),
    });
    expect(books.snapshot()).toBe(before);
    books.answer("patch_books_by_id", { id: "1", body: { tags: ["y"] } });
    expect(entityOf(books, "1")?.fields).toMatchObject({ tags: ["y"] });
  });

  it("generates the same values after a refused call as without it", () => {
    const refusedFirst = servedFrom();
    refusedFirst.refusal("post_books", { body: {} });
    refusedFirst.refusal("patch_books_by_id", {
      id: "1",
      body: { title: "New" },
    });
    expect(refusedFirst.answer("post_books", CREATE_NEW_BOOK).body).toEqual(
      servedFrom().answer("post_books", CREATE_NEW_BOOK).body,
    );
  });
});

/** Items whose `rank` is a collection sequence, with a recorded create at `recorded`. */
const rankedItems = (initial: readonly [number, number], recorded: number) => {
  const item = (id: number, rank: number) => ({
    id,
    name: `n${String(id)}`,
    rank,
  });
  const [first, second] = initial;
  return servedFrom([
    ["GET", "/api/items", [item(1, first), item(2, second)]],
    ["GET", "/api/items/1", item(1, first)],
    ["GET", "/api/items/2", item(2, second)],
    ["POST", "/api/items", item(3, recorded), 201, { name: "n3" }],
    ["GET", "/api/items/3", item(3, recorded)],
    ["GET", "/api/items", [item(1, first), item(2, second), item(3, recorded)]],
  ]);
};

describe("generated values", () => {
  it("answers the same calls identically after a reset, never reusing a deleted id", () => {
    const books = servedFrom();
    const session = () => {
      const answers = [
        books.answer("post_books", CREATE_NEW_BOOK),
        books.answer("patch_books_by_id", {
          id: "3",
          body: { name: "Newer Book" },
        }),
        books.answer("delete_books_by_id", { id: "3" }),
        books.answer("post_books", { body: { name: "Another Book" } }),
        books.answer("get_books"),
      ];
      return { answers, text: JSON.stringify([answers, books.snapshot()]) };
    };
    const first = session();
    books.store.reset();
    expect(session().text).toBe(first.text);
    expect(first.answers[3]?.body).toMatchObject({
      id: 4,
      name: "Another Book",
    });
  });

  it("serves the next rank when a collection sequence runs through negative values", () => {
    const acrossZero = rankedItems([-2, -1], 0);
    expect(
      acrossZero.answer("post_items", { body: { name: "n4" } }).body,
    ).toMatchObject({ id: 3, rank: 0 });
    expect(
      acrossZero.answer("post_items", { body: { name: "n5" } }).body,
    ).toMatchObject({ id: 4, rank: 1 });
    // The value after a stored negative rank stays on that sequence.
    const negative = rankedItems([-4, -3], -2);
    expect(
      negative.answer("post_items", { body: { name: "n4" } }).body,
    ).toMatchObject({ id: 3, rank: -2 });
    expect(
      negative.answer("post_items", { body: { name: "n5" } }).body,
    ).toMatchObject({ id: 4, rank: -1 });
  });

  it("restarts the clock and the sequences when data/add loads a state", () => {
    const books = servedFrom();
    const initial: unknown = JSON.parse(books.snapshot());
    const created = books.answer("post_books", CREATE_NEW_BOOK);
    books.answer("post_books", { body: { name: "Another Book" } });
    expect(books.store.replace(initial).ok).toBe(true);
    // Had the sequence and clock run on, this create would take id 5 one second later.
    expect(books.answer("post_books", CREATE_NEW_BOOK).body).toEqual(
      created.body,
    );
  });
});

describe("served catalog", () => {
  it("adds only the served write tools, saying what each does to the state", () => {
    const { source, state } = servedFrom();
    const catalog = servedCatalog(source, state, "books");
    if (!catalog.ok) throw catalog.error;
    const described = new Map(
      catalog.value.tools.map((tool) => [tool.name, tool]),
    );
    // The export write targets no state type, so it is not served.
    expect([...described.keys()].sort()).toEqual([
      "delete_books_by_id",
      "get_books",
      "get_books_by_id",
      "patch_books_by_id",
      "post_books",
    ]);
    expect(described.get("post_books")?.description).toContain(
      'creates an entity of /api/books in the served environment state (body members "name"; required: "name"), modelled on the recorded calls',
    );
    expect(described.get("patch_books_by_id")?.description).toContain(
      'changes the entity the path names in the served environment state (body members "name"; send at least one)',
    );
    expect(described.get("delete_books_by_id")?.description).toContain(
      "removes the entity the path names from the served environment state",
    );
    expect(described.get("post_books")?.annotations.readOnlyHint).toBe(false);
    expect(described.get("get_books")?.description).toContain(
      "answers from the served environment state where the state backs this tool",
    );
  });

  it("quotes body member names and omits one that exceeds the sample budget", () => {
    const plan: StateWritePlan = {
      tool: "post_books",
      effect: "create",
      target: "/api/books",
      served: true,
      reason: null,
      exemplar_ordinal: null,
      observation: null,
      response: null,
      body: {
        accepted: ["name, title", "note\nline"],
        fixed: [],
        required: [],
        identity: null,
        kinds: [],
      },
      rules: [],
      collection: null,
      insert: null,
      merge: null,
      checked_record_ordinals: [],
      contradicted_by: null,
    };
    expect(describeWrite(plan)).toContain(
      'body members "name, title", "note\\nline"',
    );
    const long = describeWrite({
      ...plan,
      body: { ...plan.body!, accepted: ["m".repeat(2000)] },
    });
    expect(long).not.toContain("m".repeat(2000));
    expect(Buffer.byteLength(long ?? "", "utf8")).toBeLessThan(1200);
  });

  it("quotes the member names a write's description lists and samples a long one", () => {
    const long = "n".repeat(90_000);
    const item = (id: number, name: string) => ({
      id,
      name,
      "x, y": name,
      [long]: name,
    });
    const { source, state } = servedFrom([
      ["GET", "/api/books", [item(1, "A")]],
      ["GET", "/api/books/1", item(1, "A")],
      [
        "POST",
        "/api/books",
        item(2, "B"),
        201,
        { name: "B", "x, y": "B", [long]: "B" },
      ],
      ["GET", "/api/books/2", item(2, "B")],
      ["GET", "/api/books", [item(1, "A"), item(2, "B")]],
    ]);
    const catalog = servedCatalog(source, state, "books");
    if (!catalog.ok) throw catalog.error;
    const created = catalog.value.tools.find(
      (tool) => tool.name === "post_books",
    );
    expect(created?.description).toContain(
      'body members "name", "x, y", … (2/3 shown; full list in state Evidence)',
    );
  });

  it("serves every manifest tool unchanged in replay mode", () => {
    const { source } = servedFrom();
    const replay = servedCatalog(source, undefined, "books");
    const definitions = environmentToolDefinitions(source, "books");
    if (!replay.ok || !definitions.ok) throw new Error("Expected a catalog");
    expect(replay.value).toEqual({
      tools: definitions.value,
      dataPlane: "none",
    });
    expect(replay.value.tools.map(({ name }) => name)).toContain(
      "post_exports",
    );
  });
});

describe("paged list lines", () => {
  it("answers an argument-less list from the state on a line that only pages, and another page from its recording", () => {
    const paged = servedFrom([
      ["GET", "/api/books?limit=50", [FIRST_BOOK, SECOND_BOOK]],
      ...BOOK_INIT_ROWS.slice(1),
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      ["GET", "/api/books/3", THIRD_BOOK],
      ["GET", "/api/books?limit=50", [FIRST_BOOK, SECOND_BOOK, THIRD_BOOK]],
    ]);
    const created = paged.answer("post_books", CREATE_NEW_BOOK).body;
    expect(paged.answer("get_books")).toMatchObject({
      body: [FIRST_BOOK, SECOND_BOOK, created],
      replay: { record_ordinal: 0, exact_match: false },
      state: { source: "state", view: "list", listed: 3 },
    });
    expect(paged.answer("get_books", { limit: "10" })).toMatchObject({
      body: [FIRST_BOOK, SECOND_BOOK],
      state: { source: "recording", reason: "unrecorded-request" },
    });
  });
});

describe("list lines", () => {
  it("keeps an empty later page recorded after data/add, while a first line lists the loaded entity", () => {
    for (const [query, whole] of [
      ["offset=0", true],
      ["start=0", true],
      ["_start=0", true],
      ["page=0", true],
      ["offset=2", false],
      ["start=2", false],
      ["_start=2", false],
      ["page=1", false],
      ["offset=-1", false],
      ["offset=unknown", false],
    ] as const) {
      const alpha = { id: 1, name: "Alpha", org: "1" };
      const beta = { id: 2, name: "Beta", org: "2" };
      const books = servedFrom([
        ["GET", "/api/orgs/1/books", [alpha]],
        ["GET", "/api/orgs/1/books?name=Alpha", [alpha]],
        ["GET", `/api/orgs/2/books?${query}&limit=50`, []],
        ["GET", "/api/orgs/1/books/1", alpha],
      ]);
      const held = books.store.snapshot().rea_state;
      const loaded = books.store.replace({
        rea_state: {
          ...held,
          entities: [
            ...held.entities,
            {
              type: held.entities[0]!.type,
              collection: "/api/orgs/2/books",
              id: "2",
              fields: beta,
              view_fields: [],
              record_ordinals: [],
            },
          ],
        },
      });
      if (!loaded.ok) throw loaded.error;
      const answer = books.answer("get_orgs_books_by_id", {
        id: "2",
        ...Object.fromEntries(new URLSearchParams(query)),
        limit: "50",
      });
      expect(answer.body, query).toEqual(whole ? [beta] : []);
      if (whole)
        expect(answer).toMatchObject({
          state: { source: "state", membership: "all", listed: 1 },
        });
      else {
        expect(answer).toMatchObject({
          state: { source: expect.stringMatching(/^(state|recording)$/u) },
        });
        expect(answer).not.toMatchObject({ state: { membership: "all" } });
      }
    }
  });

  it("lists a created book on the line that lists every book, and a filtered line by its filter", () => {
    const books = servedFrom(LIST_LINE_ROWS);
    const created = books.answer("post_books", CREATE_NEW_BOOK).body as Book;
    expect(books.answer("get_books")).toMatchObject({
      body: bookPage([FIRST_BOOK, SECOND_BOOK, created]),
      state: { source: "state", membership: "all", listed: 3 },
    });
    expect(books.answer("get_books", { name: "First Book" })).toMatchObject({
      body: bookPage([FIRST_BOOK]),
      state: { source: "state", membership: "query", listed: 1 },
    });
  });
});

describe("list queries", () => {
  it.each([3, "3"])(
    "preserves query total %j across omission, retaining its type and rejecting contradictions",
    (initialTotal) => {
      const alpha = { id: 1, name: "Alpha" },
        beta = { id: 2, name: "Beta" },
        gamma = { id: 3, name: "Gamma" };
      for (const contradicts of [false, true]) {
        const books = servedFrom([
          ["GET", "/api/books", { items: [alpha, beta, gamma] }],
          [
            "GET",
            "/api/books?limit=1",
            { items: [alpha], total: initialTotal },
          ],
          [
            "GET",
            "/api/books?limit=2",
            { items: [alpha, beta], ...(contradicts ? { total: 20 } : {}) },
          ],
        ]);
        expect(books.state.views.get("get_books")).toMatchObject({
          query: { totals: contradicts ? [] : ["total"] },
        });
        const snapshot = books.store.snapshot();
        const loaded = books.store.replace({
          ...snapshot,
          rea_state: {
            ...snapshot.rea_state,
            entities: snapshot.rea_state.entities.filter(
              (entity) => entity.id !== "3",
            ),
          },
        });
        if (!loaded.ok) throw loaded.error;
        expect(books.answer("get_books", { limit: "1" })).toMatchObject({
          body: {
            items: [alpha],
            total: contradicts
              ? initialTotal
              : typeof initialTotal === "string"
                ? "2"
                : 2,
          },
          state: { source: "state", membership: "query" },
        });
        if (!contradicts)
          expect(
            books.answer("get_books", { limit: "2" }).body,
          ).not.toHaveProperty("total");
      }
    },
  );

  it("replays unsupported search syntax instead of inventing an empty state-backed result", () => {
    const books = servedFrom(QUERY_ROWS);
    for (const q of ["title:Gamma", "#sea", '"First Book"']) {
      expect(books.answer("get_books", { q }), q).toMatchObject({
        state: { source: "recording", reason: "unrecorded-request" },
      });
    }
    expect(books.answer("get_books", { q: "SECOND" })).toMatchObject({
      state: { source: "state", membership: "query", listed: 1 },
    });
  });

  it("updates a query-only page counter without adding it to an envelope that never recorded it", () => {
    const alpha = { id: 1, name: "Alpha", shelf: "a" };
    const beta = { id: 2, name: "Beta", shelf: "b" };
    const gamma = { id: 3, name: "Gamma", shelf: "a" };
    const books = servedFrom([
      ["GET", "/api/books", { items: [alpha, beta], total: 2 }],
      [
        "GET",
        "/api/books?shelf=a",
        { items: [alpha], total: 1, numberOfElements: 1 },
      ],
      ["GET", "/api/books/1", alpha],
      ["GET", "/api/books/2", beta],
      ["POST", "/api/books", gamma, 201, { name: "Gamma", shelf: "a" }],
      ["GET", "/api/books/3", gamma],
      ["GET", "/api/books", { items: [alpha, beta, gamma], total: 3 }],
    ]);
    const created = books.answer("post_books", {
      body: { name: "Delta", shelf: "a" },
    }).body;
    expect(books.answer("get_books", { shelf: "a" })).toMatchObject({
      body: { items: [alpha, created], total: 2, numberOfElements: 2 },
      state: { source: "state", membership: "query", listed: 2 },
    });
    expect(books.answer("get_books").body).toEqual({
      items: [alpha, beta, created],
      total: 3,
    });
  });

  it("filters, searches and sorts the state for values no line recorded, created books included", () => {
    const books = servedFrom(QUERY_ROWS);
    const created = books.answer("post_books", {
      body: { name: "New Book", shelf: "b" },
    }).body as Book;
    const listed = (args: Record<string, string>) => {
      const answer = books.answer("get_books", args);
      return {
        ids: (answer.body as Book[]).map((entry) => entry["id"]),
        state: (answer as { readonly state?: unknown }).state,
      };
    };
    expect(listed({ shelf: "b" })).toMatchObject({
      ids: [2, created["id"]],
      state: { source: "state", membership: "query", listed: 2 },
    });
    expect(listed({ q: "NEW" }).ids).toEqual([created["id"]]);
    expect(listed({ sort: "-id" }).ids).toEqual([created["id"], 2, 1]);
    expect(listed({ sort: "-id", shelf: "a" }).ids).toEqual([1]);
    // A value the flag never recorded, or a parameter the query has no role for, replays as before.
    expect(listed({ include: "none" }).state).toMatchObject({
      source: "recording",
      reason: "unrecorded-request",
    });
  });

  it("keeps a whole line's total following the state beside a partial page, which its query now answers", () => {
    const partial = {
      content: [FIRST_BOOK],
      totalElements: 2,
      numberOfElements: 1,
    };
    const books = servedFrom([
      ["GET", "/api/books", bookPage([FIRST_BOOK, SECOND_BOOK])],
      ["GET", "/api/books?page=1&size=1", partial],
      ...LIST_LINE_ROWS.slice(2),
    ]);
    const created = books.answer("post_books", CREATE_NEW_BOOK).body as Book;
    expect(books.answer("get_books")).toMatchObject({
      body: bookPage([FIRST_BOOK, SECOND_BOOK, created]),
    });
    // The partial page is a query line here: its page and total come from the state, which now holds three books.
    expect(books.answer("get_books", { page: "1", size: "1" })).toMatchObject({
      body: { ...partial, totalElements: 3 },
      state: { membership: "query" },
    });
  });
});

describe("path values", () => {
  const orgBook = (id: number, org: string, name: string): Book => ({
    id,
    org,
    name,
  });
  const ALPHA = orgBook(1, "my org1", "Alpha");
  const BETA = orgBook(2, "acme2", "Beta");
  const GAMMA = orgBook(3, "my org1", "Gamma");
  const DELTA = orgBook(4, "acme2", "Delta");
  /** Books under two organisations, one whose name the paths percent-encode, and a create under each. */
  const ROWS: readonly TimedCaptureRow[] = [
    ["GET", "/api/orgs/my%20org1/books", [ALPHA]],
    ["GET", "/api/orgs/acme2/books", [BETA]],
    ["GET", "/api/orgs/my%20org1/books/1", ALPHA],
    ["GET", "/api/orgs/acme2/books/2", BETA],
    ["POST", "/api/orgs/my%20org1/books", GAMMA, 201, { name: "Gamma" }],
    ["GET", "/api/orgs/my%20org1/books", [ALPHA, GAMMA]],
    ["POST", "/api/orgs/acme2/books", DELTA, 201, { name: "Delta" }],
    ["GET", "/api/orgs/acme2/books", [BETA, DELTA]],
  ];

  it("stores a parent path value decoded, as the gate learned it, whichever spelling the call uses", () => {
    for (const spelling of ["my%20org1", "my org1"]) {
      const books = servedFrom(ROWS);
      const tool = books.source.manifest.tools.find(
        (candidate) => candidate.method === "POST",
      )!;
      expect(books.state.writes.get(tool.name)).toMatchObject({
        served: true,
        rules: expect.arrayContaining([
          expect.objectContaining({ field: "org", rule: "path" }),
        ]),
      });
      const [org] = environmentToolArguments(tool).path.values();
      books.answer(tool.name, { [org!]: spelling, body: { name: "Epsilon" } });
      const created = books.store
        .snapshot()
        .rea_state.entities.find(
          (entity) => entity.fields["name"] === "Epsilon",
        );
      expect(created).toMatchObject({
        collection: "/api/orgs/my%20org1/books",
        fields: { org: "my org1" },
      });
    }
  });
});

describe("collections a create chooses", () => {
  const orgBook = (id: number, name: string): Book => ({ id, name });
  /** One organisation listed under two spellings and another organisation, each with a create. */
  const ROWS: readonly TimedCaptureRow[] = [
    ["GET", "/api/orgs/%61cme1/books", [orgBook(1, "Alpha")]],
    ["GET", "/api/orgs/acme1/books", [orgBook(2, "Beta")]],
    ["GET", "/api/orgs/beta2/books", [orgBook(3, "Gamma")]],
    [
      "POST",
      "/api/orgs/acme1/books",
      orgBook(4, "Delta"),
      201,
      { name: "Delta" },
    ],
    ["GET", "/api/orgs/acme1/books", [orgBook(2, "Beta"), orgBook(4, "Delta")]],
    [
      "POST",
      "/api/orgs/beta2/books",
      orgBook(5, "Epsilon"),
      201,
      { name: "Epsilon" },
    ],
    [
      "GET",
      "/api/orgs/beta2/books",
      [orgBook(3, "Gamma"), orgBook(5, "Epsilon")],
    ],
  ];

  it("creates in the collection the call spells verbatim, as item calls choose their entity", () => {
    const books = servedFrom(ROWS);
    const tool = books.source.manifest.tools.find(
      (candidate) => candidate.method === "POST",
    )!;
    expect(books.state.writes.get(tool.name)).toMatchObject({ served: true });
    const [org] = environmentToolArguments(tool).path.values();
    books.answer(tool.name, { [org!]: "acme1", body: { name: "Zeta" } });
    expect(
      books.store
        .snapshot()
        .rea_state.entities.find((entity) => entity.fields["name"] === "Zeta")
        ?.collection,
    ).toBe("/api/orgs/acme1/books");
  });

  it("refuses an empty parent segment before storing an unreadable collection", () => {
    const books = servedFrom(ROWS);
    const tool = books.source.manifest.tools.find(
      (candidate) => candidate.method === "POST",
    )!;
    const [org] = environmentToolArguments(tool).path.values();
    const before = books.snapshot();
    expect(
      books.refusal(tool.name, { [org!]: "", body: { name: "Invalid" } }),
    ).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("path argument to be non-empty"),
    });
    expect(books.snapshot()).toBe(before);
    expect(
      books.store.knownCollectionsOf("/api/orgs/{org}/books"),
    ).not.toContain("/api/orgs//books");
  });
});

describe("missing entities after a delete", () => {
  it("answers with a recorded 2xx null, which the gate also took as an absence", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      ["DELETE", "/api/books/2", "", 204],
      ["GET", "/api/books/2", null],
    ]);
    expect(books.state.writes.get("delete_books_by_id")).toMatchObject({
      served: true,
    });
    books.answer("delete_books_by_id", { id: "1" });
    expect(books.answer("get_books_by_id", { id: "1" })).toMatchObject({
      status: 200,
      body: null,
      state: { view: "missing", id: "1" },
    });
  });

  it("never answers a write of a missing entity with success, even when the write recorded a 2xx null", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      ["DELETE", "/api/books/2", null, 200],
      ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
    ]);
    expect(books.state.writes.get("delete_books_by_id")).toMatchObject({
      served: true,
    });
    expect(books.answer("delete_books_by_id", { id: "9" })).toMatchObject({
      status: 404,
      body: BOOK_NOT_FOUND,
      state: { view: "missing", id: "9" },
    });
  });
});

describe("values the state started with", () => {
  it("never reuses a seeded id for a create, even after its entity is deleted first", () => {
    const books = servedFrom();
    books.answer("delete_books_by_id", { id: "2" });
    books.answer("post_books", CREATE_NEW_BOOK);
    expect(entityOf(books, "2")).toBeUndefined();
    expect(entityOf(books, "3")?.fields).toMatchObject({ name: "New Book" });
  });

  const orgBook = (id: number, org: string, name: string): Book => ({
    id,
    org,
    name,
  });
  /** Books under two organisations, one spelled `first` in its paths, with creates and a delete the lists confirm. */
  const twoOrgs = (first: string, org: string) => {
    const alpha = orgBook(1, org, "Alpha");
    const beta = orgBook(2, "acme2", "Beta");
    const gamma = orgBook(3, org, "Gamma");
    const delta = orgBook(4, "acme2", "Delta");
    const books = servedFrom([
      ["GET", `/api/orgs/${first}/books`, [alpha]],
      ["GET", "/api/orgs/acme2/books", [beta]],
      ["GET", `/api/orgs/${first}/books/1`, alpha],
      ["GET", "/api/orgs/acme2/books/2", beta],
      ["POST", `/api/orgs/${first}/books`, gamma, 201, { name: "Gamma" }],
      ["GET", `/api/orgs/${first}/books`, [alpha, gamma]],
      ["POST", "/api/orgs/acme2/books", delta, 201, { name: "Delta" }],
      ["GET", "/api/orgs/acme2/books", [beta, delta]],
      ["DELETE", `/api/orgs/${first}/books/3`, "", 204],
      ["GET", `/api/orgs/${first}/books`, [alpha]],
    ]);
    const toolOf = (method: string) =>
      books.source.manifest.tools.find(
        (candidate) => candidate.method === method,
      )!;
    const create = (value: string, name: string): string | undefined => {
      const tool = toolOf("POST");
      const [parent] = environmentToolArguments(tool).path.values();
      books.answer(tool.name, { [parent!]: value, body: { name } });
      return books.store
        .snapshot()
        .rea_state.entities.find((entity) => entity.fields["name"] === name)
        ?.collection;
    };
    return { books, toolOf, create };
  };

  it("creates in a collection's recorded spelling after the collection empties", () => {
    const { books, toolOf, create } = twoOrgs("my%20org1", "my org1");
    const remove = toolOf("DELETE");
    const [parent, id] = environmentToolArguments(remove).path.values();
    for (const held of ["1", "3"])
      books.answer(remove.name, { [parent!]: "my%20org1", [id!]: held });
    expect(books.store.collectionsOf("/api/orgs/{org}/books")).not.toContain(
      "/api/orgs/my%20org1/books",
    );
    expect(create("my%20org1", "Epsilon")).toBe("/api/orgs/my%20org1/books");
  });

  it("creates in the Evidence's spelling of a collection a loaded state does not hold", () => {
    const { books, create } = twoOrgs("my%20org1", "my org1");
    const { rea_state: held } = books.store.snapshot();
    expect(
      books.store.replace({
        rea_state: {
          version: held.version,
          entities: held.entities.filter(
            (entity) => !entity.collection.includes("%20"),
          ),
          documents: held.documents,
        },
      }).ok,
    ).toBe(true);
    expect(create("my%20org1", "Epsilon")).toBe("/api/orgs/my%20org1/books");
  });

  it("creates in the loaded state's collection when the Evidence spells the same one differently", () => {
    const { books, create } = twoOrgs("%61cme1", "acme1");
    const { rea_state: held } = books.store.snapshot();
    expect(
      books.store.replace({
        rea_state: {
          version: held.version,
          entities: held.entities.map((entity) =>
            entity.collection.includes("%61cme1")
              ? {
                  ...entity,
                  collection: entity.collection.replace("%61cme1", "a%63me1"),
                  record_ordinals: [],
                }
              : entity,
          ),
          documents: held.documents,
        },
      }).ok,
    ).toBe(true);
    // Both spellings decode to the argument; the one holding books wins over the Evidence's emptied one.
    expect(create("acme1", "Epsilon")).toBe("/api/orgs/a%63me1/books");
  });

  it("creates in the spelling of a collection the capture listed empty", () => {
    const beta = orgBook(2, "acme2", "Beta");
    const gamma = orgBook(3, "my org1", "Gamma");
    const delta = orgBook(4, "acme2", "Delta");
    // The state starts before the first create, when the encoded organisation's list was empty.
    const books = servedFrom([
      ["GET", "/api/orgs/my%20org1/books", []],
      ["GET", "/api/orgs/acme2/books", [beta]],
      ["GET", "/api/orgs/acme2/books/2", beta],
      ["POST", "/api/orgs/my%20org1/books", gamma, 201, { name: "Gamma" }],
      ["GET", "/api/orgs/my%20org1/books", [gamma]],
      ["POST", "/api/orgs/acme2/books", delta, 201, { name: "Delta" }],
      ["GET", "/api/orgs/acme2/books", [beta, delta]],
    ]);
    const tool = books.source.manifest.tools.find(
      (candidate) => candidate.method === "POST",
    )!;
    const [parent] = environmentToolArguments(tool).path.values();
    books.answer(tool.name, {
      [parent!]: "my%20org1",
      body: { name: "Epsilon" },
    });
    expect(
      books.store
        .snapshot()
        .rea_state.entities.find(
          (entity) => entity.fields["name"] === "Epsilon",
        )?.collection,
    ).toBe("/api/orgs/my%20org1/books");
  });

  it("forgets the spellings of a loaded state once reset", () => {
    const { books, create } = twoOrgs("%61cme1", "acme1");
    const { rea_state: held } = books.store.snapshot();
    // A loaded state spells the first organisation plainly; the Evidence's state spells it encoded.
    expect(
      books.store.replace({
        rea_state: {
          version: held.version,
          // Moved to another spelling, the entity cites none of the Evidence's records.
          entities: held.entities.map((entity) =>
            entity.collection.includes("%61cme1")
              ? {
                  ...entity,
                  collection: entity.collection.replace("%61cme1", "acme1"),
                  record_ordinals: [],
                }
              : entity,
          ),
          documents: held.documents,
        },
      }).ok,
    ).toBe(true);
    books.store.reset();
    expect(create("acme1", "Epsilon")).toBe("/api/orgs/%61cme1/books");
  });
});

describe("paged lines", () => {
  it("answers a requested page the collection has outgrown from its recording, and a call with no query from the state", () => {
    const books = servedFrom([
      ["GET", "/api/books?limit=2", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      // The application answers the same page with two books; serving would not answer it from the state.
      ["GET", "/api/books?limit=2", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK, THIRD_BOOK]],
    ]);
    const created = books.answer("post_books", CREATE_NEW_BOOK).body as Book;
    expect(books.answer("get_books", { limit: "2" })).toMatchObject({
      body: [FIRST_BOOK, SECOND_BOOK],
      state: { source: "recording", reason: "page-exceeded" },
    });
    expect(books.answer("get_books")).toMatchObject({
      body: [FIRST_BOOK, SECOND_BOOK, created],
      state: { source: "state", membership: "all", listed: 3 },
    });
  });

  it("answers a whole list a zero limit names from the state, as zero lists every match", () => {
    const books = servedFrom([
      ["GET", "/api/books?limit=0", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      ["GET", "/api/books/3", THIRD_BOOK],
    ]);
    const created = books.answer("post_books", CREATE_NEW_BOOK).body as Book;
    expect(books.answer("get_books", { limit: "0" })).toMatchObject({
      body: [FIRST_BOOK, SECOND_BOOK, created],
      state: { source: "state", membership: "all", listed: 3 },
    });
  });

  it("does not list an entity a confirmed create adds on an empty ?page=2&per_page=1 page", () => {
    const alpha = { id: 1, name: "Alpha", org: "1" };
    const beta = { id: 2, name: "Beta", org: "2" };
    const books = servedFrom([
      ["GET", "/api/orgs/1/books", [alpha]],
      ["GET", "/api/orgs/1/books/1", alpha],
      ["GET", "/api/orgs/2/books?page=2&per_page=1", []],
      ["POST", "/api/orgs/2/books", beta, 201, { name: "Beta" }],
      ["GET", "/api/orgs/2/books/2", beta],
    ]);
    const created = books.answer("post_orgs_books_by_id", {
      id: "2",
      body: { name: "Gamma" },
    }).body as Book;
    expect(created).toMatchObject({ name: "Gamma" });
    expect(books.answer("get_orgs_books_by_id", { id: "2" })).toMatchObject({
      body: [],
      state: { source: "recording", reason: "unrecorded-request" },
    });
    expect(
      books.answer("get_orgs_books_by_id", {
        id: "2",
        page: "2",
        per_page: "1",
      }),
    ).toMatchObject({
      body: [],
      state: { source: "state", membership: "recorded", listed: 0 },
    });
  });

  it.each(["offset", "start", "_start"])(
    "does not list an entity a confirmed create adds on an empty ?%s=1 page",
    (name) => {
      const alpha = { id: 1, name: "Alpha", org: "1" };
      const beta = { id: 2, name: "Beta", org: "2" };
      const books = servedFrom([
        ["GET", "/api/orgs/1/books", [alpha]],
        ["GET", "/api/orgs/1/books/1", alpha],
        ["GET", `/api/orgs/2/books?${name}=1`, []],
        ["POST", "/api/orgs/2/books", beta, 201, { name: "Beta" }],
        ["GET", "/api/orgs/2/books/2", beta],
      ]);
      const created = books.answer("post_orgs_books_by_id", {
        id: "2",
        body: { name: "Gamma" },
      }).body as Book;
      expect(created).toMatchObject({ name: "Gamma" });
      expect(books.answer("get_orgs_books_by_id", { id: "2" })).toMatchObject({
        body: [],
        state: { source: "state", membership: "recorded", listed: 0 },
      });
      expect(
        books.answer("get_orgs_books_by_id", { id: "2", [name]: "1" }),
      ).toMatchObject({
        body: [],
        state: { source: "state", membership: "query", listed: 0 },
      });
    },
  );

  it("answers a zero limit a whole line recorded empty from that recording once a create fills its collection", () => {
    const alpha = { id: 1, name: "Alpha", org: "1" };
    const beta = { id: 2, name: "Beta", org: "2" };
    const books = servedFrom([
      ["GET", "/api/orgs/1/books", [alpha]],
      ["GET", "/api/orgs/1/books/1", alpha],
      ["GET", "/api/orgs/2/books?limit=0", []],
      ["POST", "/api/orgs/2/books", beta, 201, { name: "Beta" }],
      ["GET", "/api/orgs/2/books/2", beta],
    ]);
    books.answer("post_orgs_books_by_id", { id: "2", body: { name: "Gamma" } });
    // Only a recording that listed items under it shows that zero lists every entity.
    expect(
      books.answer("get_orgs_books_by_id", { id: "2", limit: "0" }),
    ).toMatchObject({
      body: [],
      state: { source: "recording", reason: "page-exceeded" },
    });
  });

  it("keeps a range's bound beside a zero size its recording shows unbounded", () => {
    const books = servedFrom([
      ["GET", "/api/books?limit=0&_start=0&_end=2", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      ["GET", "/api/books/3", THIRD_BOOK],
    ]);
    books.answer("post_books", CREATE_NEW_BOOK);
    expect(
      books.answer("get_books", { limit: "0", _start: "0", _end: "2" }),
    ).toMatchObject({
      body: [FIRST_BOOK, SECOND_BOOK],
      state: { source: "recording", reason: "page-exceeded" },
    });
  });

  it("answers a range the collection has outgrown from its recording", () => {
    const books = servedFrom([
      ["GET", "/api/books?_start=0&_end=2", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      ["GET", "/api/books?_start=0&_end=2", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/3", THIRD_BOOK],
    ]);
    books.answer("post_books", CREATE_NEW_BOOK);
    expect(books.answer("get_books", { _start: "0", _end: "2" })).toMatchObject(
      {
        body: [FIRST_BOOK, SECOND_BOOK],
        state: { source: "recording", reason: "page-exceeded" },
      },
    );
  });
});

describe("omissions on query-backed read-backs", () => {
  it("confirms a create through a filtered list and serves later omissions in that query", () => {
    const alpha = { id: 1, name: "Alpha", detail: "x" };
    const beta = { id: 2, name: "Beta", detail: "x" };
    const gamma = { id: 3, name: "Gamma" };
    const books = servedFrom([
      ["GET", "/api/books", [alpha, beta]],
      ["GET", "/api/books?name=Alpha", [alpha]],
      ["GET", "/api/books/1", alpha],
      ["GET", "/api/books/2", beta],
      ["POST", "/api/books", gamma, 201, { name: "Gamma" }],
      ["GET", "/api/books?name=Gamma", [gamma]],
    ]);
    const created = books.answer("post_books", {
      body: { name: "Delta" },
    }).body;
    expect(created).toMatchObject({ id: 3, name: "Delta" });
    expect(created).not.toHaveProperty("detail");
    expect(books.answer("get_books", { name: "Delta" })).toMatchObject({
      body: [created],
      state: { source: "state", membership: "query", listed: 1 },
    });
    expect(books.answer("get_books", { name: "Alpha" }).body).toEqual([alpha]);
  });
});

describe("own JSON members in update bodies", () => {
  it("accepts constructor added by a later recorded update without inheriting a function kind", () => {
    const alpha = { id: 1, name: "Alpha" };
    const beta = { id: 2, name: "Beta", constructor: "known" };
    const renamed = { ...alpha, name: "Renamed" };
    const extended = { ...renamed, constructor: "stored" };
    const books = servedFrom([
      ["GET", "/api/books", [alpha, beta]],
      ["GET", "/api/books/1", alpha],
      ["GET", "/api/books/2", beta],
      ["PATCH", "/api/books/1", renamed, 200, { name: "Renamed" }],
      ["GET", "/api/books/1", renamed],
      ["PATCH", "/api/books/1", extended, 200, { constructor: "stored" }],
      ["GET", "/api/books/1", extended],
    ]);
    expect(
      books.answer("patch_books_by_id", {
        id: "1",
        body: { constructor: "value" },
      }).body,
    ).toMatchObject({
      id: 1,
      name: "Alpha",
    });
    expect(books.answer("get_books_by_id", { id: "1" }).body).toMatchObject({
      constructor: "value",
    });
  });
});

describe("asset sequence inference", () => {
  it("answers the recorded first create consistently when a held asset has outgrown its mask", () => {
    const alpha = { id: 1, name: "Alpha", asset: "99-98" };
    const beta = { id: 2, name: "Beta", asset: "100-00" };
    const gamma = { id: 3, name: "Gamma", asset: "99-99" };
    const books = servedFrom([
      ["GET", "/api/books", [alpha, beta]],
      ["GET", "/api/books/1", alpha],
      ["GET", "/api/books/2", beta],
      ["POST", "/api/books", gamma, 201, { name: "Gamma" }],
      ["GET", "/api/books/3", gamma],
    ]);
    expect(books.state.writes.get("post_books")?.rules).not.toContainEqual({
      field: "asset",
      rule: "sequence",
      scope: "collection",
    });
    expect(
      books.answer("post_books", { body: { name: "Gamma" } }).body,
    ).toEqual(gamma);
  });
});

describe("served catalog of calls that only read", () => {
  it("serves a lookup POST the capture shows reading only, by replay", () => {
    const { source, state } = servedFrom([
      ...BOOK_INIT_ROWS,
      ["POST", "/api/books/ids", [FIRST_BOOK], 200, { ids: [1] }],
    ]);
    const catalog = servedCatalog(source, state, "books");
    if (!catalog.ok) throw catalog.error;
    expect(catalog.value.tools.map((tool) => tool.name)).toContain(
      "post_books_ids",
    );
    expect(state.writes.has("post_books_ids")).toBe(false);
  });
});

describe("creates read under another path", () => {
  it("creates into the collection a linked create's returned id was read under", () => {
    const note = (id: number, title: string) => ({ id, title });
    const [alpha, beta, gamma] = [
      note(1001, "Alpha"),
      note(1002, "Beta"),
      note(1003, "Gamma"),
    ];
    const notes = servedFrom([
      ["GET", "/api/notes", [alpha, beta]],
      ["GET", "/api/notes/1001", alpha],
      ["GET", "/api/notes/1002", beta],
      ["POST", "/api/drafts/publish", { id: 1003 }, 201, { title: "Gamma" }],
      ["GET", "/api/notes/1003", gamma],
      ["GET", "/api/notes", [alpha, beta, gamma]],
    ]);
    expect(
      notes.answer("post_drafts_publish", { body: { title: "Delta" } }),
    ).toMatchObject({ status: 201 });
    // The capture's own create is not in the initial state, so the served one takes the next id.
    const delta = note(1003, "Delta");
    expect(notes.answer("get_notes_by_id", { id: "1003" }).body).toEqual(delta);
    expect(notes.answer("get_notes").body).toEqual([alpha, beta, delta]);
  });

  it("refuses a linked create called with other path arguments than its recording sent", () => {
    const note = (id: number, title: string) => ({ id, title });
    const [alpha, beta, gamma] = [
      note(1001, "Alpha"),
      note(1002, "Beta"),
      note(1003, "Gamma"),
    ];
    const notes = servedFrom([
      ["GET", "/api/projects/11/notes", [alpha, beta]],
      ["GET", "/api/projects/11/notes/1001", alpha],
      ["GET", "/api/projects/11/notes/1002", beta],
      [
        "POST",
        "/api/projects/11/publish",
        { id: 1003 },
        201,
        { title: "Gamma" },
      ],
      ["GET", "/api/projects/11/notes/1003", gamma],
      ["GET", "/api/projects/11/notes", [alpha, beta, gamma]],
    ]);
    const before = notes.snapshot();
    // No read showed where project 12's publish creates, so it is not put into project 11.
    expect(
      notes.refusal("post_projects_publish_by_id", {
        id: "12",
        body: { title: "Delta" },
      }),
    ).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining(
        "creates into /api/projects/11/notes only with the path arguments its recording sent",
      ),
    });
    expect(notes.snapshot()).toBe(before);
    expect(
      notes.answer("post_projects_publish_by_id", {
        id: "11",
        body: { title: "Delta" },
      }),
    ).toMatchObject({ status: 201 });
  });
});

describe("path values of creates read under another path", () => {
  it("refuses a linked create that changes one of two path values its template names alike", () => {
    const note = (id: number, title: string) => ({ id, title });
    const [alpha, beta, gamma] = [
      note(1001, "Alpha"),
      note(1002, "Beta"),
      note(1003, "Gamma"),
    ];
    const group = "/api/projects/11/groups/5";
    const notes = servedFrom([
      ["GET", `${group}/notes`, [alpha, beta]],
      ["GET", `${group}/notes/1001`, alpha],
      ["GET", `${group}/notes/1002`, beta],
      ["POST", `${group}/publish`, { id: 1003 }, 201, { title: "Gamma" }],
      ["GET", `${group}/notes/1003`, gamma],
      ["GET", `${group}/notes`, [alpha, beta, gamma]],
    ]);
    const publish = notes.source.manifest.tools.find(
      (tool) => tool.method === "POST",
    )!;
    expect(publish.path_template).toBe(
      "/api/projects/{numeric}/groups/{numeric}/publish",
    );
    const [project, groupArgument] =
      environmentToolArguments(publish).path.values();
    expect(notes.state.writes.get(publish.name)).toMatchObject({
      served: true,
      collection: `${group}/notes`,
    });
    // Project 12's group 5 is another source, though the group value matches.
    expect(
      notes.refusal(publish.name, {
        [project!]: "12",
        [groupArgument!]: "5",
        body: { title: "Delta" },
      }),
    ).toMatchObject({ code: "invalid_request" });
  });

  it("fills a linked create's path field with the decoded value, whichever spelling the call uses", () => {
    const note = (id: number, title: string) => ({
      id,
      title,
      project: "my org1",
    });
    const [alpha, beta, gamma] = [
      note(1001, "Alpha"),
      note(1002, "Beta"),
      note(1003, "Gamma"),
    ];
    const other = { id: 2001, title: "Other", project: "my org2" };
    const project = "/api/projects/my%20org1";
    for (const spelling of ["my%20org1", "my org1"]) {
      // A second project makes the project segment a path parameter.
      const notes = servedFrom([
        ["GET", "/api/projects/my%20org2/notes", [other]],
        ["GET", "/api/projects/my%20org2/notes/2001", other],
        ["GET", `${project}/notes`, [alpha, beta]],
        ["GET", `${project}/notes/1001`, alpha],
        ["GET", `${project}/notes/1002`, beta],
        ["POST", `${project}/publish`, { id: 1003 }, 201, { title: "Gamma" }],
        ["GET", `${project}/notes/1003`, gamma],
        ["GET", `${project}/notes`, [alpha, beta, gamma]],
        ["POST", "/api/projects/my%20org2/publish", { ok: true }, 200, {}],
      ]);
      notes.answer("post_projects_publish_by_project_id", {
        project_id: spelling,
        body: { title: "Delta" },
      });
      const created = notes.store
        .snapshot()
        .rea_state.entities.filter((entity) => entity.fields.title === "Delta");
      expect(created).toMatchObject([{ fields: { project: "my org1" } }]);
    }
  });

  it("counts a linked create's call from a source that names the exemplar's only after decoding twice as another source's", () => {
    const note = (id: number, title: string) => ({ id, title });
    const [alpha, beta, gamma, delta] = [
      note(1001, "Alpha"),
      note(1002, "Beta"),
      note(1003, "Gamma"),
      note(1004, "Delta"),
    ];
    const other = note(2001, "Other");
    const project = "/api/projects/team1";
    // A second project makes the project segment a path parameter.
    const notes = servedFrom([
      ["GET", "/api/projects/team2/notes", [other]],
      ["GET", "/api/projects/team2/notes/2001", other],
      ["GET", `${project}/notes`, [alpha, beta]],
      ["GET", `${project}/notes/1001`, alpha],
      ["GET", `${project}/notes/1002`, beta],
      ["POST", `${project}/publish`, { id: 1003 }, 201, { title: "Gamma" }],
      ["GET", `${project}/notes/1003`, gamma],
      ["GET", `${project}/notes`, [alpha, beta, gamma]],
      // `team%2531` decodes once to `team%31`, another project than `team1`.
      [
        "POST",
        "/api/projects/team%2531/publish",
        delta,
        201,
        { title: "Delta" },
      ],
      ["GET", `${project}/notes`, [alpha, beta, gamma]],
    ]);
    expect(
      notes.state.writes.get("post_projects_publish_by_project_id"),
    ).toMatchObject({ served: true, contradicted_by: null });
  });

  it("takes a linked create's recorded path value in either spelling, as other state-backed calls do", () => {
    const note = (id: number, title: string) => ({ id, title });
    const [alpha, beta, gamma] = [
      note(1001, "Alpha"),
      note(1002, "Beta"),
      note(1003, "Gamma"),
    ];
    const project = "/api/projects/my%20org1";
    const other = note(2001, "Other");
    // A second project makes the project segment a path parameter.
    const notes = servedFrom([
      ["GET", "/api/projects/my%20org2/notes", [other]],
      ["GET", "/api/projects/my%20org2/notes/2001", other],
      ["GET", `${project}/notes`, [alpha, beta]],
      ["GET", `${project}/notes/1001`, alpha],
      ["GET", `${project}/notes/1002`, beta],
      ["POST", `${project}/publish`, { id: 1003 }, 201, { title: "Gamma" }],
      ["GET", `${project}/notes/1003`, gamma],
      ["GET", `${project}/notes`, [alpha, beta, gamma]],
      ["POST", "/api/projects/my%20org2/publish", { ok: true }, 200, {}],
    ]);
    for (const spelling of ["my%20org1", "my org1"])
      expect(
        notes.answer("post_projects_publish_by_project_id", {
          project_id: spelling,
          body: { title: "Delta" },
        }),
      ).toMatchObject({ status: 201 });
  });
});

/** A card whose token is a NanoID and whose edit info a create stamps, created at exchange 3 and read back. */
const tokenCard = (id: number, token: string, at: string) => ({
  id,
  name: `Card ${String(id)}`,
  token,
  edit: { at, by: "rea" },
});
const CARD_ROWS: readonly TimedCaptureRow[] = [
  [
    "GET",
    "/api/cards",
    [
      tokenCard(1, "chYl65ZvCJ9U6yNk-YyqK", "2026-10-01T09:00:00.000Z"),
      tokenCard(2, "Qx81mP0aZkT3vB7n-Lw2e", "2026-10-01T10:00:00.000Z"),
    ],
  ],
  [
    "GET",
    "/api/cards/1",
    tokenCard(1, "chYl65ZvCJ9U6yNk-YyqK", "2026-10-01T09:00:00.000Z"),
  ],
  [
    "GET",
    "/api/cards/2",
    tokenCard(2, "Qx81mP0aZkT3vB7n-Lw2e", "2026-10-01T10:00:00.000Z"),
  ],
  [
    "POST",
    "/api/cards",
    tokenCard(3, "cdMLcknG-Lcu6oWL-3ZgA", `${bookClock(3).slice(0, -1)}.030Z`),
    201,
    { name: "Card 3" },
  ],
  [
    "GET",
    "/api/cards/3",
    tokenCard(3, "cdMLcknG-Lcu6oWL-3ZgA", `${bookClock(3).slice(0, -1)}.030Z`),
  ],
];

/** Notes whose update sends html the application stores nowhere and derives the excerpt from, and sends back the clock it read. */
const note = (id: number, title: string, excerpt: string) => ({
  id,
  title,
  excerpt,
  updated_at: bookClock(3),
});
const EDITED_NOTE = note(1, "First (edited)", "Edited body text.");
const NOTE_ROWS: readonly TimedCaptureRow[] = [
  [
    "GET",
    "/api/notes",
    [note(1, "First", "Old body text."), note(2, "Second", "Custom excerpt.")],
  ],
  ["GET", "/api/notes/1", note(1, "First", "Old body text.")],
  ["GET", "/api/notes/2", note(2, "Second", "Custom excerpt.")],
  [
    "PATCH",
    "/api/notes/1?source=html",
    EDITED_NOTE,
    200,
    {
      title: "First (edited)",
      html: "<p>Edited body text.</p>",
      updated_at: bookClock(3),
    },
  ],
  ["GET", "/api/notes/1", EDITED_NOTE],
];

describe("served values an application stamps", () => {
  it("takes an enveloped body as the capture sent it, and refuses one sent bare", () => {
    const books = servedFrom([
      ...BOOK_INIT_ROWS,
      [
        "PATCH",
        "/api/books/1",
        { books: [renamedBook(FIRST_BOOK, "Renamed Book", 3)] },
        200,
        { books: [{ name: "Renamed Book" }] },
      ],
      ["GET", "/api/books/1", renamedBook(FIRST_BOOK, "Renamed Book", 3)],
    ]);
    const before = books.snapshot();
    expect(
      books.refusal("patch_books_by_id", {
        id: "2",
        body: { name: "Second Edition" },
      }).message,
    ).toContain('wrapped as {"books":[{...}]}');
    expect(books.snapshot()).toBe(before);
    const answered = books.answer("patch_books_by_id", {
      id: "2",
      body: { books: [{ name: "Second Edition" }] },
    });
    expect(answered).toMatchObject({
      status: 200,
      body: {
        books: [{ id: 2, name: "Second Edition", slug: "second-edition" }],
      },
    });
    expect(books.answer("get_books_by_id", { id: "2" }).body).toMatchObject({
      name: "Second Edition",
    });
  });

  it("generates a token spelled like the type's and stamps the edit info with the served clock", () => {
    const cards = servedFrom(CARD_ROWS);
    const created = cards.answer("post_cards", { body: { name: "Card 4" } })
      .body as { token: string; edit: { at: string; by: string } };
    expect(created.token).toMatch(
      /^[A-Za-z0-9]{8}-[A-Za-z0-9]{7}-[A-Za-z0-9]{4}$/u,
    );
    expect([
      "chYl65ZvCJ9U6yNk-YyqK",
      "Qx81mP0aZkT3vB7n-Lw2e",
      "cdMLcknG-Lcu6oWL-3ZgA",
    ]).not.toContain(created.token);
    expect(created.edit.by).toBe("rea");
    expect(created.edit.at).not.toBe(`${bookClock(3).slice(0, -1)}.030Z`);
    expect(created.edit.at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
    );
  });

  it("derives a value only on an entity holding what it was derived from, with the recorded query and the held clock", () => {
    const notes = servedFrom(NOTE_ROWS);
    const edit = (
      id: string,
      updated: string,
      query: { source?: string } = { source: "html" },
    ) => ({
      id,
      ...query,
      body: {
        title: "Renamed",
        html: "<p>Edited body text.</p>",
        updated_at: updated,
      },
    });
    const before = notes.snapshot();
    expect(
      notes.refusal("patch_notes_by_id", edit("2", bookClock(3))).message,
    ).toContain("derives excerpt");
    expect(
      notes.refusal(
        "patch_notes_by_id",
        edit("1", bookClock(3), { source: "markdown" }),
      ).message,
    ).toContain("takes only the query its recording sent (source=html)");
    expect(
      notes.refusal("patch_notes_by_id", edit("1", "2026-01-01T00:00:00Z"))
        .message,
    ).toContain("must repeat the value the entity holds");
    expect(notes.snapshot()).toBe(before);
    const answered = notes.answer("patch_notes_by_id", edit("1", bookClock(3)));
    expect(answered).toMatchObject({
      status: 200,
      body: { id: 1, title: "Renamed", excerpt: "Edited body text." },
    });
    expect((answered.body as { updated_at: string }).updated_at).not.toBe(
      bookClock(3),
    );
    // Without the member the value derives from, the update keeps the excerpt the note holds.
    expect(
      notes.answer("patch_notes_by_id", {
        id: "2",
        source: "html",
        body: { title: "Second (renamed)", updated_at: bookClock(3) },
      }).body,
    ).toMatchObject({ title: "Second (renamed)", excerpt: "Custom excerpt." });
  });
});

describe("path fields of creates read under another path", () => {
  it("fills a linked create's path field from its exemplar decoded once, whichever accepted spelling the call uses", () => {
    const note = (id: number, title: string) => ({
      id,
      title,
      project: "team%31",
    });
    const [alpha, beta, gamma] = [
      note(1001, "Alpha"),
      note(1002, "Beta"),
      note(1003, "Gamma"),
    ];
    const other = { id: 2001, title: "Other", project: "team2" };
    // The recorded segment `team%2531` names the project `team%31`.
    const project = "/api/projects/team%2531";
    for (const spelling of ["team%2531", "team%31"]) {
      const notes = servedFrom([
        ["GET", "/api/projects/team2/notes", [other]],
        ["GET", "/api/projects/team2/notes/2001", other],
        ["GET", `${project}/notes`, [alpha, beta]],
        ["GET", `${project}/notes/1001`, alpha],
        ["GET", `${project}/notes/1002`, beta],
        ["POST", `${project}/publish`, { id: 1003 }, 201, { title: "Gamma" }],
        ["GET", `${project}/notes/1003`, gamma],
        ["GET", `${project}/notes`, [alpha, beta, gamma]],
        ["POST", "/api/projects/team2/publish", { ok: true }, 200, {}],
      ]);
      notes.answer("post_projects_publish_by_project_id", {
        project_id: spelling,
        body: { title: "Delta" },
      });
      const created = notes.store
        .snapshot()
        .rea_state.entities.filter((entity) => entity.fields.title === "Delta");
      expect(created).toMatchObject([{ fields: { project: "team%31" } }]);
    }
  });
});

describe("array fields a view lists sorted", () => {
  it("answers the update with the written order and later reads with it sorted", () => {
    const tagged = (entry: Book, tags: string[]): Book => ({ ...entry, tags });
    const books = servedFrom([
      [
        "GET",
        "/api/books",
        [tagged(FIRST_BOOK, ["alpha", "beta"]), tagged(SECOND_BOOK, ["gamma"])],
      ],
      ["GET", "/api/books/1", tagged(FIRST_BOOK, ["alpha", "beta"])],
      ["GET", "/api/books/2", tagged(SECOND_BOOK, ["gamma"])],
      [
        "PATCH",
        "/api/books/2",
        tagged(SECOND_BOOK, ["zeta", "delta"]),
        200,
        { tags: ["zeta", "delta"] },
      ],
      ["GET", "/api/books/2", tagged(SECOND_BOOK, ["delta", "zeta"])],
    ]);
    expect(
      books.answer("patch_books_by_id", {
        id: "1",
        body: { tags: ["omega", "beta"] },
      }).body,
    ).toMatchObject({ tags: ["omega", "beta"] });
    expect(books.answer("get_books_by_id", { id: "1" }).body).toMatchObject({
      tags: ["beta", "omega"],
    });
  });
});
