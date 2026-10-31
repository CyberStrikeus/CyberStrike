import { binaryKeyedArchiveUidShapes } from "../../../tests/fixtures/keyedArchiveUidShapes.js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { build, buildBinary, type PlistValue } from "plist";
import { estimateBinaryPlistExpansion } from "./PropertyListDecodeBudget.js";
import {
  decodeKeyedArchiveBytes,
  inspectBundleKeyedArchive,
} from "./KeyedArchiveReader.js";
import {
  PlistNestingLimitError,
  unknownDateLimitation,
} from "../../domain/apple/plistValue.js";
import { deeplyNestedXmlPlist } from "../../../tests/fixtures/keyedArchiveXmlNesting.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { scanBinaryPlistScalars } from "./PlistScalars.js";
import { embedSubmillisecondDateInWideIntegerPayload } from "../../../tests/fixtures/binaryPlistScalarAlias.js";
import {
  readBinaryPlistObjectOffset,
  readBinaryPlistObjectTableLayout,
  writeBinaryPlistObjectOffset,
} from "../../../tests/fixtures/binaryPlistObjectTable.js";

const archive = {
  $archiver: "NSKeyedArchiver",
  $version: 100000,
  $objects: [
    "$null",
    {
      $class: { UID: 4 },
      child: { UID: 2 },
      shared: { UID: 2 },
      self: { UID: 1 },
      conditional: { UID: 0 },
      broken: { UID: 90 },
    },
    { "NS.objects": [{ UID: 1 }, { UID: 3 }] },
    "value",
    { $classname: "UnknownModel", $classes: ["UnknownModel", "NSObject"] },
  ],
  $top: { root: { UID: 1 }, other: { UID: 2 } },
};

const binaryArchiveWithDate = (): Buffer =>
  Buffer.from(
    buildBinary({
      ...archive,
      $objects: ["$null", new Date("2001-01-01T00:00:00.100Z")],
      $top: { root: { UID: 1 } },
    }),
  );

const binaryArchiveWithOverlappingDate = (): Buffer => {
  const bytes = Buffer.from(
    buildBinary({
      ...archive,
      $objects: [
        "$null",
        new Date("2001-01-01T00:00:00.000Z"),
        Buffer.alloc(0),
      ],
      $top: { root: { UID: 1 } },
    }),
  );
  const date = scanBinaryPlistScalars(bytes).dates[0];
  if (date === undefined)
    throw new Error("binary archive fixture lost its date");
  bytes.writeDoubleBE(0.0005, date.payloadOffset);
  const objectTable = readBinaryPlistObjectTableLayout(bytes);
  for (let objectId = 0; objectId < objectTable.objectCount; objectId += 1) {
    const offset = readBinaryPlistObjectOffset(bytes, objectTable, objectId);
    if (offset !== date.offset && bytes[offset] === 0x40) {
      writeBinaryPlistObjectOffset(
        bytes,
        objectTable,
        objectId,
        date.payloadOffset + 1,
      );
      return bytes;
    }
  }
  throw new Error("binary archive fixture lost its empty data object");
};

const binaryArchiveDateCrossingOffsetTable = (): Buffer => {
  const bytes = Buffer.from(binaryArchiveWithDate());
  const date = scanBinaryPlistScalars(bytes).dates[0];
  if (date === undefined)
    throw new Error("binary archive fixture lost its date");
  const objectTable = readBinaryPlistObjectTableLayout(bytes);
  let dateObjectId = -1;
  for (let objectId = 0; objectId < objectTable.objectCount; objectId += 1) {
    if (
      readBinaryPlistObjectOffset(bytes, objectTable, objectId) === date.offset
    )
      dateObjectId = objectId;
  }
  if (dateObjectId < 0)
    throw new Error("binary archive fixture lost its date object-table entry");

  const crossingOffset = objectTable.tableOffset - 1;
  bytes[crossingOffset] = 0x33;
  writeBinaryPlistObjectOffset(
    bytes,
    objectTable,
    dateObjectId,
    crossingOffset,
  );
  return bytes;
};

