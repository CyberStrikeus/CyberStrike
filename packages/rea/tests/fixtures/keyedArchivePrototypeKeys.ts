import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { keyedArchiveResultSchema } from "../../src/domain/apple/keyedArchive.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

/** Inert XML with producer-equivalent key spellings and unchanged ordinary data. */
export const keyedArchivePrototypeKeyFixture = async () => {
  const directory = await createTestTempDirectory("rea-keyed-xml-keys-");
  const path = join(directory, "archive.plist");
  const bytes = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>$archiver</key><string>NSKeyedArchiver</string>
  <key>$version</key><integer>100000</integer>
  <key>$objects</key><array><string>$null</string><dict>
    <key >__proto__</key ><string>recorded outer value</string>
    <key>kept</key><string>a&#13;b&#x85;c&#x2028;d</string>
    <key>&#95;&#95;rea_prototype_key__</key><string>ordinary key</string>
    <key>nested</key><dict>
      <key><![CDATA[__proto__]]><!-- trailing comment --></key>
      <string>recorded nested value</string>
      <key>value</key><integer>7</integer>
    </dict>
  </dict></array>
  <key>$top</key><dict><key>__proto__</key><dict><key>CF$UID</key><integer>1</integer></dict><key>root</key><dict>
    <key>CF$UID</key><integer>1</integer>
  </dict></dict>
</dict></plist>`);
  await writeFile(path, bytes);
  return { path, digest: createHash("sha256").update(bytes).digest("hex") };
};

/** Require original source identity and every decoded dictionary member. */
export const expectKeyedArchivePrototypeKeys = (
  value: unknown,
  digest: string,
) => {
  const result = keyedArchiveResultSchema.parse(value);
  expect(result.archive_sha256).toBe(digest);
  expect(result.roots).toEqual({
    ["__proto__"]: { CF$UID: 1 },
    root: { CF$UID: 1 },
  });
  expect(Object.hasOwn(result.roots, "__proto__")).toBe(true);
  expect(result.references).toContainEqual(
    expect.objectContaining({
      source: null,
      path: ["__proto__"],
      target: 1,
      status: "resolved",
    }),
  );
  expect(result.objects).toHaveLength(2);
  expect(result.objects[1]).toMatchObject({
    id: 1,
    kind: "dictionary",
    value: {
      ["__proto__"]: "recorded outer value",
      kept: "a\rb\u0085c\u2028d",
      __rea_prototype_key__: "ordinary key",
      nested: { ["__proto__"]: "recorded nested value", value: 7 },
    },
  });
  expect(
    result.limitations.some((value) => value.includes("keyed __proto__")),
  ).toBe(false);
};
