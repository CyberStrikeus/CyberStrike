import { describe, expect, it } from "vitest";
import canonicalize from "canonicalize";

import {
  bufferedJsonParts,
  canonicalJsonParts,
  jsonParts,
  jsonByteLength,
  jsonTextCodeUnits,
  equalJsonText,
} from "./jsonSerialization.js";

/** Compact and pretty streamed JSON must equal native JSON. */
const expectNativeJson = (value: unknown): void => {
  const text = JSON.stringify(value);
  expect(jsonByteLength(value)).toBe(Buffer.byteLength(text, "utf8"));
  expect(jsonTextCodeUnits(value)).toBe(text.length);
  expect([...bufferedJsonParts(jsonParts(value))].join("")).toBe(
    JSON.stringify(value),
  );
  expect([...jsonParts(value, true)].join("")).toBe(
    JSON.stringify(value, null, 2),
  );
};

describe("streamed JSON representation", () => {
  it.each([
    null,
    true,
    -0,
    [1, false, null, 'quotes: " / slash: \\ / newline: \n'],
    { nested: { value: "中文 😀 \ud800" }, items: [1, 2] },
    JSON.parse('{"__proto__":{"value":1},"constructor":2,"10":3,"2":4}'),
  ])("matches native JSON for ordinary values: %j", expectNativeJson);

  it("preserves surrogate pairs across string and buffer boundaries", () => {
    const value = { text: `${"x".repeat(8190)}😀${'中文\n"'.repeat(20000)}` };
    expectNativeJson(value);
    const parts = [...bufferedJsonParts(jsonParts(value))];
    expect(
      Buffer.concat(parts.map((part) => Buffer.from(part))).toString(),
    ).toBe(JSON.stringify(value));
    expect(JSON.parse(parts.join(""))).toEqual(value);
  });

  it("matches existing canonical bytes for numeric keys, Unicode, and shared values", () => {
    const shared = { z: -0, a: [1e-7, 1e30, "雪😀\ud800"] };
    const ownKeys: unknown = JSON.parse(
      '{"__proto__":1,"constructor":2,"10":3,"2":4}',
    );
    const value = {
      z: shared,
      a: shared,
      keys: ownKeys,
      long: '雪😀"'.repeat(20000),
    };
    expect([...bufferedJsonParts(canonicalJsonParts(value))].join("")).toBe(
      canonicalize(value),
    );
  });
});

describe("iterative JSON encoding", () => {
  it("matches native JSON for long keys, omitted members, and deep nesting", () => {
    let deep: unknown = { leaf: [1, "two", null] };
    for (let level = 0; level < 500; level += 1)
      deep = level % 2 === 0 ? [deep, level] : { [`k${String(level)}`]: deep };
    const value = {
      [`${"k".repeat(9000)}😀`]: { nested: ["x".repeat(20000), {}, []] },
      omitted: undefined,
      method: () => 1,
      symbol: Symbol("ignored"),
      deep,
    };
    expectNativeJson(value);
  });

  it("rejects values native JSON would not encode as ordinary JSON", () => {
    expect(() => [...jsonParts([1, undefined])]).toThrow(
      "ordinary JSON values",
    );
    expect(() => [...jsonParts({ value: Number.NaN })]).toThrow(
      "ordinary JSON values",
    );
    expect(() => [...jsonParts({ value: new Date(0) })]).toThrow(
      "ordinary JSON objects",
    );
  });

  it("yields bounded parts before reading later members", () => {
    const value: Record<string, unknown> = { first: "x".repeat(100_000) };
    Object.defineProperty(value, "later", {
      enumerable: true,
      get() {
        throw new Error("later members must not be read yet");
      },
    });
    const parts = jsonParts(value);
    const first = parts.next();
    expect(first.done).toBe(false);
    expect(first.value?.length).toBeLessThanOrEqual(64 * 1024);
    // Many small members are grouped into parts instead of one per token.
    const small = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [
        `k${String(index)}`,
        index,
      ]),
    );
    const smallParts = [...jsonParts(small)];
    expect(smallParts.join("")).toBe(JSON.stringify(small));
    expect(smallParts.length).toBeLessThan(20);
  });
});

describe("JSON text equality without whole-document strings", () => {
  it.each([
    [null, null],
    [-0, 0],
    [
      { first: 1, omitted: undefined, second: 2 },
      { first: 1, second: 2 },
    ],
    [
      { first: 1, second: 2 },
      { second: 2, first: 1 },
    ],
    [
      { ["\u0000".repeat(9000)]: "\u0001😀\ud800".repeat(20000) },
      { ["\u0000".repeat(9000)]: "\u0001😀\ud800".repeat(20000) },
    ],
    ["prefix".repeat(20000) + "a", "prefix".repeat(20000) + "b"],
    ["prefix".repeat(20000), "prefix".repeat(20000) + "a"],
  ])("preserves native JSON comparison semantics", (left, right) => {
    expect(equalJsonText(left, right)).toBe(
      JSON.stringify(left) === JSON.stringify(right),
    );
  });
});
