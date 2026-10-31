import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  FILED_ROWS,
  REFILED_ROWS,
  TAGGED_ROWS,
} from "../../../tests/fixtures/environmentStateDerivedValues.js";
import { environmentStateViewOf } from "../../../tests/fixtures/environmentStateWrites.js";
import type { StateEntity } from "./environmentStateRules.js";
import { ClockSpellings } from "./environmentStateViewSpellings.js";
import { alikeRules, type FieldRule } from "./environmentStateWriteRules.js";
import {
  referenceRule,
  referencedValue,
} from "./environmentStateWriteReferences.js";

const SHELF = { id: 2, name: "Map Room", floor: "upper" };
const held = (
  type: string,
  id: string,
  fields: StateEntity["fields"],
): StateEntity => ({
  type,
  collection: type,
  id,
  fields,
  view_fields: [],
  record_ordinals: [],
});

describe("objects that repeat the entity a member names", () => {
  it("serves creates that embed the named shelf, and lists show it with the keys they list", () => {
    const view = environmentStateViewOf(timedCaptureEvidence(FILED_ROWS));
    expect(
      view.writes.find((plan) => plan.tool === "post_books"),
    ).toMatchObject({
      served: true,
      body: { accepted: expect.arrayContaining(["name", "shelf_id"]) },
      rules: expect.arrayContaining([
        {
          field: "shelf",
          rule: "reference",
          member: "shelf_id",
          type: "/api/shelves",
          fields: ["id", "name", "floor"],
        },
      ]),
    });
    expect(
      view.views.find((candidate) => candidate.tool === "get_books"),
    ).toMatchObject({
      nested_fields: { shelf: ["id", "name"] },
    });
  });

  it("learns the keys a view shows of a shelf in whatever order each object gives them, keeping the first order", () => {
    const spellings = new ClockSpellings(() => undefined);
    spellings.note({ shelf: SHELF }, { shelf: { id: 2, name: "Map Room" } });
    spellings.note({ shelf: SHELF }, { shelf: { name: "Map Room", id: 2 } });
    expect(spellings.view).toEqual({
      nested_fields: { shelf: ["id", "name"] },
    });
    spellings.note({ shelf: SHELF }, { shelf: { id: 2 } });
    expect(spellings.view).toEqual({});
  });

  it("serves updates that keep a shelf a later call names again", () => {
    const view = environmentStateViewOf(timedCaptureEvidence(REFILED_ROWS));
    expect(view.writes.find((plan) => plan.effect === "update")).toMatchObject({
      served: true,
      body: { accepted: expect.arrayContaining(["name", "shelf_id"]) },
      rules: expect.arrayContaining([
        expect.objectContaining({ field: "shelf", rule: "reference" }),
      ]),
    });
  });

  it("names the member whose entity the object repeats, the one named like the field when several do", () => {
    const named = (id: string) =>
      id === "2"
        ? [held("/api/shelves", "2", SHELF), held("/api/rooms", "2", SHELF)]
        : [];
    expect(
      referenceRule("shelf", SHELF, { shelf_id: 2 }, named),
    ).toBeUndefined();
    const shelves = (id: string) =>
      id === "2" ? [held("/api/shelves", "2", SHELF)] : [];
    expect(
      referenceRule("shelf", SHELF, { shelf_id: 2, room_id: 2 }, shelves),
    ).toMatchObject({ member: "shelf_id", type: "/api/shelves" });
    expect(
      referenceRule("shelf", { id: 2 }, { shelf_id: 2 }, shelves),
    ).toBeUndefined();
    // One id naming a shelf in two collections names neither.
    expect(
      referenceRule("shelf", SHELF, { shelf_id: 2 }, (id) =>
        id === "2"
          ? [
              held("/api/shelves", "2", SHELF),
              { ...held("/api/shelves", "2", SHELF), collection: "/api/annex" },
            ]
          : [],
      ),
    ).toBeUndefined();
    expect(
      referenceRule(
        "shelf",
        { ...SHELF, floor: "lower" },
        { shelf_id: 2 },
        shelves,
      ),
    ).toBeUndefined();
  });

  it("learns a list reference only when every element lists the same nonempty fields", () => {
    const named = (id: string) =>
      id === "1" || id === "2"
        ? [
            held("/api/tags", id, {
              id,
              name: id === "1" ? "Tools" : "Winter",
              color: "#aa0000",
            }),
          ]
        : [];
    expect(
      referenceRule(
        "tags",
        [
          { id: "1", name: "Tools" },
          { id: "2", name: "Winter" },
        ],
        { tagIds: ["1", "2"] },
        named,
      ),
    ).toMatchObject({ many: true, fields: ["id", "name"] });
    expect(
      referenceRule(
        "tags",
        [
          { id: "1", name: "Tools" },
          { id: "2", name: "Winter", color: "#aa0000" },
        ],
        { tagIds: ["1", "2"] },
        named,
      ),
    ).toBeUndefined();
    expect(
      referenceRule("tags", [{}], { tagIds: ["1"] }, named),
    ).toBeUndefined();
  });

  it("refuses a call naming an entity the environment does not hold, or holds in several collections", () => {
    const rule: Extract<FieldRule, { rule: "reference" }> = {
      field: "shelf",
      rule: "reference",
      member: "shelf_id",
      type: "/api/shelves",
      fields: ["id", "name"],
    };
    expect(referencedValue(rule, { shelf_id: 9 }, () => [])).toMatchObject({
      ok: false,
    });
    expect(referencedValue(rule, {}, () => [])).toEqual({
      ok: true,
      value: undefined,
    });
    expect(referencedValue(rule, { shelf_id: 2 }, () => [SHELF])).toEqual({
      ok: true,
      value: { id: 2, name: "Map Room" },
    });
    expect(
      referencedValue(rule, { shelf_id: 2 }, () => [SHELF, SHELF]),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("2 collections"),
    });
  });
});

describe("arrays an application stores sorted", () => {
  it("does not sort tags an earlier create stored out of order as sent", () => {
    const kept = TAGGED_ROWS.map((row, index): TimedCaptureRow => {
      if (index !== 2 && index !== 3) return row;
      const [method, path, response, ...rest] = row;
      return [
        method,
        path,
        { ...(response as object), tags: ["zoning", "maps"] },
        ...rest,
      ];
    });
    const plan = environmentStateViewOf(timedCaptureEvidence(kept)).writes.find(
      (candidate) => candidate.tool === "post_books",
    );
    expect(plan?.rules).toContainEqual({ field: "tags", rule: "echo" });
    expect(plan).toMatchObject({ served: false });
  });

  it("keeps an echo sorted only while no call kept its strings out of order", () => {
    const plain: FieldRule = { field: "tags", rule: "echo" };
    const sorted: FieldRule = { field: "tags", rule: "echo", sorted: true };
    expect(alikeRules(plain, sorted)).toEqual(sorted);
    expect(alikeRules(sorted, plain)).toEqual(sorted);
    expect(alikeRules(plain, sorted, new Set(["tags"]))).toBeUndefined();
    expect(alikeRules(sorted, plain, new Set(["tags"]))).toBeUndefined();
  });

  it("serves creates that store sent tags in code-point order", () => {
    const view = environmentStateViewOf(timedCaptureEvidence(TAGGED_ROWS));
    expect(
      view.writes.find((plan) => plan.tool === "post_books"),
    ).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "tags", rule: "echo", sorted: true },
      ]),
    });
  });
});
