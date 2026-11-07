import { expect, it } from "vitest";

import { hasValidSourceMapContents } from "./sourceMapContents.js";

it("accepts absent map-level source contents and nullable string slots", () => {
  expect(hasValidSourceMapContents(undefined)).toBe(true);
  expect(hasValidSourceMapContents(null)).toBe(true);
  expect(hasValidSourceMapContents([null, "retained source"])).toBe(true);
  expect(hasValidSourceMapContents([null, 42])).toBe(false);
  expect(hasValidSourceMapContents("retained source")).toBe(false);
});

it("leaves sourcesContent length to source decoding (ECMA-426 DecodeSourceMapSources)", () => {
  expect(hasValidSourceMapContents([])).toBe(true);
  expect(hasValidSourceMapContents(["retained source"])).toBe(true);
  expect(
    hasValidSourceMapContents(["a", null, "unused trailing content"]),
  ).toBe(true);
});
