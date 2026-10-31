import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  inspectRecordedDateTime,
  offsetDateTimeSchema,
  readRecordedDateTime,
  readRecordedStart,
  offsetDateTimeInstantFromEpochMilliseconds,
  utcDateTimeSchema,
} from "./offsetDateTime.js";

it.each([
  ["2026-02-30T09:00:00Z", "invalid"],
  ["1900-02-29 09:00:00", "invalid"],
  ["2026-10-20T24:00:00Z", "invalid"],
  ["2026-10-20T09:00:00+24:00", "invalid"],
  ["2026-10-20 09:00:00.0000000001", "valid"],
  ["Tue, 20 Oct 2026 09:00:00 GMT", "unrecognized"],
  ["2026-10-20", "unrecognized"],
])("classifies recorded spelling %s as %s", (text, kind) => {
  expect(inspectRecordedDateTime(text).kind).toBe(kind);
});

const ACCEPTED: readonly (readonly [string, string])[] = [
  ["a UTC timestamp", "2026-10-09T04:00:00Z"],
  ["a positive offset", "2026-10-09T04:00:00+02:00"],
  ["a negative offset", "2026-10-09T04:00:00-03:00"],
  ["a half-hour offset", "2026-10-09T04:00:00+05:30"],
  ["a zero offset written negatively", "2026-10-09T04:00:00-00:00"],
  ["omitted seconds", "2026-10-09T04:00Z"],
  ["fractional seconds", "2026-10-09T04:00:00.123Z"],
  [
    "long fractional seconds with an offset",
    "2026-10-09T04:00:00.123456+05:30",
  ],
  ["the last second of a day", "2026-10-09T23:59:59Z"],
  ["a leap day in a divisible-by-four year", "2024-02-29T00:00:00Z"],
  ["a leap day in a divisible-by-400 century year", "2000-02-29T00:00:00Z"],
];

const REJECTED: readonly (readonly [string, string])[] = [
  ["a leap day in a non-leap year", "2023-02-29T00:00:00Z"],
  ["a leap day in a divisible-by-100 but not 400 year", "1900-02-29T00:00:00Z"],
  ["a day beyond the month length", "2026-04-31T00:00:00Z"],
  ["a month above twelve", "2026-13-01T00:00:00Z"],
  ["a month below one", "2026-00-10T00:00:00Z"],
  ["an hour above twenty-three", "2026-10-09T24:00:00Z"],
  ["an offset hour above twenty-three", "2026-10-09T04:00:00+24:00"],
  ["a missing offset", "2026-10-09T04:00:00"],
  ["a lowercase offset designator", "2026-10-09T04:00:00z"],
  ["a repeated offset designator", "2026-10-09T04:00:00ZZ"],
  ["a basic-format timestamp", "20261009T040000Z"],
  ["a date without a time", "2026-10-09"],
  ["an offset without a colon", "2026-10-09T04:00:00+0200"],
  ["a lowercase time separator", "2026-10-09t04:00:00Z"],
  ["an empty string", ""],
  ["unrelated text", "not a timestamp"],
];

describe("offset datetime schema", () => {
  it.each(ACCEPTED)("accepts %s", (_label, value) => {
    expect(offsetDateTimeSchema.safeParse(value).success).toBe(true);
  });

  it.each(REJECTED)("rejects %s", (_label, value) => {
    expect(offsetDateTimeSchema.safeParse(value).success).toBe(false);
  });
});

describe("UTC datetime schema", () => {
  it.each(ACCEPTED.filter(([, value]) => value.endsWith("Z")))(
    "preserves %s without rewriting the source value",
    (_label, value) => {
      expect(utcDateTimeSchema.parse(value)).toBe(value);
    },
  );

  it.each([
    ...REJECTED,
    ...ACCEPTED.filter(([, value]) => !value.endsWith("Z")),
    [
      "omitted seconds with a numeric offset",
      "2026-10-09T04:00+02:00",
    ] as const,
  ])("rejects %s", (_label, value) => {
    expect(utcDateTimeSchema.safeParse(value).success).toBe(false);
  });
});

describe.each([
  ["offset", offsetDateTimeSchema],
  ["UTC", utcDateTimeSchema],
] as const)("%s datetime advertisement", (_name, schema) => {
  it("emits a pattern that compiles in every mode a client may use", () => {
    const emitted = z.toJSONSchema(z.object({ observed_at: schema }), {
      target: "draft-2020-12",
    });
    const pattern = findPattern(emitted);
    expect(pattern).toBeDefined();
    if (pattern === undefined) return;
    expect(() => new RegExp(pattern)).not.toThrow();
    expect(() => new RegExp(pattern, "u")).not.toThrow();
    expect(() => new RegExp(pattern, "v")).not.toThrow();
  });
});

