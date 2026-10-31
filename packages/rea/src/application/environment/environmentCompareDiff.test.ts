import { describe, expect, it } from "vitest";

import type { JsonValue } from "../../domain/jsonValue.js";
import type { FieldRule } from "../../domain/analysisView/environmentStateWriteRules.js";
import { compareAnswers } from "./environmentCompareDiff.js";
import { IdMap, learnIds } from "./environmentCompareIds.js";
import { bookmark } from "../../../tests/fixtures/environmentStateDerivedValues.js";

const compare = (
  live: unknown,
  env: unknown,
  map = new IdMap(),
  status: [number, number] = [200, 200],
  rules: readonly FieldRule[] = [],
) =>
  compareAnswers(
    { status: status[0], body: { kind: "json", value: live as JsonValue } },
    { status: status[1], body: { kind: "json", value: env as JsonValue } },
    map,
    { rules },
  );

describe("early-year clock formats", () => {
  it.each(["0000", "0001", "0099", "0100"])(
    "classifies a year-%s clock spelling difference by format",
    (year) => {
      const result = compare(
        { created_at: `${year}-01-01T00:00:00Z` },
        { created_at: `${year}-01-01 00:00:00.000Z` },
      );
      expect(
        result.differences.map(({ category, pointer }) => [category, pointer]),
      ).toEqual([["clock-format", "/created_at"]]);
    },
  );
});

describe("composed response values", () => {
  const rules: readonly FieldRule[] = [
    {
      field: "date_added",
      rule: "clock",
      format: { kind: "iso", separator: "T", fraction: 0, zone: "Z" },
    },
    {
      field: "date_modified",
      rule: "clock",
      format: { kind: "iso", separator: "T", fraction: 0, zone: "Z" },
    },
    {
      field: "web_archive_snapshot_url",
      rule: "composed",
      parts: [
        { text: "https://web.archive.org/web/" },
        { from: "date_added", as: "clock", pattern: "YYYYMMDDhhmmss" },
        { text: "/" },
        { from: "url", as: "value" },
      ],
    },
  ];
  const live = bookmark(
    1,
    "https://example.test/page",
    "A bookmark",
    "2026-10-20T09:00:00Z",
  );
  const env = bookmark(
    1,
    "https://example.test/page",
    "A bookmark",
    "2026-10-17T18:00:00Z",
  );

  it("compares coherent archive URLs through their clock parts without counting source fields twice", () => {
    const result = compare(live, env, new IdMap(), [201, 201], rules);
    expect(result.differences).toEqual([]);
    expect(result.normalised).toMatchObject({ clocks: 2, generated: 1 });
  });

  it("compares a composed ID through the source field's mapping even when the address comes first", () => {
    const map = new IdMap();
    map.learn(101, 1);
    const result = compare(
      { url: "/folders/101", id: 101 },
      { url: "/folders/1", id: 1 },
      map,
      [201, 201],
      [
        {
          field: "url",
          rule: "composed",
          parts: [{ text: "/folders/" }, { from: "id", as: "value" }],
        },
      ],
    );
    expect(result.differences).toEqual([]);
    expect(result.normalised).toMatchObject({ ids: 1, generated: 1 });
  });

  it.each(["live", "env", "both"] as const)(
    "reports an incoherent %s composition, including equal but stale URLs",
    (side) => {
      const invalid = "https://web.archive.org/web/stale";
      const result = compare(
        side === "env" ? live : { ...live, web_archive_snapshot_url: invalid },
        side === "live" ? env : { ...env, web_archive_snapshot_url: invalid },
        new IdMap(),
        [201, 201],
        rules,
      );
      expect(result.differences).toMatchObject([
        { category: "value", pointer: "/web_archive_snapshot_url" },
      ]);
      expect(result.normalised.generated).toBe(0);
    },
  );

  it("preserves actual input differences although each address correctly spells its own response", () => {
    const different = bookmark(
      1,
      "https://example.test/other",
      "A bookmark",
      "2026-10-17T18:00:00Z",
    );
    const result = compare(live, different, new IdMap(), [201, 201], rules);
    expect(result.differences.map(({ pointer }) => pointer).sort()).toEqual([
      "/url",
      "/web_archive_snapshot_url",
    ]);
    expect(result.normalised.generated).toBe(0);
  });

  it("does not normalize a source's unproven generated-looking business value", () => {
    const result = compare(
      { url: "/folders/token00001", token: "token00001" },
      { url: "/folders/token00002", token: "token00002" },
      new IdMap(),
      [201, 201],
      [
        {
          field: "url",
          rule: "composed",
          parts: [{ text: "/folders/" }, { from: "token", as: "value" }],
        },
      ],
    );
    expect(result.differences.map(({ pointer }) => pointer).sort()).toEqual([
      "/token",
      "/url",
    ]);
  });

  it("compares the projected slug while retaining a difference in its source title", () => {
    const result = compare(
      {
        title: "Hello!",
        date_added: "2026-10-20T09:00:00Z",
        url: "/snapshot/20261020/hello",
      },
      {
        title: "Hello",
        date_added: "2026-10-17T18:00:00Z",
        url: "/snapshot/20261017/hello",
      },
      new IdMap(),
      [201, 201],
      [
        rules[0]!,
        {
          field: "url",
          rule: "composed",
          parts: [
            { text: "/snapshot/" },
            { from: "date_added", as: "clock", pattern: "YYYYMMDD" },
            { text: "/" },
            { from: "title", as: "slug" },
          ],
        },
      ],
    );
    expect(result.differences).toMatchObject([
      { category: "value", pointer: "/title" },
    ]);
    expect(result.normalised).toMatchObject({ clocks: 1, generated: 1 });
  });
});

