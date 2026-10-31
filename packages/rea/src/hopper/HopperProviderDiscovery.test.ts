import { dirname } from "node:path";

import { describe, expect, it } from "vitest";

import { parseConfig } from "../config/parseConfig.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { silentLogger } from "../logger.js";
import { HopperProvider } from "./HopperProvider.js";

describe("Hopper provider discovery", () => {
  it.skipIf(process.platform === "win32")(
    "reports bounded launcher availability without starting Hopper",
    () => {
      const available = provider(process.execPath).inspectAvailability();
      expect(available).toEqual({
        status: "available",
        code: null,
        reason: null,
        diagnostics: {
          launcher_path: process.execPath,
          platform: process.platform,
        },
      });

      const missingPath = "/missing/rea-hopper-launcher";
      expect(provider(missingPath).inspectAvailability()).toEqual({
        status: "unavailable",
        code: "executable_missing",
        reason: `Hopper launcher is missing or not executable: ${missingPath}`,
        diagnostics: {
          launcher_path: missingPath,
          platform: process.platform,
        },
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "reports a directory launcher path as missing",
    () => {
      const directory = dirname(process.execPath);
      expect(provider(directory).inspectAvailability()).toEqual({
        status: "unavailable",
        code: "executable_missing",
        reason: `Hopper launcher is missing or not executable: ${directory}`,
        diagnostics: {
          launcher_path: directory,
          platform: process.platform,
        },
      });
    },
  );

  it.runIf(process.platform === "win32")(
    "reports Hopper integration as unsupported on Windows",
    () => {
      expect(provider(process.execPath).inspectAvailability()).toMatchObject({
        status: "unavailable",
        code: "unsupported_host",
        diagnostics: { platform: "win32" },
      });
    },
  );

  it("separates target kind, format, and architecture support", () => {
    const hopper = provider(process.execPath, "linux");
    expect(hopper.inspectTargetSupport(databaseTarget())).toMatchObject({
      status: "supported",
    });
    expect(
      hopper.inspectTargetSupport(executableTarget("elf", "x86_64")),
    ).toMatchObject({ status: "supported" });
    expect(hopper.inspectTargetSupport(artifactTarget())).toMatchObject({
      status: "unsupported",
      code: "target_kind_unsupported",
      diagnostics: { target_kind: "archive", target_format: "asar" },
    });
  });

  it("fails closed for saved Hopper databases on macOS without a bridge launch route", () => {
    expect(
      provider(process.execPath, "darwin").inspectTargetSupport(
        databaseTarget(),
      ),
    ).toMatchObject({
      status: "unsupported",
      code: "target_kind_unsupported",
      reason: expect.stringContaining("cannot start REA's analysis bridge"),
      diagnostics: {
        target_kind: "database",
        target_format: "analysis-database",
      },
    });
  });
});

const provider = (
  launcherPath: string,
  platform: NodeJS.Platform = process.platform,
): HopperProvider => {
  const config = parseConfig({ HOPPER_LAUNCHER_PATH: launcherPath });
  if (!config.ok) throw config.error;
  return new HopperProvider(config.value, silentLogger, {}, platform);
};

const databaseTarget = (): BinaryTarget => ({
  path: "/tmp/fixture.hop",
  sha256: "a".repeat(64),
  kind: "database",
  format: "analysis-database",
});

const executableTarget = (
  format: "mach-o" | "elf" | "pe",
  architecture: "x86" | "x86_64" | "arm" | "arm64",
): BinaryTarget =>
  format === "pe"
    ? {
        path: "/tmp/fixture",
        sha256: "b".repeat(64),
        kind: "executable",
        format,
        architecture,
        availableArchitectures: [architecture],
        executableRole: "application",
        managed: false,
      }
    : {
        path: "/tmp/fixture",
        sha256: "b".repeat(64),
        kind: "executable",
        format,
        architecture,
        availableArchitectures: [architecture],
      };

const artifactTarget = (): BinaryTarget => ({
  path: "/tmp/app.asar",
  sha256: "c".repeat(64),
  kind: "archive",
  format: "asar",
});
