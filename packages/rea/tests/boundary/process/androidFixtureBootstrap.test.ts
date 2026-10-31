import { fileURLToPath } from "node:url";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import { processTest } from "../../support/process/processFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

processTest(
  "loads the Android fixture fetcher before build or dependency installation",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-android-bootstrap-");
    // Copy the actual bootstrap inputs into a checkout without dist or
    // node_modules so an installed dependency cannot hide a new coupling.
    for (const path of [
      "scripts/fixtures/android/fetch.mjs",
      "scripts/fixtures/android/apidemos.json",
      "src/android/JadxRelease.ts",
    ]) {
      const destination = join(root, path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(
        fileURLToPath(new URL(`../../../${path}`, import.meta.url)),
        destination,
      );
    }
    const entry = join(root, "scripts/fixtures/android/fetch.mjs");
    // Invalid arguments stop before downloads while exercising Node's real
    // source-module loading, without Vitest's .js-to-.ts resolution.
    const result = await processes.run(
      process.execPath,
      [entry, "extra", "argument"],
      { timeoutMs: 10000 },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Usage: npm run fixtures:android -- [DIRECTORY]",
    );
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  },
);
