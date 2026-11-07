import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

processTest(
  "reports the original website translation import failure at the startup boundary",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-website-initialization-");
    const main = join(root, "main.mjs");
    await Promise.all([
      copyFile(
        fileURLToPath(
          new URL("../../../website/public/assets/main.js", import.meta.url),
        ),
        main,
      ),
      writeFile(join(root, "package.json"), '{"type":"module"}\n'),
      writeFile(
        join(root, "i18n.js"),
        "throw globalThis.translationFailure;\n",
      ),
    ]);
    // Execute the public startup code; this does not exercise browser DOM behavior.
    const source = `
import assert from "node:assert/strict";
globalThis.translationFailure = new Error("selected translation import failed");
const reported = new Promise((resolve) => {
  console.error = (...arguments_) => resolve(arguments_);
});
await import(${JSON.stringify(pathToFileURL(main).href)});
const [message, cause] = await reported;
assert.equal(message, "Website initialization failed");
assert.equal(cause, globalThis.translationFailure);
`;
    const result = await processes.run(
      process.execPath,
      ["--input-type=module", "--eval", source],
      { timeoutMs: 10_000 },
    );
    expect(result.signal, result.stderr).toBeNull();
    expect(result.exitCode, result.stderr).toBe(0);
  },
);
