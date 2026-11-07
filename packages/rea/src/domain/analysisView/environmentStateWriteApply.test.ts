import { expect, it } from "vitest";
import type { JsonValue } from "../jsonValue.js";
import { err, ok } from "../result.js";
import type { JsonObject, StateEntity } from "./environmentStateRules.js";
import {
  bodyProblem,
  storedKinds,
  createdFields,
  renewUuids,
  updatedEntity,
  updatedFields,
  valueAt,
  writtenDocument,
  writtenResponse,
} from "./environmentStateWriteApply.js";
import type {
  FieldRule,
  GeneratedRule,
  StateWritePlan,
  WriteBody,
  WriteCall,
  WriteResponse,
} from "./environmentStateWriteRules.js";
import type { ClockFormat } from "./environmentStateWriteValues.js";

const SECONDS: ClockFormat = {
  kind: "iso",
  separator: "T",
  fraction: 0,
  zone: "Z",
};
const NOW = "2026-03-04T05:06:07Z";

const callWith = (
  body: JsonObject | undefined,
  pathValues: Record<string, string> = {},
): WriteCall => ({
  path: "/items",
  pathValues: new Map(Object.entries(pathValues)),
  body,
});

/** Generated values the store would supply, recording which rules asked. */
const generator = () => {
  const asked: GeneratedRule[] = [];
  const values = {
    identity: "id-9",
    sequence: 9,
    unique: "ref-9",
    renewed: ["renewed-9"],
    clock: NOW,
    "nested-clock": { at: NOW },
    "held-clock": NOW,
    "made-object": { at: NOW },
  };
  const generate = (rule: GeneratedRule) => {
    asked.push(rule);
    return ok(values[rule.rule]);
  };
  return { asked, generate };
};

const CONTRACT: WriteBody = {
  accepted: ["title", "tags", "meta", "note"],
  fixed: [
    { member: "priority", sent: "HIGH" },
    { member: "options", sent: { a: 1, b: 2 } },
  ],
  required: ["title"],
  identity: "id",
  kinds: [],
};
const RECORDED = { title: "A", tags: ["x"], meta: null, priority: "high" };
const LISTED =
  'accepted members: "title", "tags", "meta", "note"; members accepted only with their recorded value: "priority", "options"; required: "title"';

const problemOf = (body: JsonObject | undefined): string | undefined =>
  bodyProblem(CONTRACT, callWith(body), { entity: RECORDED, id: "42" });

it.each<[string, JsonObject]>([
  [
    "accepted and fixed members",
    { title: "B", priority: "HIGH", options: { b: 2, a: 1 } },
  ],
  ["the identity repeated", { id: "42", title: "B" }],
  ["the identity repeated as a number", { id: 42, title: "B" }],
  ["any type where the recorded value is null", { title: "B", meta: { x: 1 } }],
  ["any type where no value was recorded", { title: "B", note: 5 }],
])("accepts a body with %s", (_, body) => {
  expect(problemOf(body)).toBeUndefined();
});

it.each<[string, JsonObject | undefined, string]>([
  [
    "an unknown member",
    { title: "B", color: "red" },
    `Member color is not one the capture showed stored (${LISTED}).`,
  ],
  [
    "a fixed member with another value",
    { title: "B", priority: "LOW" },
    `Member priority is accepted only with the value the capture sent, "HIGH", because the application stored it differently or other recorded fields go with it (${LISTED}).`,
  ],
  [
    "a number for a string",
    { title: 5 },
    "Member title must be a JSON string, as the capture stored it.",
  ],
  [
    "null for a string",
    { title: null },
    "Member title must be a JSON string, as the capture stored it.",
  ],
  [
    "an object for an array",
    { title: "B", tags: { x: true } },
    "Member tags must be a JSON array, as the capture stored it.",
  ],
  [
    "a missing required member",
    { tags: ["y"] },
    `The call lacks required members "title" (${LISTED}).`,
  ],
  [
    "no body",
    undefined,
    `The call lacks required members "title" (${LISTED}).`,
  ],
  [
    "another identity",
    { id: "43", title: "B" },
    "Member id must repeat the target's identity 42.",
  ],
])("refuses a body with %s", (_, body, message) => {
  expect(problemOf(body)).toBe(message);
});

