import { describe, expect, it } from "vitest";
import type { JsonValue } from "../jsonValue.js";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  LISTED_LABEL_ROWS,
  READ_BACK_TAG_ROWS,
  RESTAMPED_ROWS,
  STALE_SLUG_ROWS,
  clockSaveRows,
  slugSaveRows,
  slugOnlySaveRows,
} from "../../../tests/fixtures/environmentStateWriteViews.js";
import { environmentStateViewOf } from "../../../tests/fixtures/environmentStateWrites.js";

const planOf = (rows: readonly TimedCaptureRow[], tool: string) => {
  const plan = environmentStateViewOf(timedCaptureEvidence(rows)).writes.find(
    (candidate) => candidate.tool === tool,
  );
  if (plan === undefined) throw new Error(`No plan for ${tool}`);
  return plan;
};

describe("creates whose answer shows the entity otherwise than reads do", () => {
  it.each(["123456", "123457"])(
    "checks read-back precision beyond milliseconds (%s)",
    (fraction) => {
      const rows = READ_BACK_TAG_ROWS.map(
        ([method, path, body = null, ...rest]): TimedCaptureRow => {
          const rewrite = (value: JsonValue): JsonValue => {
            if (Array.isArray(value)) return value.map(rewrite);
            if (value !== null && typeof value === "object")
              return Object.fromEntries(
                Object.entries(value).map(([key, child]) => [
                  key,
                  key === "created" && typeof child === "string"
                    ? child.replace(
                        /(?:\.\d+)?Z$/u,
                        method === "POST" ? ".123456000Z" : `.${fraction}Z`,
                      )
                    : child,
                ]),
              );
            return value;
          };
          return [method, path, rewrite(body), ...rest];
        },
      );
      expect(planOf(rows, "post_tags").served).toBe(fraction === "123456");
    },
  );

  it("keeps an item read's omission as contradictory evidence even when a later list confirms the added fields", () => {
    const rows = READ_BACK_TAG_ROWS.map(
      ([method, path, body = null, ...rest]): TimedCaptureRow => [
        method,
        path,
        body !== null &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        (method === "POST" || path === "/api/tags/1" || path === "/api/tags/2")
          ? { ...body, detail: "Only in the answer" }
          : body,
        ...rest,
      ],
    );
    expect(planOf(rows, "post_tags")).toMatchObject({
      served: false,
      reason: "contradicted",
    });
  });
  it("serves a create whose item read adds a count and spells the clock otherwise, taking the read's fields", () => {
    expect(planOf(READ_BACK_TAG_ROWS, "post_tags")).toMatchObject({
      served: true,
      observation: {
        ordinal: 3,
        pointer: "",
        read: { ordinal: 4, pointer: "", shape: "item" },
      },
      rules: expect.arrayContaining([
        {
          field: "created",
          rule: "clock",
          format: expect.objectContaining({ fraction: 0 }),
        },
      ]),
    });
  });

  it("serves a create whose list read adds a count the answer lacks", () => {
    expect(planOf(LISTED_LABEL_ROWS, "post_labels")).toMatchObject({
      served: true,
      observation: { read: { ordinal: 2, pointer: "/2", shape: "list" } },
    });
  });
});

describe("whole-object updates that send back what the application derives", () => {
  it.each([
    [true, true],
    [false, true],
    [true, false],
    [false, false],
  ] as const)(
    "checks slug-only saves too (derived first: %s, changed: %s)",
    (derivedFirst, changed) => {
      expect(
        planOf(slugOnlySaveRows(derivedFirst, changed), "patch_tags_by_id")
          .served,
      ).toBe(!changed);
    },
  );
  it.each([true, false])(
    "reconciles slug saves in either order (derived first: %s)",
    (derivedFirst) => {
      expect(
        planOf(slugSaveRows(derivedFirst), "put_tags_by_id"),
      ).toMatchObject({
        served: true,
        rules: expect.arrayContaining([
          { field: "slug", rule: "slug", from: "name" },
        ]),
      });
    },
  );

  it.each([true, false])(
    "rejects a slug rule contradicted by an explicit custom slug (derived first: %s)",
    (derivedFirst) => {
      expect(
        planOf(slugSaveRows(derivedFirst, true), "put_tags_by_id").served,
      ).toBe(false);
    },
  );

  it.each([true, false])(
    "reconciles held and fresh clocks in either order (derived first: %s)",
    (derivedFirst) => {
      expect(
        planOf(clockSaveRows(derivedFirst), "put_posts_by_id"),
      ).toMatchObject({
        served: true,
        rules: expect.arrayContaining([
          expect.objectContaining({ field: "updated_at", rule: "clock" }),
        ]),
      });
    },
  );
  it("slugs a sent slug anew from the name the call stored", () => {
    expect(planOf(STALE_SLUG_ROWS, "put_tags_by_id")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        { field: "slug", rule: "slug", from: "name" },
        { field: "name", rule: "echo" },
      ]),
      body: { accepted: expect.arrayContaining(["slug", "name"]) },
    });
  });

  it("stamps anew a modification time each call sends back as it read it", () => {
    expect(planOf(RESTAMPED_ROWS, "put_posts_by_id")).toMatchObject({
      served: true,
      rules: expect.arrayContaining([
        expect.objectContaining({ field: "updated_at", rule: "clock" }),
      ]),
      body: { accepted: expect.arrayContaining(["updated_at"]) },
    });
  });
});
