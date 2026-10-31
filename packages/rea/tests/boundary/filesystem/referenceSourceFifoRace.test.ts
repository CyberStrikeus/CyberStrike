import { fileURLToPath } from "node:url";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

processTest.skipIf(process.platform === "win32")(
  "rejects a FIFO replacing an admitted source file without waiting for a writer",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-reference-fifo-race-");
    const probe = fileURLToPath(
      new URL("../../fixtures/referenceReaderFifoProbe.mjs", import.meta.url),
    );
    const readerModule = fileURLToPath(
      new URL(
        "../../../dist/reference/ReferenceSourceReaderFile.js",
        import.meta.url,
      ),
    );
    const result = await processes.run(
      process.execPath,
      [probe, readerModule, root],
      { timeoutMs: 3_000 },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("changed");
  },
);