describe("trimmed response clocks", () => {
  const rules: readonly FieldRule[] = [
    {
      field: "updatedAt",
      rule: "clock",
      format: {
        kind: "iso",
        separator: "T",
        zone: "Z",
        fraction: 8,
        trimmed: true,
      },
    },
  ];

  it.each([".12345678", ".123", ""])(
    "normalizes a learned trimmed width %s against the served millisecond width",
    (fraction) => {
      const result = compare(
        { updatedAt: `2026-03-04T05:06:07${fraction}Z` },
        { updatedAt: "2026-03-04T05:06:08.321Z" },
        new IdMap(),
        [200, 200],
        rules,
      );
      expect(result.differences).toEqual([]);
      expect(result.normalised.clocks).toBe(1);
    },
  );

  it.each([
    ["2026-03-04T05:06:07.123456789Z", "2026-03-04T05:06:08.321Z"],
    ["2026-03-04T05:06:07.123456780Z", "2026-03-04T05:06:08.321Z"],
    ["2026-03-04T05:06:07.120Z", "2026-03-04T05:06:08.320Z"],
    ["2026-03-04T05:06:07.123+01:00", "2026-03-04T05:06:08.321Z"],
    ["2026-03-04 05:06:07.123Z", "2026-03-04T05:06:08.321Z"],
  ])(
    "reports a pair outside the learned trimmed format (%s, %s)",
    (live, env) => {
      const result = compare(
        { updatedAt: live },
        { updatedAt: env },
        new IdMap(),
        [200, 200],
        rules,
      );
      expect(result.differences).toMatchObject([
        { category: "clock-format", pointer: "/updatedAt" },
      ]);
      expect(result.normalised.clocks).toBe(0);
    },
  );

  it("keeps trimmed normalization within the confirmed response entity", () => {
    const answer = (fraction: string) => ({
      status: 200,
      body: {
        kind: "json" as const,
        value: {
          data: { updatedAt: `2026-03-04T05:06:07.${fraction}Z` },
          updatedAt: `2026-03-04T05:06:07.${fraction}Z`,
        },
      },
    });
    const result = compareAnswers(
      answer("12345678"),
      answer("123"),
      new IdMap(),
      { at: "/data", rules },
    );
    expect(result.differences).toMatchObject([
      { category: "clock-format", pointer: "/updatedAt" },
    ]);
    expect(result.normalised.clocks).toBe(1);
  });
});

