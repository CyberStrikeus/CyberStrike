import { describe, expect, it } from "vitest";
import { parse } from "plist";

import {
  PlistNestingLimitError,
  plistNestingLimitMessage,
} from "./apple/plistValue.js";
import { parseXmlPropertyList as parseWithNumbers } from "./propertyListKeys.js";

// Numeric source facts have separate source-type and ambiguity controls.
const parseXmlPropertyList = (text: string) => {
  const { numberLiterals: _numbers, ...parsed } = parseWithNumbers(text);
  return parsed;
};

const plist = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">${body}</plist>`;

it.each([
  "<key>__proto__</key>",
  "<key><![CDATA[__proto__]]></key>",
  "<key>&#95;&#x5F;proto__</key>",
  "<key >__proto__</key >",
  "<key\n>__proto__</key>",
  "<key>__proto__<!-- trailing comment --></key>",
  "<key><![CDATA[__proto__]]><!-- trailing comment --></key>",
])("preserves an own dictionary member keyed %s", (key) => {
  const parsed = parseXmlPropertyList(
    plist(
      `<dict><key>CFBundleExecutable</key><string>App</string>${key}<dict><key>polluted</key><true/></dict><key>list</key><array><dict>${key}<string>x</string><key>kept</key><integer>1</integer></dict></array></dict>`,
    ),
  );
  expect(parsed).toEqual({
    value: {
      CFBundleExecutable: "App",
      ["__proto__"]: { polluted: true },
      list: [{ ["__proto__"]: "x", kept: 1 }],
    },
  });
  expect(Object.getPrototypeOf(parsed.value)).toBe(Object.prototype);
});

it("keeps __proto__ text in strings, comments, and similar keys", () => {
  const text = plist(
    "<dict><!-- <key>__proto__</key> --><key> __proto__ </key><string><![CDATA[<key>__proto__</key>]]></string><key>__rea_prototype_key__</key><string>__proto__</string></dict>",
  );
  expect(parseXmlPropertyList(text)).toEqual({
    value: {
      " __proto__ ": "<key>__proto__</key>",
      __rea_prototype_key__: "__proto__",
    },
  });
});

it("keeps a segmented entity-encoded key that decodes to the placeholder", () => {
  const text = plist(
    "<dict><key>&#95;&#95;rea<![CDATA[_prototype_key__]]></key><string>kept</string><key>__proto__</key><string>x</string></dict>",
  );
  expect(parseXmlPropertyList(text)).toEqual({
    value: { __rea_prototype_key__: "kept", ["__proto__"]: "x" },
  });
});

it("keeps entity-like text beyond Unicode in comments and CDATA", () => {
  const text = plist(
    "<!-- &#99999999999; --><dict><key>raw</key><string><![CDATA[&#x110000;]]></string><key>__proto__</key><string>x</string></dict>",
  );
  expect(parseXmlPropertyList(text)).toEqual({
    value: { raw: "&#x110000;", ["__proto__"]: "x" },
  });
});

it("preserves last-value-wins for prototype keys split across character-data nodes", () => {
  const text = plist(
    "<dict><key>__pro<![CDATA[to__]]></key><string>kept</string><key>__proto__</key><string>omitted</string></dict>",
  );
  expect(parseXmlPropertyList(text)).toEqual({
    value: { ["__proto__"]: "omitted" },
  });
});

it("preserves literal key text, XML characters and encoded line endings across segments", () => {
  const text = plist(
    '<dict><key note="&gt;">pre<![CDATA[&amp;</key>]]><!-- ignored -->&#13;&#x85;&#x2028;]]&gt;post</key><string>a&#13;b</string></dict>',
  );
  expect(parseXmlPropertyList(text)).toEqual({
    value: { "pre&amp;</key>\r\u0085\u2028]]>post": "a\rb" },
  });
});

it("does not infer key identity from nested elements", () => {
  expect(
    parseXmlPropertyList(
      plist(
        "<dict><key>pre<string>nested</string></key><string>kept</string><key>__proto__<string>nested</string></key><string>omitted</string></dict>",
      ),
    ),
  ).toEqual({ value: { pre: "kept", ["__proto__"]: "omitted" } });
});

it.each([
  ["ab", "a<![CDATA[b]]>", "ab"],
  ["a<![CDATA[b]]>", "ab", "a<![CDATA[b]]>"],
  ["ab", "a<!-- comment -->b", "ab"],
])("retains last-value-wins for mixed spellings %j", (...keys) => {
  const entries = keys
    .map(
      (key, index) =>
        `<key>${key}</key><integer>${String(index + 1)}</integer>`,
    )
    .join("");
  expect(parseXmlPropertyList(plist(`<dict>${entries}</dict>`))).toEqual({
    value: { ab: 3 },
  });
});

it("keeps empty keys and alias-looking source keys distinct", () => {
  const entries =
    "<key/><integer>1</integer><key><!-- ignored --></key><integer>2</integer>" +
    "<key></key><integer>3</integer><key>__rea_plist_key_0__</key><string>literal</string>" +
    "<key>ma<?ignored value?><![CDATA[in]]></key><integer>42</integer>";
  expect(parseXmlPropertyList(plist(`<dict>${entries}</dict>`))).toEqual({
    value: { "": 3, __rea_plist_key_0__: "literal", main: 42 },
  });
});

