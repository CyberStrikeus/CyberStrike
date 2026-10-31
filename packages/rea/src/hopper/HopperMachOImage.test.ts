import { requirePermissionDenial } from "../../tests/fixtures/permissionDenial.js";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { createInspectionResources } from "../../tests/fixtures/inspectionResources.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { BinaryTargetError } from "../domain/configurationErrors.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  prepareHopperMachOImage,
  resolveHopperMachOImage as resolveHopperMachOImageWithOwner,
} from "./HopperMachOImage.js";
import { HopperApplicationLauncher } from "./BridgeLauncher.js";

const CPU_TYPES = { x86_64: 0x01000007, arm64: 0x0100000c } as const;
const FAT32_ALIGNMENT = 12;
const FAT32_SLICE_SIZE = 64;
const ARM64E = 2;
const ARM64E_X1 = 12;
const ARM64E_WITH_CAPABILITIES = 0x80000002;
const ARM64E_X1_WITH_CAPABILITIES = 0x8000000c;

interface FatFixtureSlice {
  readonly cpuType: number;
  readonly cpuSubtype: number;
  /** Thin-slice byte order, independent of the container's table byte order. */
  readonly little?: boolean;
}

interface Fat32Fixture {
  readonly container: Buffer;
  readonly sliceOffsets: readonly number[];
}

/** Synthesize a FAT32 container whose slices are 4096-aligned thin headers. */
const buildFat32Container = (
  slices: readonly FatFixtureSlice[],
  options: { readonly littleEndianTable?: boolean } = {},
): Fat32Fixture => {
  const littleTable = options.littleEndianTable === true;
  const writeTableUInt32 = littleTable
    ? (buffer: Buffer, offset: number, value: number): number =>
        buffer.writeUInt32LE(value, offset)
    : (buffer: Buffer, offset: number, value: number): number =>
        buffer.writeUInt32BE(value, offset);
  const unit = 2 ** FAT32_ALIGNMENT;
  const sliceOffsets = slices.map((_slice, index) => unit * (index + 1));
  const lastOffset = sliceOffsets[sliceOffsets.length - 1] ?? unit;
  const container = Buffer.alloc(lastOffset + FAT32_SLICE_SIZE, 0);
  // The magic VALUE is 0xcafebabe in the table's byte order: little-endian
  // storage yields the FAT_CIGAM magic a big-endian reader observes.
  writeTableUInt32(container, 0, 0xcafebabe);
  writeTableUInt32(container, 4, slices.length);
  for (const [index, slice] of slices.entries()) {
    const entry = 8 + index * 20;
    const offset = sliceOffsets[index]!;
    writeTableUInt32(container, entry, slice.cpuType);
    writeTableUInt32(container, entry + 4, slice.cpuSubtype);
    writeTableUInt32(container, entry + 8, offset);
    writeTableUInt32(container, entry + 12, FAT32_SLICE_SIZE);
    writeTableUInt32(container, entry + 16, FAT32_ALIGNMENT);
    const writeThinUInt32 =
      slice.little === true
        ? (buffer: Buffer, fieldOffset: number, value: number): number =>
            buffer.writeUInt32LE(value, fieldOffset)
        : (buffer: Buffer, fieldOffset: number, value: number): number =>
            buffer.writeUInt32BE(value, fieldOffset);
    writeThinUInt32(container, offset, 0xfeedfacf);
    writeThinUInt32(container, offset + 4, slice.cpuType);
    writeThinUInt32(container, offset + 8, slice.cpuSubtype);
  }
  return { container, sliceOffsets };
};

const writeFixture = async (
  directory: string,
  name: string,
  fixture: Fat32Fixture,
): Promise<string> => {
  const path = join(directory, name);
  await writeFile(path, fixture.container);
  return path;
};

const fat32Target = (
  path: string,
  fixture: Fat32Fixture,
  architecture: "arm64" | "x86_64",
) => ({
  path,
  sha256: createHash("sha256").update(fixture.container).digest("hex"),
  kind: "executable" as const,
  format: "mach-o-universal" as const,
  architecture,
  availableArchitectures: ["x86_64", "arm64"] as const,
  universalSlice: { offset: fixture.sliceOffsets[0]!, size: FAT32_SLICE_SIZE },
});

