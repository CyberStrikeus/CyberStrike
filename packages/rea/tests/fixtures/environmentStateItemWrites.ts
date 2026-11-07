import type { TimedCaptureRow } from "./analysisView.js";
import type { JsonValue } from "../../src/domain/jsonValue.js";

type Entity = { readonly [key: string]: JsonValue };

const folder = (id: number, title: string): Entity => ({
  id,
  title,
  version: 1,
});

/** One seeded folder, a create a list shows after it, then one a list shows before that create by title, then a delete. */
export const CREATES_BY_TITLE_ROWS: readonly TimedCaptureRow[] = (() => {
  const rota = folder(1, "Lighthouse Rota");
  const pier = folder(2, "Scratch Pier 3");
  const meadow = folder(3, "Scratch Meadow 4");
  return [
    ["GET", "/api/folders", [rota]],
    ["GET", "/api/folders/1", rota],
    ["POST", "/api/folders", pier, 200, { title: "Scratch Pier 3" }],
    ["GET", "/api/folders/2", pier],
    ["GET", "/api/folders", [rota, pier]],
    ["POST", "/api/folders", meadow, 200, { title: "Scratch Meadow 4" }],
    ["GET", "/api/folders/3", meadow],
    ["GET", "/api/folders", [rota, meadow, pier]],
    ["DELETE", "/api/folders/2", { message: "Folder deleted" }, 200],
    ["GET", "/api/folders/2", { message: "folder not found" }, 404],
    ["GET", "/api/folders", [rota, meadow]],
  ];
})();

const LOCATIONS = [
  {
    id: "7d1c0b6e-0001-4000-8000-000000000001",
    name: "Garage",
    kind: "location",
  },
  {
    id: "7d1c0b6e-0002-4000-8000-000000000002",
    name: "Attic",
    kind: "location",
  },
];
const TAGS = [
  {
    id: "3b9f2a10-0001-4000-8000-000000000001",
    name: "Tools",
    color: "#aa0000",
  },
  {
    id: "3b9f2a10-0002-4000-8000-000000000002",
    name: "Winter",
    color: "#0000aa",
  },
];

/** An item as the application answers it: its parent location and tags spelled out from the ids a call sent. */
export const inventoryItem = (
  id: string,
  name: string,
  parent: Entity | null,
  tags: readonly Entity[],
): Entity => ({ id, name, parent, tags: [...tags] });

/** Item creates naming a parent location and tags by id, the first with none, the second with one of each. */
export const ITEM_REFERENCES_ROWS: readonly TimedCaptureRow[] = (() => {
  const seeded = inventoryItem(
    "5e5e0000-0001-4000-8000-000000000001",
    "Ladder",
    LOCATIONS[0]!,
    [],
  );
  const bare = inventoryItem(
    "5e5e0000-0002-4000-8000-000000000002",
    "Scratch box",
    null,
    [],
  );
  const filed = inventoryItem(
    "5e5e0000-0003-4000-8000-000000000003",
    "Scratch drill",
    LOCATIONS[1]!,
    [TAGS[0]!],
  );
  return [
    ["GET", "/api/locations", LOCATIONS],
    ["GET", `/api/locations/${LOCATIONS[0]!["id"] as string}`, LOCATIONS[0]!],
    ["GET", `/api/locations/${LOCATIONS[1]!["id"] as string}`, LOCATIONS[1]!],
    ["GET", "/api/tags", TAGS],
    ["GET", `/api/tags/${TAGS[0]!["id"] as string}`, TAGS[0]!],
    ["GET", `/api/tags/${TAGS[1]!["id"] as string}`, TAGS[1]!],
    ["GET", "/api/items", [seeded]],
    ["GET", `/api/items/${seeded["id"] as string}`, seeded],
    [
      "POST",
      "/api/items",
      bare,
      201,
      { name: "Scratch box", parentId: null, tagIds: [] },
    ],
    ["GET", `/api/items/${bare["id"] as string}`, bare],
    ["GET", "/api/items", [seeded, bare]],
    [
      "POST",
      "/api/items",
      filed,
      201,
      {
        name: "Scratch drill",
        parentId: LOCATIONS[1]!["id"]!,
        tagIds: [TAGS[0]!["id"]!],
      },
    ],
    ["GET", `/api/items/${filed["id"] as string}`, filed],
    ["GET", "/api/items", [seeded, bare, filed]],
  ];
})();

