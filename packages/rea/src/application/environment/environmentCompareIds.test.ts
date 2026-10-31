import { describe, expect, it } from "vitest";

import {
  IdMap,
  learnIds,
  pairElements,
  translatePath,
  translateValue,
} from "./environmentCompareIds.js";

describe("IdMap", () => {
  it("keeps the first pairing of either side and counts conflicting ones", () => {
    const map = new IdMap();
    map.learn(101, 1);
    map.learn("101", 1);
    map.learn(101, 2);
    map.learn(102, 1);
    expect(map.env(101)).toBe(1);
    expect(map.env("101")).toBe(1);
    expect(map.hasEnv(1)).toBe(true);
    expect(map.size).toBe(1);
    expect(map.conflicts).toBe(2);
  });

  it("ignores a pair of equal values", () => {
    const map = new IdMap();
    map.learn("same", "same");
    expect(map.size).toBe(0);
  });

  it("reserves equal pairs and withholds a target that represents two live IDs", () => {
    for (const pairs of [
      [
        [1, 1],
        [2, 1],
      ],
      [
        [2, 1],
        [1, 1],
      ],
    ] as const) {
      const map = new IdMap();
      for (const [live, env] of pairs) map.learn(live, env);
      expect(map.env(1)).toBeUndefined();
      expect(map.env(2)).toBeUndefined();
      expect(map.size).toBe(0);
      expect(map.conflicts).toBe(1);
    }
  });

  it("withholds a mapping when its live ID later also pairs equally", () => {
    const map = new IdMap();
    map.learn(2, 1);
    map.learn(2, 2);
    expect(map.env(2)).toBeUndefined();
    expect(map.size).toBe(0);
  });

  it("withholds an environment ID reserved by a conflicting equal pair", () => {
    const map = new IdMap();
    map.learn(1, 2);
    map.learn(1, 1);
    expect(map.env(1)).toBeUndefined();
    expect(map.size).toBe(0);
  });

  it("keeps an equal id in its collection and rejects a second live id for one environment id there", () => {
    const map = new IdMap();
    map.learn(101, 1, "/api/books");
    map.learn(101, 101, "/api/authors");
    map.learn(102, 1, "/api/books");
    expect(map.env(101, "/api/authors")).toBe(101);
    expect(map.env(101, "/api/books")).toBe(1);
    expect(map.env(102, "/api/books")).toBeUndefined();
    expect(map.env(102)).toBeUndefined();
    expect(map.conflicts).toBe(1);
    expect(map.size).toBe(1);
  });
});

