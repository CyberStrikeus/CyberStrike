import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import { parseCliJsonInput } from "../../src/cliJsonInput.js";
import { logCliCommand } from "../../src/cliLogging.js";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
});

describe("CLI JSON input logging status", () => {
  it("preserves parsed failure diagnostics and logs an error", async () => {
    const parsed = await parseCliJsonInput("{", "test-input");
    if (parsed.ok) throw new Error("Expected malformed inline JSON to fail");
    const value = parsed.error;
    const serialized = JSON.stringify(value);
    const lines: string[] = [];
    const logger = pino(
      { level: "info" },
      { write: (line) => lines.push(line) },
    );
    process.exitCode = undefined;

    const output = await logCliCommand(logger, "test-input", async () => value);

    expect(output).toBe(value);
    expect(JSON.stringify(output)).toBe(serialized);
    expect(process.exitCode).toBe(1);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines.join(""))).toMatchObject({
      level: 50,
      command: "test-input",
      status: "error",
      msg: "CLI command failed",
    });
  });

  it("leaves ordinary parsed JSON successful and unchanged", async () => {
    const parsed = await parseCliJsonInput(
      '{"error":"source data","code":"invalid_request"}',
      "test-input",
    );
    if (!parsed.ok) throw new Error("Expected valid JSON to parse");
    const lines: string[] = [];
    const logger = pino(
      { level: "info" },
      { write: (line) => lines.push(line) },
    );
    process.exitCode = undefined;

    expect(
      await logCliCommand(logger, "test-input", async () => parsed.value),
    ).toBe(parsed.value);
    expect(process.exitCode).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines.join(""))).toMatchObject({
      level: 30,
      status: "ok",
      msg: "CLI command completed",
    });
  });
});
