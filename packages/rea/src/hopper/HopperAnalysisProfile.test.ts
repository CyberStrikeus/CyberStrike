import { machoTargetSelectionSchema } from "../domain/apple/machoTargetSelection.js";
import { createFunctionCoordinateContext } from "../domain/native/functionCoordinateContext.js";
import { createHash } from "node:crypto";
import { open, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

import { createInspectionResources } from "../../tests/fixtures/inspectionResources.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import {
  hopperLoaderArgsForTarget,
  resolveHopperAnalysisProfile,
} from "./HopperAnalysisProfile.js";

let inspectionResources = createInspectionResources();
afterEach(async () => {
  await inspectionResources.close();
  inspectionResources = createInspectionResources();
  vi.mocked(open).mockReset();
  vi.mocked(open).mockImplementation(
    (
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      )
    ).open,
  );
});

it("routes physical universal Mach-O containers through Hopper's FAT loader", () => {
  const result = hopperLoaderArgsForTarget(
    {
      path: "/tmp/universal",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "mach-o-universal",
      architecture: "arm64",
      availableArchitectures: ["x86_64", "arm64"],
      universalSlice: { offset: 0, size: 32 },
    },
    "fat64",
  );

  expect(result).toEqual({
    ok: true,
    value: ["-l", "FAT", "--aarch64", "-l", "Mach-O"],
  });
});

it("prepares a verified thin arm64e slice for a FAT32 system container", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-profile-");
  const writeUInt32 = (buffer: Buffer, offset: number, value: number): void => {
    buffer.writeUInt32BE(value, offset);
  };
  const slices = [
    { cpuType: 0x01000007, cpuSubtype: 3 },
    { cpuType: 0x0100000c, cpuSubtype: 0x80000002 },
    { cpuType: 0x0100000c, cpuSubtype: 0x8000000c },
  ];
  const container = Buffer.alloc(3 * 4096 + 64);
  writeUInt32(container, 0, 0xcafebabe);
  writeUInt32(container, 4, slices.length);
  slices.forEach((slice, index) => {
    const offset = 4096 * (index + 1);
    const entry = 8 + index * 20;
    writeUInt32(container, entry, slice.cpuType);
    writeUInt32(container, entry + 4, slice.cpuSubtype);
    writeUInt32(container, entry + 8, offset);
    writeUInt32(container, entry + 12, 64);
    writeUInt32(container, entry + 16, 12);
    writeUInt32(container, offset, 0xfeedfacf);
    writeUInt32(container, offset + 4, slice.cpuType);
    writeUInt32(container, offset + 8, slice.cpuSubtype);
  });
  const arm64eOffset = 8192;
  const path = join(directory, "system.fat");
  await writeFile(path, container);
  const result = await resolveHopperAnalysisProfile(
    {
      path,
      sha256: createHash("sha256").update(container).digest("hex"),
      kind: "executable",
      format: "mach-o-universal",
      architecture: "arm64",
      availableArchitectures: ["x86_64", "arm64"],
      universalSlice: { offset: arm64eOffset, size: 64 },
    },
    {
      launcherPath: path,
      loaderArgsOverride: [],
      provider: { id: "hopper", name: "Hopper Disassembler", version: null },
      resourceScope: inspectionResources.owner,
    },
  );
  if (!result.ok) throw new Error(result.error.message);
  const parameters = result.value.profile?.parameters;
  expect(parameters).toMatchObject({
    function_coordinate_context: createFunctionCoordinateContext(
      { loader_arguments: ["-l", "Mach-O", "--aarch64"] },
      // The same typed selected-image fact is used by the producer and comparator.
      machoTargetSelectionSchema.parse(parameters?.target_selection),
    ),
    macho_container: "fat32",
    prepared_image: {
      method: "fat32_thin_slice",
      source_offset: arm64eOffset,
      byte_length: 64,
      cpu_type: 0x0100000c,
      cpu_subtype: 0x80000002,
    },
    target_selection: {
      kind: "macho-selected-image-v1",
      container: "fat",
      offset: arm64eOffset,
      byte_length: 64,
      cpu_type: 0x0100000c,
      cpu_subtype: 0x80000002,
      container_table_sha256: expect.any(String),
    },
    loader: {
      source: "derived",
      arguments: ["-l", "Mach-O", "--aarch64"],
    },
  });
});

