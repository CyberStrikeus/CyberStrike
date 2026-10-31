import { describe, expect, it } from "vitest";
import { ok } from "../domain/result.js";

import {
  parseApktoolYml,
  parseDecodedStrings,
  parseManifestPackage,
} from "./ApktoolDecodeOutput.js";

const REAL_YML = [
  "!!brut.androlib.meta.MetaInfo",
  "apkFileName: probe.apk",
  "compressionType: false",
  "doNotCompress:",
  "- resources.arsc",
  "isFrameworkApk: false",
  "packageInfo:",
  "  forcedPackageId: '127'",
  "  renameManifestPackage: null",
  "sdkInfo:",
  "  minSdkVersion: '24'",
  "  targetSdkVersion: '34'",
  "sharedLibrary: false",
  "sparseResources: false",
  "unknownFiles: {}",
  "usesFramework:",
  "  ids:",
  "  - 1",
  "  tag: null",
  "versionInfo:",
  "  versionCode: '7'",
  "  versionName: 1.2.3",
  "",
].join("\n");

describe("parseApktoolYml", () => {
  it("projects version and SDK facts from a real apktool.yml", () => {
    expect(parseApktoolYml(REAL_YML)).toEqual({
      versionName: "1.2.3",
      versionCode: "7",
      minSdkVersion: "24",
      targetSdkVersion: "34",
    });
  });

  it("accepts quoted version values some builds emit", () => {
    expect(
      parseApktoolYml(
        '!!brut.androlib.meta.MetaInfo\nversionInfo:\n  versionName: "2.0.0"\n  versionCode: 45\n',
      ),
    ).toEqual({
      versionName: "2.0.0",
      versionCode: "45",
      minSdkVersion: null,
      targetSdkVersion: null,
    });
  });

  it("reads only the producer's nested fields and preserves scalar spelling", () => {
    expect(
      parseApktoolYml(
        [
          "!!brut.androlib.meta.MetaInfo",
          "versionName: decoy",
          "versionInfo:",
          "  versionName: 01.2.3",
          "  versionCode: 045",
          "  custom:",
          "    versionName: unrelated",
          "sdkInfo:",
          "  minSdkVersion: 24",
          "  targetSdkVersion: '35'",
          "",
        ].join("\n"),
      ),
    ).toEqual({
      versionName: "01.2.3",
      versionCode: "045",
      minSdkVersion: "24",
      targetSdkVersion: "35",
    });
  });

  it("distinguishes YAML nulls from quoted null strings in flow mappings", () => {
    expect(
      parseApktoolYml(
        [
          "!!brut.androlib.meta.MetaInfo",
          'versionInfo: { versionName: "null", versionCode: 0045, nested: { versionName: decoy } }',
          "sdkInfo: { minSdkVersion: null, targetSdkVersion: ~ }",
          "",
        ].join("\n"),
      ),
    ).toEqual({
      versionName: "null",
      versionCode: "0045",
      minSdkVersion: null,
      targetSdkVersion: null,
    });
  });

  it("reports null facts for unrelated YAML", () => {
    expect(parseApktoolYml("version: 2.7.0\n")).toEqual({
      versionName: null,
      versionCode: null,
      minSdkVersion: null,
      targetSdkVersion: null,
    });
  });

  // Source-derived fixtures from Apktool 3.0.3 VersionInfo.write and
  // YamlStringEscapeUtils at 18b5e99cb56ff9451e8aa55b065dcf5bbd616975.
  it.each([
    ["1.0 #beta", "1.0 #beta"],
    [String.raw`1.0\\beta`, String.raw`1.0\beta`],
    [String.raw`1.0 \uD83D\uDE80`, "1.0 🚀"],
    [String.raw`literal \\uD83D\\uDE80`, String.raw`literal \uD83D\uDE80`],
    [String.raw`release \"quoted\"`, 'release "quoted"'],
    ["'release'", "'release'"],
    ["1.0: beta", "1.0: beta"],
    ["[beta]", "[beta]"],
    ["  release  ", "  release  "],
    ["release\u2028beta", "release\u2028beta"],
    ["null", "null"],
    ["", ""],
    ['"1.0 #beta"', "1.0 #beta"],
  ])(
    "reads Apktool 3 version string %j without YAML scalar loss",
    (source, expected) => {
      expect(
        parseApktoolYml(
          `version: 3.0.3\nversionInfo:\n  versionCode: 7\n  versionName: ${source}\nsdkInfo:\n  minSdkVersion: 24\n  targetSdkVersion: 35\n`,
        ),
      ).toEqual({
        versionName: expected,
        versionCode: "7",
        minSdkVersion: "24",
        targetSdkVersion: "35",
      });
    },
  );

  it("keeps Apktool 2 quoted and plain YAML semantics", () => {
    expect(
      parseApktoolYml(
        String.raw`version: 2.7.0
versionInfo:
  versionName: 'literal \n #beta'
  versionCode: 0045
sdkInfo:
  minSdkVersion: null
  targetSdkVersion: 35 # comment
`,
      ),
    ).toEqual({
      versionName: String.raw`literal \n #beta`,
      versionCode: "0045",
      minSdkVersion: null,
      targetSdkVersion: "35",
    });
  });

  it("keeps Apktool 3 field ownership across nested decoys and CRLF", () => {
    expect(
      parseApktoolYml(
        [
          "version: 3.0.3",
          "versionName: root decoy",
          "versionInfo:",
          "  custom:",
          "    versionName: nested decoy",
          "  versionName: 1.0 #beta",
          "other:",
          "  versionName: unrelated decoy",
          "",
        ].join("\r\n"),
      ),
    ).toMatchObject({ versionName: "1.0 #beta" });
  });

  it.each([
    "versionInfo:\n  versionName: one\n  versionName: two\n",
    "versionInfo:\n  versionName: one\nversionInfo:\n  versionName: two\n",
    "version: 2.7.0\nversionInfo:\n  versionName: ambiguous\n",
    String.raw`versionInfo:
  versionName: invalid\uZZZZ
`,
  ])("rejects ambiguous or malformed Apktool 3 fields", (fields) => {
    expect(() => parseApktoolYml(`version: 3.0.3\n${fields}`)).toThrow();
  });
});

