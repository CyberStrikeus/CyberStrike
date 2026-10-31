import { expect, it } from "vitest";
import type { JsonValue } from "../jsonValue.js";
import {
  containsDelimited,
  delimitedOffsets,
  formatClock,
  generatedIntegerDigits,
  integerOf,
  isUuid,
  readClock,
  replaceDelimited,
  respellClock,
  seededInteger,
  seededToken,
  seededUuid,
  sequenceNumber,
  slugOf,
  spelledLike,
  type ClockFormat,
} from "./environmentStateWriteValues.js";

const WHOLE_SECOND = Date.UTC(2026, 2, 4, 5, 6, 7);
const WITH_MS = WHOLE_SECOND + 123;
const V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_EXEMPLAR = "123e4567-e89b-12d3-a456-426614174000";

const iso = (
  separator: "T" | " ",
  fraction: number,
  zone: string,
): ClockFormat => ({ kind: "iso", separator, fraction, zone });

const seeds = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `seed-${String(index)}`);

it.each<[string, number, ClockFormat, number?]>([
  [
    "0000-02-29T00:00:00.000123456Z",
    Date.parse("0000-02-29T00:00:00Z"),
    iso("T", 9, "Z"),
    123456,
  ],
  [
    "0001-01-01T00:00:00Z",
    Date.parse("0001-01-01T00:00:00Z"),
    iso("T", 0, "Z"),
  ],
  [
    "0099-01-01T00:00:00Z",
    Date.parse("0099-01-01T00:00:00Z"),
    iso("T", 0, "Z"),
  ],
  [
    "0100-01-01T00:00:00Z",
    Date.parse("0100-01-01T00:00:00Z"),
    iso("T", 0, "Z"),
  ],
  ["2026-03-04T05:06:07Z", WHOLE_SECOND, iso("T", 0, "Z")],
  ["2026-03-04 05:06:07.123Z", WITH_MS, iso(" ", 3, "Z")],
  ["2026-03-04T05:06:07.123456Z", WITH_MS, iso("T", 6, "Z"), 456000],
  ["2026-03-04T07:06:07.123+02:00", WITH_MS, iso("T", 3, "+02:00")],
  ["2026-03-03T23:36:07-0530", WHOLE_SECOND, iso("T", 0, "-0530")],
  [
    "2000-01-01T12:00:00+23:59",
    Date.UTC(1999, 11, 31, 12, 1),
    iso("T", 0, "+23:59"),
  ],
  ["2026-03-04T05:06:07", WHOLE_SECOND, iso("T", 0, "")],
  ["2024-02-29 00:00:00Z", Date.UTC(2024, 1, 29), iso(" ", 0, "Z")],
])(
  "reads the ISO clock %s with its spelling",
  (text, ms, format, subMillisecond = 0) => {
    expect(readClock(text)).toEqual({
      ms,
      subMillisecond,
      format,
      fixedWidth: false,
    });
  },
);

it.each<[string, boolean]>([
  ["2026-03-04T05:06:07.120Z", true],
  ["2026-03-04T05:06:07.000Z", true],
  ["2026-03-04T05:06:07.12Z", false],
  ["2026-03-04T05:06:07Z", false],
])("reads whether the fraction of %s shows a fixed width", (text, fixed) => {
  expect(readClock(text)?.fixedWidth).toBe(fixed);
});

it.each([
  "0001-02-29T00:00:00Z",
  "0099-02-29T00:00:00Z",
  "0100-02-29T00:00:00Z",
  "2026-02-30T00:00:00Z",
  "2026-02-29T00:00:00Z",
  "2026-13-01T00:00:00Z",
  "2026-03-04T24:00:00Z",
  "2026-03-04T05:60:00Z",
  "2026-03-04T05:06:60Z",
  "2026-03-04T05:06:07+00:60",
  "2026-03-04T05:06:07+24:00",
  "2026-03-04T05:06:07+99:99",
  "2026-03-04",
  "2026-03-04T05:06Z",
  "2026-03-04T05:06:07+05",
  "2026-03-04T05:06:07.1234567890Z",
  "2026-03-04t05:06:07Z",
  "next tuesday",
])("refuses %s as a clock", (text) => {
  expect(readClock(text)).toBeUndefined();
});

