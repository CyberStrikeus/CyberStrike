import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  analysisViewCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  environmentStateServeFixture,
  environmentStateServeInputs,
} from "../../../tests/fixtures/environmentServe.js";
import { servedCatalog } from "./environmentState.js";
import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";
import {
  BOOK_NOT_FOUND,
  FIRST_BOOK,
  SECOND_BOOK,
  book,
  bookClock,
  renamedBook,
  offsetListed,
} from "../../../tests/fixtures/environmentStateWrites.js";

import { webNetworkCaptureSchema } from "../../domain/webNetworkCapture.js";

const archived = (value: boolean) => ({ ...FIRST_BOOK, archived: value });

describe("bodyless action evidence", () => {
  it.each<{
    name: string;
    postData: unknown;
    bodySize?: unknown;
    served?: boolean;
    shape?: boolean;
  }>([
    {
      name: "form",
      postData: {
        mimeType: "application/x-www-form-urlencoded",
        text: "toggle=false",
      },
    },
    {
      name: "malformed JSON",
      postData: { mimeType: "application/json", text: "{" },
    },
    {
      name: "oversized JSON",
      postData: {
        mimeType: "application/json",
        text: JSON.stringify({ note: "x".repeat(256 * 1024) }),
      },
    },
    { name: "unretained body", postData: undefined },
    {
      name: "omitted body with zero size",
      postData: undefined,
      bodySize: 0,
      served: true,
    },
    { name: "explicit null with zero size", postData: null, bodySize: 0 },
    {
      name: "params-only with zero size",
      postData: {
        mimeType: "application/json",
        params: [{ name: "archived", value: "true" }],
      },
      bodySize: 0,
    },
    {
      name: "empty text with nonempty params",
      postData: {
        mimeType: "application/json",
        text: "",
        params: [{ name: "archived", value: "true" }],
      },
      bodySize: 0,
    },
    {
      name: "explicit empty body with zero size",
      postData: { mimeType: "application/json", text: "", params: [] },
      bodySize: 0,
      served: true,
    },
    {
      name: "invalid size with retained JSON",
      postData: { mimeType: "application/json", text: '{"archived":true}' },
      bodySize: "unknown",
      shape: true,
    },
  ])(
    "preserves literal request-body availability for repeated actions: $name",
    ({ postData, bodySize = 12, served = false, shape = false }) => {
      const capture = timedCaptureEvidence([
        ["GET", "/api/books", [archived(false), SECOND_BOOK]],
        ["GET", "/api/books/1", archived(false)],
        ["GET", "/api/books/2", SECOND_BOOK],
        ["POST", "/api/books/1/archive", archived(true)],
        ["GET", "/api/books/1", archived(true)],
        ["POST", "/api/books/1/archive", archived(true)],
        ["GET", "/api/books/1", archived(true)],
      ]);
      const result = capture.normalized_result as {
        records: {
          reported: { request: { postData?: unknown; bodySize?: unknown } };
        }[];
      };
      const request = result.records[5]!.reported.request;
      request.bodySize = bodySize;
      if (postData === undefined) delete request.postData;
      else request.postData = postData;
      if (shape) {
        result.records[3]!.reported.request.bodySize = bodySize;
        result.records[3]!.reported.request.postData = postData;
      }
      const { source, state } = environmentStateServeInputs(
        environmentStateServeFixture(
          analysisViewCaptureEvidence(
            webNetworkCaptureSchema.parse(capture.normalized_result),
          ),
        ),
      );
      expect(state.writes.get("post_books_archive_by_id")).toMatchObject({
        served,
      });
      const tool = source.manifest.tools.find(
        ({ name }) => name === "post_books_archive_by_id",
      );
      expect(tool).toBeDefined();
      if (shape)
        expect(tool?.body_shape).toMatchObject({
          properties: { archived: "boolean" },
        });
      else if (bodySize === 0) expect(tool?.body_shape).toBeNull();
    },
  );
});