const registerGeneratedValueComparisonCases = () => {
  it.each([
    {
      name: "normalizes mapped ids and clocks while comparing unproven generated-looking values literally",
      rules: [],
      generated: 0,
      differences: [
        ["value", "/token"],
        ["value", "/uuid"],
      ],
    },
    {
      name: "agrees on mapped ids, clocks and confirmed generated values, and counts each",
      rules: [
        { field: "token", rule: "identity", generator: "token" },
        { field: "uuid", rule: "unique" },
      ],
      generated: 2,
      differences: [],
    },
  ] as const)("$name", ({ rules, generated, differences }) => {
    const map = new IdMap();
    map.learn(101, 1);
    const result = compare(
      {
        id: 101,
        created_at: "2026-10-20T10:00:00Z",
        token: "3f2a9c8d7e",
        uuid: "6f1c2b9e-2a3d-4f5e-8a9b-0c1d2e3f4a5b",
      },
      {
        id: 1,
        created_at: "2026-10-17T18:00:03Z",
        token: "9b8e7d6c5a",
        uuid: "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d",
      },
      map,
      [200, 200],
      rules,
    );
    expect(
      result.differences.map(({ category, pointer }) => [category, pointer]),
    ).toEqual(differences);
    expect(result.normalised).toEqual({
      ids: 1,
      clocks: 1,
      generated,
      large_bodies: 0,
      unobserved_bodies: 0,
    });
  });

  it("normalizes string generation only at fields identified by an executed write plan", () => {
    const result = compareAnswers(
      {
        status: 201,
        body: { kind: "json", value: { token: "token00001", sku: "product2" } },
      },
      {
        status: 201,
        body: { kind: "json", value: { token: "token00002", sku: "product1" } },
      },
      new IdMap(),
      { rules: [{ field: "token", rule: "identity", generator: "token" }] },
    );
    expect(result.differences).toMatchObject([
      { category: "value", pointer: "/sku" },
    ]);
    expect(result.normalised.generated).toBe(1);
  });
};

describe("composed response fields", () => {
  const rules: readonly FieldRule[] = [
    {
      field: "date_added",
      rule: "clock",
      format: { kind: "iso", separator: "T", fraction: 0, zone: "Z" },
    },
    { field: "url", rule: "echo" },
    {
      field: "web_archive_snapshot_url",
      rule: "composed",
      parts: [
        { text: "https://web.archive.org/web/" },
        { from: "date_added", as: "clock", pattern: "YYYYMMDDhhmmss" },
        { text: "/" },
        { from: "url", as: "value" },
      ],
    },
  ];
  const bookmark = (stamp: string, snapshot: string) => ({
    date_added: `2026-10-01T09:00:${stamp}Z`,
    url: "https://quarry.example.test/ledger",
    web_archive_snapshot_url: `https://web.archive.org/web/${snapshot}/https://quarry.example.test/ledger`,
  });

  it("normalizes a composed field each side spells from its own fields", () => {
    const result = compare(
      bookmark("00", "20261001090000"),
      bookmark("05", "20261001090005"),
      new IdMap(),
      [200, 200],
      rules,
    );
    expect(result.differences).toEqual([]);
    expect(result.normalised).toMatchObject({ clocks: 1, generated: 1 });
  });

  it("reports a composed field one side does not spell from its own fields", () => {
    const result = compare(
      bookmark("00", "20261001090000"),
      bookmark("05", "20261001090009"),
      new IdMap(),
      [200, 200],
      rules,
    );
    expect(
      result.differences.map(({ category, pointer }) => [category, pointer]),
    ).toEqual([["value", "/web_archive_snapshot_url"]]);
  });
});

describe("compareAnswers", () => {
  registerGeneratedValueComparisonCases();

  it("categorises status, missing and extra fields, values and clock formats", () => {
    const result = compare(
      { name: "A", gone: 1, at: "2026-10-20T10:00:00.123+00:00" },
      { name: "B", added: true, at: "2026-10-20T10:00:00Z" },
      new IdMap(),
      [409, 204],
    );
    expect(result.differences.map((d) => [d.category, d.pointer])).toEqual([
      ["status", ""],
      ["value", "/name"],
      ["missing-field", "/gone"],
      ["clock-format", "/at"],
      ["extra-field", "/added"],
    ]);
  });

  it("reports array length and order and compares paired items", () => {
    const result = compare(
      [
        { name: "B", n: 2 },
        { name: "A", n: 1 },
        { name: "C", n: 3 },
      ],
      [
        { name: "A", n: 1 },
        { name: "B", n: 5 },
      ],
    );
    expect(result.differences.map((d) => [d.category, d.pointer])).toEqual([
      ["length", ""],
      ["order", ""],
      ["value", "/0/n"],
    ]);
  });

  it("treats an epoch number as a clock only under a time-named field", () => {
    expect(
      compare({ updated: 1760000000 }, { updated: 1760000999 }).differences,
    ).toEqual([]);
    expect(
      compare({ size: 1760000000 }, { size: 1760000999 }).differences.map(
        (d) => d.category,
      ),
    ).toEqual(["value"]);
  });
});

