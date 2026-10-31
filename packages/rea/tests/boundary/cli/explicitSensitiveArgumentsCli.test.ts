import { describe, expect } from "vitest";

import { cliTest, type CliResult } from "../../support/cli/cliFixture.js";

const LITERAL = "SYNTHETIC_CAPTURE_LITERAL_83A4";
const CAPTURE = ["inspect-web-network-capture", "/nonexistent/capture.har"];
const DECLARED = [...CAPTURE, "har", "--sensitive-value", LITERAL];

const expectExcluded = (
  result: CliResult,
  literals: readonly string[] = [LITERAL],
): void => {
  expect(result.exitCode).toBe(1);
  for (const literal of literals) {
    expect(result.stdout).not.toContain(literal);
    expect(result.stderr).not.toContain(literal);
  }
};

describe("CLI --sensitive-value parser diagnostics", () => {
  cliTest.for([
    {
      name: "negated unknown flag",
      arguments: [...DECLARED, `--no-unknown-option=${LITERAL}`],
      message: "Unknown flag: --no-unknown-option=[REDACTED]",
    },
    {
      name: "unknown flag name",
      arguments: [...DECLARED, `--${LITERAL}`],
      message: "Unknown flag: --[REDACTED]",
    },
    {
      name: "declaration after the rejected token",
      arguments: [
        ...CAPTURE,
        "har",
        `--no-${LITERAL}`,
        `--sensitive-value=${LITERAL}`,
      ],
      message: "Unknown flag: --no-[REDACTED]",
    },
    {
      name: "camel-case declaration",
      arguments: [
        ...CAPTURE,
        "har",
        `--sensitiveValue=${LITERAL}`,
        `--no-${LITERAL}`,
      ],
      message: "Unknown flag: --no-[REDACTED]",
    },
    {
      // Incur removes builtin output flags before reading the declared value.
      name: "builtin flag before the declared value",
      arguments: [
        ...CAPTURE,
        "har",
        "--sensitive-value",
        "--json",
        LITERAL,
        `--no-${LITERAL}`,
      ],
      message: "Unknown flag: --no-[REDACTED]",
    },
  ])(
    "excludes declarations from a JSON $name rejection",
    async ({ arguments: arguments_, message }, { cli }) => {
      const result = await cli.run({ arguments: [...arguments_, "--json"] });

      expectExcluded(result);
      expect(JSON.parse(result.stdout)).toEqual({ code: "UNKNOWN", message });
    },
  );

  cliTest(
    "redacts fixed parser text but keeps JSON keys and codes",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: [
          ...CAPTURE,
          "har",
          ...["flag", "code", "UNKNOWN"].flatMap((literal) => [
            "--sensitive-value",
            literal,
          ]),
          "--no-x",
          "--json",
        ],
      });

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({
        code: "UNKNOWN",
        message: "Unknown [REDACTED]: --no-x",
      });
    },
  );

  cliTest(
    "excludes declarations from validation text while keeping field errors",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: [
          ...CAPTURE,
          "bogus",
          "--sensitive-value",
          "mitmproxy",
          "--json",
        ],
      });

      expectExcluded(result, ["mitmproxy"]);
      expect(JSON.parse(result.stdout)).toMatchObject({
        code: "VALIDATION_ERROR",
        message:
          "REA could not read the command arguments. Check the named argument and its expected type, then try again.",
        fieldErrors: [
          expect.objectContaining({ code: "invalid_value", path: "format" }),
        ],
      });
    },
  );

  cliTest(
    "retains undeclared tokens and declared values that the parser accepts",
    async ({ cli }) => {
      const undeclared = await cli.run({
        arguments: [...CAPTURE, "har", `--no-${LITERAL}`, "--json"],
      });
      expect(undeclared.exitCode).toBe(1);
      expect(JSON.parse(undeclared.stdout)).toEqual({
        code: "UNKNOWN",
        message: `Unknown flag: --no-${LITERAL}`,
      });

      // An accepted output value is honored, so the service failure is JSON.
      const accepted = await cli.run({
        arguments: [
          ...CAPTURE,
          "har",
          "--sensitive-value",
          "json",
          "--format",
          "json",
        ],
      });
      expect(accepted.exitCode).toBe(1);
      expect(JSON.parse(accepted.stdout)).toMatchObject({
        code: "invalid_request",
      });
    },
  );
});

