import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { inspectPeResourcesInputSchema } from "../../../src/domain/native/peResources.js";
import { inspectPeCertificatesInputSchema } from "../../../src/domain/native/peCertificates.js";
import { inspectPeImportsInputSchema } from "../../../src/domain/native/peImports.js";
import { inspectElfNotesInputSchema } from "../../../src/domain/native/elfNotes.js";
import { inspectKernelModuleInputSchema } from "../../../src/domain/native/kernelModule.js";
import { inspectNativeExportsInputSchema } from "../../../src/domain/native/nativeExports.js";
import { inspectAppleIpsInputSchema } from "../../../src/domain/native/appleIps.js";
import { inspectApkSignatureInputSchema } from "../../../src/domain/apkSignature/apkSignatureQuery.js";
import { PeResourcesProvider } from "../../../src/native/pe/PeResourcesProvider.js";
import { PeCertificatesProvider } from "../../../src/native/pe/PeCertificatesProvider.js";
import { PeImportsProvider } from "../../../src/native/pe/PeImportsProvider.js";
import { ElfNotesProvider } from "../../../src/native/elf/ElfNotesProvider.js";
import { KernelModuleProvider } from "../../../src/native/elf/KernelModuleProvider.js";
import { NativeExportsProvider } from "../../../src/native/exports/NativeExportsProvider.js";
import { AppleIpsProvider } from "../../../src/native/apple/AppleIpsProvider.js";
import { ApkSignatureProvider } from "../../../src/apkSignature/ApkSignatureProvider.js";
import { peResourceFixture } from "../../../src/native/pe/PeResources.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const cases = [
  {
    name: "PE resources",
    make: () => {
      const provider = new PeResourcesProvider();
      return {
        inspect: (path: string, signal: AbortSignal) =>
          provider.inspect(inspectPeResourcesInputSchema.parse({ path }), {
            signal,
          }),
        close: () => provider.close(),
      };
    },
  },
  {
    name: "PE certificates",
    make: () => {
      const provider = new PeCertificatesProvider();
      return {
        inspect: (path: string, signal: AbortSignal) =>
          provider.inspect(inspectPeCertificatesInputSchema.parse({ path }), {
            signal,
          }),
        close: () => provider.close(),
      };
    },
  },
  {
    name: "PE imports",
    make: () => {
      const provider = new PeImportsProvider();
      return {
        inspect: (path: string, signal: AbortSignal) =>
          provider.inspect(inspectPeImportsInputSchema.parse({ path }), {
            signal,
          }),
        close: () => provider.close(),
      };
    },
  },
  {
    name: "ELF notes",
    make: () => {
      const provider = new ElfNotesProvider();
      return {
        inspect: (path: string, signal: AbortSignal) =>
          provider.inspect(inspectElfNotesInputSchema.parse({ path }), {
            signal,
          }),
        close: () => provider.close(),
      };
    },
  },
  {
    name: "kernel modules",
    make: () => {
      const provider = new KernelModuleProvider();
      return {
        inspect: (path: string, signal: AbortSignal) =>
          provider.inspect(inspectKernelModuleInputSchema.parse({ path }), {
            signal,
          }),
        close: () => provider.close(),
      };
    },
  },
  {
    name: "native exports",
    make: () => {
      const provider = new NativeExportsProvider();
      return {
        inspect: (path: string, signal: AbortSignal) =>
          provider.inspect(inspectNativeExportsInputSchema.parse({ path }), {
            signal,
          }),
        close: () => provider.close(),
      };
    },
  },
  {
    name: "Apple IPS",
    make: () => {
      const provider = new AppleIpsProvider();
      return {
        inspect: (path: string, signal: AbortSignal) =>
          provider.inspect(inspectAppleIpsInputSchema.parse({ path }), {
            signal,
          }),
        close: () => provider.close(),
      };
    },
  },
  {
    name: "APK signatures",
    make: () => {
      const provider = new ApkSignatureProvider();
      return {
        inspect: (path: string, signal: AbortSignal) =>
          provider.inspect(inspectApkSignatureInputSchema.parse({ path }), {
            signal,
          }),
        close: () => provider.close(),
      };
    },
  },
] as const;

const modes = [
  "close-failure",
  "close-cancel",
  "close-cancel-null",
  "close-both",
] as const;

it.each(
  cases.flatMap(({ name, make }) =>
    modes.map((mode) => ({ name, make, mode })),
  ),
)(
  "retains completed $name acquisition through $mode",
  async ({ make, mode }) => {
    const root = await createTestTempDirectory("rea-native-finalization-");
    const path = join(root, "selected.bin");
    // The descriptor must finalize before any format parser runs, so one
    // physical file can exercise every acquisition boundary.
    const bytes = peResourceFixture().bytes;
    await writeFile(path, bytes);
    const controller = new AbortController();
    const reason =
      mode === "close-cancel-null" ? null : { request: "cancel during close" };
    const closeFailure = Object.assign(new Error("controlled close EIO"), {
      code: "EIO",
    });
    const original = OwnedFileHandle.prototype.close;
    let owner: OwnedFileHandle | undefined;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementationOnce(async function (this: OwnedFileHandle) {
        owner = this;
        if (mode !== "close-failure") controller.abort(reason);
        if (mode === "close-failure" || mode === "close-both")
          throw closeFailure;
        await original.call(this);
      });
    const provider = make();
    try {
      const result = await provider.inspect(path, controller.signal);
      if (result.ok) throw new Error("Expected finalization failure");
      const acquired = {
        kind: "file-snapshot-hash",
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      };
      expect(result.error.partialObservation).toEqual(acquired);
      expect(
        projectAnalysisError(result.error).details?.partial_observation,
      ).toEqual(acquired);
      const failedClose = mode === "close-failure" || mode === "close-both";
      expect(result.error.cleanupIncomplete).toBe(failedClose);
      if (failedClose) expect(owner?.handle.fd).toBeGreaterThanOrEqual(0);
      if (mode !== "close-failure") {
        const primary = result.error.cleanupPrimary ?? result.error;
        expect(primary).toMatchObject({
          _tag: "AnalysisCancelledError",
          cause: reason,
        });
      }
      close.mockRestore();
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(owner?.handle.fd).toBe(-1);
    } finally {
      close.mockRestore();
      await provider.close();
    }
  },
);
