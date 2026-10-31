import type { TimedCaptureRow } from "./analysisView.js";
import { bookClock } from "./environmentStateWrites.js";
import type { JsonValue } from "../../src/domain/jsonValue.js";

type Entity = { readonly [key: string]: JsonValue };

/** Two contact updates, the second sending only the email the first sent with a name and a city. */
export const FEWER_MEMBERS_ROWS: readonly TimedCaptureRow[] = (() => {
  const contact = (
    id: number,
    name: string,
    city: string,
    email: string,
  ): Entity => ({ id, name, city, email });
  const [ada, mina] = [
    contact(1, "Ada Finch", "Porto", "ada@example.test"),
    contact(2, "Mina Okafor", "Accra", "mina@example.test"),
  ];
  const adaMoved = contact(
    1,
    "Ada Finch-Lowe",
    "Lisbon",
    "ada.lowe@example.test",
  );
  const minaMail = { ...mina, email: "mina.o@example.test" };
  return [
    ["GET", "/api/contacts", [ada, mina]],
    ["GET", "/api/contacts/1", ada],
    ["GET", "/api/contacts/2", mina],
    [
      "PUT",
      "/api/contacts/1",
      adaMoved,
      200,
      {
        name: "Ada Finch-Lowe",
        city: "Lisbon",
        email: "ada.lowe@example.test",
      },
    ],
    ["GET", "/api/contacts/1", adaMoved],
    ["PUT", "/api/contacts/2", minaMail, 200, { email: "mina.o@example.test" }],
    ["GET", "/api/contacts/2", minaMail],
    ["GET", "/api/contacts", [adaMoved, minaMail]],
  ];
})();

/** Bundle creates: the first sends its order, the second leaves it to the application, which numbers it next. */
export const NUMBERED_UNLESS_SENT_ROWS: readonly TimedCaptureRow[] = (() => {
  const bundle = (id: number, name: string, order: number): Entity => ({
    id,
    name,
    order,
  });
  const [alpha, bravo] = [bundle(1, "Alpha", 0), bundle(2, "Bravo", 1)];
  const [charlie, delta] = [bundle(3, "Charlie", 5), bundle(4, "Delta", 6)];
  return [
    ["GET", "/api/bundles", [alpha, bravo]],
    ["GET", "/api/bundles/1", alpha],
    ["GET", "/api/bundles/2", bravo],
    ["POST", "/api/bundles", charlie, 201, { name: "Charlie", order: 5 }],
    ["GET", "/api/bundles/3", charlie],
    ["GET", "/api/bundles", [alpha, bravo, charlie]],
    ["POST", "/api/bundles", delta, 201, { name: "Delta" }],
    ["GET", "/api/bundles/4", delta],
    ["GET", "/api/bundles", [alpha, bravo, charlie, delta]],
  ];
})();

/** Tasks marked done: each answer stamps `done_at` to the nanosecond, the read after it to the second. */
export const DONE_CLOCK_ROWS: readonly TimedCaptureRow[] = (() => {
  const task = (id: number, title: string): Entity => ({
    id,
    title,
    done: false,
    done_at: "0001-01-01T00:00:00Z",
  });
  const [trim, oil] = [task(1, "Trim the wicks"), task(2, "Order lamp oil")];
  const done = (entity: Entity, at: number, fraction: string): Entity => ({
    ...entity,
    done: true,
    done_at: bookClock(at).replace("Z", fraction),
  });
  return [
    ["GET", "/api/tasks", [trim, oil]],
    ["GET", "/api/tasks/1", trim],
    ["GET", "/api/tasks/2", oil],
    [
      "PATCH",
      "/api/tasks/1",
      done(trim, 3, ".001234567Z"),
      200,
      { done: true },
    ],
    ["GET", "/api/tasks/1", done(trim, 3, "Z")],
    ["PATCH", "/api/tasks/2", done(oil, 5, ".002345678Z"), 200, { done: true }],
    ["GET", "/api/tasks/2", done(oil, 5, "Z")],
  ];
})();

