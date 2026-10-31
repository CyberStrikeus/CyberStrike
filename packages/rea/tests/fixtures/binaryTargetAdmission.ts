import assert from "node:assert/strict";
import type { parseBinaryTarget } from "../../src/application/BinaryTargetResolver.js";
import { BinaryTargetError } from "../../src/domain/configurationErrors.js";

/** Require target admission failure rather than an unrelated cancellation. */
export const expectBinaryTargetError = (
  result: Awaited<ReturnType<typeof parseBinaryTarget>>,
): BinaryTargetError => {
  assert.ok(!result.ok, "Expected target admission to fail");
  assert.ok(
    result.error instanceof BinaryTargetError,
    "Expected a target admission error",
  );
  return result.error;
};
