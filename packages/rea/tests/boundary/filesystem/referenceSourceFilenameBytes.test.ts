import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { readReferenceSource } from "../../../src/reference/ReferenceSourceReader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform !== "linux")(
  "does not read an invalid UTF-8 directory name through its replacement-character sibling",
  async () => {
    const root = await createTestTempDirectory("rea-reference-filename-bytes-");
    const rawName = Buffer.from([0x62, 0x61, 0x64, 0xff, 0x2e, 0x6a, 0x73]);
    const rawPath = Buffer.concat([Buffer.from(`${root}/`), rawName]);
    const replacementPath = join(root, "bad\ufffd.js");
    await Promise.all([
      writeFile(rawPath, "RAW_FILE"),
      writeFile(replacementPath, "UNICODE_FILE"),
      writeFile(join(root, "good.js"), "GOOD_FILE"),
    ]);

    const resources = new ArtifactResourceScope();
    try {
      const result = await readReferenceSource(root, resources);
      if (!result.ok) throw result.error;
      expect(result.value.rootFailure).toMatchObject({
        code: "unsupported",
        message: expect.stringContaining(
          `First raw basename bytes: ${rawName.toString("hex")}`,
        ),
      });
      expect(result.value.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "read",
            kind: "file",
            path: "bad\ufffd.js",
            size: 12,
            bytes: Buffer.from("UNICODE_FILE"),
          }),
          expect.objectContaining({
            status: "read",
            kind: "file",
            path: "good.js",
            size: 9,
            bytes: Buffer.from("GOOD_FILE"),
          }),
        ]),
      );
      expect(
        result.value.entries.filter(
          (entry) => entry.kind === "file" && entry.path === "bad\ufffd.js",
        ),
      ).toHaveLength(1);
      expect(result.value.bytesRead).toBe(
        "UNICODE_FILE".length + "GOOD_FILE".length,
      );
    } finally {
      await resources.close();
    }
  },
);
