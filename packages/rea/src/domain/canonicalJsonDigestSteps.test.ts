import { fc, it } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { canonicalJsonDigestSteps } from "./canonicalJsonDigestSteps.js";
import {
  CanonicalDigestError,
  digestCanonicalValue,
} from "./canonicalDigest.js";
import { jsonValueSchema, type JsonValue } from "./jsonValue.js";

const complete = <Value>(steps: Iterator<void, Value>): Value => {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
};

describe("cooperative canonical JSON digest", () => {
  const values: readonly JsonValue[] = [
    null,
    [true, false, 0, -0, 1e-7, 1e21, "\ud800", '𐀀\n"'],
    { z: null, a: { b: 2, a: 1 } },
    jsonValueSchema.parse(
      JSON.parse('{"__proto__":{"x":1},"constructor":2,"toJSON":"text"}'),
    ),
    { payload: `${"x".repeat(8191)}𐀀${"\n\ud800".repeat(20_000)}` },
    { [`${"x".repeat(8191)}𐀀${"\n".repeat(20_000)}`]: "value" },
    Object.fromEntries(
      Array.from({ length: 512 }, (_, index) => [
        `escaped\n"\\𐀀${"x".repeat(32)}${index}`,
        { repeated: index },
      ]),
    ),
  ];
  it.each(values.map((value) => ({ value })))(
    "preserves complete canonical meaning (%#)",
    ({ value }) => {
      expect(
        complete(canonicalJsonDigestSteps(jsonValueSchema.parse(value))),
      ).toBe(digestCanonicalValue(value));
    },
  );

  it("supports repeated references without treating them as cycles", () => {
    const shared = { nested: ["value"] };
    const value = { a: shared, b: shared };
    expect(complete(canonicalJsonDigestSteps(value))).toBe(
      digestCanonicalValue(value),
    );
  });

  it.prop([fc.jsonValue()])(
    "matches the existing digest across JSON values",
    (value) => {
      expect(
        complete(canonicalJsonDigestSteps(jsonValueSchema.parse(value))),
      ).toBe(digestCanonicalValue(value));
    },
  );

  it("permits abandoning a large string before completing its digest", () => {
    const steps = canonicalJsonDigestSteps("𐀀".repeat(100_000));
    expect(steps.next().done).toBe(false);
    steps.return("abandoned");
    expect(steps.next().done).toBe(true);
  });

  it("continues object hashing when a pending property is omitted", () => {
    const value: { [key: string]: JsonValue } = {
      a: "x".repeat(32_768),
      b: 1,
      c: { retained: true },
    };
    const steps = canonicalJsonDigestSteps(value);
    expect(steps.next().done).toBe(false);
    delete value.b;
    expect(complete(steps)).toBe(digestCanonicalValue(value));
  });

  it("rejects sparse arrays, nonfinite numbers and cycles", () => {
    const sparse: JsonValue[] = [];
    sparse.length = 2;
    const cycle: { [key: string]: JsonValue } = {};
    cycle.self = cycle;
    expect(() => complete(canonicalJsonDigestSteps(sparse))).toThrow();
    expect(() => complete(canonicalJsonDigestSteps(Number.NaN))).toThrow(
      CanonicalDigestError,
    );
    expect(() => complete(canonicalJsonDigestSteps(cycle))).toThrow(
      CanonicalDigestError,
    );
    try {
      complete(canonicalJsonDigestSteps(Number.NaN));
    } catch (cause) {
      expect(cause).toMatchObject({ code: "nan" });
    }
    try {
      complete(canonicalJsonDigestSteps(cycle));
    } catch (cause) {
      expect(cause).toMatchObject({ code: "circular" });
    }
  });
});
