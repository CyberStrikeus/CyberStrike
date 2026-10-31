import { expect, it } from "vitest";
import {
  siblingTrimmedClocks,
  type FieldRule,
} from "./environmentStateWriteRules.js";

it.each([false, true])(
  "propagates the widest trimmed peer in each separator/zone group (reversed: %s)",
  (reverse) => {
    const clock = (
      field: string,
      separator: "T" | " ",
      zone: string,
      fraction: number,
      trimmed = false,
    ): FieldRule => ({
      field,
      rule: "clock",
      format: {
        kind: "iso",
        separator,
        zone,
        fraction,
        ...(trimmed ? { trimmed: true } : {}),
      },
    });
    const rules = [
      clock("utc", "T", "Z", 9, true),
      clock("shortOffset", "T", "+01:00", 6, true),
      clock("wideOffset", "T", "+01:00", 9, true),
      clock("offsetSibling", "T", "+01:00", 8),
      clock("spaced", " ", "+01:00", 9, true),
      clock("spacedSibling", " ", "+01:00", 8),
      clock("fixedSibling", "T", "+01:00", 9),
      clock("otherZone", "T", "-01:00", 8),
    ];
    const fitted = siblingTrimmedClocks(reverse ? rules.toReversed() : rules, {
      offsetSibling: "2026-03-04T05:06:07.12345678+01:00",
      spacedSibling: "2026-03-04 05:06:07.12345678+01:00",
      fixedSibling: "2026-03-04T05:06:07.123456780+01:00",
      otherZone: "2026-03-04T05:06:07.12345678-01:00",
    });
    expect(fitted).toContainEqual(
      clock("offsetSibling", "T", "+01:00", 9, true),
    );
    expect(fitted).toContainEqual(
      clock("spacedSibling", " ", "+01:00", 9, true),
    );
    expect(fitted).toContainEqual(clock("fixedSibling", "T", "+01:00", 9));
    expect(fitted).toContainEqual(clock("otherZone", "T", "-01:00", 8));
  },
);
