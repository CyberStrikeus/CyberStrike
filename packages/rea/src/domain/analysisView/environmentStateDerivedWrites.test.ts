import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  BOOKMARK_ROWS,
  FIXED_HELD_TAG_ROWS,
  FIXED_SIBLING_TAG_ROWS,
  FOLDER_ROWS,
  goClock,
  LATER_FIXED_SIBLING_TAG_ROWS,
  MIDDLE_FIXED_TAG_UPDATE_ROWS,
  MIXED_WIDTH_TAG_UPDATE_ROWS,
  restoredAddressRows,
  TAG_ROWS,
  TAG_UPDATE_ROWS,
  TWO_CLOCK_TAG_UPDATE_ROWS,
  UNKNOWN_TAG_UPDATE_ROWS,
} from "../../../tests/fixtures/environmentStateDerivedValues.js";
import {
  bookClock,
  environmentStateViewOf,
  numberedUuid,
} from "../../../tests/fixtures/environmentStateWrites.js";
import type { JsonValue } from "../jsonValue.js";
import { isObject, type JsonObject } from "./environmentStateRules.js";

const planOf = (rows: readonly TimedCaptureRow[], tool: string) => {
  const plan = environmentStateViewOf(timedCaptureEvidence(rows)).writes.find(
    (candidate) => candidate.tool === tool,
  );
  if (plan === undefined) throw new Error(`No plan for ${tool}`);
  return plan;
};

const TRIMMED = {
  kind: "iso",
  separator: "T",
  fraction: 9,
  zone: "Z",
  trimmed: true,
} as const;

/** A capture row whose response leaves out one field. */
const omitting = (row: TimedCaptureRow, field: string): TimedCaptureRow => {
  const [method, path, body, ...rest] = row;
  if (!isObject(body)) throw new Error("Expected an object response");
  return [
    method,
    path,
    Object.fromEntries(Object.entries(body).filter(([key]) => key !== field)),
    ...rest,
  ];
};

