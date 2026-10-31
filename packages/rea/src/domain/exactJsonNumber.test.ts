import { expect, it } from "vitest";

import { isExactJsonNumber } from "./exactJsonNumber.js";

const spellings = [
  "0",
  "42",
  "-7",
  "1.5",
  "0.1",
  "1e3",
  "1e-7",
  "9007199254740991",
  "9007199254740992",
  "9.007199254740992e15",
  "1e20",
  "100000000000000000000",
  "1e21",
  "1.7976931348623157e308",
];

it("judges a number alike in every spelling, so an accepted number is accepted again once written back", () => {
  for (const spelling of spellings) {
    const value = Number(spelling);
    if (isExactJsonNumber(value, spelling))
      expect(isExactJsonNumber(value, String(value)), spelling).toBe(true);
  }
  expect(isExactJsonNumber(1e20, "1e20")).toBe(false);
  expect(isExactJsonNumber(1e20, "100000000000000000000")).toBe(false);
  expect(isExactJsonNumber(1e21, "1e21")).toBe(true);
  expect(isExactJsonNumber(9007199254740991, "9007199254740991")).toBe(true);
  expect(isExactJsonNumber(-0, "-0")).toBe(false);
});
