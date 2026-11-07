import { describe, expect, it } from "vitest";

import type { JsonValue } from "../jsonValue.js";
import { webNetworkCaptureSchema } from "../webNetworkCapture.js";
import { EnvironmentStateAccumulator } from "./EnvironmentStateAccumulator.js";
import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  ASSET_ROWS,
  BOOK_INIT_ROWS,
  BOOK_NOT_FOUND,
  BOOK_ROWS,
  BOOK_WRITE_CLOCK,
  DETAILED_LIST_ROWS,
  EXPANDED_LIST_ROWS,
  FIRST_BOOK,
  OMITTED_FIELD_ROWS,
  PROJECTED_ROWS,
  RENAMED_BOOK,
  HANDLE_ROWS,
  LIST_LINE_ROWS,
  QUERY_ROWS,
  OFFSET_LIST_ROWS,
  SECOND_BOOK,
  THIRD_BOOK,
  assetBook,
  VERSIONED_ROWS,
  book,
  numberedUuid,
  versionedBook,
  offsetListed,
  bookClock,
  detailedBook,
  environmentStateViewOf,
  expandedBook,
  rawCaptureEvidence,
  renamedBook,
  type Book,
} from "../../../tests/fixtures/environmentStateWrites.js";

type StateView = ReturnType<typeof environmentStateViewOf>;

const ISO_SECONDS = {
  kind: "iso",
  separator: "T",
  fraction: 0,
  zone: "Z",
} as const;

const stateOf = (rows: readonly TimedCaptureRow[]): StateView =>
  environmentStateViewOf(timedCaptureEvidence(rows));

it("retains learned clock rules but withholds their serving when the global clock is unknown", () => {
  const baseline = stateOf(BOOK_ROWS);
  const unknown = stateOf([
    ...BOOK_ROWS,
    ["GET", "/api/health", { ready: true }, 200, undefined, -1],
  ]);
  expect(baseline.write_clock).not.toBeNull();
  expect(unknown.write_clock).toBeNull();
  const generatesClock = (plan: StateView["writes"][number]) =>
    plan.rules.some((rule) =>
      ["clock", "held-clock", "nested-clock"].includes(rule.rule),
    );
  const clockPlans = baseline.writes.filter(
    (plan) => plan.served && generatesClock(plan),
  );
  expect(clockPlans.length).toBeGreaterThan(0);
  for (const plan of clockPlans)
    expect(
      unknown.writes.find((candidate) => candidate.tool === plan.tool),
    ).toEqual({
      ...plan,
      served: false,
      reason: "unknown-clock",
    });
  const independent = baseline.writes.filter(
    (plan) => plan.served && !generatesClock(plan),
  );
  expect(independent.length).toBeGreaterThan(0);
  for (const plan of independent)
    expect(
      unknown.writes.find((candidate) => candidate.tool === plan.tool),
    ).toEqual(plan);
});

it.each(["delete", "mismatched-query"])(
  "does not parse unused request content for %s under a bounded state allowance",
  (kind) => {
    const payload = { unused: "x".repeat(96 * 1024) };
    const changed = renamedBook(FIRST_BOOK, "Renamed", 3);
    const rows: TimedCaptureRow[] =
      kind === "delete"
        ? [
            ...BOOK_INIT_ROWS,
            ["DELETE", "/api/books/2", "", 204, payload],
            ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
          ]
        : [
            ...BOOK_INIT_ROWS,
            [
              "PATCH",
              "/api/books/1?mode=one",
              changed,
              200,
              { name: "Renamed" },
            ],
            ["GET", "/api/books/1", changed],
            ["PATCH", "/api/books/2?mode=two", SECOND_BOOK, 200, payload],
          ];
    const capture = webNetworkCaptureSchema.parse(
      timedCaptureEvidence(rows).normalized_result,
    );
    const accumulator = new EnvironmentStateAccumulator(512 * 1024);
    for (const record of capture.records) {
      const added = accumulator.add(record);
      if (!added.ok) throw added.error;
    }
    const state = accumulator.finishState();
    expect(state).toMatchObject({ ok: true });
    if (!state.ok) throw state.error;
    expect(
      state.value.writes.find(
        (write) => write.effect === (kind === "delete" ? "delete" : "update"),
      ),
    ).toMatchObject({ served: true });
  },
);

describe("structured values an earlier update kept", () => {
  it.each([false, true])(
    "refuses a later derived rule that changes an earlier kept value (array: %s)",
    (array) => {
      const content = (text: string): JsonValue =>
        array ? [{ text }] : { children: [{ text }] };
      const entry = (id: number, edited: boolean) => ({
        id,
        title: edited ? "Edited" : "Original",
        content: content(edited ? "Edited body text." : "Original body text."),
      });
      const initial: TimedCaptureRow[] = [
        ["GET", "/api/posts", [entry(1, false), entry(2, false)]],
        ["GET", "/api/posts/1", entry(1, false)],
        ["GET", "/api/posts/2", entry(2, false)],
      ];
      const edit = (id: number, changed: boolean): TimedCaptureRow[] => {
        const after = { ...entry(id, changed), title: "Edited" };
        return [
          [
            "PATCH",
            `/api/posts/${id}`,
            after,
            200,
            { title: "Edited", html: "<p>Edited body text.</p>" },
          ],
          ["GET", `/api/posts/${id}`, after],
        ];
      };
      const plan = (rows: TimedCaptureRow[]) =>
        stateOf([...initial, ...rows]).writes.find(
          (write) => write.tool === "patch_posts_by_id",
        );
      expect(plan([...edit(1, true), ...edit(2, true)])).toMatchObject({
        served: true,
      });
      expect(plan([...edit(1, false), ...edit(2, true)])).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
      expect(plan([...edit(1, true), ...edit(2, false)])).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
    },
  );
});

const planOf = (state: StateView, tool: string) => {
  const plan = state.writes.find((candidate) => candidate.tool === tool);
  if (plan === undefined) throw new Error(`No write plan for ${tool}`);
  return plan;
};

/** Each write tool's verdict: "served", else the reason it is not. */
const verdicts = (rows: readonly TimedCaptureRow[]) =>
  Object.fromEntries(
    stateOf(rows).writes.map((plan) => [
      plan.tool,
      plan.served ? "served" : plan.reason,
    ]),
  );

/** A create of the third book whose response is `response`, then the given later exchanges. */
const created = (
  response: JsonValue,
  ...later: TimedCaptureRow[]
): TimedCaptureRow[] => [
  ...BOOK_INIT_ROWS,
  ["POST", "/api/books", response, 201, { name: "Third Book" }],
  ...later,
];

const RENAMED_AT_3 = renamedBook(FIRST_BOOK, "Renamed Book", 3);
/** An update renaming the first book whose response is `response`, then the given later exchanges. */
const rename = (
  response: Book = RENAMED_AT_3,
  ...later: TimedCaptureRow[]
): TimedCaptureRow[] => [
  ...BOOK_INIT_ROWS,
  ["PATCH", "/api/books/1", response, 200, { name: "Renamed Book" }],
  ...later,
];

