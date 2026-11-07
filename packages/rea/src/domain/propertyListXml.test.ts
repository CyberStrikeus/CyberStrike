import { expect, it } from "vitest";

import { projectPlistValue } from "./apple/plistValue.js";
import { UnknownPlistScalar } from "./apple/unknownPlistScalar.js";
import { parseXmlPropertyList } from "./propertyListKeys.js";

it.each([
  [
    "plist",
    "<plist><?dict ignored?><string>demo</string><?rea ignored?></plist>",
    "demo",
  ],
  [
    "array",
    "<plist><array><?rea ignored?><string>before</string><?integer 9007199254740993?><integer>42</integer><?rea ignored?></array></plist>",
    ["before", 42],
  ],
  [
    "dict",
    "<plist><dict><?key ignored?><key>name</key><?string ignored?><string>demo</string><?rea ignored?><key>count</key><integer>42</integer><?rea ignored?></dict></plist>",
    { name: "demo", count: 42 },
  ],
] as const)(
  "ignores processing instructions between %s members",
  (_kind, xml, value) => {
    const parsed = parseXmlPropertyList(xml);
    expect(parsed.value).toEqual(value);
    expect(parsed.numberLiterals.incomplete).toBe(false);
    expect(parsed.numberLiterals.unsafeIntegerLiterals).toBe(0);
  },
);

it("keeps document-level processing instructions outside plist members", () => {
  const parsed = parseXmlPropertyList(
    '<?xml version="1.0"?><?rea before?><plist><string>demo</string></plist><?rea after?>',
  );
  expect(parsed.value).toBe("demo");
  expect(parsed.numberLiterals.incomplete).toBe(false);
});

it("rejects a dictionary key without a value and preserves an explicit empty string", () => {
  expect(() =>
    parseXmlPropertyList("<plist><dict><key>missing</key></dict></plist>"),
  ).toThrow("Missing value for key while parsing <dict/>");
  expect(
    parseXmlPropertyList(
      "<plist><dict><key>empty</key><string/></dict></plist>",
    ).value,
  ).toEqual({ empty: "" });
});

it.each([
  ["CDATA", "<![CDATA[before<?rea content?>after]]>"],
  ["escaped text", "before&lt;?rea content?&gt;after"],
])(
  "preserves literal processing-instruction text from %s",
  (_kind, content) => {
    expect(
      parseXmlPropertyList(`<plist><string>${content}</string></plist>`).value,
    ).toBe("before<?rea content?>after");
  },
);

it("keeps processing instructions inside numeric content subject to scalar rules", () => {
  for (const markup of ["<?rea ignored?>", "<!-- ignored -->"]) {
    const parsed = parseXmlPropertyList(
      `<plist><integer>4${markup}2</integer></plist>`,
    );
    expect(parsed.value).toEqual(
      new UnknownPlistScalar("integer", `4${markup}2`, "unsupported-markup"),
    );
    expect(parsed.numberLiterals.incomplete).toBe(false);
  }
});

it("still rejects an unterminated processing instruction", () => {
  expect(() =>
    parseXmlPropertyList("<plist><?rea ignored<string>demo</string></plist>"),
  ).toThrow();
});

it("still rejects an unsupported element beside a processing instruction", () => {
  expect(() =>
    parseXmlPropertyList("<plist><?rea ignored?><unsupported/></plist>"),
  ).toThrow("Invalid PLIST tag unsupported");
});

it.each([
  ["0x2A", 42],
  ["0X2a", 42],
  ["+0x2A", 42],
  ["-0x2A", -42],
  ["\n0x2A", 42],
  ["42", 42],
])(
  "decodes exact integer text %s at the shared boundary",
  (literal, expected) => {
    const parsed = parseXmlPropertyList(
      `<plist><integer>${literal}</integer></plist>`,
    );
    expect(parsed.value).toBe(expected);
    expect(parsed.numberLiterals.incomplete).toBe(false);
    expect(parsed.numberLiterals.unsafeIntegerLiterals).toBe(0);
  },
);

it.each([
  ["AQID", [1, 2, 3]],
  [" A Q I D\n", [1, 2, 3]],
  ["AQI", []],
  ["AQ!ID", [1, 2, 3]],
  ["AQ==", [1]],
  ["AQI=", [1, 2]],
  ["AQ= =\n", [1]],
  ["", []],
])("decodes data text %j as CFPropertyList does", (text, expected) => {
  const parsed = parseXmlPropertyList(`<plist><data>${text}</data></plist>`);
  expect(parsed.value).toEqual(Uint8Array.from(expected));
});

