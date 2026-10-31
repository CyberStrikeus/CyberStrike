import { describe, expect, it } from "vitest";
import { literalSubstringPredicate } from "../domain/analysisSearch.js";
import { ghidraAsciiLiteralCandidate } from "./GhidraLiteralSearch.js";

describe("Ghidra ASCII literal candidates", () => {
  it.each([
    ["ASCII.[A]", "ascii.[a]"],
    ["ſK", "sk"],
    ["İ", null],
    ["ı", null],
    ["Σ", null],
    ["ß", null],
    ["\ud800", null],
    ["𐐀", null],
  ])("derives %j as %j", (pattern, expected) => {
    expect(ghidraAsciiLiteralCandidate(pattern!)).toBe(expected);
  });

  it("retains every matching ASCII candidate for Unicode edge cases", () => {
    const patterns = [
      "s",
      "ſ",
      "k",
      "K",
      "i",
      "İ",
      "ı",
      "σ",
      "ς",
      "Σ",
      "ß",
      "ss",
      "𐐀",
      "\ud800",
      "ſ.a",
      "a\n",
    ];
    const values = [
      "S",
      "s",
      "K",
      "k",
      "i",
      "I",
      "ss",
      "SS",
      "prefixS.aSuffix",
      "A\n",
      "unrelated",
    ];
    for (const pattern of patterns) {
      const candidate = ghidraAsciiLiteralCandidate(pattern);
      const matches = literalSubstringPredicate(pattern, false);
      for (const value of values) {
        expect(
          candidate !== null && value.toLowerCase().includes(candidate),
        ).toBe(matches(value));
      }
    }
  });
});
