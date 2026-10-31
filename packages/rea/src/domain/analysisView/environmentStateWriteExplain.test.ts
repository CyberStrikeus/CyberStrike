import { expect, it } from "vitest";
import type { JsonValue } from "../jsonValue.js";
import type { JsonObject } from "./environmentStateRules.js";
import {
  compareValues,
  documentPointerOf,
  explainCreate,
  explainUpdate,
  insertCandidates,
  randomIdentities,
  insertIndex,
  responseShapeOf,
  type CreateEvidence,
} from "./environmentStateWriteExplain.js";
import type { UpdateEvidence } from "./environmentStateWriteChanges.js";
import {
  callRenewal,
  unexplainedRenewals,
  renewedUuids,
} from "./environmentStateWriteGenerated.js";
import {
  classifyWrite,
  pathValuesOf,
  prefixRelated,
  type FieldRule,
  type InsertRule,
  type WriteEffect,
  type WriteResponse,
} from "./environmentStateWriteRules.js";

const START = Date.UTC(2026, 2, 4, 5, 6, 0);
const MINUTE = 60_000;
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_UUID = "00000000-0000-4000-8000-000000000000";
const FRESH = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
] as const;

const created = (
  entity: JsonObject,
  body: JsonObject,
  context: Partial<CreateEvidence> & {
    readonly path?: Record<string, string>;
  } = {},
): CreateEvidence => {
  const { path = {}, ...rest } = context;
  return {
    entity,
    call: { path: "/items", pathValues: new Map(Object.entries(path)), body },
    idField: "id",
    startMs: START,
    collection: [],
    type: [],
    ...rest,
  };
};

const updated = (
  before: JsonObject,
  after: JsonObject,
  body: JsonObject,
  context: Partial<UpdateEvidence> = {},
): UpdateEvidence => ({
  before,
  after,
  call: { path: "/items/42", pathValues: new Map([["item", "42"]]), body },
  method: "PATCH",
  idField: "id",
  id: "42",
  startMs: START,
  others: [],
  ...context,
});

const ruleFor = (
  rules: readonly FieldRule[],
  field: string,
): FieldRule | undefined => rules.find((rule) => rule.field === field);

it("explains created fields by echo, copy, path and slug, leaving constants unlisted", () => {
  const notes = ["x", "drafted by the finance team"];
  const result = explainCreate(
    created(
      {
        id: 7,
        title: "Quarterly report",
        heading: "Quarterly report",
        summary: "drafted by the finance team",
        projectId: 42,
        slug: "quarterly-report",
        code: "abc",
        status: "open",
      },
      { title: "Quarterly report", meta: { notes }, label: "abc" },
      { path: { project: "42" } },
    ),
  );
  expect(result.rules).toEqual([
    { field: "id", rule: "identity", generator: "sequence" },
    { field: "title", rule: "echo" },
    { field: "heading", rule: "copy", from: "/title" },
    { field: "summary", rule: "copy", from: "/meta/notes/1" },
    { field: "projectId", rule: "path", from: "project" },
    { field: "slug", rule: "slug", from: "title" },
  ]);
  expect(result.tied).toBe(false);
});

it("copies only body strings of eight or more characters", () => {
  const short = explainCreate(
    created({ id: 1, label: "seven77" }, { name: "seven77" }),
  );
  expect(ruleFor(short.rules, "label")).toBeUndefined();
  const long = explainCreate(
    created({ id: 1, label: "eight888" }, { name: { first: "eight888" } }),
  );
  expect(ruleFor(long.rules, "label")).toEqual({
    field: "label",
    rule: "copy",
    from: "/name/first",
  });
});

it.each<[string, JsonValue, number | undefined, boolean]>([
  [
    "ten minutes after",
    new Date(START + 10 * MINUTE).toISOString(),
    START,
    true,
  ],
  [
    "ten minutes before",
    new Date(START - 10 * MINUTE).toISOString(),
    START,
    true,
  ],
  [
    "just outside",
    new Date(START + 10 * MINUTE + 1).toISOString(),
    START,
    false,
  ],
  ["untimed", new Date(START).toISOString(), undefined, false],
])("explains a clock %s the request start", (_, value, startMs, clock) => {
  const result = explainCreate(created({ id: 1, at: value }, {}, { startMs }));
  expect(ruleFor(result.rules, "at")).toEqual(
    clock
      ? {
          field: "at",
          rule: "clock",
          format: { kind: "iso", separator: "T", fraction: 3, zone: "Z" },
        }
      : undefined,
  );
});

it("keeps an epoch clock's unit", () => {
  const result = explainCreate(created({ id: 1, at: START / 1000 + 5 }, {}));
  expect(ruleFor(result.rules, "at")).toEqual({
    field: "at",
    rule: "clock",
    format: { kind: "epoch", unit: "s" },
  });
});

