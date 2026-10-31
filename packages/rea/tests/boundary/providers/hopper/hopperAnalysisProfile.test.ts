import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { createInspectionResources } from "../../../fixtures/inspectionResources.js";

import type { BinaryTarget } from "../../../../src/domain/binaryTargetTypes.js";
import {
  hopperLoaderArgsForTarget,
  resolveHopperAnalysisProfile,
} from "../../../../src/hopper/HopperAnalysisProfile.js";
import { HOPPER_PROVIDER_IDENTITY } from "../../../../src/hopper/HopperProviderCapabilities.js";

let inspectionResources = createInspectionResources();
let directory: string | undefined;

afterEach(async () => {
  await inspectionResources.close();
  inspectionResources = createInspectionResources();
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("Hopper analysis profiles", () => {
  it("does not map DOS MZ to the 32-bit Hopper loader", () => {
    expect(hopperLoaderArgsForTarget(target("dos-mz", "x86"))).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        operation: "resolve_analysis_profile",
      },
    });
  });

  it("does not map caller-supplied raw binaries onto a Hopper loader", () => {
    expect(
      hopperLoaderArgsForTarget({
        path: "/tmp/ecu.bin",
        sha256: "a".repeat(64),
        kind: "executable",
        format: "raw-binary",
        architecture: "arm",
        availableArchitectures: ["arm"],
        entryPoint: "0x8000000",
        entryPointSource: "0x8000000",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        operation: "resolve_analysis_profile",
      },
    });
  });

  it.each([
    [target("elf", "x86_64"), ["-l", "ELF", "--intel-64"]],
    [target("pe", "x86"), ["-l", "WinPE", "--intel-32"]],
  ] as const)("derives complete non-interactive options", (input, expected) => {
    expect(hopperLoaderArgsForTarget(input)).toEqual({
      ok: true,
      value: expected,
    });
    expect("loaderArgs" in input).toBe(false);
  });

  it("refuses a profile when the selected launcher cannot be fingerprinted", async () => {
    const resolved = await resolveHopperAnalysisProfile(
      target("elf", "x86_64"),
      {
        launcherPath: "/missing/hopper",
        loaderArgsOverride: [],
        provider: HOPPER_PROVIDER_IDENTITY,
        resourceScope: inspectionResources.owner,
      },
    );
    expect(resolved).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        operation: "resolve_analysis_profile",
        diagnostics: {
          launcher_path: "/missing/hopper",
          system_code: "ENOENT",
        },
      },
    });
  });

  it.each([
    { override: [], source: "derived", arguments: ["-l", "ELF", "--intel-64"] },
    {
      override: ["-l", "Custom Loader", "--intel-64"],
      source: "configured_override",
      arguments: ["-l", "Custom Loader", "--intel-64"],
    },
  ])(
    "commits effective loader arguments from $source in the profile",
    async (scenario) => {
      directory = await createTestTempDirectory("rea-hopper-profile-loader-");
      const launcherPath = join(directory, "hopper");
      await writeFile(launcherPath, "Hopper build");
      const resolved = await resolveHopperAnalysisProfile(
        target("elf", "x86_64"),
        {
          launcherPath,
          loaderArgsOverride: scenario.override,
          provider: HOPPER_PROVIDER_IDENTITY,
          resourceScope: inspectionResources.owner,
        },
      );
      expect(resolved).toMatchObject({
        ok: true,
        value: {
          profile: {
            parameters: {
              function_dossier_coverage:
                "observed-facets-and-call-relationships-v1",
              loader: {
                source: scenario.source,
                arguments: scenario.arguments,
              },
            },
          },
        },
      });
    },
  );

  it("stops launcher hashing when profile resolution is cancelled", async () => {
    directory = await createTestTempDirectory("rea-hopper-profile-cancel-");
    const launcher = join(directory, "hopper");
    await writeFile(launcher, "Hopper build");
    const controller = new AbortController();
    const resolving = resolveHopperAnalysisProfile(target("elf", "x86_64"), {
      launcherPath: launcher,
      loaderArgsOverride: [],
      provider: HOPPER_PROVIDER_IDENTITY,
      resourceScope: inspectionResources.owner,
      signal: controller.signal,
    });

    controller.abort();

    await expect(resolving).resolves.toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", operation: "open_binary" },
    });
  });
});

const target = (
  format: "mach-o" | "elf" | "pe" | "dos-mz",
  architecture: "x86" | "x86_64" | "arm" | "arm64",
): BinaryTarget =>
  format === "pe"
    ? {
        path: "/tmp/fixture",
        sha256: "a".repeat(64),
        kind: "executable",
        format,
        architecture,
        availableArchitectures: [architecture],
        executableRole: "application",
        managed: false,
      }
    : {
        path: "/tmp/fixture",
        sha256: "a".repeat(64),
        kind: "executable",
        format,
        architecture,
        availableArchitectures: [architecture],
      };