/** Tasks marked done, each answer to the nanosecond: the first read spells `done_at` to the millisecond, the second to the second. */
export const DONE_MIXED_ROWS: readonly TimedCaptureRow[] = DONE_CLOCK_ROWS.map(
  (row, index) =>
    index === 4 && row[0] === "GET"
      ? [
          row[0],
          row[1],
          {
            ...(row[2] as Entity),
            done_at: String((row[2] as Entity)["done_at"]).replace(
              "Z",
              ".001Z",
            ),
          },
        ]
      : row,
);

/** Bundles numbered unless an order is sent: 2 left out, 9 and 4 sent, the 9 deleted, then one left out the application numbers 5. */
export const SENT_THEN_DELETED_ROWS: readonly TimedCaptureRow[] = (() => {
  const bundle = (id: number, name: string, order: number): Entity => ({
    id,
    name,
    order,
  });
  const seeds = [bundle(1, "Alpha", 0), bundle(2, "Bravo", 1)];
  const [charlie, delta, echo, foxtrot] = [
    bundle(3, "Charlie", 2),
    bundle(4, "Delta", 9),
    bundle(5, "Echo", 4),
    bundle(6, "Foxtrot", 5),
  ];
  return [
    ["GET", "/api/bundles", seeds],
    ["GET", "/api/bundles/1", seeds[0]!],
    ["POST", "/api/bundles", charlie, 201, { name: "Charlie" }],
    ["GET", "/api/bundles/3", charlie],
    ["GET", "/api/bundles", [...seeds, charlie]],
    ["POST", "/api/bundles", delta, 201, { name: "Delta", order: 9 }],
    ["GET", "/api/bundles/4", delta],
    ["GET", "/api/bundles", [...seeds, charlie, delta]],
    ["POST", "/api/bundles", echo, 201, { name: "Echo", order: 4 }],
    ["GET", "/api/bundles/5", echo],
    ["GET", "/api/bundles", [...seeds, charlie, delta, echo]],
    ["DELETE", "/api/bundles/4", null, 204],
    ["GET", "/api/bundles", [...seeds, charlie, echo]],
    ["POST", "/api/bundles", foxtrot, 201, { name: "Foxtrot" }],
    ["GET", "/api/bundles/6", foxtrot],
    ["GET", "/api/bundles", [...seeds, charlie, echo, foxtrot]],
  ];
})();

/** Tasks marked done: each answer stamps `done_at` to the millisecond in `Z`, the read after it to the second in `+00:00`. */
export const DONE_ZONE_ROWS: readonly TimedCaptureRow[] = (() => {
  const task = (id: number, title: string): Entity => ({
    id,
    title,
    done: false,
    done_at: "0001-01-01T00:00:00Z",
  });
  const [trim, oil] = [task(1, "Trim the wicks"), task(2, "Order lamp oil")];
  const done = (entity: Entity, at: number, suffix: string): Entity => ({
    ...entity,
    done: true,
    done_at: bookClock(at).replace("Z", suffix),
  });
  return [
    ["GET", "/api/tasks", [trim, oil]],
    ["GET", "/api/tasks/1", trim],
    ["GET", "/api/tasks/2", oil],
    ["PATCH", "/api/tasks/1", done(trim, 3, ".123Z"), 200, { done: true }],
    ["GET", "/api/tasks/1", done(trim, 3, "+00:00")],
    ["PATCH", "/api/tasks/2", done(oil, 5, ".234Z"), 200, { done: true }],
    ["GET", "/api/tasks/2", done(oil, 5, "+00:00")],
  ];
})();

/** Tag PUTs: one leaves the owner out and the application clears it, the other sends it and keeps it. */
export const PUT_CLEARS_ROWS: readonly TimedCaptureRow[] = (() => {
  const tag = (id: number, name: string, owner: number | null): Entity => ({
    id,
    name,
    owner,
  });
  const [inbox, bills] = [tag(1, "Inbox", 3), tag(2, "Bills", 3)];
  const [triage, paid] = [tag(1, "Triage", null), tag(2, "Paid", 3)];
  return [
    ["GET", "/api/tags", [inbox, bills]],
    ["GET", "/api/tags/1", inbox],
    ["GET", "/api/tags/2", bills],
    ["PUT", "/api/tags/1", triage, 200, { name: "Triage" }],
    ["GET", "/api/tags/1", triage],
    ["PUT", "/api/tags/2", paid, 200, { name: "Paid", owner: 3 }],
    ["GET", "/api/tags/2", paid],
    ["GET", "/api/tags", [triage, paid]],
  ];
})();

