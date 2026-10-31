import { expect, it } from "vitest";

import { jsonStringByteLength } from "./jsonStringByteLength.js";

it("matches native JSON encoding for every individual UTF-16 code unit", () => {
  const mismatches: number[] = [];
  for (let unit = 0; unit <= 0xffff; unit += 1) {
    const value = String.fromCharCode(unit);
    if (
      jsonStringByteLength(value) !== Buffer.byteLength(JSON.stringify(value))
    )
      mismatches.push(unit);
  }
  expect(mismatches).toEqual([]);
});

it("counts adjacent surrogates, escapes and multibyte text as native JSON encodes them", () => {
  const fragments = [
    "",
    "a",
    "\u0000",
    "\b\t\n\f\r",
    '"\\',
    "é",
    "€",
    "\ud7ff",
    "\ue000",
    "\ud800",
    "\udbff",
    "\udc00",
    "\udfff",
    "😀",
  ];
  const mismatches: string[] = [];
  for (const left of fragments)
    for (const right of fragments) {
      const value = left + right;
      if (
        jsonStringByteLength(value) !== Buffer.byteLength(JSON.stringify(value))
      )
        mismatches.push(value);
    }
  expect(mismatches).toEqual([]);
});
