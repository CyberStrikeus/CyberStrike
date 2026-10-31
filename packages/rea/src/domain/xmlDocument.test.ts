import { expect, it } from "vitest";
import { parseXmlDocument } from "./xmlDocument.js";

it.each([
  '<root attr="�">😀 � &amp; &#xFFFD;</root>',
  "<root><!-- � --><![CDATA[�]]></root>",
  '<?xml version="1.0"?><root>\r\n  �\rtext</root>',
  "<!DOCTYPE root><root>�</root>",
  '<!DOCTYPE root [<!ENTITY unused "�">]><root>�</root>',
])("preserves legal Unicode and source-located DOM nodes: %j", (source) => {
  const parsed = parseXmlDocument(source, {
    doctype: "allow",
    lineEndings: "preserve",
  });
  if (!parsed.ok) throw parsed.error;
  expect(parsed.value.documentElement?.tagName).toBe("root");
  expect(parsed.value.documentElement?.lineNumber).toBeDefined();
  expect(parsed.value.documentElement?.textContent).toContain("�");
});

it.each([
  "<root attr=unquoted>�</root>",
  '<root a="x"b="�"/>',
  '<root attr="a" attr="�"/>',
  "<root><broken>�</root>",
  "<root>� & unknown</root>",
  "<root>� &missing;</root>",
  "<root>�\u0000</root>",
  "<root>�&#xD800;</root>",
  "<root>�\uFFFF</root>",
  "<root>�]]></root>",
  "<root><!-- invalid -- comment � --></root>",
  "<root>�</root><second/>",
  "<!DOCTYPE root [BOGUS]><root>�</root>",
  "<!DOCTYPE root [<!ELEMENT broken>]><root>�</root>",
  "<!DOCTYPE root SYSTEM><root>�</root>",
])("rejects malformed XML without warning-message matching: %j", (source) => {
  const parsed = parseXmlDocument(source, {
    doctype: "allow",
    lineEndings: "preserve",
  });
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error("Expected refusal");
  expect(parsed.error.reason).toBe("malformed");
  expect(parsed.error.cause).toBeDefined();
});

it("keeps literal line endings and character-reference values distinct", () => {
  const parsed = parseXmlDocument("<root>\r\n&#13;\r�</root>", {
    doctype: "allow",
    lineEndings: "preserve",
  });
  if (!parsed.ok) throw parsed.error;
  expect(parsed.value.documentElement?.textContent).toBe("\r\n\r\r�");
});

it.each([
  '<root xmlns:p="urn:a" xmlns:q="urn:a" p:x="first" q:x="last"/>',
  '<root xmlns:p="urn:a" xmlns:q="urn:a" q:x="last" p:x="first"/>',
  '<root p:x="unbound"/>',
  '<root xmlns:xml="urn:other"/>',
  '<root xmlns:p="http://www.w3.org/2000/xmlns/"/>',
])("rejects namespace-invalid XML before DOM projection: %j", (source) => {
  expect(
    parseXmlDocument(source, { doctype: "reject", lineEndings: "preserve" }),
  ).toMatchObject({ ok: false, error: { reason: "malformed" } });
});

it.each([
  '<root xmlns:p="urn:a" xmlns:q="urn:b" p:x="first" q:x="last"/>',
  '<root xmlns="urn:a" xmlns:p="urn:a" x="first" p:x="last"/>',
  '<root xmlns:p="urn:a" p:x="first" p:y="last"/>',
])("preserves distinct expanded attribute names: %j", (source) => {
  const parsed = parseXmlDocument(source, {
    doctype: "reject",
    lineEndings: "preserve",
  });
  if (!parsed.ok) throw parsed.error;
  const attributes = parsed.value.documentElement!.attributes;
  const values = Array.from(
    { length: attributes.length },
    (_, index) => attributes.item(index)?.value,
  );
  expect(values).toContain("first");
  expect(values).toContain("last");
});

it("applies the consumer's explicit DTD policy", () => {
  const parsed = parseXmlDocument(
    '<!DOCTYPE root [<!ENTITY value "unused">]><root/>',
    { doctype: "reject", lineEndings: "preserve" },
  );
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error("Expected unsupported DTD");
  expect(parsed.error.reason).toBe("doctype");
});

it("applies XML line-ending normalization only when the consumer selects it", () => {
  const parsed = parseXmlDocument('<root attr="a\r\nb">\r\nx</root>', {
    doctype: "allow",
    lineEndings: "normalize",
  });
  if (!parsed.ok) throw parsed.error;
  expect(parsed.value.documentElement?.getAttribute("attr")).toBe("a b");
  expect(parsed.value.documentElement?.textContent).toBe("\nx");
});

it("preserves Unicode separators under XML 1.0 normalization", () => {
  const parsed = parseXmlDocument(
    '<root attr="a\u0085b\u2028c\u2029d">a\r\u0085b\r\u2028c\r\n&#13;d\u2029</root>',
    { doctype: "allow", lineEndings: "normalize" },
  );
  if (!parsed.ok) throw parsed.error;
  expect(parsed.value.documentElement?.getAttribute("attr")).toBe(
    "a\u0085b\u2028c\u2029d",
  );
  expect(parsed.value.documentElement?.textContent).toBe(
    "a\n\u0085b\n\u2028c\n\rd\u2029",
  );
});