it.each(["0000", "0001", "0099", "0100"])(
  "retains first-century ISO year %s without Date.UTC's adjustment",
  (year) => {
    const value = `${year}-01-01T00:00:00Z`;
    expect(readClock(value)).toBeDefined();
    expect(respellClock(value, iso(" ", 3, "Z"))).toBe(
      `${year}-01-01 00:00:00.000Z`,
    );
  },
);

it.each(["𐐀42𐐁", "𝟙42𝟚", "é42é", "A42B"])(
  "keeps token42 embedded in complete Unicode letters or digits: %s",
  (text) => {
    expect(delimitedOffsets(text, "42")).toEqual([]);
    expect(replaceDelimited(text, "42", "43")).toBe(text);
  },
);

it("preserves UTF-16 offsets while accepting emoji as a delimiter", () => {
  expect(delimitedOffsets("😀42😀", "42")).toEqual([2]);
  expect(replaceDelimited("😀42😀", "42", "43")).toBe("😀43😀");
});

it.each<[string, number[], string]>([
  ["A\uDC0042", [2], "A\uDC0043"],
  ["é\uDFFF42", [2], "é\uDFFF43"],
  ["\uDC0042", [1], "\uDC0043"],
  ["A\uDC0042\uD800B", [2], "A\uDC0043\uD800B"],
  ["A\uD80042", [2], "A\uD80043"],
  ["42\uDC00A", [0], "43\uDC00A"],
  ["\uD800\uDC0042", [], "\uD800\uDC0042"],
])(
  "classifies only the immediate code point beside raw UTF-16 text %j",
  (text, offsets, replaced) => {
    expect(delimitedOffsets(text, "42")).toEqual(offsets);
    expect(replaceDelimited(text, "42", "43")).toBe(replaced);
  },
);

it.each(["0000-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00"])(
  "keeps %s when conversion cannot fit the four-digit year format",
  (value) => {
    const clock = readClock(value)!;
    expect(respellClock(value, iso("T", 0, "Z"))).toBe(value);
    expect(formatClock(clock.ms, iso("T", 0, "Z"))).toBeUndefined();
    expect(formatClock(clock.ms, clock.format)).toBe(value);
  },
);

it.each<[JsonValue | undefined, ReturnType<typeof readClock>]>([
  [
    WHOLE_SECOND / 1000,
    {
      ms: WHOLE_SECOND,
      subMillisecond: 0,
      format: { kind: "epoch", unit: "s" },
      fixedWidth: true,
    },
  ],
  [
    WITH_MS,
    {
      ms: WITH_MS,
      subMillisecond: 0,
      format: { kind: "epoch", unit: "ms" },
      fixedWidth: true,
    },
  ],
  [999_999_999, undefined],
  [99_999_999_999, undefined],
  [10_000_000_000_000, undefined],
  [WHOLE_SECOND / 1000 + 0.5, undefined],
  [String(WHOLE_SECOND / 1000), undefined],
  [null, undefined],
  [undefined, undefined],
])("reads the epoch value %j", (value, expected) => {
  expect(readClock(value)).toEqual(expected);
});

it.each<JsonValue>([
  "2026-03-04T05:06:07Z",
  "2026-03-04 05:06:07.123Z",
  "2026-03-04T07:06:07.123+02:00",
  "2026-03-03T23:36:07-0530",
  "2026-03-04T05:06:07.1",
  "2026-03-04T05:06:07.123000000",
  WHOLE_SECOND / 1000,
  WITH_MS,
])("formats %j back to its own spelling", (value) => {
  const clock = readClock(value)!;
  expect(formatClock(clock.ms, clock.format)).toBe(value);
});

it.each<[ClockFormat, JsonValue]>([
  [iso("T", 6, "Z"), "2026-03-04T05:06:07.123000Z"],
  [iso(" ", 9, ""), "2026-03-04 05:06:07.123000000"],
  [iso("T", 1, "Z"), "2026-03-04T05:06:07.1Z"],
  [iso("T", 0, "+02:00"), "2026-03-04T07:06:07+02:00"],
  [iso("T", 3, "-0530"), "2026-03-03T23:36:07.123-0530"],
  [{ kind: "epoch", unit: "s" }, WHOLE_SECOND / 1000],
  [{ kind: "epoch", unit: "ms" }, WITH_MS],
])("formats an instant as %j", (format, expected) => {
  expect(formatClock(WITH_MS, format)).toBe(expected);
});