describe("parseApktoolYml Apktool 2.9+ metadata dialect", () => {
  // Source-derived from ApkInfo.write, VersionInfo.write and YamlWriter at
  // Apktool v2.9.0 and v2.12.1, whose string escaping matches 3.0.3.
  const yml = (version: string, versionName: string) =>
    [
      `version: ${version}`,
      "apkFileName: app-release.apk",
      "isFrameworkApk: false",
      "usesFramework:",
      "  ids:",
      "  - 1",
      "  tag: null",
      "sdkInfo:",
      "  minSdkVersion: 24",
      "  targetSdkVersion: 34",
      "packageInfo:",
      "  forcedPackageId: 127",
      "  renameManifestPackage: null",
      "versionInfo:",
      "  versionCode: 7",
      `  versionName: ${versionName}`,
      "sharedLibrary: false",
      "sparseResources: false",
      "doNotCompress:",
      "- arsc",
      "",
    ].join("\n");

  it.each([
    ["2.9.0", "1.0 #beta", "1.0 #beta"],
    ["2.9.3", String.raw`release \"quoted\"`, 'release "quoted"'],
    ["2.12.1", "1.0: beta", "1.0: beta"],
    ["2.12.1", "", ""],
  ])(
    "reads Apktool %s version string %j as its writer escaped it",
    (version, source, expected) => {
      expect(parseApktoolYml(yml(version, source))).toEqual({
        versionName: expected,
        versionCode: "7",
        minSdkVersion: "24",
        targetSdkVersion: "34",
      });
    },
  );
});

describe("parseManifestPackage", () => {
  it("reads the package attribute from a decoded manifest", () => {
    const manifest =
      '<?xml version="1.0" encoding="utf-8" standalone="no"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" android:compileSdkVersion="34" package="com.rea.apktool.probe" platformBuildVersionCode="34">';
    expect(parseManifestPackage(`${manifest}</manifest>`)).toBe(
      "com.rea.apktool.probe",
    );
  });

  it("reads package with reordered or single-quoted XML attributes", () => {
    expect(
      parseManifestPackage("<manifest debug='false' package='org.rea.app' />"),
    ).toBe("org.rea.app");
  });

  it("reports null when no package attribute exists", () => {
    expect(parseManifestPackage("<manifest>\n</manifest>\n")).toBeNull();
  });

  it("reads the package when unrelated manifest text contains U+FFFD", () => {
    expect(
      parseManifestPackage(
        '<manifest package="org.rea.app"><application label="\uFFFD"/></manifest>',
      ),
    ).toBe("org.rea.app");
  });

  it("still rejects malformed attributes alongside U+FFFD", () => {
    expect(() =>
      parseManifestPackage(
        '<manifest package=org.rea.app><application label="\uFFFD"/></manifest>',
      ),
    ).toThrow(/AndroidManifest.xml is not well-formed XML/u);
  });

  it("rejects a well-formed document with the wrong root element", () => {
    expect(() => parseManifestPackage("<resources/>")).toThrowError(
      new TypeError("AndroidManifest.xml root must be <manifest>"),
    );
  });
});