it.each<[string, JsonValue | undefined]>([
  ["", { a: [{ b: 1 }, { b: [2, 3] }], "x/y": { "m~n": true }, "": "blank" }],
  ["/a/0/b", 1],
  ["/a/1/b/1", 3],
  ["/x~1y/m~0n", true],
  ["/", "blank"],
  ["/a/2/b", undefined],
  ["/a/first", undefined],
  ["/a/0/b/c", undefined],
  ["/missing", undefined],
])("reads the body value at %j", (pointer, expected) => {
  const body = {
    a: [{ b: 1 }, { b: [2, 3] }],
    "x/y": { "m~n": true },
    "": "blank",
  };
  expect(valueAt(body, pointer)).toEqual(expected);
});

const CREATE_RULES: FieldRule[] = [
  { field: "id", rule: "identity", generator: "token" },
  { field: "number", rule: "sequence", scope: "collection" },
  { field: "createdAt", rule: "clock", format: SECONDS },
  { field: "ref", rule: "unique" },
  { field: "title", rule: "echo" },
  { field: "summary", rule: "copy", from: "/meta/notes/1" },
  { field: "projectId", rule: "path", from: "project" },
  { field: "projectKey", rule: "path", from: "project" },
  { field: "slug", rule: "slug", from: "title" },
  { field: "url", rule: "template", from: "id" },
];
type Plan = Pick<StateWritePlan, "rules" | "body">;

const CREATE_PLAN: Plan = {
  rules: CREATE_RULES,
  body: {
    accepted: ["title", "meta"],
    fixed: [],
    required: ["title", "meta"],
    identity: null,
    kinds: [],
  },
};
const CREATE_OBSERVED: JsonObject = {
  id: "id-1",
  number: 1,
  createdAt: "2026-01-01T00:00:00Z",
  ref: "ref-1",
  title: "Old title",
  summary: "old summary",
  projectId: 7,
  projectKey: "7",
  slug: "old-title",
  url: "https://x.test/items/id-1?v=id-10",
  status: "open",
};
const NEW_ITEM = {
  title: "New Title!",
  meta: { notes: ["a", "the new summary"] },
};

it("creates an entity from generated values, the call and the observed constants", () => {
  const { asked, generate } = generator();
  const observed = structuredClone(CREATE_OBSERVED);
  const result = createdFields(
    CREATE_PLAN,
    observed,
    callWith(NEW_ITEM, { project: "42" }),
    generate,
  );
  expect(result).toEqual(
    ok({
      id: "id-9",
      number: 9,
      createdAt: NOW,
      ref: "ref-9",
      title: "New Title!",
      summary: "the new summary",
      projectId: 42,
      projectKey: "42",
      slug: "new-title",
      url: "https://x.test/items/id-9?v=id-10",
      status: "open",
    }),
  );
  expect(asked).toEqual(CREATE_RULES.slice(0, 4));
  expect(observed).toEqual(CREATE_OBSERVED);
});

it.each<[string, Plan, WriteCall, string]>([
  [
    "no modelled body",
    { rules: CREATE_RULES, body: null },
    callWith(NEW_ITEM, { project: "42" }),
    "The tool has no modelled body.",
  ],
  [
    "a missing copy source",
    CREATE_PLAN,
    callWith({ title: "x", meta: { notes: ["only one"] } }, { project: "42" }),
    "The call has no value at /meta/notes/1 in its body, which summary copies.",
  ],
  [
    "a missing path value",
    CREATE_PLAN,
    callWith(NEW_ITEM),
    "The call names no project path value, which projectId takes.",
  ],
  [
    "a body problem",
    CREATE_PLAN,
    callWith({ ...NEW_ITEM, extra: 1 }, { project: "42" }),
    'Member extra is not one the capture showed stored (accepted members: "title", "meta"; members accepted only with their recorded value: none; required: "title", "meta").',
  ],
])("refuses a create with %s", (_, plan, call, message) => {
  expect(
    createdFields(plan, CREATE_OBSERVED, call, generator().generate),
  ).toEqual(err(message));
});