describe("keyed archive scalar projection", () => {
  it("preserves the exact integer and unknown date through archive projection", () => {
    const source = Buffer.from(
      buildBinary({
        ...archive,
        $objects: ["$null", Buffer.alloc(16), new Date(0)],
        $top: { root: { UID: 1 } },
      }),
    );
    const { bytes, integerDecimal } =
      embedSubmillisecondDateInWideIntegerPayload(source);

    const graph = decodeKeyedArchiveBytes(bytes, {
      root: "root",
      offset: 1,
      limit: 2,
    });

    expect(graph.objects).toContainEqual(
      expect.objectContaining({
        id: 1,
        value: { $plist_type: "integer", decimal: integerDecimal },
      }),
    );
    expect(graph.objects).toContainEqual(
      expect.objectContaining({
        id: 2,
        value: { $plist_type: "date", iso8601: null },
      }),
    );
  });

  it("rejects a reachable date whose payload enters the offset table", () => {
    expect(() =>
      decodeKeyedArchiveBytes(binaryArchiveDateCrossingOffsetTable(), {
        root: "root",
        offset: 0,
        limit: 2,
      }),
    ).toThrow(
      expect.objectContaining({
        message: "binary plist date object is truncated",
      }),
    );
  });

  it("keeps overlapping date precision unknown without changing its sibling object", () => {
    const graph = decodeKeyedArchiveBytes(binaryArchiveWithOverlappingDate(), {
      root: "root",
      offset: 0,
      limit: 4,
    });

    expect(graph.objects).toContainEqual(
      expect.objectContaining({
        id: 1,
        value: { $plist_type: "date", iso8601: null },
      }),
    );
    expect(graph.objects).toContainEqual(
      expect.objectContaining({
        id: 2,
        value: { $plist_type: "data", base64: "" },
      }),
    );
    expect(graph.limitations).toContainEqual(
      expect.stringContaining("sub-millisecond source records overlap"),
    );
  });
});

describe("inert keyed archive decoding", () => {
  it.each(["bplist00", "NIBArchive"])(
    "rejects high-bit mutations of %s as malformed bytes rather than another archive kind",
    (signature) => {
      for (let index = 0; index < signature.length; index += 1) {
        const bytes = Buffer.from(signature);
        bytes[index] = (bytes[index] ?? 0) | 0x80;
        expect(() =>
          decodeKeyedArchiveBytes(bytes, { offset: 0, limit: 1 }),
        ).toThrow(
          expect.objectContaining({
            name: "XmlPlistTextDecodeError",
            reason: "invalid-bytes",
            cause: expect.any(TypeError),
          }),
        );
      }
    },
  );

  it("preserves CF$UID, malformed references and original pagination identities", () => {
    const bytes = Buffer.from(
      build({
        ...archive,
        $objects: [
          "$null",
          { bad: { CF$UID: -1 }, valid: { CF$UID: 2 }, broken: { CF$UID: 90 } },
          "value",
        ],
      }),
    );
    const graph = decodeKeyedArchiveBytes(bytes, {
      root: "root",
      offset: 1,
      limit: 1,
    });
    expect(graph.roots).toEqual({ root: { UID: 1 } });
    expect(graph.objects.map(({ id }) => id)).toEqual([1]);
    expect(graph.next_offset).toBe(2);
    expect(graph.references).toContainEqual(
      expect.objectContaining({ source: 1, target: 90, status: "unresolved" }),
    );
    expect(graph.references).toContainEqual(
      expect.objectContaining({ source: 1, target: null, status: "malformed" }),
    );
    expect(graph.references).toContainEqual(
      expect.objectContaining({ source: 1, target: 2, status: "resolved" }),
    );
  });
  it("preserves an XML object dictionary keyed __proto__", () => {
    const xml = build({
      ...archive,
      $objects: ["$null", { prototypeKey: "x" }],
    }).replace("<key>prototypeKey</key>", "<key>__proto__</key>");
    const graph = decodeKeyedArchiveBytes(Buffer.from(xml), {
      offset: 0,
      limit: 2,
    });
    expect(graph.objects.map(({ value }) => value)).toEqual([
      "$null",
      { ["__proto__"]: "x" },
    ]);
    expect(
      graph.limitations.some((value) => value.includes("keyed __proto__")),
    ).toBe(false);
  });
  it("preserves a binary object dictionary keyed __proto__", () => {
    const placeholder = "proto_key";
    const encoded = Buffer.from(
      buildBinary({
        ...archive,
        $objects: ["$null", { [placeholder]: "hidden" }],
      }),
    );
    const start = encoded.indexOf(placeholder);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(encoded.indexOf(placeholder, start + placeholder.length)).toBe(-1);
    Buffer.from("__proto__").copy(encoded, start);

    const graph = decodeKeyedArchiveBytes(encoded, { offset: 0, limit: 2 });
    expect(graph.objects[1]?.value).toEqual({ ["__proto__"]: "hidden" });
    expect(
      graph.limitations.some((value) => value.includes("keyed __proto__")),
    ).toBe(false);
  });
  it("does not report a binary __proto__ value as an omitted key", () => {
    const graph = decodeKeyedArchiveBytes(
      Buffer.from(
        buildBinary({
          ...archive,
          note: "__proto__",
          $objects: ["$null", "value"],
        }),
      ),
      { offset: 0, limit: 2 },
    );
    expect(
      graph.limitations.some((value) => value.includes("keyed __proto__")),
    ).toBe(false);
  });
  it("rejects missing roots, malformed plist, and non-keyed archives", () => {
    expect(() =>
      decodeKeyedArchiveBytes(Buffer.from("bplist00bad"), {
        offset: 0,
        limit: 1,
      }),
    ).toThrow();
    expect(() =>
      decodeKeyedArchiveBytes(Buffer.from(build({ ...archive, $top: {} })), {
        offset: 0,
        limit: 1,
      }),
    ).toThrow("roots");
    expect(() =>
      decodeKeyedArchiveBytes(Buffer.from(build({ plain: true })), {
        offset: 0,
        limit: 1,
      }),
    ).toThrow("NSKeyedArchiver");
    expect(() =>
      decodeKeyedArchiveBytes(Buffer.from(buildBinary(archive)), {
        root: "missing",
        offset: 0,
        limit: 1,
      }),
    ).toThrow(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            path: ["root"],
            message: expect.stringContaining("does not exist"),
            expected: ["root", "other"],
          }),
        ],
      }),
    );
  });
});