it("collects source integers and CDATA reals before rounding and duplicate assignment", () => {
  const parsed = parseXmlPropertyList(
    "<plist><dict><key>a</key><integer>0x20000000000001</integer><key>a</key><integer>9007199254740992</integer><key>b</key><real>9007199254<![CDATA[740992]]></real></dict></plist>",
  );
  expect(parsed.value).toEqual({ a: 9007199254740992, b: 9007199254740992 });
  expect(parsed.numberLiterals.integers.get(9007199254740992)).toEqual(
    new Set(["9007199254740993", "9007199254740992"]),
  );
  expect(parsed.numberLiterals.reals).toEqual(new Set([9007199254740992]));
  expect(parsed.numberLiterals.unsafeIntegerLiterals).toBe(2);
  expect(parsed.numberLiterals.incomplete).toBe(false);
});

it("does not invent numeric facts from ignored scalar markup", () => {
  const parsed = parseXmlPropertyList(
    "<plist><array><string>text<integer>9007199254740993</integer></string><dict><key><real>9007199254740992</real></key><integer>7</integer></dict></array></plist>",
  );
  expect(parsed.value).toEqual(["text", { null: 7 }]);
  expect(parsed.numberLiterals.integers.size).toBe(0);
  expect(parsed.numberLiterals.reals.size).toBe(0);
  expect(parsed.numberLiterals.incomplete).toBe(false);
});

it("keeps unsupported numeric markup out of numeric source facts", () => {
  const parsed = parseXmlPropertyList(
    "<plist><array><integer>0x2A<!-- unsupported --></integer><real>1<string>ignored</string>.25</real></array></plist>",
  );
  expect(parsed.value).toEqual([
    new UnknownPlistScalar(
      "integer",
      "0x2A<!-- unsupported -->",
      "unsupported-markup",
    ),
    new UnknownPlistScalar(
      "real",
      "1<string>ignored</string>.25",
      "unsupported-markup",
    ),
  ]);
  expect(parsed.numberLiterals.incomplete).toBe(false);
  expect(parsed.numberLiterals.reals.size).toBe(0);
});

it("decodes a signed integer zero as zero and a negative-zero real with its sign", () => {
  const parsed = parseXmlPropertyList(
    "<plist><array><integer>-0</integer><integer>-0<!-- partial --></integer><real>-0.0</real><real>0.0</real></array></plist>",
  );
  expect(Array.isArray(parsed.value)).toBe(true);
  if (!Array.isArray(parsed.value)) throw new Error("Expected array");
  expect(parsed.value.map((item) => Object.is(item, -0))).toEqual([
    false,
    false,
    true,
    false,
  ]);
  expect(parsed.value).toEqual([
    0,
    new UnknownPlistScalar(
      "integer",
      "-0<!-- partial -->",
      "unsupported-markup",
    ),
    -0,
    0,
  ]);
});

it("validates values under every dictionary key", () => {
  expect(() =>
    parseXmlPropertyList(
      "<plist><dict><key>__proto__</key><unsupported/></dict></plist>",
    ),
  ).toThrow("Invalid PLIST tag");
});

it("retains native decoder null and nested-envelope behavior", () => {
  expect(
    parseXmlPropertyList(
      "<plist><array><null/><dict><key>value</key><null/></dict><plist><null/></plist></array></plist>",
    ).value,
  ).toEqual([{ value: null }, [null]]);
});

it.each([
  ["nan", NaN],
  ["NaN", NaN],
  ["+infinity", Infinity],
  ["infinity", Infinity],
  ["INFINITY", Infinity],
  ["inf", Infinity],
  ["+inf", Infinity],
  ["-infinity", -Infinity],
  ["-Infinity", -Infinity],
  ["-inf", -Infinity],
  ["<![CDATA[-inf]]>", -Infinity],
] as const)(
  "retains the canonical non-finite real value for %s",
  (literal, expected) => {
    const parsed = parseXmlPropertyList(
      `<plist><real>${literal}</real></plist>`,
    );
    expect(parsed.value).toBe(expected);
    expect(parsed.numberLiterals.reals).toEqual(new Set([expected]));
    expect(parsed.numberLiterals.incomplete).toBe(false);
  },
);