it.each<[JsonValue, FieldRule | undefined]>([
  [4, { field: "number", rule: "sequence", scope: "collection" }],
  ["4", { field: "number", rule: "sequence", scope: "collection" }],
  [10, { field: "number", rule: "sequence", scope: "type" }],
  [5, undefined],
])("explains the number %j by the sequence it continues", (value, rule) => {
  const collection = [{ number: 1 }, { number: "3" }];
  const evidence = created(
    { id: 1, number: value },
    {},
    {
      collection,
      type: [...collection, { number: 9 }, { number: "x" }],
    },
  );
  expect(ruleFor(explainCreate(evidence).rules, "number")).toEqual(rule);
});

it.each<[string, JsonObject[], boolean]>([
  ["no other entity shares", [{ ref: OTHER_UUID }, {}], true],
  ["another entity shares", [{ ref: OTHER_UUID }, { ref: UUID }], false],
  ["the type holds no other entity", [], false],
])("explains a UUID as unique when %s it", (_, type, unique) => {
  const result = explainCreate(created({ id: 1, ref: UUID }, {}, { type }));
  expect(ruleFor(result.rules, "ref")).toEqual(
    unique ? { field: "ref", rule: "unique" } : undefined,
  );
});

it.each<[JsonValue, "sequence" | "uuid" | "token"]>([
  [17, "sequence"],
  ["17", "sequence"],
  [UUID, "uuid"],
  ["tok_AbC9", "token"],
])("generates the identity %j as a %s", (id, generator) => {
  const result = explainCreate(
    created({ key: id, title: "x" }, {}, { idField: "key" }),
  );
  expect(result.rules).toEqual([{ field: "key", rule: "identity", generator }]);
});

it("rebuilds strings that embed a generated value as a delimited token", () => {
  const result = explainCreate(
    created(
      {
        id: "abc123",
        number: 4,
        url: "https://x.test/items/abc123",
        ref: "#4",
        near: "abc1234 is not it",
        year: "2024",
      },
      {},
      { collection: [{ number: 3 }] },
    ),
  );
  expect(result.rules).toEqual([
    { field: "id", rule: "identity", generator: "token" },
    { field: "number", rule: "sequence", scope: "collection" },
    { field: "url", rule: "template", from: "id" },
    { field: "ref", rule: "template", from: "number" },
  ]);
});

it("accepts echoed members and fixes the others at their sent values", () => {
  const result = explainCreate(
    created(
      { id: 1, title: "A", priority: "high" },
      { title: "A", priority: "HIGH", notify: true },
    ),
  );
  expect(result.body).toEqual({
    accepted: ["title"],
    fixed: [
      { member: "priority", sent: "HIGH" },
      { member: "notify", sent: true },
    ],
    required: ["title", "priority", "notify"],
    identity: null,
    kinds: [],
  });
});

it.each<[string, JsonObject, boolean]>([
  [
    "a constant holds the path value delimited",
    { team: "/orgs/acme/teams" },
    true,
  ],
  ["a constant holds it only inside a word", { team: "acmecorp" }, false],
  ["only a path field holds it", { org: "acme" }, false],
  [
    "a template keeps it beside the generated value",
    { url: "/orgs/acme/items/1" },
    true,
  ],
])("ties a create to its collection only when %s", (_, fields, tied) => {
  const result = explainCreate(
    created({ id: 1, ...fields }, {}, { path: { org: "acme", empty: "" } }),
  );
  expect(result.tied).toBe(tied);
});

it("accepts a create member stored under another name, and rebuilds text that embeds the value it wrote", () => {
  const result = explainCreate(
    created(
      {
        id: 7,
        code: "spring-tide",
        link: "https://links.example.test/spring-tide",
        name: "Spring tide",
        label: "Lighthouse rota",
      },
      {
        handle: "spring-tide",
        name: "Spring tide",
        meta: { label: "Lighthouse rota" },
      },
    ),
  );
  expect(ruleFor(result.rules, "code")).toEqual({
    field: "code",
    rule: "copy",
    from: "/handle",
  });
  expect(ruleFor(result.rules, "link")).toEqual({
    field: "link",
    rule: "template",
    from: "code",
  });
  // A member copied only in part (one value nested inside it) is still stored differently.
  expect(result.body).toMatchObject({
    accepted: ["handle", "name"],
    fixed: [{ member: "meta", sent: { label: "Lighthouse rota" } }],
  });
});

it("explains an update that puts a fresh UUID in a sent or kept field as unique, accepting the member with any value", () => {
  const before = {
    id: "42",
    name: "Old",
    versionId: UUID,
    revisionId: OTHER_UUID,
  };
  const after = {
    id: "42",
    name: "New",
    versionId: FRESH[0],
    revisionId: FRESH[1],
  };
  const body = { name: "New", versionId: UUID };
  const result = explainUpdate(updated(before, after, body));
  expect(ruleFor(result.rules, "versionId")).toEqual({
    field: "versionId",
    rule: "unique",
  });
  expect(ruleFor(result.rules, "revisionId")).toEqual({
    field: "revisionId",
    rule: "unique",
  });
  expect(result.body).toMatchObject({
    accepted: ["name", "versionId"],
    fixed: [],
  });
  expect(result.unexplained).toEqual([]);
  // A UUID another entity holds is a reference the update moved, not one it generated.
  const held = explainUpdate(
    updated(before, after, body, {
      others: [{ id: "7", versionId: FRESH[0], revisionId: FRESH[1] }],
    }),
  );
  expect(ruleFor(held.rules, "versionId")).toEqual({
    field: "versionId",
    rule: "constant",
    value: FRESH[0],
  });
  expect(held.unexplained).toEqual(["revisionId"]);
});

