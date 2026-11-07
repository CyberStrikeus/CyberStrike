import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

cliTest.for([
  { pattern: "??", mask: undefined, field: "pattern" },
  { pattern: "ZZ", mask: undefined, field: "pattern" },
  { pattern: "", mask: undefined, field: "pattern" },
  { pattern: "AB", mask: "FFFF", field: "mask" },
])(
  "reports query correction before target refusal ($pattern/$mask)",
  async ({ pattern, mask, field }, { cli }) => {
    const root = await createTestTempDirectory("rea-byte-admission-");
    const text = join(root, "text.bin");
    await writeFile(text, "hello world");
    for (const path of [text, join(root, "missing")]) {
      const result = await cli.run({
        arguments: [
          "search-bytes",
          path,
          pattern,
          ...(mask === undefined ? [] : ["--mask", mask]),
          "--json",
        ],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        details: {
          issues: [
            expect.objectContaining({ path: [field], reason: "invalid_value" }),
          ],
        },
      });
    }
  },
);

cliTest("keeps target admission for a valid byte query", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-byte-valid-");
  const path = join(root, "text.bin");
  await writeFile(path, "hello world");
  const result = await cli.run({
    arguments: ["search-bytes", path, "AB", "--json"],
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "target_unavailable",
    category: "unsupported_target",
  });
});
