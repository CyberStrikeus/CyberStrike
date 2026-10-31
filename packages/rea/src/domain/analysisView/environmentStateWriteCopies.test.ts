import { describe, expect, it } from "vitest";

import type { JsonObject, StateEntity } from "./environmentStateRules.js";
import {
  explainCreate,
  explainUpdate,
} from "./environmentStateWriteExplain.js";

const START = Date.UTC(2026, 9, 18, 20, 48, 0);
const ACCOUNT = "6ad52f2f4e2aff8fd";

/** An entity the state holds in its type's only collection. */
const held = (type: string, fields: JsonObject): StateEntity => ({
  type,
  collection: type,
  id: String(fields.id),
  fields,
  view_fields: [],
  record_ordinals: [],
});

const lookup =
  (...entities: readonly StateEntity[]) =>
  (id: string): StateEntity[] =>
    entities.filter((entity) => entity.id === id);

const ACCOUNTS = lookup(
  held("/api/v1/Account", { id: ACCOUNT, name: "Copperfield Annex" }),
);

const create = (
  entity: JsonObject,
  body: JsonObject,
  named: (id: string) => readonly StateEntity[] = ACCOUNTS,
) =>
  explainCreate({
    entity,
    call: { path: "/tasks", pathValues: new Map(), body },
    idField: "id",
    startMs: START,
    collection: [],
    type: [],
    named,
  }).body;

describe("members a created field derives from", () => {
  it("accepts a reference only with its recorded value when a field named after it repeats the named entity's name", () => {
    const body = create(
      {
        id: 9,
        name: "Task",
        parentId: ACCOUNT,
        parentName: "Copperfield Annex",
      },
      { name: "Task", parentId: ACCOUNT },
    );
    expect(body.accepted).toEqual(["name"]);
    expect(body.fixed).toEqual([{ member: "parentId", sent: ACCOUNT }]);
  });

  it("accepts a date only with its recorded value when a field named after it lies a time zone from it", () => {
    const body = create(
      {
        id: 9,
        name: "Task",
        dateEndDate: "2026-11-30",
        dateEnd: "2026-12-01 00:00:00",
      },
      { name: "Task", dateEndDate: "2026-11-30" },
    );
    expect(body.fixed).toEqual([{ member: "dateEndDate", sent: "2026-11-30" }]);
  });

  it("accepts an echoed member only with its recorded value when a constant holds its text", () => {
    const url = "https://scratch.example.test/rea-capture-1";
    const body = create(
      {
        id: 9,
        url,
        snapshot: `https://web.archive.org/web/20261021200820/${url}`,
      },
      { url },
    );
    expect(body.fixed).toEqual([{ member: "url", sent: url }]);
  });
});

it(
  "finds the echoed members a wide body's constants hold without searching each text for each",
  { timeout: 5_000 },
  () => {
    const n = 8_000;
    const body = Object.fromEntries(
      Array.from({ length: n }, (_, index) => [
        `e${String(index)}`,
        `echoed value ${String(index).padStart(6, "0")}`,
      ]),
    );
    const constants = Object.fromEntries(
      Array.from({ length: n }, (_, index) => [
        `k${String(index)}`,
        `constant text ${String(index)}`,
      ]),
    );
    const result = create(
      {
        id: 1,
        ...body,
        ...constants,
        last: `see ${body[`e${String(n - 1)}`]!}`,
      },
      body,
      () => [],
    );
    expect(result.fixed).toEqual([
      { member: `e${String(n - 1)}`, sent: body[`e${String(n - 1)}`] },
    ]);
  },
);

describe("coincidences no member derives a created field from", () => {
  it("keeps a reference accepted when a constant repeats another reference of the named entity", () => {
    const channel = "1bdxw3qoyj8zjyyhdjbdobdf4r";
    const user = "c10c054bc2a4478bb78e0210549376b1";
    const body = create(
      { id: "p1", channel_id: channel, user_id: user, message: "hi" },
      { channel_id: channel, message: "hi" },
      lookup(
        held("/api/v4/channels", {
          id: channel,
          creator_id: user,
          name: "town-square",
        }),
      ),
    );
    expect(body.accepted).toEqual(["channel_id", "message"]);
  });

  it("keeps a reference accepted when the field repeating the named entity's text is named after something else", () => {
    const thread = "7f3c2a9e1b4d4c0a";
    const body = create(
      { id: 9, thread_id: thread, author_name: "Rea Admin" },
      { thread_id: thread },
      lookup(held("/api/threads", { id: thread, owner_display: "Rea Admin" })),
    );
    expect(body.accepted).toEqual(["thread_id"]);
  });

  it("keeps a date accepted when the instant near it is named after something else", () => {
    const body = create(
      { id: 9, dueDate: "2026-11-30", created_on: "2026-11-29" },
      { dueDate: "2026-11-30" },
    );
    expect(body.accepted).toEqual(["dueDate"]);
  });

  it("reads a short value as an id only under a member named as a reference", () => {
    const body = create(
      { id: 9, paid: 7, paidNote: "Settled in March" },
      { paid: 7 },
      lookup(held("/api/invoices", { id: 7, note: "Settled in March" })),
    );
    expect(body.accepted).toEqual(["paid"]);
  });

  it("looks a short id up among the types named after its member", () => {
    const body = create(
      { id: 9, product_id: 3, product_name: "Pantry Shelf" },
      { product_id: 3 },
      lookup(
        held("/api/objects/products", { id: 3, name: "Cheddar Cheese" }),
        held("/api/objects/locations", { id: 3, name: "Pantry Shelf" }),
      ),
    );
    expect(body.accepted).toEqual(["product_id"]);
  });
});

it("accepts an update's re-sent reference with any value, as the entity it names may differ per call", () => {
  const before = {
    id: 42,
    title: "a",
    parentId: ACCOUNT,
    parentName: "Copperfield Annex",
  };
  const body = explainUpdate({
    before,
    after: { ...before, title: "b" },
    call: {
      path: "/tasks/42",
      pathValues: new Map([["task", "42"]]),
      body: { title: "b", parentId: ACCOUNT },
    },
    method: "PATCH",
    idField: "id",
    id: "42",
    startMs: START,
    others: [],
  }).body;
  expect(body.accepted).toEqual(["title", "parentId"]);
});