/** Encode a bplist00 whose objects reference each other by index. */
const binaryPlist = (objects: readonly Buffer[]): Buffer => {
  const header = Buffer.from("bplist00");
  const offsets: number[] = [];
  let position = header.length;
  for (const object of objects) {
    offsets.push(position);
    position += object.length;
  }
  const table = Buffer.alloc(objects.length * 4);
  offsets.forEach((offset, index) => table.writeUInt32BE(offset, index * 4));
  const trailer = Buffer.alloc(32);
  trailer[6] = 4;
  trailer[7] = 2;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(position), 24);
  return Buffer.concat([header, ...objects, table, trailer]);
};
const plistArray = (references: readonly number[]): Buffer => {
  const bytes = Buffer.alloc(1 + references.length * 2);
  bytes[0] = 0xa0 | references.length;
  references.forEach((reference, index) =>
    bytes.writeUInt16BE(reference, 1 + index * 2),
  );
  return bytes;
};
const plistString = (value: string): Buffer =>
  Buffer.concat([Buffer.from([0x50 | value.length]), Buffer.from(value)]);
const plistUtf16String = (value: string): Buffer => {
  const bytes = Buffer.alloc(1 + value.length * 2);
  bytes[0] = 0x60 | value.length;
  for (let index = 0; index < value.length; index += 1)
    bytes.writeUInt16BE(value.charCodeAt(index), 1 + index * 2);
  return bytes;
};
const plistExtendedUtf16String = (value: string): Buffer => {
  const bytes = Buffer.alloc(3 + value.length * 2);
  bytes.set([0x6f, 0x10, value.length]);
  for (let index = 0; index < value.length; index += 1)
    bytes.writeUInt16BE(value.charCodeAt(index), 3 + index * 2);
  return bytes;
};
// {"$archiver": "NSKeyedArchiver", "$top": {"root": UID 1}, "$objects": object 8}
const keyedRoot = (payload: readonly Buffer[]): Buffer =>
  binaryPlist([
    Buffer.from([0xd3, 0, 1, 0, 3, 0, 4, 0, 2, 0, 8, 0, 5]),
    plistString("$archiver"),
    Buffer.concat([
      Buffer.from([0x5f, 0x10, 15]),
      Buffer.from("NSKeyedArchiver"),
    ]),
    plistString("$objects"),
    plistString("$top"),
    Buffer.from([0xd1, 0, 6, 0, 7]),
    plistString("root"),
    Buffer.from([0x80, 1]),
    ...payload,
  ]);

