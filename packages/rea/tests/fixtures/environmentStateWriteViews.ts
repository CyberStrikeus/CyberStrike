import type { TimedCaptureRow } from "./analysisView.js";
import { bookClock } from "./environmentStateWrites.js";

const tag = (id: number, name: string, slug: string, created: string) => ({
  id,
  slug,
  name,
  document_count: id === 1 ? 2 : 0,
  created,
});

const SEED_TAGS = [
  tag(1, "Lamp Oil", "lamp-oil", "2026-10-01T09:00:00Z"),
  tag(2, "Tide Tables", "tide-tables", "2026-10-01T10:00:00Z"),
];

/** A tag as a create answers it: without the document count reads show, and with its clock to the nanosecond. */
const answered = (id: number, name: string, slug: string, at: number) => ({
  id,
  slug,
  name,
  created: bookClock(at).replace("Z", ".123456789Z"),
});

/** Two tag creates whose answers lack the document count, and spell the clock otherwise, than the item read after each. */
export const READ_BACK_TAG_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/tags", SEED_TAGS],
  ["GET", "/api/tags/1", SEED_TAGS[0]!],
  ["GET", "/api/tags/2", SEED_TAGS[1]!],
  [
    "POST",
    "/api/tags",
    answered(3, "Harbour Notices", "harbour-notices", 3),
    201,
    { name: "Harbour Notices" },
  ],
  [
    "GET",
    "/api/tags/3",
    tag(3, "Harbour Notices", "harbour-notices", bookClock(3)),
  ],
  [
    "GET",
    "/api/tags",
    [...SEED_TAGS, tag(3, "Harbour Notices", "harbour-notices", bookClock(3))],
  ],
  [
    "POST",
    "/api/tags",
    answered(4, "Quarry Notes", "quarry-notes", 6),
    201,
    { name: "Quarry Notes" },
  ],
  ["GET", "/api/tags/4", tag(4, "Quarry Notes", "quarry-notes", bookClock(6))],
  [
    "GET",
    "/api/tags",
    [
      ...SEED_TAGS,
      tag(3, "Harbour Notices", "harbour-notices", bookClock(3)),
      tag(4, "Quarry Notes", "quarry-notes", bookClock(6)),
    ],
  ],
];

const label = (id: number, title: string, posts: number) => ({
  id,
  title,
  count: { posts },
});

/** Two label creates whose answers lack the post count only the list shows; no item read follows them. */
export const LISTED_LABEL_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/labels", [label(1, "Ferry", 3), label(2, "Pier", 1)]],
  [
    "POST",
    "/api/labels",
    { id: 3, title: "Mooring" },
    201,
    { title: "Mooring" },
  ],
  [
    "GET",
    "/api/labels",
    [label(1, "Ferry", 3), label(2, "Pier", 1), label(3, "Mooring", 0)],
  ],
  ["POST", "/api/labels", { id: 4, title: "Buoy" }, 201, { title: "Buoy" }],
  [
    "GET",
    "/api/labels",
    [
      label(1, "Ferry", 3),
      label(2, "Pier", 1),
      label(3, "Mooring", 0),
      label(4, "Buoy", 0),
    ],
  ],
];

/** Two renames that send the tag whole, its old slug included, which the application slugs anew from the name. */
export const STALE_SLUG_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/tags", SEED_TAGS],
  ["GET", "/api/tags/1", SEED_TAGS[0]!],
  ["GET", "/api/tags/2", SEED_TAGS[1]!],
  [
    "PUT",
    "/api/tags/1",
    {
      ...SEED_TAGS[0]!,
      name: "Lamp Oil Deliveries",
      slug: "lamp-oil-deliveries",
    },
    200,
    { ...SEED_TAGS[0]!, name: "Lamp Oil Deliveries" },
  ],
  [
    "GET",
    "/api/tags/1",
    {
      ...SEED_TAGS[0]!,
      name: "Lamp Oil Deliveries",
      slug: "lamp-oil-deliveries",
    },
  ],
  [
    "PUT",
    "/api/tags/2",
    {
      ...SEED_TAGS[1]!,
      name: "Spring Tide Tables",
      slug: "spring-tide-tables",
    },
    200,
    { ...SEED_TAGS[1]!, name: "Spring Tide Tables" },
  ],
  [
    "GET",
    "/api/tags/2",
    {
      ...SEED_TAGS[1]!,
      name: "Spring Tide Tables",
      slug: "spring-tide-tables",
    },
  ],
  [
    "GET",
    "/api/tags",
    [
      {
        ...SEED_TAGS[0]!,
        name: "Lamp Oil Deliveries",
        slug: "lamp-oil-deliveries",
      },
      {
        ...SEED_TAGS[1]!,
        name: "Spring Tide Tables",
        slug: "spring-tide-tables",
      },
    ],
  ],
];