describe("later creates must retain the learned value rules", () => {
  it("withholds a later create whose captured composed address is null", () => {
    const snapshot = null;
    const rows = BOOKMARK_ROWS.slice(0, 6).map(
      (row, index): TimedCaptureRow => {
        if (index !== 5) return row;
        const [method, path, body, ...rest] = row;
        if (!isObject(body)) throw new Error("Expected a bookmark response");
        return [
          method,
          path,
          { ...body, web_archive_snapshot_url: snapshot },
          ...rest,
        ];
      },
    );
    expect(planOf(rows, "post_bookmarks")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it.each([
    {
      name: "composed snapshot address",
      tool: "post_bookmarks",
      rows: (): TimedCaptureRow[] =>
        BOOKMARK_ROWS.slice(0, 6).map((row, index) =>
          index === 5 ? omitting(row, "web_archive_snapshot_url") : row,
        ),
    },
    {
      name: "templated id text",
      tool: "post_folders",
      rows: (): TimedCaptureRow[] =>
        mirrored((id) =>
          id === 1656166745726976 ? {} : { idText: String(id) },
        ),
    },
  ])(
    "withholds a later create whose response omits the $name the plan rebuilds",
    ({ tool, rows }) => {
      expect(planOf(rows(), tool)).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
    },
  );

  it.each([
    {
      name: "a string integer becomes a UUID",
      exemplar: String,
      later: numberedUuid(888),
    },
    {
      name: "a string integer becomes an equal-length token",
      exemplar: String,
      later: "a656166745726976",
    },
    {
      name: "a UUID becomes an equal-length opaque token",
      exemplar: (id: number) => numberedUuid(400 + (id % 1000)),
      later: "a".repeat(35) + "1",
    },
  ])("withholds a create when $name", ({ exemplar, later }) => {
    const changed = (value: JsonValue): JsonValue =>
      Array.isArray(value)
        ? value.map(changed)
        : isObject(value)
          ? Object.fromEntries(
              Object.entries(value).map(([field, child]) => [
                field,
                field === "id" && typeof child === "number"
                  ? child === 1656166745726976
                    ? later
                    : exemplar(child)
                  : changed(child),
              ]),
            )
          : value;
    const rows = FOLDER_ROWS.map((row): TimedCaptureRow => {
      const [method, path, body, ...rest] = row;
      return body === undefined ? row : [method, path, changed(body), ...rest];
    });
    expect(planOf(rows, "post_folders")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });
});

describe("clock spellings an application derives", () => {
  it("serves creates whose clocks drop trailing fraction zeros, as Go spells nanoseconds", () => {
    expect(planOf(TAG_ROWS, "post_tags")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "updatedAt", rule: "clock", format: TRIMMED },
      ]),
    });
  });

  it.each([
    ["2026-10-01T09:00:00.12345678Z", "2026-10-01T10:00:00.120000000Z"],
    ["2026-10-01T09:00:00.120000000Z", "2026-10-01T10:00:00.12345678Z"],
    ["2026-10-01T09:00:00.12345678Z", "2026-10-01T10:00:00.123456780Z"],
    ["2026-10-01T09:00:00.123456780Z", "2026-10-01T10:00:00.12345678Z"],
  ])(
    "keeps a create's clock at a fixed width when a held value ends its fraction in a zero (%s, %s)",
    (first, second) => {
      const held = [first, second].map((updatedAt, index) => ({
        id: numberedUuid(index + 1),
        name: `Held ${index + 1}`,
        updatedAt,
      }));
      const created = {
        id: numberedUuid(3),
        name: "Heavy",
        updatedAt: goClock(3, "374763655"),
      };
      const rows: TimedCaptureRow[] = [
        ["GET", "/api/tags", held],
        ...held.map((tag): TimedCaptureRow => [
          "GET",
          `/api/tags/${tag.id}`,
          tag,
        ]),
        ["POST", "/api/tags", created, 201, { name: "Heavy" }],
        ["GET", `/api/tags/${created.id}`, created],
      ];
      expect(planOf(rows, "post_tags").rules).toContainEqual({
        field: "updatedAt",
        rule: "clock",
        format: { kind: "iso", separator: "T", fraction: 9, zone: "Z" },
      });
    },
  );

  it("keeps a create's sibling clock at a fixed width when a later call trims one clock and shows the sibling's trailing zero", () => {
    const rules = planOf(FIXED_SIBLING_TAG_ROWS, "post_tags").rules;
    expect(rules).toContainEqual({
      field: "updatedAt",
      rule: "clock",
      format: TRIMMED,
    });
    expect(rules).toContainEqual({
      field: "createdAt",
      rule: "clock",
      format: { kind: "iso", separator: "T", fraction: 9, zone: "Z" },
    });
  });

  it("serves updates whose clock a later call shows trimmed", () => {
    expect(planOf(TAG_UPDATE_ROWS, "patch_tags_by_uuid")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "updatedAt", rule: "clock", format: TRIMMED },
      ]),
    });
  });

  it("learns no clock spelling from an update to an entity an unmodelled write left unknown", () => {
    expect(planOf(UNKNOWN_TAG_UPDATE_ROWS, "patch_tags_by_uuid")).toMatchObject(
      {
        served: true,
        rules: expect.arrayContaining([
          {
            field: "updatedAt",
            rule: "clock",
            format: { kind: "iso", separator: "T", fraction: 9, zone: "Z" },
          },
        ]),
      },
    );
  });

  it("serves updates whose two clocks a later call shows trimmed for one only", () => {
    expect(
      planOf(TWO_CLOCK_TAG_UPDATE_ROWS, "patch_tags_by_uuid"),
    ).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "updatedAt", rule: "clock", format: TRIMMED },
        { field: "syncedAt", rule: "clock", format: TRIMMED },
      ]),
    });
  });
});

