import type { JsonValue } from "../../src/domain/jsonValue.js";
import type { TimedCaptureRow } from "./analysisView.js";
import { bookClock, numberedUuid } from "./environmentStateWrites.js";

type Entity = { [field: string]: JsonValue };

/** The instant `seconds` after the first exchange with nanosecond digits, trailing zeros trimmed as Go spells them. */
export const goClock = (seconds: number, nanos: string): string =>
  bookClock(seconds).replace("Z", `.${nanos}`.replace(/\.?0+$/u, "") + "Z");

const tag = (n: number, name: string, created: string, updated: string) => ({
  id: numberedUuid(n),
  name,
  createdAt: created,
  updatedAt: updated,
});

const FIRST_TAG = tag(
  1,
  "Fragile",
  "2026-10-01T09:00:00.123456789Z",
  "2026-10-01T09:00:00.123456791Z",
);
const SECOND_TAG = tag(
  2,
  "Outdoor",
  "2026-10-01T10:00:00.223456789Z",
  "2026-10-01T10:00:00.223456791Z",
);
/** The first created tag's clocks show nine digits; the second's update clock ends in a zero Go drops. */
const HEAVY_TAG = tag(
  3,
  "Heavy",
  goClock(3, "374763655"),
  goClock(3, "374763767"),
);
const BORROWED_TAG = tag(
  4,
  "Borrowed",
  goClock(5, "388122047"),
  goClock(5, "388122180"),
);

/** Two tag creates whose clocks Go spells with trailing fraction zeros trimmed, confirmed by later reads. */
export const TAG_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/tags", [FIRST_TAG, SECOND_TAG]],
  ["GET", `/api/tags/${numberedUuid(1)}`, FIRST_TAG],
  ["GET", `/api/tags/${numberedUuid(2)}`, SECOND_TAG],
  ["POST", "/api/tags", HEAVY_TAG, 201, { name: "Heavy" }],
  ["GET", `/api/tags/${numberedUuid(3)}`, HEAVY_TAG],
  ["POST", "/api/tags", BORROWED_TAG, 201, { name: "Borrowed" }],
  ["GET", `/api/tags/${numberedUuid(4)}`, BORROWED_TAG],
  ["GET", "/api/tags", [FIRST_TAG, SECOND_TAG, HEAVY_TAG, BORROWED_TAG]],
];

/** A held tag whose update clock keeps a trailing zero, so the application spells that clock at a fixed width. */
const FIXED_SECOND_TAG = {
  ...SECOND_TAG,
  updatedAt: "2026-10-01T10:00:00.223456790Z",
};

/** The tag creates beside a held tag that shows the update clock at a fixed width, which the later create's trimmed clock contradicts. */
export const HELD_FIXED_TAG_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/tags", [FIRST_TAG, FIXED_SECOND_TAG]],
  ["GET", `/api/tags/${numberedUuid(1)}`, FIRST_TAG],
  ["GET", `/api/tags/${numberedUuid(2)}`, FIXED_SECOND_TAG],
  ...TAG_ROWS.slice(3, 7),
  ["GET", "/api/tags", [FIRST_TAG, FIXED_SECOND_TAG, HEAVY_TAG, BORROWED_TAG]],
];

/** A later tag create whose update clock Go trims while its creation clock keeps a trailing zero. */
const FIXED_CREATED_TAG = tag(
  4,
  "Borrowed",
  bookClock(5).replace("Z", ".388122040Z"),
  goClock(5, "388122180"),
);

/** Tag creates whose later call trims one clock and shows its sibling at a fixed width. */
export const FIXED_SIBLING_TAG_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/tags", [FIRST_TAG, SECOND_TAG]],
  ["GET", `/api/tags/${numberedUuid(1)}`, FIRST_TAG],
  ["GET", `/api/tags/${numberedUuid(2)}`, SECOND_TAG],
  ["POST", "/api/tags", HEAVY_TAG, 201, { name: "Heavy" }],
  ["GET", `/api/tags/${numberedUuid(3)}`, HEAVY_TAG],
  ["POST", "/api/tags", FIXED_CREATED_TAG, 201, { name: "Borrowed" }],
  ["GET", `/api/tags/${numberedUuid(4)}`, FIXED_CREATED_TAG],
  ["GET", "/api/tags", [FIRST_TAG, SECOND_TAG, HEAVY_TAG, FIXED_CREATED_TAG]],
];

