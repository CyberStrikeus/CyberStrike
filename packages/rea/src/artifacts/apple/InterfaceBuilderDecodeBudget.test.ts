import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildBinary } from "plist";
import { describe, expect, it } from "vitest";

import { analyzeInterfaceBuilderBundle } from "./InterfaceBuilderAnalysis.js";
import { interfaceBuilderDecodeBudgetFailure } from "./InterfaceBuilderDecodeBudget.js";
import { preflightPropertyListDecode } from "./PropertyListDecodeBudget.js";
import { unknownDateLimitation } from "../../domain/apple/plistValue.js";
import { parseXmlPropertyList } from "../../domain/propertyListKeys.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { scanBinaryPlistScalars } from "./PlistScalars.js";
import {
  readBinaryPlistObjectOffset,
  readBinaryPlistObjectTableLayout,
  writeBinaryPlistObjectOffset,
} from "../../../tests/fixtures/binaryPlistObjectTable.js";
import { embedSubmillisecondDateInWideIntegerPayload } from "../../../tests/fixtures/binaryPlistScalarAlias.js";

const example = "<!DOCTYPE document [ harmless example ]>";

it.each([
  [
    "XML",
    Buffer.from(
      "<plist><array><integer>9007199254740993</integer></array></plist>",
    ),
  ],
  ["binary", Buffer.from(buildBinary([9007199254740992]))],
] as const)(
  "reserves %s number metadata and value projection before decoding",
  (_format, bytes) => {
    const ordinary = preflightPropertyListDecode(
      bytes,
      1024 * 1024,
    ).estimatedBytes;
    const projected = preflightPropertyListDecode(
      bytes,
      1024 * 1024,
      undefined,
      { numberProjection: true },
    ).estimatedBytes;
    if (_format === "binary") {
      const objectCount = Number(bytes.readBigUInt64BE(bytes.length - 24));
      expect(projected).toBeGreaterThanOrEqual(
        ordinary + bytes.length + objectCount * 96,
      );
    }
    expect(() =>
      preflightPropertyListDecode(bytes, ordinary, undefined, {
        numberProjection: true,
      }),
    ).toThrow(/budget/u);
    expect(() =>
      preflightPropertyListDecode(bytes, 1024 * 1024, undefined, {
        numberProjection: true,
      }),
    ).not.toThrow();
  },
);
const archive = (content: string, comment = "") =>
  `<?xml version="1.0"?><plist version="1.0">${comment}<dict><key>$archiver</key><string>NSKeyedArchiver</string><key>$objects</key><array><string>$null</string><dict><key>$class</key><dict><key>CF$UID</key><integer>2</integer></dict><key>title</key><string>${content}</string></dict><dict><key>$classname</key><string>NSButton</string><key>$classes</key><array><string>NSButton</string><string>NSObject</string></array></dict></array><key>$top</key><dict><key>root</key><dict><key>CF$UID</key><integer>1</integer></dict></dict></dict></plist>`;

const inertDeclarations = [
  {
    kind: "CDATA text",
    xml: archive(`<![CDATA[${example}]]>`),
    title: example,
  },
  {
    kind: "XML comment",
    xml: archive("Build", `<!-- ${example} -->`),
    title: "Build",
  },
] as const;

