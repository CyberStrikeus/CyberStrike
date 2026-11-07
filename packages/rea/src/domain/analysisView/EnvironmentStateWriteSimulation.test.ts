import { StateRecordChronology } from "./StateRecordChronology.js";
import { OmittedFields } from "./environmentStateWriteOmitted.js";
import { checkedLines, servedLine } from "./environmentStateCheckedLines.js";
import { describe, expect, it, vi } from "vitest";

import {
  timedCaptureEvidence,
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  BOOK_INIT_ROWS,
  BOOK_NOT_FOUND,
  FIRST_BOOK,
  SECOND_BOOK,
  THIRD_BOOK,
  book,
  bookClock,
  environmentStateViewOf,
  renamedBook,
  type Book,
} from "../../../tests/fixtures/environmentStateWrites.js";
import type { JsonValue } from "../jsonValue.js";
import { ok } from "../result.js";
import {
  checkItemRead,
  itemTarget,
  SimulatedState,
} from "./environmentStateWriteChecks.js";
import { UnseenEntities } from "./environmentStateWriteAdoption.js";
import type { StateItemView } from "./environmentStateRules.js";
import {
  laterObservation,
  type ObservationSearch,
} from "./environmentStateWriteObserve.js";
import { updatedFields } from "./environmentStateWriteApply.js";
import {
  retainFixed,
  retainCreateExemplar,
  type EffectContext,
} from "./environmentStateWriteEffects.js";

/** The plan the gate gives `tool` over a capture of `rows`. */
const gated = (rows: readonly TimedCaptureRow[], tool: string) => {
  const { writes } = environmentStateViewOf(timedCaptureEvidence(rows));
  const plan = writes.find((candidate) => candidate.tool === tool);
  if (plan === undefined) throw new Error(`The gate planned no ${tool}`);
  return plan;
};

const RENAMED = renamedBook(FIRST_BOOK, "Renamed Book", 3);

/** A book whose constant names organisation 1, created at exchange `seconds`. */
const tiedToOrgOne = (id: number, name: string, seconds: number): Book => ({
  ...book(id, name, bookClock(seconds)),
  org: "/orgs/1",
});

/**
 * Two organisations, a create tied to the first by a constant that names it, then the same constant
 * recorded under the second. `confirmOwn` also reads the created book back from the first.
 */
const tiedCreateRows = (confirmOwn: boolean): TimedCaptureRow[] => {
  const alpha = { ...book(1, "Alpha", "2026-10-01T09:00:00Z"), org: "/orgs/1" };
  const beta = { ...book(10, "Beta", "2026-10-01T10:00:00Z"), org: "/orgs/2" };
  const made = tiedToOrgOne(2, "Made", 4);
  const other = tiedToOrgOne(11, "Other", confirmOwn ? 6 : 5);
  const rows: TimedCaptureRow[] = [
    ["GET", "/api/orgs/1/books", [alpha]],
    ["GET", "/api/orgs/2/books", [beta]],
    ["GET", "/api/orgs/1/books/1", alpha],
    ["GET", "/api/orgs/2/books/10", beta],
    ["POST", "/api/orgs/1/books", made, 201, { name: "Made" }],
  ];
  if (confirmOwn) rows.push(["GET", "/api/orgs/1/books/2", made]);
  rows.push(
    ["POST", "/api/orgs/2/books", other, 201, { name: "Other" }],
    ["GET", "/api/orgs/2/books/11", other],
  );
  return rows;
};

/** A book whose constant names organisation `acme1`, created at exchange `seconds`. */
const tiedToAcme = (id: number, name: string, seconds: number): Book => ({
  ...book(id, name, bookClock(seconds)),
  team: "/orgs/uid/acme1",
});

/** The create plan the gate gives a capture of `rows` when the segment after `uid` is a parameter. */
const acmeCreate = (rows: readonly TimedCaptureRow[]) => {
  const { writes } = environmentStateViewOf(timedCaptureEvidence(rows), [
    "after-uid-literal",
  ]);
  const plan = writes.find((candidate) => candidate.effect === "create");
  if (plan === undefined) throw new Error("The gate planned no create");
  return plan;
};

describe("reads compared as the served environment answers them", () => {
  /** Item reads in a `{data, revision}` envelope, a rename, then a read recorded at `revision`. */
  const renamedInEnvelope = (revision: string): TimedCaptureRow[] => [
    ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
    ["GET", "/api/books/1", { data: FIRST_BOOK, revision: "r1" }],
    ["GET", "/api/books/2", { data: SECOND_BOOK, revision: "r1" }],
    ["PATCH", "/api/books/1", RENAMED, 200, { name: "Renamed Book" }],
    ["GET", "/api/books/1", { data: RENAMED, revision }],
  ];

  it("contradicts a write when an item read's envelope differs from the one served", () => {
    expect(gated(renamedInEnvelope("r2"), "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "contradicted",
      contradicted_by: 4,
    });
    expect(gated(renamedInEnvelope("r1"), "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
  });

  /** A list in a `{items, revision}` envelope, a create, then the list recorded at `revision`. */
  const createdInEnvelope = (revision: string): TimedCaptureRow[] => [
    ["GET", "/api/books", { items: [FIRST_BOOK, SECOND_BOOK], revision: "r1" }],
    ["GET", "/api/books/1", FIRST_BOOK],
    ["GET", "/api/books/2", SECOND_BOOK],
    ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
    [
      "GET",
      "/api/books",
      { items: [FIRST_BOOK, SECOND_BOOK, THIRD_BOOK], revision },
    ],
  ];

  it("contradicts a write when a list's envelope differs from its served line", () => {
    expect(gated(createdInEnvelope("r2"), "post_books")).toMatchObject({
      served: false,
      reason: "contradicted",
      contradicted_by: 4,
    });
    expect(gated(createdInEnvelope("r1"), "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
  });

  /** A filtered list of both books, a delete of the second, then the filtered list recorded with `listed`. */
  const deletedFromFiltered = (listed: readonly Book[]): TimedCaptureRow[] => [
    ["GET", "/api/books/1", FIRST_BOOK],
    ["GET", "/api/books/2", SECOND_BOOK],
    ["GET", "/api/books?shelf=a", [FIRST_BOOK, SECOND_BOOK]],
    ["DELETE", "/api/books/2", "", 204],
    ["GET", "/api/books?shelf=a", [...listed]],
  ];

  it("contradicts a delete that a filtered list still shows, and confirms one it drops", () => {
    expect(
      gated(
        deletedFromFiltered([FIRST_BOOK, SECOND_BOOK]),
        "delete_books_by_id",
      ),
    ).toMatchObject({
      served: false,
      reason: "contradicted",
      contradicted_by: 4,
    });
    expect(
      gated(deletedFromFiltered([FIRST_BOOK]), "delete_books_by_id"),
    ).toMatchObject({ served: true, checked_record_ordinals: [4] });
  });

  /** A delete confirmed by an item read, then the filtered list recorded with its query reordered. */
  const deletedThenReordered = (listed: readonly Book[]): TimedCaptureRow[] => [
    ["GET", "/api/books/1", FIRST_BOOK],
    ["GET", "/api/books/2", SECOND_BOOK],
    ["GET", "/api/books?shelf=a&sort=id", [FIRST_BOOK, SECOND_BOOK]],
    ["DELETE", "/api/books/2", "", 204],
    ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
    ["GET", "/api/books?sort=id&shelf=a", [...listed]],
  ];

  it("checks a list read on a checked line however its query is ordered, as serving matches it", () => {
    // The item read already checked the delete, so a list still showing the book marks it a side effect.
    expect(
      gated(
        deletedThenReordered([FIRST_BOOK, SECOND_BOOK]),
        "delete_books_by_id",
      ),
    ).toMatchObject({ served: false, reason: "side-effect" });
    expect(
      gated(deletedThenReordered([FIRST_BOOK]), "delete_books_by_id"),
    ).toMatchObject({ served: true, checked_record_ordinals: [4] });
  });
});

describe("update constants", () => {
  const paper = (entry: Book, format = "PAPER"): Book => ({ ...entry, format });
  const RENAMED_PAPER = paper(RENAMED);
  const HARDCOVER = paper(
    { ...SECOND_BOOK, updated_at: bookClock(5) },
    "HARDCOVER",
  );
  /** A rename that keeps the format, then a format change the application stores in capitals. */
  const ROWS: TimedCaptureRow[] = [
    ["GET", "/api/books", [paper(FIRST_BOOK), paper(SECOND_BOOK)]],
    ["GET", "/api/books/1", paper(FIRST_BOOK)],
    ["GET", "/api/books/2", paper(SECOND_BOOK)],
    ["PATCH", "/api/books/1", RENAMED_PAPER, 200, { name: "Renamed Book" }],
    ["GET", "/api/books/1", RENAMED_PAPER],
    ["PATCH", "/api/books/2", HARDCOVER, 200, { format: "hardcover" }],
    ["GET", "/api/books/2", HARDCOVER],
  ];

  it("stores the value the call that showed a constant recorded, as serving applies the plan", () => {
    const plan = gated(ROWS, "patch_books_by_id");
    expect(plan).toMatchObject({
      served: true,
      observation: { ordinal: 3, pointer: "" },
      body: { fixed: [{ member: "format", sent: "hardcover" }] },
      checked_record_ordinals: [4, 6],
    });
    // Serving reads the plan's observation, the first update's answer, which still shows PAPER.
    const served = updatedFields(
      plan,
      { before: paper(SECOND_BOOK), observed: RENAMED_PAPER },
      {
        path: "/api/books/2",
        pathValues: new Map([["id", "2"]]),
        body: { format: "hardcover" },
        id: "2",
      },
      () => ok(bookClock(9)),
    );
    expect(served).toEqual(
      ok(paper({ ...SECOND_BOOK, updated_at: bookClock(9) }, "HARDCOVER")),
    );
  });
});

describe("write examples", () => {
  it("takes no modelled effect or exemplar from a redirected write", () => {
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["DELETE", "/api/books/2", "", 302],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["DELETE", "/api/books/2", "", 204],
      ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
    ];
    expect(gated(rows, "delete_books_by_id")).toMatchObject({
      served: true,
      exemplar_ordinal: 5,
      checked_record_ordinals: [6],
      contradicted_by: null,
    });
  });
});

describe("update rules learned from a later call", () => {
  const versioned = (entry: Book, version: number): Book => ({
    ...entry,
    version,
  });
  /** Two renames, of the first and the second book, each answered at the version given. */
  const renames = (first: number, second: number): TimedCaptureRow[] => {
    const firstAfter = versioned(
      renamedBook(FIRST_BOOK, "Renamed Book", 3),
      first,
    );
    const secondAfter = versioned(
      renamedBook(SECOND_BOOK, "Second Edition", 5),
      second,
    );
    return [
      [
        "GET",
        "/api/books",
        [versioned(FIRST_BOOK, 1), versioned(SECOND_BOOK, 1)],
      ],
      ["GET", "/api/books/1", versioned(FIRST_BOOK, 1)],
      ["GET", "/api/books/2", versioned(SECOND_BOOK, 1)],
      ["PATCH", "/api/books/1", firstAfter, 200, { name: "Renamed Book" }],
      ["GET", "/api/books/1", firstAfter],
      ["PATCH", "/api/books/2", secondAfter, 200, { name: "Second Edition" }],
      ["GET", "/api/books/2", secondAfter],
    ];
  };

  it("leaves an update unserved when one call increments a field another left as it was", () => {
    for (const [first, second] of [
      [1, 2],
      [2, 1],
    ] as const)
      expect(gated(renames(first, second), "patch_books_by_id")).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
    expect(gated(renames(2, 2), "patch_books_by_id")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([{ field: "version", rule: "increment" }]),
      checked_record_ordinals: [4, 6],
    });
  });
});

describe("slug rules learned from a later call", () => {
  /** A patch of the first book sending `name`, answered with `answered`, then a rename of the second. */
  const renames = (name: string, answered: Book): TimedCaptureRow[] => {
    const second = renamedBook(SECOND_BOOK, "Second Edition", 5);
    return [
      ...BOOK_INIT_ROWS,
      ["PATCH", "/api/books/1", answered, 200, { name }],
      ["GET", "/api/books/1", answered],
      ["PATCH", "/api/books/2", second, 200, { name: "Second Edition" }],
      ["GET", "/api/books/2", second],
    ];
  };

  it("serves a slug rule an earlier call agrees with, and not one it contradicts", () => {
    const kept = { ...FIRST_BOOK, updated_at: bookClock(3) };
    expect(
      gated(renames("First Book", kept), "patch_books_by_id"),
    ).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "slug", rule: "slug", from: "name" },
      ]),
    });
    // The application renamed the first book without following its slug.
    expect(
      gated(
        renames("Renamed Book", { ...kept, name: "Renamed Book" }),
        "patch_books_by_id",
      ),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
  });
});