describe("binary plist reference preflight", () => {
  const selection = { offset: 0, limit: 10 };

  it("rejects an array key that coerces to __proto__ before parsing", () => {
    expect(() =>
      decodeKeyedArchiveBytes(
        keyedRoot([
          plistArray([9]),
          Buffer.from([0xd1, 0, 10, 0, 11]),
          plistArray([12]),
          Buffer.from([0xd1, 0, 13, 0, 14]),
          plistString("__proto__"),
          plistString("lost"),
          plistString("value"),
        ]),
        selection,
      ),
    ).toThrow("binary plist dictionary key is not a string");
  });

  it("rejects binary data dictionary keys", () => {
    expect(() =>
      decodeKeyedArchiveBytes(
        keyedRoot([
          plistArray([9]),
          Buffer.from([0xd1, 0, 10, 0, 11]),
          Buffer.from([0x41, 0xab]),
          plistString("value"),
        ]),
        selection,
      ),
    ).toThrow("binary plist dictionary key is not a string");
  });

  it("reports a reference cycle as malformed, not as an oversized archive", () => {
    expect(() =>
      decodeKeyedArchiveBytes(keyedRoot([plistArray([8])]), selection),
    ).toThrow(
      new TypeError(
        "binary plist object references form a cycle, which a property list cannot represent",
      ),
    );
  });

  it("rejects exponential shared-container expansion before decoding", () => {
    // Forty levels of [next, next] expand to 2^40 leaves in a few hundred bytes.
    const levels = Array.from({ length: 40 }, (_, index) =>
      plistArray([9 + index, 9 + index]),
    );
    expect(() =>
      decodeKeyedArchiveBytes(
        keyedRoot([...levels, plistString("x")]),
        selection,
      ),
    ).toThrow(RangeError);
  });

  it("decodes shared leaf references", () => {
    const decoded = decodeKeyedArchiveBytes(
      keyedRoot([plistArray([9, 9, 9]), plistString("$null")]),
      selection,
    );
    expect(decoded.objects.map(({ id, value }) => [id, value])).toEqual([
      [0, "$null"],
      [1, "$null"],
      [2, "$null"],
    ]);
  });
});

describe("binary plist dictionary materialization", () => {
  const selection = { offset: 0, limit: 10 };

  it("recognizes a shared key object used by separate dictionaries", () => {
    const graph = decodeKeyedArchiveBytes(
      keyedRoot([
        plistArray([9, 12]),
        Buffer.from([0xd1, 0, 10, 0, 11]),
        plistString("__proto__"),
        plistString("first"),
        Buffer.from([0xd1, 0, 10, 0, 13]),
        plistString("second"),
      ]),
      selection,
    );
    expect(graph.objects.map(({ value }) => value)).toEqual([
      { ["__proto__"]: "first" },
      { ["__proto__"]: "second" },
    ]);
    expect(
      graph.limitations.some((value) => value.includes("keyed __proto__")),
    ).toBe(false);
  });

  it("preserves nested keys while duplicate entries retain the last value", () => {
    const placeholder = "proto_key";
    const nested = Buffer.from(
      buildBinary({
        ...archive,
        $objects: [
          "$null",
          { [placeholder]: { [placeholder]: "hidden", visible: true } },
        ],
      }),
    );
    let index = nested.indexOf(placeholder);
    while (index !== -1) {
      Buffer.from("__proto__").copy(nested, index);
      index = nested.indexOf(placeholder, index + placeholder.length);
    }
    const nestedGraph = decodeKeyedArchiveBytes(nested, selection);
    expect(nestedGraph.objects[1]?.value).toEqual({
      ["__proto__"]: { ["__proto__"]: "hidden", visible: true },
    });
    expect(
      nestedGraph.limitations.some((value) =>
        value.includes("keyed __proto__"),
      ),
    ).toBe(false);

    const shadowedValue = keyedRoot([
      plistArray([9]),
      Buffer.from([0xd2, 0, 10, 0, 10, 0, 11, 0, 12]),
      plistString("shadow"),
      Buffer.from([0xd1, 0, 13, 0, 14]),
      plistString("replacement"),
      plistString(placeholder),
      plistString("hidden"),
    ]);
    const keyOffset = shadowedValue.indexOf(Buffer.from(placeholder));
    expect(keyOffset).toBeGreaterThanOrEqual(0);
    Buffer.from("__proto__").copy(shadowedValue, keyOffset);
    const shadowedGraph = decodeKeyedArchiveBytes(shadowedValue, selection);
    expect(shadowedGraph.objects[0]?.value).toEqual({ shadow: "replacement" });
  });

  it("detects UTF-16 binary dictionary keys", () => {
    const graph = decodeKeyedArchiveBytes(
      keyedRoot([
        plistArray([9]),
        Buffer.from([0xd1, 0, 10, 0, 11]),
        plistUtf16String("__proto__"),
        plistString("hidden"),
      ]),
      selection,
    );
    expect(graph.objects[0]?.value).toEqual({ ["__proto__"]: "hidden" });
    expect(
      graph.limitations.some((value) => value.includes("keyed __proto__")),
    ).toBe(false);
  });

  it("detects extended-length UTF-16 binary dictionary keys", () => {
    const graph = decodeKeyedArchiveBytes(
      keyedRoot([
        plistArray([9]),
        Buffer.from([0xd1, 0, 10, 0, 11]),
        plistExtendedUtf16String("__proto__"),
        plistString("hidden"),
      ]),
      selection,
    );
    expect(graph.objects[0]?.value).toEqual({ ["__proto__"]: "hidden" });
    expect(
      graph.limitations.some((value) => value.includes("keyed __proto__")),
    ).toBe(false);
  });
});

