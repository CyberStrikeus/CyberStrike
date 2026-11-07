import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import {
  installLinuxHopper,
  systemLinuxHopperInstallHost,
} from "../../../src/application/LinuxHopper.js";
import { systemSetupHost } from "../../../src/application/SetupHost.js";
import { runSetup } from "../../../src/application/Setup.js";
import { createDoctorHostFixture } from "../../../src/application/Doctor.fixture.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { ConfigurationError } from "../../../src/domain/configurationErrors.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

vi.mock("../../../src/application/LinuxHopper.js", async (load) => {
  const actual =
    await load<typeof import("../../../src/application/LinuxHopper.js")>();
  return {
    ...actual,
    installLinuxHopper: vi.fn(actual.installLinuxHopper),
    systemLinuxHopperInstallHost: vi.fn(actual.systemLinuxHopperInstallHost),
  };
});

afterEach(() => vi.resetAllMocks());

it.each(["settled", "late"] as const)(
  "retains and releases the actual temporary directory through setup's Linux cleanup task: %s",
  async (timing) => {
    const home = await createTestTempDirectory("rea-setup-linux-cleanup-");
    const temporary = join(home, "owned-installer-staging");
    await mkdir(temporary);
    let allowCleanup = false;
    const actual = await vi.importActual<
      typeof import("../../../src/application/LinuxHopper.js")
    >("../../../src/application/LinuxHopper.js");
    const child = actual.systemLinuxHopperInstallHost(
      { HOME: home },
      async () => undefined,
    );
    vi.mocked(systemLinuxHopperInstallHost).mockReturnValue({
      ...child,
      cleanup: async (path) => {
        expect(path).toBe(temporary);
        if (!allowCleanup)
          throw new Error(
            "Controlled owned temporary directory cleanup failure",
          );
        await rm(path, { recursive: true });
      },
    });
    // Only the installer outcome is simulated; no package/download action runs.
    let completeInstall: (() => void) | undefined;
    const installGate = new Promise<void>((resolve) => {
      completeInstall = resolve;
    });
    vi.mocked(installLinuxHopper).mockImplementation(async () => {
      if (timing === "late") await installGate;
      return {
        status: "failed",
        reason: "cleanup_failed",
        cleanupFailure: {
          path: temporary,
          reason: "Controlled cleanup failure",
        },
      };
    });
    const closeDoctor = vi.fn(async () => undefined);
    const host = systemSetupHost(
      createDoctorHostFixture({
        platform: "linux",
        homeDirectory: home,
        close: closeDoctor,
      }),
      { HOME: home },
    );
    try {
      const installing = host.installHopper(false);
      const closing = timing === "late" ? host.close?.() : undefined;
      completeInstall?.();
      expect(await installing).toMatchObject({ status: "failed" });
      if (closing !== undefined)
        expect((await closing)?.cleanupResources).toEqual([temporary]);
      const primary = new ConfigurationError("Controlled state failure", {
        settings: [{ setting: "fixture", constraint: "controlled" }],
      });
      const failure = await runSetup(
        { approved: true, structured: true, installHopper: false },
        {
          ...host,
          initialSetupState: async () => {
            throw primary;
          },
        },
      ).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(AnalysisError);
      if (!(failure instanceof AnalysisError))
        throw new Error("Expected typed cleanup failure");
      expect(projectAnalysisError(failure)).toMatchObject({
        code: "cleanup_incomplete",
        details: { resources: [temporary] },
      });
      expect((await stat(temporary)).isDirectory()).toBe(true);
      allowCleanup = true;
      expect(await host.close?.()).toBeUndefined();
      expect(failure.cleanupIncomplete).toBe(false);
      expect(closeDoctor).toHaveBeenCalledTimes(1);
      expect(projectAnalysisError(failure)).toMatchObject(
        projectAnalysisError(primary),
      );
      expect(projectAnalysisError(failure).details).not.toHaveProperty(
        "cleanup",
      );
      expect(projectAnalysisError(failure).details).not.toHaveProperty(
        "resources",
      );
      expect(projectAnalysisError(failure).details).toHaveProperty(
        "cleanup_history",
      );
      await expect(stat(temporary)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      completeInstall?.();
      allowCleanup = true;
      await host.close?.();
    }
  },
);