it("commits a thin header selection only for derived Hopper loader arguments", async () => {
  const directory = await createTestTempDirectory("rea-hopper-thin-profile-");
  const thin = Buffer.alloc(64);
  thin.writeUInt32LE(0xfeedfacf, 0);
  thin.writeUInt32LE(0x0100000c, 4);
  thin.writeUInt32LE(0x80000002, 8);
  const path = join(directory, "arm64e.macho");
  await writeFile(path, thin);
  const target = {
    path,
    sha256: createHash("sha256").update(thin).digest("hex"),
    kind: "executable" as const,
    format: "mach-o" as const,
    architecture: "arm64" as const,
    availableArchitectures: ["arm64" as const],
  };
  const provider = {
    id: "hopper",
    name: "Hopper Disassembler",
    version: null,
  };
  const resolved = await resolveHopperAnalysisProfile(target, {
    launcherPath: path,
    loaderArgsOverride: [],
    provider,
    resourceScope: inspectionResources.owner,
  });
  if (!resolved.ok) throw new Error(resolved.error.message);
  expect(resolved.value.profile?.parameters.target_selection).toEqual({
    kind: "macho-selected-image-v1",
    container: "thin",
    offset: 0,
    byte_length: 64,
    cpu_type: 0x0100000c,
    cpu_subtype: 0x80000002,
    container_table_sha256: null,
  });
  expect(
    resolved.value.profile?.parameters.function_coordinate_context,
  ).toEqual(
    createFunctionCoordinateContext(
      { loader_arguments: ["-l", "Mach-O", "--aarch64"] },
      machoTargetSelectionSchema.parse(
        resolved.value.profile?.parameters.target_selection,
      ),
    ),
  );
  expect(resolved.value.profile?.parameters.prepared_image).toEqual({
    method: "thin_verified_copy",
    byte_length: thin.length,
    cpu_type: 0x0100000c,
    cpu_subtype: 0x80000002,
  });

  const overridden = await resolveHopperAnalysisProfile(target, {
    launcherPath: path,
    loaderArgsOverride: ["-l", "Mach-O"],
    provider,
    resourceScope: inspectionResources.owner,
  });
  if (!overridden.ok) throw new Error(overridden.error.message);
  expect(overridden.value.profile?.parameters).not.toHaveProperty(
    "target_selection",
  );

  expect(overridden.value.profile?.parameters).not.toHaveProperty(
    "function_coordinate_context",
  );
  const changedSameSize = Buffer.from(thin);
  changedSameSize.writeUInt8(
    changedSameSize.readUInt8(changedSameSize.length - 1) ^ 1,
    changedSameSize.length - 1,
  );
  await writeFile(path, changedSameSize);
  const staleAdmission = await resolveHopperAnalysisProfile(target, {
    launcherPath: path,
    loaderArgsOverride: [],
    provider,
    resourceScope: inspectionResources.owner,
  });
  expect(staleAdmission.ok).toBe(false);
  if (staleAdmission.ok) throw new Error("stale thin admission was accepted");
  expect(staleAdmission.error.message).toContain(
    "Thin Mach-O source changed after target admission",
  );
});