/**
 * Python `plistlib` binary NSKeyedArchiver with `$objects = ["$null", date]`
 * and `$top.root` as UID 1. The date is marker `0x33` and float64 `0.1`
 * seconds after the 2001 epoch (`2001-01-01T00:00:00.100Z`).
 */
const pythonBinaryDateControl = Buffer.from(
  "62706c6973743030d4010203040506090c5924617263686976657258246f626a656374735424746f70582476657273696f6e5f100f4e534b657965644172636869766572a2070855246e756c6c333fb999999999999ad10a0b54726f6f74800112000186a008111b24293244474d56595e600000000000000101000000000000000d00000000000000000000000000000065",
  "hex",
);
const canonicalDateMarker = Buffer.alloc(9);
canonicalDateMarker[0] = 0x33;
canonicalDateMarker.writeDoubleBE(0.1, 1);

/** Copy the control and mutate its single canonical date marker. */
const mutateCanonicalDate = (
  mutate: (markerOffset: number, bytes: Buffer) => void,
): Buffer => {
  const bytes = Buffer.from(pythonBinaryDateControl);
  const offset = bytes.indexOf(canonicalDateMarker);
  if (offset < 0 || bytes.indexOf(canonicalDateMarker, offset + 1) !== -1)
    throw new Error("expected one canonical binary date in the control");
  mutate(offset, bytes);
  return bytes;
};

const dateScalar = (iso8601: string | null) => ({
  id: 1,
  kind: "scalar" as const,
  status: "observed" as const,
  value: { $plist_type: "date", iso8601 },
});