describe("mapped fields and literal collections", () => {
  it("compares an object keyed by mapped ids under the environment's keys", () => {
    const map = new IdMap();
    map.learn("liveTable", "envTable");
    expect(
      compare(
        { tables: { liveTable: { name: "T" } } },
        { tables: { envTable: { name: "T" } } },
        map,
      ).differences,
    ).toEqual([]);
  });

  it("compares ordinary fields by name, even one named like a learned id", () => {
    const map = new IdMap();
    map.learn("books", "tags");
    expect(
      compare({ books: 1, tags: 2 }, { books: 1, tags: 2 }, map).differences,
    ).toEqual([]);
    // A real rename shows, rather than being taken for a mapped key.
    expect(
      compare({ books: 1 }, { tags: 1 }, map).differences.map((d) => [
        d.category,
        d.pointer,
      ]),
    ).toEqual([
      ["missing-field", "/books"],
      ["extra-field", "/tags"],
    ]);
  });

  it("normalizes known string references but leaves ordinary numeric and string values literal", () => {
    const map = new IdMap();
    map.learn(101, 1);
    learnIds({ ref: "live-ref" }, { ref: "env-ref" }, map, {
      heldIds: new Set(["env-ref"]),
    });
    expect(
      compare(
        { ref: "live-ref", price: 101, label: "live-ref" },
        { ref: "env-ref", price: 1, label: "env-ref" },
        map,
      ).differences.map((difference) => difference.pointer),
    ).toEqual(["/price", "/label"]);
    map.learn("live-key", "env-key");
    expect(
      compare({ ids: ["live-key"] }, { ids: ["env-key"] }, map).differences,
    ).toEqual([]);
  });

  it("still compares an object keyed by ids under the environment's keys when some ids are the same on both sides", () => {
    const map = new IdMap();
    map.learn("101", "2");
    expect(
      compare(
        { counts: { "1": 3, "101": 5 } },
        { counts: { "1": 3, "2": 5 } },
        map,
      ).differences,
    ).toEqual([]);
  });

  it("reports a reordered set of scalars as order alone and keeps nested numeric measurements literal", () => {
    expect(
      compare(
        { access: ["a", "b", "c"] },
        { access: ["c", "a", "b"] },
      ).differences.map((d) => [d.category, d.pointer]),
    ).toEqual([["order", "/access"]]);
    expect(
      compare({ stats: [[1792450800, 3]] }, { stats: [[1792285200, 3]] })
        .differences,
    ).toEqual([
      {
        category: "value",
        pointer: "/stats/0/0",
        live: "1792450800",
        env: "1792285200",
      },
    ]);
  });
});