it.each([
  ["integer", "unreadable", "invalid-literal"],
  ["integer", `${"9".repeat(400)}invalid`, "invalid-literal"],
  ["integer", "&#48;x2A", "invalid-literal"],
  ["integer", "42\n", "invalid-literal"],
  ["integer", "", "invalid-literal"],
  ["real", "", "invalid-literal"],
  ["real", "1e999", "unrepresentable"],
  ["real", "-1e999", "unrepresentable"],
  ["real", " nan ", "invalid-literal"],
  ["real", "-nan", "invalid-literal"],
  ["real", "infinite", "invalid-literal"],
  ["real", "Infinitysuffix", "invalid-literal"],
  ["real", "nan<!-- unsupported -->", "unsupported-markup"],
  ["date", "2026-10-17T12:00:00+02:00", "invalid-literal"],
  ["date", "2026-10-17T12:00:00.5Z", "invalid-literal"],
  ["date", "2026-10-17T12:00:00", "invalid-literal"],
  ["date", "2026-13-17T12:00:00Z", "unrepresentable"],
  ["date", "2026-02-31T12:00:00Z", "unrepresentable"],
  ["date", "<![CDATA[2026-10-17T12:00:00Z]]>", "unsupported-markup"],
  ["true", "x", "invalid-literal"],
  ["false", " ", "invalid-literal"],
  ["true", "<!-- empty -->", "unsupported-markup"],
] as const)(
  "keeps unresolved <%s> %j identity explicit",
  (element, literal, reason) => {
    const parsed = parseXmlPropertyList(
      `<plist><${element}>${literal}</${element}></plist>`,
    );
    expect(parsed.value).toEqual(
      new UnknownPlistScalar(element, literal, reason),
    );
    const projected = projectPlistValue(parsed.value);
    expect(projected.value).toEqual({
      $plist_type: "unknown",
      element,
      literal,
      reason,
    });
    expect(projected.unknownScalarCount).toBe(1);
    expect(projected.nonFiniteRealCount).toBe(0);
    expect(parsed.numberLiterals.incomplete).toBe(false);
  },
);

it.each([
  "4<!-- </integer> -->2",
  "4<?rea </integer> ?>2",
  "4<![CDATA[</integer>]]>2",
  '4<integer note=">">2<integer/></integer>3',
])(
  "retains complete source markup %j without treating apparent closing tags as structure",
  (literal) => {
    expect(
      parseXmlPropertyList(`<plist><integer>${literal}</integer></plist>`)
        .value,
    ).toEqual(new UnknownPlistScalar("integer", literal, "unsupported-markup"));
  },
);

it("binds raw literals to their nodes across normalized line endings and UTF-16 columns", () => {
  const parsed = parseXmlPropertyList(
    '<plist><array><string>💡</string>\r\n<integer note=">">42\r\nabc</integer>\u0085<date>2026-10-17T12:00:00&#90;</date>\u2028<false>\r\n</false></array></plist>',
  );
  expect(parsed.value).toEqual([
    "💡",
    new UnknownPlistScalar("integer", "42\r\nabc", "invalid-literal"),
    new UnknownPlistScalar(
      "date",
      "2026-10-17T12:00:00&#90;",
      "invalid-literal",
    ),
    new UnknownPlistScalar("false", "\r\n", "invalid-literal"),
  ]);
});

it("preserves Unicode line separators in plist string values", () => {
  const value = "a\u0085b\u2028c\u2029d";
  expect(
    parseXmlPropertyList(`<plist><string>${value}</string></plist>`).value,
  ).toBe(value);
});

it.each(["\u0085", "\u2028", "\u2029"])(
  "does not normalize unsupported leading whitespace %j into an observed scalar",
  (prefix) => {
    const parsed = parseXmlPropertyList(
      `<plist><array><integer>${prefix}42</integer><real>${prefix}1.5</real></array></plist>`,
    );
    expect(parsed.value).toEqual([
      new UnknownPlistScalar("integer", `${prefix}42`, "invalid-literal"),
      prefix === "\u0085"
        ? 1.5
        : new UnknownPlistScalar("real", `${prefix}1.5`, "invalid-literal"),
    ]);
  },
);

it("expands real references outside CDATA without changing scalar source policy", () => {
  expect(
    parseXmlPropertyList(
      "<plist><array><real>&#49;<![CDATA[.5]]></real><real><![CDATA[&#49;.5]]></real><true/><false></false></array></plist>",
    ).value,
  ).toEqual([
    1.5,
    new UnknownPlistScalar("real", "<![CDATA[&#49;.5]]>", "invalid-literal"),
    true,
    false,
  ]);
});

it.each(["__proto__", "constructor", "ordinary"])(
  "retains %s key elements used as scalar values",
  (value) => {
    expect(
      parseXmlPropertyList(`<plist><key>${value}</key></plist>`).value,
    ).toBe(value);
    expect(
      parseXmlPropertyList(`<plist><array><key>${value}</key></array></plist>`)
        .value,
    ).toEqual([value]);
  },
);