it("explains child rows an update rewrote with new UUIDs as renewed, and other changes to them as unexplained", () => {
  const rows = (...ids: string[]) =>
    ids.map((id, index) => ({ id, text: `Step ${String(index)}` }));
  const before = { id: "42", notes: "Old", steps: rows(UUID, OTHER_UUID) };
  const renewed = explainUpdate(
    updated(
      before,
      { ...before, notes: "New", steps: rows(...FRESH) },
      { notes: "New" },
    ),
  );
  expect(ruleFor(renewed.rules, "steps")).toEqual({
    field: "steps",
    rule: "renewed",
    pointers: ["/*/id"],
  });
  const edited = explainUpdate(
    updated(
      before,
      {
        ...before,
        notes: "New",
        steps: [{ id: FRESH[0], text: "Step one" }, ...rows(FRESH[1]!)],
      },
      { notes: "New" },
    ),
  );
  expect(edited.unexplained).toEqual(["steps"]);
});

it("explains an update's sent members as echoes, constants or the identity", () => {
  const result = explainUpdate(
    updated(
      { id: "42", title: "Old", status: "open" },
      { id: "42", title: "New", status: "closed" },
      { id: 42, title: "New", status: "CLOSED", comment: "done" },
    ),
  );
  expect(result).toEqual({
    rules: [
      { field: "title", rule: "echo" },
      { field: "status", rule: "constant", value: "closed" },
    ],
    body: {
      accepted: ["title"],
      fixed: [
        { member: "status", sent: "CLOSED" },
        { member: "comment", sent: "done" },
      ],
      required: [],
      identity: "id",
      kinds: [],
    },
    unexplained: [],
    unstamped: [],
  });
});

it("treats omitted read fields as removed only when the selected view covers them", () => {
  const before = {
    id: "42",
    name: "Old",
    description: "Kept",
    updated_at: "2026-01-01T00:00:00Z",
  };
  const after = { id: "42", name: "New" };
  const result = explainUpdate(
    updated(before, after, { name: "New" }, { readFields: ["id", "name"] }),
  );
  expect(result.unexplained).toEqual([]);

  const complete = explainUpdate(
    updated(
      before,
      after,
      { name: "New" },
      {
        readFields: ["id", "name", "description", "updated_at"],
      },
    ),
  );
  expect(complete.unexplained).toEqual(["description", "updated_at"]);
});

it("explains unsent changes as a clock, an increment or a slug of an echoed member", () => {
  const result = explainUpdate(
    updated(
      {
        id: "42",
        title: "Old Title",
        slug: "old-title",
        version: 3,
        revision: "9",
        updatedAt: "2026-01-01T00:00:00Z",
        color: "red",
      },
      {
        id: "42",
        title: "New Title",
        slug: "new-title",
        version: 4,
        revision: "10",
        updatedAt: new Date(START + 1000).toISOString(),
        color: "blue",
        added: true,
      },
      { title: "New Title" },
    ),
  );
  expect(result.rules).toEqual([
    { field: "title", rule: "echo" },
    { field: "slug", rule: "slug", from: "title" },
    { field: "version", rule: "increment" },
    { field: "revision", rule: "increment" },
    {
      field: "updatedAt",
      rule: "clock",
      format: { kind: "iso", separator: "T", fraction: 3, zone: "Z" },
    },
  ]);
  expect(result.unexplained).toEqual(["color"]);
});

it("leaves a slug of a transformed member, an untimed clock and a jump unexplained", () => {
  const result = explainUpdate(
    updated(
      { id: "42", title: "Old", slug: "old", at: "2026-01-01T00:00:00Z", n: 3 },
      {
        id: "42",
        title: "new title",
        slug: "new-title",
        at: new Date(START).toISOString(),
        n: 5,
      },
      { title: "New Title" },
      { startMs: undefined },
    ),
  );
  expect(result.rules).toEqual([
    { field: "title", rule: "constant", value: "new title" },
  ]);
  expect(result.unexplained).toEqual(["slug", "at", "n"]);
});

it.each<[string, string[]]>([
  ["PUT", ["title", "status"]],
  ["PATCH", []],
  ["POST", []],
])(
  "requires the members a %s sent apart from the identity",
  (method, required) => {
    const after = { id: "42", title: "New", status: "closed" };
    const body = { id: "42", title: "New", status: "closed" };
    const result = explainUpdate(updated(after, after, body, { method }));
    expect(result.body.required).toEqual(required);
    expect(result.body.identity).toBe("id");
  },
);

type Shaped = [WriteResponse["shape"], string | null];

