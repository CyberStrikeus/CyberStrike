import { expect, it } from "vitest";
import { parseBinary } from "plist";

import { projectPlistValue } from "./plistValue.js";
import { UnknownPlistScalar } from "./unknownPlistScalar.js";

// Binary decoders build dates from seconds; beyond the Date range they are invalid.
it("projects an unrepresentable date as unknown and counts it", () => {
  expect(
    projectPlistValue({ far: new Date(Number.NaN), near: new Date(0) }),
  ).toEqual({
    value: {
      far: { $plist_type: "date", iso8601: null },
      near: { $plist_type: "date", iso8601: "1970-01-01T00:00:00.000Z" },
    },
    nonFiniteRealCount: 0,
    negativeZeroRealCount: 0,
    unknownDateCount: 1,
    unknownScalarCount: 0,
  });
});

it("keeps a negative-zero real distinct from positive zero and counts it", () => {
  const observed: object[] = [];
  const projected = projectPlistValue(
    [-0, 0, 1.25, { $plist_type: "real", value: "-0" }],
    (wrapper) => observed.push(wrapper),
  );
  expect(projected.negativeZeroRealCount).toBe(1);
  expect(Array.isArray(projected.value)).toBe(true);
  if (!Array.isArray(projected.value)) throw new Error("Expected array");
  expect(projected.value[0]).toEqual({ $plist_type: "real", value: "-0" });
  expect(Object.is(projected.value[1], 0)).toBe(true);
  expect(projected.value[2]).toBe(1.25);
  // Only the generated wrapper is reported; the lookalike stays a dictionary.
  expect(projected.value[3]).toEqual(projected.value[0]);
  expect(observed).toHaveLength(1);
  expect(observed[0]).toBe(projected.value[0]);
  expect(JSON.stringify(projected.value)).toBe(
    '[{"$plist_type":"real","value":"-0"},0,1.25,{"$plist_type":"real","value":"-0"}]',
  );
});

it("rejects excessive plist nesting without exhausting the stack", () => {
  const deep: unknown[] = [];
  let cursor = deep;
  for (let depth = 0; depth < 200; depth += 1) {
    const next: unknown[] = [];
    cursor.push(next);
    cursor = next;
  }
  expect(() => projectPlistValue(deep)).toThrow(RangeError);
});

it("reports only generated scalar wrappers and keeps lookalike dictionaries distinct", () => {
  const observed: object[] = [];
  const value = projectPlistValue(
    [
      new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      new Date(0),
      new Date(Number.NaN),
      Number.POSITIVE_INFINITY,
      { $plist_type: "data", base64: "3q2+7w==" },
    ],
    (wrapper) => observed.push(wrapper),
  ).value;
  expect(Array.isArray(value)).toBe(true);
  if (!Array.isArray(value)) throw new Error("Expected projected array");
  expect(observed).toEqual(value.slice(0, 4));
  expect(observed[0]).toBe(value[0]);
  expect(value[0]).toEqual(value[4]);
  expect(observed).not.toContain(value[4]);
});

it("rejects accessors, proxies, holes and symbol keys without invoking user code", () => {
  let accessed = 0;
  const dictionary = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      accessed++;
      return "unexpected";
    },
  });
  const array = Object.defineProperty([], "0", {
    enumerable: true,
    get() {
      accessed++;
      return "unexpected";
    },
  });
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        accessed++;
        return [];
      },
      getPrototypeOf() {
        accessed++;
        return Object.prototype;
      },
    },
  );
  for (const value of [
    dictionary,
    array,
    proxy,
    Array(1),
    { [Symbol("key")]: "value" },
  ])
    expect(() => projectPlistValue(value)).toThrow(TypeError);
  expect(accessed).toBe(0);
});

it("keeps retained integer scalars distinct from lookalike dictionaries", () => {
  const decimal = `1${"0".repeat(400)}`;
  const observed: object[] = [];
  const projected = projectPlistValue(
    [BigInt(decimal), { $plist_type: "integer", decimal }],
    (value) => observed.push(value),
  );
  expect(projected.unknownDateCount).toBe(0);
  expect(Array.isArray(projected.value)).toBe(true);
  if (!Array.isArray(projected.value)) throw new Error("Expected array");
  expect(projected.value[0]).toEqual(projected.value[1]);
  expect(observed).toHaveLength(1);
  expect(observed[0]).toBe(projected.value[0]);
  expect(observed[0]).not.toBe(projected.value[1]);
});

