import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build } from "plist";
import { expect } from "vitest";

import { keyedArchiveResultSchema } from "../../src/domain/apple/keyedArchive.js";
import type { JsonValue } from "../../src/domain/jsonValue.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

const EXACT_INTEGER = { $plist_type: "integer", decimal: "9007199254740993" };
const ROUNDED = 9007199254740992;
const unknownInteger = (
  literal: string,
  reason: "invalid-literal" | "unsupported-markup",
) => ({
  $plist_type: "unknown",
  element: "integer",
  literal,
  reason,
});

/** Boundary cases that retain exact integers or explicit unknown literals. */
export const mixedArchiveNumberElements = [
  "<integer>9007199254740992<!-- split -->3</integer>",
  "<integer>9007199254740992<![CDATA[3]]></integer>",
  "<integer><![CDATA[9007199254740992]]>3</integer>",
  "<integer><![CDATA[9007199254740992&#51;]]></integer>",
  "<integer>9007199254740992<?rea split?>3</integer>",
  "<integer>9007199254740992<string>3</string></integer>",
  "<integer>9007199254740992x</integer>",
] as const;

interface MetadataCase {
  readonly name: string;
  readonly source: JsonValue;
  readonly element: string;
  readonly expected: JsonValue;
  readonly knownIntegerCount?: number;
  readonly unknownScalarCount?: number;
  readonly malformedReference: boolean;
  readonly integerElement?: string;
}

/** Ordinary dictionaries and malformed numeric references at the same boundary. */
export const archiveNumberMetadataCases: readonly MetadataCase[] = [
  ...[
    {
      element: "<real>9007199254740992<![CDATA[0]]></real>",
      value: 90071992547409920,
    },
    {
      element: "<real><![CDATA[1]]>9007199254740992</real>",
      value: Number("19007199254740992"),
    },
  ].map(({ element, value }) => ({
    name: element,
    source: { first: "__INTEGER__", other: "__OTHER__" },
    element,
    expected: { first: EXACT_INTEGER, other: value },
    malformedReference: false,
  })),
  ...mixedArchiveNumberElements.map((element) => ({
    name: element,
    source: { first: "__INTEGER__", other: "__OTHER__" },
    element,
    expected: {
      first: EXACT_INTEGER,
      other: unknownInteger(
        element.slice("<integer>".length, -"</integer>".length),
        element.endsWith("x</integer>")
          ? "invalid-literal"
          : "unsupported-markup",
      ),
    },
    knownIntegerCount: 1,
    unknownScalarCount: 1,
    malformedReference: false,
  })),
  ...(["UID", "CF$UID"] as const).flatMap((key) => [
    {
      name: `${key} dictionary data`,
      source: { [key]: { amount: "__INTEGER__" } },
      element: "",
      expected: { [key]: { amount: EXACT_INTEGER } },
      malformedReference: false,
    },
    {
      name: `${key} array data`,
      source: { [key]: ["__INTEGER__"] },
      element: "",
      expected: { [key]: [EXACT_INTEGER] },
      malformedReference: false,
    },
    {
      name:
        key === "CF$UID"
          ? `${key} malformed numeric reference`
          : `${key} unsafe integer dictionary data`,
      source: { [key]: "__INTEGER__" },
      element: "",
      expected: { [key]: key === "CF$UID" ? ROUNDED : EXACT_INTEGER },
      malformedReference: key === "CF$UID",
    },
  ]),
  {
    // Native plist integer grammar reads raw text, unlike real elements.
    name: "entity-encoded integer rejected by native plist grammar",
    source: { amount: "__INTEGER__" },
    element: "",
    expected: {
      amount: unknownInteger("&#57;007199254740993", "invalid-literal"),
    },
    knownIntegerCount: 0,
    unknownScalarCount: 1,
    malformedReference: false,
    integerElement: "<integer>&#57;007199254740993</integer>",
  },
];

/** Write one inert archive and retain the original byte digest for assertions. */
export const keyedArchiveNumberMetadataFixture = async (item: MetadataCase) => {
  const root = await createTestTempDirectory("rea-keyed-number-metadata-");
  const xml = build({
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $objects: ["$null", item.source],
    $top: { root: { CF$UID: 1 } },
  })
    .replace(
      "<string>__INTEGER__</string>",
      item.integerElement ?? "<integer>9007199254740993</integer>",
    )
    .replace("<string>__OTHER__</string>", item.element);
  const bytes = Buffer.from(xml);
  const path = join(root, "archive.plist");
  await writeFile(path, bytes);
  return {
    root,
    path,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
};

/** Require exact ordinary values and honest limitations for incomplete metadata. */
export const expectKeyedArchiveNumberMetadata = (
  value: unknown,
  item: MetadataCase,
  digest: string,
) => {
  const result = keyedArchiveResultSchema.parse(value);
  expect(result.archive_sha256).toBe(digest);
  expect(result.roots).toEqual({ root: { CF$UID: 1 } });
  expect(result.objects).toHaveLength(2);
  expect(result.objects[1]).toMatchObject({
    id: 1,
    kind: "dictionary",
    value: item.expected,
  });
  expect(result.references).toContainEqual({
    source: null,
    path: ["root"],
    target: 1,
    status: "resolved",
    raw: { CF$UID: 1 },
  });
  if (item.unknownScalarCount !== undefined) {
    expect(result.limitations).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^${String(item.unknownScalarCount)} XML scalar value\\(s\\) could not be established`,
          "u",
        ),
      ),
    );
    expect(result.limitations).not.toContainEqual(
      expect.stringMatching(/metadata.*completely observed.*precision/u),
    );
  } else {
    expect(result.limitations).not.toContainEqual(
      expect.stringMatching(
        /^\d+ XML scalar value\(s\) could not be established/u,
      ),
    );
  }
  if (item.malformedReference) {
    expect(result.references).toContainEqual({
      source: 1,
      path: [],
      target: null,
      status: "malformed",
      raw: item.expected,
    });
  } else {
    expect(result.references).toHaveLength(1);
    const knownIntegerCount = item.knownIntegerCount ?? 1;
    if (knownIntegerCount === 0) {
      expect(result.limitations).not.toContainEqual(
        expect.stringMatching(/^\d+ unambiguous integer value/u),
      );
    } else {
      expect(result.limitations).toContainEqual(
        expect.stringMatching(
          new RegExp(
            `^${String(knownIntegerCount)} unambiguous integer value`,
            "u",
          ),
        ),
      );
    }
  }
};
