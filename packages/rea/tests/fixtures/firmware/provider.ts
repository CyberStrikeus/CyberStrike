import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { access, writeFile } from "node:fs/promises";
import { expect, onTestFinished } from "vitest";
import { createFirmwareAnalysisProvider } from "../../../src/composition/firmware.js";
import { FirmwareAnalysisService } from "../../../src/application/firmware/FirmwareAnalysisService.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { createTestTempDirectory } from "../temporaryDirectory.js";

/** Exercise the real limiter and process ownership with synthetic pinned reports. */
export const firmwareFixture = async (mode = "normal", banner?: string) => {
  const root = await createTestTempDirectory("rea-firmware-test-");
  const path = join(root, "input.bin");
  await writeFile(path, Buffer.from("fixture-input-data"));
  const commands = {
    binwalk: join(root, "binwalk"),
    unblob: join(root, "unblob"),
  };
  for (const engine of ["binwalk", "unblob"] as const) {
    const invocation = [
      process.execPath,
      // Keep the synthetic JS producer within the real engines' address-space ceiling.
      "--jitless",
      // Node 22 warns when jitless implicitly disables Wasm. Newer releases do
      // not need this flag, and Node 26 no longer accepts it.
      ...(process.versions.node.startsWith("22.") ? ["--no-expose-wasm"] : []),
      fileURLToPath(new URL("./producer.mjs", import.meta.url)),
      engine,
    ]
      .map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
      .join(" ");
    await writeFile(commands[engine], `#!/bin/sh\nexec ${invocation} "$@"\n`, {
      mode: 0o700,
    });
  }
  const launches: {
    cwd: string | undefined;
    pid: number | undefined;
    args: readonly string[];
  }[] = [];
  let cleanupUnverified = mode === "cleanup-failure";
  const provider = createFirmwareAnalysisProvider(
    {
      ...process.env,
      REA_BINWALK_COMMAND: commands.binwalk,
      REA_UNBLOB_COMMAND: commands.unblob,
      REA_FIRMWARE_FIXTURE_MODE: mode,
      ...(banner === undefined ? {} : { REA_FIRMWARE_FIXTURE_VERSION: banner }),
    },
    async (options) => {
      const spawned = await spawnOwnedProviderProcess(options);
      launches.push({
        cwd: options.cwd,
        pid: spawned.process.pid,
        args: options.arguments,
      });
      if (mode === "cleanup-failure") {
        return {
          ...spawned,
          cleanup: () =>
            cleanupUnverified
              ? Promise.resolve({
                  cleaned: false,
                  reason: "injected ownership failure",
                })
              : cleanupOwnedProcessGroup(spawned.ownership),
        };
      }
      return spawned;
    },
  );
  const close = async () => {
    if (provider.close === undefined)
      throw new Error("Expected firmware provider cleanup capability");
    await provider.close();
  };
  onTestFinished(async () => {
    cleanupUnverified = false;
    await close();
  });
  return {
    provider,
    service: new FirmwareAnalysisService(provider),
    path,
    output: join(root, "output"),
    root,
    launches,
    commands,
    close,
    restoreCleanup: () => {
      cleanupUnverified = false;
    },
  };
};

/** Verify only the acquired process groups and private runtime directories. */
export const assertFirmwareCleanup = async (
  launches: Awaited<ReturnType<typeof firmwareFixture>>["launches"],
): Promise<void> => {
  for (const launch of launches) {
    const pid = launch.pid;
    if (pid !== undefined)
      expect(() => process.kill(-pid, 0)).toThrowError(
        expect.objectContaining({ code: "ESRCH" }),
      );
    if (launch.cwd !== undefined)
      await expect(access(launch.cwd)).rejects.toMatchObject({
        code: "ENOENT",
      });
  }
};