it.each([
  "<key>ma<![CDATA[in]]></key>",
  "<array><key>ma<![CDATA[in]]></key><string>__rea_plist_key_0__</string></array>",
])("does not alias key elements used as scalar values in %s", (body) => {
  const text = plist(body);
  expect(parseXmlPropertyList(text)).toEqual({
    value: parse(text),
  });
});

it("preserves OpenStep dictionary and array autodetection", () => {
  expect(
    parseXmlPropertyList(
      "  { CFBundleExecutable = App; values = (one, two); __rea_prototype_key__ = kept; }",
    ),
  ).toEqual({
    value: {
      CFBundleExecutable: "App",
      values: ["one", "two"],
      __rea_prototype_key__: "kept",
    },
  });
  expect(parseXmlPropertyList("(one, two)")).toEqual({
    value: ["one", "two"],
  });
});

it("preserves OpenStep __proto__ keys and duplicate assignment semantics", () => {
  // Unquoted, quoted, escape-spelled, and object-valued keys all decode to
  // __proto__; values, other keys, and `\137` (decoded as "137") do not.
  const result = parseXmlPropertyList(
    '{ __proto__ = a; "__proto__" = b; "\\_\\_proto__" = c; ' +
      'nested = { "__proto__" = { polluted = yes; }; }; ' +
      'kept = __proto__; list = (__proto__); "\\137_proto__" = d; }',
  );
  expect(result).toEqual({
    value: {
      ["__proto__"]: "c",
      nested: { ["__proto__"]: { polluted: "yes" } },
      kept: "__proto__",
      list: ["__proto__"],
      "137_proto__": "d",
    },
  });
  const nested = (result.value as { nested: object }).nested;
  expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
});

it("preserves OpenStep compound keys that coerce to __proto__", () => {
  // `obj[key]` coerces an array key to its comma-joined string.
  expect(
    parseXmlPropertyList(
      '{ (__proto__) = a; (("__proto__")) = b; ("__pro", "to__") = c; ' +
        "list = (__proto__); }",
    ),
  ).toEqual({
    value: { ["__proto__"]: "b", "__pro,to__": "c", list: ["__proto__"] },
  });
});

/** The single-member chain of a nested dictionary, down to its deepest value. */
const deepestValue = (value: unknown): unknown => {
  let cursor = value;
  while (
    cursor !== null &&
    typeof cursor === "object" &&
    !Array.isArray(cursor) &&
    "k" in cursor
  ) {
    cursor = (cursor as Record<string, unknown>).k;
  }
  return cursor;
};

/** The single-member chain of a nested array, down to its deepest value. */
const deepestEntry = (value: unknown): unknown => {
  let cursor = value;
  while (Array.isArray(cursor) && cursor.length === 1) cursor = cursor[0];
  return cursor;
};

const nestedDictionaries = (depth: number) =>
  plist(
    "<dict><key>k</key>".repeat(depth) +
      "<string>x</string>" +
      "</dict>".repeat(depth),
  );

const nestedArrays = (depth: number) =>
  plist(
    "<array>".repeat(depth) + "<string>x</string>" + "</array>".repeat(depth),
  );

it("rejects XML nesting beyond the projection limit with the limit diagnostic", () => {
  // Source depth must report the shared limit before recursive value decoding.
  const limit = new PlistNestingLimitError(128);
  expect(() => parseXmlPropertyList(nestedDictionaries(129))).toThrow(limit);
  expect(() => parseXmlPropertyList(nestedArrays(129))).toThrow(limit);
  expect(() => parseXmlPropertyList(nestedDictionaries(3000))).toThrow(limit);
  expect(() => parseXmlPropertyList(nestedArrays(4000))).toThrow(limit);
  try {
    parseXmlPropertyList(nestedDictionaries(129));
    throw new Error("Expected default nesting refusal");
  } catch (cause: unknown) {
    expect(cause).toBeInstanceOf(RangeError);
    expect(cause).toMatchObject({
      _tag: "PlistNestingLimitError",
      maximumDepth: 128,
      message: plistNestingLimitMessage(),
    });
  }
});

it("decodes XML property lists exactly at the projection nesting limit", () => {
  expect(
    deepestValue(parseXmlPropertyList(nestedDictionaries(128)).value),
  ).toBe("x");
  expect(deepestEntry(parseXmlPropertyList(nestedArrays(128)).value)).toBe("x");
  expect(
    parseXmlPropertyList(
      plist("<array>".repeat(128) + "<array/>" + "</array>".repeat(128)),
    ).value,
  ).toBeDefined();
});