describe("fixed-width clock evidence", () => {
  const FIXED = {
    kind: "iso",
    separator: "T",
    fraction: 9,
    zone: "Z",
  } as const;

  it.each([1, 2])(
    "withholds a shorter update clock when held entity %s proves a fixed width",
    (heldId) => {
      const fixedHeld = (value: JsonValue): JsonValue =>
        Array.isArray(value)
          ? value.map(fixedHeld)
          : isObject(value) && value.id === numberedUuid(heldId)
            ? { ...value, updatedAt: "2026-10-01T09:00:00.120000000Z" }
            : value;
      const rows = TAG_UPDATE_ROWS.map((row, index): TimedCaptureRow => {
        const [method, path, body, ...rest] = row;
        return index < 3 && body !== undefined
          ? [method, path, fixedHeld(body), ...rest]
          : row;
      });
      expect(planOf(rows, "patch_tags_by_uuid")).toMatchObject({
        served: false,
        reason: "unexplained-change",
        rules: expect.arrayContaining([
          { field: "updatedAt", rule: "clock", format: FIXED },
        ]),
      });
    },
  );

  it("serves updates whose later call trims one clock and shows the other's trailing zero", () => {
    expect(
      planOf(MIXED_WIDTH_TAG_UPDATE_ROWS, "patch_tags_by_uuid"),
    ).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "updatedAt", rule: "clock", format: TRIMMED },
        { field: "syncedAt", rule: "clock", format: FIXED },
      ]),
    });
  });

  it("keeps a create's clock at a fixed width an earlier later call showed, whatever a third shows", () => {
    expect(
      planOf(LATER_FIXED_SIBLING_TAG_ROWS, "post_tags").rules,
    ).toContainEqual({ field: "createdAt", rule: "clock", format: FIXED });
  });

  it("keeps a create's clock at a fixed width a held entity showed while its sibling is learned trimmed", () => {
    const rules = planOf(FIXED_HELD_TAG_ROWS, "post_tags").rules;
    expect(rules).toContainEqual({
      field: "updatedAt",
      rule: "clock",
      format: TRIMMED,
    });
    expect(rules).toContainEqual({
      field: "createdAt",
      rule: "clock",
      format: FIXED,
    });
  });

  it("withholds updates whose clock a later call trims after an earlier one showed a trailing zero", () => {
    expect(
      planOf(MIDDLE_FIXED_TAG_UPDATE_ROWS, "patch_tags_by_uuid"),
    ).toMatchObject({
      served: false,
      reason: "unexplained-change",
      rules: expect.arrayContaining([
        { field: "updatedAt", rule: "clock", format: FIXED },
      ]),
    });
  });
});

describe("values an application composes or generates", () => {
  it("withholds bookmark creates a later call answers with a snapshot address the composition does not spell", () => {
    const special = "https://web.archive.org/web/special";
    const rows = BOOKMARK_ROWS.flatMap((row): TimedCaptureRow[] => {
      const [method, path, body, ...rest] = row;
      if (method === "GET" && path === "/api/bookmarks/4") return [];
      return method === "POST" && isObject(body) && body.id === 4
        ? [
            [
              method,
              path,
              { ...body, web_archive_snapshot_url: special },
              ...rest,
            ],
          ]
        : [row];
    }).slice(0, -1);
    expect(planOf(rows, "post_bookmarks")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("serves creates whose snapshot address joins the creation time and the sent URL, accepting any URL", () => {
    expect(planOf(BOOKMARK_ROWS, "post_bookmarks")).toMatchObject({
      served: true,
      body: { accepted: ["url", "title"], fixed: [] },
      rules: expect.arrayContaining([
        {
          field: "web_archive_snapshot_url",
          rule: "composed",
          parts: [
            { text: "https://web.archive.org/web/" },
            { from: "date_added", as: "clock", pattern: "YYYYMMDDhhmmss" },
            { text: "/" },
            { from: "url", as: "value" },
          ],
        },
      ]),
    });
  });

  it("serves folder creates and renames whose address follows the uid and the title's slug, and whose numeric id is generated", () => {
    const url = {
      field: "url",
      rule: "composed",
      parts: [
        { text: "/dashboards/f/" },
        { from: "uid", as: "value" },
        { text: "/" },
        { from: "title", as: "slug" },
      ],
    };
    expect(planOf(FOLDER_ROWS, "post_folders")).toMatchObject({
      served: true,
      body: { accepted: ["uid", "title"], fixed: [] },
      rules: expect.arrayContaining([{ field: "id", rule: "unique" }, url]),
    });
    expect(planOf(FOLDER_ROWS, "put_folders_by_uuid")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([url]),
    });
  });

  it("serves folder creates whose address follows a generated uid and the title's slug", () => {
    const generated = FOLDER_ROWS.map((row): TimedCaptureRow => {
      const [method, path, body, status, sent] = row;
      if (method !== "POST" || !isObject(sent) || body === undefined)
        return row;
      const { uid: _uid, ...title } = sent;
      return [method, path, body, status!, title];
    });
    expect(planOf(generated, "post_folders")).toMatchObject({
      served: true,
      body: { accepted: ["title"] },
      rules: expect.arrayContaining([
        {
          field: "url",
          rule: "composed",
          parts: [
            { text: "/dashboards/f/" },
            { from: "uid", as: "value" },
            { text: "/" },
            { from: "title", as: "slug" },
          ],
        },
      ]),
    });
  });

  it("withholds renames whose address a later call composes when an earlier call left it otherwise", () => {
    expect(
      planOf(restoredAddressRows(true), "put_folders_by_uuid"),
    ).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        expect.objectContaining({ field: "url", rule: "composed" }),
      ]),
    });
    // The first rename left its address as it was, which the composition would rebuild.
    expect(
      planOf(restoredAddressRows(false), "put_folders_by_uuid"),
    ).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it.each([null, { path: "/legacy" }])(
    "withholds a later composition whose parts an earlier rename could not spell (%j)",
    (base) => {
      const first = { id: 1, title: "First Folder", base, url: "/legacy" };
      const renamedFirst = { ...first, title: "Renamed First Folder" };
      const second = {
        id: 2,
        title: "Second Folder",
        base: "https://example.test/folders",
        url: "https://example.test/folders/second-folder",
      };
      const renamedSecond = {
        ...second,
        title: "Renamed Second Folder",
        url: "https://example.test/folders/renamed-second-folder",
      };
      const rows: TimedCaptureRow[] = [
        ["GET", "/api/folders", [first, second]],
        ["GET", "/api/folders/1", first],
        ["GET", "/api/folders/2", second],
        [
          "PUT",
          "/api/folders/1",
          renamedFirst,
          200,
          { title: renamedFirst.title },
        ],
        ["GET", "/api/folders/1", renamedFirst],
        [
          "PUT",
          "/api/folders/2",
          renamedSecond,
          200,
          { title: renamedSecond.title },
        ],
        ["GET", "/api/folders/2", renamedSecond],
      ];
      expect(planOf(rows, "put_folders_by_id")).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
    },
  );
});

