import { expect, it } from "vitest";
import { parseXmlPropertyList } from "./propertyListKeys.js";

// Expected bytes were independently read from plutil's binary conversion.
it.each([
  ["&#65;QID", "eb9408"],
  ["&amp;AQID", "6a6a40"],
  ["AQ&#10;ID", "010d74"],
  ["&#xE9;AQID", "c44f40"],
  ["====", "00"],
  ["=AQI", "000408"],
  ["AQI=Z", "0102"],
  ["AQ=!==", "0100"],
])(
  "retains CFPropertyList data bytes from source spelling %j",
  (literal, hex) => {
    const parsed = parseXmlPropertyList(
      `<plist><data>${literal}</data></plist>`,
    );
    expect(parsed.value).toEqual(Uint8Array.from(Buffer.from(hex, "hex")));
  },
);

it.each(["é", "😀", "\u00a0", "\u0085", "\u2028", "\u2029"])(
  "rejects non-ASCII data before source normalization can hide %j",
  (character) => {
    expect(() =>
      parseXmlPropertyList(`<plist><data>AQ${character}ID</data></plist>`),
    ).toThrow(
      expect.objectContaining({
        _tag: "XmlPlistDataError",
        reason: "non-ascii",
        characterOffset: 2,
      }),
    );
  },
);

it.each([
  "A<!-- omitted -->QID",
  "<![CDATA[AQID]]>",
  "A<?rea ignored?>QID",
  "<string>AQID</string>",
])(
  "rejects data markup instead of silently decoding a different source: %j",
  (literal) => {
    expect(() =>
      parseXmlPropertyList(`<plist><data>${literal}</data></plist>`),
    ).toThrow(expect.objectContaining({ reason: "markup" }));
  },
);

it.each(["", ' note=">"', " note='>/'"])(
  "distinguishes explicit empty data from a self-closing element with attributes %j",
  (attributes) => {
    expect(
      parseXmlPropertyList(`<plist><data${attributes}></data></plist>`).value,
    ).toEqual(new Uint8Array());
    expect(() =>
      parseXmlPropertyList(`<plist><data${attributes}/></plist>`),
    ).toThrow(expect.objectContaining({ reason: "empty-element" }));
  },
);

it.each(["\n", "\r\n", "\r", "\u0085", "\u2028", "\u2029"])(
  "binds raw data after astral text, entities and line ending %j to the right node",
  (ending) => {
    const parsed = parseXmlPropertyList(
      `<plist><array><string note=">">π😀&#10;${ending}before</string>${ending}` +
        "<data>&#65;QID</data><data>AQID</data></array></plist>",
    );
    expect(parsed.value).toEqual([
      expect.any(String),
      Uint8Array.from([235, 148, 8]),
      Uint8Array.from([1, 2, 3]),
    ]);
  },
);
