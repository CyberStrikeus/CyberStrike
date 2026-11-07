import type { JsonValue } from "../../src/domain/jsonValue.js";
import type { TimedCaptureRow } from "./analysisView.js";

type Entity = Record<string, JsonValue>;

const contact = (id: number, name: string): Entity => ({
  id,
  name,
  deleted: false,
});

const page = (list: readonly Entity[]): Entity => ({
  total: list.length,
  list: [...list],
});

const ADA = contact(1, "Ada Finch");
const MINA = contact(2, "Mina Okafor");
const RUI = contact(3, "Rui Castellanos");

/** An initial trash-style list includes an entity already marked deleted. */
export const INITIAL_TRASH_ROWS: readonly TimedCaptureRow[] = [
  [
    "GET",
    "/api/contacts?maxSize=20&offset=0",
    page([ADA, MINA, { ...RUI, deleted: true }]),
  ],
  ["GET", "/api/contacts/1", ADA],
  ["GET", "/api/contacts/2", MINA],
  ["GET", "/api/contacts/3", { ...RUI, deleted: true }],
];

/** A contact deleted, then read by id as EspoCRM answers for soft-deleted records: still found, marked `deleted`. */
export const SOFT_DELETED_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/contacts?maxSize=20&offset=0", page([ADA, MINA, RUI])],
  ["GET", "/api/contacts/1", ADA],
  ["GET", "/api/contacts/2", MINA],
  ["GET", "/api/contacts/3", RUI],
  ["DELETE", "/api/contacts/2", true],
  ["GET", "/api/contacts/2", { ...MINA, deleted: true }],
  ["DELETE", "/api/contacts/3", true],
  ["GET", "/api/contacts/3", { ...RUI, deleted: true }],
];

/** Contacts deleted by calls that answer with the record already marked deleted, read back so too. */
export const SOFT_DELETED_ANSWER_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/contacts?maxSize=20&offset=0", page([ADA, MINA, RUI])],
  ["GET", "/api/contacts/1", ADA],
  ["GET", "/api/contacts/2", MINA],
  ["GET", "/api/contacts/3", RUI],
  ["DELETE", "/api/contacts/2", { ...MINA, deleted: true }],
  ["GET", "/api/contacts/2", { ...MINA, deleted: true }],
  ["DELETE", "/api/contacts/3", { ...RUI, deleted: true }],
  ["GET", "/api/contacts/3", { ...RUI, deleted: true }],
];

/** Contacts deleted by calls that answer with the record as it was, then read back marked deleted. */
export const STALE_DELETE_ANSWER_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/contacts?maxSize=20&offset=0", page([ADA, MINA, RUI])],
  ["GET", "/api/contacts/1", ADA],
  ["GET", "/api/contacts/2", MINA],
  ["GET", "/api/contacts/3", RUI],
  ["DELETE", "/api/contacts/2", MINA],
  ["GET", "/api/contacts/2", { ...MINA, deleted: true }],
  ["DELETE", "/api/contacts/3", RUI],
  ["GET", "/api/contacts/3", { ...RUI, deleted: true }],
];

/** Contacts removed by one bulk call that answers them as they were, then read back marked deleted. */
export const STALE_BULK_DELETE_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/contacts?maxSize=20&offset=0", page([ADA, MINA, RUI])],
  ["GET", "/api/contacts/1", ADA],
  ["GET", "/api/contacts/2", MINA],
  ["GET", "/api/contacts/3", RUI],
  ["DELETE", "/api/contacts", [MINA, RUI], 200, [{ id: 2 }, { id: 3 }]],
  ["GET", "/api/contacts/2", { ...MINA, deleted: true }],
  ["GET", "/api/contacts/3", { ...RUI, deleted: true }],
];

/** Live contacts that omit `deleted`, one deleted and read back only with a query showing it marked, then a list without it. */
export const OMITTED_FLAG_ROWS: readonly TimedCaptureRow[] = (() => {
  const live = (entity: Entity): Entity => {
    const { deleted: _deleted, ...rest } = entity;
    return rest;
  };
  const [ada, mina, rui] = [live(ADA), live(MINA), live(RUI)];
  return [
    ["GET", "/api/contacts?maxSize=20&offset=0", page([ada, mina, rui])],
    ["GET", "/api/contacts?maxSize=2&offset=0", page([ada, mina])],
    ["GET", "/api/contacts/1", ada],
    ["GET", "/api/contacts/2", mina],
    ["DELETE", "/api/contacts/2", true],
    ["GET", "/api/contacts/2?_=1761520000", { ...mina, deleted: true }],
    ["GET", "/api/contacts?maxSize=50&offset=0", page([ada, rui])],
  ];
})();

/** The same deletes read back only with a query, as a client that adds a cache-busting parameter does. */
export const SOFT_DELETED_QUERY_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/contacts?maxSize=20&offset=0", page([ADA, MINA, RUI])],
  ["GET", "/api/contacts/1", ADA],
  ["GET", "/api/contacts/2", MINA],
  ["GET", "/api/contacts/3", RUI],
  ["DELETE", "/api/contacts/2", true],
  ["GET", "/api/contacts/2?_=1761520000", { ...MINA, deleted: true }],
  ["DELETE", "/api/contacts/3", true],
  ["GET", "/api/contacts/3?_=1761520001", { ...RUI, deleted: true }],
];

