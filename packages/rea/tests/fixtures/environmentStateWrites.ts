import {
  projectAnalysisView,
  type AnalysisViewResult,
} from "../../src/domain/analysisView/analysisView.js";
import type { TemplateRule } from "../../src/domain/analysisView/environmentManifestRules.js";
import type { Evidence } from "../../src/domain/evidence.js";
import type { JsonValue } from "../../src/domain/jsonValue.js";
import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
  type TimedCaptureRow,
} from "./analysisView.js";

/** When the first synthetic exchange starts; exchange `i` starts `i` seconds later, as in `timedCaptureEvidence`. */
const CAPTURE_START_MS = Date.parse("2026-10-17T18:00:00.000Z");

/** The instant `seconds` after the first exchange, spelled as the books application spells clock values. */
export const bookClock = (seconds: number): string =>
  new Date(CAPTURE_START_MS + seconds * 1000)
    .toISOString()
    .replace(".000Z", "Z");

/** Lower case with every run of other characters joined by one `-`, as the books application slugs names. */
const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

/** A book as the application shows it. */
export type Book = { [field: string]: JsonValue };

/** A book whose slug follows its name. */
export const book = (
  id: number,
  name: string,
  created: string,
  updated = created,
): Book => ({
  id,
  name,
  slug: slugOf(name),
  created_at: created,
  updated_at: updated,
});

/** A book renamed by an update recorded at exchange `seconds`: its slug and update clock follow. */
export const renamedBook = (
  entity: Book,
  name: string,
  seconds: number,
): Book => ({
  ...entity,
  name,
  slug: slugOf(name),
  updated_at: bookClock(seconds),
});

export const FIRST_BOOK = book(1, "First Book", "2026-10-01T09:00:00Z");
export const SECOND_BOOK = book(2, "Second Book", "2026-10-01T10:00:00Z");
/** The book the recorded create at exchange 3 made. */
export const THIRD_BOOK = book(3, "Third Book", bookClock(3));
/** The book a create recorded at exchange 4 made. */
const THIRD_BOOK_AT_4 = book(3, "Third Book", bookClock(4));
/** The first book after the recorded update at exchange 5. */
export const RENAMED_BOOK = renamedBook(FIRST_BOOK, "Renamed Book", 5);

/** What the item read answered for a book the application does not hold. */
export const BOOK_NOT_FOUND = { detail: "Not found." };
/** What the delete answered for a book the application does not hold. */
export const DELETE_NOT_FOUND = { detail: "No Book matches the given query." };

/** Reads before any write: the whole list, then each book; the initial state comes from these. */
export const BOOK_INIT_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
  ["GET", "/api/books/1", FIRST_BOOK],
  ["GET", "/api/books/2", SECOND_BOOK],
];

/**
 * A create, an update and a delete, each confirmed by later reads; a delete of a book the
 * application did not hold; and a write to no state type.
 */
export const BOOK_ROWS: readonly TimedCaptureRow[] = [
  ...BOOK_INIT_ROWS,
  ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
  ["GET", "/api/books/3", THIRD_BOOK],
  ["PATCH", "/api/books/1", RENAMED_BOOK, 200, { name: "Renamed Book" }],
  ["GET", "/api/books/1", RENAMED_BOOK],
  ["DELETE", "/api/books/3", "", 204],
  ["GET", "/api/books/3", BOOK_NOT_FOUND, 404],
  ["GET", "/api/books", [RENAMED_BOOK, SECOND_BOOK]],
  ["DELETE", "/api/books/9", DELETE_NOT_FOUND, 404],
  ["POST", "/api/exports", { queued: true }, 202, { format: "csv" }],
];

/** A bulk delete of both books sending `body` and answering `response`, which the reads after it confirm. */
export const bothBooksDeleted = (
  response: JsonValue,
  body: JsonValue = { ids: [1, 2] },
): TimedCaptureRow[] => [
  ...BOOK_INIT_ROWS,
  ["DELETE", "/api/books", response, 200, body],
  ["GET", "/api/books/1", BOOK_NOT_FOUND, 404],
  ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
  ["GET", "/api/books", []],
];

/** Both books as a bulk rename recorded at exchange 3 left them. */
const BOTH_RENAMED = [FIRST_BOOK, SECOND_BOOK].map((entity) =>
  renamedBook(entity, "Renamed Book", 3),
);