describe("served write plans", () => {
  it("serves the create, update and delete that later reads confirm, citing those reads", () => {
    const state = stateOf(BOOK_ROWS);
    expect(state.write_clock).toBe(BOOK_WRITE_CLOCK);
    expect(planOf(state, "post_books")).toEqual({
      tool: "post_books",
      effect: "create",
      target: "/api/books",
      served: true,
      reason: null,
      exemplar_ordinal: 3,
      observation: { ordinal: 3, pointer: "" },
      response: { ordinal: 3, shape: "entity", pointer: "" },
      body: {
        accepted: ["name"],
        fixed: [],
        required: ["name"],
        identity: null,
        kinds: [],
      },
      rules: [
        { field: "id", rule: "identity", generator: "sequence" },
        { field: "name", rule: "echo" },
        { field: "slug", rule: "slug", from: "name" },
        { field: "created_at", rule: "clock", format: ISO_SECONDS },
        { field: "updated_at", rule: "clock", format: ISO_SECONDS },
      ],
      collection: null,
      insert: { rule: "sorted", field: "id", direction: "ascending" },
      merge: null,
      // The final list follows the delete of book 3, so it shows nothing of the create.
      checked_record_ordinals: [4],
      contradicted_by: null,
    });
    // PATCH requires no member; the slug follows the sent name and the update stamps its clock.
    expect(planOf(state, "patch_books_by_id")).toMatchObject({
      effect: "update",
      served: true,
      exemplar_ordinal: 5,
      body: { accepted: ["name"], required: [] },
      rules: [
        { field: "name", rule: "echo" },
        { field: "slug", rule: "slug", from: "name" },
        { field: "updated_at", rule: "clock", format: ISO_SECONDS },
      ],
      checked_record_ordinals: [6, 9],
    });
    expect(planOf(state, "delete_books_by_id")).toMatchObject({
      effect: "delete",
      served: true,
      exemplar_ordinal: 7,
      response: { ordinal: 7, shape: "empty", pointer: null },
      checked_record_ordinals: [8, 9],
    });
    expect(planOf(state, "post_exports")).toMatchObject({
      effect: "none",
      target: null,
      served: false,
      reason: "no-state-target",
    });
  });

  it("starts the clock from the records a date can hold when one lies past its range", () => {
    const state = stateOf([
      ["GET", "/api/books", [FIRST_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      [
        "PATCH",
        "/api/books/1",
        RENAMED_AT_3,
        200,
        { name: "Renamed Book" },
        9_000_000_000_000_000,
      ],
    ]);
    // The second read ends at 18:00:01.005, so the clock starts at the next whole second.
    expect(state.write_clock).toBe("2026-10-17T18:00:02.000Z");
  });

  it("starts no clock on a record-order timeline, where no value is generated by a clock", () => {
    const state = environmentStateViewOf(
      rawCaptureEvidence(
        created(THIRD_BOOK, ["GET", "/api/books/3", THIRD_BOOK]),
        {
          mimeType: "application/json",
          timed: false,
        },
      ),
    );
    expect(state.timeline).toBe("record-order");
    expect(state.write_clock).toBeNull();
    const plan = planOf(state, "post_books");
    expect(plan).toMatchObject({ served: true, checked_record_ordinals: [4] });
    // Without start times the clock fields keep the recorded values as constants.
    expect(plan.rules.map(({ field }) => field)).toEqual([
      "id",
      "name",
      "slug",
    ]);
  });
});

describe("wider write coverage", () => {
  it("drops a field from an item view's required ones once a read shows the application leaves it out", () => {
    const state = stateOf(OMITTED_FIELD_ROWS);
    expect(planOf(state, "post_books")).toMatchObject({ served: true });
    expect(
      state.views.find((view) => view.tool === "get_books_by_id"),
    ).toMatchObject({
      shape: "item",
      fields: expect.arrayContaining(["detail"]),
    });
    expect(
      state.views.find((view) => view.tool === "get_books_by_id"),
    ).not.toMatchObject({
      required_fields: expect.arrayContaining(["detail"]),
    });
  });

  it("proves an item's identity past a read that asked for some fields only, leaving that read to replay", () => {
    expect(
      stateOf(PROJECTED_ROWS).views.find(
        (view) => view.tool === "get_books_by_id",
      ),
    ).toMatchObject({
      shape: "item",
      checked_record_ordinals: [1, 2],
      projected_record_ordinals: [3],
    });
  });

  it("leaves a list line that expands its books to replay, serving the create the plain list confirms", () => {
    const state = stateOf(EXPANDED_LIST_ROWS);
    expect(state.views.find((view) => view.tool === "get_books")).toMatchObject(
      {
        shape: "list",
        checked_record_ordinals: [0],
        projected_record_ordinals: [1],
        projected_query_keys: [{ name: "expand" }],
      },
    );
    expect(planOf(state, "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });

  it("leaves a list line that asks for some fields only to replay", () => {
    const view = stateOf([
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      [
        "GET",
        "/api/books?fields=id,name",
        [
          { id: 1, name: "First Book" },
          { id: 2, name: "Second Book" },
        ],
      ],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
    ]).views.find((candidate) => candidate.tool === "get_books");
    expect(view).toMatchObject({
      shape: "list",
      checked_record_ordinals: [0],
      projected_record_ordinals: [1],
      projected_query_keys: [{ name: "fields" }],
    });
  });

  it("tells a line that adds a parameter apart by the members its books show, not by the parameters it shares", () => {
    const view = stateOf([
      ["GET", "/api/books?sort=name&limit=1", [FIRST_BOOK]],
      ["GET", "/api/books?sort=name&q=first", [FIRST_BOOK]],
      [
        "GET",
        "/api/books?sort=name&with=stats&offset=1",
        [{ ...SECOND_BOOK, stats: { reads: 4 } }],
      ],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
    ]).views.find((candidate) => candidate.tool === "get_books");
    expect(view).toMatchObject({
      shape: "list",
      checked_record_ordinals: [0, 1],
      projected_record_ordinals: [2],
      projected_query_keys: [{ name: "with" }],
    });
  });

  it("confirms a delete by a missing book's read on a line that expands its shelf", () => {
    const state = stateOf([
      ...BOOK_INIT_ROWS,
      ["GET", "/api/books/1?expand=shelf", expandedBook(FIRST_BOOK)],
      ["DELETE", "/api/books/2", "", 204],
      ["GET", "/api/books/2?expand=shelf", BOOK_NOT_FOUND, 404],
    ]);
    expect(
      state.views.find((view) => view.tool === "get_books_by_id"),
    ).toMatchObject({
      projected_record_ordinals: [3],
      projected_query_keys: [{ name: "expand" }],
    });
    expect(planOf(state, "delete_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });

  it("serves creates whose number follows the largest held one in its digit groups", () => {
    expect(planOf(stateOf(ASSET_ROWS), "post_books")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "asset", rule: "sequence", scope: "collection" },
      ]),
    });
  });
});

describe("values the application assigns", () => {
  it("serves updates that renew a sent version and the ids of rewritten child rows", () => {
    expect(planOf(stateOf(VERSIONED_ROWS), "patch_books_by_id")).toMatchObject({
      served: true,
      body: { accepted: ["name", "version_id"], fixed: [] },
      rules: expect.arrayContaining([
        { field: "version_id", rule: "unique" },
        { field: "chapters", rule: "renewed", pointers: ["/*/id"] },
      ]),
    });
  });

  it("serves no update whose renewed values another recorded call kept, before or after the calls that renewed them", () => {
    const kept = renamedBook(
      versionedBook(FIRST_BOOK, 7, 8),
      "Kept Version",
      7,
    );
    const keeping: TimedCaptureRow[] = [
      ["PATCH", "/api/books/1", kept, 200, { name: "Kept Version" }],
      ["GET", "/api/books/1", kept],
    ];
    expect(
      planOf(stateOf([...VERSIONED_ROWS, ...keeping]), "patch_books_by_id"),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
    const first = renamedBook(
      versionedBook(FIRST_BOOK, 1, 2),
      "Kept Version",
      3,
    );
    const renamed = versionedBook(
      renamedBook(FIRST_BOOK, "Renamed Book", 5),
      5,
      6,
    );
    expect(
      planOf(
        stateOf([
          ...VERSIONED_ROWS.slice(0, 3),
          ["PATCH", "/api/books/1", first, 200, { name: "Kept Version" }],
          ["GET", "/api/books/1", first],
          [
            "PATCH",
            "/api/books/1",
            renamed,
            200,
            { name: "Renamed Book", version_id: numberedUuid(1) },
          ],
          ["GET", "/api/books/1", renamed],
        ]),
        "patch_books_by_id",
      ),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
  });

  it("serves creates that store a sent member under another name and embed it in a link", () => {
    expect(planOf(stateOf(HANDLE_ROWS), "post_books")).toMatchObject({
      served: true,
      body: { accepted: ["name", "handle"], fixed: [] },
      rules: expect.arrayContaining([
        { field: "code", rule: "copy", from: "/handle" },
        { field: "link", rule: "template", from: "code" },
      ]),
    });
  });
});

describe("write coverage limits", () => {
  const WHOLE_BOOK = ["slug", "created_at", "updated_at"];
  const itemView = (rows: readonly TimedCaptureRow[]) =>
    stateOf(rows).views.find((view) => view.tool === "get_books_by_id");

  it("notes no omission from a read that asked for some fields, nor from one of a book the state no longer holds", () => {
    const projected: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["PATCH", "/api/books/1", RENAMED_BOOK, 200, { name: "Renamed Book" }],
      ["GET", "/api/books/1?fields=id,name", { id: 1, name: "Renamed Book" }],
    ];
    const tombstone: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      ["GET", "/api/books/3", THIRD_BOOK],
      ["DELETE", "/api/books/3", "", 204],
      ["GET", "/api/books/3", { id: 3, deleted: true }],
    ];
    for (const rows of [projected, tombstone])
      expect(itemView(rows)).toMatchObject({
        required_fields: expect.arrayContaining(WHOLE_BOOK),
      });
    const partial = { id: 3, name: "Third Book" };
    const created: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["POST", "/api/books", partial, 201, { name: "Third Book" }],
      ["GET", "/api/books/3?fields=id,name", partial],
    ];
    expect(planOf(stateOf(created), "post_books")).toMatchObject({
      served: false,
    });
  });

  it("stops requiring a field in every view of the type once a read shows it left out", () => {
    const state = stateOf(DETAILED_LIST_ROWS);
    expect(planOf(state, "post_books")).toMatchObject({ served: true });
    const list = state.views.find((view) => view.tool === "get_books");
    expect(list).toMatchObject({ fields: expect.arrayContaining(["detail"]) });
    expect(list).not.toMatchObject({
      required_fields: expect.arrayContaining(["detail"]),
    });
  });

  it("leaves a read that asked for some fields only out of the gate, even where it would resynchronise a book", () => {
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["GET", "/api/books/2?fields=name", { name: "Second Book" }],
      [
        "PATCH",
        "/api/books/2",
        renamedBook(SECOND_BOOK, "Renamed", 5),
        200,
        { name: "Renamed" },
      ],
      // A redirected write leaves book 2 unknown.
      ["PATCH", "/api/books/2", "", 302, { name: "Renamed" }],
      ["GET", "/api/books/2?fields=slug", { slug: "renamed" }],
    ];
    expect(planOf(stateOf(rows), "patch_books_by_id")).toMatchObject({
      contradicted_by: null,
    });
  });

  it("learns no update's effect from a read-back that asked for some fields only", () => {
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["PATCH", "/api/books/1", "", 204, { name: "Renamed Book" }],
      ["GET", "/api/books/1?fields=id,name", { id: 1, name: "Renamed Book" }],
      ["GET", "/api/books/1", RENAMED_BOOK],
      ["GET", "/api/books", [RENAMED_BOOK, SECOND_BOOK]],
    ];
    expect(planOf(stateOf(rows), "patch_books_by_id")).toMatchObject({
      served: true,
      observation: { ordinal: 5 },
    });
  });

  it("confirms a delete from a read that asked for some fields and found no book", () => {
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["DELETE", "/api/books/2", "", 204],
      ["GET", "/api/books/2?fields=id,name", BOOK_NOT_FOUND, 404],
    ];
    expect(planOf(stateOf(rows), "delete_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
  });

  it("follows a sequence past its mask's width, as serving spells it", () => {
    const numbered = (id: number, asset: string): Book =>
      assetBook(book(id, `Book ${String(id)}`, bookClock(id + 2)), asset);
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [numbered(1, "99-97"), numbered(2, "99-98")]],
      ["GET", "/api/books/1", numbered(1, "99-97")],
      ["GET", "/api/books/2", numbered(2, "99-98")],
    ];
    for (const [id, asset] of [
      [3, "99-99"],
      [4, "100-00"],
      [5, "100-01"],
    ] as const)
      rows.push(
        [
          "POST",
          "/api/books",
          numbered(id, asset),
          201,
          { name: `Book ${String(id)}` },
        ],
        ["GET", `/api/books/${String(id)}`, numbered(id, asset)],
      );
    expect(planOf(stateOf(rows), "post_books")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "asset", rule: "sequence", scope: "collection" },
      ]),
    });
  });

  it("withholds creates whose later call spells its sequence otherwise than serving would", () => {
    const spelled = (asset: JsonValue): TimedCaptureRow[] => {
      const fourth = { ...book(4, "Fourth Book", bookClock(5)), asset };
      return [
        ...ASSET_ROWS.slice(0, 5),
        ["POST", "/api/books", fourth, 201, { name: "Fourth Book" }],
        ["GET", "/api/books/4", fourth],
      ];
    };
    for (const asset of ["00-04", 4])
      expect(planOf(stateOf(spelled(asset)), "post_books")).toMatchObject({
        served: false,
      });
    expect(planOf(stateOf(spelled("000-004")), "post_books")).toMatchObject({
      served: true,
    });
  });
});

describe("omissions shown by reads the gate ignores", () => {
  it("notes no omission from a read begun while the create still ran, nor from a page the collection outgrew", () => {
    const first = detailedBook(FIRST_BOOK);
    const second = detailedBook(SECOND_BOOK);
    const running: TimedCaptureRow[] = [
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      // The create runs from second 3 to 4.5, so the read at second 4 may show the book before its detail.
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }, 1500],
      ["GET", "/api/books/3", THIRD_BOOK],
    ];
    const outgrown: TimedCaptureRow[] = [
      ["GET", "/api/books?_start=0&_end=2", [second, first]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      // Serving answers the range from its recording once the collection outgrows it.
      ["GET", "/api/books?_start=0&_end=2", [THIRD_BOOK, second]],
    ];
    const requiresDetail = {
      required_fields: expect.arrayContaining(["detail"]),
    };
    const itemView = (rows: readonly TimedCaptureRow[]) =>
      stateOf(rows).views.find((view) => view.tool === "get_books_by_id");
    expect([running, outgrown].map(itemView)).toMatchObject([
      requiresDetail,
      requiresDetail,
    ]);
  });
});

