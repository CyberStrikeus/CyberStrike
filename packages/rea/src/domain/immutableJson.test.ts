import { describe, expect, it, vi } from "vitest";

import type { JsonValue } from "./jsonValue.js";
import {
  freezeJsonSnapshot,
  canBorrowParsedJsonSnapshot,
  immutableJsonSnapshotMember,
  isImmutableJsonSnapshot,
} from "./immutableJson.js";

describe("owned immutable JSON snapshots", () => {
  it("borrows only the selected own child of a completed sealed root", () => {
    const value = freezeJsonSnapshot({
      selected: { values: [1, 2] },
      other: { value: 3 },
      absent: null,
    });
    expect(isImmutableJsonSnapshot(value.selected)).toBe(false);
    expect(immutableJsonSnapshotMember(value, "selected")).toBe(value.selected);
    expect(isImmutableJsonSnapshot(value.selected)).toBe(true);
    expect(isImmutableJsonSnapshot(value.other)).toBe(false);
    expect(immutableJsonSnapshotMember(value.selected, "values")).toBe(
      value.selected.values,
    );
    expect(isImmutableJsonSnapshot(value.selected.values)).toBe(true);
    expect(immutableJsonSnapshotMember(value, "absent")).toBeNull();
    expect(immutableJsonSnapshotMember(value, "missing")).toBeUndefined();
    expect(immutableJsonSnapshotMember(value, "toString")).toBeUndefined();
    expect(Reflect.set(value.selected.values, 0, 9)).toBe(false);
  });

  it("does not borrow children from unowned roots or invoke their accessors", () => {
    let accessed = false;
    const child = Object.freeze({ value: 1 });
    const root = Object.freeze({ child });
    expect(immutableJsonSnapshotMember(root, "child")).toBeUndefined();
    expect(isImmutableJsonSnapshot(child)).toBe(false);
    expect(
      immutableJsonSnapshotMember(
        {
          get child() {
            accessed = true;
            return child;
          },
        },
        "child",
      ),
    ).toBeUndefined();
    expect(accessed).toBe(false);
    expect(immutableJsonSnapshotMember(null, "child")).toBeUndefined();
  });

  it("seals reachable data and preserves repeated references", () => {
    const shared = { values: [1, "observed"] };
    const value = { left: shared, right: shared };
    const encoded = JSON.stringify(value);
    expect(freezeJsonSnapshot(value)).toBe(value);
    expect(value.left).toBe(value.right);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(shared.values)).toBe(true);
    expect(Reflect.set(shared.values, 0, 9)).toBe(false);
    expect(JSON.stringify(value)).toBe(encoded);
    expect(isImmutableJsonSnapshot(value)).toBe(true);
  });

  it("does not mistake a shallow freeze for validated immutable data", () => {
    const value = Object.freeze({ nested: { value: 1 } });
    expect(isImmutableJsonSnapshot(value)).toBe(false);
    freezeJsonSnapshot(value);
    expect(Object.isFrozen(value.nested)).toBe(true);
    expect(isImmutableJsonSnapshot(value)).toBe(true);
  });

  it("composes sealed roots without changing the nested data or authenticating a shallow freeze", () => {
    const nested = freezeJsonSnapshot({ values: [1, "observed"] });
    const outer = freezeJsonSnapshot({ nested });
    expect(outer.nested).toBe(nested);
    expect(Object.isFrozen(outer)).toBe(true);
    expect(Object.isFrozen(nested.values)).toBe(true);
    expect(isImmutableJsonSnapshot(outer)).toBe(true);
    expect(isImmutableJsonSnapshot(nested)).toBe(true);
    const unowned = Object.freeze({ nested: { value: 1 } });
    expect(isImmutableJsonSnapshot(unowned)).toBe(false);
  });

  it("rejects cycles without registering or partially freezing the snapshot", () => {
    const value: Record<string, JsonValue> = {};
    value.self = value;
    expect(() => freezeJsonSnapshot(value)).toThrow("circular");
    expect(isImmutableJsonSnapshot(value)).toBe(false);
    expect(Object.isFrozen(value)).toBe(false);
  });

  it("rejects mutable accessor behavior and sparse arrays", () => {
    const accessor = {
      get value() {
        return 1;
      },
    };
    expect(() => freezeJsonSnapshot(accessor)).toThrow("accessors");
    expect(isImmutableJsonSnapshot(accessor)).toBe(false);
    expect(() => freezeJsonSnapshot(new Array<number>(2))).toThrow("sparse");
    expect(() => freezeJsonSnapshot({ number: Number.NaN })).toThrow(
      "JSON values",
    );
  });

  it("rejects proxy snapshots before reflecting on their mutable behavior", () => {
    let reflected = false;
    const proxy = new Proxy(
      { value: 1 },
      {
        getPrototypeOf() {
          reflected = true;
          throw new Error("must not reflect on a proxy");
        },
      },
    );
    const root = { child: proxy };
    for (const input of [proxy, root]) {
      expect(() => freezeJsonSnapshot(input)).toThrow("proxies");
      expect(isImmutableJsonSnapshot(input)).toBe(false);
    }
    expect(Object.isFrozen(root)).toBe(false);
    expect(reflected).toBe(false);
  });
});