describe("inert XML declaration examples in Interface Builder archives", () => {
  it.each(inertDeclarations)(
    "preflights $kind without treating it as entity expansion",
    ({ xml }) => {
      expect(() => parseXmlPropertyList(xml)).not.toThrow();
      expect(
        preflightPropertyListDecode(Buffer.from(xml), 16 * 1024 * 1024)
          .estimatedBytes,
      ).toBeGreaterThan(0);
    },
  );

  it.each(inertDeclarations)(
    "retains $kind and archive provenance through bundle decoding",
    async ({ xml, title }) => {
      const root = await createTestTempDirectory("rea-ib-inert-declaration-");
      const bundle = join(root, "Example.app");
      await mkdir(bundle);
      const bytes = Buffer.from(xml);
      await writeFile(join(bundle, "Panel.nib"), bytes);

      const result = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "a".repeat(64),
      });

      expect(result.documents).toContainEqual(
        expect.objectContaining({
          relative_path: "Panel.nib",
          archive_sha256: createHash("sha256").update(bytes).digest("hex"),
        }),
      );
      expect(result.graph.nodes.map(({ name }) => name)).toContain(title);
      expect(result.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "archive_decode",
          status: "complete",
        }),
      );
    },
  );

  it("continues to refuse an actual internal entity declaration before decoding", () => {
    const xml = archive("&harmless;").replace(
      "<plist",
      '<!DOCTYPE plist [<!ENTITY harmless "value">]><plist',
    );
    expect(() =>
      preflightPropertyListDecode(
        Buffer.from(xml),
        16 * 1024 * 1024,
        undefined,
        {
          budget: "the aggregate Interface Builder decode budget",
          fail: interfaceBuilderDecodeBudgetFailure,
        },
      ),
    ).toThrow(
      "XML plist internal entity expansion exceeds the aggregate Interface Builder decode budget",
    );
  });

  it("does not mistake a bracket in a quoted external identifier for an internal subset", () => {
    const xml = archive("Build").replace(
      "<plist",
      '<!DOCTYPE plist SYSTEM "example[edition].dtd"><plist',
    );
    expect(() => parseXmlPropertyList(xml)).not.toThrow();
    expect(() =>
      preflightPropertyListDecode(Buffer.from(xml), 16 * 1024 * 1024),
    ).not.toThrow();
  });

  it.each([
    '<!DOCTYPE plist SYSTEM "example>[edition].dtd">',
    "<!DOCTYPE plist SYSTEM 'example>[edition].dtd'>",
    "<?example <!DOCTYPE document [ harmless example ]> ?>",
  ])("consumes quoted or opaque declaration text once: %s", (declaration) => {
    const xml = archive("Build").replace("<plist", `${declaration}<plist`);
    expect(() => parseXmlPropertyList(xml)).not.toThrow();
    expect(
      preflightPropertyListDecode(Buffer.from(xml), 16 * 1024 * 1024)
        .estimatedBytes,
    ).toBeGreaterThan(0);
  });
});