describe("binary keyed archive dates", () => {
  const selection = { offset: 0, limit: 10 };

  it("keeps the canonical millisecond control as an observed timestamp", async () => {
    const bytes = Buffer.from(pythonBinaryDateControl);
    const graph = decodeKeyedArchiveBytes(bytes, selection);
    expect(graph.objects[1]).toMatchObject(
      dateScalar("2001-01-01T00:00:00.100Z"),
    );
    expect(graph.limitations).not.toContain(unknownDateLimitation(1));
    expect(Buffer.compare(bytes, pythonBinaryDateControl)).toBe(0);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "39f08db8341bd74220352dfd559485515cce1e6035e08f27a59ab8f856374a30",
    );
    const root = await createTestTempDirectory("rea-keyed-date-control-");
    await writeFile(join(root, "archive.plist"), bytes);
    const inspected = await inspectBundleKeyedArchive({
      bundlePath: root,
      targetSha256: createHash("sha256").update(bytes).digest("hex"),
      parameters: { path: "archive.plist" },
    });
    expect(inspected.objects[1]).toMatchObject(
      dateScalar("2001-01-01T00:00:00.100Z"),
    );
    expect(inspected.limitations).not.toContain(unknownDateLimitation(1));
    expect(
      Buffer.compare(await readFile(join(root, "archive.plist")), bytes),
    ).toBe(0);
  });

  it.each(
    [0x30, 0x31, 0x32, 0x34].map(
      (marker) => [marker.toString(16), marker] as const,
    ),
  )(
    "refuses reachable binary date marker 0x%s instead of projecting a timestamp",
    async (_hex, marker) => {
      const bytes = mutateCanonicalDate((offset, copy) => {
        copy[offset] = marker;
      });
      const original = Buffer.from(bytes);
      expect(() => decodeKeyedArchiveBytes(bytes, selection)).toThrow(
        new TypeError(
          `binary plist date marker 0x${marker.toString(16)} is invalid`,
        ),
      );
      expect(Buffer.compare(bytes, original)).toBe(0);
      if (marker === 0x30)
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          "ac5696b866c312feb53c2e82edd8fea79dbeb572eb1b07e4291603faa41e8c0e",
        );
      const root = await createTestTempDirectory("rea-keyed-date-marker-");
      const path = join(root, "archive.plist");
      await writeFile(path, bytes);
      await expect(
        inspectBundleKeyedArchive({
          bundlePath: root,
          targetSha256: null,
          parameters: { path: "archive.plist" },
        }),
      ).rejects.toMatchObject({
        name: "ArtifactReaderFailure",
        reason: "format",
        message: `Cannot decode selected Foundation keyed archive: binary plist date marker 0x${marker.toString(16)} is invalid`,
      });
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    },
  );

  it("keeps a sub-millisecond instant unknown without changing the canonical sibling", async () => {
    const submillisecond = mutateCanonicalDate((offset, copy) => {
      copy.writeDoubleBE(0.1005, offset + 1);
    });
    const original = Buffer.from(submillisecond);
    const graph = decodeKeyedArchiveBytes(submillisecond, selection);
    expect(graph.objects[1]).toMatchObject(dateScalar(null));
    expect(JSON.stringify(graph.objects[1]?.value)).not.toContain(
      "2001-01-01T00:00:00.100Z",
    );
    expect(graph.limitations).toContain(unknownDateLimitation(1));
    expect(graph.limitations.join("\n")).not.toContain(
      "number metadata could not be completely observed",
    );
    expect(Buffer.compare(submillisecond, original)).toBe(0);
    expect(createHash("sha256").update(submillisecond).digest("hex")).toBe(
      "ab69ba6e8034c6f60b828ee323a5a3e81bae3e7657477e0ebfbfdb93d53ed2ce",
    );
    const root = await createTestTempDirectory("rea-keyed-date-subms-");
    await writeFile(join(root, "archive.plist"), submillisecond);
    const inspected = await inspectBundleKeyedArchive({
      bundlePath: root,
      targetSha256: createHash("sha256").update(submillisecond).digest("hex"),
      parameters: { path: "archive.plist" },
    });
    expect(inspected.objects[1]).toMatchObject(dateScalar(null));
    expect(inspected.limitations).toContain(unknownDateLimitation(1));
    expect(
      Buffer.compare(
        await readFile(join(root, "archive.plist")),
        submillisecond,
      ),
    ).toBe(0);

    const mixed = Buffer.from(
      buildBinary({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: [
          "$null",
          new Date("2001-01-01T00:00:00.100Z"),
          new Date("2001-01-01T00:00:00.100Z"),
          new Date("2001-01-01T00:00:00.100Z"),
        ],
        $top: { root: { UID: 1 } },
      }),
    );
    const pattern = Buffer.from(canonicalDateMarker);
    const offsets: number[] = [];
    for (
      let offset = mixed.indexOf(pattern);
      offset !== -1;
      offset = mixed.indexOf(pattern, offset + pattern.length)
    )
      offsets.push(offset);
    expect(offsets).toHaveLength(3);
    // 0.1004 and 0.1005 both round to the same millisecond as the control.
    mixed.writeDoubleBE(0.1004, (offsets[1] ?? 0) + 1);
    mixed.writeDoubleBE(0.1005, (offsets[2] ?? 0) + 1);
    const mixedOriginal = Buffer.from(mixed);
    const mixedGraph = decodeKeyedArchiveBytes(mixed, selection);
    expect(mixedGraph.objects.slice(1).map(({ value }) => value)).toEqual([
      { $plist_type: "date", iso8601: "2001-01-01T00:00:00.100Z" },
      { $plist_type: "date", iso8601: null },
      { $plist_type: "date", iso8601: null },
    ]);
    expect(mixedGraph.limitations).toContain(unknownDateLimitation(2));
    expect(Buffer.compare(mixed, mixedOriginal)).toBe(0);
  });
});

