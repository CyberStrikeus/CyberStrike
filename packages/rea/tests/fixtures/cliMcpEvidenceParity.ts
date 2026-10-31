import { expect } from "vitest";
import { parseEvidence } from "../../src/domain/evidence.js";

/** Compare complete Evidence while asserting the CLI-only caller spelling. */
export const expectCliMcpEvidenceParity = (
  cli: unknown,
  mcp: unknown,
  callerPath: string,
): void => {
  const { caller_input_path: callerInputPath, ...shared } = parseEvidence(cli);
  expect(callerInputPath).toBe(callerPath);
  expect(mcp).not.toHaveProperty("caller_input_path");
  expect(mcp).toEqual(shared);
};
