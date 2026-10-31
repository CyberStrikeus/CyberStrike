import { describe, expect, it } from "vitest";
import type { JsonObject } from "./environmentStateRules.js";
import {
  explainCreate,
  explainUpdate,
  type CreateEvidence,
} from "./environmentStateWriteExplain.js";
import type { UpdateEvidence } from "./environmentStateWriteChanges.js";
import type { FieldRule } from "./environmentStateWriteRules.js";
import {
  envelopeOf,
  nestedClockValue,
  pinnedQuery,
  sameQuery,
  stampProblem,
  storedRestamp,
} from "./environmentStateWriteStamps.js";

const START = Date.UTC(2026, 2, 4, 5, 6, 0);
const at = (ms: number): string => new Date(ms).toISOString();
const EDITOR = { id: 1, email: "rea@example.test" };

const created = (
  entity: JsonObject,
  body: JsonObject,
  type: readonly JsonObject[] = [],
): CreateEvidence => ({
  entity,
  call: { path: "/items", pathValues: new Map(), body },
  idField: "id",
  startMs: START,
  collection: [],
  type,
});

const updated = (
  before: JsonObject,
  after: JsonObject,
  body: JsonObject,
  others: readonly JsonObject[] = [],
): UpdateEvidence => ({
  before,
  after,
  call: { path: "/items/42", pathValues: new Map([["item", "42"]]), body },
  method: "PATCH",
  idField: "id",
  id: "42",
  startMs: START,
  others,
});

const ruleFor = (
  rules: readonly FieldRule[],
  field: string,
): FieldRule | undefined => rules.find((rule) => rule.field === field);

describe("values an update stamps without being sent them", () => {
  it("stamps the acting user on a modified-by field its created-by counterpart already names", () => {
    const result = explainUpdate(
      updated(
        {
          id: "42",
          name: "Draft",
          createdByName: "Rea Admin",
          modifiedByName: null,
        },
        {
          id: "42",
          name: "Final",
          createdByName: "Rea Admin",
          modifiedByName: "Rea Admin",
        },
        { name: "Final" },
      ),
    );
    expect(result.unexplained).toEqual([]);
    expect(ruleFor(result.rules, "modifiedByName")).toEqual({
      field: "modifiedByName",
      rule: "stamp",
      value: "Rea Admin",
    });
  });

  it("stamps no field that only shares a name's ending with one holding the value, nor one naming what the call sent", () => {
    const loose = explainUpdate(
      updated(
        {
          id: "42",
          createdByName: "Rea Admin",
          assignedUserName: null,
          locationName: "Pantry",
          categoryName: "Dry",
        },
        {
          id: "42",
          createdByName: "Rea Admin",
          assignedUserName: "Rea Admin",
          locationName: "Pantry",
          categoryName: "Pantry",
        },
        { note: "x" },
      ),
    );
    expect(loose.unexplained).toEqual(["assignedUserName", "categoryName"]);
    const referenced = explainUpdate(
      updated(
        { id: "42", createdByName: "Rea Admin", modifiedByName: null },
        {
          id: "42",
          createdByName: "Rea Admin",
          modifiedByName: "Rea Admin",
          modifiedById: "7",
        },
        { modifiedById: "7" },
      ),
    );
    expect(referenced.unexplained).toContain("modifiedByName");
  });

  it("derives a value from the one member the call stores nowhere when the value shows that member's text", () => {
    const result = explainUpdate(
      updated(
        { id: "42", title: "Post", excerpt: "Old body." },
        { id: "42", title: "Post (edited)", excerpt: "Edited body text." },
        { title: "Post (edited)", html: "<p>Edited body text.</p>" },
      ),
    );
    expect(result.unexplained).toEqual([]);
    expect(ruleFor(result.rules, "excerpt")).toEqual({
      field: "excerpt",
      rule: "derived",
      value: "Edited body text.",
      from: "Old body.",
      member: "html",
    });
  });

  it("derives nothing a member's text does not show, nor beside a second member stored nowhere", () => {
    const unrelated = explainUpdate(
      updated(
        { id: "42", title: "Post", excerpt: "Old body.", visibility: "public" },
        {
          id: "42",
          title: "Post",
          excerpt: "Edited body text.",
          visibility: "members",
        },
        { title: "Post", html: "<p>Edited body text.</p>" },
      ),
    );
    expect(unrelated.unexplained).toEqual(["visibility"]);
    const twoMembers = explainUpdate(
      updated(
        { id: "42", title: "Post", excerpt: "Old body." },
        { id: "42", title: "Post", excerpt: "Edited body text." },
        {
          title: "Post",
          html: "<p>Edited body text.</p>",
          note: "kept nowhere",
        },
      ),
    );
    expect(twoMembers.unexplained).toEqual(["excerpt"]);
  });

  it("refuses a derived value for an entity holding another than the recorded one, and a held clock sent otherwise than held", () => {
    const rules: FieldRule[] = [
      {
        field: "excerpt",
        rule: "derived",
        value: "New.",
        from: "Old body.",
        member: "html",
      },
      {
        field: "updated_at",
        rule: "held-clock",
        format: { kind: "iso", separator: "T", fraction: 3, zone: "Z" },
      },
    ];
    const before = {
      excerpt: "Old body.",
      updated_at: "2026-03-04T05:06:00.000Z",
    };
    expect(
      stampProblem(rules, before, {
        html: "<p>New.</p>",
        updated_at: before.updated_at,
      }),
    ).toBeUndefined();
    expect(
      stampProblem(
        rules,
        { ...before, excerpt: "Custom." },
        { html: "<p>New.</p>" },
      ),
    ).toContain("derives excerpt");
    expect(
      stampProblem(rules, before, { updated_at: "2026-01-01T00:00:00.000Z" }),
    ).toContain("must repeat the value");
    expect(
      stampProblem(
        rules,
        { ...before, excerpt: "Custom." },
        { title: "No html", updated_at: before.updated_at },
      ),
    ).toBeUndefined();
  });
});

