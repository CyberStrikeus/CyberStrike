import { chmod, copyFile, rm } from "node:fs/promises";

import { describe, expect } from "vitest";
import { z } from "zod";

import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";

import { acquireHopperTargetLease } from "../../../src/process/HopperLease.js";

const FAILED_LAUNCHER = `#!/bin/sh
printf 'Cannot launch Hopper!\\nDocument state is unknown.\\n' >&2
exit 2
`;

/** The private runtime directory a failed launch reports as retained. */
const RetainedRuntime = z.object({
  details: z.object({
    diagnostics: z.object({
      cleanup_error: z.object({
        details: z.object({
          diagnostics: z.object({ runtime_root: z.string() }),
        }),
      }),
    }),
  }),
});

describe("Hopper launcher failure through the one-shot CLI", () => {
  // Hopper target leases are acquired only for the macOS launcher route.
  workspaceCliTest.skipIf(process.platform !== "darwin")(
    "exits after a retained-cleanup failure and releases the target to a retry",
    { timeout: 90_000 },
    async ({ cli, workspace }) => {
      const launcherPath = await workspace.write(
        "failure-helper",
        FAILED_LAUNCHER,
      );
      await chmod(launcherPath, 0o700);
      const targetPath = workspace.path("probe");
      await copyFile("/usr/bin/true", targetPath);
      const loaderArgs = ["--probe"];
      try {
        for (const attempt of ["first", "retry"]) {
          const result = await cli.run({
            arguments: [
              "analyze",
              targetPath,
              "--provider",
              "hopper",
              "--json",
            ],
            environment: {
              ...workspace.environment,
              HOPPER_LAUNCHER_PATH: launcherPath,
              HOPPER_LOADER_ARGS_JSON: JSON.stringify(loaderArgs),
              REA_LOG_LEVEL: "silent",
            },
            timeoutMs: 45_000,
          });
          const retained = RetainedRuntime.safeParse(result.json);
          if (retained.success)
            await rm(
              retained.data.details.diagnostics.cleanup_error.details
                .diagnostics.runtime_root,
              { recursive: true, force: true },
            );

          expect(result.exitCode, attempt).toBe(1);
          expect(result.json, attempt).toMatchObject({
            code: "cleanup_incomplete",
            details: {
              cleanup: "incomplete",
              diagnostics: {
                primary_error: {
                  code: "provider_unavailable",
                  details: {
                    stage: "launch",
                    launcher: {
                      exit_code: 2,
                      stderr: {
                        text: expect.stringContaining(
                          "Document state is unknown",
                        ),
                      },
                    },
                  },
                },
              },
            },
          });
        }
      } finally {
        const recovered = await acquireHopperTargetLease({
          targetPath,
          targetKind: "executable",
          loaderArgs,
          runId: "failed-cli-test-cleanup",
        });
        expect(recovered.acquired).toBe(true);
        if (recovered.acquired) await recovered.lease.release();
      }
    },
  );
});
