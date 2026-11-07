import { describe, expect, it } from "vitest";
import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Two held books and a create whose `mixed` joins the generated id and the sent slug; the held books put `heldPrefix` before theirs. */
const slugBooks = (heldPrefix = "") => {
  const item = (id: number, slug: string, prefix = "") => ({
    id,
    code: slug,
    url: `/${slug}`,
    mixed: `/${id}/${prefix}${slug}`,
  });
  const first = item(1, "first-slug", heldPrefix);
  const second = item(2, "second-slug", heldPrefix);
  const third = item(3, "abcdefgh");
  return servedFrom([
    ["GET", "/api/books", [first, second]],
    ["GET", "/api/books/1", first],
    ["GET", "/api/books/2", second],
    ["POST", "/api/books", third, 201, { customSlug: "abcdefgh" }],
    ["GET", "/api/books/3", third],
  ]);
};

describe("assigned values preserve every recorded relation", () => {
  it("rebuilds a field a generated id and a copied member compose, accepting any value of the member", () => {
    const books = slugBooks();
    expect(books.state.writes.get("post_books")).toMatchObject({
      served: true,
      body: { fixed: [] },
    });
    expect(
      books.answer("post_books", { body: { customSlug: "ijklmnop" } }).body,
    ).toMatchObject({
      code: "ijklmnop",
      url: "/ijklmnop",
      mixed: expect.stringMatching(/^\/\d+\/ijklmnop$/u),
    });
  });

  it("freezes a copied member when another template would retain its old value", () => {
    // The held books spell `mixed` otherwise, so no composition explains it and a template around the id keeps the slug.
    const books = slugBooks("x-");
    expect(books.state.writes.get("post_books")).toMatchObject({
      served: true,
      body: { fixed: [{ member: "customSlug", sent: "abcdefgh" }] },
    });
    expect(
      books.refusal("post_books", { body: { customSlug: "ijklmnop" } }),
    ).toMatchObject({ code: "invalid_request" });
    expect(
      books.answer("post_books", { body: { customSlug: "abcdefgh" } }).body,
    ).toMatchObject({ code: "abcdefgh", url: "/abcdefgh" });
  });

  it.each(["nested", "scalar"] as const)(
    "withholds an update whose generated scalar shares a fresh UUID with a %s field",
    (shape) => {
      const linked = (id: number, value: string) => ({
        id,
        name: "Before",
        version: value,
        link: shape === "nested" ? [{ id: value }] : value,
      });
      const first = linked(1, uuid(1));
      const second = linked(2, uuid(2));
      const after = { ...linked(1, uuid(3)), name: "After" };
      const books = servedFrom([
        ["GET", "/api/books", [first, second]],
        ["GET", "/api/books/1", first],
        ["GET", "/api/books/2", second],
        ["PATCH", "/api/books/1", after, 200, { name: "After" }],
        ["GET", "/api/books/1", after],
      ]);
      expect(books.state.writes.get("patch_books_by_id")).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
    },
  );

  it.each(["sent", "held", "request-only"] as const)(
    "withholds nested renewal linked to a %s UUID outside its generation owner",
    (source) => {
      const first = {
        id: 1,
        name: "Before",
        ownerId: uuid(3),
        rows: [{ id: uuid(1) }],
      };
      const second = {
        id: 2,
        name: "Second",
        ownerId: uuid(9),
        rows: [{ id: uuid(2) }],
      };
      const after = { ...first, name: "After", rows: [{ id: uuid(3) }] };
      // Keep the request-only alias out of the output's non-renewed fields.
      if (source === "request-only") first.ownerId = after.ownerId = uuid(8);
      const body =
        source === "sent"
          ? { name: "After", ownerId: uuid(3) }
          : source === "request-only"
            ? { name: "After", extra: { reference: uuid(3) } }
            : { name: "After" };
      const books = servedFrom([
        ["GET", "/api/books", [first, second]],
        ["GET", "/api/books/1", first],
        ["GET", "/api/books/2", second],
        ["PATCH", "/api/books/1", after, 200, body],
        ["GET", "/api/books/1", after],
      ]);
      expect(books.state.writes.get("patch_books_by_id")).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
    },
  );

  it("renews a mixed-case repeated nested identity once while preserving both spellings", () => {
    const lettered = (letter: string) =>
      `${letter.repeat(8)}-${letter.repeat(4)}-4${letter.repeat(3)}-8${letter.repeat(3)}-${letter.repeat(12)}`;
    const item = (id: number, letter: string) => ({
      id,
      name: "Before",
      rows: [{ id: lettered(letter) }, { id: lettered(letter).toUpperCase() }],
    });
    const first = item(1, "a"),
      second = item(2, "c");
    const after = { ...item(1, "b"), name: "After" };
    const books = servedFrom([
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      ["PATCH", "/api/books/1", after, 200, { name: "After" }],
      ["GET", "/api/books/1", after],
    ]);
    expect(books.state.writes.get("patch_books_by_id")).toMatchObject({
      served: true,
    });
    const answer = books.answer("patch_books_by_id", {
      id: "1",
      body: { name: "Changed" },
    }).body;
    expect(answer).toMatchObject({
      name: "Changed",
      rows: [{ id: expect.any(String) }, { id: expect.any(String) }],
    });
    const rows = (answer as { rows: { id: string }[] }).rows;
    expect(rows[0]!.id).not.toBe(lettered("a"));
    expect(rows[0]!.id).toBe(rows[0]!.id.toLowerCase());
    expect(rows[1]!.id).toBe(rows[0]!.id.toUpperCase());
  });
});