describe("the acting user's paired fields and same-second clocks", () => {
  it("stamps the id beside the name naming the acting user, as the recorded pair shows them", () => {
    const result = explainUpdate(
      updated(
        {
          id: "42",
          name: "A",
          createdById: "u1",
          createdByName: "Rea Admin",
          modifiedByName: null,
        },
        {
          id: "42",
          name: "B",
          createdById: "u1",
          createdByName: "Rea Admin",
          modifiedByName: "Rea Admin",
          modifiedById: "u1",
        },
        { name: "B" },
      ),
    );
    expect(result.rules).toContainEqual({
      field: "modifiedById",
      rule: "stamp",
      value: "u1",
    });
    expect(result.rules).toContainEqual({
      field: "modifiedByName",
      rule: "stamp",
      value: "Rea Admin",
    });
    // An id the creator's counterpart does not hold names someone else, so it is not the acting user's.
    const other = explainUpdate(
      updated(
        {
          id: "42",
          name: "A",
          createdById: "u1",
          createdByName: "Rea Admin",
          modifiedByName: null,
        },
        {
          id: "42",
          name: "B",
          createdById: "u1",
          createdByName: "Rea Admin",
          modifiedByName: "Rea Admin",
          modifiedById: "u2",
        },
        { name: "B" },
      ),
    );
    expect(other.rules.map((rule) => rule.field)).not.toContain("modifiedById");
  });

  it("names the unsent whole-second clocks an update left in its own second, and no finer or creation one", () => {
    const second = "2026-03-04T05:06:00Z";
    const result = explainUpdate(
      updated(
        {
          id: "42",
          name: "A",
          modifiedAt: second,
          seenAt: "2026-03-04T05:06:00.250Z",
          createdAt: second,
        },
        {
          id: "42",
          name: "B",
          modifiedAt: second,
          seenAt: "2026-03-04T05:06:00.250Z",
          createdAt: second,
        },
        { name: "B" },
      ),
    );
    expect(result.unstamped).toEqual(["modifiedAt"]);
  });
});

