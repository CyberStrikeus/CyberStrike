import { copyFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const environment = {
  REA_LOG_LEVEL: "silent",
  REA_ANALYSIS_PROVIDER: "auto",
} as const;

/** Copy a host program to serve as the evidence-identity artifact. */
const evidenceTarget = async () => {
  const path = join(await createTestTempDirectory("rea-demangle-"), "tool");
  await copyFile("/usr/bin/true", path);
  return path;
};

describe("Swift demangling CLI with line-terminator characters", () => {
  cliTest.skipIf(process.platform !== "darwin")(
    "keeps a carriage return in the symbol",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: [
          "demangle-swift",
          await evidenceTarget(),
          "$s4main3FooV",
          "carriage\r",
          "--json",
        ],
        environment,
      });
      expect(result.exitCode).toBe(0);
      expect(result.json).toMatchObject({
        normalized_result: {
          symbols: [
            { input: "$s4main3FooV", output: "main.Foo", status: "demangled" },
            { input: "carriage\r", output: "carriage\r", status: "unchanged" },
          ],
        },
      });
    },
  );

  cliTest("rejects a symbol spanning lines as input", async ({ cli }) => {
    const missingTarget = join(
      await createTestTempDirectory("rea-demangle-invalid-input-"),
      "absent",
    );
    const result = await cli.run({
      arguments: [
        "demangle-swift",
        missingTarget,
        "$s4main3FooV",
        "$s4main\n3FooV",
        "--json",
      ],
      environment,
      timeoutMs: 20_000,
    });
    expect(result.signal).toBeNull();
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: expect.arrayContaining([
        expect.objectContaining({ path: "symbols.1", missing: false }),
      ]),
    });
  });
});