/** Bundle creates the other way round: the first leaves its order to the application, the second sends one. */
export const NUMBERED_THEN_SENT_ROWS: readonly TimedCaptureRow[] = (() => {
  const bundle = (id: number, name: string, order: number): Entity => ({
    id,
    name,
    order,
  });
  const [alpha, bravo] = [bundle(1, "Alpha", 0), bundle(2, "Bravo", 1)];
  const [charlie, delta] = [bundle(3, "Charlie", 2), bundle(4, "Delta", 9)];
  return [
    ["GET", "/api/bundles", [alpha, bravo]],
    ["GET", "/api/bundles/1", alpha],
    ["GET", "/api/bundles/2", bravo],
    ["POST", "/api/bundles", charlie, 201, { name: "Charlie" }],
    ["GET", "/api/bundles/3", charlie],
    ["GET", "/api/bundles", [alpha, bravo, charlie]],
    ["POST", "/api/bundles", delta, 201, { name: "Delta", order: 9 }],
    ["GET", "/api/bundles/4", delta],
    ["GET", "/api/bundles", [alpha, bravo, charlie, delta]],
  ];
})();

/** Two name-only tag PUTs, one keeping the owner and one clearing it, in the given order. */
const ownerPuts = (clearsFirst: boolean): readonly TimedCaptureRow[] => {
  const tag = (id: number, name: string, owner: number | null): Entity => ({
    id,
    name,
    owner,
  });
  const [inbox, bills] = [tag(1, "Inbox", 3), tag(2, "Bills", 3)];
  const [triage, paid] = [
    tag(1, "Triage", clearsFirst ? null : 3),
    tag(2, "Paid", clearsFirst ? 3 : null),
  ];
  return [
    ["GET", "/api/tags", [inbox, bills]],
    ["GET", "/api/tags/1", inbox],
    ["GET", "/api/tags/2", bills],
    ["PUT", "/api/tags/1", triage, 200, { name: "Triage" }],
    ["GET", "/api/tags/1", triage],
    ["PUT", "/api/tags/2", paid, 200, { name: "Paid" }],
    ["GET", "/api/tags/2", paid],
    ["GET", "/api/tags", [triage, paid]],
  ];
};

/** A name-only PUT that keeps the owner, then one that clears it. */
export const KEPT_THEN_CLEARED_ROWS = ownerPuts(false);

/** Two name-only tag PUTs where one answers only `id` and `name` and its read shows the owner kept, and the other clears it. */
const omittedOwnerPuts = (omitsFirst: boolean): readonly TimedCaptureRow[] => {
  const tag = (id: number, name: string, owner: number | null): Entity => ({
    id,
    name,
    owner,
  });
  const [inbox, bills] = [tag(1, "Inbox", 3), tag(2, "Bills", 3)];
  const kept = (entity: Entity, name: string) => ({ ...entity, name });
  const answered = (entity: Entity) => ({
    id: entity["id"]!,
    name: entity["name"]!,
  });
  const [triage, paid] = omitsFirst
    ? [kept(inbox, "Triage"), tag(2, "Paid", null)]
    : [tag(1, "Triage", null), kept(bills, "Paid")];
  const answer = (entity: Entity, omits: boolean) =>
    omits ? answered(entity) : entity;
  return [
    ["GET", "/api/tags", [inbox, bills]],
    ["GET", "/api/tags/1", inbox],
    ["GET", "/api/tags/2", bills],
    ["PUT", "/api/tags/1", answer(triage, omitsFirst), 200, { name: "Triage" }],
    ["GET", "/api/tags/1", triage],
    ["PUT", "/api/tags/2", answer(paid, !omitsFirst), 200, { name: "Paid" }],
    ["GET", "/api/tags/2", paid],
    ["GET", "/api/tags", [triage, paid]],
  ];
};

/** A name-only PUT answered without the owner its read shows kept, then one that clears it. */
export const OMITTED_KEPT_THEN_CLEARED_ROWS = omittedOwnerPuts(true);