const UPDATE_PLAN: Plan = {
  rules: [
    { field: "title", rule: "echo" },
    { field: "notes", rule: "echo" },
    { field: "status", rule: "constant", value: "closed" },
    { field: "slug", rule: "slug", from: "title" },
    { field: "version", rule: "increment" },
    { field: "revision", rule: "increment" },
    { field: "updatedAt", rule: "clock", format: SECONDS },
  ],
  body: {
    accepted: ["title", "notes"],
    fixed: [{ member: "status", sent: "CLOSED" }],
    required: [],
    identity: "id",
    kinds: [],
  },
};
const BEFORE: JsonObject = {
  id: "42",
  title: "Old Title",
  notes: "n",
  status: "open",
  slug: "old-title",
  version: 3,
  revision: "9",
  updatedAt: "2026-01-01T00:00:00Z",
  color: "red",
};
const AFTER: JsonObject = {
  ...BEFORE,
  title: "Recorded Title",
  status: "closed",
  slug: "recorded-title",
  version: 4,
  revision: "10",
};

const update = (
  body: JsonObject | undefined,
  plan = UPDATE_PLAN,
  before = BEFORE,
) => {
  const { asked, generate } = generator();
  const result = updatedFields(
    plan,
    { before, observed: AFTER },
    { ...callWith(body, { item: "42" }), id: "42" },
    generate,
  );
  return { asked, result };
};

const ADVANCED = { version: 4, revision: "10", updatedAt: NOW };

it("updates sent echoed members and derives the slug of a sent member", () => {
  const { asked, result } = update({ id: "42", title: "New Title" });
  expect(result).toEqual(
    ok({ ...BEFORE, ...ADVANCED, title: "New Title", slug: "new-title" }),
  );
  expect(asked).toEqual([UPDATE_PLAN.rules[6]]);
});

it("preserves an unknown generated field when the observation omits it", () => {
  const result = updatedFields(
    UPDATE_PLAN,
    { before: BEFORE, observed: AFTER },
    { ...callWith({ title: "New Title" }, { item: "42" }), id: "42" },
    () => ok(undefined),
  );
  expect(result).toEqual(
    ok({
      ...BEFORE,
      title: "New Title",
      slug: "new-title",
      version: 4,
      revision: "10",
    }),
  );
});

it("applies a constant from the recorded update only when the call sends it", () => {
  expect(update({ status: "CLOSED" }).result).toEqual(
    ok({ ...BEFORE, ...ADVANCED, status: "closed" }),
  );
  expect(update({ notes: "m" }).result).toEqual(
    ok({ ...BEFORE, ...ADVANCED, notes: "m" }),
  );
});

const RENEWING_PLAN: Plan = {
  rules: [
    ...UPDATE_PLAN.rules,
    { field: "versionId", rule: "unique" },
    { field: "steps", rule: "renewed", pointers: ["/*"] },
  ],
  body: { ...UPDATE_PLAN.body!, accepted: ["title", "notes", "versionId"] },
};

it("takes an update's unique and renewed values from the generator, whether or not the call sends them", () => {
  const { asked, result } = update(
    { title: "New Title", versionId: "stale" },
    RENEWING_PLAN,
    { ...BEFORE, steps: ["step-1"] },
  );
  expect(result).toEqual(
    ok({
      ...BEFORE,
      ...ADVANCED,
      title: "New Title",
      slug: "new-title",
      versionId: "ref-9",
      steps: ["renewed-9"],
    }),
  );
  expect(asked.map((rule) => rule.rule)).toEqual([
    "clock",
    "unique",
    "renewed",
  ]);
});

const HELD_PLAN: Plan = {
  rules: [
    { field: "title", rule: "echo" },
    { field: "updatedAt", rule: "held-clock", format: SECONDS },
  ],
  body: { ...UPDATE_PLAN.body!, accepted: ["title", "updatedAt"], fixed: [] },
};