/** The folder rows with each folder's numeric id repeated where `mirror` puts it, and in each create's body when `sent`. */
const mirrored = (
  mirror: (id: number) => JsonObject,
  sent = false,
): TimedCaptureRow[] => {
  const repeated = (value: JsonValue): JsonValue =>
    Array.isArray(value)
      ? value.map(repeated)
      : isObject(value) && typeof value.id === "number"
        ? { ...value, ...mirror(value.id) }
        : value;
  return FOLDER_ROWS.map((row): TimedCaptureRow => {
    const [method, path, body, ...rest] = row;
    if (body === undefined) return row;
    const answered = repeated(body);
    const [status, request] = rest;
    return sent &&
      method === "POST" &&
      isObject(answered) &&
      status !== undefined &&
      isObject(request)
      ? [
          method,
          path,
          answered,
          status,
          { ...request, ...mirror(Number(answered.id)) },
        ]
      : [method, path, answered, ...rest];
  });
};

/** A folder's slug with `&` spelled as Grafana's Go slugs spell it. */
const wordSlug = (title: string): string =>
  title
    .replaceAll("&", " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

/** A folder's slug with `&` dropped, as Django's slugify drops it. */
const droppedSlug = (title: string): string =>
  wordSlug(title.replaceAll("&", " "));

/** When the seeded folder was made, well before the capture. */
const SEEDED = "2026-10-01T09:00:00Z";

/** Grafana's time-based folder ids, as the recorded folders hold them. */
const FOLDER_IDS = [1655476044521472, 1656166527623168, 1656166745726976];

interface CreatedFolder {
  readonly uid: string;
  readonly title: string;
  /** Whether the call sent the uid, or the application generated it. */
  readonly sent: boolean;
  /** The address's last segment, when the application spells it otherwise than the title's slug. */
  readonly tail?: string;
}

/** A seeded folder and folder creates, each read back and listed, whose addresses join the uid and `spell` of the title. */
const folderCreates = (
  created: readonly CreatedFolder[],
  spell: (title: string) => string,
  seed: { readonly uid: string; readonly title: string } = {
    uid: numberedUuid(101),
    title: "Lighthouse Rota",
  },
): TimedCaptureRow[] => {
  const entity = (
    folder: {
      readonly uid: string;
      readonly title: string;
      readonly tail?: string;
    },
    index: number,
    at: number,
  ): JsonObject => ({
    id: FOLDER_IDS[index]!,
    uid: folder.uid,
    title: folder.title,
    url: `/dashboards/f/${folder.uid}/${folder.tail ?? spell(folder.title)}`,
    created: bookClock(at),
    updated: bookClock(at),
  });
  const held: JsonObject[] = [
    { ...entity(seed, 0, 0), created: SEEDED, updated: SEEDED },
  ];
  const rows: TimedCaptureRow[] = [
    ["GET", "/api/folders", [...held]],
    ["GET", `/api/folders/${seed.uid}`, held[0]!],
  ];
  created.forEach((folder, index) => {
    // The application stamps a create with the time of its call, the row's position.
    const answered = entity(folder, index + 1, rows.length);
    held.push(answered);
    rows.push(
      [
        "POST",
        "/api/folders",
        answered,
        200,
        folder.sent
          ? { uid: folder.uid, title: folder.title }
          : { title: folder.title },
      ],
      ["GET", `/api/folders/${folder.uid}`, answered],
      ["GET", "/api/folders", [...held]],
    );
  });
  return rows;
};

const addressParts = (ampersand?: "and") => [
  { text: "/dashboards/f/" },
  { from: "uid", as: "value" },
  { text: "/" },
  {
    from: "title",
    as: "slug",
    ...(ampersand === undefined ? {} : { ampersand }),
  },
];

describe("slug spellings across creates", () => {
  it("learns that a slug spells & as the word from the first create that sends one", () => {
    const rows = folderCreates(
      [
        { uid: numberedUuid(102), title: "Alpha Harbour", sent: false },
        { uid: numberedUuid(103), title: "Bravo Tide & Wind", sent: false },
      ],
      wordSlug,
    );
    expect(planOf(rows, "post_folders")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "url", rule: "composed", parts: addressParts("and") },
      ]),
    });
  });

  it("keeps a slug that drops &, and refuses a later create that spells it as the word", () => {
    const dropped = folderCreates(
      [
        { uid: numberedUuid(102), title: "Alpha & Harbour", sent: false },
        { uid: numberedUuid(103), title: "Bravo Tide", sent: false },
      ],
      droppedSlug,
    );
    expect(planOf(dropped, "post_folders")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "url", rule: "composed", parts: addressParts() },
      ]),
    });
    const mixed = folderCreates(
      [
        { uid: numberedUuid(102), title: "Alpha & Harbour", sent: false },
        {
          uid: numberedUuid(103),
          title: "Bravo Tide & Wind",
          sent: false,
          tail: "bravo-tide-and-wind",
        },
      ],
      droppedSlug,
    );
    expect(planOf(mixed, "post_folders")).toMatchObject({ served: false });
  });

  it("keeps a dropped & that an accepted create showed when a later one spells it as the word", () => {
    const tag = (id: number, name: string, slug: string) => ({
      id,
      name,
      slug,
    });
    const seed = tag(1, "Lamp Oil", "lamp-oil");
    const created = [
      tag(2, "Alpha Notes", "alpha-notes"),
      tag(3, "Bravo & Tide", "bravo-tide"),
      tag(4, "Charlie & Wind", "charlie-and-wind"),
    ];
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/tags", [seed]],
      ["GET", "/api/tags/1", seed],
    ];
    created.forEach((entity, index) =>
      rows.push(
        ["POST", "/api/tags", entity, 201, { name: entity.name }],
        ["GET", `/api/tags/${String(entity.id)}`, entity],
        ["GET", "/api/tags", [seed, ...created.slice(0, index + 1)]],
      ),
    );
    const plan = planOf(rows, "post_tags");
    expect(plan.rules).toContainEqual({
      field: "slug",
      rule: "slug",
      from: "name",
    });
    expect(plan.served).toBe(false);
  });
});