/** A name-only PUT that clears the owner, then one answered without the owner its read shows kept. */
export const CLEARED_THEN_OMITTED_KEPT_ROWS = omittedOwnerPuts(false);

/** A name-only PUT that clears the owner, then one that keeps it. */
export const CLEARED_THEN_KEPT_ROWS = ownerPuts(true);

/** Bundle creates: the first sends order 5, the second leaves it out and the application stores 5, the third leaves it out and gets 6. */
export const DEFAULT_THEN_NUMBERED_ROWS: readonly TimedCaptureRow[] = (() => {
  const bundle = (id: number, name: string, order: number): Entity => ({
    id,
    name,
    order,
  });
  const [alpha, bravo] = [bundle(1, "Alpha", 0), bundle(2, "Bravo", 1)];
  const [charlie, delta, echo] = [
    bundle(3, "Charlie", 5),
    bundle(4, "Delta", 5),
    bundle(5, "Echo", 6),
  ];
  return [
    ["GET", "/api/bundles", [alpha, bravo]],
    ["GET", "/api/bundles/1", alpha],
    ["GET", "/api/bundles/2", bravo],
    ["POST", "/api/bundles", charlie, 201, { name: "Charlie", order: 5 }],
    ["GET", "/api/bundles/3", charlie],
    ["GET", "/api/bundles", [alpha, bravo, charlie]],
    ["POST", "/api/bundles", delta, 201, { name: "Delta" }],
    ["GET", "/api/bundles/4", delta],
    ["GET", "/api/bundles", [alpha, bravo, charlie, delta]],
    ["POST", "/api/bundles", echo, 201, { name: "Echo" }],
    ["GET", "/api/bundles/5", echo],
    ["GET", "/api/bundles", [alpha, bravo, charlie, delta, echo]],
  ];
})();

/** Tasks marked done, each answer to the nanosecond and each read after it to the microsecond. */
export const DONE_MICRO_ROWS: readonly TimedCaptureRow[] = DONE_CLOCK_ROWS.map(
  (row, index) => {
    const answer = DONE_CLOCK_ROWS[index - 1]?.[2] as Entity | undefined;
    return row[0] === "GET" && (index === 4 || index === 6)
      ? [
          row[0],
          row[1],
          {
            ...(row[2] as Entity),
            done_at: String(answer!["done_at"]).replace(
              /(\.\d{6})\d{3}Z$/u,
              "$1Z",
            ),
          },
        ]
      : row;
  },
);

/** Tag PUTs whose owner is a user object, in the given order: one names the owner by `ownerId`, the other leaves it out and the application clears it. */
const ownerReferencePuts = (
  clearsFirst: boolean,
): readonly TimedCaptureRow[] => {
  const [ada, bo] = [
    { id: 3, name: "Ada" },
    { id: 4, name: "Bo" },
  ];
  const tag = (id: number, name: string, owner: Entity | null): Entity => ({
    id,
    name,
    owner,
  });
  const [inbox, bills] = [tag(1, "Inbox", bo), tag(2, "Bills", bo)];
  const named = tag(clearsFirst ? 2 : 1, clearsFirst ? "Paid" : "Triage", ada);
  const cleared = tag(
    clearsFirst ? 1 : 2,
    clearsFirst ? "Triage" : "Paid",
    null,
  );
  const put = (entity: Entity): TimedCaptureRow[] => [
    [
      "PUT",
      `/api/tags/${String(entity["id"])}`,
      entity,
      200,
      entity["owner"] === null
        ? { name: entity["name"]! }
        : { name: entity["name"]!, ownerId: 3 },
    ],
    ["GET", `/api/tags/${String(entity["id"])}`, entity],
  ];
  const [first, second] = clearsFirst ? [cleared, named] : [named, cleared];
  return [
    ["GET", "/api/users", [ada, bo]],
    ["GET", "/api/users/3", ada],
    ["GET", "/api/users/4", bo],
    ["GET", "/api/tags", [inbox, bills]],
    ["GET", "/api/tags/1", inbox],
    ["GET", "/api/tags/2", bills],
    ...put(first),
    ...put(second),
    [
      "GET",
      "/api/tags",
      [first, second].sort((a, b) => Number(a["id"]) - Number(b["id"])),
    ],
  ];
};