export const ITEM_LOCATIONS = LOCATIONS;
export const ITEM_TAGS = TAGS;

/** A feed entry with a `starred` flag a body-less action flips, and the instant it last changed. */
export const feedEntry = (
  id: number,
  starred: boolean,
  changedAt: string,
): Entity => ({
  id,
  title: `Entry ${String(id)}`,
  starred,
  changed_at: changedAt,
});

/** One entry starred, then unstarred, by the same body-less call, each read back after it. */
export const BOOKMARK_TOGGLE_ROWS: readonly TimedCaptureRow[] = (() => {
  const seeded = "2026-10-17T17:00:00.000000Z";
  const first = feedEntry(1, false, seeded);
  const second = feedEntry(2, false, seeded);
  const starred = feedEntry(1, true, "2026-10-17T18:00:03.120000Z");
  const unstarred = feedEntry(1, false, "2026-10-17T18:00:05.090000Z");
  return [
    ["GET", "/api/entries", [first, second]],
    ["GET", "/api/entries/1", first],
    ["GET", "/api/entries/2", second],
    ["PUT", "/api/entries/1/bookmark", "", 204],
    ["GET", "/api/entries/1", starred],
    ["PUT", "/api/entries/1/bookmark", "", 204],
    ["GET", "/api/entries/1", unstarred],
    ["GET", "/api/entries", [unstarred, second]],
  ];
})();

const ranked = (
  id: number,
  title: string,
  position: number | null,
): Entity => ({
  id,
  title,
  position,
});

/** Folders a list shows by `position`, the seed holding none: the first create lists after the seed's higher title, and once the seed is deleted later lists alone would also fit a sort by title. */
export const RANKED_AFTER_DELETE_ROWS: readonly TimedCaptureRow[] = (() => {
  const zulu = ranked(1, "Zulu Base", null);
  const bravo = ranked(2, "Bravo", 2);
  const charlie = ranked(3, "Charlie", 3);
  const able = ranked(4, "Able", 0);
  return [
    ["GET", "/api/folders", [zulu]],
    ["GET", "/api/folders/1", zulu],
    ["POST", "/api/folders", bravo, 200, { title: "Bravo", position: 2 }],
    ["GET", "/api/folders/2", bravo],
    ["GET", "/api/folders", [zulu, bravo]],
    ["DELETE", "/api/folders/1", { message: "Folder deleted" }, 200],
    ["GET", "/api/folders/1", { message: "folder not found" }, 404],
    ["GET", "/api/folders", [bravo]],
    ["POST", "/api/folders", charlie, 200, { title: "Charlie", position: 3 }],
    ["GET", "/api/folders/3", charlie],
    ["GET", "/api/folders", [bravo, charlie]],
    ["POST", "/api/folders", able, 200, { title: "Able", position: 0 }],
    ["GET", "/api/folders/4", able],
    ["GET", "/api/folders", [able, bravo, charlie]],
  ];
})();