/** A category whose slug the application derives from its name. */
const category = (id: number, name: string, slug: string) => ({
  id,
  name,
  slug,
});

/** Two category renames, each read back, after reading the `held` categories; a PUT sends the whole object back. */
const renameRows = (
  method: "PATCH" | "PUT",
  held: readonly ReturnType<typeof category>[],
  renames: readonly ReturnType<typeof category>[],
): TimedCaptureRow[] => {
  const current = new Map(held.map((entity) => [entity.id, entity]));
  const rows: TimedCaptureRow[] = [
    ["GET", "/api/categories", [...held]],
    ...held.map((entity): TimedCaptureRow => [
      "GET",
      `/api/categories/${entity.id}`,
      entity,
    ]),
  ];
  for (const renamed of renames) {
    const before = current.get(renamed.id)!;
    rows.push(
      [
        method,
        `/api/categories/${renamed.id}`,
        renamed,
        200,
        method === "PATCH"
          ? { name: renamed.name }
          : { ...before, name: renamed.name },
      ],
      ["GET", `/api/categories/${renamed.id}`, renamed],
    );
    current.set(renamed.id, renamed);
  }
  rows.push(["GET", "/api/categories", [...current.values()]]);
  return rows;
};

describe("slug spellings across updates", () => {
  it.each(["PATCH", "PUT"] as const)(
    "applies held spelling to the initial %s rule without needing a later update",
    (method) => {
      for (const held of [
        [category(1, "Salt & Pepper", "salt-and-pepper")],
        [
          category(1, "Lamp Oil", "lamp-oil"),
          category(2, "Salt & Pepper", "salt-and-pepper"),
        ],
      ]) {
        const plan = planOf(
          renameRows(method, held, [
            category(1, "Harbour Notes", "harbour-notes"),
          ]),
          `${method.toLowerCase()}_categories_by_id`,
        );
        expect(plan).toMatchObject({
          served: true,
          rules: expect.arrayContaining([
            { field: "slug", rule: "slug", from: "name", ampersand: "and" },
          ]),
        });
      }
    },
  );

  it.each(["PATCH", "PUT"] as const)(
    "withholds an initial %s that contradicts held slug spelling",
    (method) => {
      const plan = planOf(
        renameRows(
          method,
          [category(1, "Salt & Pepper", "salt-and-pepper")],
          [category(1, "Tide & Wind", "tide-wind")],
        ),
        `${method.toLowerCase()}_categories_by_id`,
      );
      expect(plan.served).toBe(false);
    },
  );

  it.each(["PATCH", "PUT"] as const)(
    "withholds an initial %s with contradictory held slug conventions",
    (method) => {
      const plan = planOf(
        renameRows(
          method,
          [
            category(1, "Lamp Oil", "lamp-oil"),
            category(2, "Salt & Pepper", "salt-and-pepper"),
            category(3, "Tide & Wind", "tide-wind"),
          ],
          [category(1, "Harbour Notes", "harbour-notes")],
        ),
        `${method.toLowerCase()}_categories_by_id`,
      );
      expect(plan.served).toBe(false);
    },
  );

  it.each(["PATCH", "PUT"] as const)(
    "learns that an update's slug spells & as the word from a later %s that renames to one",
    (method) => {
      const rows = renameRows(
        method,
        [
          category(1, "Harbour Notes", "harbour-notes"),
          category(2, "Lamp Oil", "lamp-oil"),
        ],
        [
          category(1, "Quay Notes", "quay-notes"),
          category(2, "Tide & Wind", "tide-and-wind"),
        ],
      );
      expect(
        planOf(rows, `${method.toLowerCase()}_categories_by_id`),
      ).toMatchObject({
        served: true,
        rules: expect.arrayContaining([
          { field: "slug", rule: "slug", from: "name", ampersand: "and" },
        ]),
      });
    },
  );

  it.each(["PATCH", "PUT"] as const)(
    "keeps a slug that spells & as the word when a later %s renames to a name without one",
    (method) => {
      const rows = renameRows(
        method,
        [
          category(1, "Harbour Notes", "harbour-notes"),
          category(2, "Lamp Oil", "lamp-oil"),
        ],
        [
          category(1, "Tide & Wind", "tide-and-wind"),
          category(2, "Quay Notes", "quay-notes"),
        ],
      );
      expect(
        planOf(rows, `${method.toLowerCase()}_categories_by_id`),
      ).toMatchObject({
        served: true,
        rules: expect.arrayContaining([
          { field: "slug", rule: "slug", from: "name", ampersand: "and" },
        ]),
      });
    },
  );

  it.each([
    [
      "a held category",
      [
        category(1, "Harbour Notes", "harbour-notes"),
        category(3, "Salt & Pepper", "salt-pepper"),
      ],
      [category(1, "Quay Notes", "quay-notes")],
    ],
    [
      "an earlier rename",
      [
        category(1, "Harbour Notes", "harbour-notes"),
        category(3, "Lamp Oil", "lamp-oil"),
      ],
      [category(1, "Salt & Pepper", "salt-pepper")],
    ],
  ])(
    "refuses a later rename that spells & as the word after %s dropped it",
    (_, held, earlier) => {
      const rows = renameRows("PATCH", held, [
        ...earlier,
        category(held[1]!.id, "Tide & Wind", "tide-and-wind"),
      ]);
      expect(planOf(rows, "patch_categories_by_id")).toMatchObject({
        served: false,
      });
    },
  );
});

