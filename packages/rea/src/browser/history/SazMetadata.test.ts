import { expect, it } from "vitest";
import { CaptureFormatError } from "./CaptureFormatError.js";
import { decodeSazMetadata } from "./SazMetadata.js";

it.each([
  ["UTF-8", Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Session/>')],
  [
    "BOM-marked UTF-16LE",
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-16"?><Session/>',
        "utf16le",
      ),
    ]),
  ],
] as const)("accepts matching %s XML declarations", (_label, bytes) => {
  expect(() => decodeSazMetadata(bytes)).not.toThrow();
});

it.each([
  [
    "UTF-16 declaration on UTF-8 bytes",
    Buffer.from('<?xml version="1.0" encoding="UTF-16"?><Session/>'),
    "format",
  ],
  [
    "UTF-8 declaration on UTF-16 bytes",
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?><Session/>',
        "utf16le",
      ),
    ]),
    "format",
  ],
  [
    "unsupported declared encoding",
    Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><Session/>'),
    "unsupported",
  ],
] as const)("rejects %s", (_label, bytes, reason) => {
  expect(() => decodeSazMetadata(bytes)).toThrow(
    expect.objectContaining({ reason }),
  );
});

it("retains U+FFFD in well-formed metadata as an ordinary XML character", () => {
  const decoded = decodeSazMetadata(
    Buffer.from('<Session><SessionFlag N="ui-comments" V="caf�"/>�</Session>'),
  );
  expect(decoded).toMatchObject({
    name: "#document",
    children: [
      {
        name: "Session",
        children: [
          {
            name: "SessionFlag",
            attributes: [
              { name: "N", value: "ui-comments" },
              { name: "V", value: "caf�" },
            ],
          },
          { name: "#text", value: "�" },
        ],
      },
    ],
  });
});

it.each([
  "<Session>a & b</Session>",
  "<Session>a\u0000b</Session>",
  "<Session>&#xD800;</Session>",
  "<Session a=1>�</Session>",
  '<Session a="x"b="�"/>',
  "<Session><Broken>�</Session>",
])("still rejects malformed metadata that also contains U+FFFD: %j", (xml) => {
  expect(() => decodeSazMetadata(Buffer.from(xml))).toThrow(
    "SAZ metadata is not well-formed XML.",
  );
});

it("preserves valid comments, CDATA, declarations, and predefined entities", () => {
  const xml =
    '<?xml version="1.0"?><Session><!-- note & literal --><Value>A &amp; B</Value><C><![CDATA[C & D]]></C></Session>';
  const decoded = decodeSazMetadata(Buffer.from(xml));
  expect(decoded).toMatchObject({
    children: [
      { name: "xml" },
      {
        name: "Session",
        children: [
          { name: "#comment", value: " note & literal " },
          { name: "Value", children: [{ name: "#text", value: "A & B" }] },
          { name: "C", children: [{ name: "#cdata-section", value: "C & D" }] },
        ],
      },
    ],
  });
});

it("rejects DTDs without resolving entities", () => {
  expect(() =>
    decodeSazMetadata(
      Buffer.from('<!DOCTYPE Session [<!ENTITY value "external">]><Session/>'),
    ),
  ).toThrow(
    expect.objectContaining({
      reason: "unsupported",
    } satisfies Partial<CaptureFormatError>),
  );
});

it("refuses duplicate expanded attribute names rather than dropping source values", () => {
  expect(() =>
    decodeSazMetadata(
      Buffer.from(
        '<Session xmlns:p="urn:a" xmlns:q="urn:a" p:x="first" q:x="last"/>',
      ),
    ),
  ).toThrow("SAZ metadata is not well-formed XML.");
});