it.each<[string, JsonValue | undefined, boolean, Shaped]>([
  ["no body", undefined, true, ["empty", null]],
  ["an empty response with a body", { id: "42" }, true, ["empty", null]],
  ["no recorded body", undefined, false, ["recorded", null]],
  ["the entity at the root", { id: "42", title: "x" }, false, ["entity", ""]],
  [
    "the entity in one member",
    { data: { id: 42 } },
    false,
    ["entity", "/data"],
  ],
  [
    "the entity in a one-element array",
    [{ id: "42" }],
    false,
    ["entity", "/0"],
  ],
  ["the identity at the root", "42", false, ["identity", ""]],
  ["a numeric identity at the root", 42, false, ["identity", ""]],
  [
    "the identity in one member",
    { created: "42", ok: true },
    false,
    ["identity", "/created"],
  ],
  [
    "the identity in an escaped member",
    { "a/b": 42 },
    false,
    ["identity", "/a~1b"],
  ],
  [
    "the identity in two members",
    { a: "42", b: "42" },
    false,
    ["recorded", null],
  ],
  ["no identity", { ok: true }, false, ["recorded", null]],
])("shapes a response carrying %s", (_, body, empty, [shape, pointer]) => {
  expect(responseShapeOf(3, body, empty, { idField: "id", id: "42" })).toEqual({
    ordinal: 3,
    shape,
    pointer,
  });
});

it.each<[JsonValue | undefined, JsonValue | undefined, number | undefined]>([
  [2, 10, -1],
  ["10", 9, 1],
  ["7", 7, 0],
  ["2026-03-04T05:00:00Z", "2026-03-04T06:30:00+02:00", 1],
  ["2026-03-04T05:00:00.123000001Z", "2026-03-04T05:00:00.123000002Z", -1],
  [Date.UTC(2026, 2, 4, 6) / 1000, "2026-03-04T05:00:00Z", 1],
  ["apple", "banana", -1],
  ["Zebra", "apple", -1],
  ["b", "b", 0],
  [5, "apple", undefined],
  [true, false, undefined],
  [undefined, "x", undefined],
  [{ a: 1 }, { a: 1 }, undefined],
])("orders %j against %j as %j", (left, right, sign) => {
  const order = compareValues(left, right);
  expect(order === undefined ? undefined : Math.sign(order)).toBe(sign);
});

it("offers each strictly ordered field in its direction, then last and first", () => {
  const members = [
    { id: 1, at: "2026-03-02T00:00:00Z", name: "b", tag: "x" },
    { id: 2, at: "2026-03-01T12:00:00+02:00", name: "a", tag: "x" },
    { id: "3", at: "2026-02-28T00:00:00Z", name: "c" },
  ];
  expect(insertCandidates(members, ["id", "at", "name", "tag"])).toEqual([
    { rule: "sorted", field: "id", direction: "ascending" },
    { rule: "sorted", field: "at", direction: "descending" },
    { rule: "last" },
    { rule: "first" },
  ]);
  const fallback = [{ rule: "last" }, { rule: "first" }];
  expect(insertCandidates([{ id: 1 }], ["id"])).toEqual(fallback);
  expect(insertCandidates([], ["id"])).toEqual(fallback);
});

it("offers a sort by a random identity only after last", () => {
  const members = [
    { id: "0a7f", at: "2026-03-01T00:00:00Z" },
    { id: "5c21", at: "2026-03-02T00:00:00Z" },
  ];
  expect(insertCandidates(members, ["id", "at"], { random: "id" })).toEqual([
    { rule: "sorted", field: "at", direction: "ascending" },
    { rule: "last" },
    { rule: "sorted", field: "id", direction: "ascending" },
    { rule: "first" },
  ]);
});

it("claims no sort before last when the consistent sorts place the created entity differently", () => {
  const members = [
    { id: 1, name: "Alpha", at: "2026-03-02T00:00:00Z" },
    { id: 2, name: "Delta", at: "2026-03-01T00:00:00Z" },
  ];
  const created = { id: 3, name: "Bravo", at: "2026-03-03T00:00:00Z" };
  expect(insertCandidates(members, ["id", "name", "at"], { created })).toEqual([
    { rule: "last" },
    { rule: "sorted", field: "id", direction: "ascending" },
    { rule: "sorted", field: "name", direction: "ascending" },
    { rule: "sorted", field: "at", direction: "descending" },
    { rule: "first" },
  ]);
  const agreeing = { id: 3, name: "Echo", at: "2026-02-28T00:00:00Z" };
  expect(
    insertCandidates(members, ["id", "name", "at"], { created: agreeing })[0],
  ).toEqual({ rule: "sorted", field: "id", direction: "ascending" });
});