describe("clocks an update sends back unchanged", () => {
  it("stamps anew the one clock a call sent back in whole seconds within the call's second", () => {
    const second = "2026-03-04T05:06:00.000Z";
    const held = explainUpdate(
      updated(
        { id: "42", title: "Post", updated_at: second },
        { id: "42", title: "Post (edited)", updated_at: second },
        { title: "Post (edited)", updated_at: second },
      ),
    );
    expect(ruleFor(held.rules, "updated_at")).toEqual({
      field: "updated_at",
      rule: "held-clock",
      format: { kind: "iso", separator: "T", fraction: 3, zone: "Z" },
    });
    expect(held.body.accepted).toContain("updated_at");
  });

  it("stores as sent a finer clock, and both of two clocks a whole object sent back", () => {
    const finer = "2026-03-04T05:05:59.4970762Z";
    const echoed = explainUpdate(
      updated(
        { id: "42", title: "Item", DateCreated: finer },
        { id: "42", title: "Item (edited)", DateCreated: finer },
        { title: "Item (edited)", DateCreated: finer },
      ),
    );
    expect(ruleFor(echoed.rules, "DateCreated")).toEqual({
      field: "DateCreated",
      rule: "echo",
    });
    const second = "2026-03-04T05:06:00.000Z";
    const whole = explainUpdate(
      updated(
        { id: "42", title: "Post", created_at: second, updated_at: second },
        {
          id: "42",
          title: "Post (edited)",
          created_at: second,
          updated_at: second,
        },
        { title: "Post (edited)", created_at: second, updated_at: second },
      ),
    );
    expect(ruleFor(whole.rules, "created_at")?.rule).toBe("echo");
    expect(ruleFor(whole.rules, "updated_at")?.rule).toBe("echo");
  });

  it("echoes a creation clock a call sent back in the second the entity was made", () => {
    const second = "2026-03-04T05:06:00.000Z";
    const result = explainUpdate(
      updated(
        { id: "42", title: "Post", created_at: second },
        { id: "42", title: "Post (edited)", created_at: second },
        { title: "Post (edited)", created_at: second },
      ),
    );
    expect(ruleFor(result.rules, "created_at")).toEqual({
      field: "created_at",
      rule: "echo",
    });
  });
});

describe("objects whose clocks a write stamps", () => {
  const editInfo = (ms: number) => ({ timestamp: at(ms), ...EDITOR });

  it("stamps the clocks of an object a create wrote, where the type shows the same object stamped otherwise", () => {
    const result = explainCreate(
      created(
        { id: 7, name: "Tally", editInfo: editInfo(START + 30) },
        { name: "Tally" },
        [{ id: 2, name: "Old", editInfo: editInfo(START - 86_400_000) }],
      ),
    );
    expect(ruleFor(result.rules, "editInfo")).toEqual({
      field: "editInfo",
      rule: "nested-clock",
      members: ["timestamp"],
      format: { kind: "iso", separator: "T", fraction: 3, zone: "Z" },
    });
  });

  it("stamps no object other entities hold otherwise, nor a parent made just before the request", () => {
    const parent = (ms: number, id: number) => ({
      id,
      name: `Parent ${String(id)}`,
      created_at: at(ms),
    });
    const references = explainCreate(
      created({ id: 7, parent: parent(START + 30, 9) }, { name: "Child" }, [
        { id: 2, parent: parent(START - 86_400_000, 3) },
      ]),
    );
    expect(ruleFor(references.rules, "parent")).toBeUndefined();
    const earlier = explainCreate(
      created({ id: 7, editInfo: editInfo(START - 1_500) }, { name: "Tally" }, [
        { id: 2, editInfo: editInfo(START - 86_400_000) },
      ]),
    );
    expect(ruleFor(earlier.rules, "editInfo")).toBeUndefined();
  });

  it("restamps an object an update changed only in clocks, and not one it gave an object to", () => {
    const others = [{ id: "43", editInfo: editInfo(START - 86_400_000) }];
    const restamped = explainUpdate(
      updated(
        { id: "42", name: "Tally", editInfo: editInfo(START - 60_000) },
        { id: "42", name: "Tally 2", editInfo: editInfo(START + 40) },
        { name: "Tally 2" },
        others,
      ),
    );
    expect(ruleFor(restamped.rules, "editInfo")).toMatchObject({
      rule: "nested-clock",
      members: ["timestamp"],
    });
    const filled = explainUpdate(
      updated(
        { id: "42", name: "Tally", editInfo: null },
        { id: "42", name: "Tally 2", editInfo: editInfo(START + 40) },
        { name: "Tally 2" },
        others,
      ),
    );
    expect(filled.unexplained).toEqual(["editInfo"]);
  });

  it("serves a nested clock only on an entity holding the object, keeping its other members", () => {
    const rule: Extract<FieldRule, { rule: "nested-clock" }> = {
      field: "editInfo",
      rule: "nested-clock",
      members: ["timestamp"],
      format: { kind: "iso", separator: "T", fraction: 3, zone: "Z" },
    };
    expect(nestedClockValue({ timestamp: "old", id: 3 }, rule, "now")).toEqual({
      ok: true,
      value: { timestamp: "now", id: 3 },
    });
    expect(nestedClockValue(null, rule, "now").ok).toBe(false);
  });

  it("stores a nested clock as a read restamped it, within seconds and in those members only", () => {
    const own = { timestamp: "2026-10-18T20:39:29.464Z", id: 1 };
    const read = { id: 1, timestamp: "2026-10-18T20:39:29.453678Z" };
    expect(storedRestamp(own, read, ["timestamp"])).toEqual(read);
    expect(
      storedRestamp(own, { ...read, id: 2 }, ["timestamp"]),
    ).toBeUndefined();
    expect(
      storedRestamp(own, { ...read, timestamp: "2026-10-18T20:39:35.000Z" }, [
        "timestamp",
      ]),
    ).toBeUndefined();
  });
});