/** A bulk rename of both books answering both, which the reads after it confirm. */
export const BOTH_BOOKS_RENAMED_ROWS: readonly TimedCaptureRow[] = [
  ...BOOK_INIT_ROWS,
  [
    "PATCH",
    "/api/books",
    BOTH_RENAMED,
    200,
    { ids: [1, 2], name: "Renamed Book" },
  ],
  ["GET", "/api/books/1", BOTH_RENAMED[0]!],
  ["GET", "/api/books/2", BOTH_RENAMED[1]!],
  ["GET", "/api/books", BOTH_RENAMED],
];

/** A book whose item reads carry a `detail` member, which the application leaves out of books that have none. */
export const detailedBook = (entity: Book): Book => ({
  ...entity,
  detail: "x",
});

/** Seeded books read with `detail`; a created book read back without it. */
export const OMITTED_FIELD_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
  ["GET", "/api/books/1", detailedBook(FIRST_BOOK)],
  ["GET", "/api/books/2", detailedBook(SECOND_BOOK)],
  ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
  ["GET", "/api/books/3", THIRD_BOOK],
];

/** Seeded books listed and read with `detail`; a created book read back by item alone, without it. */
export const DETAILED_LIST_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/books", [detailedBook(FIRST_BOOK), detailedBook(SECOND_BOOK)]],
  ["GET", "/api/books/1", detailedBook(FIRST_BOOK)],
  ["GET", "/api/books/2", detailedBook(SECOND_BOOK)],
  ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
  ["GET", "/api/books/3", THIRD_BOOK],
];

/** Item reads of both books, one of them asking for its name only, which leaves its id out. */
export const PROJECTED_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
  ["GET", "/api/books/1", FIRST_BOOK],
  ["GET", "/api/books/2", SECOND_BOOK],
  ["GET", "/api/books/2?fields=name", { name: "Second Book" }],
];

/** A book as a list asked to expand its shelf shows it. */
export const expandedBook = (entity: Book): Book => ({
  ...entity,
  shelf: { id: 7, name: "Main Hall" },
});

/** The list read plainly and with its shelves expanded, then a create the plain list shows. */
export const EXPANDED_LIST_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
  [
    "GET",
    "/api/books?expand=shelf",
    [FIRST_BOOK, SECOND_BOOK].map(expandedBook),
  ],
  ["GET", "/api/books/1", FIRST_BOOK],
  ["GET", "/api/books/2", SECOND_BOOK],
  ["POST", "/api/books", THIRD_BOOK_AT_4, 201, { name: "Third Book" }],
  ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK, THIRD_BOOK_AT_4]],
];

/** A book numbered as an asset, in digit groups. */
export const assetBook = (entity: Book, asset: string): Book => ({
  ...entity,
  asset,
});

const ASSET_THIRD = assetBook(THIRD_BOOK, "000-003");
const ASSET_FOURTH = assetBook(book(4, "Fourth Book", bookClock(5)), "000-004");

/** Two creates whose asset number follows the largest held one, in its digit groups. */
export const ASSET_ROWS: readonly TimedCaptureRow[] = [
  [
    "GET",
    "/api/books",
    [assetBook(FIRST_BOOK, "000-001"), assetBook(SECOND_BOOK, "000-002")],
  ],
  ["GET", "/api/books/1", assetBook(FIRST_BOOK, "000-001")],
  ["GET", "/api/books/2", assetBook(SECOND_BOOK, "000-002")],
  ["POST", "/api/books", ASSET_THIRD, 201, { name: "Third Book" }],
  ["GET", "/api/books/3", ASSET_THIRD],
  ["POST", "/api/books", ASSET_FOURTH, 201, { name: "Fourth Book" }],
  ["GET", "/api/books/4", ASSET_FOURTH],
];

/** A UUID-shaped value numbered `n`. */
export const numberedUuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A book with a version the application renews on every update and chapter rows it rewrites with new ids. */
export const versionedBook = (
  entity: Book,
  version: number,
  chapter: number,
): Book => ({
  ...entity,
  version_id: numberedUuid(version),
  chapters: [{ id: numberedUuid(chapter), title: "Opening" }],
});