describe("clock rules learned across calls", () => {
  it("serves a clock only when every recorded call changed that field", () => {
    const oldFirst = "2026-10-01T09:00:00Z";
    const oldSecond = "2026-10-01T10:00:00Z";
    const described = (
      entry: Book,
      description: string,
      publishedAt: string,
    ): Book => ({ ...entry, description, published_at: publishedAt });
    const first = described(FIRST_BOOK, "original", oldFirst);
    const second = described(SECOND_BOOK, "other", oldSecond);
    const published = described(
      renamedBook(FIRST_BOOK, "Renamed Book", 3),
      "original",
      bookClock(3),
    );
    /** The first call stamps `published_at`; `later` is the second call's answer. */
    const rows = (later: Book, sent: Book): TimedCaptureRow[] => [
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      ["PATCH", "/api/books/1", published, 200, { name: "Renamed Book" }],
      ["GET", "/api/books/1", published],
      ["PATCH", "/api/books/2", later, 200, sent],
      ["GET", "/api/books/2", later],
    ];
    // The description edit stamps `updated_at` and leaves `published_at` as it was.
    const edited = described(
      { ...SECOND_BOOK, updated_at: bookClock(5) },
      "revised",
      oldSecond,
    );
    expect(
      gated(rows(edited, { description: "revised" }), "patch_books_by_id"),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
    const stamped = described(
      renamedBook(SECOND_BOOK, "Second Edition", 5),
      "other",
      bookClock(5),
    );
    const plan = gated(
      rows(stamped, { name: "Second Edition" }),
      "patch_books_by_id",
    );
    expect(plan).toMatchObject({
      served: true,
      checked_record_ordinals: [4, 6],
    });
    expect(plan.rules).toContainEqual({
      field: "published_at",
      rule: "clock",
      format: { kind: "iso", separator: "T", fraction: 0, zone: "Z" },
    });
  });

  it("leaves a clock unserved when an earlier call kept the field a later call stamped", () => {
    const oldFirst = "2026-10-01T09:00:00Z";
    const oldSecond = "2026-10-01T10:00:00Z";
    const described = (
      entry: Book,
      description: string,
      publishedAt: string,
    ): Book => ({ ...entry, description, published_at: publishedAt });
    const first = described(FIRST_BOOK, "original", oldFirst);
    const second = described(SECOND_BOOK, "other", oldSecond);
    const edited = described(
      { ...SECOND_BOOK, updated_at: bookClock(3) },
      "revised",
      oldSecond,
    );
    const published = described(
      renamedBook(FIRST_BOOK, "Renamed Book", 5),
      "original",
      bookClock(5),
    );
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      ["PATCH", "/api/books/2", edited, 200, { description: "revised" }],
      ["GET", "/api/books/2", edited],
      ["PATCH", "/api/books/1", published, 200, { name: "Renamed Book" }],
      ["GET", "/api/books/1", published],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });
});

describe("checked lines", () => {
  /** A list page that echoes its own request path, as some APIs do. */
  const page = (path: string, items: JsonValue[]): JsonValue => ({
    path,
    items,
  });
  const PLAIN = "/api/orgs/acme1/books";
  const ENCODED = "/api/orgs/%61cme1/books";
  const OTHER = "/api/orgs/beta2/books";
  /** Three organisations' books under one templated tool, two spelling one organisation differently, then deletes each confirmed by its list. */
  const ROWS: TimedCaptureRow[] = [
    ["GET", PLAIN, page(PLAIN, [FIRST_BOOK])],
    ["GET", ENCODED, page(ENCODED, [SECOND_BOOK])],
    ["GET", OTHER, page(OTHER, [THIRD_BOOK])],
    ["GET", `${PLAIN}/1`, FIRST_BOOK],
    ["GET", `${ENCODED}/2`, SECOND_BOOK],
    ["GET", `${OTHER}/3`, THIRD_BOOK],
    ["DELETE", `${ENCODED}/2`, "", 204],
    ["GET", ENCODED, page(ENCODED, [])],
    ["DELETE", `${OTHER}/3`, "", 204],
    ["GET", OTHER, page(OTHER, [])],
  ];

  it("keeps a line's path spelling, as replay prefers the verbatim one", () => {
    const view = environmentStateViewOf(timedCaptureEvidence(ROWS), [
      "sibling-variance",
    ]);
    expect(view.views).toContainEqual(
      expect.objectContaining({
        shape: "list",
        checked_record_ordinals: [0, 1, 2],
      }),
    );
    expect(
      view.writes.find((candidate) => candidate.effect === "delete"),
    ).toMatchObject({ served: true, checked_record_ordinals: [7, 9] });
  });
  /** Organisations listed only under encoded or other spellings, a delete in each, then a list of the first spelled plainly. */
  const deletedThenPlain = (listed: readonly Book[]): TimedCaptureRow[] => {
    const third = "/api/orgs/gamma3/books";
    const fourth = book(4, "Fourth Book", "2026-10-01T11:00:00Z");
    return [
      ["GET", ENCODED, [SECOND_BOOK]],
      ["GET", OTHER, [THIRD_BOOK]],
      ["GET", third, [fourth]],
      ["GET", `${ENCODED}/2`, SECOND_BOOK],
      ["GET", `${OTHER}/3`, THIRD_BOOK],
      ["DELETE", `${ENCODED}/2`, "", 204],
      ["GET", `${ENCODED}/2`, BOOK_NOT_FOUND, 404],
      ["DELETE", `${OTHER}/3`, "", 204],
      ["GET", `${OTHER}/3`, BOOK_NOT_FOUND, 404],
      ["GET", PLAIN, [...listed]],
    ];
  };

  it("checks a read spelled plainly against the encoded line serving answers it from", () => {
    const deleteOf = (listed: readonly Book[]) =>
      environmentStateViewOf(timedCaptureEvidence(deletedThenPlain(listed)), [
        "sibling-variance",
      ]).writes.find((candidate) => candidate.effect === "delete");
    // Serving lists the encoded collection for the plain argument, which no longer holds the book.
    expect(deleteOf([SECOND_BOOK])).toMatchObject({
      served: false,
      reason: "contradicted",
      contradicted_by: 9,
    });
    expect(deleteOf([])).toMatchObject({
      served: true,
      checked_record_ordinals: [6, 8, 9],
    });
  });

  const TWICE = "/api/orgs/%61%63me1/books";
  const shelved = (entry: Book, shelf: string): Book => ({ ...entry, shelf });
  const ENCODED_LINE: TimedCaptureRow = [
    "GET",
    ENCODED,
    [shelved(FIRST_BOOK, "a"), shelved(SECOND_BOOK, "b")],
  ];
  const TWICE_LINE: TimedCaptureRow = [
    "GET",
    TWICE,
    [shelved(THIRD_BOOK, "a"), shelved(RENAMED, "b")],
  ];
  const SHELF_LINE: TimedCaptureRow = [
    "GET",
    `${ENCODED}?shelf=a`,
    [shelved(FIRST_BOOK, "a")],
  ];
  /** Lines of one organisation spelled two encoded ways, deletes each whole list confirms, then a plain read of new query values still listing the deleted book. */
  const deletedThenQueried = (
    lines: readonly TimedCaptureRow[],
    read: string,
  ): TimedCaptureRow[] => [
    ...lines,
    ["GET", OTHER, [shelved(SECOND_BOOK, "a")]],
    ["DELETE", `${TWICE}/1`, "", 204],
    ["DELETE", `${OTHER}/2`, "", 204],
    ["GET", TWICE, [shelved(THIRD_BOOK, "a")]],
    ["GET", OTHER, []],
    ["GET", read, [shelved(RENAMED, "b")]],
  ];
  const deleteOf = (rows: readonly TimedCaptureRow[]) =>
    environmentStateViewOf(timedCaptureEvidence(rows), [
      "sibling-variance",
    ]).writes.find((candidate) => candidate.effect === "delete");

  it("checks a read on new query values against the line serving ranks first by the values it shares", () => {
    const rows = deletedThenQueried(
      [
        ENCODED_LINE,
        TWICE_LINE,
        SHELF_LINE,
        ["GET", `${TWICE}?shelf=b`, [shelved(RENAMED, "b")]],
        ["GET", `${ENCODED}?limit=1`, [shelved(FIRST_BOOK, "a")]],
      ],
      `${PLAIN}?shelf=b&limit=5`,
    );
    // Serving lists the twice-encoded collection, whose `shelf=b` line the read shares a value with.
    expect(deleteOf(rows)).toMatchObject({
      served: false,
      contradicted_by: 10,
    });
  });

  it("checks a read on new query values against the line serving takes first in record order", () => {
    const rows = deletedThenQueried(
      [TWICE_LINE, ENCODED_LINE, SHELF_LINE],
      `${PLAIN}?shelf=b`,
    );
    // No line shares a value, so serving lists the collection of the line recorded first.
    expect(deleteOf(rows)).toMatchObject({
      served: false,
      contradicted_by: 8,
    });
  });
});

describe("insert rules", () => {
  it.each([false, true])(
    "uses the successful retry's page coverage, keeping an unseen update pending (later read: %s)",
    (laterRead) => {
      const beta = { id: 1, name: "Beta", note: "first" };
      const zulu = { id: 2, name: "Zulu", note: "original" };
      const patched = { ...zulu, note: "updated" };
      const alpha = { id: 3, name: "Alpha", note: "created" };
      const rows: TimedCaptureRow[] = [
        ["GET", "/api/books?limit=5", [beta, zulu]],
        ["GET", "/api/books?limit=1", [beta]],
        ["GET", "/api/books/1", beta],
        ["GET", "/api/books/2", zulu],
        ["PATCH", "/api/books/2", patched, 200, { note: "updated" }],
        ["POST", "/api/books", alpha, 201, { name: "Alpha", note: "created" }],
        // The initial page includes Zulu. Retrying the create in name order
        // replaces it with Alpha, so the passing page proves nothing of Zulu.
        ["GET", "/api/books?limit=2", [alpha, beta]],
      ];
      if (laterRead) rows.push(["GET", "/api/books/2", patched]);
      expect(gated(rows, "post_books")).toMatchObject({
        served: true,
        insert: { rule: "sorted", field: "name", direction: "ascending" },
        checked_record_ordinals: [6],
      });
      expect(gated(rows, "patch_books_by_id")).toMatchObject({
        served: laterRead,
        ...(laterRead ? {} : { reason: "unconfirmed" }),
        checked_record_ordinals: laterRead ? [7] : [],
      });
    },
  );

  it("still learns where a list places a create after an item read confirmed it", () => {
    const alpha = book(3, "Alpha", bookClock(3));
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["POST", "/api/books", alpha, 201, { name: "Alpha" }],
      ["GET", "/api/books/3", alpha],
      ["GET", "/api/books", [alpha, FIRST_BOOK, SECOND_BOOK]],
    ];
    expect(gated(rows, "post_books")).toMatchObject({
      served: true,
      insert: { rule: "sorted", field: "name", direction: "ascending" },
      checked_record_ordinals: [4, 5],
    });
  });
});

describe("reads the served answer no longer matches", () => {
  it("contradicts an update when a later read's body no longer holds the entity", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", { data: FIRST_BOOK }],
      ["GET", "/api/books/2", { data: SECOND_BOOK }],
      ["PATCH", "/api/books/1", RENAMED, 200, { name: "Renamed Book" }],
      ["GET", "/api/books/1", { data: null }],
      ["GET", "/api/books/1", { data: RENAMED }],
    ];
    // Serving still answers the renamed book, so the read that shows none is a check it fails, not one it skips.
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "contradicted",
      contradicted_by: 4,
    });
  });

  it("confirms no create by the absence of the entity a later delete removed", () => {
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      ["DELETE", "/api/books/3", "", 204],
      ["GET", "/api/books/3", BOOK_NOT_FOUND, 404],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
    ];
    expect(gated(rows, "post_books")).toMatchObject({
      served: false,
      reason: "unconfirmed",
      checked_record_ordinals: [],
    });
    expect(gated(rows, "delete_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [5, 6],
    });
  });

  it("confirms a create that lacks a field every item recording carried only when its own read leaves the field out too", () => {
    const detailed = (entry: Book): Book => ({ ...entry, detail: "x" });
    const rows = (readBack: Book): TimedCaptureRow[] => [
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", detailed(FIRST_BOOK)],
      ["GET", "/api/books/2", detailed(SECOND_BOOK)],
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      ["GET", "/api/books/3", readBack],
    ];
    // The application omits the field for this book, so serving need not invent it.
    expect(gated(rows(THIRD_BOOK), "post_books")).toMatchObject({
      served: true,
    });
    // The read shows the field the create's own answer left out: the state cannot render it.
    expect(gated(rows(detailed(THIRD_BOOK)), "post_books")).toMatchObject({
      served: false,
    });
  });
});