/** A held contact read back marked deleted though no delete of it was recorded, then a list without it after another delete. */
export const GHOST_DELETED_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/contacts?maxSize=20&offset=0", page([ADA, MINA, RUI])],
  ["GET", "/api/contacts?maxSize=2&offset=0", page([ADA, MINA])],
  ["GET", "/api/contacts/1", ADA],
  ["GET", "/api/contacts/2", MINA],
  ["GET", "/api/contacts/3", RUI],
  ["DELETE", "/api/contacts/3", true],
  ["GET", "/api/contacts/2", { ...MINA, deleted: true }],
  ["GET", "/api/contacts?maxSize=50&offset=0", page([ADA])],
];

/** Contacts deleted, then listed with a page size named `maxSize` other than the initial list's. */
export const MAX_SIZE_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/contacts?maxSize=20&offset=0", page([ADA, MINA, RUI])],
  ["GET", "/api/contacts?maxSize=2&offset=0", page([ADA, MINA])],
  ["GET", "/api/contacts/1", ADA],
  ["DELETE", "/api/contacts/2", true],
  ["GET", "/api/contacts?maxSize=50&offset=0", page([ADA, RUI])],
  ["DELETE", "/api/contacts/3", true],
  ["GET", "/api/contacts?maxSize=50&offset=0", page([ADA])],
];

const task = (id: number, title: string, extra: Entity = {}): Entity => ({
  id,
  title,
  done: false,
  ...extra,
});

/** Its subscription: shown only on tasks created while recording, as Vikunja subscribes their creator. */
const subscribed = (id: number): Entity => ({
  subscription: { id: 100 + id, entity: "task", entity_id: id },
});

/**
 * Seeded tasks without a `subscription`, created tasks whose item reads show one, and updates of the created tasks,
 * whose answers show it too.
 */
export const LATER_FIELD_ROWS: readonly TimedCaptureRow[] = (() => {
  const seed = task(1, "Trim the wicks");
  const first = task(2, "Order lamp oil");
  const second = task(3, "Paint the rail");
  const created = (entity: Entity) => ({
    ...entity,
    ...subscribed(Number(entity["id"])),
  });
  const done = (entity: Entity) => ({ ...created(entity), done: true });
  return [
    ["GET", "/api/tasks", [seed]],
    ["GET", "/api/tasks/1", seed],
    ["POST", "/api/tasks", first, 201, { title: "Order lamp oil" }],
    ["GET", "/api/tasks/2", created(first)],
    ["GET", "/api/tasks", [seed, first]],
    ["POST", "/api/tasks", second, 201, { title: "Paint the rail" }],
    ["GET", "/api/tasks/3", created(second)],
    ["GET", "/api/tasks", [seed, first, second]],
    ["PATCH", "/api/tasks/2", done(first), 200, { done: true }],
    ["GET", "/api/tasks/2", done(first)],
    ["PATCH", "/api/tasks/3", done(second), 200, { done: true }],
    ["GET", "/api/tasks/3", done(second)],
    [
      "GET",
      "/api/tasks",
      [seed, { ...first, done: true }, { ...second, done: true }],
    ],
  ];
})();

/** The same seeded and created tasks, then one bulk update marking both created tasks done, whose answer shows their subscriptions. */
export const LATER_BULK_ROWS: readonly TimedCaptureRow[] = (() => {
  const seed = task(1, "Trim the wicks");
  const [first, second] = [
    task(2, "Order lamp oil"),
    task(3, "Paint the rail"),
  ];
  const created = (entity: Entity) => ({
    ...entity,
    ...subscribed(Number(entity["id"])),
  });
  const done = (entity: Entity) => ({ ...created(entity), done: true });
  return [
    ["GET", "/api/tasks", [seed]],
    ["GET", "/api/tasks/1", seed],
    ["POST", "/api/tasks", first, 201, { title: "Order lamp oil" }],
    ["GET", "/api/tasks/2", created(first)],
    ["POST", "/api/tasks", second, 201, { title: "Paint the rail" }],
    ["GET", "/api/tasks/3", created(second)],
    ["GET", "/api/tasks", [seed, first, second]],
    [
      "PATCH",
      "/api/tasks",
      [done(first), done(second)],
      200,
      [
        { id: 2, done: true },
        { id: 3, done: true },
      ],
    ],
    ["GET", "/api/tasks/2", done(first)],
    ["GET", "/api/tasks/3", done(second)],
    [
      "GET",
      "/api/tasks",
      [seed, { ...first, done: true }, { ...second, done: true }],
    ],
  ];
})();

/** A recorded bulk update of a created task and a seeded one, whose answer shows the subscription on the created task only. */
export const LATER_MIXED_BULK_ROWS: readonly TimedCaptureRow[] = (() => {
  const seed = task(1, "Trim the wicks");
  const first = task(2, "Order lamp oil");
  const created = { ...first, ...subscribed(2) };
  const done = { ...created, done: true };
  const seedDone = { ...seed, done: true };
  return [
    ["GET", "/api/tasks", [seed]],
    ["GET", "/api/tasks/1", seed],
    ["POST", "/api/tasks", first, 201, { title: "Order lamp oil" }],
    ["GET", "/api/tasks/2", created],
    ["GET", "/api/tasks", [seed, first]],
    [
      "PATCH",
      "/api/tasks",
      [done, seedDone],
      200,
      [
        { id: 2, done: true },
        { id: 1, done: true },
      ],
    ],
    ["GET", "/api/tasks/2", done],
    ["GET", "/api/tasks/1", seedDone],
    ["GET", "/api/tasks", [seedDone, { ...first, done: true }]],
  ];
})();