describe("slug spellings the held entities show", () => {
  it("spells & as the held entities do when the creates slug none", () => {
    const rows = folderCreates(
      [
        { uid: numberedUuid(102), title: "Alpha Harbour", sent: false },
        { uid: numberedUuid(103), title: "Bravo Tide", sent: false },
      ],
      wordSlug,
      { uid: numberedUuid(101), title: "Lamp & Oil" },
    );
    expect(planOf(rows, "post_folders")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "url", rule: "composed", parts: addressParts("and") },
      ]),
    });
  });

  it("learns a slug field's & spelling from held tags, and no slug rule they contradict", () => {
    const tagRows = (held: string, created: string, slug: string) => {
      const seed = { id: 1, name: held, slug: wordSlug(held) };
      const tag = { id: 2, name: created, slug };
      return [
        ["GET", "/api/tags", [seed]],
        ["GET", "/api/tags/1", seed],
        ["POST", "/api/tags", tag, 201, { name: created }],
        ["GET", "/api/tags/2", tag],
        ["GET", "/api/tags", [seed, tag]],
      ] as TimedCaptureRow[];
    };
    expect(
      planOf(
        tagRows("Salt & Pepper", "Harbour Notes", "harbour-notes"),
        "post_tags",
      ).rules,
    ).toContainEqual({
      field: "slug",
      rule: "slug",
      from: "name",
      ampersand: "and",
    });
    expect(
      planOf(tagRows("Salt & Pepper", "Tide & Wind", "tide-wind"), "post_tags")
        .rules,
    ).not.toContainEqual(
      expect.objectContaining({ field: "slug", rule: "slug" }),
    );
  });

  it("learns no slug rule from held tags that spell & both ways", () => {
    const held = [
      { id: 1, name: "Salt & Pepper", slug: "salt-and-pepper" },
      { id: 3, name: "Fish & Chips", slug: "fish-chips" },
    ];
    const tag = { id: 2, name: "Harbour Notes", slug: "harbour-notes" };
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/tags", held],
      ["GET", "/api/tags/1", held[0]!],
      ["GET", "/api/tags/3", held[1]!],
      ["POST", "/api/tags", tag, 201, { name: tag.name }],
      ["GET", "/api/tags/2", tag],
      ["GET", "/api/tags", [...held, tag]],
    ];
    expect(planOf(rows, "post_tags").rules).not.toContainEqual(
      expect.objectContaining({ field: "slug", rule: "slug" }),
    );
  });

  it("learns no & spelling from a held slug neither spelling gives", () => {
    const rows = (created: string, slug: string): TimedCaptureRow[] => {
      const seed = { id: 1, name: "Salt & Pepper", slug: "condiments" };
      const tag = { id: 2, name: created, slug };
      return [
        ["GET", "/api/tags", [seed]],
        ["GET", "/api/tags/1", seed],
        ["POST", "/api/tags", tag, 201, { name: created }],
        ["GET", "/api/tags/2", tag],
        ["GET", "/api/tags", [seed, tag]],
      ];
    };
    expect(
      planOf(rows("Tide & Wind", "tide-and-wind"), "post_tags").rules,
    ).not.toContainEqual(
      expect.objectContaining({ field: "slug", rule: "slug" }),
    );
    expect(
      planOf(rows("Harbour Notes", "harbour-notes"), "post_tags").rules,
    ).toContainEqual({ field: "slug", rule: "slug", from: "name" });
  });
});