/** A clock's UTC date and time digits, as the Wayback Machine names a snapshot. */
const archiveDigits = (clock: string): string =>
  clock.replace(/\D/gu, "").slice(0, 14);

/** A bookmark whose snapshot address names its creation time and its URL. */
export const bookmark = (
  id: number,
  url: string,
  title: string,
  added: string,
): Entity => ({
  id,
  url,
  title,
  web_archive_snapshot_url: `https://web.archive.org/web/${archiveDigits(added)}/${url}`,
  date_added: added,
  date_modified: added,
});

const FIRST_BOOKMARK = bookmark(
  1,
  "https://ferries.example.test/timetable",
  "Ferry timetable",
  "2026-10-01T09:00:00Z",
);
const SECOND_BOOKMARK = bookmark(
  2,
  "https://harbour.example.test/tides",
  "Harbour tides",
  "2026-10-01T10:00:00Z",
);
const THIRD_BOOKMARK = bookmark(
  3,
  "https://quarry.example.test/ledger",
  "Quarry ledger",
  bookClock(3),
);
const FOURTH_BOOKMARK = bookmark(
  4,
  "https://kitchen.example.test/menus",
  "Kitchen menus",
  bookClock(5),
);

/** Two bookmark creates whose snapshot addresses the application composes, confirmed by later reads. */
export const BOOKMARK_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/bookmarks", [FIRST_BOOKMARK, SECOND_BOOKMARK]],
  ["GET", "/api/bookmarks/1", FIRST_BOOKMARK],
  ["GET", "/api/bookmarks/2", SECOND_BOOKMARK],
  [
    "POST",
    "/api/bookmarks",
    THIRD_BOOKMARK,
    201,
    { url: "https://quarry.example.test/ledger", title: "Quarry ledger" },
  ],
  ["GET", "/api/bookmarks/3", THIRD_BOOKMARK],
  [
    "POST",
    "/api/bookmarks",
    FOURTH_BOOKMARK,
    201,
    { url: "https://kitchen.example.test/menus", title: "Kitchen menus" },
  ],
  ["GET", "/api/bookmarks/4", FOURTH_BOOKMARK],
  [
    "GET",
    "/api/bookmarks",
    [FIRST_BOOKMARK, SECOND_BOOKMARK, THIRD_BOOKMARK, FOURTH_BOOKMARK],
  ],
];

const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

/** A folder named by the uid its creator chose, with an address from that uid and its title, and a time-based numeric id. */
export const folder = (
  uid: string,
  title: string,
  id: number,
  created: string,
  updated = created,
): Entity => ({
  id,
  uid,
  title,
  url: `/dashboards/f/${uid}/${slugOf(title)}`,
  created,
  updated,
});

const SEED_FOLDER = folder(
  numberedUuid(101),
  "Lighthouse Rota",
  1655476044521472,
  "2026-10-01T09:00:00Z",
);
const ALPHA = folder(
  numberedUuid(102),
  "Scratch Alpha Harbor",
  1656166527623168,
  bookClock(2),
);
const BRAVO = folder(
  numberedUuid(103),
  "Scratch Bravo Meadow",
  1656166745726976,
  bookClock(4),
);
/** The first created folder after the recorded rename at exchange 6. */
const RENAMED_ALPHA = folder(
  numberedUuid(102),
  "Renamed Alpha Lantern",
  1656166527623168,
  bookClock(2),
  bookClock(6),
);

/** Two folder creates and a rename, whose addresses follow uid and title, confirmed by later reads. */
export const FOLDER_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/folders", [SEED_FOLDER]],
  ["GET", `/api/folders/${numberedUuid(101)}`, SEED_FOLDER],
  [
    "POST",
    "/api/folders",
    ALPHA,
    200,
    { uid: numberedUuid(102), title: "Scratch Alpha Harbor" },
  ],
  ["GET", `/api/folders/${numberedUuid(102)}`, ALPHA],
  [
    "POST",
    "/api/folders",
    BRAVO,
    200,
    { uid: numberedUuid(103), title: "Scratch Bravo Meadow" },
  ],
  ["GET", `/api/folders/${numberedUuid(103)}`, BRAVO],
  [
    "PUT",
    `/api/folders/${numberedUuid(102)}`,
    RENAMED_ALPHA,
    200,
    { title: "Renamed Alpha Lantern" },
  ],
  ["GET", `/api/folders/${numberedUuid(102)}`, RENAMED_ALPHA],
  ["GET", "/api/folders", [SEED_FOLDER, RENAMED_ALPHA, BRAVO]],
];

