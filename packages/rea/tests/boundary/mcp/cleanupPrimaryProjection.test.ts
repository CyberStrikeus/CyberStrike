import { expect, it, onTestFinished } from "vitest";
import { AnalysisCleanupLease } from "../../../src/artifacts/AnalysisCleanupLease.js";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import { analysisErrorWithCleanupFailure } from "../../../src/domain/analysisErrorCleanup.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { err } from "../../../src/domain/result.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

it("restores the primary error after exact cleanup retry through the same MCP connection", async () => {
  const primary = new AnalysisInputError("inspect_adb_window", undefined, [
    {
      path: ["serial"],
      reason: "invalid_value",
      message: "fixture input refused",
    },
  ]);
  const cleanup = new ProviderCleanupError(
    "fixture",
    ["selected-input"],
    { reason: "close denied" },
    { operation: "inspect_adb_window" },
  );
  let permitRelease = false;
  const lease = new AnalysisCleanupLease(async () => {
    if (!permitRelease) throw new Error("close denied");
  }, ["selected-input"]);
  lease.bindCleanupError(cleanup);
  const composed = analysisErrorWithCleanupFailure(
    primary,
    cleanup,
    "inspect_adb_window",
  ).bindCleanupDependencies([primary, cleanup]);
  const harness = await createApplicationMcpHarness({
    serverOptions: {
      adbDeviceAnalysis: {
        inspectAvailability: async () => ({
          status: "available",
          code: null,
          reason: null,
          diagnostics: {},
        }),
        execute: async () => err(composed),
        close: async () => {
          permitRelease = true;
          await lease.release();
        },
      },
    },
  });
  onTestFinished(() => harness.close());
  const { name, ajv, inputSchema } = await advertisedMcpToolSchemas(
    harness.client,
    "inspect_adb_window",
  );
  const args = { serial: "fixture" };
  expect(ajv.validate(inputSchema, args)).toBe(true);
  const call = async () =>
    parseMcpToolError(await harness.client.callTool({ name, arguments: args }))
      .error;
  expect((await call()).code).toBe("cleanup_incomplete");
  await expect(lease.release()).rejects.toThrow("close denied");
  expect((await call()).code).toBe("cleanup_incomplete");
  permitRelease = true;
  await lease.release();
  expect(await call()).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    retryable: false,
    details: {
      issues: [{ path: ["serial"], reason: "invalid_value" }],
      cleanup_history: {
        primary_error: { code: "invalid_request" },
        cleanup_error: { code: "cleanup_incomplete" },
      },
    },
  });
  await harness.client.ping();
});
