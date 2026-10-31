import { expect, it } from "vitest";

import { plistNestingLimitMessage } from "./apple/plistValue.js";
import { parseXmlPropertyList } from "./propertyListKeys.js";

it("preserves array values and comment-like string content after leading trivia", () => {
  const parsed = parseXmlPropertyList(
    '\uFEFF /* header */ // array\r\n ("https://example.test", "/*literal*/")',
  );
  expect(parsed.value).toEqual(["https://example.test", "/*literal*/"]);
  expect(parsed.numberLiterals.incomplete).toBe(true);
});

it("preserves own prototype keys through commented OpenStep dispatch", () => {
  const parsed = parseXmlPropertyList(
    '/* header */ { __proto__ = { secret = value; }; kept = "/*literal*/"; }',
  );
  expect(parsed.value).toEqual({
    ["__proto__"]: { secret: "value" },
    kept: "/*literal*/",
  });
});

it("retains the source depth limit after a leading comment", () => {
  expect(() =>
    parseXmlPropertyList(`// header\n${"(".repeat(129)}x${")".repeat(129)}`),
  ).toThrow(plistNestingLimitMessage());
});

it.each(["// header only", "/* unterminated", "/* header */ not-a-container"])(
  "does not admit missing or unsupported root values: %s",
  (source) => {
    expect(() => parseXmlPropertyList(source)).toThrow();
  },
);

it("keeps XML comments on the XML decoding path", () => {
  expect(
    parseXmlPropertyList(
      "<!-- header --> <plist><string>value</string></plist>",
    ).value,
  ).toBe("value");
});
