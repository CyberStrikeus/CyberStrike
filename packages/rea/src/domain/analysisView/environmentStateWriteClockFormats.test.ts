import { expect, it } from "vitest";
import type { JsonValue } from "../jsonValue.js";
import {
  clockDigits,
  fittedClockFormat,
  trimmedLike,
} from "./environmentStateWriteClockFormats.js";
import type { ClockFormat } from "./environmentStateWriteValues.js";

const iso = (
  separator: "T" | " ",
  fraction: number,
  zone: string,
): ClockFormat => ({ kind: "iso", separator, fraction, zone });

const WITH_MS = Date.UTC(2026, 2, 4, 5, 6, 7) + 123;

const TRIMMED_9: ClockFormat = {
  kind: "iso",
  separator: "T",
  fraction: 9,
  zone: "Z",
  trimmed: true,
};

it.each<
  [string, ClockFormat, string, string | undefined, ClockFormat | undefined]
>([
  [
    "the format's own spelling",
    iso("T", 9, "Z"),
    "2026-03-04T05:06:07.123456789Z",
    "2026-03-04T05:06:07.123456781Z",
    iso("T", 9, "Z"),
  ],
  [
    "a shorter trimmed fraction",
    iso("T", 9, "Z"),
    "2026-03-04T05:06:07.12345678Z",
    "2026-03-04T05:06:07.123456781Z",
    TRIMMED_9,
  ],
  [
    "a longer one than a trimmed exemplar",
    iso("T", 8, "Z"),
    "2026-03-04T05:06:07.123456781Z",
    "2026-03-04T05:06:07.12345678Z",
    TRIMMED_9,
  ],
  [
    "no fraction beside a trimmed one",
    iso("T", 9, "Z"),
    "2026-03-04T05:06:07Z",
    "2026-03-04T05:06:07.123456781Z",
    TRIMMED_9,
  ],
  [
    "a fraction ending in a zero",
    iso("T", 8, "Z"),
    "2026-03-04T05:06:07.123456780Z",
    "2026-03-04T05:06:07.12345678Z",
    undefined,
  ],
  [
    "an exemplar ending in a zero",
    iso("T", 3, "Z"),
    "2026-03-04T05:06:07.123456Z",
    "2026-03-04T05:06:07.120Z",
    undefined,
  ],
  [
    "another zone",
    iso("T", 9, "Z"),
    "2026-03-04T05:06:07.1234567+00:00",
    "2026-03-04T05:06:07.123456781Z",
    undefined,
  ],
  [
    "a shorter value under a trimmed format",
    TRIMMED_9,
    "2026-03-04T05:06:07.1Z",
    undefined,
    TRIMMED_9,
  ],
])("fits %s to a clock format", (_name, format, value, exemplar, expected) => {
  expect(fittedClockFormat(format, value, exemplar)).toEqual(expected);
});

it("trims a sibling clock spelled alike unless its own value shows a fixed width", () => {
  expect(
    trimmedLike(iso("T", 9, "Z"), TRIMMED_9, "2026-03-04T05:06:07.123456789Z"),
  ).toEqual(TRIMMED_9);
  expect(
    trimmedLike(iso("T", 9, "Z"), TRIMMED_9, "2026-03-04T05:06:07.123456780Z"),
  ).toEqual(iso("T", 9, "Z"));
  expect(
    trimmedLike(iso(" ", 9, "Z"), TRIMMED_9, "2026-03-04 05:06:07.123456789Z"),
  ).toEqual(iso(" ", 9, "Z"));
});

it.each<[JsonValue, string, string | undefined]>([
  ["2026-03-04T05:06:07.123Z", "YYYYMMDDhhmmss", "20260304050607"],
  ["2026-03-04T05:06:07Z", "YYYYMMDD", "20260304"],
  ["2026-03-04T23:30:00-05:00", "YYYY-MM-DD", "2026-03-04"],
  [WITH_MS, "YYYY/MM/DD", "2026/03/04"],
  ["not a clock", "YYYYMMDD", undefined],
])("spells the clock %j's wall clock in %s", (value, pattern, expected) => {
  expect(clockDigits(value, pattern as Parameters<typeof clockDigits>[1])).toBe(
    expected,
  );
});