describe("ambiguous addresses and templates across creates", () => {
  it("learns an address the first create cannot tell apart, its uid being its title's slug, from the second", () => {
    const rows = folderCreates(
      [
        { uid: "alpha-harbour", title: "Alpha Harbour", sent: true },
        { uid: "bravo-store", title: "Bravo Tide Notes", sent: true },
      ],
      wordSlug,
      { uid: "lighthouse-rota", title: "Lighthouse Rota" },
    );
    expect(planOf(rows, "post_folders")).toMatchObject({
      served: true,
      body: { accepted: ["uid", "title"], fixed: [] },
      rules: expect.arrayContaining([
        { field: "url", rule: "composed", parts: addressParts() },
      ]),
    });
  });

  it("withholds creates whose template a later create answers otherwise", () => {
    const rows = folderCreates(
      [
        {
          uid: numberedUuid(102),
          title: "Alpha Harbour",
          sent: false,
          tail: "inbox",
        },
        {
          uid: numberedUuid(103),
          title: "Bravo Tide",
          sent: false,
          tail: "outbox",
        },
      ],
      wordSlug,
    );
    expect(planOf(rows, "post_folders")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });
});

describe("generated integers another field repeats", () => {
  it("withholds folder creates a later call answers with a UUID where the exemplar generated an integer", () => {
    const later = 1656166745726976;
    const answered = numberedUuid(203);
    const swap = (value: JsonValue): JsonValue =>
      Array.isArray(value)
        ? value.map(swap)
        : isObject(value) && value.id === later
          ? { ...value, id: answered }
          : value;
    const rows = FOLDER_ROWS.map((row): TimedCaptureRow => {
      const [method, path, body, ...rest] = row;
      return body === undefined ? row : [method, path, swap(body), ...rest];
    });
    expect(planOf(rows, "post_folders")).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("withholds folder creates whose generated numeric id another field repeats, which seeding cannot keep", () => {
    expect(
      planOf(
        mirrored((id) => ({ folderId: id })),
        "post_folders",
      ),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
  });

  it("withholds folder creates whose generated numeric id a number nested in another field repeats", () => {
    expect(
      planOf(
        mirrored((id) => ({ metadata: { serial: id } })),
        "post_folders",
      ),
    ).toMatchObject({ served: false, reason: "unexplained-change" });
  });

  it.each([
    [
      "an echoed string of its digits",
      (id: number) => ({ serialText: String(id) }),
      true,
    ],
    [
      "a string another rule generates around its digits",
      (id: number) => ({ ref: `folder-${id}` }),
      false,
    ],
  ])(
    "withholds folder creates whose generated numeric id %s repeats",
    (_, mirror, sent) => {
      expect(planOf(mirrored(mirror, sent), "post_folders")).toMatchObject({
        served: false,
        reason: "unexplained-change",
      });
    },
  );

  it("serves folder creates whose string of the id's digits a template rebuilds from it", () => {
    expect(
      planOf(
        mirrored((id) => ({ idText: String(id) })),
        "post_folders",
      ),
    ).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "id", rule: "unique" },
        { field: "idText", rule: "template", from: "id" },
      ]),
    });
  });
});

