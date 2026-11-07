import { describe, expect, it } from "vitest";

import {
  spelledLikeObserved,
  spellingSummary,
} from "./environmentManifestSpelling.js";

describe("spelledLikeObserved", () => {
  it("compares digit-bearing values by length and character classes, and digit-free ones by family", () => {
    const observed = spellingSummary(["ydr9n16753tzr7zc"]);
    expect(spelledLikeObserved("ab1cd23ef4gh5ij6", observed)).toBe(true);
    expect(spelledLikeObserved("fkmwxmxngagvsxfg", observed)).toBe(true);
    expect(spelledLikeObserved("FkMwxmXNGaGVsXFG", observed)).toBe(false);
    expect(spelledLikeObserved("notifications", observed)).toBe(false);
  });

  it("compares no value longer than the spelling limit, observed or candidate", () => {
    const long = (length: number, last: string) =>
      `${"a".repeat(length - 1)}${last}`;
    expect(
      spelledLikeObserved(long(128, "2"), spellingSummary([long(128, "1")])),
    ).toBe(true);
    const beyond = spellingSummary([long(129, "1")]);
    expect(beyond).toEqual({ shapes: new Set(), family: undefined });
    expect(spelledLikeObserved(long(129, "2"), beyond)).toBe(false);
    // A multi-megabyte segment is summarised without classifying its characters.
    expect(spellingSummary([`${"é".repeat(4_000_000)}1`]).shapes.size).toBe(0);
  });
});