it("stamps a held clock only on a call that sends the value the entity holds", () => {
  expect(
    update({ title: "New Title", updatedAt: BEFORE.updatedAt! }, HELD_PLAN)
      .result,
  ).toEqual(ok({ ...BEFORE, title: "New Title", updatedAt: NOW }));
  const { asked, result } = update({ title: "New Title" }, HELD_PLAN);
  expect(result).toEqual(
    err(
      "Member updatedAt must be sent with the value the entity holds, as the recorded call did.",
    ),
  );
  expect(asked).toEqual([]);
});

it("renews no child rows on an entity that holds none", () => {
  const { asked, result } = update({ title: "New Title" }, RENEWING_PLAN);
  expect(result).toEqual(
    ok({
      ...BEFORE,
      ...ADVANCED,
      title: "New Title",
      slug: "new-title",
      versionId: "ref-9",
    }),
  );
  expect(asked.map((rule) => rule.rule)).toEqual(["clock", "unique"]);
});

it.each<[string, JsonObject | undefined, string]>([
  [
    "only the identity",
    { id: "42" },
    "The call sends none of the members an update applies",
  ],
  ["no members", {}, "The call sends none of the members an update applies"],
  [
    "no body",
    undefined,
    "The call sends none of the members an update applies",
  ],
  [
    "another identity",
    { id: "43", title: "x" },
    "Member id must repeat the target's identity 42.",
  ],
  ["a number for a string", { title: 5 }, "Member title must be a JSON string"],
  [
    "a fixed member with another value",
    { status: "OPEN" },
    "Member status is accepted only with the value",
  ],
])("refuses an update with %s", (_, body, message) => {
  const { result } = update(body);
  expect(result.ok ? undefined : result.error).toContain(message);
});

it("refuses an update without a modelled body", () => {
  expect(update({ title: "x" }, { ...UPDATE_PLAN, body: null }).result).toEqual(
    err("The tool has no modelled body."),
  );
});

const DOCUMENT = { settings: { theme: "dark", lang: "en" }, version: 1 };

const documentPlan = (
  merge: "merge" | "replace",
  pointer?: string,
): Pick<StateWritePlan, "merge" | "observation"> => ({
  merge,
  observation: pointer === undefined ? null : { ordinal: 1, pointer },
});

it.each<[string, ReturnType<typeof documentPlan>, JsonObject, JsonValue]>([
  [
    "merges into a member",
    documentPlan("merge", "/settings"),
    { theme: "light" },
    { settings: { theme: "light", lang: "en" }, version: 1 },
  ],
  [
    "replaces a member",
    documentPlan("replace", "/settings"),
    { theme: "light" },
    { settings: { theme: "light" }, version: 1 },
  ],
  [
    "merges into the root",
    documentPlan("merge"),
    { version: 2 },
    { ...DOCUMENT, version: 2 },
  ],
  [
    "replaces the root",
    documentPlan("replace", ""),
    { theme: "x" },
    { theme: "x" },
  ],
])("%s of a document", (_, plan, body, expected) => {
  expect(writtenDocument(plan, DOCUMENT, callWith(body))).toEqual(ok(expected));
  expect(DOCUMENT).toEqual({
    settings: { theme: "dark", lang: "en" },
    version: 1,
  });
});

it("refuses a document write that does not reach an object", () => {
  const refused = err("The call's body does not fit the document.");
  const plan = (pointer: string) => documentPlan("merge", pointer);
  expect(
    writtenDocument(plan("/version"), DOCUMENT, callWith({ a: 1 })),
  ).toEqual(refused);
  expect(
    writtenDocument(plan("/settings"), DOCUMENT, callWith(undefined)),
  ).toEqual(refused);
});

const answer = (
  shape: WriteResponse["shape"],
  pointer: string | null,
): WriteResponse => ({ ordinal: 1, shape, pointer });
const WRITTEN = { id: "8", title: "New", extra: true };