it("keeps a read failure primary when cancellation arrives during descriptor cleanup", async () => {
  const directory = await createTestTempDirectory("rea-hopper-profile-read-");
  const path = join(directory, "arm64.macho");
  await writeFile(path, Buffer.from([0xfe, 0xed, 0xfa, 0xcf]));
  const controller = new AbortController();
  const reason = { request: "cancel-after-read-error" };
  const physicalFailure = new Error("fixture read failure");
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const handle = await actualFs.open(...args);
    vi.spyOn(handle, "read").mockRejectedValueOnce(physicalFailure);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, "close").mockImplementation(async () => {
      controller.abort(reason);
      await close();
    });
    return handle;
  });
  const result = await resolveHopperAnalysisProfile(
    {
      path,
      sha256: "a".repeat(64),
      kind: "executable",
      format: "mach-o",
      architecture: "arm64",
      availableArchitectures: ["arm64"],
    },
    {
      launcherPath: path,
      loaderArgsOverride: [],
      provider: { id: "hopper", name: "Hopper", version: null },
      resourceScope: inspectionResources.owner,
      signal: controller.signal,
    },
  );
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "BinaryTargetError", cause: physicalFailure },
  });
});

it("retains the exact caller reason when cancellation arrives during the owned header read", async () => {
  const directory = await createTestTempDirectory("rea-hopper-profile-abort-");
  const path = join(directory, "arm64.macho");
  await writeFile(path, Buffer.from([0xfe, 0xed, 0xfa, 0xcf]));
  const controller = new AbortController();
  const reason = { request: "cancel-header-read" };
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const handle = await actualFs.open(...args);
    const read = handle.read.bind(handle);
    vi.spyOn(handle, "read").mockImplementationOnce(async (...readArgs) => {
      const result = await read(...readArgs);
      controller.abort(reason);
      return result;
    });
    return handle;
  });
  const result = await resolveHopperAnalysisProfile(
    {
      path,
      sha256: "a".repeat(64),
      kind: "executable",
      format: "mach-o",
      architecture: "arm64",
      availableArchitectures: ["arm64"],
    },
    {
      launcherPath: path,
      loaderArgsOverride: [],
      provider: { id: "hopper", name: "Hopper", version: null },
      resourceScope: inspectionResources.owner,
      signal: controller.signal,
    },
  );
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError", cause: reason },
  });
});

it("keeps failed Mach-O preflight cleanup attached to the supplied profile owner", async () => {
  const directory = await createTestTempDirectory("rea-hopper-profile-owner-");
  const sourcePath = join(directory, "source.macho");
  const bytes = Buffer.alloc(100_000, 0x5a);
  bytes.writeUInt32BE(0xfeedfacf, 0);
  bytes.writeUInt32BE(0x0100000c, 4);
  bytes.writeUInt32BE(0x80000002, 8);
  await writeFile(sourcePath, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const closeFailure = new Error("profile preflight close failure");
  let allowClose = false;
  const imageFileSystem = {
    open: async (...args: Parameters<typeof actualFs.open>) => {
      const handle = await actualFs.open(...args);
      const closeHandle = handle.close.bind(handle);
      Object.defineProperty(handle, "close", {
        configurable: true,
        value: async (): Promise<void> => {
          if (!allowClose) throw closeFailure;
          await closeHandle();
        },
      });
      return handle;
    },
  };
  const owner = inspectionResources;

  const resolved = await resolveHopperAnalysisProfile(
    {
      path: sourcePath,
      sha256,
      kind: "executable",
      format: "mach-o",
      architecture: "arm64",
      availableArchitectures: ["arm64"],
    },
    {
      launcherPath: sourcePath,
      loaderArgsOverride: [],
      provider: { id: "hopper", name: "Hopper", version: null },
      resourceScope: owner.owner,
      imageFileSystem,
    },
  );

  expect(resolved.ok).toBe(false);
  if (resolved.ok) throw new Error("Failed preflight cleanup was accepted");
  expect(resolved.error._tag).toBe("BinaryTargetError");
  expect(resolved.error.cause).toBe(closeFailure);
  expect(resolved.error.cleanupIncomplete).toBe(true);
  expect(resolved.error.cleanupResources).toEqual([
    `hopper-macho-preflight:${sourcePath}`,
  ]);

  allowClose = true;
  await owner.close();
  expect(resolved.error.cleanupIncomplete).toBe(false);
});

it("preserves launcher fingerprint filesystem failures instead of an absent profile", async () => {
  const failure = Object.assign(
    new Error("EACCES: fixture launcher read denied"),
    { code: "EACCES" },
  );
  vi.mocked(open).mockRejectedValueOnce(failure);
  const resolving = resolveHopperAnalysisProfile(
    {
      path: "/fixture/input",
      sha256: "a".repeat(64),
      kind: "executable",
      format: "elf",
      architecture: "x86_64",
      availableArchitectures: ["x86_64"],
    },
    {
      launcherPath: "/fixture/hopper",
      loaderArgsOverride: [],
      provider: { id: "hopper", name: "Hopper", version: null },
      resourceScope: inspectionResources.owner,
    },
  );
  const result = await resolving;
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "ProviderAdapterError",
      cause: failure,
      diagnostics: { launcher_path: "/fixture/hopper", system_code: "EACCES" },
    },
  });
});