it.each([
  [
    "version 4 UUIDs",
    [
      "9b2f1c3e-0d4a-4b6e-8f1a-2c3d4e5f6a7b",
      "1c0e8a2b-7f3d-4e9a-b1c2-d3e4f5a6b7c8",
    ],
    ["2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z"],
    true,
  ],
  [
    "ids every clock lists otherwise",
    ["k2", "a9"],
    ["2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z"],
    true,
  ],
  [
    "time-ordered ids",
    ["0a1", "0b2"],
    ["2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z"],
    false,
  ],
])("reads %s as random: %s", (_, ids, clocks, random) => {
  const members = ids.map((id, index) => ({ id, at: clocks[index]! }));
  expect(randomIdentities(members, "id", ["at"])).toBe(random);
});

it("uses retained submillisecond precision to recognize and place sorted timestamps", () => {
  const members = [
    { at: "2026-03-04T05:00:00.123000002Z" },
    { at: "2026-03-04T05:00:00.123000003Z" },
  ];
  const rule: InsertRule = {
    rule: "sorted",
    field: "at",
    direction: "ascending",
  };
  expect(insertCandidates(members, ["at"])).toEqual([
    rule,
    { rule: "last" },
    { rule: "first" },
  ]);
  expect(
    insertIndex(rule, members, { at: "2026-03-04T05:00:00.123000001Z" }),
  ).toBe(0);
});

const ASCENDING = [{ n: 1 }, { n: 3 }, { n: 5 }];
const DESCENDING = [{ n: 5 }, { n: 3 }, { n: 1 }];
const up: InsertRule = { rule: "sorted", field: "n", direction: "ascending" };
const down: InsertRule = {
  rule: "sorted",
  field: "n",
  direction: "descending",
};

it.each<[string, InsertRule, JsonObject, number]>([
  ["first", { rule: "first" }, { n: 9 }, 0],
  ["last", { rule: "last" }, { n: 0 }, 3],
  ["ascending, between members", up, { n: 4 }, 2],
  ["ascending, before every member", up, { n: 0 }, 0],
  ["ascending, after every member", up, { n: 6 }, 3],
  ["ascending, after an equal member", up, { n: 3 }, 2],
  ["descending, between members", down, { n: 4 }, 1],
  ["descending, after every member", down, { n: 0 }, 3],
  ["sorted, with an incomparable value", up, { n: true }, 3],
  ["sorted, without the field", up, {}, 3],
])("inserts %s", (_, rule, fields, index) => {
  const members = rule === down ? DESCENDING : ASCENDING;
  expect(insertIndex(rule, members, fields)).toBe(index);
});

it.each<[string, JsonValue, JsonObject, string | undefined]>([
  ["the root", { theme: "dark", lang: "en" }, { theme: "light" }, ""],
  [
    "the member sharing most",
    { theme: "dark", settings: { theme: "dark", lang: "en" } },
    { theme: "light", lang: "fr" },
    "/settings",
  ],
  [
    "the root on a tie",
    { theme: "d", s: { lang: "en" } },
    { theme: "x", lang: "y" },
    "",
  ],
  ["an escaped member", { "a/b": { theme: "dark" } }, { theme: "x" }, "/a~1b"],
  [
    "nothing when none is shared",
    { a: 1, b: { c: 2 } },
    { theme: "x" },
    undefined,
  ],
  ["nothing in an array", [{ theme: "dark" }], { theme: "x" }, undefined],
])("points a document write at %s", (_, value, body, pointer) => {
  expect(documentPointerOf(value, body)).toBe(pointer);
});

it.each<[string, string, WriteEffect, string | null]>([
  ["POST", "/users", "create", "/users"],
  ["POST", "/users/", "create", "/users"],
  ["POST", "/users/{userId}/posts", "create", "/users/{userId}/posts"],
  ["PUT", "/users/{userId}", "update", "/users"],
  ["PATCH", "/users/{id}", "update", "/users"],
  ["POST", "/users/{id}", "update", "/users"],
  ["DELETE", "/users/{id}", "delete", "/users"],
  [
    "DELETE",
    "/users/{userId}/posts/{postId}",
    "delete",
    "/users/{userId}/posts",
  ],
  ["GET", "/users/{id}", "none", null],
  ["DELETE", "/users", "none", null],
  ["PUT", "/users", "none", null],
  ["PUT", "/users/me", "none", null],
  ["POST", "/users/{id}/archive", "none", null],
  ["PUT", "/settings", "document", "get_settings"],
  ["PATCH", "/settings/", "document", "get_settings"],
  ["POST", "/settings", "document", "get_settings"],
  ["DELETE", "/settings", "none", null],
])("classifies %s %s as %s", (method, path, effect, target) => {
  expect(
    classifyWrite(
      { method, path_template: path },
      new Set(["/users", "/users/{userId}/posts"]),
      new Map([["/settings", "get_settings"]]),
    ),
  ).toEqual({ effect, target });
});

