import { describe, expect } from "vitest";

import { cliTest } from "../../support/cli/cliFixture.js";
import type { TestCli } from "../../support/cli/cliFixture.js";

const runCapture = async (cli: TestCli, steps: string | undefined) => {
  const arguments_ = [
    "capture-native-ui-scenario",
    "/provider-must-not-be-invoked",
    "--pid",
    "1",
    "--window-id",
    "1",
  ];
  if (steps !== undefined) arguments_.push("--steps", steps);
  arguments_.push("--json");
  return cli.run({
    arguments: arguments_,
    environment: { REA_LOG_LEVEL: "silent" },
  });
};

describe("native UI scenario CLI input", () => {
  cliTest(
    "rejects omitted steps at CLI argument admission",
    async ({ cli }) => {
      const result = await runCapture(cli, undefined);

      expect(result.exitCode).not.toBe(0);
      expect(result.json).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: [
          expect.objectContaining({ path: "steps", missing: true }),
        ],
      });
    },
  );

  cliTest("rejects malformed JSON as invalid input", async ({ cli }) => {
    const result = await runCapture(cli, "[");

    expect(result.exitCode).not.toBe(0);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "capture_native_ui_scenario",
        issues: [
          {
            path: ["steps"],
            reason: "invalid_format",
            expected: "JSON",
          },
        ],
      },
    });
  });

  cliTest(
    "requires at least one schema-valid scenario step",
    async ({ cli }) => {
      const result = await runCapture(cli, "[]");

      expect(result.exitCode).not.toBe(0);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "capture_native_ui_scenario",
          issues: [{ path: ["steps"], reason: "out_of_range", minimum: 1 }],
        },
      });
    },
  );

  cliTest(
    "refuses scenario steps on passive observation instead of dropping them",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: [
          "observe-native-ui",
          "/provider-must-not-be-invoked",
          "--pid",
          "1",
          "--window-id",
          "1",
          "--steps",
          '[{"kind":"wait","milliseconds":0}]',
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toContain("Unknown flag: --steps");
    },
  );
});