describe("clock spellings per view", () => {
  it("serves a create that a list spelling clocks otherwise than item reads confirms", () => {
    const state = stateOf(OFFSET_LIST_ROWS);
    const offset = { ...ISO_SECONDS, zone: "+00:00" };
    expect(state.views.find((view) => view.tool === "get_books")).toMatchObject(
      {
        membership: "all",
        clock_formats: { created_at: offset, updated_at: offset },
      },
    );
    expect(
      state.views.find((view) => view.tool === "get_books_by_id"),
    ).not.toHaveProperty("clock_formats");
    expect(planOf(state, "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [4, 5],
    });
  });

  it("serves a create whose clock has a fraction where the list spelling was learned from whole seconds", () => {
    const third = book(3, "Third Book", "2026-10-17T18:00:03.250Z");
    const state = stateOf([
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK].map(offsetListed)],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", third, 201, { name: "Third Book" }],
      ["GET", "/api/books/3", third],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK, third].map(offsetListed)],
    ]);
    expect(planOf(state, "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [4, 5],
    });
  });

  it("learns no spelling for a field another recorded value spells as stored, at another instant", () => {
    const moved = {
      ...SECOND_BOOK,
      created_at: "2026-10-01T09:30:00Z",
      updated_at: "2026-10-01T09:30:00Z",
    };
    const state = stateOf([
      ["GET", "/api/books", [offsetListed(FIRST_BOOK), moved]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
    ]);
    const list = state.views.find((view) => view.tool === "get_books");
    expect(list).toMatchObject({ shape: "list" });
    expect(list).not.toHaveProperty("clock_formats");
  });

  it("learns no spelling for a field the view spells both ways", () => {
    const state = stateOf([
      ["GET", "/api/books", [FIRST_BOOK, offsetListed(SECOND_BOOK)]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
    ]);
    expect(
      state.views.find((view) => view.tool === "get_books"),
    ).not.toHaveProperty("clock_formats");
  });
});

describe("unserved write plans", () => {
  it("names a write to no state type and a tool with no successful call", () => {
    expect(
      verdicts([
        ...BOOK_INIT_ROWS,
        ["POST", "/api/session", { token: "t0" }, 200, { user: "ada" }],
        ["POST", "/api/books", { errors: ["name"] }, 422, { name: "" }],
        ["DELETE", "/api/books/9", BOOK_NOT_FOUND, 404],
      ]),
    ).toEqual({
      post_session: "no-state-target",
      post_books: "no-call",
      delete_books_by_id: "no-call",
    });
  });

  it("refuses a create whose request body cannot enter the state", () => {
    /** The create of the third book sending `sent`, or no body, then a read that shows it. */
    const sending = (...sent: [] | [JsonValue]): TimedCaptureRow[] => [
      ...BOOK_INIT_ROWS,
      ["POST", "/api/books", THIRD_BOOK, 201, ...sent],
      ["GET", "/api/books/3", THIRD_BOOK],
    ];
    const recorded = (mimeType: string, text: string) =>
      environmentStateViewOf(
        rawCaptureEvidence(sending(text), { mimeType, timed: true }),
      );
    for (const state of [
      stateOf(sending()),
      stateOf(sending([{ name: "Third Book" }])),
      recorded("application/x-www-form-urlencoded", "name=Third+Book"),
      recorded(
        "application/json",
        '{"name":"Third Book","copies":12345678901234567890}',
      ),
    ])
      expect(planOf(state, "post_books")).toMatchObject({
        served: false,
        reason: "body-unusable",
        exemplar_ordinal: null,
      });
  });

  it("reports no observation when neither the response nor a read before the next write shows the entity", () => {
    expect(verdicts(created({ ok: true }))).toEqual({
      post_books: "no-observation",
    });
    // The read of the created book comes after the next write; the update names a book never held.
    expect(
      verdicts(
        created(
          "",
          [
            "PATCH",
            "/api/books/7",
            { id: 7, name: "Seventh" },
            200,
            { name: "Seventh" },
          ],
          ["GET", "/api/books/3", THIRD_BOOK],
        ),
      ),
    ).toEqual({
      post_books: "no-observation",
      patch_books_by_id: "no-observation",
    });
  });

  it("reports an update that changed an unsent field no clock, increment or slug explains", () => {
    const changed = { ...RENAMED_AT_3, slug: "first-book-v2" };
    expect(verdicts(rename(changed, ["GET", "/api/books/1", changed]))).toEqual(
      {
        patch_books_by_id: "unexplained-change",
      },
    );
  });

  it("names the first later read that contradicts a write", () => {
    const other = renamedBook(RENAMED_AT_3, "Other Name", 3);
    const plan = planOf(
      stateOf(
        rename(
          RENAMED_AT_3,
          ["GET", "/api/books/1", other],
          ["GET", "/api/books/1", other],
        ),
      ),
      "patch_books_by_id",
    );
    expect(plan).toMatchObject({
      served: false,
      reason: "contradicted",
      contradicted_by: 4,
      checked_record_ordinals: [],
    });
  });

  it("blames a related write when a book no write touched changed after it", () => {
    const plan = planOf(
      stateOf(
        created(
          THIRD_BOOK,
          ["GET", "/api/books/3", THIRD_BOOK],
          [
            "GET",
            "/api/books/2",
            renamedBook(SECOND_BOOK, "Second Edition", 5),
          ],
        ),
      ),
      "post_books",
    );
    // The create's own read confirmed it, but the changed sibling outweighs that.
    expect(plan).toMatchObject({
      served: false,
      reason: "side-effect",
      checked_record_ordinals: [4],
      contradicted_by: null,
    });
  });

  it("leaves a write that no later read checks unconfirmed", () => {
    expect(planOf(stateOf(created(THIRD_BOOK)), "post_books")).toMatchObject({
      served: false,
      reason: "unconfirmed",
      exemplar_ordinal: 3,
      checked_record_ordinals: [],
    });
  });
});

describe("delete confirmation", () => {
  it("confirms a delete by a later 404, 400 or JSON null item read", () => {
    const absences: [body: JsonValue, status: number][] = [
      [BOOK_NOT_FOUND, 404],
      [{ detail: "Invalid book id." }, 400],
      [null, 200],
    ];
    for (const [body, status] of absences)
      expect(
        planOf(
          stateOf([
            ...BOOK_INIT_ROWS,
            ["DELETE", "/api/books/2", "", 204],
            ["GET", "/api/books/2", body, status],
          ]),
          "delete_books_by_id",
        ),
      ).toMatchObject({ served: true, checked_record_ordinals: [4] });
  });
  it("withholds a delete whose recorded answer shows fields no initial entity holds", () => {
    const answered = (previous: JsonValue) =>
      planOf(
        stateOf([
          ...BOOK_INIT_ROWS,
          ["DELETE", "/api/books/2", { deleted: true, previous }, 200],
          ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
        ]),
        "delete_books_by_id",
      );
    // An edit view of the book: the read views never showed its draft field.
    expect(answered({ ...SECOND_BOOK, draft: false })).toMatchObject({
      served: false,
      reason: "incomplete-entities",
      checked_record_ordinals: [4],
    });
    expect(answered(SECOND_BOOK)).toMatchObject({
      served: true,
      response: { shape: "entity", pointer: "/previous" },
    });
  });
});

describe("update answers", () => {
  it("serves an update whose recorded answer shows a field only the update writes", () => {
    const summary = (name: string) => [
      { id: 1, name },
      { id: 2, name: "B" },
    ];
    // No read showed a note before the update sent one, which its answer echoes.
    const plan = planOf(
      stateOf([
        ["GET", "/api/books", summary("A")],
        ["GET", "/api/books/1", { id: 1, name: "A" }],
        ["GET", "/api/books/2", { id: 2, name: "B" }],
        [
          "PATCH",
          "/api/books/1",
          { id: 1, name: "Z", note: "n" },
          200,
          { name: "Z", note: "n" },
        ],
        ["GET", "/api/books", summary("Z")],
      ]),
      "patch_books_by_id",
    );
    expect(plan).toMatchObject({
      served: true,
      reason: null,
      response: { shape: "entity", pointer: "" },
      checked_record_ordinals: [4],
    });
  });
});

describe("insert rules", () => {
  it("learns where a create inserts from the recorded collection order", () => {
    // Listed by name, while neither identities nor clocks are in order.
    const shelf = [
      book(3, "Alpha", "2026-10-01T10:00:00Z"),
      book(1, "Delta", "2026-10-01T09:00:00Z"),
      book(2, "Zulu", "2026-10-01T11:00:00Z"),
    ];
    const mike = book(4, "Mike", bookClock(6));
    const state = stateOf([
      ["GET", "/api/books", shelf],
      ...shelf.map((entry): TimedCaptureRow => [
        "GET",
        `/api/books/${String(entry.id)}`,
        entry,
      ]),
      ["GET", "/api/books", shelf],
      ["GET", "/api/books", shelf],
      ["POST", "/api/books", mike, 201, { name: "Mike" }],
      ["GET", "/api/books", [shelf[0]!, shelf[1]!, mike, shelf[2]!]],
    ]);
    expect(planOf(state, "post_books")).toMatchObject({
      served: true,
      insert: { rule: "sorted", field: "name", direction: "ascending" },
      checked_record_ordinals: [7],
    });
  });

  it("takes the position a later list shows when the recorded order admits several", () => {
    const zed = book(3, "Zed", bookClock(3));
    const plan = planOf(
      stateOf(
        created(zed, ["GET", "/api/books", [zed, FIRST_BOOK, SECOND_BOOK]]),
      ),
      "post_books",
    );
    expect(plan).toMatchObject({
      served: true,
      insert: { rule: "first" },
      checked_record_ordinals: [4],
    });
  });
});

describe("unmodelled writes", () => {
  const shelved = (entry: Book, archived = false): Book => ({
    ...entry,
    archived,
  });
  /** The rename, an archive the gate does not model when `archive` is set, then a read of both changes. */
  const archivedAfterRename = (archive: boolean) =>
    stateOf([
      ["GET", "/api/books", [shelved(FIRST_BOOK), shelved(SECOND_BOOK)]],
      ["GET", "/api/books/1", shelved(FIRST_BOOK)],
      ["GET", "/api/books/2", shelved(SECOND_BOOK)],
      [
        "PATCH",
        "/api/books/1",
        shelved(RENAMED_AT_3),
        200,
        { name: "Renamed Book" },
      ],
      ...(archive
        ? [
            [
              "POST",
              "/api/books/1/archive",
              { archived: true },
              200,
              {},
            ] as TimedCaptureRow,
          ]
        : []),
      ["GET", "/api/books/1", shelved(RENAMED_AT_3, true)],
    ]);

  it("confirms an update on the members it sent when an unmodelled write also changed the entity", () => {
    const state = archivedAfterRename(true);
    expect(planOf(state, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
      contradicted_by: null,
    });
    expect(planOf(state, "post_books_archive_by_id")).toMatchObject({
      effect: "none",
      reason: "no-state-target",
    });
    // With no unmodelled write the same read contradicts the update.
    expect(
      planOf(archivedAfterRename(false), "patch_books_by_id"),
    ).toMatchObject({
      reason: "contradicted",
      contradicted_by: 4,
    });
  });

  it("does not blame a modelled write for a check that fails after an unmodelled write", () => {
    const changedSibling = renamedBook(SECOND_BOOK, "Second Edition", 4);
    const reindex: TimedCaptureRow = [
      "POST",
      "/api/jobs/reindex",
      { queued: true },
      202,
      {},
    ];
    const list: TimedCaptureRow = [
      "GET",
      "/api/books",
      [RENAMED_AT_3, changedSibling],
    ];
    expect(
      planOf(stateOf(rename(RENAMED_AT_3, list)), "patch_books_by_id"),
    ).toMatchObject({
      reason: "contradicted",
      contradicted_by: 4,
    });
    expect(
      planOf(stateOf(rename(RENAMED_AT_3, reindex, list)), "patch_books_by_id"),
    ).toMatchObject({ reason: "unconfirmed", contradicted_by: null });
    // A create wrote every field, so after an unmodelled write a differing read checks none of them.
    const reslugged = { ...THIRD_BOOK, slug: "third-book-1" };
    const read: TimedCaptureRow = ["GET", "/api/books/3", reslugged];
    expect(
      planOf(stateOf(created(THIRD_BOOK, read)), "post_books"),
    ).toMatchObject({
      reason: "contradicted",
      contradicted_by: 4,
    });
    expect(
      planOf(stateOf(created(THIRD_BOOK, reindex, read)), "post_books"),
    ).toMatchObject({
      reason: "unconfirmed",
      contradicted_by: null,
    });
  });
});