/** Two renames of the first book, each sending the version it was read with; each gets a new version and the child rows `make` renews. */
const renamingRows = (
  make: (entity: Book, version: number, chapter: number) => Book,
  second: Book = make(SECOND_BOOK, 3, 4),
): TimedCaptureRow[] => {
  const once = make(renamedBook(FIRST_BOOK, "Renamed Book", 3), 5, 6);
  const twice = make(renamedBook(FIRST_BOOK, "Renamed Again", 5), 7, 8);
  return [
    ["GET", "/api/books", [make(FIRST_BOOK, 1, 2), second]],
    ["GET", "/api/books/1", make(FIRST_BOOK, 1, 2)],
    ["GET", "/api/books/2", second],
    [
      "PATCH",
      "/api/books/1",
      once,
      200,
      { name: "Renamed Book", version_id: numberedUuid(1) },
    ],
    ["GET", "/api/books/1", once],
    [
      "PATCH",
      "/api/books/1",
      twice,
      200,
      { name: "Renamed Again", version_id: numberedUuid(1) },
    ],
    ["GET", "/api/books/1", twice],
  ];
};

/** Two renames of the first book, each sending the version it was read with; each gets a new version and chapter ids. */
export const VERSIONED_ROWS: readonly TimedCaptureRow[] =
  renamingRows(versionedBook);

/** The author every chapter row names, which no renewal changes. */
export const CHAPTER_AUTHOR = numberedUuid(99);

/** As VERSIONED_ROWS, with chapter rows that also name their author. */
export const AUTHORED_ROWS: readonly TimedCaptureRow[] = renamingRows(
  (entity, version, chapter) => ({
    ...versionedBook(entity, version, chapter),
    chapters: [
      {
        id: numberedUuid(chapter),
        title: "Opening",
        author_id: CHAPTER_AUTHOR,
      },
    ],
  }),
);

/** As VERSIONED_ROWS, with contents naming each chapter row by its id. */
export const CONTENTS_ROWS: readonly TimedCaptureRow[] = renamingRows(
  (entity, version, chapter) => ({
    ...versionedBook(entity, version, chapter),
    contents: [{ chapter_id: numberedUuid(chapter), page: 1 }],
  }),
);

/** As VERSIONED_ROWS, with the second book known only without chapter rows. */
export const UNCHAPTERED_ROWS: readonly TimedCaptureRow[] = renamingRows(
  versionedBook,
  { ...SECOND_BOOK, version_id: numberedUuid(3) },
);

/** A book whose sent handle the application stores as its code and embeds in its link. */
export const handledBook = (entity: Book, handle: string): Book => ({
  ...entity,
  code: handle,
  link: `https://books.example.test/b/${handle}`,
});

const FOURTH_BOOK = handledBook(
  book(4, "Fourth Book", bookClock(5)),
  "fourth-handle",
);

/** Two creates, each sending a handle the application stores under another name. */
export const HANDLE_ROWS: readonly TimedCaptureRow[] = [
  [
    "GET",
    "/api/books",
    [
      handledBook(FIRST_BOOK, "first-handle"),
      handledBook(SECOND_BOOK, "second-handle"),
    ],
  ],
  ["GET", "/api/books/1", handledBook(FIRST_BOOK, "first-handle")],
  ["GET", "/api/books/2", handledBook(SECOND_BOOK, "second-handle")],
  [
    "POST",
    "/api/books",
    handledBook(THIRD_BOOK, "third-handle"),
    201,
    { name: "Third Book", handle: "third-handle" },
  ],
  ["GET", "/api/books/3", handledBook(THIRD_BOOK, "third-handle")],
  [
    "POST",
    "/api/books",
    FOURTH_BOOK,
    201,
    { name: "Fourth Book", handle: "fourth-handle" },
  ],
  ["GET", "/api/books/4", FOURTH_BOOK],
];

/** A page of books as a paging API wraps it, counting what it lists. */
export const bookPage = (books: readonly Book[]) => ({
  content: [...books],
  totalElements: books.length,
  numberOfElements: books.length,
});

/**
 * One list tool with a line that lists every book and a line filtered by name, item reads, then a
 * create the whole list confirms.
 */
export const LIST_LINE_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/books", bookPage([FIRST_BOOK, SECOND_BOOK])],
  ["GET", "/api/books?name=First%20Book", bookPage([FIRST_BOOK])],
  ...BOOK_INIT_ROWS.slice(1),
  ["POST", "/api/books", THIRD_BOOK_AT_4, 201, { name: "Third Book" }],
  ["GET", "/api/books/3", THIRD_BOOK_AT_4],
  ["GET", "/api/books", bookPage([FIRST_BOOK, SECOND_BOOK, THIRD_BOOK_AT_4])],
];