describe("parseDecodedStrings", () => {
  it("projects entries from a real decoded strings.xml", () => {
    const stringsXml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      '    <string name="api_endpoint">https://api.example.com/v1</string>',
      '    <string name="app_name">ApktoolProbe</string>',
      '    <string name="debug_flag">true</string>',
      "</resources>",
      "",
    ].join("\n");
    expect(parseDecodedStrings(stringsXml)).toEqual(
      ok({
        entries: [
          { name: "api_endpoint", value: "https://api.example.com/v1" },
          { name: "app_name", value: "ApktoolProbe" },
          { name: "debug_flag", value: "true" },
        ],
        unparsedCount: 0,
      }),
    );
  });

  it("counts entries with nested markup instead of flattening them", () => {
    const stringsXml =
      '<resources><string name="styled">Hello <b>world</b></string><string name="plain">ok</string></resources>';
    expect(parseDecodedStrings(stringsXml)).toEqual(
      ok({
        entries: [{ name: "plain", value: "ok" }],
        unparsedCount: 1,
      }),
    );
  });

  it("preserves escaped entities verbatim", () => {
    const stringsXml =
      '<resources><string name="escaped">a &amp; b &lt;c&gt;</string></resources>';
    expect(parseDecodedStrings(stringsXml)).toEqual(
      ok({
        entries: [{ name: "escaped", value: "a &amp; b &lt;c&gt;" }],
        unparsedCount: 0,
      }),
    );
  });

  it("preserves literal U+FFFD and unaffected sibling strings", () => {
    expect(
      parseDecodedStrings(
        '<resources><string name="good">Hello</string><string name="edge">\uFFFD</string></resources>',
      ),
    ).toEqual(
      ok({
        entries: [
          { name: "good", value: "Hello" },
          { name: "edge", value: "\uFFFD" },
        ],
        unparsedCount: 0,
      }),
    );
  });

  it.each([
    "<resources><string name=unquoted>\uFFFD</string></resources>",
    '<resources><string name="broken">\uFFFD</resources>',
  ])("still rejects malformed XML containing U+FFFD: %s", (xml) => {
    expect(parseDecodedStrings(xml)).toMatchObject({
      ok: false,
      error: {
        _tag: "ApktoolStringsDocumentError",
        reason: "malformed",
        cause: { _tag: "XmlDocumentParseError" },
      },
    });
  });

  it("keeps empty, self-closing, and reordered string attributes", () => {
    expect(
      parseDecodedStrings(
        '<resources><string translatable="false" name="empty"/><string name="paired"></string></resources>',
      ),
    ).toEqual(
      ok({
        entries: [
          { name: "empty", value: "" },
          { name: "paired", value: "" },
        ],
        unparsedCount: 0,
      }),
    );
  });

  it("ignores comments without mistaking them for nested markup", () => {
    expect(
      parseDecodedStrings(
        '<resources><!-- <string name="fake">bad</string> --><string name="real">before<!-- note -->after</string></resources>',
      ),
    ).toEqual(
      ok({
        entries: [{ name: "real", value: "beforeafter" }],
        unparsedCount: 0,
      }),
    );
  });

  it("does not include a trailing document comment in the last string", () => {
    expect(
      parseDecodedStrings(
        '<resources><string name="a">one</string></resources><!-- </string> -->',
      ),
    ).toEqual(
      ok({
        entries: [{ name: "a", value: "one" }],
        unparsedCount: 0,
      }),
    );
  });

  it("preserves source whitespace and entity spelling", () => {
    expect(
      parseDecodedStrings(
        '<resources><string name="raw">  a &amp; b  </string></resources>',
      ),
    ).toEqual(
      ok({
        entries: [{ name: "raw", value: "  a &amp; b  " }],
        unparsedCount: 0,
      }),
    );
  });

  it("keeps source slices aligned across CRLF and CR line endings", () => {
    for (const newline of ["\r\n", "\r"]) {
      expect(
        parseDecodedStrings(
          `<resources>${newline}  <string name="raw">x &amp; y</string>${newline}</resources>`,
        ),
      ).toEqual(
        ok({
          entries: [{ name: "raw", value: "x &amp; y" }],
          unparsedCount: 0,
        }),
      );
    }
  });
});

describe("string document validity and omission counts", () => {
  it("counts a string with no name as unsupported instead of emitting an empty name", () => {
    expect(
      parseDecodedStrings("<resources><string>value</string></resources>"),
    ).toEqual(ok({ entries: [], unparsedCount: 1 }));
  });

  it("distinguishes malformed XML from counted unsupported string markup", () => {
    expect(
      parseDecodedStrings("<resources><string name='broken'>no</resources>"),
    ).toMatchObject({
      ok: false,
      error: { _tag: "ApktoolStringsDocumentError", reason: "malformed" },
    });
    expect(
      parseDecodedStrings(
        '<resources><string name="styled">Hello <b>world</b></string></resources>',
      ),
    ).toEqual(ok({ entries: [], unparsedCount: 1 }));
  });
});

it.each(["<manifest/>", '<other><string name="a">one</string></other>'])(
  "keeps a wrong document root separate from an entry count: %s",
  (xml) => {
    const parsed = parseDecodedStrings(xml);
    expect(parsed).toMatchObject({
      ok: false,
      error: { _tag: "ApktoolStringsDocumentError", reason: "wrong_root" },
    });
    expect(parsed).not.toHaveProperty("value");
    if (parsed.ok) throw new Error("Expected document failure");
    expect(parsed.error).not.toHaveProperty("unparsedCount");
  },
);