describe("pairElements", () => {
  it("pairs objects by the shared unique string field that pairs the most", () => {
    const live = [
      { id: 102, name: "Second", kind: "book" },
      { id: 101, name: "First", kind: "book" },
    ];
    const env = [
      { id: 1, name: "First", kind: "book" },
      { id: 2, name: "Second", kind: "book" },
      { id: 3, name: "Third", kind: "book" },
    ];
    expect(pairElements(live, env)).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it("pairs by position without a shared key or for scalar items", () => {
    expect(pairElements([{ n: 1 }, { n: 2 }], [{ n: 3 }])).toEqual([[0, 0]]);
    expect(pairElements(["a", "b"], ["c", "d"])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe("learnIds", () => {
  it("maps identifier fields of paired list items and of two single answers", () => {
    const map = new IdMap();
    learnIds(
      [
        { id: 102, name: "Second", owner_id: "u-9" },
        { id: 101, name: "First", owner_id: "u-9" },
      ],
      [
        { id: 1, name: "First", owner_id: "u-1" },
        { id: 2, name: "Second", owner_id: "u-1" },
      ],
      map,
      { heldIds: new Set() },
    );
    expect([map.env(101), map.env(102), map.env("u-9")]).toEqual([1, 2, "u-1"]);
    learnIds(
      { data: { uid: "x9", ref: "r-1" } },
      { data: { uid: "e3", ref: "r-2" } },
      map,
      { heldIds: new Set(["r-2"]) },
    );
    expect(map.env("r-1")).toBe("r-2");
    expect(map.env("x9")).toBeUndefined();
    learnIds({ workers: 0 }, { workers: 1 }, map, { heldIds: new Set(["1"]) });
    expect(map.env(0)).toBeUndefined();
  });

  it("learns nothing from items that share a key but no value, or differ in count without one", () => {
    const map = new IdMap();
    learnIds([{ code: "kelp", id: 1 }], [{ code: "menu", id: 2 }], map, {
      heldIds: new Set(["menu"]),
    });
    learnIds(
      [{ n: 1, id: 3 }],
      [
        { n: 1, id: 4 },
        { n: 2, id: 5 },
      ],
      map,
      { heldIds: new Set() },
    );
    expect(map.size).toBe(0);
    learnIds([{ n: 1, id: 3 }], [{ n: 1, id: 4 }], map, { heldIds: new Set() });
    expect(map.env(3)).toBe(4);
  });

  it("learns a scalar identity response at its pointer and ignores any other root scalar", () => {
    const map = new IdMap();
    learnIds(103, 3, map, {
      heldIds: new Set(),
      scope: "/api/books",
      identity: true,
    });
    learnIds({ created: 104 }, { created: 4 }, map, {
      heldIds: new Set(),
      scope: "/api/books",
      entityAt: "/created",
      identity: true,
    });
    learnIds(7, 8, map, { heldIds: new Set(), scope: "/api/books" });
    expect(map.env(103, "/api/books")).toBe(3);
    expect(map.env(104)).toBe(4);
    expect(map.env(7)).toBeUndefined();
  });
});

describe("learnIds over objects keyed by ids", () => {
  it("pairs entries by a natural key in their values and maps the keys", () => {
    const map = new IdMap();
    learnIds(
      {
        data: {
          liveA: { id: "liveA", name: "Lamp Oil" },
          liveB: { id: "liveB", name: "Quarry" },
        },
      },
      {
        data: {
          envB: { id: "envB", name: "Quarry" },
          envA: { id: "envA", name: "Lamp Oil" },
        },
      },
      map,
      { heldIds: new Set() },
    );
    expect([map.env("liveA"), map.env("liveB")]).toEqual(["envA", "envB"]);
  });
});

describe("translateValue", () => {
  it("replaces mapped live identifiers at any depth in the original value's type", () => {
    const map = new IdMap();
    map.learn(101, 1);
    map.learn("abc", "xyz");
    expect(
      translateValue({ ids: [101, "101", "abc"], name: "abc def", n: 5 }, map),
    ).toEqual({ ids: [1, "1", "xyz"], name: "abc def", n: 5 });
  });
});

describe("translatePath", () => {
  it("replaces segments that decode to a mapped live id and re-encodes them", () => {
    const map = new IdMap();
    map.learn("live@1", "env@1");
    map.learn(7, 3);
    expect(translatePath("/api/releases/live%401/deploys/7/", map)).toBe(
      "/api/releases/env%401/deploys/3/",
    );
    expect(translatePath("/api/%E0%A4%A/x", map)).toBe("/api/%E0%A4%A/x");
  });

  it("leaves a literal route segment in place when that text is a mapped id", () => {
    const map = new IdMap();
    map.learn("books", "stored-tag");
    map.learn(1, 9);
    expect(
      translatePath(
        "/api/books/1",
        map,
        () => undefined,
        (index) => index < 2,
      ),
    ).toBe("/api/books/9");
  });
});

describe("ids two collections reuse", () => {
  it("keeps each collection's pairing of a live id and translates a path id by its collection", () => {
    const map = new IdMap();
    learnIds([{ id: 101, name: "First" }], [{ id: 1, name: "First" }], map, {
      heldIds: new Set(),
      scope: "/api/books",
    });
    learnIds([{ id: 101, name: "Bob" }], [{ id: 2, name: "Bob" }], map, {
      heldIds: new Set(),
      scope: "/api/authors",
    });
    expect(map.env(101, "/api/authors")).toBe(2);
    expect(map.env(101)).toBe(1);
    expect(
      translatePath("/api/authors/101", map, (index) =>
        index === 2 ? "/api/authors" : undefined,
      ),
    ).toBe("/api/authors/2");
  });
});

describe("objects keyed by ids that overlap", () => {
  it("pairs entries by a natural key when some re-seeded keys are reused, and only when every entry pairs", () => {
    const map = new IdMap();
    learnIds(
      { "2": { name: "A" }, "3": { name: "B" } },
      { "1": { name: "A" }, "2": { name: "B" } },
      map,
      { heldIds: new Set() },
    );
    expect([map.env("2"), map.env("3")]).toEqual(["1", "2"]);
    const partial = new IdMap();
    learnIds(
      { "2": { name: "A" }, "3": { name: "C" } },
      { "1": { name: "A" }, "2": { name: "B" } },
      partial,
      { heldIds: new Set() },
    );
    expect(partial.size).toBe(0);
  });
});

describe("ordinary objects whose fields overlap", () => {
  it("does not read their fields as ids, even when every value pairs", () => {
    const map = new IdMap();
    learnIds(
      { current: { name: "A" }, previous: { name: "B" } },
      { current: { name: "B" }, next: { name: "A" } },
      map,
      { heldIds: new Set() },
    );
    expect(map.size).toBe(0);
  });
});
