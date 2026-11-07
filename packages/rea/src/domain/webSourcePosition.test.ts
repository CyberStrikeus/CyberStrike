import { expect, it } from "vitest";
import { webSourceOffset } from "./webSourcePosition.js";

it("uses UTF-16 columns and actual JavaScript line terminators", () => {
  const text = "🎋a\r\nb\rc\nd\u2028e\u2029";
  expect(webSourceOffset(text, { line: 1, column: 2 })).toBe(2);
  expect(webSourceOffset(text, { line: 1, column: 3 })).toBe(3);
  expect(webSourceOffset(text, { line: 1, column: 4 })).toBeUndefined();
  expect(webSourceOffset(text, { line: 2, column: 0 })).toBe(5);
  expect(webSourceOffset(text, { line: 6, column: 0 })).toBe(13);
  expect(webSourceOffset(text, { line: 7, column: 0 })).toBeUndefined();
});

it.each([
  { line: 0, column: 0 },
  { line: 1, column: -1 },
  { line: 1.5, column: 0 },
])("rejects invalid source positions: %j", (position) => {
  expect(webSourceOffset("", position)).toBeUndefined();
});

it("retains the empty source and the final empty line", () => {
  expect(webSourceOffset("", { line: 1, column: 0 })).toBe(0);
  expect(webSourceOffset("a\r\n", { line: 2, column: 0 })).toBe(3);
});