describe("generated tokens", () => {
  it("generates opaque tokens like the ones the type holds, unless another field repeats the value", () => {
    const nanoid = explainCreate(
      created(
        { id: 7, name: "Tally", entity_id: "cdMLcknG-Lcu6oWL-3ZgA" },
        { name: "Tally" },
        [{ id: 2, entity_id: "chYl65ZvCJ9U6yNk-YyqK" }],
      ),
    );
    expect(ruleFor(nanoid.rules, "entity_id")).toEqual({
      field: "entity_id",
      rule: "unique",
    });
    const repeated = explainCreate(
      created(
        {
          id: "6ad47ba51023b5000108740b",
          title: "Post",
          comment_id: "6ad47ba51023b5000108740b",
        },
        { title: "Post" },
        [
          {
            id: "6ad47b5c1023b500010873e3",
            comment_id: "6ad47b5c1023b500010873e3",
          },
        ],
      ),
    );
    expect(ruleFor(repeated.rules, "comment_id")?.rule).not.toBe("unique");
    const etag = explainUpdate(
      updated(
        { id: "42", Name: "Item", Etag: "3f4bd8a5a1c74f2fbd4c1e2d9a6b7c80" },
        { id: "42", Name: "Item 2", Etag: "9e1c5b7a2d4f4a8e8c3b6d1f0a2e4c69" },
        { Name: "Item 2" },
        [{ id: "43", Etag: "5a6b7c8d9e0f41a2b3c4d5e6f7a8b9c0" }],
      ),
    );
    expect(ruleFor(etag.rules, "Etag")).toEqual({
      field: "Etag",
      rule: "unique",
    });
  });

  it("slugs a renamed title before reading the slug as a fresh token", () => {
    const result = explainUpdate(
      updated(
        {
          id: "42",
          title: "Quarterly report 2025",
          slug: "quarterly-report-2025",
        },
        {
          id: "42",
          title: "Quarterly report 2026",
          slug: "quarterly-report-2026",
        },
        { title: "Quarterly report 2026" },
      ),
    );
    expect(ruleFor(result.rules, "slug")).toEqual({
      field: "slug",
      rule: "slug",
      from: "title",
    });
  });
});