it("projects known non-finite and unknown XML scalars without wrapping lookalikes", () => {
  const observed: object[] = [];
  const projected = projectPlistValue(
    [
      Infinity,
      -Infinity,
      NaN,
      new UnknownPlistScalar("real", "1e999", "unrepresentable"),
      new UnknownPlistScalar(
        "integer",
        "12<!-- gap -->3",
        "unsupported-markup",
      ),
      { $plist_type: "real", value: "nan" },
      {
        $plist_type: "unknown",
        element: "integer",
        literal: "12<!-- gap -->3",
        reason: "unsupported-markup",
      },
    ],
    (wrapper) => observed.push(wrapper),
  );
  expect(projected.nonFiniteRealCount).toBe(3);
  expect(projected.unknownScalarCount).toBe(2);
  expect(projected.negativeZeroRealCount).toBe(0);
  expect(JSON.stringify(projected.value)).toBe(
    '[{"$plist_type":"real","value":"+infinity"},{"$plist_type":"real","value":"-infinity"},{"$plist_type":"real","value":"nan"},{"$plist_type":"unknown","element":"real","literal":"1e999","reason":"unrepresentable"},{"$plist_type":"unknown","element":"integer","literal":"12<!-- gap -->3","reason":"unsupported-markup"},{"$plist_type":"real","value":"nan"},{"$plist_type":"unknown","element":"integer","literal":"12<!-- gap -->3","reason":"unsupported-markup"}]',
  );
  expect(Array.isArray(projected.value)).toBe(true);
  if (!Array.isArray(projected.value)) throw new Error("Expected array");
  // Only generated wrappers are reported; the lookalike stays a dictionary.
  expect(observed).toEqual(projected.value.slice(0, 5));
  expect(observed).not.toContain(projected.value[5]);
  expect(observed).not.toContain(projected.value[6]);
});

it.each([
  [
    "float32",
    [
      "7f800000",
      "ff800000",
      "7fc00001",
      "ffc00002",
      "80000000",
      "00000000",
      "3fa00000",
    ],
  ],
  [
    "float64",
    [
      "7ff0000000000000",
      "fff0000000000000",
      "7ff8000000000001",
      "fff8000000000002",
      "8000000000000000",
      "0000000000000000",
      "3ff4000000000000",
    ],
  ],
] as const)("retains independently authored %s IEEE values", (_, payloads) => {
  // An array object followed by seven real objects; no plist builder oracle.
  const start = 8 + 1 + payloads.length;
  const width = payloads[0].length / 2;
  const offsets = [
    8,
    ...payloads.map((_, index) => start + index * (width + 1)),
  ];
  const table = start + payloads.length * (width + 1);
  const trailer = Buffer.alloc(32);
  trailer[6] = 1;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(offsets.length), 8);
  trailer.writeBigUInt64BE(BigInt(table), 24);
  const bytes = Buffer.concat([
    Buffer.from("bplist00"),
    Buffer.from([
      0xa0 | payloads.length,
      ...payloads.map((_, index) => index + 1),
    ]),
    ...payloads.map((hex) =>
      Buffer.concat([
        Buffer.from([width === 4 ? 0x22 : 0x23]),
        Buffer.from(hex, "hex"),
      ]),
    ),
    Buffer.from(offsets),
    trailer,
  ]);
  const original = Buffer.from(bytes);
  const observed: object[] = [];
  const projected = projectPlistValue(parseBinary(bytes), (value) =>
    observed.push(value),
  );
  expect(projected.value).toEqual([
    { $plist_type: "real", value: "+infinity" },
    { $plist_type: "real", value: "-infinity" },
    { $plist_type: "real", value: "nan" },
    { $plist_type: "real", value: "nan" },
    { $plist_type: "real", value: "-0" },
    0,
    1.25,
  ]);
  expect(projected.nonFiniteRealCount).toBe(4);
  expect(projected.negativeZeroRealCount).toBe(1);
  expect(observed).toHaveLength(5);
  expect(Buffer.compare(bytes, original)).toBe(0);
});
