import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32")(
  "retains the selected browser and its startup failure through the CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-browser-launch-");
    const executable = join(root, "selected-browser");
    const secret = "explicit-browser-startup-secret";
    await writeFile(
      executable,
      `#!/bin/sh\nprintf 'fixture startup failure ${secret}\\n' >&2\nexit 42\n`,
    );
    await chmod(executable, 0o700);
    for (const [path, marker] of [
      [executable, "fixture startup failure"],
      [join(root, "missing-browser"), "doesn't exist"],
    ] as const) {
      const scenario = {
        browser: { mode: "launch", executable_path: path },
        start_url: { url: "http://127.0.0.1:1/" },
        secrets: [
          {
            secret_id: "credential",
            environment_variable: "BROWSER_FIXTURE_SECRET",
          },
        ],
        actions: [
          { step_id: "wait", action: "wait_for_timeout", duration_ms: 1 },
        ],
      };
      const response = await cli.run({
        arguments: [
          "capture-browser-scenario",
          JSON.stringify(scenario),
          "--json",
        ],
        environment: { BROWSER_FIXTURE_SECRET: secret },
        timeoutMs: 20_000,
      });
      expect(response.exitCode, response.stdout + response.stderr).toBe(1);
      expect(response.stdout).not.toContain(secret);
      expect(response.json).toMatchObject({
        code: expect.any(String),
        details: {
          diagnostics: {
            executable_path: path,
            startup_error: expect.stringContaining(marker),
          },
        },
      });
    }
  },
);
