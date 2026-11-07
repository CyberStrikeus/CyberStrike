import { expect, it } from "vitest";

import {
  analysisSearchPredicate,
  literalSubstringPredicate,
} from "./analysisSearch.js";

it("uses Unicode simple case folding for literal substrings", () => {
  const matchesSigma = literalSubstringPredicate("Σ", false);
  expect(matchesSigma("ΟΣ")).toBe(true);
  expect(matchesSigma("ος")).toBe(true);
  expect(matchesSigma("unrelated")).toBe(false);
  expect(literalSubstringPredicate("Σ", true)("ος")).toBe(false);
  expect(literalSubstringPredicate("A.B", false)("a.b")).toBe(true);
  expect(literalSubstringPredicate("A.B", false)("axb")).toBe(false);
});

it.each([
  ["Σ", "ΟΣ"],
  ["σ", "ΟΣ"],
  ["ς", "ΟΣ"],
  ["Σ", "ΣA"],
  ["foo", "FOO"],
  ["ΟΣ", "ΟΣ"],
])(
  "retains native literal match %s in %s when case is ignored",
  (pattern, value) => {
    expect(
      analysisSearchPredicate({
        pattern,
        mode: "literal",
        case_sensitive: false,
        document: undefined,
      })(value),
    ).toBe(true);
    expect(
      analysisSearchPredicate({
        pattern,
        mode: "literal",
        case_sensitive: true,
        document: undefined,
      })(value),
    ).toBe(value.includes(pattern));
    expect(
      analysisSearchPredicate({
        pattern,
        mode: "regex",
        case_sensitive: false,
        document: undefined,
      })(value),
    ).toBe(true);
  },
);