describe("updates whose effect later writes erase", () => {
  const versioned = (entry: Book, version: number): Book => ({
    ...entry,
    version,
  });

  it("keeps an update confirmed when a later one rewrites only part of what it changed", () => {
    const again = versioned(renamedBook(FIRST_BOOK, "Again Book", 4), 2);
    const rows: TimedCaptureRow[] = [
      [
        "GET",
        "/api/books",
        [versioned(FIRST_BOOK, 1), versioned(SECOND_BOOK, 1)],
      ],
      ["GET", "/api/books/1", versioned(FIRST_BOOK, 1)],
      ["GET", "/api/books/2", versioned(SECOND_BOOK, 1)],
      [
        "PATCH",
        "/api/books/1",
        versioned(RENAMED, 2),
        200,
        { name: "Renamed Book" },
      ],
      ["PUT", "/api/books/1", again, 200, { name: "Again Book" }],
      ["GET", "/api/books/1", again],
    ];
    // The PUT keeps the version the PATCH incremented, so the read still shows the PATCH's effect.
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });

  it("confirms no update whose changes later writes overwrote between them", () => {
    const renamed = versioned(renamedBook(FIRST_BOOK, "Again Book", 4), 2);
    const final = versioned(renamedBook(FIRST_BOOK, "Again Book", 5), 9);
    const rows: TimedCaptureRow[] = [
      [
        "GET",
        "/api/books",
        [versioned(FIRST_BOOK, 1), versioned(SECOND_BOOK, 1)],
      ],
      ["GET", "/api/books/1", versioned(FIRST_BOOK, 1)],
      ["GET", "/api/books/2", versioned(SECOND_BOOK, 1)],
      [
        "PATCH",
        "/api/books/1",
        versioned(RENAMED, 2),
        200,
        { name: "Renamed Book" },
      ],
      ["PUT", "/api/books/1", renamed, 200, { name: "Again Book" }],
      ["POST", "/api/books/1", final, 200, { version: 9 }],
      ["GET", "/api/books/1", final],
    ];
    // The PUT overwrote the name, slug and clock, the POST the version: nothing of the PATCH is left to read.
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      checked_record_ordinals: [],
    });
    expect(gated(rows, "put_books_by_id")).toMatchObject({
      checked_record_ordinals: [6],
    });
  });

  it("confirms no update whose changes a recorded outcome replaced", () => {
    const described = (
      entry: Book,
      name: string,
      at: number,
      text: string,
    ): Book => ({
      ...renamedBook(entry, name, at),
      description: text,
    });
    const final = described(FIRST_BOOK, "Other Book", 7, "z");
    const rows: TimedCaptureRow[] = [
      [
        "GET",
        "/api/books",
        [
          { ...FIRST_BOOK, description: "d" },
          { ...SECOND_BOOK, description: "d" },
        ],
      ],
      ["GET", "/api/books/1", { ...FIRST_BOOK, description: "d" }],
      ["GET", "/api/books/2", { ...SECOND_BOOK, description: "d" }],
      [
        "PUT",
        "/api/books/2",
        described(SECOND_BOOK, "Second Book", 3, "x"),
        200,
        { description: "x" },
      ],
      [
        "PATCH",
        "/api/books/1",
        described(FIRST_BOOK, "Renamed Book", 4, "d"),
        200,
        { name: "Renamed Book" },
      ],
      // Without a body the PUT is not modelled: its recorded outcome becomes the book's values.
      ["PUT", "/api/books/1", described(FIRST_BOOK, "Other Book", 5, "d")],
      [
        "PATCH",
        "/api/books/1",
        described(FIRST_BOOK, "Other Book", 6, "y"),
        200,
        { description: "y" },
      ],
      ["PUT", "/api/books/1", final, 200, { description: "z" }],
      ["GET", "/api/books/1", final],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      checked_record_ordinals: [],
    });
  });
});

describe("reads as serving answers them", () => {
  it("checks a read with no query on the line serving answers it from, a whole list's paging line", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books?limit=50", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK, THIRD_BOOK]],
    ];
    expect(gated(rows, "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
  });

  it("checks nothing by a line whose query repeats a name, which no call can name", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books?tag=a&tag=b", [FIRST_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["PATCH", "/api/books/1", RENAMED, 200, { name: "Renamed Book" }],
      ["GET", "/api/books?tag=a&tag=b", [RENAMED]],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      checked_record_ordinals: [],
    });
  });

  it("checks nothing by a read made while a write to its targets was still running", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      // The create runs from second 3 to 4.5; the list at second 4 still shows the books before it.
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }, 1500],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK, THIRD_BOOK]],
    ];
    expect(gated(rows, "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
      contradicted_by: null,
    });
  });

  it("refuses an update a later call stores otherwise than the plan echoed", () => {
    const formatted = (at: number, format: string): Book => ({
      ...renamedBook(FIRST_BOOK, "First Book", at),
      format,
    });
    const rows: TimedCaptureRow[] = [
      [
        "GET",
        "/api/books",
        [
          { ...FIRST_BOOK, format: "EBOOK" },
          { ...SECOND_BOOK, format: "EBOOK" },
        ],
      ],
      ["GET", "/api/books/1", { ...FIRST_BOOK, format: "EBOOK" }],
      ["GET", "/api/books/2", { ...SECOND_BOOK, format: "EBOOK" }],
      [
        "PATCH",
        "/api/books/1",
        formatted(3, "PAPER"),
        200,
        { format: "PAPER" },
      ],
      ["GET", "/api/books/1", formatted(3, "PAPER")],
      [
        "PATCH",
        "/api/books/1",
        formatted(5, "HARDCOVER"),
        200,
        { format: "hardcover" },
      ],
      ["GET", "/api/books/1", formatted(5, "HARDCOVER")],
    ];
    // One call echoed the format, the other stored another value: no one plan serves both.
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("learns no update's effect from a read made while the update was still running", () => {
    const full = (description: string) => ({
      id: 1,
      name: "First",
      description,
    });
    const summary = [
      { id: 1, name: "First" },
      { id: 2, name: "Second" },
    ];
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", summary],
      ["GET", "/api/books/1", full("Old desc")],
      ["GET", "/api/books/2", { id: 2, name: "Second", description: "Other" }],
      // The update runs from second 3 to 4.5; the read at second 4 still shows the old description.
      [
        "PATCH",
        "/api/books/1",
        "",
        204,
        { name: "First", description: "New desc" },
        1500,
      ],
      ["GET", "/api/books/1", full("Old desc")],
      ["GET", "/api/books", summary],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      observation: null,
    });
  });

  it("explains a field an update adds that the observing view had shown the entity without", () => {
    const rows: TimedCaptureRow[] = [
      [
        "GET",
        "/api/books",
        [
          { id: 1, name: "A" },
          { id: 2, name: "B" },
        ],
      ],
      ["GET", "/api/books/1", { id: 1, name: "A" }],
      ["GET", "/api/books/2", { id: 2, name: "B", edited_at: bookClock(0) }],
      ["PATCH", "/api/books/1", "", 204, { name: "Z" }],
      ["GET", "/api/books/1", { id: 1, name: "Z", edited_at: bookClock(3) }],
      [
        "GET",
        "/api/books",
        [
          { id: 1, name: "Z" },
          { id: 2, name: "B" },
        ],
      ],
    ];
    const plan = gated(rows, "patch_books_by_id");
    expect(plan).toMatchObject({ served: true });
    expect(plan.rules).toContainEqual(
      expect.objectContaining({ field: "edited_at", rule: "clock" }),
    );
  });
});

describe("what a read shows of a write", () => {
  it("confirms no update by a read that shows none of the fields it changed", () => {
    const rows: TimedCaptureRow[] = [
      [
        "GET",
        "/api/books",
        [
          { id: 1, name: "A" },
          { id: 2, name: "B" },
        ],
      ],
      ["GET", "/api/books/1", { id: 1, name: "A", description: "x" }],
      ["GET", "/api/books/2", { id: 2, name: "B", description: "y" }],
      [
        "PATCH",
        "/api/books/1",
        { id: 1, name: "A", description: "new" },
        200,
        { description: "new" },
      ],
      // The list passes, but it shows no description.
      [
        "GET",
        "/api/books",
        [
          { id: 1, name: "A" },
          { id: 2, name: "B" },
        ],
      ],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "unconfirmed",
      checked_record_ordinals: [],
    });
  });

  it("lets a read a create was observed through still contradict another write", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["PATCH", "/api/books/1", RENAMED, 200, { name: "Renamed Book" }],
      ["GET", "/api/books/1", RENAMED],
      // The create answers with its id alone, so the next list shows its entity; that list shows book 1 unrenamed.
      ["POST", "/api/books", { id: 3 }, 201, { name: "Third Book" }],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK, THIRD_BOOK]],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      contradicted_by: 6,
    });
  });

  it("confirms no document write a later replacement overwrote", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/settings", { theme: "light", lang: "en" }],
      [
        "PATCH",
        "/api/settings",
        { theme: "dark", lang: "en" },
        200,
        { theme: "dark" },
      ],
      [
        "PUT",
        "/api/settings",
        { theme: "blue", lang: "fr" },
        200,
        { theme: "blue", lang: "fr" },
      ],
      ["GET", "/api/settings", { theme: "blue", lang: "fr" }],
    ];
    expect(gated(rows, "patch_settings")).toMatchObject({
      served: false,
      checked_record_ordinals: [],
    });
    expect(gated(rows, "put_settings")).toMatchObject({
      served: true,
      checked_record_ordinals: [3],
    });
  });

  it("confirms a document write whose path encodes a parent the plain read holds", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/orgs/uid/acme1/settings", { theme: "light", lang: "en" }],
      [
        "PATCH",
        "/api/orgs/uid/%61cme1/settings",
        { theme: "dark", lang: "en" },
        200,
        { theme: "dark" },
      ],
      ["GET", "/api/orgs/uid/acme1/settings", { theme: "dark", lang: "en" }],
    ];
    const { writes } = environmentStateViewOf(timedCaptureEvidence(rows), [
      "after-uid-literal",
    ]);
    expect(writes.find((plan) => plan.effect === "document")).toMatchObject({
      served: true,
      checked_record_ordinals: [2],
    });
  });
});

describe("document writes later writes overwrite", () => {
  it("confirms no document replacement a later merge overwrote", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/settings", { theme: "light", lang: "en" }],
      [
        "PUT",
        "/api/settings",
        { theme: "dark", lang: "fr" },
        200,
        { theme: "dark", lang: "fr" },
      ],
      [
        "PATCH",
        "/api/settings",
        { theme: "blue", lang: "de" },
        200,
        { theme: "blue", lang: "de" },
      ],
      ["GET", "/api/settings", { theme: "blue", lang: "de" }],
    ];
    expect(gated(rows, "put_settings")).toMatchObject({
      served: false,
      checked_record_ordinals: [],
    });
    expect(gated(rows, "patch_settings")).toMatchObject({
      served: true,
      checked_record_ordinals: [3],
    });
  });

  it("confirms no document merge a later replacement of its object overwrote", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/settings", { prefs: { lang: "en" }, theme: "light" }],
      [
        "PATCH",
        "/api/settings",
        { prefs: { lang: "fr" }, theme: "light" },
        200,
        { prefs: { lang: "fr" } },
      ],
      // The replacement holds `lang`, so it replaces all of `prefs`, which the merge wrote.
      [
        "PUT",
        "/api/settings",
        { prefs: { lang: "de" }, theme: "light" },
        200,
        { lang: "de" },
      ],
      ["GET", "/api/settings", { prefs: { lang: "de" }, theme: "light" }],
    ];
    expect(gated(rows, "patch_settings")).toMatchObject({
      served: false,
      checked_record_ordinals: [],
    });
    expect(gated(rows, "put_settings")).toMatchObject({
      served: true,
      checked_record_ordinals: [3],
    });
  });
});

describe("reads named as serving names them", () => {
  const orgBook = (id: number, org: string, name: string): Book => ({
    id,
    org,
    name,
  });
  it("contradicts an update by a read spelled plainly of the encoded collection serving answers it from", () => {
    const alpha = orgBook(1, "acme1", "Alpha");
    const renamed = orgBook(1, "acme1", "Renamed");
    const beta = orgBook(2, "beta2", "Beta");
    const renamedBeta = orgBook(2, "beta2", "Renamed Beta");
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/orgs/%61cme1/books", [alpha]],
      ["GET", "/api/orgs/beta2/books", [beta]],
      ["GET", "/api/orgs/%61cme1/books/1", alpha],
      ["GET", "/api/orgs/beta2/books/2", beta],
      ["PATCH", "/api/orgs/%61cme1/books/1", renamed, 200, { name: "Renamed" }],
      [
        "PATCH",
        "/api/orgs/beta2/books/2",
        renamedBeta,
        200,
        { name: "Renamed Beta" },
      ],
      // Serving answers this plain spelling with the renamed book, which the recording shows absent.
      ["GET", "/api/orgs/acme1/books/1", null],
      ["GET", "/api/orgs/%61cme1/books/1", renamed],
      ["GET", "/api/orgs/beta2/books/2", renamedBeta],
    ];
    const { writes } = environmentStateViewOf(timedCaptureEvidence(rows), [
      "sibling-variance",
    ]);
    expect(writes.find((plan) => plan.effect === "update")).toMatchObject({
      served: false,
      contradicted_by: 6,
    });
  });

  it("confirms a delete by a plain absence of an entity held under the encoded collection", () => {
    const alpha = orgBook(1, "acme1", "Alpha");
    const beta = orgBook(2, "beta2", "Beta");
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/orgs/%61cme1/books", [alpha]],
      ["GET", "/api/orgs/beta2/books", [beta]],
      ["GET", "/api/orgs/%61cme1/books/1", alpha],
      ["GET", "/api/orgs/beta2/books/2", beta],
      ["DELETE", "/api/orgs/acme1/books/1", "", 204],
      ["GET", "/api/orgs/acme1/books/1", BOOK_NOT_FOUND, 404],
      ["DELETE", "/api/orgs/beta2/books/2", "", 204],
      ["GET", "/api/orgs/beta2/books/2", BOOK_NOT_FOUND, 404],
    ];
    const { writes } = environmentStateViewOf(timedCaptureEvidence(rows), [
      "sibling-variance",
    ]);
    expect(writes.find((plan) => plan.effect === "delete")).toMatchObject({
      served: true,
      checked_record_ordinals: expect.arrayContaining([5]),
    });
  });

  it("learns a plain-path update from a later read under the encoded collection", () => {
    const alpha = orgBook(1, "acme1", "Alpha");
    const renamed = orgBook(1, "acme1", "Renamed");
    const beta = orgBook(2, "beta2", "Beta");
    const renamedBeta = orgBook(2, "beta2", "Renamed Beta");
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/orgs/%61cme1/books", [alpha]],
      ["GET", "/api/orgs/beta2/books", [beta]],
      ["GET", "/api/orgs/%61cme1/books/1", alpha],
      ["GET", "/api/orgs/beta2/books/2", beta],
      ["PATCH", "/api/orgs/acme1/books/1", "", 204, { name: "Renamed" }],
      ["GET", "/api/orgs/%61cme1/books/1", renamed],
      ["GET", "/api/orgs/%61cme1/books/1", renamed],
      [
        "PATCH",
        "/api/orgs/beta2/books/2",
        renamedBeta,
        200,
        { name: "Renamed Beta" },
      ],
      ["GET", "/api/orgs/beta2/books/2", renamedBeta],
    ];
    const { writes } = environmentStateViewOf(timedCaptureEvidence(rows), [
      "sibling-variance",
    ]);
    expect(writes.find((plan) => plan.effect === "update")).toMatchObject({
      served: true,
      observation: { ordinal: 5 },
      checked_record_ordinals: expect.arrayContaining([6]),
    });
  });

  it("checks a line whose query repeats a name with one value, which a call still names", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books?tag=a&tag=a", [FIRST_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["PATCH", "/api/books/1", RENAMED, 200, { name: "Renamed Book" }],
      // The list still shows the old name, though the item read after it shows the rename.
      ["GET", "/api/books?tag=a&tag=a", [FIRST_BOOK]],
      ["GET", "/api/books/1", RENAMED],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      contradicted_by: 4,
    });
  });

  it("ties a create named plainly to the encoded collection serving creates it in", () => {
    const linked = (id: number, org: string, name: string) => ({
      id,
      name,
      href: `/orgs/${org}/books/${String(id)}`,
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/orgs/%61cme1/books", [linked(1, "acme1", "Alpha")]],
      ["GET", "/api/orgs/beta2/books", [linked(2, "beta2", "Beta")]],
      ["GET", "/api/orgs/%61cme1/books/1", linked(1, "acme1", "Alpha")],
      ["GET", "/api/orgs/beta2/books/2", linked(2, "beta2", "Beta")],
      [
        "POST",
        "/api/orgs/acme1/books",
        linked(3, "acme1", "Gamma"),
        201,
        { name: "Gamma" },
      ],
      ["GET", "/api/orgs/acme1/books/3", linked(3, "acme1", "Gamma")],
      [
        "POST",
        "/api/orgs/beta2/books",
        linked(4, "beta2", "Delta"),
        201,
        { name: "Delta" },
      ],
    ];
    const { writes } = environmentStateViewOf(timedCaptureEvidence(rows), [
      "sibling-variance",
    ]);
    expect(writes.find((plan) => plan.effect === "create")).toMatchObject({
      served: true,
      collection: "/api/orgs/%61cme1/books",
    });
  });
});

