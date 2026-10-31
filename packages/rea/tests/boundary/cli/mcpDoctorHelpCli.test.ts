import { describe, expect } from "vitest";

import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";

const CLI_INTEGRATION_TIMEOUT_MS = 60_000;

describe("MCP doctor help boundary", () => {
  workspaceCliTest(
    "answers the advertised help option instead of validating it",
    async ({ cli }) => {
      const parent = await cli.run({ arguments: ["mcp", "--help"] });
      expect(parent.exitCode).toBe(0);
      expect(parent.stdout).toContain("doctor");
      for (const argument of ["--help", "-h"]) {
        const result = await cli.run({
          arguments: ["mcp", "doctor", argument],
        });
        expect(result).toMatchObject({ exitCode: 0 });
        expect(result.stdout).toContain("Usage: rea mcp doctor [options]");
        expect(result.stdout).toContain("--format <toon|json|yaml|md|jsonl>");
        expect(result.stdout).toContain("--full-output");
        expect(result.stdout).toContain("current runtime");
        expect(result.stdout).toContain(
          "registered command or launch environment",
        );
        // Help returns before the diagnostic session starts, so no report
        // envelope and no startup diagnostics are produced.
        expect(result.stdout).not.toContain("healthy");
        expect(result.stderr).toBe("");
      }
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "answers help in option position regardless of surrounding output options",
    async ({ cli }) => {
      for (const arguments_ of [
        ["mcp", "doctor", "--json", "--help"],
        ["mcp", "doctor", "--format", "bogus", "--help"],
        ["mcp", "doctor", "--help", "--format", "json"],
      ]) {
        const result = await cli.run({ arguments: arguments_ });
        expect(result).toMatchObject({ exitCode: 0 });
        expect(result.stdout).toContain("Usage: rea mcp doctor [options]");
        expect(result.stdout).toContain("--help, -h");
        expect(result.stdout).not.toContain("healthy");
      }
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "treats help consumed as --format value as an invalid format, not help",
    async ({ cli }) => {
      for (const arguments_ of [
        ["mcp", "doctor", "--format", "--help"],
        ["mcp", "doctor", "--format", "-h"],
        ["mcp", "doctor", "--format=--help"],
      ]) {
        const result = await cli.run({ arguments: arguments_ });
        expect(result).toMatchObject({ exitCode: 1 });
        expect(result.stdout).toContain("Invalid output format:");
        expect(result.stdout).not.toContain("Usage: rea mcp doctor");
      }
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "keeps the actionable error for a genuinely unknown option",
    async ({ cli }) => {
      const result = await cli.run({ arguments: ["mcp", "doctor", "--bogus"] });
      expect(result).toMatchObject({
        exitCode: 1,
        stdout:
          'code: VALIDATION_ERROR\nmessage: "Unknown mcp doctor option: --bogus"\n',
      });
      const invalid = await cli.run({
        arguments: ["mcp", "doctor", "--format", "bogus"],
      });
      expect(invalid).toMatchObject({
        exitCode: 1,
        stdout:
          'code: VALIDATION_ERROR\nmessage: "Invalid output format: bogus"\n',
      });
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "reports an absent or empty --format value as a missing output value",
    async ({ cli }) => {
      const message =
        "--format requires a value, as in --format <value> or --format=<value>.";
      for (const arguments_ of [
        ["mcp", "doctor", "--format"],
        ["mcp", "doctor", "--format="],
      ]) {
        const result = await cli.run({ arguments: arguments_ });
        expect(result).toMatchObject({
          exitCode: 1,
          stdout: `code: MISSING_OUTPUT_VALUE\nmessage: "${message}"\n`,
        });
      }
      for (const arguments_ of [
        ["mcp", "doctor", "--json", "--format"],
        ["mcp", "doctor", "--json", "--format="],
      ]) {
        const result = await cli.run({ arguments: arguments_ });
        expect(result.exitCode).toBe(1);
        expect(JSON.parse(result.stdout)).toEqual({
          code: "MISSING_OUTPUT_VALUE",
          message,
        });
      }
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "reports doctor timing on stderr while preserving JSON output",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: ["mcp", "doctor", "--json", "--timings"],
      });
      expect([0, 1]).toContain(result.exitCode);
      expect(JSON.parse(result.stdout)).toHaveProperty("healthy");
      const lines = result.stderr.trim().split("\n");
      expect(lines).toHaveLength(1);
      const record: unknown = JSON.parse(lines[0]!);
      expect(record).toMatchObject({
        rea_timings: { version: 1, command_ms: expect.any(Number) },
      });
      const duration = (record as { rea_timings: { command_ms: number } })
        .rea_timings.command_ms;
      expect(Number.isFinite(duration)).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(0);
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );

  workspaceCliTest(
    "does not treat a --format value as the timing flag",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: ["mcp", "doctor", "--format", "--timings"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Invalid output format: --timings");
      expect(result.stderr).toBe("");
    },
    CLI_INTEGRATION_TIMEOUT_MS,
  );
});
