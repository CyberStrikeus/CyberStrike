import { describe, expect, it } from "vitest";

import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";
import type { TimedCaptureRow } from "../../../tests/fixtures/analysisView.js";
import {
  BOOK_INIT_ROWS,
  FIRST_BOOK,
  SECOND_BOOK,
  THIRD_BOOK,
  renamedBook,
  type Book,
} from "../../../tests/fixtures/environmentStateWrites.js";
import { servedCatalog } from "./environmentState.js";

const RENAMED = renamedBook(FIRST_BOOK, "Renamed Book", 3);

/** An update recorded with a query the served write pins. */
const PINNED_ROWS: readonly TimedCaptureRow[] = [
  ...BOOK_INIT_ROWS,
  [
    "PATCH",
    "/api/books/1?notify=quiet",
    RENAMED,
    200,
    { name: "Renamed Book" },
  ],
  ["GET", "/api/books/1", RENAMED],
];

const LONG = "select * from shelves where ".padEnd(160, "x");
/** A book as the application stores its edition details, which a create sends otherwise. */
const edition = (book: Book) => ({
  ...book,
  format: "HC",
  query: "q1",
  featured: 1,
});
const STORED = edition(THIRD_BOOK);
/** A create wrapping its object, which stores `format`, `query` and `featured` otherwise than sent. */
const FIXED_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/books", [edition(FIRST_BOOK), edition(SECOND_BOOK)]],
  ["GET", "/api/books/1", edition(FIRST_BOOK)],
  ["GET", "/api/books/2", edition(SECOND_BOOK)],
  [
    "POST",
    "/api/books",
    STORED,
    201,
    {
      books: [
        {
          name: "Third Book",
          format: "hardcover",
          query: LONG,
          featured: true,
        },
      ],
    },
  ],
  ["GET", "/api/books/3", STORED],
];

const toolOf = (rows: readonly TimedCaptureRow[], name: string) => {
  const served = servedFrom(rows);
  const catalog = servedCatalog(served.source, served.state, "books");
  if (!catalog.ok) throw catalog.error;
  const tool = catalog.value.tools.find(
    (definition) => definition.name === name,
  );
  if (tool === undefined) throw new Error(`${name} is not served`);
  return { served, tool };
};

describe("served write queries", () => {
  it("advertises the recorded query as optional so omission reaches its default", () => {
    const { served, tool } = toolOf(PINNED_ROWS, "patch_books_by_id");
    expect(tool.inputSchema.properties["notify"]).toMatchObject({
      type: "string",
      enum: ["quiet"],
    });
    expect(tool.inputSchema.required).not.toContain("notify");
    expect(tool.description).toContain("with the recorded query notify=quiet");
    const before = served.snapshot();
    expect(
      served.refusal("patch_books_by_id", {
        id: "2",
        notify: "loud",
        body: { name: "Second Edition" },
      }).message,
    ).toContain("takes only the query its recording sent (notify=quiet)");
    expect(served.snapshot()).toBe(before);
    expect(
      served.answer("patch_books_by_id", {
        id: "2",
        body: { name: "Second Edition" },
      }),
    ).toMatchObject({ status: 200, body: { id: 2, name: "Second Edition" } });
  });

  it.each(["notify", "notify="])(
    "widens an empty pinned query literal in %s while enforcing it at runtime",
    (query) => {
      const rows: TimedCaptureRow[] = [
        ...BOOK_INIT_ROWS,
        [
          "PATCH",
          `/api/books/1?${query}`,
          RENAMED,
          200,
          { name: "Renamed Book" },
        ],
        ["GET", "/api/books/1", RENAMED],
      ];
      const { served, tool } = toolOf(rows, "patch_books_by_id");
      expect(tool.inputSchema.properties["notify"]).not.toHaveProperty("enum");
      const before = served.snapshot();
      expect(
        served.call("patch_books_by_id", {
          id: "2",
          notify: "yes",
          body: { name: "Changed" },
        }).ok,
      ).toBe(false);
      expect(served.snapshot()).toBe(before);
      expect(
        served.call("patch_books_by_id", { id: "2", body: { name: "Changed" } })
          .ok,
      ).toBe(true);
    },
  );
});

describe("served write bodies", () => {
  it("advertises an empty fixed body member without an empty literal, retaining its runtime guard", () => {
    const rows: TimedCaptureRow[] = [
      ...FIXED_ROWS.slice(0, 3),
      [
        "POST",
        "/api/books",
        STORED,
        201,
        {
          books: [
            { name: "Third Book", format: "", query: LONG, featured: true },
          ],
        },
      ],
      ...FIXED_ROWS.slice(4),
    ];
    const { served, tool } = toolOf(rows, "post_books");
    expect(JSON.stringify(tool.inputSchema)).not.toContain('"const":""');
    const before = served.snapshot();
    expect(
      served.call("post_books", {
        body: {
          books: [
            { name: "Fourth", format: "other", query: LONG, featured: true },
          ],
        },
      }).ok,
    ).toBe(false);
    expect(served.snapshot()).toBe(before);
    expect(
      served.call("post_books", {
        body: {
          books: [{ name: "Fourth", format: "", query: LONG, featured: true }],
        },
      }).ok,
    ).toBe(true);
  });

  it("shows the values a create fixes and the object it wraps, in its schema, description and refusals", () => {
    const { served, tool } = toolOf(FIXED_ROWS, "post_books");
    expect(tool.inputSchema.properties["body"]).toMatchObject({
      type: "object",
      required: ["books"],
      properties: {
        books: {
          type: "array",
          items: {
            type: "object",
            properties: {
              format: { const: "hardcover" },
              query: {
                description:
                  "Must equal the recorded value, which is too long to show here.",
              },
              featured: { description: "Must be true, the recorded value." },
            },
          },
        },
      },
    });
    expect(JSON.stringify(tool.inputSchema)).not.toContain(LONG);
    expect(tool.description).toContain('one object wrapped as {"books":[{…}]}');
    expect(tool.description).toContain('"format" only as "hardcover"');
    expect(tool.description).toContain('"query" only as recorded');
    expect(
      served.refusal("post_books", {
        body: {
          books: [
            {
              name: "Fourth",
              format: "paperback",
              query: LONG,
              featured: true,
            },
          ],
        },
      }).message,
    ).toContain('accepted only with the value the capture sent, "hardcover"');
  });
});