/** A PUT naming the owner by `ownerId`, then one that leaves it out and clears it. */
export const OWNER_NAMED_THEN_CLEARED_ROWS = ownerReferencePuts(false);

/** A PUT that leaves the owner out and clears it, then one naming it by `ownerId`. */
export const OWNER_CLEARED_THEN_NAMED_ROWS = ownerReferencePuts(true);

/** Bundle creates with a string order: the first leaves it out and the application numbers it "2", the second sends "" and stores it. */
export const NUMBERED_THEN_BLANK_ROWS: readonly TimedCaptureRow[] = (() => {
  const bundle = (id: number, name: string, order: string): Entity => ({
    id,
    name,
    order,
  });
  const [alpha, bravo] = [bundle(1, "Alpha", "0"), bundle(2, "Bravo", "1")];
  const [charlie, delta] = [bundle(3, "Charlie", "2"), bundle(4, "Delta", "")];
  return [
    ["GET", "/api/bundles", [alpha, bravo]],
    ["GET", "/api/bundles/1", alpha],
    ["GET", "/api/bundles/2", bravo],
    ["POST", "/api/bundles", charlie, 201, { name: "Charlie" }],
    ["GET", "/api/bundles/3", charlie],
    ["GET", "/api/bundles", [alpha, bravo, charlie]],
    ["POST", "/api/bundles", delta, 201, { name: "Delta", order: "" }],
    ["GET", "/api/bundles/4", delta],
    ["GET", "/api/bundles", [alpha, bravo, charlie, delta]],
  ];
})();

/** Bundle creates: the first sends order 9 and is deleted, the second leaves it out and the application numbers it 2. */
export const SENT_DELETED_THEN_NUMBERED_ROWS: readonly TimedCaptureRow[] =
  (() => {
    const bundle = (id: number, name: string, order: number): Entity => ({
      id,
      name,
      order,
    });
    const [alpha, bravo] = [bundle(1, "Alpha", 0), bundle(2, "Bravo", 1)];
    const [charlie, delta] = [bundle(3, "Charlie", 9), bundle(4, "Delta", 2)];
    return [
      ["GET", "/api/bundles", [alpha, bravo]],
      ["GET", "/api/bundles/1", alpha],
      ["GET", "/api/bundles/2", bravo],
      ["POST", "/api/bundles", charlie, 201, { name: "Charlie", order: 9 }],
      ["GET", "/api/bundles/3", charlie],
      ["GET", "/api/bundles", [alpha, bravo, charlie]],
      ["DELETE", "/api/bundles/3", null, 204],
      ["GET", "/api/bundles", [alpha, bravo]],
      ["POST", "/api/bundles", delta, 201, { name: "Delta" }],
      ["GET", "/api/bundles/4", delta],
      ["GET", "/api/bundles", [alpha, bravo, delta]],
    ];
  })();

/** Bundles numbered per project: a create in project 1 sends order 9, one in project 2 leaves it out and gets 1. */
export const SENT_IN_ANOTHER_PROJECT_ROWS: readonly TimedCaptureRow[] = (() => {
  const bundle = (id: number, name: string, order: number): Entity => ({
    id,
    name,
    order,
  });
  const [alpha, bravo] = [bundle(1, "Alpha", 0), bundle(2, "Bravo", 0)];
  const [charlie, delta] = [bundle(3, "Charlie", 9), bundle(4, "Delta", 1)];
  return [
    ["GET", "/api/projects/1/bundles", [alpha]],
    ["GET", "/api/projects/1/bundles/1", alpha],
    ["GET", "/api/projects/2/bundles", [bravo]],
    ["GET", "/api/projects/2/bundles/2", bravo],
    [
      "POST",
      "/api/projects/1/bundles",
      charlie,
      201,
      { name: "Charlie", order: 9 },
    ],
    ["GET", "/api/projects/1/bundles/3", charlie],
    ["GET", "/api/projects/1/bundles", [alpha, charlie]],
    ["POST", "/api/projects/2/bundles", delta, 201, { name: "Delta" }],
    ["GET", "/api/projects/2/bundles/4", delta],
    ["GET", "/api/projects/2/bundles", [bravo, delta]],
  ];
})();
