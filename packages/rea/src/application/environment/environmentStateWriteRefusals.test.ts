import { EnvironmentStateStore } from "./environmentStateStore.js";
import { environmentToolAnswer } from "./environmentToolAnswer.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import type { StateWritePlan } from "../../domain/analysisView/environmentStateWriteRules.js";
import { describe, expect, it } from "vitest";

import type { TimedCaptureRow } from "../../../tests/fixtures/analysisView.js";
import {
  servedFrom,
  type Served,
} from "../../../tests/fixtures/environmentStateServing.js";
import {
  FIRST_BOOK,
  SECOND_BOOK,
  renamedBook,
  type Book,
} from "../../../tests/fixtures/environmentStateWrites.js";
import { MAX_JSON_DEPTH, type JsonValue } from "../../domain/jsonValue.js";
import type { ReplayArguments } from "./environmentReplay.js";
import { STATE_INTAKE_LIMIT_BYTES } from "./environmentStateDocument.js";

const DARK = { theme: "dark", meta: { n: 1 } };
const LIGHT = { theme: "light", meta: { n: 2 } };

/** One organisation's settings document, read, patched with both members and read again. */
const SETTINGS_ROWS: readonly TimedCaptureRow[] = [
  ["GET", "/api/orgs/1/settings", DARK],
  ["PATCH", "/api/orgs/1/settings", LIGHT, 200, LIGHT],
  ["GET", "/api/orgs/1/settings", LIGHT],
];

const READ_SETTINGS = "get_orgs_settings_by_id";
const PATCH_SETTINGS = "patch_orgs_settings_by_id";

/** Every refused call is a tool error naming its problem, and leaves the state as it was. */
const expectRefusedUnchanged = (
  served: Served,
  refused: readonly (readonly [string, ReplayArguments, string])[],
): void => {
  const before = served.snapshot();
  for (const [name, args, message] of refused) {
    expect(served.refusal(name, args)).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining(message),
    });
    expect(served.snapshot()).toBe(before);
  }
};

/** What data/get reports loads back through data/add byte for byte. */
const expectReloadsUnchanged = (served: Served): void => {
  const before = served.snapshot();
  expect(served.store.replace(JSON.parse(before)).ok).toBe(true);
  expect(served.snapshot()).toBe(before);
};

const nested = (depth: number): JsonValue =>
  Array.from({ length: depth }).reduce<JsonValue>((inner) => [inner], 1);

describe("served document writes", () => {
  it("accepts only the members the capture sent, as the JSON types the document holds", () => {
    const settings = servedFrom(SETTINGS_ROWS);
    expect(settings.state.writes.get(PATCH_SETTINGS)).toMatchObject({
      served: true,
      effect: "document",
    });
    expectRefusedUnchanged(settings, [
      [
        PATCH_SETTINGS,
        { id: "1", body: { theme: 5, extra: true } },
        "Member theme must be a JSON string",
      ],
      [
        PATCH_SETTINGS,
        { id: "1", body: { extra: true } },
        "Member extra is not one the capture showed stored",
      ],
    ]);
    const blue = { theme: "blue", meta: DARK.meta };
    expect(
      settings.answer(PATCH_SETTINGS, { id: "1", body: { theme: "blue" } }),
    ).toMatchObject({
      body: blue,
      state: { view: "document-write", path: "/api/orgs/1/settings" },
    });
    expect(settings.answer(READ_SETTINGS, { id: "1" }).body).toEqual(blue);
  });

  it("leaves a document write unserved when its recording changed a member's JSON type, which serving would refuse", () => {
    const retyped = { theme: 5, meta: LIGHT.meta };
    const settings = servedFrom([
      ["GET", "/api/orgs/1/settings", DARK],
      ["PATCH", "/api/orgs/1/settings", retyped, 200, retyped],
      ["GET", "/api/orgs/1/settings", retyped],
    ]);
    expect(settings.state.writes.get(PATCH_SETTINGS)).toMatchObject({
      served: false,
      reason: "unexplained-change",
    });
  });

  it("does not confirm a document write at another path, which serving refuses", () => {
    const settings = servedFrom([
      ["GET", "/api/orgs/1/settings", DARK],
      ["PATCH", "/api/orgs/2/settings", LIGHT, 200, LIGHT],
      ["GET", "/api/orgs/1/settings", LIGHT],
    ]);
    expect(settings.state.writes.get(PATCH_SETTINGS)).toMatchObject({
      served: false,
    });
  });

  it("changes the document only at the path the state holds it", () => {
    const settings = servedFrom(SETTINGS_ROWS);
    expectRefusedUnchanged(settings, [
      [
        PATCH_SETTINGS,
        { id: "2", body: { theme: "blue" } },
        "holds this document only at /api/orgs/1/settings",
      ],
    ]);
    expect(settings.answer(READ_SETTINGS, { id: "1" }).body).toEqual(DARK);
  });
});

