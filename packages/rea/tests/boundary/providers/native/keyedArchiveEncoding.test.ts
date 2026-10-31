import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildBinary, parse } from "plist";
import { expect, it } from "vitest";

import { inspectBundleKeyedArchive } from "../../../../src/artifacts/apple/KeyedArchiveReader.js";
import { nativeFixture } from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

it.each(["utf8", "utf8-bom", "utf16le", "utf16be", "binary"] as const)(
  "reads the same captured Foundation graph encoded as %s",
  async (encoding) => {
    const root = await createTestTempDirectory("rea-keyed-encoding-");
    const xml = await nativeFixture("archive-xml-encoding/archive.xml");
    const utf16 = Buffer.from(xml.replace("UTF-8", "UTF-16"), "utf16le");
    // The binary builder emits type-8 records for UID; CF$UID is XML's convention.
    const binarySource = xml.replaceAll("<key>CF$UID</key>", "<key>UID</key>");
    const bytes =
      encoding === "utf8"
        ? Buffer.from(xml)
        : encoding === "utf8-bom"
          ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xml)])
          : encoding === "binary"
            ? Buffer.from(buildBinary(parse(binarySource)))
            : Buffer.concat([
                Buffer.from(
                  encoding === "utf16le" ? [0xff, 0xfe] : [0xfe, 0xff],
                ),
                encoding === "utf16le" ? utf16 : utf16.swap16(),
              ]);
    await writeFile(join(root, "archive.plist"), bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const result = await inspectBundleKeyedArchive({
      bundlePath: root,
      targetSha256: digest,
      parameters: { path: "archive.plist", offset: 0, limit: 100 },
    });
    expect(result.archive_sha256).toBe(digest);
    expect(result.archive_format).toBe(
      encoding === "binary" ? "binary-plist" : "xml-plist",
    );
    expect(result.objects).toContainEqual(
      expect.objectContaining({ value: "Café" }),
    );
    expect(
      result.references.some((reference) => reference.status === "resolved"),
    ).toBe(true);
  },
);

it("rejects an incomplete UTF-16 code unit instead of substituting text", async () => {
  const root = await createTestTempDirectory("rea-keyed-encoding-");
  await writeFile(join(root, "archive.plist"), Buffer.from([0xff, 0xfe, 0x3c]));
  await expect(
    inspectBundleKeyedArchive({
      bundlePath: root,
      targetSha256: "a".repeat(64),
      parameters: { path: "archive.plist" },
    }),
  ).rejects.toMatchObject({ reason: "format" });
});

it.each(["utf8-as-utf16", "utf16-as-utf8"] as const)(
  "rejects contradictory XML declaration %s",
  async (kind) => {
    const root = await createTestTempDirectory("rea-keyed-encoding-");
    const xml = await nativeFixture("archive-xml-encoding/archive.xml");
    // The binary builder emits type-8 records for UID; CF$UID is XML's convention.
    const binarySource = xml.replaceAll("<key>CF$UID</key>", "<key>UID</key>");
    const bytes =
      kind === "utf8-as-utf16"
        ? Buffer.from(xml.replace("UTF-8", "UTF-16"))
        : Buffer.concat([
            Buffer.from([0xff, 0xfe]),
            Buffer.from(xml, "utf16le"),
          ]);
    await writeFile(join(root, "archive.plist"), bytes);
    await expect(
      inspectBundleKeyedArchive({
        bundlePath: root,
        targetSha256: "a".repeat(64),
        parameters: { path: "archive.plist" },
      }),
    ).rejects.toMatchObject({ reason: "format" });
  },
);