describe("recorded datetime facts", () => {
  const epochSecond = Date.UTC(2026, 9, 20, 9) / 1000;

  it.each<{
    text: string;
    expected: NonNullable<ReturnType<typeof readRecordedDateTime>>;
  }>([
    {
      text: "2026-10-20T09:00:00.000100Z",
      expected: {
        instant: { epochSecond, fraction: "0001" },
        spelling: {
          separator: "T",
          secondsPresent: true,
          fractionDigits: 6,
          zone: "Z",
        },
      },
    },
    {
      text: "2026-10-20 10:00:00.000100+0100",
      expected: {
        instant: { epochSecond, fraction: "0001" },
        spelling: {
          separator: " ",
          secondsPresent: true,
          fractionDigits: 6,
          zone: "+0100",
        },
      },
    },
    {
      text: "2026-10-20T09:00:00.0000000002",
      expected: {
        instant: { epochSecond, fraction: "0000000002" },
        spelling: {
          separator: "T",
          secondsPresent: true,
          fractionDigits: 10,
          zone: "",
        },
      },
    },
    {
      text: "2026-10-20T08:30:00.1234567890123456789000-00:30",
      expected: {
        instant: { epochSecond, fraction: "1234567890123456789" },
        spelling: {
          separator: "T",
          secondsPresent: true,
          fractionDigits: 22,
          zone: "-00:30",
        },
      },
    },
    {
      text: "2026-10-20T09:00-00:00",
      expected: {
        instant: { epochSecond, fraction: "" },
        spelling: {
          separator: "T",
          secondsPresent: false,
          fractionDigits: 0,
          zone: "-00:00",
        },
      },
    },
    {
      text: "2026-10-20 10:00+0100",
      expected: {
        instant: { epochSecond, fraction: "" },
        spelling: {
          separator: " ",
          secondsPresent: false,
          fractionDigits: 0,
          zone: "+0100",
        },
      },
    },
    {
      text: "0001-01-01T01:00:00.0000000002+0100",
      expected: {
        instant: { epochSecond: -62_135_596_800, fraction: "0000000002" },
        spelling: {
          separator: "T",
          secondsPresent: true,
          fractionDigits: 10,
          zone: "+0100",
        },
      },
    },
    {
      text: "0000-02-29 00:00:00.000Z",
      expected: {
        instant: { epochSecond: -62_162_121_600, fraction: "" },
        spelling: {
          separator: " ",
          secondsPresent: true,
          fractionDigits: 3,
          zone: "Z",
        },
      },
    },
  ])(
    "preserves the exact instant and source spelling of $text",
    ({ text, expected }) => {
      expect(readRecordedDateTime(text)).toEqual(expected);
    },
  );

  it.each([
    "0001-02-29T00:00:00Z",
    "1900-02-29 00:00:00",
    "2026-04-31 00:00:00+0100",
    "2026-13-01T00:00:00Z",
    "2026-10-20T24:00:00Z",
    "2026-10-20T09:60:00Z",
    "2026-10-20T09:00:60Z",
    "2026-10-20T09:00:00+24:00",
    "2026-10-20 09:00:00+0060",
    "2026-10-20T09:00:00+01",
    "2026-10-20T09:00.1Z",
    "2026-10-20t09:00:00Z",
    "2026-10-20T09:00:00z",
    "2026-10-20",
    "Tue, 20 Oct 2026 09:00:00 GMT",
  ])("does not invent ISO facts for %s", (text) => {
    expect(readRecordedDateTime(text)).toBeUndefined();
  });
});

const findPattern = (value: unknown): string | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  if ("pattern" in value && typeof value.pattern === "string")
    return value.pattern;
  for (const entry of Object.values(value)) {
    const found = findPattern(entry);
    if (found !== undefined) return found;
  }
  return undefined;
};

it.each([
  "Tue, 20 Oct 2026 09:00:00 GMT",
  "Tue, 20 Oct 2026 14:30:00 GMT+0530",
  "October 20, 2026 09:00:00",
])("preserves native start interpretation for %s", (value) => {
  const milliseconds = Date.parse(value);
  expect(Number.isFinite(milliseconds)).toBe(true);
  expect(readRecordedStart(value)).toEqual({
    instant: offsetDateTimeInstantFromEpochMilliseconds(milliseconds),
    interpretation: "native-date",
  });
});

it.each([
  "2026-02-30T09:00:00Z",
  "1900-02-29 09:00:00",
  "2026-10-20T24:00:00Z",
  "not a recorded start",
])("keeps invalid start %s unknown without native rollover", (value) => {
  expect(readRecordedStart(value)).toBeUndefined();
});

it("keeps every ISO start fraction digit and treats its absent zone as UTC", () => {
  const value = "2026-10-20 09:00:00.000000000123";
  expect(readRecordedStart(value)).toEqual({
    instant: readRecordedDateTime(`${value}Z`)!.instant,
    interpretation: "recorded-iso",
  });
  expect(readRecordedStart(value)?.instant.fraction).toBe("000000000123");
});