it.each<[string, string, Record<string, string> | undefined]>([
  [
    "/orgs/{org}/repos/{repo}",
    "/orgs/acme/repos/rea",
    { org: "acme", repo: "rea" },
  ],
  ["/orgs/{org}", "/orgs/a%20b%2Fc/", { org: "a b/c" }],
  ["/orgs/{org}", "/orgs/%E0%A4%A", { org: "%E0%A4%A" }],
  ["/orgs", "/orgs", {}],
  ["/orgs/{org}", "/teams/acme", undefined],
  ["/orgs/{org}", "/orgs/acme/repos", undefined],
])("reads %s from %s", (template, path, values) => {
  expect(pathValuesOf(template, path)).toEqual(
    values === undefined ? undefined : new Map(Object.entries(values)),
  );
});

it.each<[string, string, boolean]>([
  ["/users", "/users/{id}", true],
  ["/users/{id}/posts", "/users/42", true],
  ["/users/42/posts", "/users/{id}/posts/7", true],
  ["/", "/anything/at/all", true],
  ["/users/42", "/users/43", false],
  ["/users", "/teams/{id}", false],
  ["/{tenant}/users", "/acme/teams", false],
  ["/orgs/%61cme/books", "/orgs/acme/books/1", true],
  ["/orgs/%2561cme/books", "/orgs/%61cme/books/1", true],
  ["/orgs/%2561cme/books", "/orgs/acme/books/1", false],
  ["/orgs/a%2Fb/books", "/orgs/a/b/books/1", false],
])("relates %s and %s by prefix: %s", (left, right, related) => {
  expect(prefixRelated(left, right)).toBe(related);
  expect(prefixRelated(right, left)).toBe(related);
});

it(
  "explains many copied and slugged fields of a wide body without searching it again for each",
  { timeout: 5_000 },
  () => {
    const n = 8_000;
    const value = (index: number) => `value-${String(index).padStart(6, "0")}`;
    const nested = Object.fromEntries(
      Array.from({ length: n }, (_, index) => [
        `g${String(index)}`,
        { s: value(index) },
      ]),
    );
    const copies = Object.fromEntries(
      Array.from({ length: n }, (_, index) => [
        `c${String(index)}`,
        value(index),
      ]),
    );
    const copied = explainCreate(created({ id: 1, ...copies }, nested));
    expect(ruleFor(copied.rules, `c${String(n - 1)}`)).toEqual({
      field: `c${String(n - 1)}`,
      rule: "copy",
      from: `/g${String(n - 1)}/s`,
    });
    // Strings no member slugs to, in a body of many members, each tried as a slug.
    const flat = Object.fromEntries(
      Array.from({ length: n }, (_, index) => [
        `m${String(index)}`,
        `Member ${String(index)}`,
      ]),
    );
    const others = Object.fromEntries(
      Array.from({ length: n }, (_, index) => [
        `o${String(index)}`,
        `x${String(index)}`,
      ]),
    );
    const slugged = explainCreate(
      created({ id: 1, ...others, s: "member-7" }, flat),
    );
    expect(ruleFor(slugged.rules, "s")).toEqual({
      field: "s",
      rule: "slug",
      from: "m7",
    });
  },
);

it(
  "searches a wide request body for a copied value in linear time",
  { timeout: 5_000 },
  () => {
    // Shifting each value off the queue made one fruitless search over 500,000 zeros take about a minute.
    const wide = Array.from({ length: 500_000 }, () => 0);
    const result = explainCreate(
      created({ id: 1, note: "not anywhere in the body" }, { items: wide }),
    );
    expect(ruleFor(result.rules, "note")).toBeUndefined();
  },
);

const ID = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const steps = (...ids: number[]): JsonValue =>
  ids.map((id, index) => ({ id: ID(id), text: `Step ${String(index)}` }));

it("finds the UUIDs a value renewed when nothing else in it changed", () => {
  expect(renewedUuids(steps(1, 2), steps(3, 4))).toEqual({
    uuids: new Map([
      [ID(2), ID(4)],
      [ID(1), ID(3)],
    ]),
    pointers: ["/*/id"],
  });
  expect(renewedUuids(steps(1, 2), steps(1, 2))).toBeUndefined();
  // Another text, another length, a UUID moved to another row, one UUID renewed twice.
  expect(
    renewedUuids(steps(1), [{ id: ID(3), text: "Step one" }]),
  ).toBeUndefined();
  expect(renewedUuids(steps(1, 2), steps(3))).toBeUndefined();
  expect(renewedUuids(steps(1, 2), steps(2, 1))).toBeUndefined();
  expect(renewedUuids([ID(1), ID(1)], [ID(3), ID(4)])).toBeUndefined();
});

it("renews no UUID kept elsewhere, moved from elsewhere or kept at a pointer it renewed", () => {
  expect(
    renewedUuids(
      { current: ID(1), fallback: ID(2) },
      { current: ID(2), fallback: ID(2) },
    ),
  ).toBeUndefined();
  expect(renewedUuids([ID(1), ID(1)], [ID(2), ID(1)])).toBeUndefined();
  expect(renewedUuids([ID(1), ID(2)], [ID(3), ID(2)])).toBeUndefined();
  expect(renewedUuids([ID(1), ID(2)], [ID(3), ID(3)])).toBeUndefined();
  // A reference kept beside renewed ids stays outside the renewal.
  expect(
    renewedUuids(
      [{ id: ID(1), author: ID(9) }],
      [{ id: ID(2), author: ID(9) }],
    ),
  ).toEqual({ uuids: new Map([[ID(1), ID(2)]]), pointers: ["/*/id"] });
});

