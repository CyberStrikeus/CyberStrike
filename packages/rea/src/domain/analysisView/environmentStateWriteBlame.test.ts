import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  FIRST_BOOK,
  SECOND_BOOK,
  THIRD_BOOK,
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

/** A book as its item reads show it, with the shelves its write responses leave out. */
const shelved = (entry: Book): Book => ({
  ...entry,
  shelves: [{ id: 7, name: "Main Hall" }],
});

const RENAMED_THIRD = renamedBook(THIRD_BOOK, "Renamed Third", 4);

/** Shelved books, a create and an update whose responses leave the shelves out, then a read of the created book. */
const createdThenRenamed = (
  renamed: Book,
  read: Book = shelved(RENAMED_THIRD),
): TimedCaptureRow[] => [
  ["GET", "/api/books", [shelved(FIRST_BOOK), shelved(SECOND_BOOK)]],
  ["GET", "/api/books/1", shelved(FIRST_BOOK)],
  ["GET", "/api/books/2", shelved(SECOND_BOOK)],
  ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
  ["PATCH", "/api/books/3", renamed, 200, { name: "Renamed Third" }],
  ["GET", "/api/books/3", read],
];

describe("blame for a failed item read", () => {
  it("confirms no update by a read showing a field its response showed and the state lacks, with no rule for it", () => {
    const reviewed = (entry: Book): Book => ({ ...entry, reviewedBy: "rea" });
    const rows = createdThenRenamed(
      reviewed(RENAMED_THIRD),
      reviewed(shelved(RENAMED_THIRD)),
    );
    // The shelves no write's answer shows stay the create's to answer for.
    expect(planOf(rows, "post_books")).toMatchObject({
      reason: "contradicted",
      contradicted_by: 5,
    });
    expect(planOf(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "unconfirmed",
      contradicted_by: null,
    });
  });

  it("contradicts the create that left a field out and serves the update whose own fields the read shows", () => {
    const rows = createdThenRenamed(RENAMED_THIRD);
    expect(planOf(rows, "post_books")).toMatchObject({
      reason: "contradicted",
      contradicted_by: 5,
    });
    expect(planOf(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });

  it("contradicts an update whose response shows a field it did not send otherwise than the read", () => {
    const covered = (entry: Book, cover: string): Book => ({ ...entry, cover });
    const rows = createdThenRenamed(
      covered(RENAMED_THIRD, "plain"),
      covered(shelved(RENAMED_THIRD), "framed"),
    );
    rows[3] = [
      "POST",
      "/api/books",
      covered(THIRD_BOOK, "plain"),
      201,
      { name: "Third Book" },
    ];
    expect(planOf(rows, "patch_books_by_id")).toMatchObject({
      reason: "contradicted",
      contradicted_by: 5,
    });
  });

  it("contradicts the create, not as a side effect, when a refused update's outcome is all the read can blame", () => {
    const paged = (entry: Book, pages: number): Book => ({ ...entry, pages });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [shelved(paged(FIRST_BOOK, 3))]],
      ["GET", "/api/books/1", shelved(paged(FIRST_BOOK, 3))],
      ["POST", "/api/books", paged(THIRD_BOOK, 0), 201, { name: "Third Book" }],
      // The page count changes unsent by no rule, so the update is refused and its outcome taken as recorded.
      [
        "PUT",
        "/api/books/3",
        paged(renamedBook(THIRD_BOOK, "Renamed Third", 3), 12),
        200,
        { name: "Renamed Third" },
      ],
      [
        "GET",
        "/api/books/3",
        shelved(paged(renamedBook(THIRD_BOOK, "Renamed Third", 3), 12)),
      ],
    ];
    expect(planOf(rows, "put_books_by_id")).toMatchObject({
      reason: "unexplained-change",
    });
    expect(planOf(rows, "post_books")).toMatchObject({
      reason: "contradicted",
      contradicted_by: 4,
    });
  });

  it("contradicts a create whose entity a read of another collection newly embeds", () => {
    const page = { id: 8, title: "New page", book_id: 1 };
    const old = { id: 7, title: "Old page", book_id: 1 };
    const withPages = (pages: readonly (typeof page)[]): Book => ({
      ...FIRST_BOOK,
      pages: pages.map(({ id, title }) => ({ id, title })),
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books/1", withPages([old])],
      ["GET", "/api/pages/7", old],
      ["POST", "/api/pages", page, 201, { title: "New page", book_id: 1 }],
      ["GET", "/api/pages/8", page],
      ["GET", "/api/books/1", withPages([old, page])],
    ];
    expect(planOf(rows, "post_pages")).toMatchObject({
      reason: "contradicted",
      contradicted_by: 4,
    });
  });
});

describe("differences a failed item read cannot pin on one write", () => {
  it("contradicts an update when the read differs on a field the state holds and no update wrote", () => {
    const staged = (entry: Book, status: string): Book => ({
      ...entry,
      status,
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [staged(FIRST_BOOK, "published")]],
      ["GET", "/api/books/1", staged(FIRST_BOOK, "published")],
      [
        "POST",
        "/api/books",
        staged(THIRD_BOOK, "draft"),
        201,
        { name: "Third Book" },
      ],
      [
        "PATCH",
        "/api/books/3",
        {
          id: 3,
          name: "Renamed Third",
          slug: "renamed-third",
          updated_at: RENAMED_THIRD.updated_at!,
        },
        200,
        { name: "Renamed Third" },
      ],
      ["GET", "/api/books/3", staged(RENAMED_THIRD, "review")],
    ];
    expect(planOf(rows, "patch_books_by_id")).toMatchObject({
      reason: "contradicted",
      contradicted_by: 4,
    });
  });

  it("does not excuse a side effect a refused update's answer did not show", () => {
    const counted = (
      entry: Book,
      page_count: number,
      revision: number,
    ): Book => ({
      ...entry,
      page_count,
      revision,
    });
    const renamed = { ...FIRST_BOOK, name: "Renamed" };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books/1", counted(FIRST_BOOK, 2, 6)],
      ["GET", "/api/books/1/pages/5", { id: 5, title: "Old page" }],
      [
        "POST",
        "/api/books/1/pages",
        { id: 6, title: "New page" },
        201,
        { title: "New page" },
      ],
      ["GET", "/api/books/1/pages/6", { id: 6, title: "New page" }],
      // The revision jumps by no rule, so the update is refused; its answer leaves the page count out.
      [
        "PUT",
        "/api/books/1",
        { id: 1, name: "Renamed", revision: 9 },
        200,
        { name: "Renamed" },
      ],
      ["GET", "/api/books/1", counted(renamed, 3, 9)],
    ];
    expect(planOf(rows, "put_books_by_id")).toMatchObject({
      reason: "unexplained-change",
    });
    expect(planOf(rows, "post_books_pages_by_id")).toMatchObject({
      reason: "side-effect",
    });
  });

  it("does not take a small id and a short string another read shows for the created entity", () => {
    const note = { id: 3, kind: "memo" };
    const authored = (id: number): Book => ({
      ...FIRST_BOOK,
      authors: [{ id, kind: "memo" }],
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books/1", authored(2)],
      ["GET", "/api/notes/1", { id: 1, kind: "memo" }],
      ["POST", "/api/notes", note, 201, { kind: "memo" }],
      ["GET", "/api/notes/3", note],
      ["GET", "/api/books/1", authored(3)],
    ];
    expect(planOf(rows, "post_notes")).toMatchObject({
      served: true,
      checked_record_ordinals: [3],
    });
  });

  it("contradicts a create whose entity a read of another collection holds directly in a field", () => {
    const page = { id: 8, title: "Chapter One Draft", book_id: 1 };
    const latest = (id: number, title: string): Book => ({
      ...FIRST_BOOK,
      latest_page: { id, title },
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books/1", latest(7, "Prologue Notes")],
      ["GET", "/api/pages/7", { id: 7, title: "Prologue Notes", book_id: 1 }],
      ["POST", "/api/pages", page, 201, { title: page.title, book_id: 1 }],
      ["GET", "/api/pages/8", page],
      ["GET", "/api/books/1", latest(8, page.title)],
    ];
    expect(planOf(rows, "post_pages")).toMatchObject({
      reason: "contradicted",
      contradicted_by: 4,
    });
  });
});