describe("members accepted only as recorded", () => {
  const card = {
    id: 7,
    name: "Tally",
    collection_id: 8,
    collection: { id: 8, name: "Ledger" },
  };

  it("takes only the recorded value of a member naming an object the entity nests", () => {
    const result = explainCreate(
      created(card, { name: "Tally", collection_id: 8 }),
    );
    expect(result.body.accepted).toEqual(["name"]);
    expect(result.body.fixed).toEqual([{ member: "collection_id", sent: 8 }]);
    const update = explainUpdate(
      updated(
        { ...card, id: "42" },
        { ...card, id: "42", name: "Tally 2" },
        { name: "Tally 2", collection_id: 8 },
      ),
    );
    expect(update.body.fixed.map(({ member }) => member)).toEqual([
      "collection_id",
    ]);
  });

  it("takes only the recorded state other fields go with", () => {
    const post = { id: 9, title: "New", status: "draft", published_at: null };
    const others = [
      {
        id: 1,
        title: "A",
        status: "published",
        published_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        title: "B",
        status: "published",
        published_at: "2026-01-02T00:00:00Z",
      },
    ];
    const pinned = explainCreate(
      created(post, { title: "New", status: "draft" }, others),
    );
    expect(pinned.body.fixed).toEqual([{ member: "status", sent: "draft" }]);
    // A value each entity holds its own of names it, not a state.
    const slugged = explainCreate(
      created(
        { id: 9, slug: "new-post", published_at: null },
        { slug: "new-post" },
        [
          { id: 1, slug: "a-post", published_at: "2026-01-01T00:00:00Z" },
          { id: 2, slug: "b-post", published_at: "2026-01-02T00:00:00Z" },
        ],
      ),
    );
    expect(slugged.body.accepted).toEqual(["slug"]);
  });
});

describe("call shapes", () => {
  it("reads a body that wraps one object in a one-element array as that object, and spells one query one way", () => {
    expect(envelopeOf({ posts: [{ title: "Post" }] })).toEqual({
      member: "posts",
      object: { title: "Post" },
    });
    expect(
      envelopeOf({ posts: [{ title: "A" }, { title: "B" }] }),
    ).toBeUndefined();
    expect(envelopeOf({ posts: [{ title: "A" }], meta: {} })).toBeUndefined();
    expect(sameQuery("?source=html&b=2", "b=2&source=html")).toBe(true);
    expect(sameQuery(null, "")).toBe(true);
    expect(sameQuery("a=1&a=2", "a=1&a=2")).toBe(false);
    // A call that leaves a pinned parameter out takes the recorded value; another value or parameter is refused.
    const recorded = "?source=html";
    expect(pinnedQuery(recorded, new Map())).toEqual({
      ok: true,
      value: new Map([["source", "html"]]),
    });
    expect(pinnedQuery(recorded, new Map([["source", "markdown"]]))).toEqual({
      ok: false,
      error: "takes only the query its recording sent (source=html).",
    });
    expect(pinnedQuery(null, new Map([["page", "2"]])).ok).toBe(false);
  });
});

it("does not explain nested opaque-token references as independent generation", () => {
  const before = "Abcdef0123456789A";
  const after = "Abcdef0123456789B";
  const other = "Abcdef0123456789C";
  for (const metadata of [
    { version: after },
    [after],
    { text: `token:${after}` },
  ]) {
    const creation = explainCreate(
      created(
        { id: "42", title: "New", version: after, metadata },
        { title: "New" },
        [{ id: "41", version: before }],
      ),
    );
    expect(ruleFor(creation.rules, "version")?.rule).not.toBe("unique");
    const update = explainUpdate(
      updated(
        { id: "42", version: before, metadata },
        { id: "42", version: after, metadata },
        {},
        [{ id: "41", version: other }],
      ),
    );
    expect(update.unexplained).toContain("version");
  }
});

it.each(["__proto__", "constructor", "toString"])(
  "treats an absent %s stamp field as missing JSON data",
  (field) => {
    const rule: FieldRule = {
      rule: "derived",
      field,
      member: "change",
      from: null,
      value: 1,
    };
    expect(stampProblem([rule], {}, { change: true })).toBeUndefined();
    expect(
      stampProblem([rule], Object.fromEntries([[field, 7]]), { change: true }),
    ).toContain("accepted only");
  },
);