it("does not count markup inside comments, CDATA, or the doctype as nesting", () => {
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd" [<!ENTITY deep "<dict/>">]>
<plist version="1.0"><dict>
  <key>a</key><string><![CDATA[<dict><array><dict>]]></string>
  <!-- <dict><key>k</key> -->
  <key>b</key><array><!-- <array> --><string>x</string></array>
</dict></plist>`;
  expect(parseXmlPropertyList(text)).toEqual({
    value: { a: "<dict><array><dict>", b: ["x"] },
  });
});

it.each(['"', "'"])(
  "counts containers with quoted XML delimiters using %s attributes",
  (quote) => {
    const opening = `<dict note=${quote}/>${quote}><key>k</key>`;
    const text = plist(
      opening.repeat(3000) + "<string>x</string>" + "</dict>".repeat(3000),
    );
    expect(() => parseXmlPropertyList(text)).toThrow(
      new PlistNestingLimitError(128),
    );
    expect(
      parseXmlPropertyList(
        plist(
          "<array>" + `<dict note=${quote}>${quote}/>`.repeat(130) + "</array>",
        ),
      ).value,
    ).toEqual(Array.from({ length: 130 }, () => ({})));
  },
);

it("ignores complete DOCTYPE internal subsets when checking value depth", () => {
  const text = `<!DOCTYPE plist [
<!ENTITY first "unused">
<!-- <dict><array> -->
<!ENTITY second "${"<dict>".repeat(130)}">
]><plist><string>x</string></plist>`;
  expect(parseXmlPropertyList(text)).toEqual({
    value: "x",
  });
});

it("bounds nested plist wrappers before recursive decoding", () => {
  const text =
    "<plist>".repeat(3000) + "<string>x</string>" + "</plist>".repeat(3000);
  expect(() => parseXmlPropertyList(text)).toThrow(
    new PlistNestingLimitError(128),
  );
  expect(
    parseXmlPropertyList(plist("<plist><string>x</string></plist>")).value,
  ).toEqual(["x"]);
});

it.each(["\n", "\r\n", "\r"])(
  "preserves unrelated source values around %j line endings",
  (newline) => {
    const text = plist(
      `<dict>${newline}<key>kept&#13;key</key><string>a&#13;b&#x85;c&#x2028;d</string>${newline}<key${newline}>__proto__<!--tail--></key><string>omitted</string></dict>`,
    );
    expect(parseXmlPropertyList(text)).toEqual({
      value: { "kept\rkey": "a\rb\u0085c\u2028d", ["__proto__"]: "omitted" },
    });
  },
);

it("preserves sparse prototype keys across newline-dense source", () => {
  const lines = "\n".repeat(64 * 1024);
  const text = plist(
    `<dict>${lines}<key >__proto__</key><string>omitted</string><key>nested</key><dict>${lines}<key>__proto__<!--tail--></key><string>omitted</string><key>kept</key><true/></dict></dict>`,
  );
  expect(parseXmlPropertyList(text)).toEqual({
    value: {
      ["__proto__"]: "omitted",
      nested: { ["__proto__"]: "omitted", kept: true },
    },
  });
});

describe("OpenStep plist owned depth", () => {
  const arrays = (depth: number, leaf = "x") =>
    "(".repeat(depth) + leaf + ")".repeat(depth);

  it.each([129, 3000])(
    "rejects %s nested OpenStep values with the shared depth limit",
    (depth) => {
      expect(() => parseXmlPropertyList(arrays(depth))).toThrow(
        plistNestingLimitMessage(),
      );
    },
  );

  it.each(["{}", "()"])(
    "preserves the first %s root despite deeply nested trailing text",
    (root) => {
      expect(parseXmlPropertyList(root + arrays(3000))).toEqual({
        value: root === "{}" ? {} : [],
      });
    },
  );

  it("accepts the deepest supported OpenStep value and empty container", () => {
    expect(() => parseXmlPropertyList(arrays(128))).not.toThrow();
    expect(() => parseXmlPropertyList(arrays(129, ""))).not.toThrow();
  });

  it.each([
    "(x, y,)",
    "{ key = x next = (y,); }",
    "{ (compound, key) = x; { nested = key; } = y; }",
    "{ key = (); next = {}; }",
  ])("preserves pinned separator and compound-key semantics for %s", (text) => {
    expect(parseXmlPropertyList(text)).toEqual({
      value: parse(text),
    });
  });

  it("ignores brackets in quoted strings, escaped quotes, comments, and data", () => {
    expect(
      parseXmlPropertyList(
        '{ quote = "\\\"( )"; /* ((( */ data = <2829>; // (((\n values = (x); }',
      ),
    ).toEqual({
      value: { quote: '"( )', data: new Uint8Array([40, 41]), values: ["x"] },
    });
  });
});

it.each(["\u0085", "\u2028", "\u2029"])(
  "preserves key identity around inter-element separator %j",
  (separator) => {
    const parsed = parseXmlPropertyList(
      plist(
        `<dict>${separator}<key>kept${separator}key</key><string>a${separator}b</string>${separator}<key>__proto__</key><string>omitted</string></dict>`,
      ),
    );
    expect(parsed).toEqual({
      value: {
        [`kept${separator}key`]: `a${separator}b`,
        ["__proto__"]: "omitted",
      },
    });
  },
);