const shelved = (entry: Book, shelf: string): Book => ({ ...entry, shelf });
const SHELVED_FIRST = shelved(FIRST_BOOK, "a");
const SHELVED_SECOND = shelved(SECOND_BOOK, "b");
/** The book the create at exchange 7 of QUERY_ROWS made, on shelf a. */
export const SHELVED_THIRD = shelved(book(3, "Third Book", bookClock(7)), "a");

/**
 * One list tool recorded whole, filtered by shelf, searched, sorted and with a flag that changes nothing; item reads;
 * then a create the shelf filter later lists.
 */
export const QUERY_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/books", [SHELVED_FIRST, SHELVED_SECOND]],
  ["GET", "/api/books?shelf=a", [SHELVED_FIRST]],
  ["GET", "/api/books?q=second", [SHELVED_SECOND]],
  ["GET", "/api/books?sort=-id", [SHELVED_SECOND, SHELVED_FIRST]],
  ["GET", "/api/books?include=all", [SHELVED_FIRST, SHELVED_SECOND]],
  ["GET", "/api/books/1", SHELVED_FIRST],
  ["GET", "/api/books/2", SHELVED_SECOND],
  [
    "POST",
    "/api/books",
    SHELVED_THIRD,
    201,
    { name: "Third Book", shelf: "a" },
  ],
  ["GET", "/api/books?shelf=a", [SHELVED_FIRST, SHELVED_THIRD]],
];

/** A clock spelled with a `+00:00` offset where the books application's item reads spell `Z`. */
export const offsetClock = (clock: JsonValue | undefined): string =>
  String(clock).replace(/Z$/u, "+00:00");

/** A book as a list that spells its clocks with an offset shows it. */
export const offsetListed = (entity: Book): Book => ({
  ...entity,
  created_at: offsetClock(entity.created_at),
  updated_at: offsetClock(entity.updated_at),
});

/** Item reads spell clocks with `Z`, the whole list with `+00:00`; a create is read back both ways. */
export const OFFSET_LIST_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK].map(offsetListed)],
  ["GET", "/api/books/1", FIRST_BOOK],
  ["GET", "/api/books/2", SECOND_BOOK],
  ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
  ["GET", "/api/books/3", THIRD_BOOK],
  [
    "GET",
    "/api/books",
    [FIRST_BOOK, SECOND_BOOK, THIRD_BOOK].map(offsetListed),
  ],
];

/** The end of the last exchange of BOOK_ROWS, to the next whole second: where the served clock starts. */
export const BOOK_WRITE_CLOCK = "2026-10-17T18:00:12.000Z";

/**
 * Capture Evidence like `timedCaptureEvidence`, but each request body is recorded under the
 * given media type (a string as written, anything else as JSON), and the exchanges may carry
 * no start times.
 */
export const rawCaptureEvidence = (
  rows: readonly TimedCaptureRow[],
  request: { readonly mimeType: string; readonly timed: boolean },
): Evidence =>
  analysisViewCaptureEvidence(
    environmentManifestCaptureFixture(
      rows.map(([method, path, body = null, status = 200, sent], index) => ({
        ...(request.timed
          ? {
              startedDateTime: new Date(
                CAPTURE_START_MS + index * 1000,
              ).toISOString(),
              time: 5,
            }
          : {}),
        request: {
          method,
          url: `http://app.example${path}`,
          ...(sent === undefined
            ? {}
            : {
                postData: {
                  mimeType: request.mimeType,
                  text: typeof sent === "string" ? sent : JSON.stringify(sent),
                },
              }),
        },
        response: {
          status,
          content: {
            mimeType: "application/json",
            text: typeof body === "string" ? body : JSON.stringify(body),
          },
        },
      })),
    ),
  );

type EnvironmentStateView = Extract<
  AnalysisViewResult,
  { kind: "environment-state" }
>;

/** The environment-state view a capture projects with no opt-in template rules. */
export const environmentStateViewOf = (
  capture: Evidence,
  templateRules: readonly TemplateRule[] = [],
): EnvironmentStateView => {
  const result = projectAnalysisView(
    {
      evidenceId: capture.evidence_id,
      operation: capture.operation,
      normalizedResult: capture.normalized_result,
      subject: capture.subject,
      limitations: [],
      parameters: capture.parameters,
    },
    { kind: "environment-state", template_rules: [...templateRules] },
  );
  if (!result.ok || result.value.kind !== "environment-state")
    throw new Error("Expected an environment state");
  return result.value;
};