it.each<[string, WriteResponse, JsonValue | undefined, JsonValue | undefined]>([
  ["no body", answer("empty", null), { id: "1" }, undefined],
  ["the recorded body", answer("recorded", null), { ok: true }, { ok: true }],
  [
    "no body when none was recorded",
    answer("entity", ""),
    undefined,
    undefined,
  ],
  ["a numeric identity at the root", answer("identity", ""), 7, 8],
  ["a string identity at the root", answer("identity", ""), "7", "8"],
  [
    "a numeric identity in a member",
    answer("identity", "/id"),
    { id: 7, ok: true },
    { id: 8, ok: true },
  ],
  [
    "the recorded fields of the entity",
    answer("entity", "/data"),
    { data: { title: "Old", id: "1" }, page: 1 },
    { data: { title: "New", id: "8" }, page: 1 },
  ],
  [
    "the entity in a one-element array",
    answer("entity", "/0"),
    [{ id: "1" }],
    [{ id: "8" }],
  ],
])("answers with %s", (_, response, recorded, expected) => {
  expect(
    writtenResponse(response, recorded, { fields: WRITTEN, id: "8" }),
  ).toEqual(ok(expected));
});

it("spells an identity that is not an integer as a string where a number was recorded", () => {
  expect(
    writtenResponse(
      answer("identity", "/id"),
      { id: 7 },
      { fields: undefined, id: "abc" },
    ),
  ).toEqual(ok({ id: "abc" }));
});

it("refuses an entity answer the state cannot render", () => {
  const recorded = { data: { id: "1", title: "Old", owner: "x" } };
  expect(
    writtenResponse(answer("entity", "/data"), recorded, {
      fields: WRITTEN,
      id: "8",
    }),
  ).toEqual(
    err(
      "The state holds no complete entity for this response: it lacks owner.",
    ),
  );
  expect(
    writtenResponse(answer("entity", "/data"), recorded, {
      fields: undefined,
      id: "8",
    }),
  ).toEqual(err("The recorded response does not carry the entity."));
  expect(
    writtenResponse(answer("entity", "/missing"), recorded, {
      fields: WRITTEN,
      id: "8",
    }),
  ).toEqual(err("The recorded response does not carry the entity."));
});

it("drops view-specific values of the fields an update changed and cites no records", () => {
  const entity: StateEntity = {
    type: "/items",
    collection: "/items",
    id: "1",
    fields: { id: "1", title: "Old", status: "open", meta: { a: 1, b: 2 } },
    view_fields: [
      {
        tool: "list_items",
        fields: { title: "Old…", status: "OPEN", meta: "a,b" },
      },
      { tool: "get_item", fields: { title: "OLD" } },
      { tool: "search_items", fields: { priority: "HIGH" } },
    ],
    record_ordinals: [3, 5],
  };
  const snapshot = structuredClone(entity);
  const fields = {
    id: "1",
    title: "New",
    status: "open",
    meta: { b: 2, a: 1 },
    priority: "low",
  };
  expect(updatedEntity(entity, fields)).toEqual({
    ...snapshot,
    fields,
    record_ordinals: [],
    view_fields: [
      { tool: "list_items", fields: { status: "OPEN", meta: "a,b" } },
    ],
  });
  expect(entity).toEqual(snapshot);
  expect(updatedEntity(entity, entity.fields).view_fields).toEqual(
    entity.view_fields,
  );
});

it("learns own stored JSON member kinds without inheriting prototype members", () => {
  expect(storedKinds(["constructor"], {}, { constructor: "value" })).toEqual([
    { member: "constructor", kind: "string" },
  ]);
  expect(storedKinds(["constructor", "toString"], {}, {})).toEqual([]);
});

const RENEW_ID = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

it("renews the UUIDs at the renewed pointers alone, and keeps every other value", () => {
  const renewed = renewUuids(
    {
      first: RENEW_ID(1),
      rows: [
        { id: RENEW_ID(1), author: RENEW_ID(3), text: "Step 0" },
        { id: RENEW_ID(2), author: RENEW_ID(3), text: "Step 1" },
      ],
      note: "kept",
    },
    ["/first", "/rows/*/id"],
    (uuid) => `${uuid}:new`,
  );
  expect(renewed).toEqual({
    first: `${RENEW_ID(1)}:new`,
    rows: [
      { id: `${RENEW_ID(1)}:new`, author: RENEW_ID(3), text: "Step 0" },
      { id: `${RENEW_ID(2)}:new`, author: RENEW_ID(3), text: "Step 1" },
    ],
    note: "kept",
  });
});

