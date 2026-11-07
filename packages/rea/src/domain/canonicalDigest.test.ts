import { createHash } from "node:crypto";

import { fc, it } from "@fast-check/vitest";
import canonicalize from "canonicalize";
import { describe, expect } from "vitest";

import {
  CanonicalDigestError,
  digestCanonicalValue,
} from "./canonicalDigest.js";

const legacyDigest = (value: unknown): string => {
  const encoded = canonicalize(value);
  if (encoded === undefined) throw new TypeError("Unserializable fixture");
  return createHash("sha256").update(encoded).digest("hex");
};

describe("incremental canonical digest", () => {
  it.prop([fc.jsonValue()])(
    "preserves canonicalize digests for JSON values",
    (value) => {
      expect(digestCanonicalValue(value)).toBe(legacyDigest(value));
    },
  );

  it("preserves Unicode ordering, escaping, numeric forms and non-JSON normalization", () => {
    const shared = { key: "value" };
    const sparse: unknown[] = [undefined, Symbol("omit"), () => undefined];
    sparse.length = 6;
    const fixtures: unknown[] = [
      { "\uE000": "BMP", "\u{10000}": "supplementary" },
      {
        "€": "\ud800",
        "😀": "\udc00",
        "\r": '\n\t"\\',
        number: -0,
        exponent: 1e30,
      },
      { omitted: undefined, symbol: Symbol("omit"), fn: () => undefined },
      sparse,
      [shared, shared],
      new Date("2026-10-06T00:00:00Z"),
      { toJSON: () => ({ b: 2, a: [1, null] }) },
      { nested: { toJSON: () => undefined } },
    ];
    for (const value of fixtures)
      expect(digestCanonicalValue(value)).toBe(legacyDigest(value));
  });

  it("rejects unsupported roots, non-finite numbers, BigInt and ancestor cycles", () => {
    for (const value of [undefined, Symbol("root"), () => undefined])
      expect(() => digestCanonicalValue(value, "Fixture")).toThrow(
        "Fixture could not canonicalize data",
      );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const recursiveJson = { toJSON: (): unknown => recursiveJson };
    for (const [value, code] of [
      [Number.NaN, "nan"],
      [Number.POSITIVE_INFINITY, "infinity"],
      [Number.NEGATIVE_INFINITY, "infinity"],
    ] as const) {
      expect(() => digestCanonicalValue(value)).toThrow(CanonicalDigestError);
      try {
        digestCanonicalValue(value);
      } catch (cause) {
        expect(cause).toMatchObject({ _tag: "CanonicalDigestError", code });
      }
    }
    for (const value of [cyclic, recursiveJson]) {
      expect(() => digestCanonicalValue(value)).toThrow(CanonicalDigestError);
      try {
        digestCanonicalValue(value);
      } catch (cause) {
        expect(cause).toMatchObject({ code: "circular" });
      }
    }
    expect(() => digestCanonicalValue(1n)).toThrow();
  });

  it("preserves canonical bytes across large keys, repeated leaves and buffer flushes", () => {
    const manyKeys: Record<string, unknown> = {};
    for (let i = 0; i < 2000; i += 1) manyKeys[`k${i}`] = i;
    const value = {
      keys: manyKeys,
      payload: Array.from({ length: 64 }, () => "x".repeat(16_384)),
      tail: ["€", "😀", "x".repeat(9000)],
    };
    expect(digestCanonicalValue(value)).toBe(legacyDigest(value));
  });

  it("preserves canonicalize property access and toJSON cycle behavior", () => {
    const createAccessor = () => {
      let reads = 0;
      return {
        get value() {
          reads += 1;
          return reads;
        },
      };
    };
    expect(digestCanonicalValue(createAccessor())).toBe(
      legacyDigest(createAccessor()),
    );
    const shared = { toJSON: () => ({ answer: 42 }) };
    expect(digestCanonicalValue([shared, shared])).toBe(
      legacyDigest([shared, shared]),
    );
  });
});