describe("slugs the held entities' spellings refuse", () => {
  const SALT = { id: 1, name: "Salt & Pepper", slug: "salt-and-pepper" };
  const FISH = { id: 3, name: "Fish & Chips", slug: "fish-chips" };

  it.each([
    ["spell & both ways", [SALT, FISH], "Harbour Notes", "harbour-notes"],
    ["spell & otherwise than the create", [SALT], "Tide & Wind", "tide-wind"],
  ])(
    "accepts a created tag's name only as recorded when held tags %s",
    (_case, held, name, slug) => {
      const tag = { id: 2, name, slug };
      const rows: TimedCaptureRow[] = [
        ["GET", "/api/tags", held],
        ...held.map((entity): TimedCaptureRow => [
          "GET",
          `/api/tags/${String(entity.id)}`,
          entity,
        ]),
        ["POST", "/api/tags", tag, 201, { name }],
        ["GET", "/api/tags/2", tag],
        ["GET", "/api/tags", [...held, tag]],
      ];
      const plan = planOf(rows, "post_tags");
      expect(plan.rules).not.toContainEqual(
        expect.objectContaining({ field: "slug", rule: "slug" }),
      );
      // The slug kept as recorded fits only the recorded name.
      expect(plan.body).not.toBeNull();
      expect(plan.body?.accepted).not.toContain("name");
      expect(plan.body?.fixed).toContainEqual({ member: "name", sent: name });
    },
  );
});