const requireResolved = (
  result: Awaited<ReturnType<typeof resolveHopperMachOImage>>,
) => {
  if (!result.ok)
    throw new Error(
      `FAT fixture resolution failed: ${JSON.stringify(projectAnalysisError(result.error))}`,
    );
  return result.value;
};

let inspectionResources = createInspectionResources();
afterEach(async () => {
  await inspectionResources.close();
  inspectionResources = createInspectionResources();
});

const resolveHopperMachOImage = (
  target: Parameters<typeof resolveHopperMachOImageWithOwner>[0],
) =>
  resolveHopperMachOImageWithOwner(target, {
    resourceScope: inspectionResources.owner,
  });

it("retains Hopper FAT selection across short header, table and slice reads", async () => {
  const root = await createTestTempDirectory("rea-hopper-short-reads-");
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.arm64, cpuSubtype: 0, little: true },
  ]);
  const path = await writeFixture(root, "fat", fixture);
  const target = fat32Target(path, fixture, "arm64");
  const expected = await resolveHopperMachOImage(target);
  expect(expected.ok).toBe(true);
  let shortReads = 0;
  const handles: FileHandle[] = [];
  const actual = await resolveHopperMachOImageWithOwner(target, {
    resourceScope: inspectionResources.owner,
    fileSystem: {
      open: (async (...args: Parameters<typeof open>) => {
        const handle = await open(...args);
        handles.push(handle);
        const read = handle.read.bind(handle);
        vi.spyOn(handle, "read").mockImplementation((async (
          ...readArgs: unknown[]
        ) => {
          if (typeof readArgs[2] === "number" && readArgs[2] > 3) {
            readArgs[2] = 3;
            shortReads += 1;
          }
          return Reflect.apply(read, handle, readArgs);
        }) as typeof handle.read);
        return handle;
      }) as typeof open,
    },
  });
  expect(actual).toEqual(expected);
  expect(shortReads).toBeGreaterThan(5);
  expect(handles.every((handle) => handle.fd === -1)).toBe(true);
});

it.skipIf(process.platform === "win32")(
  "reports a FAT64 source that became unreadable as a host read denial",
  async (context) => {
    await requirePermissionDenial(context, "file-read");
    const directory = await createTestTempDirectory("rea-hopper-fat64-");
    const path = join(directory, "universal");
    await writeFile(path, Buffer.alloc(64));
    await chmod(path, 0);
    try {
      const result = await resolveHopperMachOImage({
        path,
        sha256: "0".repeat(64),
        kind: "executable",
        format: "mach-o",
        architecture: "arm64",
        availableArchitectures: ["arm64"],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({ systemCode: "EACCES" });
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "access_denied",
        details: { path, system_code: "EACCES" },
      });
    } finally {
      await chmod(path, 0o600);
    }
  },
);

it("rejects an ELF target before attempting FAT source preparation", async () => {
  const directory = await createTestTempDirectory("rea-hopper-mips-boundary-");
  // No file is created: format validation must precede any filesystem lookup.
  const path = join(directory, "mips.elf");
  const result = await resolveHopperMachOImage({
    path,
    sha256: "0".repeat(64),
    kind: "executable",
    format: "elf",
    architecture: "mips",
    availableArchitectures: ["mips"],
    mips: { elfClass: 32, byteOrder: "little", type: 2, flags: 0x70001001 },
  });
  if (result.ok)
    throw new Error("An ELF target entered Mach-O image preparation");
  expect(result.error).toMatchObject({
    _tag: "BinaryTargetError",
    path,
    reason: "Hopper image preparation requires a Mach-O target",
  });
});

it("selects the plain-arm64-decodable arm64e slice from an Apple-style FAT32 container", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-arm64e-");
  // /bin/* system binaries: x86_64, arm64e (cpusubtype 2), arm64e.x1 (subtype 12).
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.x86_64, cpuSubtype: 3 },
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E },
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E_X1 },
  ]);
  const path = await writeFixture(directory, "system.fat", fixture);
  const result = requireResolved(
    await resolveHopperMachOImage(fat32Target(path, fixture, "arm64")),
  );
  expect(result).toMatchObject({
    method: "fat32_thin_slice",
    architecture_count: 3,
    source_offset: fixture.sliceOffsets[1],
    byte_length: FAT32_SLICE_SIZE,
    cpu_type: CPU_TYPES.arm64,
    cpu_subtype: ARM64E,
  });
});