it("keeps a stored array-of-object field as an ordinary update body", () => {
  const original = { ...FIRST_BOOK, tags: [{ id: 7, name: "Old" }] };
  const second = { ...SECOND_BOOK, tags: [{ id: 8, name: "Other" }] };
  const changed = { ...original, tags: [{ id: 9, name: "Recorded" }] };
  const books = servedFrom([
    ["GET", "/api/books", [original, second]],
    ["GET", "/api/books/1", original],
    ["GET", "/api/books/2", second],
    ["PATCH", "/api/books/1", changed, 200, { tags: changed.tags }],
    ["GET", "/api/books/1", changed],
    ["GET", "/api/books", [changed, second]],
  ]);
  expect(books.state.writes.get("patch_books_by_id")).toMatchObject({
    served: true,
  });
  expect(books.state.writes.get("patch_books_by_id")?.body).not.toHaveProperty(
    "envelope",
  );
  const tags = [
    { id: 10, name: "Caller" },
    { id: 11, name: "Second tag" },
  ];
  expect(
    books.answer("patch_books_by_id", { id: "2", body: { tags } }).body,
  ).toMatchObject({ id: 2, tags });
});

const TOKENS = ["Abcdef0123456789A", "Abcdef0123456789B", "Abcdef0123456789C"];

it("withholds a generated create token copied into a nested constant", () => {
  const first = { ...FIRST_BOOK, version: TOKENS[0]! };
  const second = { ...SECOND_BOOK, version: TOKENS[1]! };
  const third = {
    ...book(3, "Created", bookClock(3)),
    version: TOKENS[2]!,
    metadata: { versions: [{ value: TOKENS[2]! }] },
  };
  const books = servedFrom([
    ["GET", "/api/books", [first, second]],
    ["GET", "/api/books/1", first],
    ["GET", "/api/books/2", second],
    ["POST", "/api/books", third, 201, { name: "Created" }],
    ["GET", "/api/books/3", third],
  ]);
  expect(books.state.writes.get("post_books")).toMatchObject({
    served: false,
    reason: "unexplained-change",
  });
});

it("withholds an update token already present in a nested unchanged field", () => {
  const first = {
    ...FIRST_BOOK,
    version: TOKENS[0]!,
    metadata: { versions: [TOKENS[1]!] },
  };
  const second = { ...SECOND_BOOK, version: TOKENS[2]!, metadata: {} };
  const changed = { ...first, version: TOKENS[1]! };
  const books = servedFrom([
    ["GET", "/api/books", [first, second]],
    ["GET", "/api/books/1", first],
    ["GET", "/api/books/2", second],
    ["PATCH", "/api/books/1", changed, 200, {}],
    ["GET", "/api/books/1", changed],
    ["GET", "/api/books", [changed, second]],
  ]);
  expect(books.state.writes.get("patch_books_by_id")).toMatchObject({
    served: false,
  });
});

it.each(["2", "02"])(
  "withholds a bulk acknowledgement with string count %s",
  (deleted) => {
    const rows: TimedCaptureRow[] = [
      [
        "GET",
        "/api/books",
        [
          { ...FIRST_BOOK, id: 10 },
          { ...SECOND_BOOK, id: 20 },
        ],
      ],
      ["GET", "/api/books/10", { ...FIRST_BOOK, id: 10 }],
      ["GET", "/api/books/20", { ...SECOND_BOOK, id: 20 }],
      ["DELETE", "/api/books", { deleted }, 200, { ids: [10, 20] }],
      ["GET", "/api/books/10", BOOK_NOT_FOUND, 404],
      ["GET", "/api/books/20", BOOK_NOT_FOUND, 404],
      ["GET", "/api/books", []],
    ];
    expect(servedFrom(rows).state.writes.get("delete_books")).toMatchObject({
      served: false,
      reason: "body-unusable",
    });
  },
);