describe("values the state can load back", () => {
  it("preserves nested prototype-named data through writes and reload", () => {
    const settings = servedFrom(SETTINGS_ROWS);
    const meta = JSON.parse(
      '{"__proto__":{"n":1},"constructor":2,"prototype":3}',
    );
    expect(
      settings.answer(PATCH_SETTINGS, { id: "1", body: { meta } }).body,
    ).toEqual({ theme: "dark", meta });
    expect(settings.answer(READ_SETTINGS, { id: "1" }).body).toEqual({
      theme: "dark",
      meta,
    });
    expectReloadsUnchanged(settings);
  });

  it("refuses a body value data/add would refuse, whatever member carries it", () => {
    const settings = servedFrom(SETTINGS_ROWS);
    const unexact =
      "Member meta would hold a value that is not exactly representable JSON";
    expectRefusedUnchanged(settings, [
      [PATCH_SETTINGS, { id: "1", body: { meta: { n: 1e20 } } }, unexact],
      [
        PATCH_SETTINGS,
        { id: "1", body: { meta: { n: nested(MAX_JSON_DEPTH) } } },
        unexact,
      ],
    ]);
    settings.answer(PATCH_SETTINGS, { id: "1", body: { meta: { n: 3 } } });
    expectReloadsUnchanged(settings);
  });

  it("refuses an increment past the exact integers, so data/get still loads back", () => {
    const versioned = (entry: Book, version: number): Book => ({
      ...entry,
      version,
    });
    const last = Number.MAX_SAFE_INTEGER;
    const edition = versioned(renamedBook(SECOND_BOOK, "Second Edition", 3), 2);
    const books = servedFrom([
      [
        "GET",
        "/api/books",
        [versioned(FIRST_BOOK, last - 1), versioned(SECOND_BOOK, 1)],
      ],
      ["GET", "/api/books/1", versioned(FIRST_BOOK, last - 1)],
      ["GET", "/api/books/2", versioned(SECOND_BOOK, 1)],
      ["PATCH", "/api/books/2", edition, 200, { name: "Second Edition" }],
      ["GET", "/api/books/2", edition],
    ]);
    const rename = (name: string) => ({ id: "1", body: { name } });
    expect(
      books.answer("patch_books_by_id", rename("Renamed")).body,
    ).toMatchObject({ version: last });
    expectRefusedUnchanged(books, [
      [
        "patch_books_by_id",
        rename("Renamed Again"),
        "Field version would hold a value that is not exactly representable JSON",
      ],
    ]);
    expectReloadsUnchanged(books);
  });
});