describe("normalization context", () => {
  it.each([
    { live: 1800000000, env: 1700000000, pointer: "" },
    { live: [1800000000], env: [1700000000], pointer: "/0" },
    {
      live: { samples: [1800000000] },
      env: { samples: [1700000000] },
      pointer: "/samples/0",
    },
    {
      live: { updated_at: [{ samples: 1800000000 }] },
      env: { updated_at: [{ samples: 1700000000 }] },
      pointer: "/updated_at/0/samples",
    },
  ])(
    "keeps epoch-shaped numbers literal at $pointer without a time field",
    ({ live, env, pointer }) => {
      const result = compare(live, env);
      expect(result.differences).toEqual([
        { category: "value", pointer, live: "1800000000", env: "1700000000" },
      ]);
      expect(result.normalised.clocks).toBe(0);
    },
  );

  it("preserves the time field through nested numeric clock arrays", () => {
    const result = compare(
      { updated_at: [[1700000000]] },
      { updated_at: [[1800000000]] },
    );
    expect(result.differences).toEqual([]);
    expect(result.normalised.clocks).toBe(1);
  });

  it.each([
    ["product1", "product2"],
    ["product1", "productX"],
    ["3f2a9c8d7e", "9b8e7d6c5a"],
    [
      "6f1c2b9e-2a3d-4f5e-8a9b-0c1d2e3f4a5b",
      "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d",
    ],
  ])(
    "keeps literal business strings %s versus %s without generation facts",
    (live, env) => {
      const result = compare(
        { sku: live, items: [live] },
        { sku: env, items: [env] },
      );
      expect(
        result.differences.map(({ category, pointer }) => [category, pointer]),
      ).toEqual([
        ["value", "/sku"],
        ["value", "/items/0"],
      ]);
      expect(result.normalised.generated).toBe(0);
    },
  );

  it("scopes confirmed renewal rules to their response entity and exact array pointers", () => {
    const first = "6f1c2b9e-2a3d-4f5e-8a9b-0c1d2e3f4a5b";
    const second = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";
    const answer = (token: string) => ({
      status: 200,
      body: {
        kind: "json" as const,
        value: {
          data: { values: [{ token, sku: token }] },
          values: [{ token }],
        },
      },
    });
    const result = compareAnswers(answer(first), answer(second), new IdMap(), {
      at: "/data",
      rules: [{ field: "values", rule: "renewed", pointers: ["/*/token"] }],
    });
    expect(result.normalised.generated).toBe(1);
    expect(
      result.differences.map(({ category, pointer }) => [category, pointer]),
    ).toEqual([
      ["value", "/data/values/0/sku"],
      ["value", "/values/0/token"],
    ]);
  });

  it("does not extend generated-string normalization to numeric sequences", () => {
    const result = compare(
      { code: 17 },
      { code: 18 },
      new IdMap(),
      [200, 200],
      [{ field: "code", rule: "sequence", scope: "type" }],
    );
    expect(result.differences).toEqual([
      { category: "value", pointer: "/code", live: "17", env: "18" },
    ]);
    expect(result.normalised.generated).toBe(0);
  });
});

describe("generated response identities", () => {
  const first = "6f1c2b9e-2a3d-4f5e-8a9b-0c1d2e3f4a5b";
  const second = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";
  const fresh = "123e4567-e89b-42d3-a456-426614174000";
  const other = "223e4567-e89b-42d3-a456-426614174000";
  const rules: readonly FieldRule[] = [
    { field: "left", rule: "renewed", pointers: ["/*"] },
    { field: "right", rule: "renewed", pointers: ["/*"] },
  ];
  const answer = (left: string, right: string) => ({
    status: 200,
    body: { kind: "json" as const, value: { left: [left], right: [right] } },
  });

  it.each([
    {
      name: "consistent fresh renaming",
      liveLeft: fresh,
      liveRight: fresh,
      envLeft: first,
      envRight: first,
      differs: false,
      generated: 2,
    },
    {
      name: "case-equivalent UUID aliases",
      liveLeft: fresh.toUpperCase(),
      liveRight: fresh,
      envLeft: first,
      envRight: first.toUpperCase(),
      differs: false,
      generated: 2,
    },
    {
      name: "split alias",
      liveLeft: fresh,
      liveRight: other,
      envLeft: first,
      envRight: first,
      differs: true,
      generated: 1,
    },
    {
      name: "merged identities",
      liveLeft: fresh,
      liveRight: fresh,
      envLeft: first,
      envRight: second,
      differs: true,
      generated: 1,
    },
    {
      name: "split after an unchanged array",
      liveLeft: first,
      liveRight: fresh,
      envLeft: first,
      envRight: first,
      differs: true,
      generated: 0,
    },
    {
      name: "merge after an unchanged array",
      liveLeft: first,
      liveRight: first,
      envLeft: first,
      envRight: second,
      differs: true,
      generated: 0,
    },
  ])(
    "preserves $name within one confirmed renewal response",
    ({ liveLeft, liveRight, envLeft, envRight, differs, generated }) => {
      const result = compareAnswers(
        answer(liveLeft, liveRight),
        answer(envLeft, envRight),
        new IdMap(),
        { rules },
      );
      expect(result.normalised.generated).toBe(generated);
      expect(result.differences).toEqual(
        differs
          ? [
              {
                category: "value",
                pointer: "/right/0",
                live: JSON.stringify(liveRight),
                env: JSON.stringify(envRight),
              },
            ]
          : [],
      );
    },
  );

  it("retains order-only comparison for reordered generated scalar sets", () => {
    const result = compare(
      { left: [first, second] },
      { left: [second, first] },
      new IdMap(),
      [200, 200],
      rules,
    );
    expect(result.differences).toEqual([
      { category: "order", pointer: "/left" },
    ]);
    expect(result.normalised.generated).toBe(0);
  });
});