it("ranks capability-bearing arm64 subtypes by base and retains raw identity", async () => {
  const directory = await createTestTempDirectory(
    "rea-hopper-fat32-capabilities-",
  );
  const fixture = buildFat32Container([
    {
      cpuType: CPU_TYPES.arm64,
      cpuSubtype: ARM64E_X1_WITH_CAPABILITIES,
    },
    {
      cpuType: CPU_TYPES.arm64,
      cpuSubtype: ARM64E_WITH_CAPABILITIES,
    },
  ]);
  const path = await writeFixture(directory, "system.fat", fixture);
  const selected = requireResolved(
    await resolveHopperMachOImage(fat32Target(path, fixture, "arm64")),
  );
  expect(selected).toMatchObject({
    source_offset: fixture.sliceOffsets[1],
    cpu_subtype: ARM64E_WITH_CAPABILITIES,
  });
});

it("fails closed when capability variants share the preferred arm64e base", async () => {
  const directory = await createTestTempDirectory(
    "rea-hopper-fat32-capability-ambiguity-",
  );
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.arm64, cpuSubtype: 0x80000002 },
    { cpuType: CPU_TYPES.arm64, cpuSubtype: 0x81000002 },
  ]);
  const path = await writeFixture(directory, "ambiguous.fat", fixture);
  const result = await resolveHopperMachOImage(
    fat32Target(path, fixture, "arm64"),
  );
  if (result.ok || !(result.error instanceof BinaryTargetError))
    throw new Error(
      "Expected ambiguous FAT selection to return a BinaryTargetError",
    );
  expect(result.error.reason).toContain("selection for arm64 is ambiguous");
});

it("prefers cpusubtype 2 over 12 regardless of FAT32 table order", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-order-");
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E_X1 },
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E },
  ]);
  const path = await writeFixture(directory, "reordered.fat", fixture);
  const result = requireResolved(
    await resolveHopperMachOImage(fat32Target(path, fixture, "arm64")),
  );
  expect(result).toMatchObject({
    cpu_subtype: ARM64E,
    source_offset: fixture.sliceOffsets[1],
  });
});

it("prefers a plain arm64 slice over arm64e in a FAT32 container", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-plain-");
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.arm64, cpuSubtype: 0 },
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E },
  ]);
  const path = await writeFixture(directory, "plain.fat", fixture);
  const result = requireResolved(
    await resolveHopperMachOImage(fat32Target(path, fixture, "arm64")),
  );
  expect(result).toMatchObject({
    cpu_subtype: 0,
    source_offset: fixture.sliceOffsets[0],
  });
});

it("keeps a lone arm64e.x1 FAT32 slice selectable to preserve today's open behavior", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-lone-");
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E_X1 },
  ]);
  const path = await writeFixture(directory, "lone.fat", fixture);
  const result = requireResolved(
    await resolveHopperMachOImage(fat32Target(path, fixture, "arm64")),
  );
  expect(result).toMatchObject({ cpu_subtype: ARM64E_X1 });
});

it("still fails closed when two arm64e.x1 FAT32 slices compete", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-ambig-");
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E_X1 },
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E_X1 },
  ]);
  const path = await writeFixture(directory, "ambiguous.fat", fixture);
  const result = await resolveHopperMachOImage(
    fat32Target(path, fixture, "arm64"),
  );
  if (result.ok) throw new Error("Ambiguous FAT32 selection succeeded");
  expect(
    projectAnalysisError(result.error).details?.reason ?? result.error,
  ).toMatch(/selection.*ambiguous/u);
});

it("selects the single x86_64 slice of a FAT32 container for an x86_64 target", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-intel-");
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E },
    { cpuType: CPU_TYPES.x86_64, cpuSubtype: 3 },
  ]);
  const path = await writeFixture(directory, "universal.fat", fixture);
  const result = requireResolved(
    await resolveHopperMachOImage(fat32Target(path, fixture, "x86_64")),
  );
  expect(result).toMatchObject({
    cpu_type: CPU_TYPES.x86_64,
    cpu_subtype: 3,
    source_offset: fixture.sliceOffsets[1],
  });
});

