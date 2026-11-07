import { expect } from "vitest";

import { createCli } from "../../../src/cli.js";

/** Captured CLI invocation for boundary tests. */
export interface ServedCli {
  readonly stdout: string;
  readonly exitCode: number;
}

/** Serve one CLI invocation with captured output and exit code. */
export const serveCli = async (
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = {},
): Promise<ServedCli> => {
  const cli = createCli(environment);
  let stdout = "";
  let exitCode = 0;
  await cli.serve([...argv], {
    env: {},
    exit: (code) => {
      exitCode = code;
    },
    stdout: (text) => {
      stdout += text;
    },
  });
  return { stdout, exitCode };
};

/** A host tool configuration refusal names what to configure, not the target. */
export const expectConfigurationRefusal = (
  result: ServedCli,
  reason: string,
): void => {
  const output = JSON.parse(result.stdout) as {
    code?: unknown;
    message?: unknown;
    remediation?: { action?: unknown };
  };
  expect(output.code).toBe("capability_unavailable");
  expect(output.message).toEqual(expect.stringContaining(reason));
  expect(output.remediation?.action).toEqual(expect.stringContaining(reason));
};