describe("the state size limit", () => {
  it("keeps the size data/get writes as each write changes the state", () => {
    const books = servedFrom();
    const settings = servedFrom(SETTINGS_ROWS);
    const tracked = (served: Served) =>
      expect(served.store.byteLength()).toBe(
        Buffer.byteLength(served.snapshot(), "utf8"),
      );
    tracked(books);
    books.answer("post_books", { body: { name: "Ünïcode Bøok" } });
    tracked(books);
    books.answer("patch_books_by_id", { id: "3", body: { name: "Short" } });
    tracked(books);
    books.answer("delete_books_by_id", { id: "1" });
    books.answer("delete_books_by_id", { id: "2" });
    books.answer("delete_books_by_id", { id: "3" });
    tracked(books);
    books.answer("post_books", { body: { name: "Only Book" } });
    tracked(books);
    settings.answer(PATCH_SETTINGS, { id: "1", body: { theme: "dark blue" } });
    tracked(settings);
    expect(settings.store.replace(JSON.parse(settings.snapshot())).ok).toBe(
      true,
    );
    tracked(settings);
  });

  it("refuses a create that would take data/get past what data/add loads", () => {
    const books = servedFrom();
    // Each answer renders the book, so each stays under the reply body limit.
    const create = { body: { name: "a".repeat(100_000) } };
    let refused: ReturnType<Served["call"]> | undefined;
    for (let made = 0; made < 200 && refused === undefined; made += 1) {
      const result = books.call("post_books", create);
      if (!result.ok) refused = result;
    }
    const before = books.snapshot();
    expect(Buffer.byteLength(before, "utf8")).toBeLessThanOrEqual(
      STATE_INTAKE_LIMIT_BYTES,
    );
    expect(refused?.ok === false && refused.error).toMatchObject({
      resource: "capacity",
      reportedLimits: { max_state_bytes: STATE_INTAKE_LIMIT_BYTES },
    });
    expect(books.refusal("post_books", create)).toMatchObject({
      code: "resource_constraint",
    });
    expect(books.snapshot()).toBe(before);
    expectReloadsUnchanged(books);
    // A smaller state has room again.
    books.answer("delete_books_by_id", { id: "3" });
    expect(books.answer("post_books", create).status).toBe(201);
  });

  it("refuses a document that data/get would write past what data/add loads", () => {
    const books = servedFrom();
    const { rea_state: state } = books.store.snapshot();
    // Without the members data/get adds back, the document fits only until they return.
    const document = {
      rea_state: {
        version: state.version,
        entities: state.entities.map(({ type, collection, id, fields }) => ({
          type,
          collection,
          id,
          fields: { ...fields },
        })),
        documents: state.documents,
      },
    };
    const first = document.rea_state.entities[0]!.fields;
    first["name"] = `${String(first["name"])}${"a".repeat(
      STATE_INTAKE_LIMIT_BYTES -
        Buffer.byteLength(JSON.stringify(document), "utf8"),
    )}`;
    expect(Buffer.byteLength(JSON.stringify(document), "utf8")).toBe(
      STATE_INTAKE_LIMIT_BYTES,
    );
    const before = books.snapshot();
    const replaced = books.store.replace(document);
    expect(replaced.ok).toBe(false);
    expect(!replaced.ok && replaced.error.issues).toEqual([
      expect.objectContaining({
        reason: "out_of_range",
        maximum: STATE_INTAKE_LIMIT_BYTES,
      }),
    ]);
    expect(books.snapshot()).toBe(before);
  });
});

it.each(["clock", "held-clock", "nested-clock"] as const)(
  "refuses a legacy served %s plan with an unknown clock before changing state or generators",
  (rule) => {
    const fixture = servedFrom();
    const original = fixture.state.writes.get("patch_books_by_id");
    if (original === undefined || !original.served)
      throw new Error("Expected served fixture update");
    const format = { kind: "epoch", unit: "ms" } as const;
    const plan: StateWritePlan = {
      ...original,
      rules:
        rule === "nested-clock"
          ? [{ field: "updated_at", rule, format, members: ["at"] }]
          : [{ field: "updated_at", rule, format }],
    };
    const writes = new Map(fixture.state.writes).set(plan.tool, plan);
    const state = { ...fixture.state, writeClock: null, writes };
    const store = new EnvironmentStateStore(state);
    const respond = environmentToolAnswer(fixture.source, store);
    const tool = fixture.source.manifest.tools.find(
      (candidate) => candidate.name === plan.tool,
    );
    const deletion = fixture.source.manifest.tools.find(
      (candidate) => candidate.name === "delete_books_by_id",
    );
    if (tool === undefined || deletion === undefined)
      throw new Error("Expected fixture tools");
    const before = JSON.stringify(store.snapshot());
    const pending = store.pendingWrite();
    const result = respond(tool, { id: "1", body: { name: "Refused" } });
    if (result.ok) throw new Error("Expected unknown clock refusal");
    expect(result.error._tag).toBe("AnalysisInputError");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("requires a known write clock"),
    });
    expect(JSON.stringify(store.snapshot())).toBe(before);
    expect(store.pendingWrite()).toEqual(pending);
    expect(store.state.writes.get(plan.tool)).toBe(plan);
    // Independent writes keep working; the guard does not erase imported metadata.
    expect(respond(deletion, { id: "1" }).ok).toBe(true);
    expect(JSON.stringify(store.snapshot())).not.toBe(before);
  },
);