describe("encoded parent spellings", () => {
  const type = "/api/orgs/uid/{uid}/books";
  const collection = "/api/orgs/uid/acme1/books";
  /** A state holding one book under its parent's plain spelling. */
  const plainlyHeld = () =>
    new SimulatedState(
      [
        {
          type,
          collection,
          id: "1",
          fields: { id: 1, name: "Alpha" },
          view_fields: [],
          record_ordinals: [],
        },
      ],
      [],
    );

  it("names the plainly held entity from a path that encodes its parent", () => {
    expect(
      itemTarget(plainlyHeld(), type, {
        path: "/api/orgs/uid/%61cme1/books/1",
      }),
    ).toEqual({ collection, id: "1" });
  });

  it("lists the type's entities only when the path's own collection holds no such id", () => {
    const state = plainlyHeld();
    const listed = vi.spyOn(state, "ofType");
    expect(
      itemTarget(state, type, { path: "/api/orgs/uid/acme1/books/1" }),
    ).toEqual({ collection, id: "1" });
    expect(listed).not.toHaveBeenCalled();
    expect(
      itemTarget(state, type, { path: "/api/orgs/uid/%61cme1/books/1" }),
    ).toEqual({ collection, id: "1" });
    expect(listed).toHaveBeenCalledTimes(1);
  });

  it("answers an encoded read from the plain checked line", () => {
    const tool = {
      name: "get_orgs_books_by_uid",
      method: "GET",
      path_template: "/api/orgs/uid/{uid}/books",
      record_ordinals: [0],
    };
    const record = {
      ordinal: 0,
      method: "GET",
      path: "/api/orgs/uid/acme1/books",
      query: undefined,
      status: 200,
      timing: { start: undefined, endMs: undefined },
    };
    const lines = checkedLines({
      tools: [tool],
      records: [record],
      views: new Map([
        [
          tool.name,
          {
            tool: tool.name,
            type: "/api/orgs/uid/{uid}/books",
            shape: "list",
            pointer: "",
            fields: ["id"],
            required_fields: ["id"],
            checked_record_ordinals: [0],
            membership: "all",
            counters: [],
          },
        ],
      ]),
    });
    expect(
      servedLine(lines.get(tool.name), {
        ...record,
        ordinal: 1,
        path: "/api/orgs/uid/%61cme1/books",
      }),
    ).toEqual({
      ordinal: 0,
      collection: "/api/orgs/uid/acme1/books",
      named: true,
    });
  });

  it("confirms an update whose path encodes a parent the plain reads hold", () => {
    const alpha = { id: 1, org: "acme1", name: "Alpha" };
    const renamed = { id: 1, org: "acme1", name: "Renamed" };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/orgs/uid/acme1/books", [alpha]],
      ["GET", "/api/orgs/uid/acme1/books/1", alpha],
      [
        "PATCH",
        "/api/orgs/uid/%61cme1/books/1",
        renamed,
        200,
        { name: "Renamed" },
      ],
      ["GET", "/api/orgs/uid/acme1/books/1", renamed],
    ];
    const { writes } = environmentStateViewOf(timedCaptureEvidence(rows), [
      "after-uid-literal",
    ]);
    expect(writes.find((plan) => plan.effect === "update")).toMatchObject({
      served: true,
      checked_record_ordinals: [3],
    });
  });
});

describe("writes named as serving names them", () => {
  const orgBook = (
    id: number,
    org: string,
    name: string,
    archived = false,
  ) => ({
    id,
    org,
    name,
    archived,
  });
  const ALPHA = orgBook(1, "acme1", "Alpha");
  const BETA = orgBook(2, "beta2", "Beta");
  const RENAMED_BETA = orgBook(2, "beta2", "Renamed Beta");
  const INIT_ROWS: readonly TimedCaptureRow[] = [
    ["GET", "/api/orgs/%61cme1/books", [ALPHA]],
    ["GET", "/api/orgs/beta2/books", [BETA]],
    ["GET", "/api/orgs/%61cme1/books/1", ALPHA],
    ["GET", "/api/orgs/beta2/books/2", BETA],
  ];
  const RENAME_BETA: readonly TimedCaptureRow[] = [
    [
      "PATCH",
      "/api/orgs/beta2/books/2",
      RENAMED_BETA,
      200,
      { name: "Renamed Beta" },
    ],
    ["GET", "/api/orgs/beta2/books/2", RENAMED_BETA],
  ];
  const CREATE_DELTA: readonly TimedCaptureRow[] = [
    [
      "POST",
      "/api/orgs/beta2/books",
      orgBook(4, "beta2", "Delta"),
      201,
      { name: "Delta" },
    ],
  ];
  const planned = (rows: readonly TimedCaptureRow[], effect: string) =>
    environmentStateViewOf(timedCaptureEvidence(rows), [
      "sibling-variance",
    ]).writes.find((plan) => plan.effect === effect);

  it("contradicts a create named plainly by a list of the encoded collection it went to that omits it", () => {
    const gamma = orgBook(3, "acme1", "Gamma");
    const rows: TimedCaptureRow[] = [
      ...INIT_ROWS,
      ["POST", "/api/orgs/acme1/books", gamma, 201, { name: "Gamma" }],
      ["GET", "/api/orgs/acme1/books/3", gamma],
      // Serving lists the create in the encoded collection, which the recording shows without it.
      ["GET", "/api/orgs/%61cme1/books", [ALPHA]],
      ...CREATE_DELTA,
    ];
    expect(planned(rows, "create")).toMatchObject({
      served: false,
      contradicted_by: 6,
    });
  });

  it("leaves unknown the entity a plainly named action changed under the encoded collection", () => {
    const archived = orgBook(1, "acme1", "Alpha", true);
    const rows: TimedCaptureRow[] = [
      ...INIT_ROWS,
      ["POST", "/api/orgs/acme1/books/1/archive", archived, 200],
      // The rename's answer also shows the archive, which no rule of the rename explains.
      [
        "PATCH",
        "/api/orgs/acme1/books/1",
        orgBook(1, "acme1", "Renamed", true),
        200,
        { name: "Renamed" },
      ],
      ...RENAME_BETA,
    ];
    expect(planned(rows, "update")).toMatchObject({
      served: true,
      reason: null,
    });
  });

  it("checks no list of the encoded collection after a plainly named write at the collection", () => {
    const gamma = orgBook(3, "acme1", "Gamma");
    const rows: TimedCaptureRow[] = [
      ...INIT_ROWS,
      ["DELETE", "/api/orgs/acme1/books", "", 204],
      ["POST", "/api/orgs/acme1/books", gamma, 201, { name: "Gamma" }],
      ["GET", "/api/orgs/acme1/books/3", gamma],
      // The cleared collection now lists only the create, which the state alone cannot show.
      ["GET", "/api/orgs/%61cme1/books", [gamma]],
      ...CREATE_DELTA,
    ];
    expect(planned(rows, "create")).toMatchObject({
      served: true,
      contradicted_by: null,
    });
  });

  it("checks no read under the encoded collection after a plainly named write above it", () => {
    const rows: TimedCaptureRow[] = [
      ...INIT_ROWS,
      [
        "PATCH",
        "/api/orgs/%61cme1/books/1",
        orgBook(1, "acme1", "Renamed"),
        200,
        { name: "Renamed" },
      ],
      ["DELETE", "/api/orgs/acme1", "", 204],
      // The organisation's books went with it, which the state alone cannot show.
      ["GET", "/api/orgs/%61cme1/books/1", BOOK_NOT_FOUND, 404],
      ...RENAME_BETA,
    ];
    expect(planned(rows, "update")).toMatchObject({
      served: true,
      contradicted_by: null,
    });
  });
});

describe("resolved encoded item observations", () => {
  it("matches the resolved raw ID when the collection alias and response ID are encoded", () => {
    const collection = "/api/orgs/%61cme1/books";
    const state = new SimulatedState(
      [
        {
          type: "/api/orgs/{org_id}/books",
          collection,
          id: "%61",
          fields: { id: "%61", name: "Before" },
          view_fields: [],
          record_ordinals: [],
        },
      ],
      [],
    );
    const write = {
      ordinal: 0,
      method: "PATCH",
      path: "/api/orgs/acme1/books/%61",
      query: undefined,
      status: 204,
      timing: { start: undefined, endMs: undefined },
    };
    const target = itemTarget(state, "/api/orgs/{org_id}/books", write);
    const itemView = {
      tool: "get_books_by_id",
      type: "/api/orgs/{org_id}/books",
      shape: "item" as const,
      pointer: "",
      fields: ["id", "name"],
      required_fields: ["id"],
      checked_record_ordinals: [1],
      envelope_ordinal: 1,
    };
    const records = [
      write,
      {
        ordinal: 1,
        method: "GET",
        path: "/api/orgs/acme1/books/%61",
        query: undefined,
        status: 200,
        timing: { start: undefined, endMs: undefined },
      },
    ];
    const search: ObservationSearch = {
      records,
      chronology: new StateRecordChronology(records, "record-order"),
      from: 0,
      viewOf: () => itemView,
      withBody: (_ordinal, use) => use({ id: "%61", name: "After" }),
      queryOf: () => undefined,
    };

    expect(target).toEqual({ collection, id: "%61" });
    expect(
      laterObservation(search, {
        type: itemView.type,
        ...target,
        idField: "id",
        held: () => true,
        isWrite: (record) => record.method !== "GET",
        sameItem: (record) => {
          const resolved = itemTarget(state, itemView.type, record);
          return (
            resolved.collection === target.collection &&
            resolved.id === target.id
          );
        },
      }),
    ).toEqual({
      ordinal: 1,
      pointer: "",
      object: { id: "%61", name: "After" },
      id: "%61",
    });
  });
});

describe("what a write's own answer pins down", () => {
  it("observes a create that answers with its id alone only through a read of that id", () => {
    const fourth = book(4, "Fourth Book", "2026-10-01T11:00:00Z");
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", { id: 3 }, 201, { name: "Third Book" }],
      // A book the capture never listed is not the one the create made.
      ["GET", "/api/books/4", fourth],
      ["GET", "/api/books/4", fourth],
      ["GET", "/api/books/3", THIRD_BOOK],
      ["GET", "/api/books/3", THIRD_BOOK],
    ];
    expect(gated(rows, "post_books")).toMatchObject({
      observation: { ordinal: 6, pointer: "" },
      checked_record_ordinals: [7],
    });
  });

  it("keeps an update served when a later call is the first to send the path's id in its body", () => {
    const renamedSecond = renamedBook(SECOND_BOOK, "Renamed Second", 5);
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["PATCH", "/api/books/1", RENAMED, 200, { name: "Renamed Book" }],
      ["GET", "/api/books/1", RENAMED],
      [
        "PATCH",
        "/api/books/2",
        renamedSecond,
        200,
        { id: 2, name: "Renamed Second" },
      ],
      ["GET", "/api/books/2", renamedSecond],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      body: { identity: "id" },
    });
  });
});

it("counts the sent values a plan keeps for fixed members against the view's allowance", () => {
  let retained = 0;
  const context = {
    io: { retain: (bytes: number) => (retained += bytes) },
  } as unknown as EffectContext;
  retainFixed(context, [{ sent: "x".repeat(10_000) }]);
  expect(retained).toBeGreaterThan(20_000);
  retained = 0;
  retainFixed(context, []);
  expect(retained).toBe(0);
});