it("parses a little-endian FAT32 table without tying it to slice byte order", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-le-");
  const fixture = buildFat32Container(
    [
      { cpuType: CPU_TYPES.x86_64, cpuSubtype: 3 },
      { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E },
      { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E_X1 },
    ],
    { littleEndianTable: true },
  );
  const path = await writeFixture(directory, "little.fat", fixture);
  const result = requireResolved(
    await resolveHopperMachOImage(fat32Target(path, fixture, "arm64")),
  );
  expect(result).toMatchObject({
    method: "fat32_thin_slice",
    cpu_subtype: ARM64E,
    source_offset: fixture.sliceOffsets[1],
  });
});

it("rejects a FAT32 slice whose declared range extends beyond the file", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-range-");
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E },
  ]);
  fixture.container.writeUInt32BE(fixture.container.length + 16, 8 + 12);
  const path = await writeFixture(directory, "overrange.fat", fixture);
  const result = await resolveHopperMachOImage(
    fat32Target(path, fixture, "arm64"),
  );
  if (result.ok) throw new Error("An overranging FAT32 slice was accepted");
  expect(
    projectAnalysisError(result.error).details?.reason ?? result.error,
  ).toMatch(/extends beyond the file/u);
});

it("copies exactly the selected FAT32 slice bytes and verifies the source", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-copy-");
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.x86_64, cpuSubtype: 3 },
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E },
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E_X1 },
  ]);
  const path = await writeFixture(directory, "system.fat", fixture);
  const target = fat32Target(path, fixture, "arm64");
  const resolved = requireResolved(await resolveHopperMachOImage(target));
  const destination = join(directory, "image.macho");
  const prepared = await prepareHopperMachOImage(
    path,
    target.sha256,
    resolved,
    destination,
    { resourceScope: new ArtifactResourceScope() },
  );
  if (!prepared.ok) throw new Error(prepared.error.userMessage);
  const arm64eOffset = fixture.sliceOffsets[1]!;
  const copied = fixture.container.subarray(
    arm64eOffset,
    arm64eOffset + FAT32_SLICE_SIZE,
  );
  expect(Buffer.compare(await readFile(destination), copied)).toBe(0);
});

it("retains the caller reason when a FAT copy is cancelled after its final write", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat-cancel-");
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E },
  ]);
  const path = await writeFixture(directory, "system.fat", fixture);
  const target = fat32Target(path, fixture, "arm64");
  const image = requireResolved(await resolveHopperMachOImage(target));
  const destination = join(directory, "image.macho");
  const controller = new AbortController();
  const reason = { request: "cancel-after-fat-write" };
  const prepared = await prepareHopperMachOImage(
    path,
    target.sha256,
    image,
    destination,
    {
      resourceScope: new ArtifactResourceScope(),
      signal: controller.signal,
      observer: {
        afterChunkWritten: async (copiedBytes) => {
          expect(copiedBytes).toBe(FAT32_SLICE_SIZE);
          controller.abort(reason);
        },
      },
    },
  );

  expect(prepared.ok).toBe(false);
  if (prepared.ok) throw new Error("Cancelled FAT copy was accepted");
  expect(prepared.error._tag).toBe("HopperCancelledError");
  expect(prepared.error.cause).toBe(reason);
  // The private session directory remains the owner of partial output.
  expect(
    Buffer.compare(
      await readFile(destination),
      fixture.container.subarray(
        fixture.sliceOffsets[0],
        fixture.sliceOffsets[0]! + FAT32_SLICE_SIZE,
      ),
    ),
  ).toBe(0);
});

