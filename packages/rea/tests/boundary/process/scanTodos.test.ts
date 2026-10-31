import { execFile } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);

describe("tech-debt marker scan", () => {
  it("passes a clean tree and rejects a tree containing a marker", async () => {
    const root = await createTestTempDirectory("rea-scan-todos-");
    const scripts = join(root, "scripts");
    const source = join(root, "src");
    await Promise.all([mkdir(scripts), mkdir(source)]);
    const scanner = join(scripts, "scan-todos.mjs");
    await copyFile(join(process.cwd(), "scripts/scan-todos.mjs"), scanner);
    await writeFile(join(source, "clean.ts"), "export const clean = true;\n");

    await expect(execute(process.execPath, [scanner])).resolves.toMatchObject({
      stdout: "No tech-debt markers found.\n",
    });

    const marker = `TO${"DO"}`;
    await writeFile(join(scripts, "debt.mts"), `// ${marker}: close the gap\n`);
    await expect(execute(process.execPath, [scanner])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining(`${marker} - close the gap`),
    });
  });
});