it("explains no renewed field whose new UUIDs another entity holds, or that renews a shared UUID otherwise than another field", () => {
  const before = { id: "42", owner: { id: ID(1) }, toc: [{ ref: ID(5) }] };
  const after = { id: "42", owner: { id: ID(2) }, toc: [{ ref: ID(5) }] };
  expect(
    explainUpdate(
      updated(
        before,
        after,
        {},
        { others: [{ id: "7", owner: { id: ID(2) } }] },
      ),
    ).unexplained,
  ).toEqual(["owner"]);
  expect(
    ruleFor(explainUpdate(updated(before, after, {})).rules, "owner"),
  ).toEqual({ field: "owner", rule: "renewed", pointers: ["/id"] });
  const shared = { id: "42", rows: [{ id: ID(1) }], toc: [{ ref: ID(1) }] };
  expect(
    explainUpdate(
      updated(
        shared,
        { id: "42", rows: [{ id: ID(2) }], toc: [{ ref: ID(3) }] },
        {},
      ),
    ).unexplained,
  ).toEqual(["toc"]);
  expect(
    explainUpdate(
      updated(
        shared,
        { id: "42", rows: [{ id: ID(2) }], toc: [{ ref: ID(2) }] },
        {},
      ),
    ).unexplained,
  ).toEqual([]);
});

it("does not accept a member a create stores otherwise under its own name, though it also copies it", () => {
  const result = explainCreate(
    created(
      { id: 7, title: "QUARTERLY REPORT", label: "Quarterly Report" },
      { title: "Quarterly Report" },
    ),
  );
  expect(ruleFor(result.rules, "label")).toEqual({
    field: "label",
    rule: "copy",
    from: "/title",
  });
  expect(result.body.accepted).not.toContain("title");
});

it("builds no template from a copy of an echoed value", () => {
  const result = explainCreate(
    created(
      {
        id: 7,
        markdown: "Weekly planning notes",
        text: "Weekly planning notes",
        html: "<p>Weekly planning notes</p>",
      },
      { markdown: "Weekly planning notes" },
    ),
  );
  expect(ruleFor(result.rules, "html")).toBeUndefined();
});

it("explains a sent UUID stored in another letter case as stored otherwise, not as one the application generated", () => {
  const result = explainUpdate(
    updated(
      { id: "42", assignee: ID(1) },
      { id: "42", assignee: ID(2).replace("4000", "4abc") },
      { assignee: ID(2).replace("4000", "4ABC") },
    ),
  );
  expect(ruleFor(result.rules, "assignee")).toEqual({
    field: "assignee",
    rule: "constant",
    value: ID(2).replace("4000", "4abc"),
  });
  expect(result.body.accepted).toEqual([]);
});

/** A UUID of one repeated hex letter, so its letter case shows. */
const LETTERED = (letter: string): string =>
  `${letter.repeat(8)}-${letter.repeat(4)}-4${letter.repeat(3)}-a${letter.repeat(3)}-${letter.repeat(12)}`;

it("generates no UUID into a field that holds one the call sent in another member", () => {
  const result = explainUpdate(
    updated(
      { id: "42", sourceId: ID(1), aliasId: ID(2) },
      { id: "42", sourceId: ID(3), aliasId: ID(3) },
      { sourceId: ID(3) },
    ),
  );
  // The field follows the sent member, so serving keeps the two linked.
  expect(ruleFor(result.rules, "aliasId")).toEqual({
    field: "aliasId",
    rule: "slug",
    from: "sourceId",
  });
});

it("renews one UUID alike in either letter case, and spells each place in its own case", () => {
  const rules: FieldRule[] = [
    { field: "rows", rule: "renewed", pointers: ["/*/id"] },
    { field: "toc", rule: "renewed", pointers: ["/*/ref"] },
  ];
  const before = {
    rows: [{ id: LETTERED("a") }],
    toc: [{ ref: LETTERED("a").toUpperCase() }],
  };
  const renewed = (row: string, ref: string) => ({
    rows: [{ id: row }],
    toc: [{ ref }],
  });
  expect(
    unexplainedRenewals(rules, {
      before,
      after: renewed(LETTERED("b"), LETTERED("c").toUpperCase()),
      call: { body: {} },
      others: [],
    }),
  ).toEqual(["toc"]);
  expect(
    unexplainedRenewals(rules, {
      before,
      after: renewed(LETTERED("b"), LETTERED("b").toUpperCase()),
      call: { body: {} },
      others: [],
    }),
  ).toEqual([]);
  const renew = callRenewal("call");
  const row = renew(LETTERED("a"));
  expect(renew(LETTERED("a").toUpperCase())).toBe(row.toUpperCase());
  expect(row).toBe(row.toLowerCase());
});