it("retains a failed prepared-image close through launcher cleanup and blocks another launch", async () => {
  const directory = await createTestTempDirectory("rea-hopper-copy-close-");
  const bytes = thinFixture();
  const path = join(directory, "source.macho");
  await writeFile(path, bytes);
  const target = thinTarget(path, bytes);
  const image = requireResolved(await resolveHopperMachOImage(target));
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const firstCloseFailure = new Error("first close attempt failed");
  const retryCloseFailure = new Error("cleanup retry failed");
  let allowClose = false;
  let sourceCloseAttempts = 0;
  const imageFileSystem = {
    open: async (...arguments_: Parameters<typeof actualFs.open>) => {
      const handle = await actualFs.open(...arguments_);
      if (arguments_[0] !== path) return handle;
      const sourceClose = async (): Promise<void> => {
        sourceCloseAttempts += 1;
        if (!allowClose && sourceCloseAttempts === 1) throw firstCloseFailure;
        if (!allowClose) throw retryCloseFailure;
        await handle.close();
      };
      return new Proxy(handle, {
        get(targetHandle, property) {
          if (property === "close") return sourceClose;
          const value = Reflect.get(targetHandle, property, targetHandle);
          return typeof value === "function" ? value.bind(targetHandle) : value;
        },
      });
    },
  };

  const sessionDirectory = join(directory, "session");
  await mkdir(sessionDirectory);
  const launcher = new HopperApplicationLauncher(
    {
      environment: {},
      launcherPath: join(directory, "hopper"),
      targetPath: path,
      targetKind: "executable",
      loaderArgs: ["-l", "Mach-O", "--aarch64"],
      bridgeScriptPath: join(directory, "bridge.py"),
      preparedImage: { image, sourceSha256: target.sha256 },
      launchMode: "native",
    },
    { platform: "linux", imageFileSystem },
  );
  const initial = await launcher.launch({
    directory: sessionDirectory,
    socketPath: join(sessionDirectory, "bridge.sock"),
    token: "fixture-token",
    runId: "fixture-run-1",
  });
  expect(initial.ok).toBe(false);
  if (initial.ok) throw new Error("A copy with failed close was accepted");
  expect(initial.error._tag).toBe("HopperStartError");
  expect(initial.error.cause).toBe(firstCloseFailure);
  expect(initial.error.cleanupIncomplete).toBe(true);
  expect(initial.error.cleanupResources).toEqual([
    `hopper-image-source:${path}`,
  ]);
  const blocked = await launcher.launch({
    directory: sessionDirectory,
    socketPath: join(sessionDirectory, "bridge.sock"),
    token: "fixture-token",
    runId: "fixture-run-2",
  });
  expect(blocked.ok).toBe(false);
  if (blocked.ok) throw new Error("A launch bypassed retained file cleanup");
  expect(blocked.error.cleanupIncomplete).toBe(true);
  expect(blocked.error.cleanupResources).toEqual([
    `hopper-image-source:${path}`,
  ]);
  expect(sourceCloseAttempts).toBe(3);

  const cleanupPending = await launcher.cleanup();
  expect(cleanupPending.ok).toBe(false);
  if (cleanupPending.ok)
    throw new Error("Cleanup without release was reported successful");
  expect(cleanupPending.error.cleanupIncomplete).toBe(true);
  expect(cleanupPending.error.cleanupResources).toEqual([
    `hopper-image-source:${path}`,
  ]);
  expect(sourceCloseAttempts).toBe(4);

  allowClose = true;
  await expect(launcher.cleanup()).resolves.toEqual({ ok: true, value: null });
  expect(initial.error.cleanupIncomplete).toBe(false);
  expect(blocked.error.cleanupIncomplete).toBe(false);
  expect(cleanupPending.error.cleanupIncomplete).toBe(false);
  expect(
    Buffer.compare(
      await readFile(join(sessionDirectory, "image.macho")),
      bytes,
    ),
  ).toBe(0);
});

it("observes caller cancellation that arrives during final source-handle cleanup", async () => {
  const directory = await createTestTempDirectory(
    "rea-hopper-copy-close-cancel-",
  );
  const bytes = thinFixture();
  const path = join(directory, "source.macho");
  await writeFile(path, bytes);
  const target = thinTarget(path, bytes);
  const image = requireResolved(await resolveHopperMachOImage(target));
  const controller = new AbortController();
  const reason = { request: "cancel-during-final-close" };
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const fileSystem = {
    open: async (...arguments_: Parameters<typeof actualFs.open>) => {
      const handle = await actualFs.open(...arguments_);
      if (arguments_[0] !== path) return handle;
      const closeHandle = handle.close.bind(handle);
      Object.defineProperty(handle, "close", {
        configurable: true,
        value: async (): Promise<void> => {
          controller.abort(reason);
          await closeHandle();
        },
      });
      return handle;
    },
  };

  const prepared = await prepareHopperMachOImage(
    path,
    target.sha256,
    image,
    join(directory, "image.macho"),
    {
      resourceScope: new ArtifactResourceScope(),
      signal: controller.signal,
      fileSystem,
    },
  );

  expect(prepared.ok).toBe(false);
  if (prepared.ok) throw new Error("Finalization cancellation was ignored");
  expect(prepared.error._tag).toBe("HopperCancelledError");
  expect(prepared.error.cause).toBe(reason);
  expect(
    Buffer.compare(await readFile(join(directory, "image.macho")), bytes),
  ).toBe(0);
});