const POST = {
  id: 1,
  title: "Winter rota",
  updated_at: "2026-10-01T09:00:00Z",
};

/** Two edits that send back the modification time they read, which the application stamps anew. */
export const RESTAMPED_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/posts", [POST]],
  ["GET", "/api/posts/1", POST],
  [
    "PUT",
    "/api/posts/1",
    { ...POST, title: "Winter rota v2", updated_at: bookClock(2) },
    200,
    { ...POST, title: "Winter rota v2" },
  ],
  [
    "GET",
    "/api/posts/1",
    { ...POST, title: "Winter rota v2", updated_at: bookClock(2) },
  ],
  [
    "PUT",
    "/api/posts/1",
    { ...POST, title: "Winter rota v3", updated_at: bookClock(4) },
    200,
    { ...POST, title: "Winter rota v3", updated_at: bookClock(2) },
  ],
  [
    "GET",
    "/api/posts/1",
    { ...POST, title: "Winter rota v3", updated_at: bookClock(4) },
  ],
  [
    "GET",
    "/api/posts",
    [{ ...POST, title: "Winter rota v3", updated_at: bookClock(4) }],
  ],
];

/** One save leaves its slug as sent; the other demonstrates regeneration, in either recording order. */
export const slugSaveRows = (
  derivedFirst: boolean,
  customSlug = false,
): readonly TimedCaptureRow[] => {
  const saved = { ...SEED_TAGS[0]!, ...(customSlug ? { slug: "custom" } : {}) };
  const renamed = {
    ...SEED_TAGS[1]!,
    name: "Spring Tide Tables",
    slug: "spring-tide-tables",
  };
  const saves: TimedCaptureRow[][] = [
    [
      ["PUT", "/api/tags/1", saved, 200, saved],
      ["GET", "/api/tags/1", saved],
    ],
    [
      [
        "PUT",
        "/api/tags/2",
        renamed,
        200,
        { ...SEED_TAGS[1]!, name: renamed.name },
      ],
      ["GET", "/api/tags/2", renamed],
    ],
  ];
  return [
    ...STALE_SLUG_ROWS.slice(0, 3),
    ...saves[derivedFirst ? 1 : 0]!,
    ...saves[derivedFirst ? 0 : 1]!,
    ["GET", "/api/tags", [saved, renamed]],
  ];
};

/** A slug-only PATCH and a save that demonstrates deriving the slug from the name. */
export const slugOnlySaveRows = (
  derivedFirst: boolean,
  changed: boolean,
): readonly TimedCaptureRow[] =>
  slugSaveRows(derivedFirst, changed).map(
    ([method, path, body = null, status, request, ...rest]): TimedCaptureRow =>
      method === "PUT"
        ? [
            "PATCH",
            path,
            body,
            status ?? 200,
            path === "/api/tags/1"
              ? { slug: changed ? "custom" : "lamp-oil" }
              : request,
            ...rest,
          ]
        : [method, path, body, status ?? 200, request, ...rest],
  );

/** One whole-object save falls in its held clock's second; the other visibly stamps a fresh clock. */
export const clockSaveRows = (
  derivedFirst: boolean,
): readonly TimedCaptureRow[] => {
  const heldIndex = derivedFirst ? 5 : 3;
  const freshIndex = derivedFirst ? 3 : 5;
  const held = { ...POST, updated_at: bookClock(heldIndex) };
  const fresh = { ...POST, id: 2 };
  const saved = { ...held, title: "Same-second save" };
  const stamped = {
    ...fresh,
    title: "Fresh save",
    updated_at: bookClock(freshIndex),
  };
  const saves: TimedCaptureRow[][] = [
    [
      ["PUT", "/api/posts/1", saved, 200, saved],
      ["GET", "/api/posts/1", saved],
    ],
    [
      ["PUT", "/api/posts/2", stamped, 200, { ...fresh, title: stamped.title }],
      ["GET", "/api/posts/2", stamped],
    ],
  ];
  return [
    ["GET", "/api/posts", [held, fresh]],
    ["GET", "/api/posts/1", held],
    ["GET", "/api/posts/2", fresh],
    ...saves[derivedFirst ? 1 : 0]!,
    ...saves[derivedFirst ? 0 : 1]!,
    ["GET", "/api/posts", [saved, stamped]],
  ];
};