it("owns one canonical renewal for mixed-case occurrences of the same UUID", () => {
  expect(
    renewedUuids(
      [LETTERED("a"), LETTERED("a").toUpperCase()],
      [LETTERED("b"), LETTERED("b").toUpperCase()],
    ),
  ).toEqual({
    uuids: new Map([[LETTERED("a"), LETTERED("b")]]),
    pointers: ["/*"],
  });
});

it.each(["kept-in-renewed-field", "other-entity"] as const)(
  "does not renew a UUID already owned by %s",
  (owner) => {
    const rules: FieldRule[] = [
      { field: "left", rule: "renewed", pointers: ["/id"] },
    ];
    const before: JsonObject = { left: { id: ID(1) } };
    const after: JsonObject = { left: { id: ID(3) } };
    if (owner === "kept-in-renewed-field") {
      rules.push({ field: "right", rule: "renewed", pointers: ["/id"] });
      before.right = { id: ID(2), reference: ID(3) };
      after.right = { id: ID(4), reference: ID(3) };
    }
    expect(
      unexplainedRenewals(rules, {
        before,
        after,
        call: { body: {} },
        others: owner === "other-entity" ? [{ reference: ID(3) }] : [],
      }),
    ).toEqual(["left"]);
  },
);

it("does not independently generate a scalar UUID another entity holds under another field", () => {
  const result = explainUpdate({
    ...updated({ id: "42", version: ID(1) }, { id: "42", version: ID(3) }, {}),
    others: [{ reference: ID(3) }],
  });
  expect(result.unexplained).toContain("version");
  expect(ruleFor(result.rules, "version")).toBeUndefined();
});

it("refuses renewals that join two old UUIDs onto one new one", () => {
  const rules: FieldRule[] = [
    { field: "left", rule: "renewed", pointers: ["/*"] },
    { field: "right", rule: "renewed", pointers: ["/*"] },
  ];
  expect(
    unexplainedRenewals(rules, {
      before: { left: [ID(1)], right: [ID(2)] },
      after: { left: [ID(3)], right: [ID(3)] },
      call: { body: {} },
      others: [],
    }),
  ).toEqual(["right"]);
});

it("accepts a copied member only with its recorded value when a template keeps it beside another source", () => {
  const result = explainCreate(
    created(
      {
        id: 7,
        name: "Atlas",
        code: "alpha-handle-1",
        groupCode: "group-alpha-2",
        link: "/g/group-alpha-2/u/alpha-handle-1",
      },
      { name: "Atlas", handle: "alpha-handle-1", group: "group-alpha-2" },
    ),
  );
  expect(ruleFor(result.rules, "link")).toEqual({
    field: "link",
    rule: "template",
    from: "code",
  });
  expect(result.body.accepted).toContain("handle");
  expect(result.body.accepted).not.toContain("group");
  expect(result.body.fixed).toContainEqual({
    member: "group",
    sent: "group-alpha-2",
  });
});

it.each<[string, JsonValue, readonly JsonValue[], boolean]>([
  [
    "a time-based id no held entity takes",
    1656166527623168,
    [1655476044521472, 1655476044521999],
    true,
  ],
  [
    "one a held entity already holds",
    1655476044521472,
    [1655476044521472],
    false,
  ],
  [
    "one among held ids of another length",
    1656166527623168,
    [16554760445214],
    false,
  ],
  [
    "one among held ids spelled as text",
    1656166527623168,
    ["1655476044521472"],
    false,
  ],
  [
    "one among held entities sharing an id",
    1656166527623168,
    [1655476044521472, 1655476044521472],
    false,
  ],
  ["one with no held entity to compare", 1656166527623168, [], false],
  ["a short number", 123456789, [987654321], false],
])("learns %s as generated", (_name, value, held, unique) => {
  const result = explainCreate(
    created(
      { id: 7, ref: value },
      {},
      { type: held.map((ref, index) => ({ id: index + 1, ref })) },
    ),
  );
  expect(ruleFor(result.rules, "ref")).toEqual(
    unique ? { field: "ref", rule: "unique" } : undefined,
  );
});

it("trims a created clock's fraction, and its sibling clock's, when held entities spell the field trimmed", () => {
  const at = new Date(START).toISOString().replace(".000Z", "");
  const result = explainCreate(
    created(
      {
        id: 7,
        createdAt: `${at}.123456789Z`,
        updatedAt: `${at}.123456791Z`,
      },
      {},
      {
        type: [
          {
            id: 1,
            createdAt: "2026-01-01T00:00:00.12345678Z",
            updatedAt: "2026-01-01T00:00:00.123456789Z",
          },
        ],
      },
    ),
  );
  const trimmed = {
    kind: "iso",
    separator: "T",
    fraction: 9,
    zone: "Z",
    trimmed: true,
  };
  expect(ruleFor(result.rules, "createdAt")).toEqual({
    field: "createdAt",
    rule: "clock",
    format: trimmed,
  });
  expect(ruleFor(result.rules, "updatedAt")).toEqual({
    field: "updatedAt",
    rule: "clock",
    format: trimmed,
  });
});