describe("what a check leaves pending", () => {
  const summary = (books: readonly Book[]): JsonValue =>
    books.map(({ id, name }) => ({ id: id ?? null, name: name ?? null }));
  const described = (id: number, name: string, description: string) => ({
    id,
    name,
    description,
  });

  it("keeps an update a passing read showed nothing of for a later read to confirm", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", summary([FIRST_BOOK, SECOND_BOOK])],
      ["GET", "/api/books/1", described(1, "First Book", "x")],
      ["GET", "/api/books/2", described(2, "Second Book", "y")],
      [
        "PATCH",
        "/api/books/1",
        described(1, "First Book", "new"),
        200,
        { description: "new" },
      ],
      // The list passes but shows no description; the item read does.
      ["GET", "/api/books", summary([FIRST_BOOK, SECOND_BOOK])],
      ["GET", "/api/books/1", described(1, "First Book", "new")],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });

  it("checks only a partial update's fields that remain after a later overwrite", () => {
    const patched = described(1, "Patched", "survives");
    const replaced = described(1, "Replaced", "survives");
    const changedByOtherAction = described(1, "Archived", "survives");
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", summary([FIRST_BOOK, SECOND_BOOK])],
      ["GET", "/api/books/1", described(1, "First Book", "original")],
      ["GET", "/api/books/2", described(2, "Second Book", "other")],
      [
        "PATCH",
        "/api/books/1",
        patched,
        200,
        { name: "Patched", description: "survives" },
      ],
      ["PUT", "/api/books/1", replaced, 200, { name: "Replaced" }],
      ["POST", "/api/books/1/archive", changedByOtherAction, 204, {}],
      ["GET", "/api/books/1", changedByOtherAction],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [6],
      contradicted_by: null,
    });
  });

  it("checks a surviving sent member after a derived field was bumped by an unmodelled write", () => {
    const entry = (
      name: string,
      description: string,
      version: number,
    ): Book => ({ id: 1, name, description, version });
    const other = { id: 2, name: "B", description: "y", version: 1 };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [entry("A", "x", 1), other]],
      ["GET", "/api/books/1", entry("A", "x", 1)],
      ["GET", "/api/books/2", other],
      [
        "PATCH",
        "/api/books/1",
        entry("A2", "new", 2),
        200,
        { name: "A2", description: "new" },
      ],
      ["PUT", "/api/books/1", entry("A3", "new", 2), 200, { name: "A3" }],
      ["POST", "/api/books/1/archive", { archived: true }, 204, {}],
      // The read still shows the description the patch sent. The version bump is not that patch.
      ["GET", "/api/books/1", entry("A3", "new", 9)],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([{ field: "version", rule: "increment" }]),
      checked_record_ordinals: [6],
      contradicted_by: null,
    });
  });

  it("neither resynchronises nor checks an entity by a read begun while a write to it still ran", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      // The rename runs from second 3 to 5.5, and an unmodelled action leaves book 1 unknown.
      ["PATCH", "/api/books/1", RENAMED, 200, { name: "Renamed Book" }, 2500],
      ["POST", "/api/books/1/archive", null, 204, {}],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/1", RENAMED],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [6],
      contradicted_by: null,
    });
  });

  it("learns an update from a read begun after the write, not from one that overlapped it", () => {
    const named = (name: string) => ({ id: 1, name });
    const other = { id: 2, name: "B" };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [named("A"), other]],
      ["GET", "/api/books/1", named("A")],
      ["GET", "/api/books/2", other],
      // The patch runs from second 3 to 5.5 and returns no entity. A read begun while it still runs shows the old name.
      ["PATCH", "/api/books/1", "", 204, { name: "Z" }, 2500],
      ["GET", "/api/books/1", named("A")],
      ["GET", "/api/books/1", named("A")],
      ["GET", "/api/books/1", named("Z")],
      ["GET", "/api/books", [named("Z"), other]],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      observation: { ordinal: 6, pointer: "" },
      body: { accepted: ["name"], fixed: [] },
      rules: [{ field: "name", rule: "echo" }],
      checked_record_ordinals: [7],
      contradicted_by: null,
    });
  });

  it("checks nothing by a range read the collection has outgrown", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books?_start=0&_end=2", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      // The application still answers the range with two books.
      ["GET", "/api/books?_start=0&_end=2", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/3", THIRD_BOOK],
    ];
    expect(gated(rows, "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });
});

describe("what a later call must follow", () => {
  it("rejects a later create whose unique field repeats a value already held", () => {
    const existing = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      ref: "223e4567-e89b-42d3-a456-426614174000",
      name: "Existing",
    };
    const first = {
      id: "323e4567-e89b-42d3-a456-426614174000",
      ref: "423e4567-e89b-42d3-a456-426614174000",
      name: "First",
    };
    const duplicate = {
      id: "523e4567-e89b-42d3-a456-426614174000",
      ref: first.ref,
      name: "Second",
    };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/items", [existing]],
      ["GET", `/api/items/${existing.id}`, existing],
      ["POST", "/api/items", first, 201, { name: "First" }],
      ["GET", `/api/items/${first.id}`, first],
      ["GET", "/api/items", [existing, first]],
      ["POST", "/api/items", duplicate, 201, { name: "Second" }],
      ["GET", `/api/items/${duplicate.id}`, duplicate],
      ["GET", "/api/items", [existing, first, duplicate]],
    ];
    expect(gated(rows, "post_items")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("refuses a create whose later call does not follow the sequence it learned", () => {
    const ranked = (at: Book, rank: number) => ({ ...at, rank });
    const third = ranked(book(3, "Third Book", bookClock(3)), 3);
    const fourth = ranked(book(4, "Fourth Book", bookClock(4)), 3);
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [ranked(FIRST_BOOK, 1), ranked(SECOND_BOOK, 2)]],
      ["GET", "/api/books/1", ranked(FIRST_BOOK, 1)],
      ["GET", "/api/books/2", ranked(SECOND_BOOK, 2)],
      ["POST", "/api/books", third, 201, { name: "Third Book" }],
      // Serving ranks the next create 4; the application recorded 3 again.
      ["POST", "/api/books", fourth, 201, { name: "Fourth Book" }],
      [
        "GET",
        "/api/books",
        [ranked(FIRST_BOOK, 1), ranked(SECOND_BOOK, 2), third, fourth],
      ],
    ];
    expect(gated(rows, "post_books")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("keeps a document write a later replacement of another member left in place", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/settings", { theme: "light", prefs: { lang: "en" } }],
      [
        "PATCH",
        "/api/settings",
        { theme: "dark", prefs: { lang: "en" } },
        200,
        { theme: "dark" },
      ],
      // The replacement holds `lang`, so it replaces `prefs` alone.
      [
        "PUT",
        "/api/settings",
        { theme: "dark", prefs: { lang: "fr" } },
        200,
        { lang: "fr" },
      ],
      ["GET", "/api/settings", { theme: "dark", prefs: { lang: "fr" } }],
    ];
    expect(gated(rows, "patch_settings")).toMatchObject({
      served: true,
      checked_record_ordinals: [3],
    });
    expect(gated(rows, "put_settings")).toMatchObject({
      served: true,
      checked_record_ordinals: [3],
    });
  });

  it("applies a later document replacement at the plan's pointer, though it shares no member with the document", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/settings", { theme: "light", lang: "en" }],
      [
        "PUT",
        "/api/settings",
        { theme: "dark", lang: "fr" },
        200,
        { theme: "dark", lang: "fr" },
      ],
      ["PUT", "/api/settings", { theme: "blue" }, 200, { theme: "blue" }],
      ["PUT", "/api/settings", { lang: "de" }, 200, { lang: "de" }],
      ["GET", "/api/settings", { lang: "de" }],
    ];
    expect(gated(rows, "put_settings")).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
  });

  it("finds an update's entity as serving does when the write spells the collection plainly", () => {
    const alpha = { id: 1, org: "acme1", name: "Alpha" };
    const beta = { id: 2, org: "beta2", name: "Beta" };
    const renamed = { ...alpha, name: "Renamed" };
    const renamedBeta = { ...beta, name: "Renamed Beta" };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/orgs/%61cme1/books", [alpha]],
      ["GET", "/api/orgs/beta2/books", [beta]],
      ["GET", "/api/orgs/%61cme1/books/1", alpha],
      ["GET", "/api/orgs/beta2/books/2", beta],
      ["PATCH", "/api/orgs/acme1/books/1", renamed, 200, { name: "Renamed" }],
      [
        "PATCH",
        "/api/orgs/beta2/books/2",
        renamedBeta,
        200,
        { name: "Renamed Beta" },
      ],
      ["GET", "/api/orgs/%61cme1/books/1", renamed],
      ["GET", "/api/orgs/beta2/books/2", renamedBeta],
    ];
    const { writes } = environmentStateViewOf(timedCaptureEvidence(rows), [
      "sibling-variance",
    ]);
    expect(writes.find((plan) => plan.effect === "update")).toMatchObject({
      served: true,
      checked_record_ordinals: [6, 7],
    });
  });
});

describe("what a write's effect keeps", () => {
  it("keeps an entity member a later write's other member does not cover, though both names look like pointers", () => {
    const flat = (id: number, prefs: string, lang: string) => ({
      id,
      name: `Book ${String(id)}`,
      "/prefs": prefs,
      "/prefs/lang": lang,
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [flat(1, "x", "en"), flat(2, "x", "en")]],
      ["GET", "/api/books/1", flat(1, "x", "en")],
      ["GET", "/api/books/2", flat(2, "x", "en")],
      [
        "PATCH",
        "/api/books/1",
        flat(1, "x", "fr"),
        200,
        { "/prefs/lang": "fr" },
      ],
      ["PUT", "/api/books/1", flat(1, "y", "fr"), 200, { "/prefs": "y" }],
      ["GET", "/api/books/1", flat(1, "y", "fr")],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });

  const subtitled = (id: number, name: string, subtitle?: string) =>
    subtitle === undefined ? { id, name } : { id, name, subtitle };
  const summaries = (first: string): TimedCaptureRow => [
    "GET",
    "/api/books",
    [subtitled(1, first), subtitled(2, "B")],
  ];

  it("refuses an update a later read shows dropped a field serving would keep", () => {
    const rows: TimedCaptureRow[] = [
      summaries("A"),
      ["GET", "/api/books/1", subtitled(1, "A", "s")],
      ["GET", "/api/books/2", subtitled(2, "B", "t")],
      ["PATCH", "/api/books/1", "", 204, { name: "Z" }],
      ["GET", "/api/books/1", subtitled(1, "Z")],
      summaries("Z"),
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("keeps an update whose partial response leaves out a field a later read still shows", () => {
    const rows: TimedCaptureRow[] = [
      summaries("A"),
      ["GET", "/api/books/1", subtitled(1, "A", "s")],
      ["GET", "/api/books/2", subtitled(2, "B", "t")],
      ["PATCH", "/api/books/1", subtitled(1, "Z"), 200, { name: "Z" }],
      ["GET", "/api/books/1", subtitled(1, "Z", "s")],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
  });
});

describe("what an unmodelled write explains", () => {
  it("weighs an unmodelled write against a tool's call on the entity a read checks, not its latest call elsewhere", () => {
    const tagged = (id: number, name: string, tag: string) => ({
      id,
      name,
      tag,
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [tagged(1, "A", "x"), tagged(2, "B", "x")]],
      ["GET", "/api/books/1", tagged(1, "A", "x")],
      ["GET", "/api/books/2", tagged(2, "B", "x")],
      ["PATCH", "/api/books/1", tagged(1, "A2", "x"), 200, { name: "A2" }],
      ["POST", "/api/exports", { queued: true }, 202, { format: "csv" }],
      ["PATCH", "/api/books/2", tagged(2, "B2", "x"), 200, { name: "B2" }],
      // The export came after book 1's rename, so it may explain the changed tag; the rename itself shows.
      ["GET", "/api/books/1", tagged(1, "A2", "y")],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      contradicted_by: null,
      checked_record_ordinals: [6],
    });
  });

  it("lets an unmodelled write explain a list's change to an entity a tool made before it, whatever the tool did after", () => {
    const fourth = book(4, "Fourth Book", bookClock(5));
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      ["POST", "/api/exports", { queued: true }, 202, { format: "csv" }],
      ["POST", "/api/books", fourth, 201, { name: "Fourth Book" }],
      ["GET", "/api/books/4", fourth],
      // The export came after the third book was made, so it may explain the third book's other name.
      [
        "GET",
        "/api/books",
        [FIRST_BOOK, SECOND_BOOK, { ...THIRD_BOOK, name: "Retitled" }, fourth],
      ],
    ];
    expect(gated(rows, "post_books")).toMatchObject({
      served: true,
      contradicted_by: null,
    });
  });

  it("weighs no unmodelled write against a call whose effect a later write overwrote", () => {
    const named = (id: number, name: string) => ({
      ...book(id, name, bookClock(0)),
      id,
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [named(1, "A"), named(2, "B")]],
      ["GET", "/api/books/1", named(1, "A")],
      ["GET", "/api/books/2", named(2, "B")],
      ["PATCH", "/api/books/1", named(1, "A2"), 200, { name: "A2" }],
      ["POST", "/api/exports", { queued: true }, 202, { format: "csv" }],
      // The PUT overwrites the patch's only change on book 1.
      ["PUT", "/api/books/1", named(1, "A3"), 200, { name: "A3" }],
      ["PATCH", "/api/books/2", named(2, "B2"), 200, { name: "B2" }],
      ["GET", "/api/books/2", named(2, "B2")],
      // The export came before book 2's patch, which the list shows undone.
      ["GET", "/api/books", [named(1, "A3"), named(2, "B")]],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      contradicted_by: 8,
    });
  });

  it("contradicts by a failed item read the writes no unmodelled write came after, checking only the others' members", () => {
    const enveloped = (data: Record<string, JsonValue>, revision: string) => ({
      data,
      revision,
    });
    const full = (name: string, description: string) => ({
      id: 1,
      name,
      description,
    });
    const summary = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ];
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", summary],
      ["GET", "/api/books/1", enveloped(full("A", "x"), "r1")],
      [
        "GET",
        "/api/books/2",
        enveloped({ id: 2, name: "B", description: "y" }, "r1"),
      ],
      ["PATCH", "/api/books/1", full("A", "new"), 200, { description: "new" }],
      ["GET", "/api/books", summary],
      ["POST", "/api/exports", { queued: true }, 202, { format: "csv" }],
      // The rename sends the name alone, so the earlier description patch stays pending.
      ["PUT", "/api/books/1", full("Z", "new"), 200, { name: "Z" }],
      // The rename shows, but the envelope serving would answer with does not.
      ["GET", "/api/books/1", enveloped(full("Z", "new"), "r2")],
    ];
    expect(gated(rows, "put_books_by_id")).toMatchObject({
      served: false,
      contradicted_by: 7,
    });
  });

  it("contradicts by a list a write made after an unmodelled one, though the tool's earlier change elsewhere came before it", () => {
    const named = (id: number, name: string) => ({
      ...book(id, name, bookClock(0)),
      id,
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [named(1, "A"), named(2, "B")]],
      ["GET", "/api/books/1", named(1, "A")],
      ["GET", "/api/books/2", named(2, "B")],
      ["PATCH", "/api/books/1", named(1, "A2"), 200, { name: "A2" }],
      ["POST", "/api/exports", { queued: true }, 202, { format: "csv" }],
      ["PATCH", "/api/books/2", named(2, "B2"), 200, { name: "B2" }],
      ["GET", "/api/books/2", named(2, "B2")],
      // Only book 2 differs, and its patch came after the export.
      ["GET", "/api/books", [named(1, "A2"), named(2, "B")]],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      contradicted_by: 7,
    });
  });

  it("contradicts a write made after an unmodelled one, though an earlier pending write came before it", () => {
    const summary = (name: string) => [
      { id: 1, name },
      { id: 2, name: "B" },
    ];
    const full = (name: string, description: string) => ({
      id: 1,
      name,
      description,
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", summary("A")],
      ["GET", "/api/books/1", full("A", "x")],
      ["GET", "/api/books/2", { id: 2, name: "B", description: "y" }],
      ["PATCH", "/api/books/1", full("A", "new"), 200, { description: "new" }],
      ["GET", "/api/books", summary("A")],
      ["POST", "/api/exports", { queued: true }, 202, { format: "csv" }],
      [
        "PUT",
        "/api/books/1",
        full("Z", "new"),
        200,
        { name: "Z", description: "new" },
      ],
      ["GET", "/api/books/1", full("Z", "new")],
      // The export came before the rename, so it cannot explain the list showing the old name.
      ["GET", "/api/books", summary("A")],
    ];
    expect(gated(rows, "put_books_by_id")).toMatchObject({
      served: false,
      contradicted_by: 8,
    });
  });
});