/** Item creates: the first shows no parent at all, the second names one, the third sends `parentId: null` and stores none; lists show each item's id and name. */
export const ADDED_EMPTY_REFERENCE_ROWS: readonly TimedCaptureRow[] = (() => {
  const seeded = { id: "5e5e0000-0001-4000-8000-000000000001", name: "Ladder" };
  const loose = {
    id: "5e5e0000-0002-4000-8000-000000000002",
    name: "Scratch box",
  };
  const filed = {
    id: "5e5e0000-0003-4000-8000-000000000003",
    name: "Scratch drill",
    parent: LOCATIONS[1]!,
  };
  const cleared = {
    id: "5e5e0000-0004-4000-8000-000000000004",
    name: "Scratch lamp",
    parent: null,
  };
  const summary = (item: Entity): Entity => ({
    id: item["id"]!,
    name: item["name"]!,
  });
  return [
    ["GET", "/api/locations", LOCATIONS],
    ["GET", `/api/locations/${LOCATIONS[0]!["id"] as string}`, LOCATIONS[0]!],
    ["GET", `/api/locations/${LOCATIONS[1]!["id"] as string}`, LOCATIONS[1]!],
    ["GET", "/api/items", [seeded]],
    ["GET", `/api/items/${seeded.id}`, seeded],
    ["POST", "/api/items", loose, 201, { name: "Scratch box" }],
    ["GET", `/api/items/${loose.id}`, loose],
    ["GET", "/api/items", [seeded, loose].map(summary)],
    [
      "POST",
      "/api/items",
      filed,
      201,
      { name: "Scratch drill", parentId: LOCATIONS[1]!["id"]! },
    ],
    ["GET", `/api/items/${filed.id}`, filed],
    ["GET", "/api/items", [seeded, loose, filed].map(summary)],
    [
      "POST",
      "/api/items",
      cleared,
      201,
      { name: "Scratch lamp", parentId: null },
    ],
    ["GET", `/api/items/${cleared.id}`, cleared],
    ["GET", "/api/items", [seeded, loose, filed, cleared].map(summary)],
  ];
})();

/** Renames that keep collection order, which an ascending title sort would not replay, then a create a whole list could place by title. */
export const REFUTED_TITLE_SORT_ROWS: readonly TimedCaptureRow[] = (() => {
  const zulu = folder(1, "Zulu");
  const bravo = folder(2, "Bravo");
  const alpha = folder(3, "Alpha");
  const echo = folder(3, "Echo");
  const able = folder(1, "Able");
  const delta = folder(4, "Delta");
  return [
    ["GET", "/api/folders", [zulu, bravo, alpha]],
    ["GET", "/api/folders/1", zulu],
    ["GET", "/api/folders/2", bravo],
    ["GET", "/api/folders/3", alpha],
    ["PATCH", "/api/folders/3", echo, 200, { title: "Echo" }],
    ["GET", "/api/folders/3", echo],
    ["GET", "/api/folders", [zulu, bravo, echo]],
    ["PATCH", "/api/folders/1", able, 200, { title: "Able" }],
    ["GET", "/api/folders/1", able],
    ["GET", "/api/folders", [able, bravo, echo]],
    ["POST", "/api/folders", delta, 200, { title: "Delta" }],
    ["GET", "/api/folders/4", delta],
    ["GET", "/api/folders", [able, bravo, delta, echo]],
  ];
})();

/** A body-less bookmark action whose first call finds `starred` null, then flips the boolean it stored. */
export const NULL_THEN_STARRED_ROWS: readonly TimedCaptureRow[] = (() => {
  const seeded = {
    id: 1,
    title: "Entry 1",
    starred: null,
    changed_at: "2026-10-17T17:00:00.000000Z",
  };
  const other = {
    id: 2,
    title: "Entry 2",
    starred: false,
    changed_at: "2026-10-17T17:00:00.000000Z",
  };
  const starred = {
    ...seeded,
    starred: true,
    changed_at: "2026-10-17T18:00:03.120000Z",
  };
  const cleared = {
    ...seeded,
    starred: false,
    changed_at: "2026-10-17T18:00:05.090000Z",
  };
  return [
    ["GET", "/api/entries", [seeded, other]],
    ["GET", "/api/entries/1", seeded],
    ["GET", "/api/entries/2", other],
    ["PUT", "/api/entries/1/bookmark", "", 204],
    ["GET", "/api/entries/1", starred],
    ["PUT", "/api/entries/1/bookmark", "", 204],
    ["GET", "/api/entries/1", cleared],
    ["GET", "/api/entries", [cleared, other]],
  ];
})();