describe("clock field names", () => {
  it("keeps numeric format identifiers literal and recognizes clock field forms", () => {
    expect(
      compare({ format: 1196444237 }, { format: 1448695129 }).differences,
    ).toMatchObject([{ category: "value", pointer: "/format" }]);
    expect(
      compare({ updated_at: 1760000000 }, { updated_at: 1760000999 })
        .differences,
    ).toEqual([]);
    expect(
      compare({ createdAt: 1760000000 }, { createdAt: 1760000999 }).differences,
    ).toEqual([]);
  });
});

describe("comparison body coverage", () => {
  it("compares a live body over the replay limit by status only and counts it", () => {
    const result = compareAnswers(
      { status: 200, body: { kind: "cut", text: '{"data":[' } },
      { status: 200, body: { kind: "none" } },
      new IdMap(),
    );
    expect(result.differences).toEqual([]);
    expect(result.normalised.large_bodies).toBe(1);
  });

  it("compares a live body the probe did not record by status only and counts it", () => {
    const unrecorded = {
      status: 200,
      body: { kind: "none" as const },
      unobserved: true,
    };
    const result = compareAnswers(
      unrecorded,
      { status: 200, body: { kind: "json", value: { id: 1 } } },
      new IdMap(),
    );
    expect(result.differences).toEqual([]);
    expect(result.normalised.unobserved_bodies).toBe(1);
    expect(
      compareAnswers(
        unrecorded,
        { status: 404, body: { kind: "none" } },
        new IdMap(),
      ).differences,
    ).toEqual([{ category: "status", pointer: "", live: "200", env: "404" }]);
  });
});

describe("scalar sets of mapped ids", () => {
  it("differ only in order once live ids are mapped", () => {
    const map = new IdMap();
    map.learn(101, 1);
    map.learn(102, 2);
    const compared = compareAnswers(
      { status: 200, body: { kind: "json", value: { ids: [101, 102] } } },
      { status: 200, body: { kind: "json", value: { ids: [2, 1] } } },
      map,
    );
    expect(compared.differences).toEqual([
      { category: "order", pointer: "/ids" },
    ]);
    expect(compared.normalised.ids).toBe(2);
  });
});

describe("ids two collections reuse", () => {
  it("compares an entity's own id within the call's collection and any other id by the probe's mapping", () => {
    const map = new IdMap();
    map.learn(101, 1, "/api/books");
    map.learn(101, 2, "/api/authors");
    const answer = (body: JsonValue) => ({
      status: 200,
      body: { kind: "json" as const, value: body },
    });
    expect(
      compareAnswers(answer({ id: 101 }), answer({ id: 2 }), map, {
        scope: "/api/authors",
      }).differences,
    ).toEqual([]);
    expect(
      compareAnswers(answer({ book_id: 101 }), answer({ book_id: 2 }), map)
        .differences,
    ).toEqual([
      { category: "value", pointer: "/book_id", live: "101", env: "2" },
    ]);
  });
});

describe("identity responses two collections reuse", () => {
  it("compares a create's bare id and created member within the call's collection", () => {
    const books = new IdMap();
    books.learn(103, 1, "/api/books");
    learnIds(103, 3, books, {
      heldIds: new Set(),
      scope: "/api/authors",
      identity: true,
    });
    const created = new IdMap();
    created.learn(103, 1, "/api/books");
    learnIds({ created: 103 }, { created: 3 }, created, {
      heldIds: new Set(),
      scope: "/api/authors",
      entityAt: "/created",
      identity: true,
    });
    const answer = (body: JsonValue) => ({
      status: 201,
      body: { kind: "json" as const, value: body },
    });
    expect(books.env(103)).toBe(1);
    expect(books.env(103, "/api/authors")).toBe(3);
    expect(created.env(103, "/api/authors")).toBe(3);
    expect(
      compareAnswers(answer(103), answer(3), books, {
        scope: "/api/authors",
        identity: true,
      }).differences,
    ).toEqual([]);
    expect(
      compareAnswers(
        answer({ created: 103 }),
        answer({ created: 3 }),
        created,
        {
          scope: "/api/authors",
          at: "/created",
          identity: true,
        },
      ).differences,
    ).toEqual([]);
  });
});

