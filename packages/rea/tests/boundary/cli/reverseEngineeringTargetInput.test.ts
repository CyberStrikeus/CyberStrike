import { join } from "node:path";

import { expect } from "vitest";

import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "reports missing and directory objdump inputs with structured reasons",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-objdump-invalid-target-");
    const missing = join(root, "missing.bin");
    const directory = root;

    for (const [path, expectedReason] of [
      [missing, "not found"],
      [directory, "not a regular file"],
    ] as const) {
      const result = await cli.run({
        arguments: [
          "inspect-with-objdump",
          path,
          "symbols",
          "--format",
          "json",
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
        message: expect.stringContaining(path),
        details: {
          operation: "inspect_with_objdump",
          issues: [
            {
              path: ["path"],
              reason: "invalid_value",
              message: expect.stringContaining(expectedReason),
            },
          ],
        },
      });
    }
  },
);

cliTest(
  "reports the rejected Rizin command before inspecting the target",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-rizin-invalid-command-");
    const result = await cli.run({
      arguments: [
        "execute-rizin-command",
        join(root, "unopened.bin"),
        "iI\nq",
        "--format",
        "json",
      ],
      cwd: root,
    });
    expect(result.exitCode).toBe(1);
    expect(analysisErrorProjectionSchema.parse(result.json)).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "execute_rizin_command",
        issues: [
          {
            path: ["command"],
            reason: "invalid_value",
            message: "A single command line is required",
          },
        ],
      },
    });
  },
);