/** Two folder renames, the first leaving its address as it was unless `rebuilt`, which another tool then rebuilds. */
export const restoredAddressRows = (rebuilt: boolean): TimedCaptureRow[] => {
  const held = "2026-10-01T09:00:00Z";
  const alpha = folder(
    numberedUuid(102),
    "Scratch Alpha Harbor",
    1656166527623168,
    held,
  );
  const bravo = folder(
    numberedUuid(103),
    "Scratch Bravo Meadow",
    1656166745726976,
    held,
  );
  const renamed = folder(
    numberedUuid(102),
    "Renamed Alpha Lantern",
    1656166527623168,
    held,
    bookClock(3),
  );
  const first = rebuilt ? renamed : { ...renamed, url: alpha.url ?? null };
  const second = folder(
    numberedUuid(103),
    "Second Bravo Lantern",
    1656166745726976,
    held,
    bookClock(7),
  );
  return [
    ["GET", "/api/folders", [alpha, bravo]],
    ["GET", `/api/folders/${numberedUuid(102)}`, alpha],
    ["GET", `/api/folders/${numberedUuid(103)}`, bravo],
    [
      "PUT",
      `/api/folders/${numberedUuid(102)}`,
      first,
      200,
      { title: "Renamed Alpha Lantern" },
    ],
    ["GET", `/api/folders/${numberedUuid(102)}`, first],
    [
      "POST",
      `/api/folders/${numberedUuid(102)}/address`,
      renamed,
      200,
      { url: renamed.url ?? null },
    ],
    ["GET", `/api/folders/${numberedUuid(102)}`, renamed],
    [
      "PUT",
      `/api/folders/${numberedUuid(103)}`,
      second,
      200,
      { title: "Second Bravo Lantern" },
    ],
    ["GET", `/api/folders/${numberedUuid(103)}`, second],
  ];
};

const RENAMED_FIRST_TAG = {
  ...FIRST_TAG,
  name: "Fragile glass",
  updatedAt: goClock(3, "512345679"),
};
const RENAMED_SECOND_TAG = {
  ...SECOND_TAG,
  name: "Outdoor gear",
  updatedAt: goClock(5, "612345680"),
};

/** Two tag renames whose update clocks Go spells with nine and then eight fraction digits. */
export const TAG_UPDATE_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/tags", [FIRST_TAG, SECOND_TAG]],
  ["GET", `/api/tags/${numberedUuid(1)}`, FIRST_TAG],
  ["GET", `/api/tags/${numberedUuid(2)}`, SECOND_TAG],
  [
    "PATCH",
    `/api/tags/${numberedUuid(1)}`,
    RENAMED_FIRST_TAG,
    200,
    { name: "Fragile glass" },
  ],
  ["GET", `/api/tags/${numberedUuid(1)}`, RENAMED_FIRST_TAG],
  [
    "PATCH",
    `/api/tags/${numberedUuid(2)}`,
    RENAMED_SECOND_TAG,
    200,
    { name: "Outdoor gear" },
  ],
  ["GET", `/api/tags/${numberedUuid(2)}`, RENAMED_SECOND_TAG],
];

/** A book shelved as the application shelves it, on `general` when the call names no shelf. */
const shelved = (
  id: number,
  name: string,
  shelf: string,
  at: string,
): Entity => ({
  id,
  name,
  shelf,
  created_at: at,
});

const SHELVED_SEEDS = [
  shelved(1, "First Book", "general", "2026-10-01T09:00:00Z"),
  shelved(2, "Second Book", "general", "2026-10-01T10:00:00Z"),
];

/** Two book creates, one naming a shelf and one leaving it out, in the order given, each read back. */
export const shelvedRows = (
  first: { readonly name: string; readonly shelf?: string },
  second: { readonly name: string; readonly shelf?: string },
  stored: (sent: string) => string = (sent) => sent,
): TimedCaptureRow[] => {
  const third = shelved(
    3,
    first.name,
    first.shelf === undefined ? "general" : stored(first.shelf),
    bookClock(3),
  );
  const fourth = shelved(
    4,
    second.name,
    second.shelf === undefined ? "general" : stored(second.shelf),
    bookClock(5),
  );
  return [
    ["GET", "/api/books", SHELVED_SEEDS],
    ["GET", "/api/books/1", SHELVED_SEEDS[0]!],
    ["GET", "/api/books/2", SHELVED_SEEDS[1]!],
    ["POST", "/api/books", third, 201, first],
    ["GET", "/api/books/3", third],
    ["POST", "/api/books", fourth, 201, second],
    ["GET", "/api/books/4", fourth],
    ["GET", "/api/books", [...SHELVED_SEEDS, third, fourth]],
  ];
};

