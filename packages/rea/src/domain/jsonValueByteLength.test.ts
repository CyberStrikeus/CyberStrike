import { expect, it } from "vitest";
import { jsonValueByteLength } from "./jsonValueByteLength.js";
import type { JsonValue } from "./jsonValue.js";

it("matches native UTF-8 serialization for keys, repeated values and nested JSON", () => {
  const text = '雪🧪"\\\n\u0001\ud800';
  const values: JsonValue[] = [
    null,
    true,
    false,
    -0,
    1e25,
    Number.NaN,
    { [text]: [text, text, {}, [], { count: 12345, absent: null }] },
  ];
  for (const value of values)
    expect(jsonValueByteLength(value)).toBe(
      Buffer.byteLength(JSON.stringify(value)),
    );
});

it("preserves exact admission and stops at a proven byte-budget overflow", () => {
  const value = {
    names: ["雪".repeat(1000), "\u0001".repeat(1000)],
    rows: [1, 2, 3],
  };
  const exact = Buffer.byteLength(JSON.stringify(value));
  expect(jsonValueByteLength(value, exact)).toBe(exact);
  for (const budget of [-1, 0, 1, 64, exact - 1]) {
    const measured = jsonValueByteLength(value, budget);
    expect(measured).toBeGreaterThan(budget);
    expect(measured).toBeLessThanOrEqual(exact);
  }
  const visit = () => {
    throw new Error("Budget overflow must stop later traversal");
  };
  const owned = {
    first: "\u0001".repeat(1000),
    get later() {
      return visit();
    },
  };
  expect(jsonValueByteLength(owned, 32)).toBeGreaterThan(32);
});