const nestedClockRows = (edit: {
  [key: string]: string;
}): TimedCaptureRow[] => {
  const first = {
    ...FIRST_BOOK,
    edit: {
      at: FIRST_BOOK.created_at!,
      seen_at: FIRST_BOOK.created_at!,
      by: "alice",
    },
  };
  const second = {
    ...SECOND_BOOK,
    edit: {
      at: SECOND_BOOK.created_at!,
      seen_at: SECOND_BOOK.created_at!,
      by: "alice",
    },
  };
  const third = {
    ...book(3, "Third", bookClock(3)),
    edit: { at: bookClock(3), seen_at: bookClock(3), by: "alice" },
  };
  const fourth = { ...book(4, "Fourth", bookClock(5)), edit };
  return [
    ["GET", "/api/books", [first, second]],
    ["GET", "/api/books/1", first],
    ["GET", "/api/books/2", second],
    ["POST", "/api/books", third, 201, { name: "Third" }],
    ["GET", "/api/books/3", third],
    ["POST", "/api/books", fourth, 201, { name: "Fourth" }],
    ["GET", "/api/books/4", fourth],
    ["GET", "/api/books", [first, second, third, fourth]],
  ];
};

it.each<{ name: string; edit: { [key: string]: string } }>([
  {
    name: "changed editor",
    edit: { at: bookClock(5), seen_at: bookClock(5), by: "bob" },
  },
  {
    name: "added member",
    edit: {
      at: bookClock(5),
      seen_at: bookClock(5),
      by: "alice",
      role: "admin",
    },
  },
  { name: "omitted member", edit: { at: bookClock(5), seen_at: bookClock(5) } },
  {
    name: "different clock values",
    edit: { at: bookClock(5), seen_at: bookClock(6), by: "alice" },
  },
])(
  "withholds creates whose nested-clock renderer cannot reproduce a later $name",
  ({ edit }) => {
    expect(
      servedFrom(nestedClockRows(edit)).state.writes.get("post_books"),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
  },
);

it("serves successive creates whose complete nested-clock objects are reproducible", () => {
  const books = servedFrom(
    nestedClockRows({ at: bookClock(5), seen_at: bookClock(5), by: "alice" }),
  );
  expect(books.state.writes.get("post_books")).toMatchObject({ served: true });
  const result = books.answer("post_books", { body: { name: "Caller" } });
  expect(result.body).toMatchObject({ name: "Caller", edit: { by: "alice" } });
  const edit = (result.body as { edit: { at: string; seen_at: string } }).edit;
  expect(edit.at).toBe(edit.seen_at);
});

it.each([0, 1])(
  "checks the complete nested-clock update for a %s-second member difference",
  (seconds) => {
    const first = {
      ...FIRST_BOOK,
      edit: { at: bookClock(-8), seen_at: bookClock(-8), by: "alice" },
    };
    const second = {
      ...SECOND_BOOK,
      edit: { at: bookClock(-7), seen_at: bookClock(-7), by: "alice" },
    };
    const changed = {
      ...renamedBook(first, "Renamed", 3),
      edit: { at: bookClock(3), seen_at: bookClock(3 + seconds), by: "alice" },
    };
    const books = servedFrom([
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      ["PATCH", "/api/books/1", changed, 200, { name: "Renamed" }],
      ["GET", "/api/books/1", changed],
      ["GET", "/api/books", [changed, second]],
    ]);
    expect(books.state.writes.get("patch_books_by_id")).toMatchObject({
      served: seconds === 0,
    });
    if (seconds === 0) {
      const result = books.answer("patch_books_by_id", {
        id: "2",
        body: { name: "Caller" },
      });
      expect(result.body).toMatchObject({ edit: { by: "alice" } });
      const edit = (result.body as { edit: { at: string; seen_at: string } })
        .edit;
      expect(edit.at).toBe(edit.seen_at);
    }
  },
);

it.each([
  { bulk: false, unequal: false },
  { bulk: true, unequal: false },
  { bulk: false, unequal: true },
  { bulk: true, unequal: true },
])(
  "validates the write response before its stored clock spelling (bulk=$bulk, unequal=$unequal)",
  ({ bulk, unequal }) => {
    const edit = (seconds: number, fraction: string) => ({
      at: new Date(bookClock(seconds)).toISOString().replace(".000Z", fraction),
      seen_at: new Date(bookClock(seconds))
        .toISOString()
        .replace(".000Z", fraction),
      by: "alice",
    });
    const first = { ...FIRST_BOOK, edit: edit(-8, ".000123Z") };
    const second = { ...SECOND_BOOK, edit: edit(-7, ".000123Z") };
    const changed = {
      ...renamedBook(first, "Renamed", 3),
      edit: {
        ...edit(3, ".000Z"),
        seen_at: new Date(bookClock(unequal ? 4 : 3)).toISOString(),
      },
    };
    const read = { ...changed, edit: edit(3, ".000123Z") };
    const books = servedFrom([
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      [
        "PATCH",
        bulk ? "/api/books" : "/api/books/1",
        bulk ? [changed] : changed,
        200,
        bulk ? [{ id: 1, name: "Renamed" }] : { name: "Renamed" },
      ],
      ["GET", "/api/books/1", read],
      ["GET", "/api/books", [read, second]],
    ]);
    const name = bulk ? "patch_books" : "patch_books_by_id";
    expect(books.state.writes.get(name)).toMatchObject({ served: !unequal });
    if (!unequal) {
      const result = books.answer(
        name,
        bulk
          ? { body: [{ id: 2, name: "Caller" }] }
          : { id: "2", body: { name: "Caller" } },
      );
      const entity = (bulk ? (result.body as unknown[])[0] : result.body) as {
        name: string;
        edit: { at: string; seen_at: string; by: string };
      };
      expect(entity).toMatchObject({ name: "Caller", edit: { by: "alice" } });
      expect(entity.edit.at).toBe(entity.edit.seen_at);
      expect(entity.edit.at).toMatch(/\.\d{3}Z$/u);
    }
  },
);

it("keeps a create's nested reference pinned when an unobserved call varies its id", () => {
  const card = (id: number, name: string, collection_id: number) => ({
    id,
    name,
    collection_id,
    collection: {
      id: collection_id,
      name: collection_id === 8 ? "Ledger" : "Other",
    },
  });
  const first = card(1, "First", 8);
  const second = card(2, "Second", 9);
  const third = card(3, "Third", 8);
  const fourth = card(4, "Fourth", 9);
  const cards = servedFrom([
    ["GET", "/api/cards", [first, second]],
    ["GET", "/api/cards/1", first],
    ["GET", "/api/cards/2", second],
    ["POST", "/api/cards", third, 201, { name: "Third", collection_id: 8 }],
    ["GET", "/api/cards/3", third],
    ["POST", "/api/cards", fourth, 201, { name: "Fourth", collection_id: 9 }],
  ]);
  const plan = cards.state.writes.get("post_cards");
  expect(plan?.body?.fixed).toContainEqual({
    member: "collection_id",
    sent: 8,
  });
  expect(plan).toMatchObject({ served: false });
  const catalog = servedCatalog(cards.source, cards.state, "cards");
  if (!catalog.ok) throw catalog.error;
  expect(catalog.value.tools.map(({ name }) => name)).not.toContain(
    "post_cards",
  );
});

it("refuses a create's unsupported dependent state even when an unobserved call varied it", () => {
  const post = (id: number, status: string, published_at: string | null) => ({
    id,
    title: `Post ${String(id)}`,
    status,
    published_at,
  });
  const first = post(1, "published", "2026-10-01T09:00:00Z");
  const second = post(2, "published", "2026-10-01T10:00:00Z");
  const draft = post(3, "draft", null);
  const posts = servedFrom([
    ["GET", "/api/posts", [first, second]],
    ["GET", "/api/posts/1", first],
    ["GET", "/api/posts/2", second],
    ["POST", "/api/posts", draft, 201, { title: "Post 3", status: "draft" }],
    ["GET", "/api/posts/3", draft],
    ["POST", "/api/posts", "", 204, { title: "Post 4", status: "published" }],
  ]);
  expect(posts.state.writes.get("post_posts")).toMatchObject({ served: true });
  const before = posts.snapshot();
  expect(
    posts.refusal("post_posts", {
      body: { title: "Caller", status: "published" },
    }),
  ).toMatchObject({ code: "invalid_request" });
  expect(posts.snapshot()).toBe(before);
  expect(
    posts.answer("post_posts", {
      body: { title: "Caller", status: "draft" },
    }).body,
  ).toMatchObject({ title: "Caller", status: "draft", published_at: null });
});

it("drops a write's confirmation when its read view later disproves learned array sorting", () => {
  const tagged = (book: typeof FIRST_BOOK, tags: string[]) => ({
    ...book,
    tags,
  });
  const first = tagged(FIRST_BOOK, ["alpha", "beta"]);
  const second = tagged(SECOND_BOOK, ["gamma", "omega"]);
  const written = tagged(SECOND_BOOK, ["zeta", "delta"]);
  const books = servedFrom([
    ["GET", "/api/books", [first, second]],
    ["GET", "/api/books/1", first],
    ["GET", "/api/books/2", second],
    ["PATCH", "/api/books/2", written, 200, { tags: ["zeta", "delta"] }],
    ["GET", "/api/books/2", tagged(SECOND_BOOK, ["delta", "zeta"])],
    ["GET", "/api/books/2", written],
  ]);
  expect(books.state.views.get("get_books_by_id")).toMatchObject({
    shape: "recorded",
  });
  expect(books.state.writes.get("patch_books_by_id")).toMatchObject({
    served: false,
    checked_record_ordinals: [],
  });
});

it("reloads an unchanged snapshot after a view with its own clock spellings disproves sorting", () => {
  const first = { ...FIRST_BOOK, tags: ["alpha", "beta"] };
  const second = { ...SECOND_BOOK, tags: ["gamma", "omega"] };
  const written = { ...second, tags: ["zeta", "delta"] };
  const rows: TimedCaptureRow[] = [
    ["GET", "/api/books", [first, second].map(offsetListed)],
    ["GET", "/api/books/1", first],
    ["GET", "/api/books/2", second],
    ["PATCH", "/api/books/2", written, 200, { tags: written.tags }],
    [
      "GET",
      "/api/books",
      [first, { ...written, tags: ["delta", "zeta"] }].map(offsetListed),
    ],
  ];
  const consistent = servedFrom(rows);
  expect(consistent.state.entities[0]?.view_fields).toContainEqual({
    tool: "get_books",
    fields: {
      created_at: offsetListed(first).created_at,
      updated_at: offsetListed(first).updated_at,
    },
  });
  expect(consistent.store.replace(consistent.store.snapshot()).ok).toBe(true);

  const books = servedFrom([
    ...rows,
    ["GET", "/api/books", [first, written].map(offsetListed)],
  ]);
  expect(books.state.views.get("get_books")).toMatchObject({
    shape: "recorded",
  });
  const snapshot = books.store.snapshot();
  expect(books.store.replace(snapshot)).toMatchObject({ ok: true });
  expect(books.store.snapshot()).toEqual(snapshot);
  expect(books.answer("get_books_by_id", { id: "1" }).body).toEqual(first);
});

it.each([
  { wrong: false, mixed: false },
  { wrong: true, mixed: false },
  { wrong: false, mixed: true },
  { wrong: true, mixed: true },
])(
  "keeps contradictions after retiring a sorted list while an item proof survives (wrong=$wrong, mixed=$mixed)",
  ({ wrong, mixed }) => {
    const first = { ...FIRST_BOOK, tags: ["alpha", "beta"] };
    const second = { ...SECOND_BOOK, tags: ["gamma", "omega"] };
    const written = { ...second, tags: ["zeta", "delta"] };
    const later = { ...first, tags: ["theta", "epsilon"] };
    const books = servedFrom([
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      ["PATCH", "/api/books/2", written, 200, { tags: written.tags }],
      ["GET", "/api/books/2", { ...written, tags: ["delta", "zeta"] }],
      ["PATCH", "/api/books/1", later, 200, { tags: later.tags }],
      [
        "GET",
        "/api/books",
        [
          { ...later, tags: wrong ? ["wrong", "values"] : later.tags },
          mixed ? { ...written, tags: ["delta", "zeta"] } : written,
        ],
      ],
    ]);
    expect(books.state.views.get("get_books")).toMatchObject({
      shape: "recorded",
    });
    expect(books.state.writes.get("patch_books_by_id")).toMatchObject({
      served: !wrong,
      checked_record_ordinals: [4],
      contradicted_by: wrong ? 6 : null,
    });
  },
);

it("drops state with no surviving view while preserving another type and snapshot reload", () => {
  const first = { ...FIRST_BOOK, tags: ["alpha", "beta"] };
  const second = { ...SECOND_BOOK, tags: ["gamma", "omega"] };
  const written = { ...second, tags: ["zeta", "delta"] };
  const authors = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ];
  const books = servedFrom([
    ["GET", "/api/books", [first, second]],
    ["GET", "/api/authors", authors],
    ["PATCH", "/api/books/2", written, 200, { tags: written.tags }],
    ["GET", "/api/books", [first, { ...written, tags: ["delta", "zeta"] }]],
    ["GET", "/api/books", [first, written]],
  ]);
  expect(books.state.views.get("get_books")).toMatchObject({
    shape: "recorded",
  });
  expect(books.state.types.map((type) => type.collection_template)).toEqual([
    "/api/authors",
  ]);
  expect(books.state.entities.map((entity) => entity.type)).toEqual([
    "/api/authors",
    "/api/authors",
  ]);
  expect(books.store.replace(books.store.snapshot()).ok).toBe(true);
  expect(books.answer("get_authors").body).toEqual(authors);
});