describe("observation from a later read", () => {
  it("observes a created entity in the first later item read when the response names only its identity", () => {
    const later: TimedCaptureRow[] = [
      ["GET", "/api/books/3", THIRD_BOOK],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK, THIRD_BOOK]],
    ];
    const bare = planOf(stateOf(created({ id: 3 }, ...later)), "post_books");
    // The read that showed the entity does not check the create; the later list does.
    expect(bare).toMatchObject({
      served: true,
      exemplar_ordinal: 3,
      observation: { ordinal: 4, pointer: "" },
      response: { ordinal: 3, shape: "entity", pointer: "" },
      checked_record_ordinals: [5],
    });
    const named = planOf(
      stateOf(created({ created_id: 3 }, ...later)),
      "post_books",
    );
    expect(named).toMatchObject({
      served: true,
      observation: { ordinal: 4, pointer: "" },
      response: { ordinal: 3, shape: "identity", pointer: "/created_id" },
      checked_record_ordinals: [5],
    });
  });
});

describe("list lines", () => {
  it("confirms the same create when a learned filter repeats identical decoded query values", () => {
    for (const query of [
      "shelf=a&shelf=a",
      "shelf=%61&shelf=a",
      "shelf=a&include=all&shelf=a",
    ]) {
      const rows = QUERY_ROWS.map((row, index): TimedCaptureRow => {
        if (index !== QUERY_ROWS.length - 1) return row;
        const [method, , ...response] = row;
        return [method, `/api/books?${query}`, ...response];
      });
      expect(planOf(stateOf(rows), "post_books"), query).toMatchObject({
        served: true,
        contradicted_by: null,
      });
    }
  });

  it("lists every entity on a line that lists its whole collection, though another line of the tool is filtered", () => {
    const state = stateOf(LIST_LINE_ROWS);
    expect(state.views.find((view) => view.tool === "get_books")).toMatchObject(
      {
        shape: "list",
        pointer: "/content",
        membership: "recorded",
        all_record_ordinals: [0],
        counters: ["numberOfElements", "totalElements"],
        checked_record_ordinals: [0, 1],
      },
    );
    // The whole list after the create shows the created book, which confirms it.
    expect(planOf(state, "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [5, 6],
    });
  });

  it("confirms no create by a whole list taken after a read showed its entity gone", () => {
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      // A redirected delete is not modelled; the read after it shows the book gone.
      ["DELETE", "/api/books/3", "", 302],
      ["GET", "/api/books/3", BOOK_NOT_FOUND, 404],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
    ];
    expect(planOf(stateOf(rows), "post_books")).toMatchObject({
      served: false,
      reason: "unconfirmed",
    });
  });

  it("confirms no create by a whole list after an item read showed nothing of its entity", () => {
    const rows: TimedCaptureRow[] = [
      ...BOOK_INIT_ROWS,
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      // An unmodelled write elsewhere may explain the next read, which the state then takes.
      ["POST", "/api/exports", { queued: true }, 202, { format: "csv" }],
      ["GET", "/api/books/3", null],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
    ];
    expect(planOf(stateOf(rows), "post_books")).toMatchObject({
      served: false,
      checked_record_ordinals: [],
    });
  });

  it("names no line when every line lists its whole collection, or none does", () => {
    const listOf = (rows: readonly TimedCaptureRow[]) =>
      stateOf(rows).views.find((view) => view.tool === "get_books");
    const whole = listOf(LIST_LINE_ROWS.filter((_, index) => index !== 1));
    expect(whole).toMatchObject({ membership: "all" });
    expect(whole).not.toHaveProperty("all_record_ordinals");
    expect(listOf(LIST_LINE_ROWS.slice(1))).not.toHaveProperty(
      "all_record_ordinals",
    );
  });
});

describe("list queries", () => {
  it("learns a filter, a search, a sort and an inert flag from the lines the whole collection does not explain", () => {
    const state = stateOf(QUERY_ROWS);
    expect(state.views.find((view) => view.tool === "get_books")).toMatchObject(
      {
        shape: "list",
        membership: "recorded",
        all_record_ordinals: [0],
        query: {
          parameters: {
            shelf: { role: "filter", field: "shelf" },
            q: { role: "search", fields: ["name", "slug"] },
            sort: { role: "sort" },
            include: { role: "inert", values: ["all"] },
          },
          record_ordinals: [1, 2, 3, 4],
          totals: [],
        },
        checked_record_ordinals: [0, 1, 2, 3, 4],
      },
    );
    // The shelf filter after the create lists the created book, which confirms it.
    expect(planOf(state, "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [8],
    });
  });
});

describe("list reads with query values no line recorded", () => {
  it("serves no create that a filtered read on a new value omits, as serving would list it", () => {
    const third = { ...book(3, "Third Book", bookClock(7)), shelf: "b" };
    const rows: TimedCaptureRow[] = [
      ...QUERY_ROWS.slice(0, 7),
      ["POST", "/api/books", third, 201, { name: "Third Book", shelf: "b" }],
      ["GET", "/api/books/3", third],
      // Serving evaluates `shelf=b` over the state, which lists the created book; the recording does not.
      ["GET", "/api/books?shelf=b", [QUERY_ROWS[6]![2] as Book]],
    ];
    // The item read confirmed the book, so the failing filtered read blames the related create as a side effect.
    expect(planOf(stateOf(rows), "post_books")).toMatchObject({
      served: false,
      reason: "side-effect",
    });
  });

  it("checks what the state answers on a line the read did not name, not the envelope that line's own call recorded", () => {
    const first = { ...FIRST_BOOK, shelf: "a" };
    const second = { ...SECOND_BOOK, shelf: "b" };
    const third = { ...book(3, "Third Book", bookClock(4)), shelf: "c" };
    // Each page links the next under its own query.
    const page = (query: string, books: readonly Book[]) => ({
      data: [...books],
      next: `/api/books?${query}offset=20`,
    });
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", page("", [first, second])],
      ["GET", "/api/books?shelf=a", page("shelf=a&", [first])],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      ["POST", "/api/books", third, 201, { name: "Third Book", shelf: "c" }],
      // Serving lists `shelf=c` from the state in the `shelf=a` line's envelope, whose link names shelf a.
      ["GET", "/api/books?shelf=c", page("shelf=c&", [third])],
    ];
    expect(planOf(stateOf(rows), "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });

  it("checks a recorded-member line with the total it recorded, as serving answers it", () => {
    const envelope = (books: readonly Book[]) => ({
      items: [...books],
      total: 3,
    });
    const renamed = renamedBook(SECOND_BOOK, "Renamed Second", 6);
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", envelope([FIRST_BOOK, SECOND_BOOK, THIRD_BOOK])],
      ["GET", "/api/books?limit=1", envelope([FIRST_BOOK])],
      // A cursor no role explains keeps its recorded member and total.
      ["GET", "/api/books?cursor=abc", envelope([FIRST_BOOK])],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["GET", "/api/books/3", THIRD_BOOK],
      ["PATCH", "/api/books/2", renamed, 200, { name: "Renamed Second" }],
      ["GET", "/api/books/2", renamed],
      ["GET", "/api/books?cursor=abc", envelope([FIRST_BOOK])],
      // Failing that read would taint book 1 and leave its confirmed delete unserved.
      ["DELETE", "/api/books/1", "", 204],
      ["GET", "/api/books/1", BOOK_NOT_FOUND, 404],
    ];
    const state = stateOf(rows);
    expect(planOf(state, "patch_books_by_id")).toMatchObject({ served: true });
    expect(planOf(state, "delete_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [10],
    });
  });
});

describe("list reads on a line they did not name", () => {
  const first = { ...FIRST_BOOK, shelf: "a" };
  const second = { ...SECOND_BOOK, shelf: "b" };

  it("checks a read with no query on a query line by that line's recorded members, as serving lists them", () => {
    const third = { ...book(3, "Third Book", bookClock(3)), shelf: "c" };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books?shelf=a", [first]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      ["POST", "/api/books", third, 201, { name: "Third Book", shelf: "c" }],
      // Serving answers this call on the `shelf=a` line with its recorded book, not the created one.
      ["GET", "/api/books", [first, second, third]],
    ];
    expect(planOf(stateOf(rows), "post_books")).toMatchObject({
      served: false,
      checked_record_ordinals: [],
    });
  });

  it("confirms no delete by a filtered read on another value, whose answer never listed the deleted book", () => {
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books?shelf=a", [first]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      ["DELETE", "/api/books/1", "", 204],
      ["GET", "/api/books?shelf=b", [second]],
    ];
    expect(planOf(stateOf(rows), "delete_books_by_id")).toMatchObject({
      served: false,
      reason: "unconfirmed",
      checked_record_ordinals: [],
    });
  });

  it("lets a sorted read whose values tie fix a create's position, as its order shows where the create put it", () => {
    const shelved = (id: number, name: string, shelf: string, at: number) => ({
      ...book(id, name, bookClock(at)),
      shelf,
    });
    const beta = shelved(1, "Beta", "a", 0);
    const mike = shelved(2, "Mike", "b", 1);
    const zulu = shelved(3, "Zulu", "a", 2);
    const alpha = shelved(4, "Alpha", "a", 6);
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [beta, mike, zulu]],
      ["GET", "/api/books?shelf=a", [beta, zulu]],
      ["GET", "/api/books?sort=-id", [zulu, mike, beta]],
      ["GET", "/api/books/1", beta],
      ["GET", "/api/books/2", mike],
      ["GET", "/api/books/3", zulu],
      ["POST", "/api/books", alpha, 201, { name: "Alpha", shelf: "a" }],
      // Every match shares the shelf, so the order is the state's: the create went last.
      ["GET", "/api/books?shelf=a&sort=shelf", [beta, zulu, alpha]],
      // A name order would put it first, which the read before contradicts.
      ["GET", "/api/books", [alpha, beta, mike, zulu]],
    ];
    expect(planOf(stateOf(rows), "post_books")).toMatchObject({
      served: false,
      contradicted_by: 8,
    });
  });

  it("leaves a create's position open after a sorted read that ties other books but not the created one", () => {
    const shelved = (id: number, name: string, shelf: string, at: number) => ({
      ...book(id, name, bookClock(at)),
      category: "x",
      shelf,
    });
    const beta = shelved(1, "Beta", "a", 0);
    const mike = { ...shelved(2, "Mike", "b", 1), category: "y" };
    const zulu = shelved(3, "Zulu", "a", 2);
    const alpha = shelved(4, "Alpha", "c", 6);
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [beta, mike, zulu]],
      ["GET", "/api/books?category=x", [beta, zulu]],
      ["GET", "/api/books?sort=-id", [zulu, mike, beta]],
      ["GET", "/api/books/1", beta],
      ["GET", "/api/books/2", mike],
      ["GET", "/api/books/3", zulu],
      [
        "POST",
        "/api/books",
        alpha,
        201,
        { name: "Alpha", category: "x", shelf: "c" },
      ],
      // Beta and Zulu tie on shelf a, but the created book's shelf c sorts it last wherever it was put.
      ["GET", "/api/books?category=x&sort=shelf", [beta, zulu, alpha]],
      ["GET", "/api/books", [alpha, beta, mike, zulu]],
    ];
    expect(planOf(stateOf(rows), "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [7, 8],
      insert: { rule: "sorted", field: "name", direction: "ascending" },
    });
  });

  it("leaves a create's position open after a sorted read, for a later whole list to settle", () => {
    const shelved = (id: number, name: string, shelf: string, at: number) => ({
      ...book(id, name, bookClock(at)),
      shelf,
    });
    const beta = shelved(1, "Beta", "a", 0);
    const mike = shelved(2, "Mike", "b", 1);
    const zulu = shelved(3, "Zulu", "a", 2);
    const alpha = shelved(4, "Alpha", "a", 6);
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [beta, mike, zulu]],
      ["GET", "/api/books?shelf=a", [beta, zulu]],
      ["GET", "/api/books?sort=-id", [zulu, mike, beta]],
      ["GET", "/api/books/1", beta],
      ["GET", "/api/books/2", mike],
      ["GET", "/api/books/3", zulu],
      ["POST", "/api/books", alpha, 201, { name: "Alpha", shelf: "a" }],
      // The sorted shelf passes wherever the create placed its book; the whole list orders by name.
      ["GET", "/api/books?shelf=a&sort=-id", [alpha, zulu, beta]],
      ["GET", "/api/books", [alpha, beta, mike, zulu]],
    ];
    expect(planOf(stateOf(rows), "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [7, 8],
      insert: { rule: "sorted", field: "name", direction: "ascending" },
    });
  });
});