describe("borrowing a parsed JSON snapshot", () => {
  it("accepts reordered object fields but preserves arrays and exact scalars", () => {
    const source = freezeJsonSnapshot({ second: [true, null], first: -0 });
    expect(
      canBorrowParsedJsonSnapshot(source, { first: -0, second: [true, null] }),
    ).toBe(true);
    expect(
      canBorrowParsedJsonSnapshot(source, { first: 0, second: [true, null] }),
    ).toBe(false);
    expect(
      canBorrowParsedJsonSnapshot(source, { first: -0, second: [null, true] }),
    ).toBe(false);
    expect(
      canBorrowParsedJsonSnapshot(Object.freeze({ value: 1 }), { value: 1 }),
    ).toBe(false);
  });

  it("preserves parser defaults, hidden-field removal and enumerability changes", () => {
    const source = freezeJsonSnapshot({ observed: 1 });
    const optional: { observed: number; optional?: string | undefined } = {
      observed: 1,
    };
    expect(canBorrowParsedJsonSnapshot(source, optional)).toBe(true);
    optional.optional = undefined;
    expect(canBorrowParsedJsonSnapshot(source, optional)).toBe(false);
    expect(
      canBorrowParsedJsonSnapshot(source, { observed: 1, defaulted: 0 }),
    ).toBe(false);
    const hidden = { observed: 1 };
    Object.defineProperty(hidden, "unmodeled", { value: 2, enumerable: false });
    freezeJsonSnapshot(hidden);
    expect(canBorrowParsedJsonSnapshot(hidden, { observed: 1 })).toBe(false);
    const nonenumerable = { observed: 1 };
    Object.defineProperty(nonenumerable, "observed", { enumerable: false });
    freezeJsonSnapshot(nonenumerable);
    expect(canBorrowParsedJsonSnapshot(nonenumerable, { observed: 1 })).toBe(
      false,
    );
  });

  it("does not evaluate accessors introduced by a parsed representation", () => {
    let accessed = false;
    const source = freezeJsonSnapshot({ observed: 1 });
    expect(
      canBorrowParsedJsonSnapshot(source, {
        get observed() {
          accessed = true;
          return 1;
        },
      }),
    ).toBe(false);
    expect(accessed).toBe(false);
  });

  it("declines parser-introduced proxies without reflecting on them", () => {
    let reflected = false;
    const parsed = new Proxy(
      { value: 1 },
      {
        getPrototypeOf() {
          reflected = true;
          throw new Error("must not reflect on a proxy");
        },
      },
    );
    expect(
      canBorrowParsedJsonSnapshot(freezeJsonSnapshot({ value: 1 }), parsed),
    ).toBe(false);
    expect(reflected).toBe(false);
  });

  it("compares deeply nested snapshots without depending on the call stack", () => {
    let source: JsonValue = 1;
    let parsed: JsonValue = 1;
    for (let depth = 0; depth < 6_000; depth += 1) {
      source = { child: source };
      parsed = { child: parsed };
    }
    freezeJsonSnapshot(source);
    expect(canBorrowParsedJsonSnapshot(source, parsed)).toBe(true);
  });

  it("compares shared snapshot graphs without repeatedly expanding their paths", () => {
    let source: JsonValue = { value: 1 };
    for (let depth = 0; depth < 26; depth += 1)
      source = { left: source, right: source };
    const parsed = structuredClone(source);
    freezeJsonSnapshot(source);
    const ownKeys = Reflect.ownKeys;
    let inspections = 0;
    const observed = vi
      .spyOn(Reflect, "ownKeys")
      .mockImplementation((value) => {
        // Fail deterministically instead of consuming exponential CPU on regressions.
        if (++inspections > 10_000)
          throw new Error("Shared JSON comparison exceeded inspection budget");
        return ownKeys(value);
      });
    let borrowed: boolean;
    try {
      borrowed = canBorrowParsedJsonSnapshot(source, parsed);
    } finally {
      observed.mockRestore();
    }
    expect(borrowed).toBe(true);
  });

  it("keeps the parsed result when a parser splits shared source nodes", () => {
    const shared = { value: 1 };
    const source = freezeJsonSnapshot({ left: shared, right: shared });
    expect(
      canBorrowParsedJsonSnapshot(source, {
        left: { value: 1 },
        right: { value: 1 },
      }),
    ).toBe(false);
  });

  it.each(["direct", "nested"])(
    "detects shared-node splits across a %s preserved subtree",
    (kind) => {
      const shared = { value: 1 };
      const source = freezeJsonSnapshot({
        preserved: kind === "direct" ? shared : { nested: shared },
        cloned: shared,
      });
      expect(
        canBorrowParsedJsonSnapshot(source, {
          preserved: source.preserved,
          cloned: { value: 1 },
        }),
      ).toBe(false);
      expect(canBorrowParsedJsonSnapshot(source, source)).toBe(true);
    },
  );

  it("keeps the parsed result when a parser merges distinct source nodes", () => {
    const source = freezeJsonSnapshot({
      left: { value: 1 },
      right: { value: 1 },
    });
    const shared = { value: 1 };
    expect(
      canBorrowParsedJsonSnapshot(source, { left: shared, right: shared }),
    ).toBe(false);
  });
});
