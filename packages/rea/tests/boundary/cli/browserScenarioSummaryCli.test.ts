import { access } from "node:fs/promises";
import { join } from "node:path";
import { Cli } from "incur";
import pino from "pino";
import { expect, it } from "vitest";

import { registerBrowserScenarioCommands } from "../../../src/cliBrowserScenarioCommands.js";
import { ok } from "../../../src/domain/result.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { AnalysisOutputError } from "../../../src/domain/analysisErrorCore.js";
import { AnalysisCleanupLease } from "../../../src/artifacts/AnalysisCleanupLease.js";
import { PlaywrightBrowserScenarioProvider } from "../../../src/browser/PlaywrightBrowserScenarioProvider.js";
import { scenarioCaptureFixture } from "../../fixtures/browserScenarioCapture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each([false, true])(
  "retains startup failure and reports failed cleanup retry when retryFails=%s",
  async (retryFails) => {
    let refuseCleanup = retryFails;
    let cleanupAttempts = 0;
    const lease = new AnalysisCleanupLease(async () => {
      cleanupAttempts += 1;
      if (refuseCleanup) throw new Error("profile removal denied");
    }, ["owned-profile"]);
    // The production provider owns resources retained by a partially failed opener.
    // No browser is launched by this boundary regression.
    const provider = new PlaywrightBrowserScenarioProvider(
      async (_scenario, options) => {
        options.retainCleanup?.(lease);
        throw new AnalysisOutputError(
          "capture_browser_scenario",
          "browser startup failed",
        );
      },
    );
    const cli = Cli.create("rea-browser-startup-cleanup-test", { sync: false });
    let stdout = "";
    registerBrowserScenarioCommands(
      cli,
      pino({ level: "silent" }),
      {},
      {
        createProvider: () => provider,
      },
    );
    await cli.serve(
      [
        "capture-browser-scenario",
        JSON.stringify({
          browser: { mode: "launch", executable_path: process.execPath },
          start_url: { url: "http://127.0.0.1:3101/" },
          actions: [
            { step_id: "browse", action: "wait_for_timeout", duration_ms: 1 },
          ],
        }),
        "--json",
      ],
      {
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        exit: () => undefined,
      },
    );
    const failure = JSON.parse(stdout);
    expect(failure).toMatchObject({
      code: "cleanup_incomplete",
      details: { reason: "browser startup failed" },
    });
    if (retryFails) {
      expect(failure).toMatchObject({
        details: {
          diagnostics: {
            primary_error: {
              code: "cleanup_incomplete",
              details: { reason: "browser startup failed" },
            },
            cleanup_error: {
              details: { diagnostics: { reason: "profile removal denied" } },
            },
          },
        },
      });
      expect(lease.released).toBe(false);
      refuseCleanup = false;
      await provider.close();
      expect(cleanupAttempts).toBe(2);
    } else {
      expect(JSON.stringify(failure)).not.toContain("profile removal denied");
      expect(cleanupAttempts).toBe(1);
    }
    expect(lease.released).toBe(true);
  },
);

it.each(["complete", "summary"] as const)(
  "retains complete Evidence on cancellation during CLI cleanup with %s delivery",
  async (detail) => {
    const root = await createTestTempDirectory("rea-browser-summary-cli-");
    const destination = join(root, "evidence.json");
    const originalExit = process.exitCode;
    const listeners = new Set(process.listeners("SIGINT"));
    const cli = Cli.create("rea-browser-summary-test", { sync: false });
    let stdout = "";
    let closed = false;
    registerBrowserScenarioCommands(
      cli,
      pino({ level: "silent" }),
      {},
      {
        createProvider: () => ({
          identity: () => ({ id: "fixture", name: "Fixture", version: "1" }),
          captureScenario: async () => ok(scenarioCaptureFixture()),
          close: async () => {
            closed = true;
            // Invoke only this command's newly installed listener, without emitting
            // a process-wide signal into the shared test worker.
            const installed = process
              .listeners("SIGINT")
              .filter((listener) => !listeners.has(listener));
            expect(installed).toHaveLength(1);
            installed[0]!("SIGINT");
          },
        }),
      },
    );
    try {
      await cli.serve(
        [
          "capture-browser-scenario",
          JSON.stringify({
            browser: { mode: "launch", executable_path: process.execPath },
            start_url: { url: "http://127.0.0.1:3101/" },
            actions: [
              { step_id: "browse", action: "wait_for_timeout", duration_ms: 1 },
            ],
          }),
          "--detail",
          detail,
          "--evidence_output",
          destination,
          "--json",
        ],
        {
          env: {},
          stdout: (text) => {
            stdout += text;
          },
          exit: () => undefined,
        },
      );
      expect(JSON.parse(stdout)).toMatchObject({
        code: "cancelled",
        details: {
          partial_observation: {
            operation: "capture_browser_scenario",
            normalized_result: { steps: expect.any(Array) },
          },
        },
      });
      expect(closed).toBe(true);
      await expect(access(destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(new Set(process.listeners("SIGINT"))).toEqual(listeners);
    } finally {
      process.exitCode = originalExit;
    }
  },
);

it("keeps the provider's cleanup failure and completed Evidence without publishing a summary bundle", async () => {
  const root = await createTestTempDirectory("rea-browser-summary-cleanup-");
  const destination = join(root, "evidence.json");
  const cli = Cli.create("rea-browser-cleanup-test", { sync: false });
  let stdout = "";
  const failure = new ProviderCleanupError(
    "owned-browser",
    ["owned-profile"],
    { reason: "cleanup denied" },
    { operation: "capture_browser_scenario" },
  );
  registerBrowserScenarioCommands(
    cli,
    pino({ level: "silent" }),
    {},
    {
      createProvider: () => ({
        identity: () => ({ id: "fixture", name: "Fixture", version: "1" }),
        captureScenario: async () => ok(scenarioCaptureFixture()),
        close: async () => {
          throw failure;
        },
      }),
    },
  );
  await cli.serve(
    [
      "capture-browser-scenario",
      JSON.stringify({
        browser: { mode: "launch", executable_path: process.execPath },
        start_url: { url: "http://127.0.0.1:3101/" },
        actions: [
          { step_id: "browse", action: "wait_for_timeout", duration_ms: 1 },
        ],
      }),
      "--detail",
      "summary",
      "--evidence_output",
      destination,
      "--json",
    ],
    {
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      exit: () => undefined,
    },
  );
  expect(JSON.parse(stdout)).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      resources: ["owned-profile"],
      partial_observation: { operation: "capture_browser_scenario" },
    },
  });
  await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" });
});