it("leaves the global served clock unknown when any record completion is unknown", () => {
  const rows = (duration: number): TimedCaptureRow[] => [
    ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
    // Even an earlier record with an unknown end may finish after the final known record.
    ["GET", "/api/books/1", FIRST_BOOK, 200, undefined, duration],
    ["GET", "/api/books/2", SECOND_BOOK],
  ];
  expect(
    environmentStateViewOf(timedCaptureEvidence(rows(5))).write_clock,
  ).toBe(new Date(bookClock(3)).toISOString());
  expect(
    environmentStateViewOf(timedCaptureEvidence(rows(-1))).write_clock,
  ).toBeNull();
});

describe("reads and calls on an entity an unmodelled write left unknown", () => {
  it.each([
    { duration: 5, target: "1", served: true },
    { duration: -1, target: "1", served: false },
    { duration: -1, target: "2", served: true },
  ])(
    "requires unmodelled completion before resync and later confirmation: $target duration=$duration",
    ({ duration, target, served }) => {
      const rows: TimedCaptureRow[] = [
        [
          "GET",
          "/api/books",
          [
            { id: 1, name: "A" },
            { id: 2, name: "B" },
          ],
        ],
        ["GET", "/api/books/1", { id: 1, name: "A" }],
        ["GET", "/api/books/2", { id: 2, name: "B" }],
        ["POST", `/api/books/${target}/archive`, null, 204, {}, duration],
        // This read may re-establish a baseline only after the related action finished.
        ["GET", "/api/books/1", { id: 1, name: "A" }],
        ["PATCH", "/api/books/1", { id: 1, name: "Z" }, 200, { name: "Z" }],
        ["GET", "/api/books/1", { id: 1, name: "Z" }],
      ];
      expect(gated(rows, "patch_books_by_id")).toMatchObject({
        served,
        checked_record_ordinals: served ? [6] : [],
        contradicted_by: null,
      });
    },
  );

  const named = (name: string) => ({ id: 1, name });
  const other = { id: 2, name: "B" };
  const ARCHIVE: TimedCaptureRow = [
    "POST",
    "/api/books/1/archive",
    null,
    204,
    {},
  ];

  it("keeps the entity unknown through a failed read that is no absence, for a later read to check", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [named("A"), other]],
      ["GET", "/api/books/1", named("A")],
      ["GET", "/api/books/2", other],
      ["PATCH", "/api/books/1", named("Z"), 200, { name: "Z" }],
      ARCHIVE,
      // The application was briefly unavailable, so this answer shows nothing of the book.
      ["GET", "/api/books/1", { error: "unavailable" }, 503],
      ["GET", "/api/books/1", named("Z")],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [6],
      contradicted_by: null,
    });
  });

  it("confirms no update of a volatile field by a read that shows the entity again, as no other read does", () => {
    const seen = (id: number, count: number) => ({
      id,
      name: id === 1 ? "A" : "B",
      seen: count,
    });
    const rows = (archive: boolean): TimedCaptureRow[] => [
      ["GET", "/api/books", [seen(1, 1), seen(2, 1)]],
      ["GET", "/api/books/1", seen(1, 1)],
      // The same read again shows another count, so the count changes with no write.
      ["GET", "/api/books/1", seen(1, 2)],
      ["GET", "/api/books/2", seen(2, 1)],
      ["PATCH", "/api/books/1", seen(1, 5), 200, { seen: 5 }],
      ...(archive ? [ARCHIVE] : []),
      ["GET", "/api/books/1", seen(1, 9)],
    ];
    for (const archive of [false, true])
      expect(gated(rows(archive), "patch_books_by_id")).toMatchObject({
        served: false,
        reason: "unconfirmed",
        checked_record_ordinals: [],
      });
  });

  it("adds nothing to an update's plan from a call it cannot check", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [named("A"), other]],
      ["GET", "/api/books/1", named("A")],
      ["GET", "/api/books/2", other],
      ["PATCH", "/api/books/1", named("Z"), 200, { name: "Z" }],
      ["GET", "/api/books/1", named("Z")],
      ARCHIVE,
      // The application stored this name otherwise than sent; a call on a known book would conflict with the echo.
      ["PATCH", "/api/books/1", named("Y!"), 200, { name: "y" }],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      body: { accepted: ["name"], fixed: [] },
      rules: [{ field: "name", rule: "echo" }],
      checked_record_ordinals: [4],
    });
  });
});

describe("volatile fields", () => {
  it("confirms no write through a volatile field a read renders from itself", () => {
    const seen = (id: number, name: string, at: string) => ({
      id,
      name,
      seen: at,
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [seen(1, "A", "t1"), seen(2, "B", "t1")]],
      ["GET", "/api/books/1", seen(1, "A", "t1")],
      // A repeated read with no write between shows `seen` changing on its own, so it is volatile.
      ["GET", "/api/books/1", seen(1, "A", "t2")],
      ["GET", "/api/books/2", seen(2, "B", "t1")],
      ["PATCH", "/api/books/1", seen(1, "A", "t3"), 200, { seen: "t3" }],
      ["POST", "/api/exports", { queued: true }, 202, { format: "csv" }],
      // The export may explain the new name, and `seen` renders from the read, so nothing shows the patch.
      ["GET", "/api/books/1", seen(1, "Z", "t9")],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      checked_record_ordinals: [],
    });
  });
});

describe("entities an unmodelled write made", () => {
  const IMPORT: TimedCaptureRow = [
    "POST",
    "/api/imports",
    { queued: true },
    202,
    { source: "csv" },
  ];
  const RENAME: TimedCaptureRow = [
    "PATCH",
    "/api/books/1",
    renamedBook(FIRST_BOOK, "Renamed Book", 3),
    200,
    { name: "Renamed Book" },
  ];
  const deletedAfterRead = (before: readonly TimedCaptureRow[]) => [
    ...BOOK_INIT_ROWS,
    ...before,
    ["GET", "/api/books/3", THIRD_BOOK] as TimedCaptureRow,
    ["DELETE", "/api/books/3", "", 204] as TimedCaptureRow,
    ["GET", "/api/books/3", BOOK_NOT_FOUND, 404] as TimedCaptureRow,
  ];

  it("takes a book the state never held only when a write the gate does not model came first", () => {
    // The rename ends the initial reads, so the third book is no initial one.
    expect(
      gated(deletedAfterRead([RENAME, IMPORT]), "delete_books_by_id"),
    ).toMatchObject({ served: true, checked_record_ordinals: [7] });
    // Only a modelled rename came first, so nothing explains the third book and the delete finds none.
    expect(
      gated(deletedAfterRead([RENAME]), "delete_books_by_id"),
    ).toMatchObject({
      served: false,
      checked_record_ordinals: [],
    });
  });

  it("takes a book an import may have made though it was redirected or went unanswered", () => {
    for (const status of [303, 0]) {
      const unresolved: TimedCaptureRow = [
        "POST",
        "/api/imports",
        { queued: true },
        status,
        { source: "csv" },
      ];
      expect(
        gated(deletedAfterRead([RENAME, unresolved]), "delete_books_by_id"),
      ).toMatchObject({ served: true, checked_record_ordinals: [7] });
    }
  });

  it("counts an entity it takes against the view's allowance", () => {
    let retained = 0;
    const read = { ...THIRD_BOOK, notes: "x".repeat(10_000) };
    const unseen = new UnseenEntities([], {
      state: new SimulatedState([], []),
      io: {
        withBody: (_ordinal, use) => use(read),
        retain: (bytes) => (retained += bytes),
      },
      lastCheck: new Map(),
      idField: () => "id",
    });
    unseen.unplanned(0);
    retained = 0;
    const view = { shape: "item", type: "/api/books", pointer: "" };
    const record = {
      ordinal: 1,
      method: "GET",
      path: "/api/books/3",
      query: undefined,
      status: 200,
      timing: { start: undefined, endMs: undefined },
    };
    expect(
      unseen.adopt(view as unknown as StateItemView, { record, index: 1 }),
    ).toMatchObject({ id: "3", fields: read });
    expect(retained).toBeGreaterThan(20_000);
  });

  it("finds no read's target among the held entities until an unplanned write came before the read", () => {
    const state = new SimulatedState([], []);
    const targets = vi.spyOn(state, "ofType");
    const unseen = new UnseenEntities([], {
      state,
      io: { withBody: (_ordinal, use) => use(THIRD_BOOK), retain: () => 0 },
      lastCheck: new Map(),
      idField: () => "id",
    });
    const view = { shape: "item", type: "/api/books", pointer: "" };
    const read = (index: number) => ({
      record: {
        ordinal: index,
        method: "GET",
        path: "/api/books/3",
        query: undefined,
        status: 200,
        timing: { start: undefined, endMs: undefined },
      },
      index,
    });
    const adopt = (index: number) =>
      unseen.adopt(view as unknown as StateItemView, read(index));
    expect(adopt(1)).toBeUndefined();
    // A write after the read cannot have made what it shows either.
    unseen.unplanned(2);
    expect(adopt(1)).toBeUndefined();
    expect(targets).not.toHaveBeenCalled();
    expect(adopt(3)).toMatchObject({ id: "3" });
  });

  it("takes back no book a modelled delete removed, so a list showing it again confirms no delete", () => {
    expect(
      gated(deletedAfterRead([RENAME, IMPORT]), "delete_books_by_id"),
    ).toMatchObject({ served: true });
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      ["GET", "/api/books/3", THIRD_BOOK],
      ["DELETE", "/api/books/3", "", 204],
      IMPORT,
      // The import put the deleted book back; the copy must not take it as one the import made.
      ["GET", "/api/books/3", THIRD_BOOK],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK, THIRD_BOOK]],
    ];
    expect(gated(rows, "delete_books_by_id")).toMatchObject({
      served: false,
      checked_record_ordinals: [],
    });
  });
});

