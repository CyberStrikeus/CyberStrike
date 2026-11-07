import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "identifies the missing companion option for firmware range input",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-firmware-incomplete-range-",
    );
    const firmware = join(root, "firmware.bin");
    await writeFile(firmware, new Uint8Array());
    const output = join(root, "extracted");
    const cases = [
      { option: "--offset", missing: "length" },
      { option: "--length", missing: "offset" },
    ] as const;

    for (const { option, missing } of cases) {
      const result = await cli.run({
        arguments: [
          "extract-firmware",
          firmware,
          output,
          option,
          "5",
          "--json",
        ],
        cwd: root,
      });
      expect(result.exitCode).toBe(1);
      expect(analysisErrorProjectionSchema.safeParse(result.json).success).toBe(
        true,
      );
      expect(result.json).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        retryable: false,
        details: {
          operation: "extract_firmware",
          issues: [
            {
              path: ["range", missing],
              reason: "missing_argument",
            },
          ],
        },
      });
    }
  },
);
