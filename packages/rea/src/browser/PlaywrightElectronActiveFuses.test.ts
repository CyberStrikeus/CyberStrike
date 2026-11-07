import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { ELECTRON_FUSE_STATE_BYTES } from "../domain/electron/electronFuses.js";
import {
  elfFuseImage,
  OBSIDIAN_FUSE_BYTES,
  peFuseImage,
  thinFuseImage,
  thinMacho,
  universalFuseImage,
} from "../../tests/fixtures/electron/fuseImage.js";
import { AnalysisUnsupportedTargetError } from "../domain/analysisErrorCore.js";
import { assertNodeCliInspectArgumentsSupported } from "./PlaywrightElectronActiveFuses.js";

describe("assertNodeCliInspectArgumentsSupported", () => {
  it("rejects thin Mach-O binary when EnableNodeCliInspectArguments fuse is disabled", async () => {
    const root = await createTestTempDirectory("rea-fuse-preflight-");
    const binaryPath = join(root, "disabled-app");
    const image = thinFuseImage(OBSIDIAN_FUSE_BYTES); // index 3 is disabled
    await writeFile(binaryPath, image.bytes);

    const error: unknown = await assertNodeCliInspectArgumentsSupported(
      binaryPath,
    ).catch((cause: unknown) => cause);
    if (!(error instanceof AnalysisUnsupportedTargetError))
      throw new Error("Expected unsupported target error", { cause: error });
    expect(error.operation).toBe("capture_electron_scenario");
    expect(error.path).toBe(binaryPath);
    expect(error.message).toContain("EnableNodeCliInspectArguments");
    expect(error.remediationAction).toContain("inspect_electron_page");
  });

  it("passes when EnableNodeCliInspectArguments fuse is enabled", async () => {
    const root = await createTestTempDirectory("rea-fuse-preflight-");
    const binaryPath = join(root, "enabled-app");
    const enabledFuses = [...OBSIDIAN_FUSE_BYTES];
    enabledFuses[3] = ELECTRON_FUSE_STATE_BYTES.enabled;
    const image = thinFuseImage(enabledFuses);
    await writeFile(binaryPath, image.bytes);

    await expect(
      assertNodeCliInspectArgumentsSupported(binaryPath),
    ).resolves.toBeUndefined();
  });

  it("passes when binary contains no fuse sentinel (fuse state unknown)", async () => {
    const root = await createTestTempDirectory("rea-fuse-preflight-");
    const binaryPath = join(root, "stock-node");
    const image = thinMacho(0x0100000c, Buffer.from("no-sentinel-bytes-here"));
    await writeFile(binaryPath, image);

    await expect(
      assertNodeCliInspectArgumentsSupported(binaryPath),
    ).resolves.toBeUndefined();
  });

  it("passes gracefully when fuse reader throws a format or reading failure", async () => {
    const root = await createTestTempDirectory("rea-fuse-preflight-");
    const nonMachoPath = join(root, "script.sh");
    await writeFile(nonMachoPath, "#!/bin/sh\necho hello");

    await expect(
      assertNodeCliInspectArgumentsSupported(nonMachoPath),
    ).resolves.toBeUndefined();
  });

  it("rejects Windows PE binary when EnableNodeCliInspectArguments fuse is disabled", async () => {
    const root = await createTestTempDirectory("rea-fuse-preflight-");
    const binaryPath = join(root, "disabled-pe.exe");
    const image = peFuseImage(OBSIDIAN_FUSE_BYTES);
    await writeFile(binaryPath, image.bytes);

    await expect(
      assertNodeCliInspectArgumentsSupported(binaryPath),
    ).rejects.toThrow(AnalysisUnsupportedTargetError);
  });

  it("rejects Linux ELF binary when EnableNodeCliInspectArguments fuse is disabled", async () => {
    const root = await createTestTempDirectory("rea-fuse-preflight-");
    const binaryPath = join(root, "disabled-elf");
    const image = elfFuseImage(OBSIDIAN_FUSE_BYTES);
    await writeFile(binaryPath, image.bytes);

    await expect(
      assertNodeCliInspectArgumentsSupported(binaryPath),
    ).rejects.toThrow(AnalysisUnsupportedTargetError);
  });

  it("rethrows when signal is aborted during reading", async () => {
    const controller = new AbortController();
    const readFuseImage = vi.fn(async () => {
      controller.abort();
      throw new Error("aborted during read");
    });

    await expect(
      assertNodeCliInspectArgumentsSupported("/nonexistent/binary", {
        signal: controller.signal,
        readFuseImage,
      }),
    ).rejects.toThrow();
    expect(readFuseImage).toHaveBeenCalledOnce();
  });

  it("rejects macOS app bundle when framework binary has disabled inspect fuse", async () => {
    const root = await createTestTempDirectory("rea-fuse-mac-bundle-");
    const appBundle = join(root, "Obsidian.app");
    const launcherBinary = join(appBundle, "Contents", "MacOS", "Obsidian");
    const frameworkDir = join(
      appBundle,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
    );
    await mkdir(join(appBundle, "Contents", "MacOS"), { recursive: true });
    await mkdir(frameworkDir, { recursive: true });

    // Launcher binary has no sentinel:
    await writeFile(launcherBinary, Buffer.from("dummy launcher binary"));

    // Framework binary has the disabled fuse wire:
    const frameworkBinary = join(frameworkDir, "Electron Framework");
    await writeFile(frameworkBinary, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);

    const error: unknown = await assertNodeCliInspectArgumentsSupported(
      launcherBinary,
    ).catch((cause: unknown) => cause);
    if (!(error instanceof AnalysisUnsupportedTargetError))
      throw new Error("Expected unsupported target error", { cause: error });
    expect(error.operation).toBe("capture_electron_scenario");
    expect(error.path).toBe(launcherBinary);
    expect(error.message).toContain("EnableNodeCliInspectArguments");
  });

  it("evaluates matching architecture slice in universal Mach-O binary", async () => {
    const root = await createTestTempDirectory("rea-fuse-preflight-");
    const binaryPath = join(root, "universal-app");
    // universalFuseImage has left (x86_64) disabled, right (arm64) enabled
    const image = universalFuseImage();
    await writeFile(binaryPath, image.bytes);

    if (process.arch === "arm64") {
      await expect(
        assertNodeCliInspectArgumentsSupported(binaryPath),
      ).resolves.toBeUndefined();
    } else {
      await expect(
        assertNodeCliInspectArgumentsSupported(binaryPath),
      ).rejects.toThrow(AnalysisUnsupportedTargetError);
    }
  });
});