describe("an unmodelled write under another collection spelling", () => {
  it("keeps a confirmed update when the write spells the held collection plainly", () => {
    const acme = (name: string, status: string) => ({
      id: 1,
      org: "acme1",
      name,
      status,
    });
    const beta = (name: string) => ({
      id: 2,
      org: "beta2",
      name,
      status: "open",
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/orgs/%61cme1/books", [acme("Alpha", "open")]],
      ["GET", "/api/orgs/beta2/books", [beta("Beta")]],
      ["GET", "/api/orgs/%61cme1/books/1", acme("Alpha", "open")],
      ["GET", "/api/orgs/beta2/books/2", beta("Beta")],
      [
        "PATCH",
        "/api/orgs/acme1/books/1",
        acme("Renamed", "open"),
        200,
        { name: "Renamed" },
      ],
      [
        "PATCH",
        "/api/orgs/beta2/books/2",
        beta("Renamed Beta"),
        200,
        { name: "Renamed Beta" },
      ],
      ["GET", "/api/orgs/%61cme1/books/1", acme("Renamed", "open")],
      ["GET", "/api/orgs/beta2/books/2", beta("Renamed Beta")],
      // Book 1 is held under the encoded collection. This archive spells it plainly.
      ["POST", "/api/orgs/acme1/books/1/archive", null, 204, {}],
      // The response shows the status the archive changed. The patch sent only the name.
      [
        "PATCH",
        "/api/orgs/%61cme1/books/1",
        acme("Retitled", "archived"),
        200,
        { name: "Retitled" },
      ],
    ];
    const { writes } = environmentStateViewOf(timedCaptureEvidence(rows), [
      "sibling-variance",
    ]);
    expect(writes.find((plan) => plan.effect === "update")).toMatchObject({
      served: true,
      reason: null,
      checked_record_ordinals: [6, 7],
    });
  });
});

describe("timed write observations and generated clocks", () => {
  it("does not learn an update from a read that began before the write completed", () => {
    const changed = { ...FIRST_BOOK, name: "Changed", slug: "changed" };
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      [
        "PATCH",
        "/api/books/1",
        { name: "Changed" },
        200,
        { name: "Changed" },
        2_000,
      ],
      // This read starts before the PATCH ends and still shows the old value.
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/1", changed],
      ["GET", "/api/books/1", changed],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      observation: { ordinal: 5 },
      checked_record_ordinals: [6],
    });
  });

  it("refuses a later update that leaves a learned clock unchanged", () => {
    const afterFirst = {
      ...FIRST_BOOK,
      name: "First update",
      updated_at: bookClock(4),
    };
    const afterSecond = { ...afterFirst, name: "Second update" };
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["PATCH", "/api/books/1", afterFirst, 200, { name: "First update" }],
      ["GET", "/api/books/1", afterFirst],
      [
        "PATCH",
        "/api/books/1",
        { id: 1, name: "Second update" },
        200,
        { name: "Second update" },
      ],
      ["GET", "/api/books/1", afterSecond],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("keeps a later update whose regenerated clock advances", () => {
    const afterFirst = {
      ...FIRST_BOOK,
      name: "First update",
      updated_at: bookClock(4),
    };
    const afterSecond = {
      ...afterFirst,
      name: "Second update",
      updated_at: bookClock(6),
    };
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      [
        "PATCH",
        "/api/books/1",
        { name: "First update" },
        200,
        { name: "First update" },
      ],
      ["GET", "/api/books/1", afterFirst],
      [
        "PATCH",
        "/api/books/1",
        { id: 1, name: "Second update" },
        200,
        { name: "Second update" },
      ],
      ["GET", "/api/books/1", afterSecond],
      ["GET", "/api/books/1", afterSecond],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [7],
    });
  });

  it("leaves a later update unknown when neither its answer nor a read before the next write shows its learned clock", () => {
    const summary = ({ id, name }: Book): Book => ({ id: id!, name: name! });
    const renamed = renamedBook(FIRST_BOOK, "Renamed Book", 3);
    const retitled = renamedBook(renamed, "Retitled Book", 5);
    const rows = (answer: JsonValue, status: number): TimedCaptureRow[] => [
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", summary(FIRST_BOOK)],
      ["GET", "/api/books/2", summary(SECOND_BOOK)],
      ["PATCH", "/api/books/1", renamed, 200, { name: "Renamed Book" }],
      ["GET", "/api/books", [renamed, SECOND_BOOK]],
      ["PATCH", "/api/books/1", answer, status, { name: "Retitled Book" }],
      // The item view shows no clock; the list shows the one the second call stamped.
      ["GET", "/api/books/1", summary(retitled)],
      ["GET", "/api/books", [retitled, SECOND_BOOK]],
    ];
    expect(gated(rows("", 204), "patch_books_by_id")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        expect.objectContaining({ field: "updated_at", rule: "clock" }),
      ]),
      checked_record_ordinals: [4],
      contradicted_by: null,
    });
    // An answer that shows the clock observes the call, so the list checks it.
    expect(gated(rows(retitled, 200), "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [4, 6, 7],
    });
  });
});

describe("partial update observations", () => {
  it("keeps write-response fields when the item view omits them", () => {
    const first: Book = { ...FIRST_BOOK, description: "First description" };
    const second: Book = { ...SECOND_BOOK, description: "Second description" };
    const itemSummary = (entry: Book): Book => ({
      id: entry.id!,
      name: entry.name!,
    });
    const renamed = {
      ...first,
      name: "Renamed first",
      slug: "renamed-first",
      updated_at: bookClock(3),
    };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books/1", itemSummary(first)],
      ["GET", "/api/books/2", itemSummary(second)],
      ["PATCH", "/api/books/1", renamed, 200, { name: "Renamed first" }],
      ["GET", "/api/books/1", itemSummary(renamed)],
      [
        "PATCH",
        "/api/books/2",
        { id: 2, name: second.name!, description: "Revised description" },
        200,
        { description: "Revised description" },
      ],
      // This item view covers only id/name, not description or the learned clock.
      ["GET", "/api/books/2", itemSummary(second)],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      reason: null,
      checked_record_ordinals: [4],
      rules: [
        { field: "name", rule: "echo" },
        { field: "slug", rule: "slug", from: "name" },
        { field: "updated_at", rule: "clock" },
        { field: "description", rule: "echo" },
      ],
    });
  });

  it("uses read coverage without dropping fields shown by the write response", () => {
    const first: Book = { ...FIRST_BOOK, description: "First description" };
    const second: Book = { ...SECOND_BOOK, description: "Second description" };
    const itemSummary = (entry: Book): Book => ({
      id: entry.id!,
      name: entry.name!,
      updated_at: entry.updated_at!,
    });
    const renamed = {
      ...first,
      name: "Renamed first",
      slug: "renamed-first",
      updated_at: bookClock(3),
    };
    const revised = {
      id: 2,
      name: second.name!,
      description: "Revised description",
    };
    const revisedSummary = {
      id: 2,
      name: second.name!,
      updated_at: bookClock(6),
    };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books/1", itemSummary(first)],
      ["GET", "/api/books/2", itemSummary(second)],
      ["PATCH", "/api/books/1", renamed, 200, { name: "Renamed first" }],
      ["GET", "/api/books/1", itemSummary(renamed)],
      [
        "PATCH",
        "/api/books/2",
        revised,
        200,
        { description: "Revised description" },
      ],
      // The item view covers the clock, but not the description returned by PATCH.
      ["GET", "/api/books/2", revisedSummary],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: true,
      reason: null,
      checked_record_ordinals: [4],
      rules: [
        { field: "name", rule: "echo" },
        { field: "slug", rule: "slug", from: "name" },
        { field: "updated_at", rule: "clock" },
        { field: "description", rule: "echo" },
      ],
    });
  });
});

describe("what later calls must keep consistent", () => {
  it("refuses an update one call sends an ignored id with and another the path's id", () => {
    const renamed = (at: Book, name: string) => ({ ...at, name });
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      [
        "PATCH",
        "/api/books/1",
        renamed(FIRST_BOOK, "B"),
        200,
        { id: 999, name: "B" },
      ],
      ["GET", "/api/books/1", renamed(FIRST_BOOK, "B")],
      [
        "PATCH",
        "/api/books/2",
        renamed(SECOND_BOOK, "C"),
        200,
        { id: 2, name: "C" },
      ],
      ["GET", "/api/books/2", renamed(SECOND_BOOK, "C")],
    ];
    expect(gated(rows, "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("refuses a create whose later call records a clock in another format", () => {
    const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);
    const fourth = {
      ...book(4, "Fourth Book", bookClock(5)),
      created_at: epoch(bookClock(5)),
      updated_at: epoch(bookClock(5)),
    };
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      ["GET", "/api/books/3", THIRD_BOOK],
      ["POST", "/api/books", fourth, 201, { name: "Fourth Book" }],
      ["GET", "/api/books/4", fourth],
    ];
    expect(gated(rows, "post_books")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("names no entity by a delete whose path id decodes to it only twice, as serving would not", () => {
    const uid = (key: string) => ({ uid: key, name: key });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [uid("book1"), uid("book2")]],
      ["GET", "/api/books/uid/book1", uid("book1")],
      ["GET", "/api/books/uid/book2", uid("book2")],
      ["DELETE", "/api/books/uid/book%2531", "", 204],
      ["GET", "/api/books/uid/book1", BOOK_NOT_FOUND, 404],
    ];
    const { writes } = environmentStateViewOf(timedCaptureEvidence(rows), [
      "after-uid-literal",
    ]);
    expect(writes.find((plan) => plan.effect === "delete")).toMatchObject({
      served: false,
      checked_record_ordinals: [],
    });
  });

  it("does not let a later empty ?page=2 page contradict a create", () => {
    const alpha = { id: 1, name: "Alpha", org: "1" };
    const beta = { id: 2, name: "Beta", org: "2" };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/orgs/1/books", [alpha]],
      ["GET", "/api/orgs/1/books/1", alpha],
      ["GET", "/api/orgs/2/books?page=2", []],
      ["POST", "/api/orgs/2/books", beta, 201, { name: "Beta" }],
      ["GET", "/api/orgs/2/books/2", beta],
      ["GET", "/api/orgs/2/books?page=2", []],
    ];
    const { writes } = environmentStateViewOf(timedCaptureEvidence(rows));
    expect(writes.find((plan) => plan.effect === "create")).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
  });

  it.each(["offset", "start", "_start"])(
    "does not let a later empty ?%s=1 page contradict a create",
    (name) => {
      const alpha = { id: 1, name: "Alpha", org: "1" };
      const beta = { id: 2, name: "Beta", org: "2" };
      const rows: TimedCaptureRow[] = [
        ["GET", "/api/orgs/1/books", [alpha]],
        ["GET", "/api/orgs/1/books/1", alpha],
        ["GET", `/api/orgs/2/books?${name}=1`, []],
        ["POST", "/api/orgs/2/books", beta, 201, { name: "Beta" }],
        ["GET", "/api/orgs/2/books/2", beta],
        ["GET", `/api/orgs/2/books?${name}=1`, []],
      ];
      const { writes } = environmentStateViewOf(timedCaptureEvidence(rows));
      expect(writes.find((plan) => plan.effect === "create")).toMatchObject({
        served: true,
        checked_record_ordinals: [4],
      });
    },
  );

  it("checks nothing by a whole line recorded empty under a zero limit once a create fills its collection", () => {
    const alpha = { id: 1, name: "Alpha", org: "1" };
    const beta = { id: 2, name: "Beta", org: "2" };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/orgs/1/books", [alpha]],
      ["GET", "/api/orgs/1/books/1", alpha],
      ["GET", "/api/orgs/2/books?limit=0", []],
      ["POST", "/api/orgs/2/books", beta, 201, { name: "Beta" }],
      ["GET", "/api/orgs/2/books/2", beta],
      // An empty recording does not show that zero lists every entity.
      ["GET", "/api/orgs/2/books?limit=0", []],
    ];
    const { writes } = environmentStateViewOf(timedCaptureEvidence(rows));
    expect(writes.find((plan) => plan.effect === "create")).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
  });
});