describe("binary plist date object region", () => {
  it("refuses a binary date that extends past the object region", () => {
    // Strict bounds end objects at the offset table. Four payload bytes
    // remain before that table, short of the required eight.
    const bytes = Buffer.alloc(8 + 5 + 1 + 32);
    bytes.write("bplist00");
    bytes[8] = 0x33;
    const offsetTable = 13;
    bytes[offsetTable] = 8;
    const trailer = bytes.length - 32;
    bytes[trailer + 6] = 1;
    bytes[trailer + 7] = 1;
    bytes.writeBigUInt64BE(1n, trailer + 8);
    bytes.writeBigUInt64BE(0n, trailer + 16);
    bytes.writeBigUInt64BE(BigInt(offsetTable), trailer + 24);
    expect(() =>
      estimateBinaryPlistExpansion(bytes, 1024 * 1024, { bounds: "strict" }),
    ).toThrow(new TypeError("binary plist date object is truncated"));
    // Decoder bounds extend other objects to the end of the file. The date
    // payload still has to end at the offset table. The keyed-archive reader
    // uses those bounds and must refuse the same payload.
    expect(() =>
      estimateBinaryPlistExpansion(bytes, 1024 * 1024, { bounds: "decoder" }),
    ).toThrow(new TypeError("binary plist date object is truncated"));
    expect(() =>
      decodeKeyedArchiveBytes(bytes, { offset: 0, limit: 1 }),
    ).toThrow(new TypeError("binary plist date object is truncated"));
  });

  it("refuses a decoder-bounds date whose marker sits past the offset table", () => {
    // The one-byte offset table at byte 8 names an object at byte 9. That
    // 0x33 marker and its eight payload bytes fit in the file, which decoder
    // bounds would otherwise accept, but they are outside the object region.
    const bytes = Buffer.alloc(64);
    bytes.write("bplist00");
    bytes[8] = 9;
    bytes[9] = 0x33;
    const trailer = bytes.length - 32;
    bytes[trailer + 6] = 1;
    bytes[trailer + 7] = 1;
    bytes.writeBigUInt64BE(1n, trailer + 8);
    bytes.writeBigUInt64BE(0n, trailer + 16);
    bytes.writeBigUInt64BE(8n, trailer + 24);
    expect(() =>
      estimateBinaryPlistExpansion(bytes, 1024 * 1024, { bounds: "decoder" }),
    ).toThrow(new TypeError("binary plist date object is truncated"));
    expect(() =>
      decodeKeyedArchiveBytes(bytes, { offset: 0, limit: 1 }),
    ).toThrow(new TypeError("binary plist date object is truncated"));
  });
});

describe("XML plist nesting preflight", () => {
  const selection = { offset: 0, limit: 1 };

  /** A valid XML NSKeyedArchiver envelope whose object 1 nests `depth` dictionaries. */
  const deeplyNestedArchive = (depth: number) => {
    let payload: PlistValue = "leaf";
    for (let level = 0; level < depth; level += 1) payload = { k: payload };
    return Buffer.from(
      build({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: ["$null", payload],
        $top: { root: { UID: 1 } },
      }),
    );
  };

  /** Follow the single-member chain of a decoded object to its deepest value. */
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

  it.each([129, 4000])(
    "rejects %i-level XML nesting as the documented resource limit",
    (depth) => {
      // Recursive decoding exceeds the call stack before the projection limit
      // can report it, so the decoder must reject the nesting up front with
      // the same bounded-resource error an in-reach document would produce.
      expect(() =>
        decodeKeyedArchiveBytes(
          Buffer.from(deeplyNestedXmlPlist(depth)),
          selection,
        ),
      ).toThrow(new PlistNestingLimitError(128));
    },
  );

  it("decodes a valid XML keyed archive exactly at the nesting limit", () => {
    const graph = decodeKeyedArchiveBytes(deeplyNestedArchive(126), {
      root: "root",
      offset: 1,
      limit: 1,
    });
    expect(graph.objects).toHaveLength(1);
    expect(deepestValue(graph.objects[0]?.value)).toBe("leaf");
  });

  it("rejects one nesting level past the limit before decoding", () => {
    expect(() =>
      decodeKeyedArchiveBytes(deeplyNestedArchive(127), selection),
    ).toThrow(new PlistNestingLimitError(128));
  });
});

