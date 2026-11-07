import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { describe, expect } from "vitest";

import { cliTest } from "../../support/cli/cliFixture.js";

describe("scenario CLI schema diagnostics", () => {
  cliTest("reports browser scenario schema paths", async ({ cli }) => {
    const result = await cli.run({
      arguments: ["capture-browser-scenario", "{}", "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "capture_browser_scenario",
        issues: expect.arrayContaining([
          {
            path: ["browser"],
            reason: "missing_argument",
            expected: "object",
          },
          {
            path: ["start_url"],
            reason: "missing_argument",
            expected: "object",
          },
          {
            path: ["actions"],
            reason: "missing_argument",
            expected: "array",
          },
        ]),
      },
    });
  });

  cliTest(
    "refuses summary delivery without a complete Evidence bundle before launching",
    async ({ cli }) => {
      const scenario = {
        browser: { mode: "launch", executable_path: "/nonexistent/chromium" },
        start_url: { url: "https://app.example.test/", query: [] },
        actions: [
          { step_id: "wait", action: "wait_for_timeout", duration_ms: 1 },
        ],
      };
      const result = await cli.run({
        arguments: [
          "capture-browser-scenario",
          JSON.stringify(scenario),
          "--detail",
          "summary",
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "capture_browser_scenario",
          issues: [{ path: ["evidence_output"], reason: "invalid_value" }],
        },
      });
    },
  );

  cliTest("reports Electron scenario schema paths", async ({ cli }) => {
    const result = await cli.run({
      arguments: ["capture-electron-scenario", "{}", "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "capture_electron_scenario",
        issues: expect.arrayContaining([
          {
            path: ["executable_path"],
            reason: "missing_argument",
            expected: "string",
          },
          {
            path: ["application_path"],
            reason: "missing_argument",
            expected: "string",
          },
        ]),
      },
    });
  });
});

for (const field of [
  "executable_path",
  "application_path",
  "application_root",
] as const) {
  cliTest(`names the unresolved Electron ${field}`, async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-path-");
    const missing = join(root, "missing");
    const result = await cli.run({
      arguments: [
        "capture-electron-scenario",
        JSON.stringify({
          executable_path: process.execPath,
          application_path: root,
          application_root: root,
          actions: [],
          [field]: missing,
        }),
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: [field],
            reason: "invalid_value",
            message: expect.stringContaining("ENOENT"),
          },
        ],
      },
    });
    expect(JSON.stringify(result.json)).toContain(missing);
  });
}

cliTest.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "reports a search-denied Electron application_path as access denied",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-electron-denied-");
    const denied = join(root, "denied");
    await mkdir(denied);
    const application = join(denied, "main.js");
    await writeFile(application, "module.exports = {};\n");
    await chmod(denied, 0o000);
    let result;
    try {
      result = await cli.run({
        arguments: [
          "capture-electron-scenario",
          JSON.stringify({
            executable_path: process.execPath,
            application_path: application,
            actions: [],
          }),
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });
    } finally {
      await chmod(denied, 0o700);
    }
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "access_denied",
      category: "unavailable",
      details: {
        operation: "capture_electron_scenario",
        path: application,
        system_code: "EACCES",
        boundary: "filesystem-read",
      },
    });
  },
);