it("retains explicit date uncertainty for an overlapping binary plist object", async () => {
  const root = await createTestTempDirectory("rea-ib-binary-date-overlap-");
  const bundle = join(root, "Example.app");
  await mkdir(bundle);
  const bytes = Buffer.from(
    buildBinary({
      "com.apple.ibtool.document.objects": {
        button: {
          customClass: "UIButton",
          date: new Date(0),
          data: Buffer.alloc(0),
        },
      },
      "com.apple.ibtool.document.connections": {},
      "com.apple.ibtool.document.hierarchy": [],
      "com.apple.ibtool.document.classes": {},
    }),
  );
  const date = scanBinaryPlistScalars(bytes).dates[0];
  if (date === undefined) throw new Error("fixture lost its date");
  const table = readBinaryPlistObjectTableLayout(bytes);
  let dataObjectId: number | undefined;
  for (let objectId = 0; objectId < table.objectCount; objectId += 1) {
    const offset = readBinaryPlistObjectOffset(bytes, table, objectId);
    if (bytes[offset] === 0x40) dataObjectId = objectId;
  }
  if (dataObjectId === undefined)
    throw new Error("fixture lost its empty data");
  // Keep both objects reachable through a recognized archive while sharing source bytes.
  bytes.writeDoubleBE(0.0005, date.offset + 1);
  bytes[date.offset + 2] = 0x40;
  writeBinaryPlistObjectOffset(bytes, table, dataObjectId, date.offset + 2);
  expect(readBinaryPlistObjectOffset(bytes, table, dataObjectId)).toBe(
    date.offset + 2,
  );
  expect(
    preflightPropertyListDecode(bytes, 1024 * 1024, undefined, {
      numberProjection: true,
    }),
  ).toMatchObject({
    datePrecisionOverlapCount: 1,
    reachableDateOffsets: [date.offset],
  });
  await writeFile(join(bundle, "Panel.nib"), bytes);

  const result = await analyzeInterfaceBuilderBundle({
    bundlePath: bundle,
    targetSha256: "a".repeat(64),
  });

  expect(result.documents).toContainEqual(
    expect.objectContaining({
      relative_path: "Panel.nib",
      archive_sha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
  expect(
    result.graph.nodes.find(
      ({ attributes }) => attributes.interface_builder_object_id === "button",
    )?.attributes,
  ).toMatchObject({
    date: { $plist_type: "date", iso8601: null },
    data: { $plist_type: "data", base64: "" },
  });
  expect(result.limitations).toContainEqual(
    expect.stringContaining(
      "Panel.nib: 1 date value(s) are reported with unknown timestamps because their sub-millisecond source records overlap",
    ),
  );
});

it("preserves aliased wide-integer precision and marks the date unknown in bundle output", async () => {
  const root = await createTestTempDirectory("rea-ib-binary-scalar-alias-");
  const bundle = join(root, "Example.app");
  await mkdir(bundle);
  const source = Buffer.from(
    buildBinary({
      "com.apple.ibtool.document.objects": {
        button: {
          customClass: "UIButton",
          wide: Buffer.alloc(16),
          date: new Date(0),
        },
      },
      "com.apple.ibtool.document.connections": {},
      "com.apple.ibtool.document.hierarchy": [],
      "com.apple.ibtool.document.classes": {},
    }),
  );
  const { bytes, integerDecimal } =
    embedSubmillisecondDateInWideIntegerPayload(source);
  await writeFile(join(bundle, "Panel.nib"), bytes);

  const result = await analyzeInterfaceBuilderBundle({
    bundlePath: bundle,
    targetSha256: "a".repeat(64),
  });

  const button = result.graph.nodes.find(
    ({ attributes }) => attributes.interface_builder_object_id === "button",
  );
  expect(button?.attributes).toMatchObject({
    date: { $plist_type: "date", iso8601: null },
    wide: { $plist_type: "integer", decimal: integerDecimal },
  });
});

describe("binary Interface Builder plist dates", () => {
  const control = Buffer.from(
    "62706c6973743030d4010203040506090c5924617263686976657258246f626a656374735424746f70582476657273696f6e5f100f4e534b657965644172636869766572a2070855246e756c6c333fb999999999999ad10a0b54726f6f74800112000186a008111b24293244474d56595e600000000000000101000000000000000d00000000000000000000000000000065",
    "hex",
  );
  const marker = Buffer.alloc(9);
  marker[0] = 0x33;
  marker.writeDoubleBE(0.1, 1);

  const nib = async (bytes: Buffer, name: string) => {
    const root = await createTestTempDirectory(`rea-ib-date-${name}-`);
    const bundle = join(root, "Example.app");
    await mkdir(bundle);
    await writeFile(join(bundle, "Panel.nib"), bytes);
    return analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
    });
  };

  it("refuses an invalid reachable date marker without projecting a timestamp", async () => {
    const bytes = Buffer.from(control);
    const offset = bytes.indexOf(marker);
    bytes[offset] = 0x30;
    const result = await nib(bytes, "marker");
    expect(JSON.stringify(result)).not.toContain("2001-01-01T00:00:00.100Z");
    expect(result.limitations.join("\n")).toContain(
      "binary plist date marker 0x30 is invalid",
    );
  });

  it("counts a sub-millisecond date as unknown and keeps the canonical control known", async () => {
    const submillisecond = Buffer.from(control);
    const offset = submillisecond.indexOf(marker);
    submillisecond.writeDoubleBE(0.1005, offset + 1);
    const unknown = await nib(submillisecond, "subms");
    expect(unknown.limitations).toContain(
      `Panel.nib: ${unknownDateLimitation(1)}`,
    );
    expect(JSON.stringify(unknown)).not.toContain("2001-01-01T00:00:00.100Z");

    const known = await nib(Buffer.from(control), "known");
    expect(known.limitations.join("\n")).not.toContain("date value(s)");
    expect(known.limitations.join("\n")).not.toContain(
      "binary plist date marker",
    );
  });
});
