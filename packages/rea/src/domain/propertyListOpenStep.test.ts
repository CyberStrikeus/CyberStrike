import { expect, it } from "vitest";
import { parseOpenStep } from "plist";

import { plistNestingLimitMessage } from "./apple/plistValue.js";
import {
  decodeOpenStepPropertyList,
  OpenStepPropertyListError,
  startsOpenStepPropertyList,
} from "./propertyListOpenStep.js";

it.each([
  "{ numeric = (42, -2.5, 0x10, YES); path = /a/b:c$; }",
  String.raw`{ escapes = "\n\r\t\0\"\\\q\137\U0041"; }`,
  "{ bytes = (<ffzz0>, <0>, <a b c d>, <>); }",
  '/* header */ ("//text", "/*text*/", /* before */ value, // after\n)',
  "{ first = x second = y; third = (a, b,); }",
  "{ (one, two) = array; { nested = key; } = object; <01ff> = data; }",
  "{} /* unterminated",
  "() ((((((((((",
])("preserves pinned lexical and container values for %s", (text) => {
  expect(decodeOpenStepPropertyList(text)).toEqual(parseOpenStep(text));
});

const syntaxFailure = (read: () => unknown): Error => {
  try {
    read();
  } catch (cause) {
    if (cause instanceof Error) return cause;
    throw cause;
  }
  throw new Error("Expected syntax failure");
};

const containerRefusal = (
  code: OpenStepPropertyListError["code"],
  position: number,
) => ({ code, position });

const containerRefusals = [
  ["(}", containerRefusal("unexpected_character", 1)],
  ["{)", containerRefusal("unexpected_character", 1)],
  ["(@", containerRefusal("unexpected_character", 1)],
  ["{key @", containerRefusal("expected_equals", 5)],
  ["(x @", containerRefusal("expected_separator", 3)],
  [
    "(x ",
    containerRefusal("unterminated_array", 3),
    containerRefusal("expected_separator", 3),
  ],
  ["{key ", containerRefusal("expected_equals", 5)],
  ["{key = x,", containerRefusal("unexpected_character", 8)],
  ["{ /* unterminated", containerRefusal("unterminated_block_comment", 2)],
  ["(x, /* unterminated", containerRefusal("unterminated_block_comment", 4)],
  ["{ { toString = text; } @", containerRefusal("expected_equals", 23)],
] as const;

it.each(containerRefusals)(
  "reports %s before and after a deep suffix",
  (text, diagnosis, deep = diagnosis) => {
    expect(syntaxFailure(() => decodeOpenStepPropertyList(text))).toMatchObject(
      { _tag: "OpenStepPropertyListError", ...diagnosis },
    );
    expect(
      syntaxFailure(() => decodeOpenStepPropertyList(text + "(".repeat(130))),
    ).toMatchObject({ _tag: "OpenStepPropertyListError", ...deep });
  },
);

it.each([
  '{ key = "unterminated',
  '{ key = "escape\\',
  "{ key = <01",
  "{ { toString = text; } = value; }",
])(
  "keeps the pinned scalar decoder's diagnosis for %s before a deep suffix",
  (prefix) => {
    for (const text of [prefix, prefix + "(".repeat(130)]) {
      const pinned = syntaxFailure(() => parseOpenStep(text));
      const owned = syntaxFailure(() => decodeOpenStepPropertyList(text));
      expect(owned).not.toBeInstanceOf(OpenStepPropertyListError);
      expect(owned.constructor).toBe(pinned.constructor);
      expect(owned.message).toBe(pinned.message);
    }
  },
);

it("retains every compound-coerced dictionary key with last assignment winning", () => {
  const value = decodeOpenStepPropertyList(
    '{ (__proto__) = first; (("__proto__")) = last; nested = { __proto__ = { x = y; }; }; constructor = text; }',
  ) as Record<string, unknown>;
  expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toBe(
    "last",
  );
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  const nested = value["nested"] as object;
  expect(Object.getOwnPropertyDescriptor(nested, "__proto__")?.value).toEqual({
    x: "y",
  });
  expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
  expect(JSON.stringify(value)).toBe(
    '{"__proto__":"last","nested":{"__proto__":{"x":"y"}},"constructor":"text"}',
  );
});

it("bounds compound keys and later siblings at their owning parse", () => {
  const deep = "(".repeat(30_000) + "x" + ")".repeat(30_000);
  for (const source of [`((x),${deep})`, `{(key)=${deep};}`, `{${deep}=x;}`])
    expect(() => decodeOpenStepPropertyList(source)).toThrow(
      plistNestingLimitMessage(),
    );
  // A scalar key identifies its parent's member rather than adding value depth.
  expect(decodeOpenStepPropertyList("{ key = (); }", 1)).toEqual({ key: [] });
  expect(() => decodeOpenStepPropertyList("{ (key) = (); }", 1)).toThrow(
    plistNestingLimitMessage(1),
  );
});

it.each([
  ["(x,", "unexpected_end", 3],
  ["{ key =", "unexpected_end", 7],
] as const)("reports incomplete %s as %s at %s", (text, code, position) => {
  expect(syntaxFailure(() => decodeOpenStepPropertyList(text))).toMatchObject({
    _tag: "OpenStepPropertyListError",
    code,
    position,
  });
});

it.each(["\n", "\r\n", "\r", "\u2028", "\u2029"])(
  "ends OpenStep line comments at %j without dropping following values",
  (newline) => {
    const text =
      "// leading" +
      newline +
      "{ kept = first; // inline" +
      newline +
      "hidden = second;\n items = (one, // array" +
      newline +
      "two,); }";
    expect(
      decodeOpenStepPropertyList(
        "{ kept = first; // inline" + newline + "hidden = second;\n }",
      ),
    ).toEqual({ kept: "first", hidden: "second" });
    expect(startsOpenStepPropertyList(text)).toBe(true);
    expect(decodeOpenStepPropertyList(text)).toEqual({
      kept: "first",
      hidden: "second",
      items: ["one", "two"],
    });
  },
);

it("does not treat nonterminating whitespace or quoted comment text as line ends", () => {
  expect(
    decodeOpenStepPropertyList(
      '{ kept = first; // comment\vhidden = second;\n text = "// still literal\rtext"; }',
    ),
  ).toEqual({ kept: "first", text: "// still literal\rtext" });
  expect(startsOpenStepPropertyList("// comment without a line end")).toBe(
    false,
  );
  expect(() =>
    decodeOpenStepPropertyList("// comment without a line end"),
  ).toThrow(OpenStepPropertyListError);
  expect(
    syntaxFailure(() =>
      decodeOpenStepPropertyList("// comment without a line end"),
    ),
  ).toMatchObject({ code: "unexpected_end" });
});