it.each<[JsonValue | undefined, boolean]>([
  [UUID_EXEMPLAR, true],
  [UUID_EXEMPLAR.toUpperCase(), true],
  [UUID_EXEMPLAR.replaceAll("-", ""), false],
  [UUID_EXEMPLAR.slice(1), false],
  [`g${UUID_EXEMPLAR.slice(1)}`, false],
  [` ${UUID_EXEMPLAR}`, false],
  [42, false],
  [undefined, false],
])("isUuid(%j) is %s", (value, expected) => {
  expect(isUuid(value)).toBe(expected);
});

it.each<[JsonValue | undefined, number | undefined]>([
  [42, 42],
  [-3, -3],
  ["42", 42],
  ["007", 7],
  ["123456789012345", 123_456_789_012_345],
  ["1234567890123456", undefined],
  ["-3", undefined],
  ["4.2", undefined],
  [4.2, undefined],
  [2 ** 53, undefined],
  ["", undefined],
  [" 4", undefined],
  [true, undefined],
  [null, undefined],
  [undefined, undefined],
])("integerOf(%j) is %j", (value, expected) => {
  expect(integerOf(value)).toBe(expected);
});

it("spells an integer as the recorded value spells integers", () => {
  expect(spelledLike("7", 8)).toBe("8");
  expect(spelledLike(7, 8)).toBe(8);
  expect(spelledLike(null, 8)).toBe(8);
});

it.each([
  ["Hello World", "hello-world"],
  ["Héllo, Wörld!", "hello-world"],
  ["  Crème   brûlée -- recipe__v2  ", "creme-brulee-recipe-v2"],
  ["Ｆｕｌｌｗｉｄｔｈ ２", "fullwidth-2"],
  ["already-a-slug", "already-a-slug"],
  ["--Edge--", "edge"],
  ["!!!", ""],
])("slugOf(%j) is %j", (text, slug) => {
  expect(slugOf(text)).toBe(slug);
});

it.each<[string, string, number[]]>([
  ["/issues/2", "2", [8]],
  ["2026", "2", []],
  ["2 of 22, page 2", "2", [0, 14]],
  ["x2/2y", "2", []],
  ["é2", "2", []],
  ["https://x.test/items/abc123?ref=abc123", "abc123", [21, 32]],
  ["anything", "", []],
])("finds %j's delimited %j at %j", (text, token, offsets) => {
  expect(delimitedOffsets(text, token)).toEqual(offsets);
});

it("replaces only delimited occurrences", () => {
  expect(replaceDelimited("/issues/2 in 2026", "2", "9")).toBe(
    "/issues/9 in 2026",
  );
  expect(replaceDelimited("a-2-b-2", "2", "10")).toBe("a-10-b-10");
  expect(replaceDelimited("2026", "2", "9")).toBe("2026");
});

// Known bug: a rejected match skips its whole length, hiding an overlapping delimited one.
it("finds a delimited match that overlaps an undelimited one", () => {
  expect(delimitedOffsets("11-1-1", "1-1")).toEqual([3]);
});

it("finds a delimited token in any string nested in objects and arrays", () => {
  expect(
    containsDelimited({ a: [1, { b: ["x", "see /issues/2"] }] }, "2"),
  ).toBe(true);
  expect(containsDelimited("2", "2")).toBe(true);
  expect(containsDelimited({ c: "2026", n: 2, d: null }, "2")).toBe(false);
  expect(containsDelimited(["2026", true, [{ e: "x2" }]], "2")).toBe(false);
});

it("searches arrays and objects too wide to spread into one call", () => {
  const wide = Array.from({ length: 500_000 }, () => 0);
  expect(containsDelimited(wide, "2")).toBe(false);
  expect(containsDelimited({ wide: [...wide, "see /issues/2"] }, "2")).toBe(
    true,
  );
  expect(
    containsDelimited(
      Object.fromEntries(wide.map((value, index) => [String(index), value])),
      "2",
    ),
  ).toBe(false);
});

