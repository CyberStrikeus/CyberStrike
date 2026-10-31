import { readlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32").for([
  { command: "inspect-artifact", link: "loop.db", selected: "loop.db" },
  { command: "extract-artifact", link: "tree", selected: join("tree", "file") },
])(
  "$command reports a stable symbolic link loop as a path resolution failure",
  async ({ command, link, selected }, { cli }) => {
    const root = await createTestTempDirectory("rea-artifact-symlink-loop-");
    await symlink(link, join(root, link));
    const path = join(root, selected);
    const result = await cli.run({
      arguments: [command, path, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(result.exitCode).toBe(1);
    const reason = expect.stringMatching(
      /^target path could not be resolved: too many symbolic links or a symbolic link loop: ELOOP/u,
    );
    expect(result.json).toMatchObject({
      code: "target_unavailable",
      category: "unavailable",
      retryable: false,
      message: expect.stringContaining("symbolic link loop"),
      details: { path, reason },
    });
    expect(result.stdout).not.toContain("changed while being opened");
    expect(await readlink(join(root, link))).toBe(link);
  },
);
