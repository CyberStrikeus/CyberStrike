import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/boundary/providers/CutterBridgeClient.test.ts",
      "tests/boundary/providers/RizinCommandTimeout.test.ts",
      "tests/boundary/providers/RizinTimeoutEvidence.test.ts",
      "tests/boundary/mcp/rizinPendingOutput.test.ts",
    ],
    pool: "forks",
    maxWorkers: 2,
    retry: 0,
    testTimeout: 60_000,
    runner: "./tests/processOwnershipRunner.ts",
  },
});