it("derives a deterministic version 4 UUID per seed", () => {
  const first = seededUuid("seed-a", UUID_EXEMPLAR);
  expect(first).toMatch(V4_UUID);
  expect(seededUuid("seed-a", UUID_EXEMPLAR)).toBe(first);
  const derived = seeds(64).map((seed) => seededUuid(seed, UUID_EXEMPLAR));
  expect(new Set(derived).size).toBe(derived.length);
  for (const uuid of derived) expect(uuid).toMatch(V4_UUID);
});

it("keeps upper case only when the recorded UUID is upper case", () => {
  const upper = seededUuid("seed-a", UUID_EXEMPLAR.toUpperCase());
  expect(upper).toBe(seededUuid("seed-a", UUID_EXEMPLAR).toUpperCase());
  expect(upper).toMatch(/[A-F]/u);
  const digits = "12345678-1234-4234-8234-123456789012";
  expect(seededUuid("seed-a", digits)).toMatch(V4_UUID);
  const mixed = "123e4567-E89B-12d3-a456-426614174000";
  expect(seededUuid("seed-a", mixed)).toMatch(V4_UUID);
});

it.each<[string, RegExp]>([
  ["a1b2c3d4e5f6", /^[0-9a-f]{12}$/u],
  ["A1B2C3D4E5F6", /^[0-9A-F]{12}$/u],
  ["k9x2m7q4z1w8", /^[0-9a-z]{12}$/u],
  ["AbCdEfGhIjKl", /^[A-Za-z]{12}$/u],
  ["deadbeefcafe", /^[a-z]{12}$/u],
  [
    "tok_9Xa-7bQ.2",
    /^[0-9A-Za-z]{3}_[0-9A-Za-z]{3}-[0-9A-Za-z]{3}\.[0-9A-Za-z]$/u,
  ],
  ["____", /^____$/u],
])("keeps the length and character classes of %j", (exemplar, shape) => {
  for (const seed of seeds(16)) {
    const token = seededToken(seed, exemplar);
    expect(token).toHaveLength(exemplar.length);
    expect(token).toMatch(shape);
    expect(seededToken(seed, exemplar)).toBe(token);
  }
});

it("draws tokens from the whole alphabet the recorded token uses", () => {
  const characters = (exemplar: string): string =>
    seeds(64)
      .map((seed) => seededToken(seed, exemplar))
      .join("");
  expect(characters("a1b2c3d4e5f6")).toMatch(/^[0-9a-f]+$/u);
  expect(characters("k9x2m7q4z1w8")).toMatch(/[g-z]/u);
  const mixed = characters("AbCdEfGhIjKl");
  expect(mixed).toMatch(/[a-z]/u);
  expect(mixed).toMatch(/[A-Z]/u);
  expect(seededToken("seed-a", "k9x2m7q4z1w8")).not.toBe(
    seededToken("seed-b", "k9x2m7q4z1w8"),
  );
});

it("reads a sequence written as digit groups of one width, but not a date, version or address", () => {
  expect(sequenceNumber("000-005")).toBe(5);
  expect(sequenceNumber("00-01-12")).toBe(112);
  expect(sequenceNumber(7)).toBe(7);
  for (const other of ["2026-10-21", "2026-08", "12.04", "1.2.3", "10.0.0.9"])
    expect(sequenceNumber(other)).toBeUndefined();
  expect(sequenceNumber("A-005")).toBeUndefined();
  expect(sequenceNumber("000-")).toBeUndefined();
});

it("reads a count that outgrew its mask only as the exemplar's spelling of it", () => {
  expect(sequenceNumber("100-00", "99-99")).toBe(10_000);
  expect(sequenceNumber("1000-000", "000-005")).toBe(1_000_000);
  expect(sequenceNumber("100-00")).toBeUndefined();
  for (const other of ["2026-10-21", "20261-02", "100-0"])
    expect(sequenceNumber(other, "000-005")).toBeUndefined();
  expect(sequenceNumber("100-00", "2026-10")).toBeUndefined();
});