/** The shelved creates, then one that leaves the shelf out yet stores another shelf than the default, shown only in its answer. */
export const misshelvedRows = (): TimedCaptureRow[] => {
  const rows = shelvedRows(
    { name: "Third Book" },
    { name: "Fourth Book", shelf: "rare" },
  );
  const fifth = shelved(5, "Fifth Book", "attic", bookClock(rows.length));
  return [...rows, ["POST", "/api/books", fifth, 201, { name: "Fifth Book" }]];
};

const SHELVES = [
  { id: 1, name: "Main Hall", floor: "ground" },
  { id: 2, name: "Map Room", floor: "upper" },
];

/** A book as its item read shows it: its shelf whole, which its list read shows by id and name only. */
const filed = (
  id: number,
  name: string,
  shelf: number,
  at: string,
): Entity => ({
  id,
  name,
  shelf: SHELVES[shelf - 1]!,
  created_at: at,
});

const listed = (book: Entity): Entity => {
  const { id, name } = book["shelf"] as { id: number; name: string };
  return { ...book, shelf: { id, name } };
};

const FILED_SEED = filed(1, "Tide Tables", 1, "2026-10-01T09:00:00Z");
const ATLAS = filed(2, "Coastal Atlas", 2, bookClock(5));
const CHARTS = filed(3, "Harbour Charts", 1, bookClock(8));

/** Two book creates naming a shelf by `shelf_id`, whose answers and item reads show the shelf whole and whose list shows it by id and name. */
export const FILED_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/shelves", SHELVES],
  ["GET", "/api/shelves/1", SHELVES[0]!],
  ["GET", "/api/shelves/2", SHELVES[1]!],
  ["GET", "/api/books", [listed(FILED_SEED)]],
  ["GET", "/api/books/1", FILED_SEED],
  ["POST", "/api/books", ATLAS, 201, { name: "Coastal Atlas", shelf_id: 2 }],
  ["GET", "/api/books/2", ATLAS],
  ["GET", "/api/books", [listed(FILED_SEED), listed(ATLAS)]],
  ["POST", "/api/books", CHARTS, 201, { name: "Harbour Charts", shelf_id: 1 }],
  ["GET", "/api/books/3", CHARTS],
  ["GET", "/api/books", [listed(FILED_SEED), listed(ATLAS), listed(CHARTS)]],
];

/** Two creates whose last answer can contradict the named shelf, followed only by a list omitting that field. */
export const referencedCreateRows = (shelf: JsonValue): TimedCaptureRow[] => {
  const last = { ...CHARTS, shelf };
  const summary = ({ id, name }: Entity): Entity => ({ id: id!, name: name! });
  return [
    ...FILED_ROWS.filter(([, path]) => path.startsWith("/api/shelves")),
    ["GET", "/api/books", [summary(FILED_SEED)]],
    ["GET", "/api/books/1", FILED_SEED],
    ["POST", "/api/books", ATLAS, 201, { name: "Coastal Atlas", shelf_id: 2 }],
    ["GET", "/api/books/2", ATLAS],
    ["GET", "/api/books", [FILED_SEED, ATLAS].map(summary)],
    ["POST", "/api/books", last, 201, { name: "Harbour Charts", shelf_id: 1 }],
    ["GET", "/api/books", [FILED_SEED, ATLAS, last].map(summary)],
  ];
};

/** A book moved to another shelf by `shelf_id`, then renamed by a call that sends the shelf it already has. */
export const REFILED_ROWS: readonly TimedCaptureRow[] = (() => {
  const moved = filed(1, "Tide Tables", 2, "2026-10-01T09:00:00Z");
  const renamed = { ...moved, name: "Tide Tables, Revised" };
  return [
    ...FILED_ROWS.slice(0, 5),
    ["PATCH", "/api/books/1", moved, 200, { shelf_id: 2 }],
    ["GET", "/api/books/1", moved],
    ["GET", "/api/books", [listed(moved)]],
    [
      "PATCH",
      "/api/books/1",
      renamed,
      200,
      { name: "Tide Tables, Revised", shelf_id: 2 },
    ],
    ["GET", "/api/books/1", renamed],
    ["GET", "/api/books", [listed(renamed)]],
  ];
})();