describe("what a list query read shows of writes", () => {
  const shelved = (id: number, name: string, shelf: string, at: number) => ({
    ...book(id, name, bookClock(at)),
    shelf,
  });
  const beta = shelved(1, "Beta", "a", 0);
  const mike = shelved(2, "Mike", "b", 1);
  const zulu = shelved(3, "Zulu", "a", 2);
  const INIT: TimedCaptureRow[] = [
    ["GET", "/api/books", [beta, mike, zulu]],
    ["GET", "/api/books?shelf=a", [beta, zulu]],
    ["GET", "/api/books/1", beta],
    ["GET", "/api/books/2", mike],
    ["GET", "/api/books/3", zulu],
  ];

  it("blames a write that moved a book off a filter whose failed read still lists it", () => {
    const moved = { ...beta, shelf: "b", updated_at: bookClock(5) };
    const renamed = renamedBook(zulu, "Zulu Two", 7);
    const rows: TimedCaptureRow[] = [
      ...INIT,
      ["PATCH", "/api/books/1", moved, 200, { shelf: "b" }],
      ["PUT", "/api/books/3", renamed, 200, { name: "Zulu Two", shelf: "a" }],
      // Serving lists Zulu alone on shelf a; the recording still lists the moved book there.
      ["GET", "/api/books?shelf=a", [beta, renamed]],
      ["GET", "/api/books/1", moved],
    ];
    const state = stateOf(rows);
    expect(planOf(state, "patch_books_by_id")).toMatchObject({
      served: false,
      contradicted_by: 7,
    });
    expect(planOf(state, "put_books_by_id")).toMatchObject({
      served: false,
      contradicted_by: 7,
    });
  });

  it("leaves a create's position open after a filter that lists only its book, for a later whole list to settle", () => {
    const alpha = shelved(4, "Alpha", "c", 5);
    const rows: TimedCaptureRow[] = [
      ...INIT,
      ["POST", "/api/books", alpha, 201, { name: "Alpha", shelf: "c" }],
      // A lone match shows nothing of where the create put it among the other books.
      ["GET", "/api/books?shelf=c", [alpha]],
      ["GET", "/api/books", [alpha, beta, mike, zulu]],
    ];
    expect(planOf(stateOf(rows), "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [6, 7],
      insert: { rule: "sorted", field: "name", direction: "ascending" },
    });
  });
});

describe("calls the capture shows reading only", () => {
  const LOOKUP: TimedCaptureRow = [
    "POST",
    "/api/books/ids",
    [FIRST_BOOK, SECOND_BOOK],
    200,
    { ids: [1, 2] },
  ];

  it("replays a lookup POST and plans no write for it", () => {
    const state = stateOf([...BOOK_INIT_ROWS, LOOKUP]);
    expect(state.writes.map((plan) => plan.tool)).not.toContain(
      "post_books_ids",
    );
    expect(state.views).toContainEqual({
      tool: "post_books_ids",
      shape: "recorded",
      reason: "query-body",
    });
  });

  it("keeps a read after a lookup POST among the initial recordings", () => {
    // The lookup changes nothing, so the second book's only read, after it, still seeds the state.
    const state = stateOf([
      ["GET", "/api/books/1", FIRST_BOOK],
      LOOKUP,
      ["GET", "/api/books/2", SECOND_BOOK],
    ]);
    expect(state.entities.map((entity) => entity.id).sort()).toEqual([
      "1",
      "2",
    ]);
  });
});