describe("creates tied to one collection", () => {
  it("does not let a later create in another collection confirm the plan", () => {
    expect(gated(tiedCreateRows(false), "post_orgs_books_by_id")).toMatchObject(
      {
        served: false,
        reason: "unconfirmed",
        collection: "/api/orgs/1/books",
        checked_record_ordinals: [],
      },
    );
  });

  it("still confirms the plan from a read of the collection it is tied to", () => {
    expect(gated(tiedCreateRows(true), "post_orgs_books_by_id")).toMatchObject({
      served: true,
      collection: "/api/orgs/1/books",
      checked_record_ordinals: [5],
    });
  });

  const acmeRows = (
    laterPath: string,
    heldEncoded: boolean,
  ): TimedCaptureRow[] => {
    const alpha = {
      ...book(1, "Alpha", "2026-10-01T09:00:00Z"),
      team: "/orgs/uid/acme1",
    };
    const made = tiedToAcme(2, "Made", 2);
    const other = tiedToAcme(3, "Other", heldEncoded ? 5 : 3);
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/orgs/uid/acme1/books", [alpha]],
      ["GET", "/api/orgs/uid/acme1/books/1", alpha],
    ];
    if (heldEncoded) {
      const encoded = {
        ...book(10, "Encoded", "2026-10-01T10:00:00Z"),
        team: "/orgs/uid/acme1",
      };
      rows.push(
        ["GET", "/api/orgs/uid/%61cme1/books", [encoded]],
        ["GET", "/api/orgs/uid/%61cme1/books/10", encoded],
      );
    }
    rows.push(
      ["POST", "/api/orgs/uid/acme1/books", made, 201, { name: "Made" }],
      ["POST", laterPath, other, 201, { name: "Other" }],
      ["GET", "/api/orgs/uid/acme1/books/3", other],
    );
    return rows;
  };

  it("confirms a tied create whose later call spells the held collection encoded", () => {
    expect(
      acmeCreate(acmeRows("/api/orgs/uid/%61cme1/books", false)),
    ).toMatchObject({
      served: true,
      collection: "/api/orgs/uid/acme1/books",
      checked_record_ordinals: [4],
    });
  });

  it("does not treat an encoded spelling as the tied collection when that spelling is held itself", () => {
    // Serving keeps the verbatim encoded collection, outside the plain tie. The plain read of the
    // entity that create did not add is related to the exemplar, so the plan is a side effect.
    expect(
      acmeCreate(acmeRows("/api/orgs/uid/%61cme1/books", true)),
    ).toMatchObject({
      served: false,
      reason: "side-effect",
      collection: "/api/orgs/uid/acme1/books",
      checked_record_ordinals: [],
    });
  });

  it("chooses among emptied spellings of a tied collection in the order serving remembers them", () => {
    const first = "/api/orgs/uid/%61cme1/books";
    const second = "/api/orgs/uid/a%63me1/books";
    const alpha = {
      ...book(1, "Alpha", "2026-10-01T09:00:00Z"),
      team: "/orgs/uid/acme1",
    };
    const beta = {
      ...book(10, "Beta", "2026-10-01T10:00:00Z"),
      team: "/orgs/uid/acme1",
    };
    const made = tiedToAcme(2, "Made", 4);
    const other = tiedToAcme(3, "Other", 8);
    // The second spelling empties before the first, but serving still offers the first spelling first.
    const rows: TimedCaptureRow[] = [
      ["GET", first, [alpha]],
      ["GET", second, [beta]],
      ["GET", `${first}/1`, alpha],
      ["GET", `${second}/10`, beta],
      ["POST", second, made, 201, { name: "Made" }],
      ["DELETE", `${second}/10`, "", 204],
      ["DELETE", `${second}/2`, "", 204],
      ["DELETE", `${first}/1`, "", 204],
      ["POST", "/api/orgs/uid/acme1/books", other, 201, { name: "Other" }],
      ["GET", "/api/orgs/uid/acme1/books/3", other],
    ];
    expect(acmeCreate(rows)).toMatchObject({
      collection: second,
      checked_record_ordinals: [],
    });
  });

  it("keeps a tied collection ahead of another spelling once its first entity is gone, as serving orders them", () => {
    const first = "/api/orgs/uid/%61cme1/books";
    const second = "/api/orgs/uid/a%63me1/books";
    const alpha = {
      ...book(1, "Alpha", "2026-10-01T09:00:00Z"),
      team: "/orgs/uid/acme1",
    };
    const beta = {
      ...book(10, "Beta", "2026-10-01T10:00:00Z"),
      team: "/orgs/uid/acme1",
    };
    const made = tiedToAcme(2, "Made", 4);
    const other = tiedToAcme(3, "Other", 6);
    // Serving places the created book beside its collection, so the first spelling still leads after its first book goes.
    const rows: TimedCaptureRow[] = [
      ["GET", first, [alpha]],
      ["GET", second, [beta]],
      ["GET", `${first}/1`, alpha],
      ["GET", `${second}/10`, beta],
      ["POST", first, made, 201, { name: "Made" }],
      ["DELETE", `${first}/1`, "", 204],
      ["POST", "/api/orgs/uid/acme1/books", other, 201, { name: "Other" }],
      ["GET", "/api/orgs/uid/acme1/books/3", other],
    ];
    expect(acmeCreate(rows)).toMatchObject({
      served: true,
      collection: first,
      checked_record_ordinals: [7],
    });
  });
});

describe("path fields of a create", () => {
  const held = "/api/orgs/uid/%2561cme1/books";
  /** A create held under a doubly encoded parent, then one whose call spells the parent once encoded, read back with `org`. */
  const rowsWith = (org: string): TimedCaptureRow[] => {
    const alpha = {
      ...book(1, "Alpha", "2026-10-01T09:00:00Z"),
      org: "%61cme1",
    };
    const made = { ...book(2, "Made", bookClock(2)), org: "%61cme1" };
    const other = { ...book(3, "Other", bookClock(3)), org };
    return [
      ["GET", held, [alpha]],
      ["GET", `${held}/1`, alpha],
      ["POST", held, made, 201, { name: "Made" }],
      ["POST", "/api/orgs/uid/%61cme1/books", other, 201, { name: "Other" }],
      ["GET", `${held}/3`, other],
    ];
  };
  const planOf = (rows: TimedCaptureRow[]) =>
    environmentStateViewOf(timedCaptureEvidence(rows), [
      "after-uid-literal",
    ]).writes.find((candidate) => candidate.effect === "create");

  it("contradicts a later create whose read shows a parent serving would not write", () => {
    expect(planOf(rowsWith("acme1"))).toMatchObject({
      served: false,
      checked_record_ordinals: [],
      contradicted_by: 4,
    });
  });

  it("confirms a later create whose read shows the parent decoded from the collection serving selects", () => {
    expect(planOf(rowsWith("%61cme1"))).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
  });
});

describe("path fields of a create tied to its collection", () => {
  const held = "/api/orgs/uid/%61cme1/books";

  /** A tied create in the held encoded collection, then one spelled double-encoded whose parent the application stored as `org`. */
  const parentRows = (org: string): TimedCaptureRow[] => {
    const alpha = {
      ...book(1, "Alpha", "2026-10-01T09:00:00Z"),
      team: "/orgs/uid/acme1",
      org: "acme1",
    };
    const made = { ...tiedToAcme(2, "Made", 2), org: "acme1" };
    const other = { ...tiedToAcme(3, "Other", 3), org };
    return [
      ["GET", held, [alpha]],
      ["GET", `${held}/1`, alpha],
      ["POST", held, made, 201, { name: "Made" }],
      ["POST", "/api/orgs/uid/%2561cme1/books", other, 201, { name: "Other" }],
      ["GET", `${held}/3`, other],
    ];
  };

  it("contradicts a later create whose read shows a parent serving would not write", () => {
    // Serving selects the held collection and decodes the parent from it, not from the call's spelling.
    expect(acmeCreate(parentRows("%61cme1"))).toMatchObject({
      served: false,
      collection: held,
      rules: expect.arrayContaining([
        expect.objectContaining({ field: "org", rule: "path" }),
      ]),
      checked_record_ordinals: [],
      contradicted_by: 4,
    });
  });

  it("confirms a later create whose read shows the parent decoded from the selected collection", () => {
    expect(acmeCreate(parentRows("acme1"))).toMatchObject({
      served: true,
      collection: held,
      checked_record_ordinals: [4],
    });
  });
});

it("withholds a create when a sibling read through an encoded collection reveals an extra change", () => {
  const alpha = { id: 1, name: "Alpha" };
  const beta = { id: 2, name: "Beta" };
  const gamma = { id: 3, name: "Gamma" };
  const delta = { id: 4, name: "Delta" };
  const rows: TimedCaptureRow[] = [
    ["GET", "/api/orgs/%61cme1/books", [alpha]],
    ["GET", "/api/orgs/beta2/books", [beta]],
    ["GET", "/api/orgs/%61cme1/books/1", alpha],
    ["GET", "/api/orgs/beta2/books/2", beta],
    ["POST", "/api/orgs/acme1/books", gamma, 201, { name: "Gamma" }],
    ["GET", "/api/orgs/acme1/books/3", gamma],
    ["GET", "/api/orgs/%61cme1/books/1", { ...alpha, name: "Changed" }],
    ["POST", "/api/orgs/beta2/books", delta, 201, { name: "Delta" }],
  ];
  const state = environmentStateViewOf(timedCaptureEvidence(rows), [
    "sibling-variance",
  ]);
  expect(state.writes.find((plan) => plan.effect === "create")).toMatchObject({
    served: false,
    reason: "side-effect",
  });
});

it("learns omitted fields using the raw ID resolved by the item owner", () => {
  const state = new SimulatedState(
    [
      {
        type: "/api/books",
        collection: "/api/books",
        id: "%63",
        fields: { id: "%63", name: "Created" },
        view_fields: [],
        record_ordinals: [],
      },
    ],
    [],
  );
  const view = {
    tool: "get_books_by_id",
    type: "/api/books",
    shape: "item" as const,
    pointer: "",
    fields: ["id", "name", "detail"],
    required_fields: ["id", "name", "detail"],
    checked_record_ordinals: [0],
    envelope_ordinal: 0,
  };
  const record = {
    ordinal: 1,
    method: "GET",
    path: "/api/books/%63",
    query: undefined,
    status: 200,
    timing: { start: undefined, endMs: undefined },
  };
  const target = itemTarget(state, view.type, record);
  expect(target.id).toBe("%63");
  const read = {
    body: { id: "%63", name: "Created" },
    base: { id: "seed", name: "Seed", detail: "x" },
    volatile: new Set<string>(),
    idField: "id",
    collection: target.collection,
    itemId: target.id,
  };
  const omitted = new OmittedFields(() => {});
  const outcome = omitted.check(state, view, record, read, (loosened) =>
    checkItemRead(state, loosened, record, read),
  );
  expect(outcome).toMatchObject({ pass: true, omitted: ["detail"] });
  if (outcome === undefined) throw new Error("Expected a counted read");
  omitted.keep(view, outcome);
  expect(omitted.views([view])[0]).toMatchObject({
    required_fields: ["id", "name"],
  });
});

describe("create exemplar retention", () => {
  const facts = () => {
    const snapshot = { id: "held", payload: "p".repeat(1_000_000) };
    const held = Array.from({ length: 1000 }, () => snapshot);
    return {
      entity: { id: "new", url: "/new" },
      call: {
        path: "/items",
        pathValues: new Map<string, string>(),
        body: { payload: "x".repeat(10_000) },
      },
      idField: "id",
      startMs: undefined,
      collection: held,
      type: held,
    };
  };
  it("charges temporary request facts and shared snapshot references without rebilling owned entity payloads", () => {
    let retained = 0;
    const context = {
      io: {
        retain: (bytes: number) => {
          retained += bytes;
        },
      },
    } as unknown as EffectContext;
    const input = facts();
    expect(retainCreateExemplar(context, input, [])).toBe(input);
    expect(retained).toBeGreaterThan(28_000);
    expect(retained).toBeLessThan(40_000);
  });
  it("retains no exemplar when every string field is already explained", () => {
    const retain = vi.fn();
    const context = { io: { retain } } as unknown as EffectContext;
    expect(
      retainCreateExemplar(context, facts(), [
        { field: "id", rule: "echo" },
        { field: "url", rule: "echo" },
      ]),
    ).toBeUndefined();
    expect(retain).not.toHaveBeenCalled();
  });
  it("does not adopt request facts when the retained budget refuses them", () => {
    const context = {
      io: {
        retain: () => {
          throw new Error("budget exhausted");
        },
      },
    } as unknown as EffectContext;
    expect(() => retainCreateExemplar(context, facts(), [])).toThrow(
      "budget exhausted",
    );
  });
});
it.each([
  {
    label: "point read with simultaneous unknown action",
    archiveStart: 4,
    duration: 0,
    archiveDuration: -1,
    target: "1",
    served: false,
  },
  {
    label: "point read with simultaneous point action",
    archiveStart: 4,
    duration: 0,
    archiveDuration: 0,
    target: "1",
    served: true,
  },
  {
    label: "point read with unrelated unknown action",
    archiveStart: 4,
    duration: 0,
    archiveDuration: -1,
    target: "2",
    served: true,
  },
  {
    label: "same-start later ordinal",
    archiveStart: 4,
    duration: 5,
    target: "1",
    served: false,
  },
  {
    label: "later start within response interval",
    archiveStart: 5,
    duration: 1500,
    target: "1",
    served: false,
  },
  {
    label: "unknown response completion",
    archiveStart: 5,
    duration: -1,
    target: "1",
    served: false,
  },
  {
    label: "known disjoint response interval",
    archiveStart: 6,
    duration: 1500,
    target: "1",
    served: true,
  },
  {
    label: "unrelated overlapping write",
    archiveStart: 5,
    duration: 1500,
    target: "2",
    served: true,
  },
])(
  "requires a read free of captured write overlap: $label",
  ({ archiveStart, duration, target, served, ...options }) => {
    const rows: TimedCaptureRow[] = [
      [
        "GET",
        "/api/books",
        [
          { id: 1, name: "A" },
          { id: 2, name: "B" },
        ],
      ],
      ["GET", "/api/books/1", { id: 1, name: "A" }],
      ["GET", "/api/books/2", { id: 2, name: "B" }],
      ["PATCH", "/api/books/1", { id: 1, name: "Z" }, 200, { name: "Z" }],
      ["GET", "/api/books/1", { id: 1, name: "Z" }, 200, undefined, duration],
      [
        "POST",
        `/api/books/${target}/archive`,
        null,
        204,
        {},
        "archiveDuration" in options ? options.archiveDuration : 5,
      ],
    ];
    const entries = rows.map(
      (
        [method, path, body = null, status = 200, request, time = 5],
        index,
      ) => ({
        startedDateTime: new Date(
          Date.parse(bookClock(index === 5 ? archiveStart : index)),
        ).toISOString(),
        time,
        request: {
          method,
          url: `http://app.example${path}`,
          bodySize:
            request === undefined
              ? 0
              : Buffer.byteLength(JSON.stringify(request)),
          ...(request === undefined
            ? {}
            : {
                postData: {
                  mimeType: "application/json",
                  text: JSON.stringify(request),
                },
              }),
        },
        response: {
          status,
          content: { mimeType: "application/json", text: JSON.stringify(body) },
        },
      }),
    );
    const capture = analysisViewCaptureEvidence(
      environmentManifestCaptureFixture(entries),
    );
    const plan = environmentStateViewOf(capture).writes.find(
      (write) => write.tool === "patch_books_by_id",
    );
    expect(plan).toMatchObject({
      served,
      checked_record_ordinals: served ? [4] : [],
      contradicted_by: null,
    });
  },
);