/** Two book creates, one naming a shelf by `shelf_id` and one leaving it out, in the order given, each read back and listed. */
export const optionallyFiledRows = (shelfFirst: boolean): TimedCaptureRow[] => {
  const unfiled = (id: number, at: string): Entity => ({
    id,
    name: "Field Notes",
    created_at: at,
  });
  const [first, second] = shelfFirst
    ? [filed(2, "Coastal Atlas", 2, bookClock(5)), unfiled(3, bookClock(8))]
    : [unfiled(2, bookClock(5)), filed(3, "Coastal Atlas", 2, bookClock(8))];
  const sent = (book: Entity) =>
    "shelf" in book
      ? { name: book["name"]!, shelf_id: 2 }
      : { name: book["name"]! };
  const shown = (book: Entity) => ("shelf" in book ? listed(book) : book);
  return [
    ...FILED_ROWS.slice(0, 5),
    ["POST", "/api/books", first, 201, sent(first)],
    ["GET", "/api/books/2", first],
    ["GET", "/api/books", [listed(FILED_SEED), shown(first)]],
    ["POST", "/api/books", second, 201, sent(second)],
    ["GET", "/api/books/3", second],
    ["GET", "/api/books", [listed(FILED_SEED), shown(first), shown(second)]],
  ];
};

const tagged = (
  id: number,
  name: string,
  tags: string[],
  at: string,
): Entity => ({
  id,
  name,
  tags,
  created_at: at,
});

/** Two book creates sending tags out of order, which the application stores sorted. */
export const TAGGED_ROWS: readonly TimedCaptureRow[] = [
  [
    "GET",
    "/api/books",
    [tagged(1, "Tide Tables", ["coast", "tides"], "2026-10-01T09:00:00Z")],
  ],
  [
    "GET",
    "/api/books/1",
    tagged(1, "Tide Tables", ["coast", "tides"], "2026-10-01T09:00:00Z"),
  ],
  [
    "POST",
    "/api/books",
    tagged(2, "Atlas", ["maps", "zoning"], bookClock(2)),
    201,
    { name: "Atlas", tags: ["zoning", "maps"] },
  ],
  ["GET", "/api/books/2", tagged(2, "Atlas", ["maps", "zoning"], bookClock(2))],
  [
    "POST",
    "/api/books",
    tagged(3, "Charts", ["harbour", "sea"], bookClock(4)),
    201,
    { name: "Charts", tags: ["sea", "harbour"] },
  ],
  [
    "GET",
    "/api/books/3",
    tagged(3, "Charts", ["harbour", "sea"], bookClock(4)),
  ],
];

/** The same renames with an archive the gate does not model before the second, which leaves that tag unknown. */
export const UNKNOWN_TAG_UPDATE_ROWS: readonly TimedCaptureRow[] = [
  ...TAG_UPDATE_ROWS.slice(0, 5),
  ["POST", `/api/tags/${numberedUuid(2)}/archive`, { archived: true }, 200, {}],
  ...TAG_UPDATE_ROWS.slice(5),
];

const synced = (entity: Entity, syncedAt: string): Entity => ({
  ...entity,
  syncedAt,
});

/** The same renames stamping a second clock, which the later call still shows with nine digits. */
export const TWO_CLOCK_TAG_UPDATE_ROWS: readonly TimedCaptureRow[] = [
  [
    "GET",
    "/api/tags",
    [
      synced(FIRST_TAG, "2026-10-01T09:00:00.123456793Z"),
      synced(SECOND_TAG, "2026-10-01T10:00:00.223456793Z"),
    ],
  ],
  [
    "GET",
    `/api/tags/${numberedUuid(1)}`,
    synced(FIRST_TAG, "2026-10-01T09:00:00.123456793Z"),
  ],
  [
    "GET",
    `/api/tags/${numberedUuid(2)}`,
    synced(SECOND_TAG, "2026-10-01T10:00:00.223456793Z"),
  ],
  [
    "PATCH",
    `/api/tags/${numberedUuid(1)}`,
    synced(RENAMED_FIRST_TAG, goClock(3, "512345681")),
    200,
    { name: "Fragile glass" },
  ],
  [
    "GET",
    `/api/tags/${numberedUuid(1)}`,
    synced(RENAMED_FIRST_TAG, goClock(3, "512345681")),
  ],
  [
    "PATCH",
    `/api/tags/${numberedUuid(2)}`,
    synced(RENAMED_SECOND_TAG, goClock(5, "612345683")),
    200,
    { name: "Outdoor gear" },
  ],
  [
    "GET",
    `/api/tags/${numberedUuid(2)}`,
    synced(RENAMED_SECOND_TAG, goClock(5, "612345683")),
  ],
];

