import { expect, it } from "vitest";

import {
  decodeXmlPlistDateLiteral,
  parseXmlPlistIntegerLiteral,
  parseXmlPlistRealLiteral,
} from "./propertyListXmlScalar.js";

it.each([
  ["42", 42n],
  ["  + 42", 42n],
  ["\n- 0x2a", -42n],
  ["+0XAF", 175n],
  [`${"9".repeat(80)}`, BigInt("9".repeat(80))],
])("parses complete XML plist integer text %j", (raw, expected) => {
  expect(parseXmlPlistIntegerLiteral(raw)).toBe(expected);
});

it.each(["", "42 ", "42\n", "+", "0x", "0 x2a", "42.0", "42&foo;"])(
  "rejects incomplete or trailing XML plist integer text %j",
  (raw) => {
    expect(parseXmlPlistIntegerLiteral(raw)).toBeUndefined();
  },
);

it.each([
  [" 42.5", 42.5],
  ["\t-1.25e2", -125],
  [".5", 0.5],
  ["1.", 1],
  ["NaN", Number.NaN],
  ["+inf", Infinity],
  ["-infinity", -Infinity],
])("parses complete XML plist real text %j", (raw, expected) => {
  expect(parseXmlPlistRealLiteral(raw)).toEqual({ ok: true, value: expected });
});

it.each([
  "",
  "42.5 ",
  "42.5\n",
  "1e",
  "0x1p2",
  "1,25",
  "1suffix",
  "nan ",
  "infinite",
  "-NaN",
])("rejects incomplete or unsupported XML plist real text %j", (raw) => {
  expect(parseXmlPlistRealLiteral(raw)).toEqual({
    ok: false,
    error: "invalid-literal",
  });
});

it.each([
  ["2001-02-03T04:05:06Z", Date.UTC(2001, 1, 3, 4, 5, 6)],
  ["0000-02-29T00:00:00Z", -62162121600000],
])("decodes XML plist date text %s", (raw, expected) => {
  const date = decodeXmlPlistDateLiteral(raw);
  expect(date).toEqual({ ok: true, value: new Date(expected) });
});

it.each([
  "2001-2-03T04:05:06Z",
  "2001-02-03t04:05:06Z",
  "2001-02-03T04:05:06+00:00",
  " 2001-02-03T04:05:06Z",
  "2001-02-03T04:05:06Z ",
  "2001-02-03T04:05:06Z&amp;",
])("rejects malformed XML plist date text %j", (raw) => {
  expect(decodeXmlPlistDateLiteral(raw)).toEqual({
    ok: false,
    error: "invalid-literal",
  });
});

it.each([
  "2001-02-29T04:05:06Z",
  "2000-13-01T00:00:00Z",
  "2000-01-01T24:00:00Z",
  "2000-01-01T00:00:60Z",
  "275761-01-01T00:00:00Z",
])(
  "keeps unsupported XML plist date %s distinct from malformed text",
  (raw) => {
    const date = decodeXmlPlistDateLiteral(raw);
    expect(date).toEqual({ ok: false, error: "unrepresentable" });
  },
);

it("distinguishes finite-spelling overflow from a known infinity", () => {
  expect(parseXmlPlistRealLiteral("1e999")).toEqual({
    ok: false,
    error: "unrepresentable",
  });
  expect(parseXmlPlistRealLiteral("-1e999")).toEqual({
    ok: false,
    error: "unrepresentable",
  });
});

it.each([
  ["\u0085", false, true],
  ["\u00a0", false, true],
  ["\u1680", false, false],
  ["\u2003", true, true],
  ["\u200b", true, true],
  ["\u2028", false, false],
  ["\u202f", false, false],
  ["\u205f", true, false],
  ["\ufeff", false, true],
] as const)(
  "preserves distinct integer and real leading whitespace rules for %j",
  (prefix, integerAccepted, realAccepted) => {
    expect(parseXmlPlistIntegerLiteral(`${prefix}42`)).toBe(
      integerAccepted ? 42n : undefined,
    );
    expect(parseXmlPlistRealLiteral(`${prefix}42`)).toEqual(
      realAccepted
        ? { ok: true, value: 42 }
        : { ok: false, error: "invalid-literal" },
    );
  },
);

it.each([
  ["1-01-01T00:00:00Z", "0001-01-01T00:00:00.000Z"],
  ["-0001-01-01T00:00:00Z", "-000001-01-01T00:00:00.000Z"],
  ["10000-01-01T00:00:00Z", "+010000-01-01T00:00:00.000Z"],
])(
  "interprets year fields as UTC without host string-date inference: %s",
  (literal, iso8601) => {
    expect(decodeXmlPlistDateLiteral(literal)).toEqual({
      ok: true,
      value: new Date(iso8601),
    });
  },
);
