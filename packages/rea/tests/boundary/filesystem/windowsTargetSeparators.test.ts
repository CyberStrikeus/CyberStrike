import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { pe } from "../../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Windows native snapshot admission rejects empty and forward-slash path
// components, so the caller path it receives must already be one canonical
// drive path whatever separator spelling the caller used (#4707).
it.runIf(process.platform === "win32")(
  "hands native admission one drive path for every separator spelling",
  async () => {
    const directory = await createTestTempDirectory("rea-win-separators-");
    const path = join(directory, "image.exe");
    await writeFile(path, pe(0x8664));
    const spellings = [
      path,
      path.replaceAll("\\", "/"),
      path.replaceAll("\\", "\\\\"),
      path.replaceAll("\\", "//"),
    ];
    for (const spelling of spellings) {
      const target = await parseBinaryTarget(spelling);
      expect(target.ok, spelling).toBe(true);
      if (target.ok) expect(target.value.sourcePath, spelling).toBe(path);
    }
  },
);
