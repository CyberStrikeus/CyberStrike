import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32")(
  "reports unresolvable source and scenario selections without permission advice",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-source-path-failures-");
    await symlink("loop-b", join(root, "loop-a"));
    await symlink("loop-a", join(root, "loop-b"));
    await mkdir(join(root, "valid"));
    await writeFile(
      join(root, "valid", "index.js"),
      "export const value = 1;\n",
    );
    await writeFile(join(root, "file"), "not a directory");

    for (const [path, errno, guidance] of [
      [join(root, "loop-a"), "ELOOP", "symbolic-link"],
      [join(root, "x".repeat(300)), "ENAMETOOLONG", "path-length"],
    ] as const) {
      const result = await cli.run({
        arguments: ["import-reference-source", path, "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        message: expect.stringContaining(errno),
        remediation: { action: expect.stringContaining(guidance) },
        details: { issues: [expect.objectContaining({ path: ["root"] })] },
      });
    }

    const loop = join(root, "loop-a");
    const capture = await cli.run({
      arguments: ["capture-process", loop, "--json"],
    });
    expect(capture.exitCode).toBe(1);
    expect(capture.json).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      message: expect.stringContaining("ELOOP"),
      details: { issues: [expect.objectContaining({ path: ["input_file"] })] },
    });
    expect(JSON.stringify(capture.json)).toContain(loop);
    expect(JSON.stringify(capture.json)).toContain("symbolic-link");

    for (const path of [join(root, "missing"), join(root, "file")]) {
      const result = await cli.run({
        arguments: ["import-reference-source", path, "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        details: {
          operation: "import_reference_source",
          diagnostics: { reference_source_code: "invalid-root" },
          issues: [
            expect.objectContaining({
              path: ["root"],
              reason: "invalid_value",
              message: expect.stringContaining(path),
            }),
          ],
        },
      });
    }
    const valid = await cli.run({
      arguments: ["import-reference-source", join(root, "valid"), "--json"],
    });
    expect(valid.exitCode, valid.stderr).toBe(0);
    expect(valid.json).toMatchObject({
      entries: [expect.objectContaining({ path: "index.js" })],
    });
  },
);