it("spells a sequence value in the recorded value's digit groups, the overflow leading", () => {
  expect(spelledLike("000-005", 6)).toBe("000-006");
  expect(spelledLike("000-999", 1000)).toBe("001-000");
  expect(spelledLike("999-999", 1_000_000)).toBe("1000-000");
  expect(spelledLike("12", 13)).toBe("13");
  expect(spelledLike(12, 13)).toBe(13);
});

it("respells a clock in another format, padding its fraction digits to the format's width but dropping none", () => {
  const utc = iso("T", 6, "+00:00");
  expect(respellClock("2026-10-21T17:06:13.710410Z", utc)).toBe(
    "2026-10-21T17:06:13.710410+00:00",
  );
  expect(respellClock("2026-10-21 17:06:13Z", utc)).toBe(
    "2026-10-21T17:06:13.000000+00:00",
  );
  expect(respellClock("2026-10-21T17:06:13.710410Z", iso("T", 0, "Z"))).toBe(
    "2026-10-21T17:06:13.710410Z",
  );
  // An epoch spelling is formatted from the instant.
  expect(
    respellClock("2026-10-21T17:06:13Z", { kind: "epoch", unit: "s" }),
  ).toBe(Date.UTC(2026, 9, 21, 17, 6, 13) / 1000);
  expect(respellClock("not a clock", utc)).toBe("not a clock");
});

it("respells a clock at another offset with its own fraction digits, across a date change", () => {
  expect(
    respellClock("2026-10-21T17:06:13.710410Z", iso("T", 6, "+02:00")),
  ).toBe("2026-10-21T19:06:13.710410+02:00");
  expect(
    respellClock("2026-10-21T23:30:00.000321Z", iso(" ", 6, "+05:30")),
  ).toBe("2026-10-22 05:00:00.000321+05:30");
  expect(
    respellClock("2026-10-21T01:00:00.5+01:00", iso("T", 3, "-03:00")),
  ).toBe("2026-10-20T21:00:00.500-03:00");
  // An epoch value's milliseconds are its fraction digits.
  const epochMs = Date.UTC(2026, 9, 21, 17, 6, 13, 250);
  expect(respellClock(epochMs, iso("T", 0, "Z"))).toBe(
    "2026-10-21T17:06:13.25Z",
  );
  expect(respellClock(epochMs, iso("T", 3, "+00:00"))).toBe(
    "2026-10-21T17:06:13.250+00:00",
  );
});

const TRIMMED_9: ClockFormat = {
  kind: "iso",
  separator: "T",
  fraction: 9,
  zone: "Z",
  trimmed: true,
};

it("spells a trimmed format without trailing fraction zeros, and without the point when none remain", () => {
  expect(formatClock(WITH_MS, TRIMMED_9)).toBe("2026-03-04T05:06:07.123Z");
  expect(formatClock(WHOLE_SECOND, TRIMMED_9)).toBe("2026-03-04T05:06:07Z");
  expect(respellClock("2026-03-04T05:06:07.120000Z", TRIMMED_9)).toBe(
    "2026-03-04T05:06:07.12Z",
  );
});

it("seeds integers as long as the recorded one, keeping its JSON kind and a safe number", () => {
  const number = seededInteger("seed", 1656166527623168);
  expect(typeof number).toBe("number");
  expect(Number.isSafeInteger(number)).toBe(true);
  expect(String(number)).toMatch(/^[1-8]\d{15}$/u);
  expect(seededInteger("seed", 1656166527623168)).toBe(number);
  expect(seededInteger("other", 1656166527623168)).not.toBe(number);
  expect(seededInteger("seed", "1234567890123456789")).toMatch(
    /^[1-9]\d{18}$/u,
  );
});

it.each<[JsonValue, string | undefined]>([
  [1656166527623168, "1656166527623168"],
  ["1234567890123456789", "1234567890123456789"],
  [123456789, undefined],
  ["0123456789012", undefined],
  [-1656166527623168, undefined],
  [1.5e15 + 0.5, undefined],
])("reads %j as a generated integer's digits", (value, expected) => {
  expect(generatedIntegerDigits(value)).toBe(expected);
});