it("rejects FAT32 preparation when the source table changed after resolution", async () => {
  const directory = await createTestTempDirectory("rea-hopper-fat32-race-");
  const fixture = buildFat32Container([
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E },
    { cpuType: CPU_TYPES.arm64, cpuSubtype: ARM64E_X1 },
  ]);
  const path = await writeFixture(directory, "system.fat", fixture);
  const target = fat32Target(path, fixture, "arm64");
  const resolved = requireResolved(await resolveHopperMachOImage(target));
  const mutated = Buffer.from(fixture.container);
  mutated.writeUInt32BE(0x01000007, 8);
  await writeFile(path, mutated);
  const destination = join(directory, "image.macho");
  const prepared = await prepareHopperMachOImage(
    path,
    target.sha256,
    resolved,
    destination,
    { resourceScope: new ArtifactResourceScope() },
  );
  if (prepared.ok)
    throw new Error("A mutated FAT32 source passed verification");
  expect(prepared.error.userMessage).toMatch(/no longer agrees/u);
});

const thinFixture = (): Buffer => {
  const image = Buffer.alloc(64, 0x5a);
  image.writeUInt32BE(0xfeedfacf, 0);
  image.writeUInt32BE(CPU_TYPES.arm64, 4);
  image.writeUInt32BE(ARM64E_WITH_CAPABILITIES, 8);
  return image;
};

const thinTarget = (path: string, bytes: Buffer) => ({
  path,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  kind: "executable" as const,
  format: "mach-o" as const,
  architecture: "arm64" as const,
  availableArchitectures: ["arm64"] as const,
});

it("copies an admitted thin Mach-O through the owned verified-image path", async () => {
  const directory = await createTestTempDirectory("rea-hopper-thin-copy-");
  const bytes = thinFixture();
  const path = join(directory, "source.macho");
  await writeFile(path, bytes);
  const target = thinTarget(path, bytes);
  const image = requireResolved(await resolveHopperMachOImage(target));
  expect(image).toEqual({
    method: "thin_verified_copy",
    byte_length: bytes.length,
    cpu_type: CPU_TYPES.arm64,
    cpu_subtype: ARM64E_WITH_CAPABILITIES,
  });

  const destination = join(directory, "private", "image.macho");
  await mkdir(join(directory, "private"));
  const prepared = await prepareHopperMachOImage(
    path,
    target.sha256,
    image,
    destination,
    { resourceScope: new ArtifactResourceScope() },
  );
  if (!prepared.ok) throw new Error(prepared.error.userMessage);
  expect(prepared.value).toBe(destination);
  expect(Buffer.compare(await readFile(destination), bytes)).toBe(0);
  expect(target.path).toBe(path);
});

it("does not launch a thin selection when its admitted source changes before copy", async () => {
  const directory = await createTestTempDirectory("rea-hopper-thin-race-");
  const bytes = thinFixture();
  const path = join(directory, "source.macho");
  await writeFile(path, bytes);
  const target = thinTarget(path, bytes);
  const image = requireResolved(await resolveHopperMachOImage(target));
  const changed = Buffer.from(bytes);
  changed.writeUInt8(
    changed.readUInt8(changed.length - 1) ^ 1,
    changed.length - 1,
  );
  await writeFile(path, changed);

  const sessionDirectory = join(directory, "session");
  await mkdir(sessionDirectory);
  const launcher = new HopperApplicationLauncher(
    {
      environment: process.env,
      launcherPath: join(directory, "hopper"),
      targetPath: path,
      targetKind: "executable",
      loaderArgs: ["-l", "Mach-O", "--aarch64"],
      bridgeScriptPath: join(directory, "bridge.py"),
      preparedImage: { image, sourceSha256: target.sha256 },
      launchMode: "native",
    },
    { platform: "linux" },
  );
  const launched = await launcher.launch({
    directory: sessionDirectory,
    socketPath: join(sessionDirectory, "bridge.sock"),
    token: "fixture-token",
    runId: "fixture-run",
  });
  expect(launched.ok).toBe(false);
  if (launched.ok) throw new Error("Changed source reached Hopper launch");
  expect(launched.error.userMessage).toContain(
    "no longer agrees with its admitted digest, size, or selected header",
  );
  await expect(
    access(join(sessionDirectory, "bootstrap.py")),
  ).rejects.toMatchObject({
    code: "ENOENT",
  });
  // The session directory remains the cleanup owner for partial private output.
  await expect(readdir(sessionDirectory)).resolves.toContain("image.macho");
});