it.skipIf(process.platform === "win32").each(["header", "launcher"] as const)(
  "rejects a real FIFO at the %s profile boundary without a writer",
  async (kind) => {
    const directory = await createTestTempDirectory("rea-hopper-profile-fifo-");
    const path = join(directory, "hopper.fifo");
    execFileSync("mkfifo", [path]);
    const result = await resolveHopperAnalysisProfile(
      {
        path,
        sha256: "a".repeat(64),
        kind: "executable",
        format: kind === "header" ? "mach-o" : "elf",
        architecture: "x86_64",
        availableArchitectures: ["x86_64"],
      },
      {
        launcherPath: path,
        loaderArgsOverride: [],
        provider: { id: "hopper", name: "Hopper", version: null },
        resourceScope: inspectionResources.owner,
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: kind === "header" ? "BinaryTargetError" : "ProviderAdapterError",
        cause: { name: "NonRegularFileReadError", path },
      },
    });
  },
);

it.each([
  ["header", false],
  ["header", true],
  ["launcher", false],
  ["launcher", true],
] as const)(
  "retains the %s descriptor through failed close, late cancellation and retry (read failed: %s)",
  async (kind, readFails) => {
    const directory = await createTestTempDirectory(
      "rea-hopper-profile-close-",
    );
    const path = join(directory, "selected-file");
    await writeFile(path, Buffer.from([0xfe, 0xed, 0xfa, 0xcf]));
    const actualFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const controller = new AbortController();
    const closeFailure = new Error("profile descriptor close failed");
    const physicalFailure = new Error("profile descriptor read failed");
    const reason = { request: "cancel-during-final-close" };
    let allowClose = false;
    let closeAttempts = 0;
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actualFs.open(...args);
      if (readFails)
        vi.spyOn(handle, "read").mockRejectedValueOnce(physicalFailure);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closeAttempts += 1;
        if (!allowClose) {
          controller.abort(reason);
          throw closeFailure;
        }
        await close();
      });
      return handle;
    });
    const target = {
      path,
      sha256: "a".repeat(64),
      kind: "executable" as const,
      format: kind === "header" ? ("mach-o" as const) : ("elf" as const),
      architecture: "x86_64" as const,
      availableArchitectures: ["x86_64" as const],
    };
    const options = {
      launcherPath: path,
      loaderArgsOverride: ["--fixture"],
      provider: { id: "hopper", name: "Hopper", version: null },
      resourceScope: inspectionResources.owner,
    };
    const first = await resolveHopperAnalysisProfile(target, {
      ...options,
      signal: controller.signal,
    });
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("Failed close was accepted");
    expect(first.error.cleanupIncomplete).toBe(true);
    expect(first.error.cleanupResources).toEqual([path]);
    expect(first.error.cause).toBe(readFails ? physicalFailure : reason);
    const cleanup = first.error.secondaryFailures[0];
    expect(cleanup?.cause).toBeInstanceOf(RegularFileCleanupFailure);
    expect(cleanup?.cause).toMatchObject({
      path,
      cleanupCause: closeFailure,
      outcome: { kind: readFails ? "failed" : "completed" },
    });
    if (!readFails)
      expect(first.error.diagnostics).toMatchObject({
        completed_profile_read:
          kind === "header"
            ? 0xfeedfacf
            : {
                sha256: createHash("sha256")
                  .update(Buffer.from([0xfe, 0xed, 0xfa, 0xcf]))
                  .digest("hex"),
                bytes: 4,
              },
      });
    expect(first.error._tag).toBe(
      readFails
        ? kind === "header"
          ? "BinaryTargetError"
          : "ProviderAdapterError"
        : "AnalysisCancelledError",
    );
    const retry = await resolveHopperAnalysisProfile(target, options);
    expect(retry.ok).toBe(false);
    if (retry.ok) throw new Error("Failed cleanup retry was accepted");
    expect(retry.error.cleanupIncomplete).toBe(true);
    expect(retry.error.cleanupResources).toEqual([path]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(closeAttempts).toBe(2);
    allowClose = true;
    await inspectionResources.close();
    expect(closeAttempts).toBe(3);
    expect(first.error.cleanupIncomplete).toBe(false);
    expect(retry.error.cleanupIncomplete).toBe(false);
  },
);