/** A clock `seconds` after the first exchange with the fraction digits as given. */
const clockAt = (seconds: number, fraction: string): string =>
  bookClock(seconds).replace("Z", `.${fraction}Z`);

/** The same renames whose later call trims the update clock and shows the synced clock's trailing zero. */
export const MIXED_WIDTH_TAG_UPDATE_ROWS: readonly TimedCaptureRow[] = [
  ...TWO_CLOCK_TAG_UPDATE_ROWS.slice(0, 5),
  [
    "PATCH",
    `/api/tags/${numberedUuid(2)}`,
    synced(RENAMED_SECOND_TAG, clockAt(5, "612345680")),
    200,
    { name: "Outdoor gear" },
  ],
  [
    "GET",
    `/api/tags/${numberedUuid(2)}`,
    synced(RENAMED_SECOND_TAG, clockAt(5, "612345680")),
  ],
];

const SPARE_TAG = tag(
  5,
  "Spare",
  goClock(7, "412345671"),
  goClock(7, "412345683"),
);

/** The same creates and a third whose creation clock shows nine digits without a trailing zero. */
export const LATER_FIXED_SIBLING_TAG_ROWS: readonly TimedCaptureRow[] = [
  ...FIXED_SIBLING_TAG_ROWS.slice(0, 7),
  ["POST", "/api/tags", SPARE_TAG, 201, { name: "Spare" }],
  ["GET", `/api/tags/${numberedUuid(5)}`, SPARE_TAG],
  [
    "GET",
    "/api/tags",
    [FIRST_TAG, SECOND_TAG, HEAVY_TAG, FIXED_CREATED_TAG, SPARE_TAG],
  ],
];

/** A held tag whose creation clock keeps a trailing zero while its update clock shows eight digits. */
const FIXED_HELD_TAG = tag(
  1,
  "Fragile",
  "2026-10-01T09:00:00.123456780Z",
  "2026-10-01T09:00:00.12345679Z",
);

/** One tag create among held tags that show the update clock trimmed and the creation clock at a fixed width. */
export const FIXED_HELD_TAG_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/tags", [FIXED_HELD_TAG, SECOND_TAG]],
  ["GET", `/api/tags/${numberedUuid(1)}`, FIXED_HELD_TAG],
  ["GET", `/api/tags/${numberedUuid(2)}`, SECOND_TAG],
  ["POST", "/api/tags", HEAVY_TAG, 201, { name: "Heavy" }],
  ["GET", `/api/tags/${numberedUuid(3)}`, HEAVY_TAG],
  ["GET", "/api/tags", [FIXED_HELD_TAG, SECOND_TAG, HEAVY_TAG]],
];

const GLASS_TAG = {
  ...FIRST_TAG,
  name: "Fragile glass",
  updatedAt: clockAt(3, "123456789"),
};
const GEAR_TAG = {
  ...SECOND_TAG,
  name: "Outdoor gear",
  updatedAt: clockAt(5, "123456780"),
};
const GLASSWARE_TAG = {
  ...GLASS_TAG,
  name: "Fragile glassware",
  updatedAt: clockAt(7, "12345678"),
};

/** Three tag renames whose update clocks show nine digits, nine ending in a zero, then eight. */
export const MIDDLE_FIXED_TAG_UPDATE_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/tags", [FIRST_TAG, SECOND_TAG]],
  ["GET", `/api/tags/${numberedUuid(1)}`, FIRST_TAG],
  ["GET", `/api/tags/${numberedUuid(2)}`, SECOND_TAG],
  [
    "PATCH",
    `/api/tags/${numberedUuid(1)}`,
    GLASS_TAG,
    200,
    { name: "Fragile glass" },
  ],
  ["GET", `/api/tags/${numberedUuid(1)}`, GLASS_TAG],
  [
    "PATCH",
    `/api/tags/${numberedUuid(2)}`,
    GEAR_TAG,
    200,
    { name: "Outdoor gear" },
  ],
  ["GET", `/api/tags/${numberedUuid(2)}`, GEAR_TAG],
  [
    "PATCH",
    `/api/tags/${numberedUuid(1)}`,
    GLASSWARE_TAG,
    200,
    { name: "Fragile glassware" },
  ],
  ["GET", `/api/tags/${numberedUuid(1)}`, GLASSWARE_TAG],
];