describe("types whose reads disagree across a write", () => {
  const recipe = (id: number, name: string, views: number) => ({
    id,
    name,
    views,
  });

  it("plans a type its reads disagree on across an unrelated write from the reads before it, and serves its create", () => {
    const state = stateOf([
      ["GET", "/api/recipes", [recipe(1, "Soup", 1), recipe(2, "Stew", 4)]],
      ["GET", "/api/recipes/1", recipe(1, "Soup", 1)],
      // Logging a view bumps the counter, so the reads after it disagree with those before.
      ["POST", "/api/view-log", { ok: true }, 200, { recipe: 1 }],
      ["GET", "/api/recipes/1", recipe(1, "Soup", 2)],
      ["POST", "/api/recipes", recipe(3, "Broth", 0), 201, { name: "Broth" }],
      ["GET", "/api/recipes/3", recipe(3, "Broth", 0)],
    ]);
    expect(state.types).toMatchObject([
      { collection_template: "/api/recipes", init_before_ordinal: 2 },
    ]);
    expect(planOf(state, "post_recipes")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });

  it("ends a type's state at the earlier of a write its reads disagree across and a create that made one of its entities", () => {
    const rows = (disagreeFirst: boolean): TimedCaptureRow[] => {
      const disagreement: TimedCaptureRow[] = [
        ["POST", "/api/view-log", { ok: true }, 200, { recipe: 1 }],
        ["GET", "/api/recipes/1", recipe(1, "Soup", 2)],
      ];
      const creation: TimedCaptureRow[] = [
        ["POST", "/api/imports", { id: "rcp-0042" }, 201, { name: "Broth" }],
        ["GET", "/api/recipes", [recipe(1, "Soup", 1), { id: "rcp-0042" }]],
      ];
      return [
        ["GET", "/api/recipes", [recipe(1, "Soup", 1)]],
        ["GET", "/api/recipes/1", recipe(1, "Soup", 1)],
        ...(disagreeFirst
          ? [...disagreement, ...creation]
          : [...creation, ...disagreement]),
      ];
    };
    expect(stateOf(rows(true)).types).toMatchObject([
      { init_before_ordinal: 2 },
    ]);
    expect(stateOf(rows(false)).types).toMatchObject([
      { init_before_ordinal: 2 },
    ]);
  });
});

const note = (id: number, title: string) => ({ id, title });
const A = note(1001, "Alpha");
const B = note(1002, "Beta");
const C = note(1003, "Gamma");
const notesOf = (state: StateView) =>
  state.entities
    .filter((entity) => entity.type === "/api/notes")
    .map((entity) => entity.id);
/** Two notes read, the given exchanges, then a POST elsewhere whose returned id the notes are read under. */
const published = (before: readonly TimedCaptureRow[]): TimedCaptureRow[] => [
  ["GET", "/api/notes", [A, B]],
  ["GET", "/api/notes/1001", A],
  ["GET", "/api/notes/1002", B],
  ...before,
  ["POST", "/api/drafts/publish", { id: 1003 }, 201, { title: "Gamma" }],
  ["GET", "/api/notes/1003", C],
  ["GET", "/api/notes", [A, B, C]],
];

describe("creates read under another path", () => {
  it("plans a POST to another path as a create into the type its returned id is first read under", () => {
    const state = stateOf(published([]));
    expect(planOf(state, "post_drafts_publish")).toMatchObject({
      effect: "create",
      target: "/api/notes",
      collection: "/api/notes",
    });
    expect(notesOf(state)).toEqual(["1001", "1002"]);
  });

  it("ends a type's initial reads at a POST elsewhere that made one of its entities", () => {
    const state = stateOf([
      ["GET", "/api/notes", [A, B]],
      ["POST", "/api/imports", { id: 1003 }, 201, { title: "Gamma" }],
      ["GET", "/api/notes", [A, B, C]],
    ]);
    expect(notesOf(state)).toEqual(["1001", "1002"]);
    expect(
      state.types.find((type) => type.collection_template === "/api/notes"),
    ).toMatchObject({ init_before_ordinal: 1 });
  });

  it("links no create whose returned id a read showed before it", () => {
    const shownBefore = published([
      [
        "PATCH",
        "/api/notes/1001",
        note(1001, "Alpha 2"),
        200,
        { title: "Alpha 2" },
      ],
      ["GET", "/api/notes/1003", C],
    ]);
    expect(planOf(stateOf(shownBefore), "post_drafts_publish")).toMatchObject({
      effect: "none",
      reason: "no-state-target",
    });
    expect(planOf(stateOf(published([])), "post_drafts_publish")).toMatchObject(
      { effect: "create" },
    );
  });

  /** A create linked under project 11, then a call for project 12, whose note a later item read and delete show. */
  const otherProject = (): TimedCaptureRow[] => {
    const D = note(1004, "Delta");
    return [
      ["GET", "/api/projects/11/notes", [A, B]],
      ["GET", "/api/projects/11/notes/1001", A],
      ["GET", "/api/projects/11/notes/1002", B],
      [
        "POST",
        "/api/projects/11/publish",
        { id: 1003 },
        201,
        { title: "Gamma" },
      ],
      ["GET", "/api/projects/11/notes/1003", C],
      ["GET", "/api/projects/11/notes", [A, B, C]],
      ["POST", "/api/projects/12/publish", D, 201, { title: "Delta" }],
      ["GET", "/api/projects/12/notes/1004", D],
      ["GET", "/api/projects/11/notes", [A, B, C]],
      ["DELETE", "/api/projects/12/notes/1004", "", 204],
      ["GET", "/api/projects/12/notes/1004", { error: "Not found" }, 404],
    ];
  };

  it("puts no linked create's call that sends other path arguments into the linked collection", () => {
    // Project 12's note never reaches project 11, so the later read of project 11 confirms the create.
    expect(
      planOf(stateOf(otherProject()), "post_projects_publish_by_id"),
    ).toMatchObject({
      served: true,
      collection: "/api/projects/11/notes",
      checked_record_ordinals: [5],
      contradicted_by: null,
    });
  });

  it("takes the entity such a call made when a read first shows it", () => {
    expect(
      planOf(stateOf(otherProject()), "delete_projects_notes_by_id_id_2"),
    ).toMatchObject({ served: true, checked_record_ordinals: [10] });
  });

  it("links a create whose response names a short id under an identity member", () => {
    const [one, two, three] = [
      note(1, "Alpha"),
      note(2, "Beta"),
      note(3, "Gamma"),
    ];
    const rows = (response: JsonValue): TimedCaptureRow[] => [
      ["GET", "/api/notes", [one, two]],
      ["GET", "/api/notes/1", one],
      ["GET", "/api/notes/2", two],
      ["POST", "/api/drafts/publish", response, 201, { title: "Gamma" }],
      ["GET", "/api/notes/3", three],
      ["GET", "/api/notes", [one, two, three]],
    ];
    expect(
      planOf(stateOf(rows({ id: 3 })), "post_drafts_publish"),
    ).toMatchObject({ effect: "create", target: "/api/notes", served: true });
    // A bare or unnamed short scalar may count rather than name, so it links nothing.
    for (const response of [3, { created: 3 }])
      expect(
        planOf(stateOf(rows(response)), "post_drafts_publish"),
      ).toMatchObject({ effect: "none", reason: "no-state-target" });
  });

  it("links a short id to no type that no read showed before the call", () => {
    // Another type's id 1 may be the one the call returned, so the notes keep their initial reads.
    const [one, two] = [note(1, "Alpha"), note(2, "Beta")];
    const state = stateOf([
      ["POST", "/api/imports", { id: 1 }, 201, { source: "csv" }],
      ["GET", "/api/notes/1", one],
      ["GET", "/api/notes", [one, two]],
    ]);
    expect(planOf(state, "post_imports")).toMatchObject({
      effect: "none",
      reason: "no-state-target",
    });
    expect(notesOf(state)).toEqual(["1", "2"]);
  });

  it("links no create whose returned id the initial state holds", () => {
    const held = stateOf([
      ["GET", "/api/notes", [A, B, C]],
      ["GET", "/api/notes/1001", A],
      ["POST", "/api/drafts/publish", { id: 1003 }, 201, { title: "Gamma" }],
      ["GET", "/api/notes/1003", C],
    ]);
    expect(planOf(held, "post_drafts_publish")).toMatchObject({
      effect: "none",
      reason: "no-state-target",
    });
    expect(notesOf(held)).toEqual(["1001", "1002", "1003"]);
    expect(planOf(stateOf(published([])), "post_drafts_publish")).toMatchObject(
      { effect: "create" },
    );
  });
});

describe("creates a later write may explain", () => {
  it("links no create past a later write, which may have made what the read shows", () => {
    const drafted = (publish: boolean): TimedCaptureRow[] => [
      ["GET", "/api/notes", [A, B]],
      ["GET", "/api/notes/1001", A],
      ["GET", "/api/notes/1002", B],
      ["POST", "/api/drafts", C, 201, { title: "Gamma" }],
      ...(publish
        ? ([
            [
              "POST",
              "/api/drafts/1003/publish",
              { id: 1003, status: "published" },
              201,
            ],
          ] as TimedCaptureRow[])
        : []),
      ["GET", "/api/notes/1003", C],
      ["GET", "/api/notes", [A, B, C]],
    ];
    const state = stateOf(drafted(true));
    // The publish call made the note, so the draft's POST creates none.
    expect(planOf(state, "post_drafts")).toMatchObject({
      effect: "none",
      reason: "no-state-target",
    });
    expect(
      state.writes.find((plan) => plan.tool !== "post_drafts"),
    ).toMatchObject({ effect: "create", target: "/api/notes" });
    expect(planOf(stateOf(drafted(false)), "post_drafts")).toMatchObject({
      effect: "create",
      target: "/api/notes",
    });
  });
});

describe("state order after a variant line is dropped", () => {
  it("orders entities by the lines left, so a plain list listing them in another order lists them all", () => {
    const view = stateOf([
      [
        "GET",
        "/api/books?expand=shelf",
        [expandedBook(SECOND_BOOK), expandedBook(FIRST_BOOK)],
      ],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
    ]).views.find((candidate) => candidate.tool === "get_books");
    expect(view).toMatchObject({
      shape: "list",
      membership: "all",
      projected_record_ordinals: [0],
    });
  });
});

describe("item lines first recorded after a write", () => {
  it("replays an item line that shows another representation, though first recorded after a write", () => {
    const created = book(3, "Third Book", bookClock(4));
    const state = stateOf([
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", created, 201, { name: "Third Book" }],
      ["GET", "/api/books/3", created],
      ["GET", "/api/books/1?expand=shelf", expandedBook(FIRST_BOOK)],
    ]);
    expect(
      state.views.find((view) => view.tool === "get_books_by_id"),
    ).toMatchObject({
      projected_record_ordinals: [5],
      projected_query_keys: [{ name: "expand" }],
    });
  });
});

describe("item lines first recorded after a write, against the lines left", () => {
  const created = book(3, "Third Book", bookClock(4));
  const lines = (late: TimedCaptureRow): TimedCaptureRow[] => [
    ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
    ["GET", "/api/books/1", FIRST_BOOK],
    ["GET", "/api/books/2", SECOND_BOOK],
    ["GET", "/api/books/1?expand=shelf", expandedBook(FIRST_BOOK)],
    ["POST", "/api/books", created, 201, { name: "Third Book" }],
    ["GET", "/api/books/3", created],
    late,
  ];
  const itemView = (rows: TimedCaptureRow[]) =>
    stateOf(rows).views.find((view) => view.tool === "get_books_by_id");

  it("compares a later line with the lines left after variants are dropped, not the dropped ones", () => {
    // The early `expand` line is dropped as a variant, so `include` shows a shelf the lines left never show.
    expect(
      itemView(
        lines(["GET", "/api/books/2?include=shelf", expandedBook(SECOND_BOOK)]),
      ),
    ).toMatchObject({
      projected_record_ordinals: [3, 6],
      projected_query_keys: expect.arrayContaining([{ name: "include" }]),
    });
  });

  it("replays a later selection of some fields that keeps the identity but leaves members out", () => {
    expect(
      itemView(
        lines([
          "GET",
          "/api/books/2?fields=id,name",
          { id: 2, name: "Second Book" },
        ]),
      ),
    ).toMatchObject({
      projected_record_ordinals: [3, 6],
      projected_query_keys: expect.arrayContaining([{ name: "fields" }]),
    });
  });
});

describe("reads overlapping a linked create", () => {
  it("links a create whose id only a list still running when it began showed before", () => {
    const state = stateOf([
      ["GET", "/api/notes", [A, B]],
      ["GET", "/api/notes/1001", A],
      ["GET", "/api/notes/1002", B],
      // Begun before the publish and finished after it, so it may show what the publish made.
      ["GET", "/api/notes", [A, B, C], 200, undefined, 2500],
      ["POST", "/api/drafts/publish", { id: 1003 }, 201, { title: "Gamma" }],
      ["GET", "/api/notes/1003", C],
      ["GET", "/api/notes", [A, B, C]],
    ]);
    expect(planOf(state, "post_drafts_publish")).toMatchObject({
      effect: "create",
      target: "/api/notes",
    });
    expect(notesOf(state)).toEqual(["1001", "1002"]);
  });
});

describe("earlier reads of the returned id under other types", () => {
  it("links a create whose id an earlier read of another type named", () => {
    const user = { id: 1003, login: "gamma" };
    const state = stateOf([
      ["GET", "/api/users/1003", user],
      ["GET", "/api/notes", [A, B]],
      ["GET", "/api/notes/1001", A],
      ["GET", "/api/notes/1002", B],
      ["POST", "/api/drafts/publish", { id: 1003 }, 201, { title: "Gamma" }],
      ["GET", "/api/notes/1003", C],
      ["GET", "/api/notes", [A, B, C]],
    ]);
    expect(planOf(state, "post_drafts_publish")).toMatchObject({
      effect: "create",
      target: "/api/notes",
    });
  });
});

describe("item reads that show no entity", () => {
  it("links a create past a read of its id that answered JSON null under another type", () => {
    const user = (id: number, login: string) => ({ id, login });
    const state = stateOf([
      ["GET", "/api/notes", [A, B]],
      ["GET", "/api/notes/1001", A],
      ["GET", "/api/notes/1002", B],
      ["GET", "/api/users/1001", user(1001, "alpha")],
      // Ends the users' initial reads, so the null read below plans nothing.
      [
        "PATCH",
        "/api/users/1001",
        user(1001, "alpha2"),
        200,
        { login: "alpha2" },
      ],
      ["POST", "/api/drafts/publish", { id: 1003 }, 201, { title: "Gamma" }],
      ["GET", "/api/users/1003", null],
      ["GET", "/api/notes/1003", C],
      ["GET", "/api/notes", [A, B, C]],
    ]);
    expect(planOf(state, "post_drafts_publish")).toMatchObject({
      effect: "create",
      target: "/api/notes",
    });
  });
});

describe("what a linked create observes", () => {
  it("observes a linked create only in a read of an id its response named, inside an envelope too", () => {
    const D = note(1004, "Delta");
    const state = stateOf([
      ["GET", "/api/notes", [A, B]],
      ["GET", "/api/notes/1001", A],
      ["GET", "/api/notes/1002", B],
      [
        "POST",
        "/api/drafts/publish",
        { data: { id: 1003 } },
        201,
        { title: "Gamma" },
      ],
      // Another note the state never held, which the publish did not make.
      ["GET", "/api/notes/1004", D],
      ["GET", "/api/notes/1003", C],
    ]);
    expect(planOf(state, "post_drafts_publish")).toMatchObject({
      effect: "create",
      target: "/api/notes",
      observation: { ordinal: 5 },
    });
  });
});

describe("creates whose returned id an earlier read showed", () => {
  it("links no create whose returned id a list of its collection showed before it", () => {
    const listed = (shown: JsonValue[]): TimedCaptureRow[] =>
      published([
        [
          "PATCH",
          "/api/notes/1001",
          note(1001, "Alpha 2"),
          200,
          { title: "Alpha 2" },
        ],
        ["GET", "/api/notes?include=archived", shown],
      ]);
    const alpha = note(1001, "Alpha 2");
    expect(
      planOf(stateOf(listed([alpha, B, C])), "post_drafts_publish"),
    ).toMatchObject({ effect: "none", reason: "no-state-target" });
    expect(
      planOf(stateOf(listed([alpha, B])), "post_drafts_publish"),
    ).toMatchObject({ effect: "create", target: "/api/notes" });
  });
});

describe("lines left to replay", () => {
  it("plans a list past a line that asks for some fields only and leaves the proved id out", () => {
    const created = book(3, "Third Book", bookClock(4));
    const state = stateOf([
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      [
        "GET",
        "/api/books?fields=name",
        [{ name: "First Book" }, { name: "Second Book" }],
      ],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", created, 201, { name: "Third Book" }],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK, created]],
    ]);
    expect(state.views.find((view) => view.tool === "get_books")).toMatchObject(
      {
        shape: "list",
        checked_record_ordinals: [0],
        projected_record_ordinals: [1],
        projected_query_keys: [{ name: "fields" }],
      },
    );
    expect(planOf(state, "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });

  it("checks a list line asking for every field beside the plain one, as serving answers both from the state", () => {
    const created = book(3, "Third Book", bookClock(4));
    const state = stateOf([
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books?fields=*", [FIRST_BOOK, SECOND_BOOK]],
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      ["POST", "/api/books", created, 201, { name: "Third Book" }],
      ["GET", "/api/books?fields=*", [FIRST_BOOK, SECOND_BOOK, created]],
    ]);
    const view = state.views.find(
      (candidate) => candidate.tool === "get_books",
    );
    expect(view).toMatchObject({
      shape: "list",
      checked_record_ordinals: [0, 1],
    });
    expect(view).not.toHaveProperty("projected_record_ordinals");
    expect(planOf(state, "post_books")).toMatchObject({
      served: true,
      checked_record_ordinals: [5],
    });
  });

  it("keeps a list's whole line when only a replayed line's membership changed across a write", () => {
    // The expanded line lists shelved books only; the whole list still shows both after the export.
    const view = stateOf([
      ["GET", "/api/books/1", FIRST_BOOK],
      ["GET", "/api/books/2", SECOND_BOOK],
      [
        "GET",
        "/api/books?expand=shelf",
        [FIRST_BOOK, SECOND_BOOK].map(expandedBook),
      ],
      ["POST", "/api/exports", { queued: true }, 202, { format: "csv" }],
      ["GET", "/api/books?expand=shelf", [expandedBook(FIRST_BOOK)]],
      ["GET", "/api/books", [FIRST_BOOK, SECOND_BOOK]],
    ]).views.find((candidate) => candidate.tool === "get_books");
    expect(view).toMatchObject({
      shape: "list",
      checked_record_ordinals: [5],
      projected_record_ordinals: [4],
      projected_query_keys: [{ name: "expand" }],
    });
  });
});

describe("field selections the gate reads as serving answers them", () => {
  it("approves no create from a read serving replays, a selection no checked line gave", () => {
    const state = stateOf([
      ["GET", "/api/books/1?fields=*", FIRST_BOOK],
      ["GET", "/api/books/2?fields=*", SECOND_BOOK],
      ["GET", "/api/books/2?fields=name", { name: "Second Book" }],
      ["POST", "/api/books", THIRD_BOOK, 201, { name: "Third Book" }],
      [
        "GET",
        "/api/books/3?fields=id,name,slug,created_at,updated_at",
        THIRD_BOOK,
      ],
    ]);
    expect(
      state.views.find((view) => view.tool === "get_books_by_id"),
    ).toMatchObject({
      projected_query_keys: [{ name: "fields", value: "name" }],
    });
    expect(planOf(state, "post_books")).toMatchObject({
      served: false,
      reason: "unconfirmed",
    });
  });

  it("checks an update against a read of every field, which serving answers from the state", () => {
    const state = stateOf([
      ...BOOK_INIT_ROWS,
      ["GET", "/api/books/2?fields=name", { name: "Second Book" }],
      ["PATCH", "/api/books/1", RENAMED_BOOK, 200, { name: "Renamed Book" }],
      ["GET", "/api/books/1?fields=*", FIRST_BOOK],
      ["GET", "/api/books/1", RENAMED_BOOK],
    ]);
    expect(
      state.views.find((view) => view.tool === "get_books_by_id"),
    ).toMatchObject({ projected_query_keys: [{ name: "fields" }] });
    expect(planOf(state, "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "contradicted",
      contradicted_by: 5,
    });
  });
});

/** A create and an update whose bodies and responses wrap the book in a one-element array. */
const ENVELOPED_ROWS: readonly TimedCaptureRow[] = [
  ...BOOK_INIT_ROWS,
  [
    "POST",
    "/api/books",
    { books: [THIRD_BOOK] },
    201,
    { books: [{ name: "Third Book" }] },
  ],
  ["GET", "/api/books/3", THIRD_BOOK],
  [
    "PATCH",
    "/api/books/1",
    { books: [RENAMED_BOOK] },
    200,
    { books: [{ name: "Renamed Book" }] },
  ],
  ["GET", "/api/books/1", RENAMED_BOOK],
];

/** A card whose edit info an update restamps: its response and its read-back name instants milliseconds apart. */
const cardEdit = (milliseconds: number) => ({
  at: new Date(Date.parse(bookClock(3)) + milliseconds).toISOString(),
  by: "rea",
});
const FIRST_CARD = {
  id: 1,
  name: "First Card",
  edit: { at: "2026-10-01T09:00:00.000Z", by: "rea" },
};
const SECOND_CARD = { ...FIRST_CARD, id: 2, name: "Second Card" };

describe("values an application stamps", () => {
  it("serves a create and an update whose bodies wrap the book in a one-element array, as the capture sent them", () => {
    const state = stateOf(ENVELOPED_ROWS);
    expect(planOf(state, "post_books")).toMatchObject({
      served: true,
      body: { accepted: ["name"], envelope: "books" },
    });
    expect(planOf(state, "patch_books_by_id")).toMatchObject({
      served: true,
      body: { accepted: ["name"], envelope: "books" },
    });
  });

  it("serves an update that restamps a nested clock, storing the instant its read-back shows", () => {
    const edited = { ...FIRST_CARD, name: "First Card (edited)" };
    const state = stateOf([
      ["GET", "/api/cards", [FIRST_CARD, SECOND_CARD]],
      ["GET", "/api/cards/1", FIRST_CARD],
      ["GET", "/api/cards/2", SECOND_CARD],
      [
        "PUT",
        "/api/cards/1",
        { ...edited, edit: cardEdit(64) },
        200,
        { name: "First Card (edited)" },
      ],
      ["GET", "/api/cards/1", { ...edited, edit: cardEdit(53) }],
    ]);
    expect(planOf(state, "put_cards_by_id")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        expect.objectContaining({
          field: "edit",
          rule: "nested-clock",
          members: ["at"],
        }),
      ]),
    });
  });

  it("serves creates whose read-backs store a nested clock at another instant than their responses spell", () => {
    // Each response stamps the edit in milliseconds; its read-back stores microseconds a few milliseconds earlier.
    const card = (id: number, seconds: number, at: string) => ({
      id,
      name: `Card ${String(id)}`,
      edit: { at, by: "rea" },
    });
    const answered = (seconds: number) =>
      new Date(Date.parse(bookClock(seconds)) + 30).toISOString();
    const stored = (seconds: number, micro: string) =>
      `${bookClock(seconds).slice(0, -1)}.${micro}Z`;
    const state = stateOf([
      ["GET", "/api/cards", [FIRST_CARD, SECOND_CARD]],
      ["GET", "/api/cards/1", FIRST_CARD],
      ["GET", "/api/cards/2", SECOND_CARD],
      ["POST", "/api/cards", card(3, 3, answered(3)), 201, { name: "Card 3" }],
      ["GET", "/api/cards/3", card(3, 3, stored(3, "020123"))],
      ["POST", "/api/cards", card(4, 5, answered(5)), 201, { name: "Card 4" }],
      ["GET", "/api/cards/4", card(4, 5, stored(5, "021456"))],
    ]);
    expect(planOf(state, "post_cards")).toMatchObject({
      served: true,
      checked_record_ordinals: [4, 6],
      rules: expect.arrayContaining([
        expect.objectContaining({ field: "edit", rule: "nested-clock" }),
      ]),
    });
  });
});

describe("nested clocks another recorded call kept", () => {
  const CARD_INIT_ROWS: TimedCaptureRow[] = [
    ["GET", "/api/cards", [FIRST_CARD, SECOND_CARD]],
    ["GET", "/api/cards/1", FIRST_CARD],
    ["GET", "/api/cards/2", SECOND_CARD],
  ];
  /** The first card renamed, with its edit stamped 64 ms into the given exchange's second, or kept as it was. */
  const card = (name: string, stampedAt?: number) => ({
    ...FIRST_CARD,
    name,
    edit:
      stampedAt === undefined
        ? FIRST_CARD.edit
        : {
            at: new Date(Date.parse(bookClock(stampedAt)) + 64).toISOString(),
            by: "rea",
          },
  });
  const put = (written: ReturnType<typeof card>): TimedCaptureRow[] => [
    ["PUT", "/api/cards/1", written, 200, { name: written.name }],
    ["GET", "/api/cards/1", written],
  ];
  const verdictOf = (rows: readonly TimedCaptureRow[]) =>
    planOf(stateOf([...CARD_INIT_ROWS, ...rows]), "put_cards_by_id");

  it("serves no update whose nested clock another recorded call kept, before or after the call that stamped it", () => {
    expect(
      verdictOf([...put(card("Edited", 3)), ...put(card("Renamed", 5))]),
    ).toMatchObject({ served: true });
    const stamped = card("Edited", 3);
    expect(
      verdictOf([...put(stamped), ...put({ ...stamped, name: "Renamed" })]),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
    expect(
      verdictOf([...put(card("Edited")), ...put(card("Renamed", 5))]),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
  });
});

/** A book with tags, as an application that keeps tags as a set lists them. */
const tagged = (entry: Book, tags: string[]): Book => ({ ...entry, tags });
const TAGGED_INIT_ROWS: TimedCaptureRow[] = [
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
];

describe("array fields a view lists sorted", () => {
  it("serves an update whose read-back lists the written tags sorted, and every view of the type sorts them", () => {
    const state = stateOf([
      ...TAGGED_INIT_ROWS,
      ["GET", "/api/books/2", tagged(SECOND_BOOK, ["delta", "zeta"])],
    ]);
    expect(planOf(state, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
    for (const tool of ["get_books_by_id", "get_books"])
      expect(state.views.find((view) => view.tool === tool)).toMatchObject({
        sorted_arrays: ["tags"],
      });
  });

  it("learns no sorting from a read after another the gate counted listed the field unsorted", () => {
    const state = stateOf([
      ...TAGGED_INIT_ROWS,
      ["GET", "/api/books/2", tagged(SECOND_BOOK, ["zeta", "delta"])],
      [
        "PATCH",
        "/api/books/1",
        tagged(FIRST_BOOK, ["omega", "beta"]),
        200,
        { tags: ["omega", "beta"] },
      ],
      ["GET", "/api/books/1", tagged(FIRST_BOOK, ["beta", "omega"])],
    ]);
    expect(planOf(state, "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "contradicted",
    });
    expect(
      state.views.find((view) => view.tool === "get_books_by_id"),
    ).not.toHaveProperty("sorted_arrays");
  });

  it("learns no sorting from a read whose order fits the values held first, then the new ones as written", () => {
    // `alpha` was held before the update and `zeta` was not: a store ordering tags by when it made them lists them so too.
    const state = stateOf([
      ...TAGGED_INIT_ROWS.slice(0, 3),
      [
        "PATCH",
        "/api/books/2",
        tagged(SECOND_BOOK, ["zeta", "alpha"]),
        200,
        { tags: ["zeta", "alpha"] },
      ],
      ["GET", "/api/books/2", tagged(SECOND_BOOK, ["alpha", "zeta"])],
    ]);
    expect(planOf(state, "patch_books_by_id")).toMatchObject({
      served: false,
      reason: "contradicted",
    });
    expect(
      state.views.find((view) => view.tool === "get_books_by_id"),
    ).not.toHaveProperty("sorted_arrays");
  });

  it("keeps the written order a read-back shows, though every initial array was sorted", () => {
    const state = stateOf([
      ...TAGGED_INIT_ROWS,
      ["GET", "/api/books/2", tagged(SECOND_BOOK, ["zeta", "delta"])],
    ]);
    expect(planOf(state, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
    expect(
      state.views.find((view) => view.tool === "get_books_by_id"),
    ).not.toHaveProperty("sorted_arrays");
  });
});

/** A book on a shelf, in a collection per shelf whose ids repeat across shelves. */
const shelved = (tags: string[]) => ({ id: 1, name: "Shelved Book", tags });

describe("evidence a learned sort keeps answering to", () => {
  it("drops a sort a view learned once a later counted read lists the field as written", () => {
    const state = stateOf([
      ...TAGGED_INIT_ROWS,
      ["GET", "/api/books/2", tagged(SECOND_BOOK, ["delta", "zeta"])],
      [
        "GET",
        "/api/books",
        [
          tagged(FIRST_BOOK, ["alpha", "beta"]),
          tagged(SECOND_BOOK, ["zeta", "delta"]),
        ],
      ],
    ]);
    expect(planOf(state, "patch_books_by_id")).toMatchObject({
      served: true,
      checked_record_ordinals: [4],
    });
    expect(
      state.views.find((view) => view.tool === "get_books_by_id"),
    ).toMatchObject({ sorted_arrays: ["tags"] });
    expect(
      state.views.find((view) => view.tool === "get_books"),
    ).not.toHaveProperty("sorted_arrays");
  });

  it("learns no sorting from another collection's entity under the read's id", () => {
    // Shelf 1's read-back fits `alpha`, held before the update, then `zeta` as written; shelf 2's book shares its id.
    const state = stateOf([
      ["GET", "/api/shelves/1/books", [shelved(["alpha", "beta"])]],
      ["GET", "/api/shelves/1/books/1", shelved(["alpha", "beta"])],
      ["GET", "/api/shelves/2/books", [shelved(["beta", "gamma"])]],
      ["GET", "/api/shelves/2/books/1", shelved(["beta", "gamma"])],
      [
        "PATCH",
        "/api/shelves/1/books/1",
        shelved(["zeta", "alpha"]),
        200,
        { tags: ["zeta", "alpha"] },
      ],
      ["GET", "/api/shelves/1/books/1", shelved(["alpha", "zeta"])],
    ]);
    expect(state.writes).toEqual([
      expect.objectContaining({ served: false, reason: "contradicted" }),
    ]);
    for (const view of state.views)
      expect(view).not.toHaveProperty("sorted_arrays");
  });
});

describe("initial order", () => {
  it("orders a collection as a whole list line that applies no sort lists it, after an item read and filtered or sorted lines", () => {
    const alpha = book(1, "Alpha", "2026-10-01T09:00:00Z");
    const charlie = book(2, "Charlie", "2026-10-01T10:00:00Z");
    const bravo = book(3, "Bravo", "2026-10-01T11:00:00Z");
    const state = stateOf([
      ["GET", "/api/books/2", charlie],
      ["GET", "/api/books?name=Alpha", [alpha]],
      ["GET", "/api/books?ordering=name", [alpha, bravo, charlie]],
      ["GET", "/api/books", [bravo, alpha, charlie]],
      ["GET", "/api/books/1", alpha],
      ["GET", "/api/books/3", bravo],
    ]);
    expect(
      state.entities
        .filter((entity) => entity.type === "/api/books")
        .map((entity) => entity.id),
    ).toEqual(["3", "1", "2"]);
  });
});

describe("insert rules the recorded order cannot settle", () => {
  const listed = (id: string, name: string, created: string) => ({
    id,
    name,
    created_at: created,
  });
  const rowsFor = (
    members: { id: string; name: string; created_at: string }[],
    created: { id: string; name: string; created_at: string },
  ): TimedCaptureRow[] => [
    ["GET", "/api/items", members],
    ...members.map((member): TimedCaptureRow => [
      "GET",
      `/api/items/${member.id}`,
      member,
    ]),
    ["POST", "/api/items", created, 201, { name: created.name }],
    ["GET", `/api/items/${created.id}`, created],
  ];

  it("places a create last, not by identity, when its identities are random UUIDs", () => {
    const at = "2026-10-01T09:00:00Z";
    const plan = planOf(
      stateOf(
        rowsFor(
          [
            listed("1c0e8a2b-7f3d-4e9a-b1c2-d3e4f5a6b7c8", "Delta", at),
            listed("5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", "Alpha", at),
            listed("9b2f1c3e-0d4a-4b6e-8f1a-2c3d4e5f6a7b", "Charlie", at),
          ],
          listed("e5d6e7f8-1a2b-4c3d-9e4f-5a6b7c8d9e0f", "Echo", bookClock(4)),
        ),
      ),
      "post_items",
    );
    expect(plan).toMatchObject({ served: true, insert: { rule: "last" } });
  });

  it("keeps sorting by an identity a creation clock follows", () => {
    const plan = planOf(
      environmentStateViewOf(
        timedCaptureEvidence(
          rowsFor(
            [
              listed(
                "6ad47b491023b50001087124",
                "Alpha",
                "2026-10-01T09:00:00Z",
              ),
              listed(
                "6ad47b491023b50001087125",
                "Bravo",
                "2026-10-01T10:00:00Z",
              ),
            ],
            listed("6ad47b491023b50001087130", "Charlie", bookClock(3)),
          ),
        ),
        ["opaque-token"],
      ),
      "post_items",
    );
    expect(plan).toMatchObject({
      served: true,
      insert: { rule: "sorted", field: "id", direction: "ascending" },
    });
  });

  it("places a create last when the orders the list admits put it in different places", () => {
    const plan = planOf(
      stateOf(
        rowsFor(
          [
            listed("2", "Alpha", "2026-10-01T10:00:00Z"),
            listed("1", "Delta", "2026-10-01T09:00:00Z"),
          ],
          listed("3", "Bravo", bookClock(3)),
        ),
      ),
      "post_items",
    );
    expect(plan).toMatchObject({ served: true, insert: { rule: "last" } });
  });
});

/** A task whose modified clock is stored in whole seconds. */
const task = (id: number, name: string, modifiedAt: string) => ({
  id,
  name,
  modifiedAt,
});
const OLD_CLOCK = "2026-10-01T09:00:00Z";

describe("clocks an update may stamp in its own second", () => {
  const sameSecond: TimedCaptureRow[] = [
    [
      "GET",
      "/api/tasks",
      [task(1, "First", bookClock(3)), task(2, "Second", OLD_CLOCK)],
    ],
    ["GET", "/api/tasks/1", task(1, "First", bookClock(3))],
    ["GET", "/api/tasks/2", task(2, "Second", OLD_CLOCK)],
    [
      "PATCH",
      "/api/tasks/1",
      task(1, "Renamed", bookClock(3)),
      200,
      { name: "Renamed" },
    ],
    ["GET", "/api/tasks/1", task(1, "Renamed", bookClock(3))],
  ];

  it("confirms no update that left an unsent clock as it was in the second it ran", () => {
    expect(planOf(stateOf(sameSecond), "patch_tasks_by_id")).toMatchObject({
      served: false,
      reason: "unconfirmed",
    });
  });

  it("serves the update once another call shows it stamping the clock", () => {
    const plan = planOf(
      stateOf([
        ...sameSecond,
        [
          "PATCH",
          "/api/tasks/2",
          task(2, "Second (renamed)", bookClock(5)),
          200,
          { name: "Second (renamed)" },
        ],
        ["GET", "/api/tasks/2", task(2, "Second (renamed)", bookClock(5))],
      ]),
      "patch_tasks_by_id",
    );
    expect(plan).toMatchObject({
      served: true,
      checked_record_ordinals: [4, 6],
    });
    expect(plan.rules).toContainEqual(
      expect.objectContaining({ field: "modifiedAt", rule: "clock" }),
    );
  });
});

/** A book with an `archived` flag, which an item action sets. */
const withArchived = (entity: Book, archived: boolean): Book => ({
  ...entity,
  archived,
});

/** A post whose `status` goes with whether it has a publication clock. */
const post = (id: number, status: string, publishedAt: string | null) => ({
  id,
  title: `Post ${id}`,
  status,
  published_at: publishedAt,
});

describe("recorded calls serving would refuse", () => {
  it("serves no action that only a call sent with another query showed setting its field", () => {
    const archived = withArchived(FIRST_BOOK, true);
    // Serving pins toggle=true, so the call sent with toggle=false shows nothing of what serving does.
    const plan = planOf(
      stateOf([
        [
          "GET",
          "/api/books",
          [withArchived(FIRST_BOOK, false), withArchived(SECOND_BOOK, false)],
        ],
        ["GET", "/api/books/1", withArchived(FIRST_BOOK, false)],
        ["GET", "/api/books/2", withArchived(SECOND_BOOK, false)],
        ["POST", "/api/books/1/archive?toggle=true", archived],
        ["GET", "/api/books/1", archived],
        ["POST", "/api/books/1/archive?toggle=false", archived],
        ["GET", "/api/books/1", archived],
      ]),
      "post_books_archive_by_id",
    );
    expect(plan).toMatchObject({ served: false, reason: "unconfirmed" });
  });

  it("confirms no document write by a call sent with another query than serving pins", () => {
    // The dry run changed nothing; the read after the real call shows only what that call did.
    const plan = planOf(
      stateOf([
        ["GET", "/api/settings", { theme: "light", lang: "en" }],
        [
          "PATCH",
          "/api/settings?dry_run=true",
          { theme: "dark", lang: "en" },
          200,
          { theme: "dark" },
        ],
        [
          "PATCH",
          "/api/settings?dry_run=false",
          { theme: "dark", lang: "en" },
          200,
          { theme: "dark" },
        ],
        ["GET", "/api/settings", { theme: "dark", lang: "en" }],
      ]),
      "patch_settings",
    );
    expect(plan).toMatchObject({ served: false, checked_record_ordinals: [] });
  });

  it("confirms no delete by a call sent with another query than serving pins", () => {
    const plan = planOf(
      stateOf([
        ...BOOK_INIT_ROWS,
        ["DELETE", "/api/books/2?dry_run=true", "", 204],
        ["DELETE", "/api/books/1?dry_run=false", "", 204],
        ["GET", "/api/books/1", BOOK_NOT_FOUND, 404],
      ]),
      "delete_books_by_id",
    );
    expect(plan).toMatchObject({ served: false, checked_record_ordinals: [] });
  });

  it("keeps a create's dependent state pinned when another call does not prove its result", () => {
    const draft = post(3, "draft", null);
    const sent = { title: "Post 3", status: "draft" };
    const others: TimedCaptureRow[] = [
      ["POST", "/api/posts", { detail: "Invalid." }, 422, { status: "x" }],
      ["POST", "/api/posts", "", 204, { title: "Post 4", status: "published" }],
      [
        "POST",
        "/api/posts?import=true",
        post(4, "published", bookClock(6)),
        201,
        { title: "Post 4", status: "published" },
      ],
    ];
    for (const other of others) {
      const plan = planOf(
        stateOf([
          [
            "GET",
            "/api/posts",
            [
              post(1, "published", "2026-10-01T09:00:00Z"),
              post(2, "published", "2026-10-01T10:00:00Z"),
            ],
          ],
          ["GET", "/api/posts/1", post(1, "published", "2026-10-01T09:00:00Z")],
          ["GET", "/api/posts/2", post(2, "published", "2026-10-01T10:00:00Z")],
          ["POST", "/api/posts", draft, 201, sent],
          ["GET", "/api/posts/3", draft],
          other,
        ]),
        "post_posts",
      );
      expect(plan.served, other[1]).toBe(true);
      expect(plan.body?.fixed, other[1]).toEqual([
        { member: "status", sent: "draft" },
      ]);
    }
  });
});

it.each(["__proto__", "constructor"])(
  "learns a confirmed update of an own %s field",
  (field) => {
    const initial = {
      id: 1,
      name: "One",
      ...Object.fromEntries([[field, { label: "old" }]]),
    };
    const body = Object.fromEntries([[field, { label: "stored" }]]);
    const updated = { ...initial, ...body };
    const state = stateOf([
      ["GET", "/api/items", [initial, { id: 2, name: "Two" }]],
      ["GET", "/api/items/1", initial],
      ["PATCH", "/api/items/1", updated, 200, body],
      ["GET", "/api/items/1", updated],
    ]);
    expect(planOf(state, "patch_items_by_id")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([{ rule: "echo", field }]),
    });
  },
);