it.each(["header", "launcher"] as const)(
  "retains completed %s facts when cancellation arrives during successful final close",
  async (kind) => {
    const directory = await createTestTempDirectory(
      "rea-hopper-profile-late-abort-",
    );
    const path = join(directory, "selected-file");
    const bytes = Buffer.from([0xfe, 0xed, 0xfa, 0xcf]);
    await writeFile(path, bytes);
    const controller = new AbortController();
    const reason = { request: "cancel-on-final-close" };
    const actualFs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actualFs.open(...args);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        await close();
        controller.abort(reason);
      });
      return handle;
    });
    const result = await resolveHopperAnalysisProfile(
      {
        path,
        sha256: "a".repeat(64),
        kind: "executable",
        format: kind === "header" ? "mach-o" : "elf",
        architecture: "x86_64",
        availableArchitectures: ["x86_64"],
      },
      {
        launcherPath: path,
        loaderArgsOverride: ["--fixture"],
        provider: { id: "hopper", name: "Hopper", version: null },
        resourceScope: inspectionResources.owner,
        signal: controller.signal,
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        cause: reason,
        cleanupIncomplete: false,
        diagnostics: {
          completed_profile_read:
            kind === "header"
              ? 0xfeedfacf
              : {
                  sha256: createHash("sha256").update(bytes).digest("hex"),
                  bytes: 4,
                },
        },
      },
    });
  },
);

it.each([
  [0xcafebabe, "fat32"],
  [0xbebafeca, "fat32"],
  [0xcafebabf, "fat64"],
  [0xbfbafeca, "fat64"],
] as const)(
  "retains FAT width from a four-byte profile prefix %i",
  async (magic, container) => {
    const directory = await createTestTempDirectory(
      "rea-hopper-prefix-profile-",
    );
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(magic);
    const path = join(directory, "container.macho");
    await writeFile(path, bytes);
    const result = await resolveHopperAnalysisProfile(
      {
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        kind: "executable",
        format: "mach-o-universal",
        architecture: "arm64",
        availableArchitectures: ["arm64"],
        universalSlice: { offset: 4096, size: 64 },
      },
      {
        launcherPath: path,
        loaderArgsOverride: ["-l", "Mach-O"],
        provider: { id: "hopper", name: "Hopper Disassembler", version: null },
        resourceScope: inspectionResources.owner,
      },
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.profile?.parameters).toMatchObject({
      macho_container: container,
      loader: { source: "configured_override", arguments: ["-l", "Mach-O"] },
    });
  },
);