it("keeps caller cancellation primary after verified thin-image preparation", async () => {
  const directory = await createTestTempDirectory("rea-hopper-thin-cancel-");
  const bytes = thinFixture();
  const path = join(directory, "source.macho");
  await writeFile(path, bytes);
  const target = thinTarget(path, bytes);
  const image = requireResolved(await resolveHopperMachOImage(target));
  const controller = new AbortController();
  controller.abort(new Error("caller cancellation"));
  const prepared = await prepareHopperMachOImage(
    path,
    target.sha256,
    image,
    join(directory, "image.macho"),
    { resourceScope: new ArtifactResourceScope(), signal: controller.signal },
  );
  expect(prepared).toMatchObject({
    ok: false,
    error: { _tag: "HopperCancelledError" },
  });
});

it("retains an owned partial thin image and exact cancellation reason after a write", async () => {
  const directory = await createTestTempDirectory("rea-hopper-thin-partial-");
  const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a);
  bytes.writeUInt32BE(0xfeedfacf, 0);
  bytes.writeUInt32BE(CPU_TYPES.arm64, 4);
  bytes.writeUInt32BE(ARM64E_WITH_CAPABILITIES, 8);
  const path = join(directory, "source.macho");
  await writeFile(path, bytes);
  const target = thinTarget(path, bytes);
  const image = requireResolved(await resolveHopperMachOImage(target));
  const sessionDirectory = join(directory, "session");
  await mkdir(sessionDirectory);
  const destination = join(sessionDirectory, "image.macho");
  const controller = new AbortController();
  const reason = { owner: "caller", request: 44 };
  let releaseWrite: (() => void) | undefined;
  let announceWrite: ((copiedBytes: number) => void) | undefined;
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const firstWrite = new Promise<number>((resolve) => {
    announceWrite = resolve;
  });
  const preparing = prepareHopperMachOImage(
    path,
    target.sha256,
    image,
    destination,
    {
      resourceScope: new ArtifactResourceScope(),
      signal: controller.signal,
      observer: {
        afterChunkWritten: async (copiedBytes) => {
          announceWrite?.(copiedBytes);
          await writeGate;
        },
      },
    },
  );

  const copiedBytes = await firstWrite;
  const partial = await readFile(destination);
  expect(partial.byteLength).toBe(copiedBytes);
  expect(copiedBytes).toBeGreaterThan(0);
  expect(copiedBytes).toBeLessThan(bytes.length);
  controller.abort(reason);
  const finishWrite = releaseWrite;
  if (finishWrite === undefined)
    throw new Error("Copy barrier was not created");
  finishWrite();

  const prepared = await preparing;
  expect(prepared.ok).toBe(false);
  if (prepared.ok) throw new Error("Cancelled partial copy was accepted");
  expect(prepared.error._tag).toBe("HopperCancelledError");
  expect(prepared.error.cause).toBe(reason);
  expect(Buffer.compare(await readFile(destination), partial)).toBe(0);
  await expect(access(destination)).resolves.toBeUndefined();
});

it.each([0, 129])(
  "keeps Hopper FAT count admission explicit for count %i",
  async (count) => {
    const directory = await createTestTempDirectory("rea-hopper-fat-count-");
    const fixture = buildFat32Container([
      { cpuType: CPU_TYPES.arm64, cpuSubtype: 0 },
    ]);
    fixture.container.writeUInt32BE(count, 4);
    const path = await writeFixture(directory, "counts.fat", fixture);
    const result = await resolveHopperMachOImage(
      fat32Target(path, fixture, "arm64"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Invalid FAT count was admitted");
    expect(result.error).toMatchObject({
      _tag: "BinaryTargetError",
      path,
      reason:
        "FAT architecture table is truncated or exceeds the supported 128 entries",
    });
  },
);
