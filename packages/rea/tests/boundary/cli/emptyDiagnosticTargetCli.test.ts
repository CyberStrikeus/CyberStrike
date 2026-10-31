import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["inspect-apple-ips", "inspect-pe-imports"])(
  "rejects an empty %s target before resolving the working directory",
  async (command, { cli }) => {
    const root = await createTestTempDirectory("rea-empty-diagnostic-target-");
    // docs/cli.md: an empty string never selects the working directory.
    const empty = await cli.run({
      arguments: [command, "", "--json"],
      cwd: root,
    });
    expect(empty.exitCode).not.toBe(0);
    expect(empty.json).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [
        expect.objectContaining({ path: "path", code: "too_small" }),
      ],
    });
    // Explicit "." still selects the directory, which the inspection refuses.
    const explicit = await cli.run({
      arguments: [command, ".", "--json"],
      cwd: root,
    });
    expect(explicit.exitCode).not.toBe(0);
    expect(explicit.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          expect.objectContaining({ path: ["path"], reason: "invalid_format" }),
        ],
      },
    });
  },
);
