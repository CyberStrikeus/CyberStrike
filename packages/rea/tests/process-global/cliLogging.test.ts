import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactOperationError } from "../../src/domain/artifactOperationError.js";
import { ConfigurationError } from "../../src/domain/configurationErrors.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";

import { isCliOperationFailure, logCliCommand } from "../../src/cliLogging.js";
import { silentLogger } from "../../src/logger.js";
import { runSetup } from "../../src/application/Setup.js";
import {
  isSetupFailure,
  type SetupResult,
} from "../../src/application/SetupTypes.js";
import {
  FakeSetupHost,
  options as setupOptions,
} from "../../src/application/Setup.fixture.js";
import { err } from "../../src/domain/result.js";
import { runUpdate, type UpdateHost } from "../../src/application/Update.js";
import { isUpdateFailure } from "../../src/application/UpdateFailure.js";
import {
  runUninstall,
  type UninstallHost,
} from "../../src/application/Uninstall.js";
import { isUninstallFailure } from "../../src/application/UninstallFailure.js";
import { CLI_COMMANDS } from "../../src/cliCommandNames.js";

const originalExitCode = process.exitCode;

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = originalExitCode;
});

it("does not treat ordinary error-looking data or nested Evidence as command failure", () => {
  expect(
    isCliOperationFailure({
      code: "configuration_invalid",
      message: "source data",
    }),
  ).toBe(false);
  expect(
    isCliOperationFailure({
      result: projectAnalysisError(new ConfigurationError("source setting")),
    }),
  ).toBe(false);
});

describe("CLI command outcome classification", () => {
  it("returns nonzero for the UpdateResult failure variant", async () => {
    const installation = {
      manager: "npm",
      prefix: "/fixture",
      packageRoot: "/fixture/lib/node_modules/rea-agents",
    } as const;
    const updateHost: UpdateHost = {
      installation: () => Promise.resolve(installation),
      latestVersion: () =>
        Promise.resolve(
          err({ kind: "unavailable", detail: "registry unavailable" }),
        ),
      installVersion: () => Promise.resolve(err("not called")),
      installedVersion: () => Promise.resolve(err("not called")),
      planMaintenance: () =>
        Promise.resolve({ status: "current", plannedActions: [] }),
    };
    const result = await runUpdate("3.2.1", updateHost);
    expect(result.status).toBe("failed");
    const output = await logCliCommand(
      silentLogger,
      CLI_COMMANDS.update,
      async () => result,
      isUpdateFailure,
    );
    expect(output).toBe(result);
    expect(process.exitCode).toBe(1);
  });

  it.each(["needs_confirmation", "needs_human"] as const)(
    "returns nonzero for a real setup result with status %s",
    async (expectedStatus) => {
      const host = new FakeSetupHost();
      const setup: SetupResult =
        expectedStatus === "needs_human"
          ? await runSetup(
              { ...setupOptions(false), structured: false },
              host,
              () => Promise.resolve(true),
            )
          : await runSetup(
              { ...setupOptions(false), clientIds: ["cursor"] },
              Object.assign(host, {
                clients: [{ name: "cursor", configPath: "/cursor.json" }],
              }),
            );
      expect(setup.status).toBe(expectedStatus);
      const output = await logCliCommand(
        silentLogger,
        CLI_COMMANDS.setup,
        async () => setup,
        isSetupFailure,
      );
      expect(output).toBe(setup);
      expect(process.exitCode).toBe(1);
    },
  );

  it("returns nonzero when the real uninstall outcome contains a failed action", async () => {
    const host: UninstallHost = {
      clients: () => Promise.resolve([]),
      inspectClient: () => Promise.resolve(undefined),
      removeClient: () =>
        Promise.resolve({ name: "client", status: "failed", detail: "write" }),
      removeSkill: () =>
        Promise.resolve({ name: "skill", status: "failed", detail: "write" }),
      purgeData: () => Promise.resolve([]),
    };
    const result = await runUninstall(false, host);
    expect(result.status).toBe("failed");
    await logCliCommand(
      silentLogger,
      CLI_COMMANDS.uninstall,
      async () => result,
      isUninstallFailure,
    );
    expect(process.exitCode).toBe(1);
  });
});

describe("CLI thrown analysis failures", () => {
  it("returns the shared projection with actionable failure coordinates", async () => {
    const projected = await logCliCommand(silentLogger, "fixture", async () => {
      throw new ArtifactOperationError(
        "analyze_javascript_application",
        "integrity",
        {
          logicalPath: "src/main.js",
          declaredSha256: "a".repeat(64),
          calculatedSha256: "b".repeat(64),
          unpacked: true,
        },
      );
    });
    expect(projected).toMatchObject({
      code: "artifact_integrity_mismatch",
      category: "integrity_mismatch",
      details: {
        logical_path: "src/main.js",
        declared_sha256: "a".repeat(64),
        calculated_sha256: "b".repeat(64),
      },
    });
  });
});

describe("CLI successful setup outcomes", () => {
  it.each(["planned", "cancelled"] as const)(
    "keeps a real %s setup result successful",
    async (status) => {
      const host = new FakeSetupHost();
      const result = await runSetup(
        {
          ...setupOptions(false),
          dryRun: status === "planned",
          structured: status === "planned",
        },
        host,
        () => Promise.resolve(false),
      );
      expect(result.status).toBe(status);
      const output = await logCliCommand(
        silentLogger,
        CLI_COMMANDS.setup,
        async () => result,
        isSetupFailure,
      );
      expect(output).toBe(result);
      expect(process.exitCode).toBeUndefined();
      expect(host.hopperInstalls).toBe(0);
      expect(host.configurations).toBe(0);
      expect(host.skillInstalls).toBe(0);
    },
  );
});

describe("CLI structured failure output", () => {
  it("sets a nonzero process status without replacing structured output", async () => {
    const output = {
      error: "Analysis failed",
      ...projectAnalysisError(
        new ArtifactOperationError("inspect_artifact", "integrity", {
          logicalPath: "main.js",
          declaredSha256: "a".repeat(64),
          calculatedSha256: "b".repeat(64),
          unpacked: false,
        }),
      ),
    };

    await expect(
      logCliCommand(silentLogger, "inspect-artifact", () =>
        Promise.resolve(output),
      ),
    ).resolves.toBe(output);
    expect(process.exitCode).toBe(1);
  });
});