it.each([false, true])(
  "checks later writes through a retired sorted view without adding proof (wrong values: %s)",
  (wrong) => {
    const first = { ...FIRST_BOOK, tags: ["alpha", "beta"] };
    const second = { ...SECOND_BOOK, tags: ["gamma", "omega"] };
    const written = { ...second, tags: ["zeta", "delta"] };
    const later = { ...first, tags: ["theta", "epsilon"] };
    const books = servedFrom([
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      ["PATCH", "/api/books/2", written, 200, { tags: written.tags }],
      ["GET", "/api/books/2", { ...written, tags: ["delta", "zeta"] }],
      ["GET", "/api/books", [first, written]],
      ["PATCH", "/api/books/1", later, 200, { tags: later.tags }],
      [
        "GET",
        "/api/books",
        [
          { ...later, tags: wrong ? ["wrong", "values"] : later.tags },
          { ...written, tags: ["delta", "zeta"] },
        ],
      ],
    ]);
    expect(books.state.views.get("get_books")).toMatchObject({
      shape: "recorded",
    });
    expect(books.state.writes.get("patch_books_by_id")).toMatchObject({
      served: !wrong,
      checked_record_ordinals: [4],
      contradicted_by: wrong ? 7 : null,
    });
  },
);

it("withholds varied create states whose dependent fields still copy the first create", () => {
  const first = { ...FIRST_BOOK, status: "draft", closed_at: null };
  const second = {
    ...SECOND_BOOK,
    status: "closed",
    closed_at: SECOND_BOOK.created_at!,
  };
  const third = {
    ...book(3, "Third", "2026-10-01T10:00:00Z"),
    status: "closed",
    closed_at: SECOND_BOOK.created_at!,
  };
  const fourth = {
    ...book(4, "Fourth", bookClock(4)),
    status: "draft",
    closed_at: null,
  };
  const fifth = {
    ...book(5, "Fifth", bookClock(6)),
    status: "closed",
    closed_at: bookClock(6),
  };
  const books = servedFrom([
    ["GET", "/api/books", [first, second, third]],
    ["GET", "/api/books/1", first],
    ["GET", "/api/books/2", second],
    ["GET", "/api/books/3", third],
    ["POST", "/api/books", fourth, 201, { name: "Fourth", status: "draft" }],
    ["GET", "/api/books/4", fourth],
    ["POST", "/api/books", fifth, 201, { name: "Fifth", status: "closed" }],
  ]);
  expect(books.state.writes.get("post_books")).toMatchObject({ served: false });
});
