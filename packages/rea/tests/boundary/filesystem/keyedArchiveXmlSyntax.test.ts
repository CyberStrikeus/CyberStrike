import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "plist";
import { expect, it } from "vitest";
import { inspectBundleKeyedArchive } from "../../../src/artifacts/apple/KeyedArchiveReader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const archive = build({
  $archiver: "NSKeyedArchiver",
  $version: 100000,
  $objects: ["$null", "value"],
  $top: { root: { UID: 1 } },
});

it.each([
  {
    name: "unquoted attribute",
    xml: archive.replace('version="1.0">', "version=1.0>"),
  },
  {
    name: "undeclared entity",
    xml: archive.replace(
      "<string>value</string>",
      "<string>&unknown;</string>",
    ),
  },
  {
    name: "forbidden character reference",
    xml: archive.replace("<string>value</string>", "<string>&#0;</string>"),
  },
  {
    name: "forbidden literal character",
    xml: archive.replace("<string>value</string>", "<string>\u0000</string>"),
  },
])("refuses $name before registering archive observations", async ({ xml }) => {
  const root = await createTestTempDirectory("rea-keyed-xml-syntax-");
  await writeFile(join(root, "Archive.plist"), xml);
  await expect(
    inspectBundleKeyedArchive({
      bundlePath: root,
      targetSha256: "a".repeat(64),
      parameters: { path: "Archive.plist" },
    }),
  ).rejects.toMatchObject({
    reason: "format",
    cause: { _tag: "XmlDocumentParseError", reason: "malformed" },
  });
});

it("preserves valid Unicode, entity values and original archive identities", async () => {
  const root = await createTestTempDirectory("rea-keyed-xml-valid-");
  await writeFile(
    join(root, "Archive.plist"),
    archive.replace("<string>value</string>", "<string>� &amp; &#13;</string>"),
  );
  const result = await inspectBundleKeyedArchive({
    bundlePath: root,
    targetSha256: "a".repeat(64),
    parameters: { path: "Archive.plist", offset: 1, limit: 1 },
  });
  expect(result.roots).toEqual({ root: { UID: 1 } });
  expect(result.objects).toEqual([
    expect.objectContaining({ id: 1, status: "observed", value: "� & \r" }),
  ]);
  expect(result.total_objects).toBe(2);
  expect(result.next_offset).toBeNull();
  expect(result.truncated).toBe(true);
});
