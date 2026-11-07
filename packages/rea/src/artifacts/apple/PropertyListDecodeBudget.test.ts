import { expect, it } from "vitest";

import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { parsePlistXmlSource } from "../../native/parsers/plist.js";
import { preflightPropertyListDecode } from "./PropertyListDecodeBudget.js";

const xmlPlist = (body: string): Buffer =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n${body}</plist>\n`,
  );

it("refuses an XML plist whose DOM exceeds the native decode budget", () => {
  // Real decode peaks near 110 MiB: about 1,100 bytes per element and text node.
  const parsed = parsePlistXmlSource(
    xmlPlist(`<array>\n${"<true/>\n".repeat(100_000)}</array>\n`),
  );
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error("Expected a decode budget refusal");
  expect(parsed.error).toBeInstanceOf(AnalysisResourceConstraintError);
  expect(parsed.error.message).toContain("native plist decode budget");
});

// Saxes accepts any XML NameStartChar, and the DOM holds every element
// before the plist decoder rejects an unknown tag.
it.each(["é", "_", ":", "雪", "\u{1d4b3}"])(
  "refuses 100,000 elements whose names start with %s before building the DOM",
  (name) => {
    const parsed = parsePlistXmlSource(
      xmlPlist(`<array>${`<${name}/>`.repeat(100_000)}</array>`),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("Expected a decode budget refusal");
    expect(parsed.error).toBeInstanceOf(AnalysisResourceConstraintError);
  },
);

it("refuses text whose entity references exceed the decode budget", () => {
  const parsed = parsePlistXmlSource(
    xmlPlist(`<array><string>${"&amp;".repeat(1_000_000)}</string></array>`),
  );
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error("Expected a decode budget refusal");
  expect(parsed.error).toBeInstanceOf(AnalysisResourceConstraintError);
});

// Opaque sections hold literal ampersands, not references the parser expands.
it.each([
  ["a CDATA string", `<string><![CDATA[${"&".repeat(1_000_000)}]]></string>`],
  ["a comment", `<!--${"&".repeat(1_000_000)}--><true/>`],
])("admits literal ampersands in %s", (_name, value) => {
  const parsed = parsePlistXmlSource(xmlPlist(`<array>${value}</array>`));
  if (!parsed.ok) throw parsed.error;
  expect(parsed.value.value).toEqual([
    value.startsWith("<string>") ? "&".repeat(1_000_000) : true,
  ]);
});

it("charges references only in text and attribute values", () => {
  const mixed =
    '<array><string a="&amp;">&lt;<![CDATA[&&&]]>&gt;</string><?pi &?></array>';
  const estimate = (body: string) =>
    preflightPropertyListDecode(xmlPlist(body), Number.MAX_SAFE_INTEGER)
      .estimatedBytes;
  // Same length and nodes without any "&": only the three references differ.
  expect(estimate(mixed) - estimate(mixed.replaceAll("&", "x"))).toBe(3 * 64);
});

it("admits an ordinary pretty-printed XML plist", () => {
  const entry = (index: number) =>
    `\t<dict>\n${Array.from(
      { length: 5 },
      (_, key) =>
        `\t\t<key>Key${String(key)}</key>\n\t\t<real>${String(index)}.5</real>\n`,
    ).join("")}\t</dict>\n`;
  const parsed = parsePlistXmlSource(
    xmlPlist(
      `<array>\n${Array.from({ length: 2000 }, (_, index) => entry(index)).join("")}</array>\n`,
    ),
  );
  if (!parsed.ok) throw parsed.error;
  expect(parsed.value.value).toHaveLength(2000);
});

it.each([
  ["elements", "<true/>", 1280],
  ["text after elements", "<true/>\n", 1280 + 384],
  ["comments", "<!---->", 384],
  ["CDATA sections", "<string><![CDATA[a]]></string>", 1280 + 384],
  ["non-ASCII elements", "<é/>", 1280],
  ["attributes", '<true a="x>y" b="z"/>', 1280 + 2 * 384],
  ["references", "<string>&amp;&#x41;</string>", 1280 + 384 + 2 * 64],
])(
  "charges %s for the DOM nodes the decoder builds",
  (_name, item, perItem) => {
    const count = 1000;
    const bytes = xmlPlist(`<array>${item.repeat(count)}</array>`);
    const { estimatedBytes } = preflightPropertyListDecode(
      bytes,
      Number.MAX_SAFE_INTEGER,
    );
    expect(estimatedBytes).toBeGreaterThanOrEqual(
      bytes.length * 4 + count * perItem,
    );
  },
);
