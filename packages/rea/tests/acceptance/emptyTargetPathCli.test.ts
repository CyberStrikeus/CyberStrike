import { expect } from "vitest";

import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.for(["analyze", "inspect-artifact"])(
  "%s rejects an explicitly empty target before resolving it against cwd",
  async (command, { cli }) => {
    const cwd = await createTestTempDirectory("rea-empty-target-");
    const result = await cli.run({
      arguments: [command, "", "--json"],
      cwd,
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(result.stdout).toContain("path");
    expect(result.stdout).not.toContain("directory_requires_file");
  },
);

cliTest(
  "inspect-artifact still admits an explicitly selected current directory",
  async ({ cli }) => {
    const cwd = await createTestTempDirectory("rea-explicit-target-");
    const result = await cli.run({
      arguments: ["inspect-artifact", ".", "--json"],
      cwd,
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "target_unavailable",
      details: { path: cwd, constraint: "directory_requires_file" },
    });
  },
);
