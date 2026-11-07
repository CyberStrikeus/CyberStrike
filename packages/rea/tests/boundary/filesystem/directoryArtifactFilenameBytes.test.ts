import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { scanArtifactInventory } from "../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform !== "linux")(
  "keeps invalid UTF-8 filenames distinct from a valid U+FFFD sibling",
  async () => {
    const root = await createTestTempDirectory("rea-artifact-filename-bytes-");
    const rawName = Buffer.from([
      0x62, 0x61, 0x64, 0xff, 0x2e, 0x74, 0x78, 0x74,
    ]);
    const rawPath = Buffer.concat([Buffer.from(`${root}/`), rawName]);
    const replacementPath = join(root, "bad\ufffd.txt");
    await Promise.all([
      writeFile(rawPath, "RAW_FILE"),
      writeFile(replacementPath, "UNICODE_FILE"),
      writeFile(join(root, "good.txt"), "GOOD_FILE"),
    ]);

    const inventory = await scanArtifactInventory(root);
    const replacementOccurrences = inventory.occurrences.filter(
      ({ logical_path }) => logical_path === "bad\ufffd.txt",
    );
    expect(replacementOccurrences).toHaveLength(1);
    expect(
      inventory.occurrences.map(({ logical_path }) => logical_path),
    ).toContain("good.txt");
    expect(inventory.coverage.status).toBe("unknown");
    expect(inventory.limitations.join(" ")).toContain(
      `First raw basename bytes: ${rawName.toString("hex")}`,
    );
  },
);