describe("wrapped answers", () => {
  it("keeps collection identity context separate from a wrapped array's clock field context", () => {
    const map = new IdMap();
    map.learn(101, 1, "/api/books");
    map.learn(101, 2, "/api/authors");
    const result = compareAnswers(
      {
        status: 200,
        body: {
          kind: "json",
          value: { data: [{ id: 101, updated_at: [1700000000] }] },
        },
      },
      {
        status: 200,
        body: {
          kind: "json",
          value: { data: [{ id: 2, updated_at: [1800000000] }] },
        },
      },
      map,
      { scope: "/api/authors", at: "/data" },
    );
    expect(result.differences).toEqual([]);
    expect(result.normalised).toMatchObject({ ids: 1, clocks: 1 });
  });

  it("compares the identity of an entity inside an envelope within the call's collection", () => {
    const map = new IdMap();
    map.learn(101, 1, "/api/books");
    learnIds(
      { data: [{ id: 101, name: "Bob" }] },
      { data: [{ id: 2, name: "Bob" }] },
      map,
      { heldIds: new Set(), scope: "/api/authors", entityAt: "/data" },
    );
    expect(map.env(101, "/api/authors")).toBe(2);
    expect(
      compareAnswers(
        {
          status: 200,
          body: { kind: "json", value: { data: { id: 101, name: "Bob" } } },
        },
        {
          status: 200,
          body: { kind: "json", value: { data: { id: 2, name: "Bob" } } },
        },
        map,
        { scope: "/api/authors", at: "/data" },
      ).differences,
    ).toEqual([]);
  });
});

describe("raw ids a mapping gives to other entities", () => {
  const answer = (body: JsonValue) => ({
    status: 200,
    body: { kind: "json" as const, value: body },
  });

  it("reports an entity's own identity equal on both sides that its collection's mapping gives to another entity", () => {
    const map = new IdMap();
    map.learn(101, 1, "/api/books");
    map.learn(102, 101, "/api/books");
    const books = { scope: "/api/books" };
    expect(
      compareAnswers(answer({ id: 101 }), answer({ id: 101 }), map, books)
        .differences,
    ).toEqual([{ category: "value", pointer: "/id", live: "101", env: "101" }]);
    expect(
      compareAnswers(answer({ id: 102 }), answer({ id: 101 }), map, books)
        .differences,
    ).toEqual([]);
  });

  it("leaves an equal reference equal, as the probe's mapping cannot tell which collection it names", () => {
    const map = new IdMap();
    // Another collection's create reassigned live 2, while the seeded project 2 is the same on both sides.
    map.learn(2, 3);
    map.learn(5, 2);
    expect(
      compareAnswers(
        answer({ project_id: "2" }),
        answer({ project_id: "2" }),
        map,
      ).differences,
    ).toEqual([]);
  });
});

describe("generated integer identities", () => {
  const unique: readonly FieldRule[] = [{ field: "id", rule: "unique" }];

  it.each([
    {
      name: "numbers of one length",
      live: 1_729_791_234_567_890,
      env: 1_000_000_000_123_456,
      rules: unique,
      generated: 1,
    },
    {
      name: "digit strings of one length",
      live: "1729791234567890",
      env: "1000000000123456",
      rules: unique,
      generated: 1,
    },
    {
      name: "numbers of different lengths",
      live: 1_729_791_234_567_890,
      env: 100_000_000_012_345,
      rules: unique,
      generated: 0,
    },
    {
      name: "a number and a digit string",
      live: 1_729_791_234_567_890,
      env: "1000000000123456",
      rules: unique,
      generated: 0,
    },
    {
      name: "short integers",
      live: 17,
      env: 18,
      rules: unique,
      generated: 0,
    },
    {
      name: "integers no rule generates",
      live: 1_729_791_234_567_890,
      env: 1_000_000_000_123_456,
      rules: [],
      generated: 0,
    },
  ])(
    "matches $name only when a unique rule generates both",
    ({ live, env, rules, generated }) => {
      const result = compare(
        { id: live },
        { id: env },
        new IdMap(),
        [200, 200],
        rules,
      );
      expect(result.normalised.generated).toBe(generated);
      expect(result.differences).toEqual(
        generated === 1
          ? []
          : [
              {
                category: "value",
                pointer: "/id",
                live: JSON.stringify(live),
                env: JSON.stringify(env),
              },
            ],
      );
    },
  );
});