it("checks a member stored only under another name against the type of the field it is copied into", () => {
  const plan: Plan = {
    rules: [
      { field: "title", rule: "echo" },
      { field: "code", rule: "copy", from: "/handle" },
    ],
    body: {
      accepted: ["title", "handle"],
      fixed: [],
      required: [],
      identity: null,
      kinds: [],
    },
  };
  const observed = { id: "id-1", title: "Old", code: "old-handle" };
  const created = (handle: JsonValue) =>
    createdFields(
      plan,
      observed,
      callWith({ title: "New", handle }),
      generator().generate,
    );
  expect(created("new-handle")).toEqual(
    ok({ id: "id-1", title: "New", code: "new-handle" }),
  );
  expect(created({ not: "a string" }).ok).toBe(false);
  expect(created(null).ok).toBe(false);
});

const ADDRESS: FieldRule = {
  field: "url",
  rule: "composed",
  parts: [
    { text: "/dashboards/f/" },
    { from: "uid", as: "value" },
    { text: "/" },
    { from: "title", as: "slug" },
  ],
};
const UNSPELLED =
  'The write composes "url" from "uid", "title", and the entity holds no value one of them can spell.';

it("rebuilds an updated composed address, and refuses one whose entity holds no field a part reads", () => {
  const plan: Plan = {
    rules: [{ field: "title", rule: "echo" }, ADDRESS],
    body: {
      accepted: ["title"],
      fixed: [],
      required: [],
      identity: "uid",
      kinds: [],
    },
  };
  const rename = (before: JsonObject) =>
    updatedFields(
      plan,
      { before, observed: before },
      { ...callWith({ title: "Moved Folder" }, { item: "7" }), id: "7" },
      generator().generate,
    );
  expect(
    rename({ id: 7, uid: "f-7", title: "Old", url: "/dashboards/f/f-7/old" }),
  ).toEqual(
    ok({
      id: 7,
      uid: "f-7",
      title: "Moved Folder",
      url: "/dashboards/f/f-7/moved-folder",
    }),
  );
  expect(rename({ id: 7, title: "Old", url: "/dashboards/f/f-7/old" })).toEqual(
    err(UNSPELLED),
  );
});

it("refuses a create whose composed address reads a member the call does not send", () => {
  const plan: Plan = {
    rules: [
      { field: "uid", rule: "echo" },
      { field: "title", rule: "echo" },
      ADDRESS,
    ],
    body: {
      accepted: ["uid", "title"],
      fixed: [],
      required: ["title"],
      identity: null,
      kinds: [],
    },
  };
  const observed: JsonObject = {
    uid: "f-1",
    title: "Recorded",
    url: "/dashboards/f/f-1/recorded",
  };
  const create = (body: JsonObject) =>
    createdFields(plan, observed, callWith(body), generator().generate);
  expect(create({ uid: "f-2", title: "New Folder" })).toEqual(
    ok({
      uid: "f-2",
      title: "New Folder",
      url: "/dashboards/f/f-2/new-folder",
    }),
  );
  expect(create({ title: "New Folder" })).toEqual(err(UNSPELLED));
});

it.each(["__proto__", "constructor"])(
  "creates and updates an absent own %s field without changing object inheritance",
  (field) => {
    const plan = {
      rules: [{ field, rule: "echo" as const }],
      body: {
        accepted: [field],
        fixed: [],
        required: [],
        identity: null,
        kinds: [],
      },
    };
    const sent = Object.fromEntries([[field, { label: "stored" }]]);
    const call = callWith(sent);
    const created = createdFields(plan, { id: 1 }, call, generator().generate);
    const updated = updatedFields(
      plan,
      {
        before: { id: 1 },
        observed: Object.fromEntries([
          ["id", 1],
          [field, { label: "old" }],
        ]),
      },
      { ...call, id: "1" },
      generator().generate,
    );
    for (const result of [created, updated]) {
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(
        Object.getOwnPropertyDescriptor(result.value, field)?.value,
      ).toEqual({ label: "stored" });
      expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
      expect(JSON.parse(JSON.stringify(result.value))).toEqual({
        id: 1,
        ...sent,
      });
    }
  },
);