describe("CLI --sensitive-value output-value diagnostics", () => {
  cliTest.for([
    {
      name: "a spaced --format value",
      arguments: [...DECLARED, "--format", LITERAL],
      message: 'Invalid format: "[REDACTED]"',
    },
    {
      name: "an equals-form --format value",
      arguments: [...DECLARED, `--format=${LITERAL}`],
      message: 'Invalid format: "[REDACTED]"',
    },
    {
      name: "a --token-limit value",
      arguments: [...DECLARED, "--token-limit", LITERAL],
      message: 'Invalid value for --token-limit: "[REDACTED]"',
    },
    {
      name: "a partially declared --token-offset value",
      arguments: [...DECLARED, "--token-offset", `1${LITERAL}`],
      message: 'Invalid value for --token-offset: "1[REDACTED]"',
    },
  ])(
    "keeps rejecting $name without the declaration",
    async ({ arguments: arguments_, message }, { cli }) => {
      const result = await cli.run({ arguments: arguments_ });

      expectExcluded(result);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        error: {
          code: "INVALID_OUTPUT_VALUE",
          message: expect.stringContaining(message),
        },
      });
    },
  );

  cliTest(
    "rejects an output value that would be accepted once declarations are removed",
    async ({ cli }) => {
      const declared = ["X", "[REDACTED]", "…"];
      const result = await cli.run({
        arguments: [
          ...CAPTURE,
          "har",
          ...declared.flatMap((literal) => ["--sensitive-value", literal]),
          "--token-limit",
          "12X",
        ],
      });

      expectExcluded(result, declared);
      expect(result.stdout).toContain("Invalid value for --token-limit:");
    },
  );

  cliTest.for([
    {
      name: "flag-name and value",
      declared: ["token"],
      arguments: ["--token-limit", "token"],
      message: 'Invalid value for --[REDACTED]-limit: "[REDACTED]"',
    },
    {
      name: "overlapping",
      declared: ["tok", "token"],
      arguments: ["--token-offset", "token1"],
      message: 'Invalid value for --[REDACTED]-offset: "[REDACTED]1"',
    },
    {
      name: "fixed-text",
      declared: ["Invalid", "Expected"],
      arguments: ["--format", "bogus"],
      message:
        '[REDACTED] format: "bogus". [REDACTED] one of: toon, json, yaml, md, jsonl',
    },
    {
      // Codes and keys identify the contract, not caller text.
      name: "code and key",
      declared: ["UNKNOWN", "code", "message"],
      arguments: ["--format", "bogus"],
      message:
        'Invalid format: "bogus". Expected one of: toon, json, yaml, md, jsonl',
    },
  ])(
    "redacts the whole rejected output message for $name declarations",
    async ({ declared, arguments: arguments_, message }, { cli }) => {
      const result = await cli.run({
        arguments: [
          ...CAPTURE,
          "har",
          ...declared.flatMap((literal) => ["--sensitive-value", literal]),
          ...arguments_,
        ],
      });

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        error: {
          code: "INVALID_OUTPUT_VALUE",
          message: expect.stringContaining(message),
        },
      });
    },
  );

  cliTest.for([
    ["--format", "bogus"],
    ["--token-limit=x"],
    ["--token-offset", " "],
  ])(
    "renders the same structured %s rejection with an unrelated declaration",
    async (arguments_, { cli }) => {
      const command = [...CAPTURE, "har", ...arguments_];
      const incur = await cli.run({ arguments: command });
      const declared = await cli.run({
        arguments: [...command, "--sensitive-value", "unused"],
      });

      expect(incur.exitCode).toBe(1);
      expect(declared).toMatchObject({
        exitCode: incur.exitCode,
        stdout: incur.stdout,
        stderr: incur.stderr,
      });
    },
  );
});