it("distinguishes binary UID records from authored UID-shaped dictionaries", () => {
  const graph = decodeKeyedArchiveBytes(binaryKeyedArchiveUidShapes(), {
    offset: 0,
    limit: 10,
  });
  expect(graph.objects[1]?.value).toMatchObject({
    ordinary: { UID: 2 },
    xmlConvention: { CF$UID: 2 },
    actual: { UID: 2 },
  });
  expect(
    graph.references
      .filter(({ source }) => source === 1)
      .map(({ path, target }) => ({ path, target })),
  ).toEqual([
    { path: ["$class"], target: 3 },
    { path: ["actual"], target: 2 },
    { path: ["shared", 0], target: 2 },
    { path: ["shared", 1], target: 2 },
  ]);
});

it("keeps XML authored UID dictionaries as data alongside CF$UID references", () => {
  const graph = decodeKeyedArchiveBytes(
    Buffer.from(
      build({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $top: { root: { CF$UID: 1 } },
        $objects: [
          "$null",
          { $class: { CF$UID: 2 }, authoredRecord: { UID: 3 } },
          { $classname: "T", $classes: ["T", "NSObject"] },
          "sharedString",
        ],
      }),
    ),
    { offset: 0, limit: 10 },
  );
  expect(graph.objects[1]?.value).toMatchObject({ authoredRecord: { UID: 3 } });
  expect(graph.total_references).toBe(2);
  expect(
    graph.references.map(({ source, path, target, status }) => ({
      source,
      path,
      target,
      status,
    })),
  ).toEqual([
    { source: null, path: ["root"], target: 1, status: "resolved" },
    { source: 1, path: ["$class"], target: 2, status: "resolved" },
  ]);
});

it("preserves exact integers in XML authored UID dictionaries", () => {
  const xml = build({
    $archiver: "NSKeyedArchiver",
    $objects: ["$null", { UID: 9007199254740992 }],
    $top: { root: { CF$UID: 1 } },
  }).replace("9007199254740992", "9007199254740993");
  const graph = decodeKeyedArchiveBytes(Buffer.from(xml), {
    offset: 0,
    limit: 10,
  });
  expect(graph.objects[1]?.value).toEqual({
    UID: { $plist_type: "integer", decimal: "9007199254740993" },
  });
  expect(graph.total_references).toBe(1);
});

it("preserves XML dictionary identity beside an authored CF$UID field", () => {
  const xml = build({
    $archiver: "NSKeyedArchiver",
    $objects: [
      "$null",
      { authoredRecord: { CF$UID: 2, prototypeKey: "authored" } },
      "target",
    ],
    $top: { root: { CF$UID: 1 }, genuine: { CF$UID: 2 } },
  }).replace("<key>prototypeKey</key>", "<key>__proto__</key>");
  const graph = decodeKeyedArchiveBytes(Buffer.from(xml), {
    offset: 0,
    limit: 10,
  });
  expect(graph.objects[1]?.value).toEqual({
    authoredRecord: { CF$UID: 2, ["__proto__"]: "authored" },
  });
  expect(graph.total_references).toBe(2);
  expect(graph.references).toEqual([
    expect.objectContaining({
      source: null,
      path: ["genuine"],
      target: 2,
      status: "resolved",
    }),
    expect.objectContaining({
      source: null,
      path: ["root"],
      target: 1,
      status: "resolved",
    }),
  ]);
  expect(
    graph.limitations.some((value) => value.includes("keyed __proto__")),
  ).toBe(false);
});
