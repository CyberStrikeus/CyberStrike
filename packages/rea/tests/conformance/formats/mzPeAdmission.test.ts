import { GpuInventory } from "../../../src/gpu/GpuInventory.js";
import { GpuBufferSource } from "../../../src/gpu/GpuSource.js";
import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { observeMzWindowsHeader } from "../../../src/domain/dosMz.js";
import { createWindowsNativeManifest } from "../../../src/domain/windowsNativeArtifact.js";
import {
  NATIVE_AOT_MAX_REPORT_BYTES,
  parseNativeAotPe,
} from "../../../src/domain/native/nativeAotPe.js";
import { inspectDesktopFile } from "../../../src/artifacts/DesktopFileInspection.js";
import type { DesktopFile } from "../../../src/domain/desktopApplication.js";
import { readManagedPeLayout } from "../../../src/dotnet/ManagedPeReader.js";
import { buildManagedPeFixture } from "../../../src/dotnet/ManagedPe.fixture.js";
import { readPeHeaders } from "../../../src/native/pe/PeResourceLayout.js";
import { peResourceFixture } from "../../../src/native/pe/PeResources.fixture.js";
import { ElectronFuseService } from "../../../src/application/electron/ElectronFuseService.js";
import { ElectronFuseProvider } from "../../../src/electron/ElectronFuseProvider.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  nativeAotPeDigest,
  nativeAotPeFixture,
} from "../../fixtures/nativeaotPe.js";
import {
  OBSIDIAN_FUSE_BYTES,
  peHeaderFuseImage,
} from "../../fixtures/electron/fuseImage.js";

/** A valid DOS relocation owns dword60, even when those bytes point at planted PE data. */
const relocationOwnedPointer = (bytes: Buffer): Buffer => {
  bytes.writeUInt16LE(bytes.length % 512, 2);
  bytes.writeUInt16LE(Math.ceil(bytes.length / 512), 4);
  bytes.writeUInt16LE(1, 6);
  bytes.writeUInt16LE(4, 8);
  bytes.writeUInt16LE(60, 24);
  expect(observeMzWindowsHeader(bytes)).toEqual({ state: "absent" });
  return bytes;
};

it("keeps relocation-owned DOS bytes out of managed PE layout", () => {
  const bytes = relocationOwnedPointer(buildManagedPeFixture());
  expect(() => readManagedPeLayout(bytes)).toThrow(/PE/u);
});

it("keeps relocation-owned DOS bytes out of PE resource/certificate header admission", () => {
  const bytes = relocationOwnedPointer(peResourceFixture().bytes);
  expect(() => readPeHeaders(bytes)).toThrow(/PE/u);
});

it("keeps relocation-owned DOS bytes out of NativeAOT metadata recovery", () => {
  const bytes = relocationOwnedPointer(nativeAotPeFixture());
  const result = parseNativeAotPe(
    bytes,
    nativeAotPeDigest(bytes),
    NATIVE_AOT_MAX_REPORT_BYTES,
  );
  expect(result.summary).toMatchObject({
    status: "not_applicable",
    coverage: { basis: "unsupported-layout" },
  });
});

it("refuses relocation-owned DOS bytes as packaged Windows native artifacts", () => {
  const bytes = relocationOwnedPointer(nativeAotPeFixture());
  expect(createWindowsNativeManifest("fixture", bytes)).toMatchObject({
    ok: false,
  });
});

it("does not scan fuse wires in a planted PE record owned by DOS relocations", async () => {
  const root = await createTestTempDirectory("rea-fuse-dos-relocations-");
  const path = join(root, "selected.exe");
  await writeFile(
    path,
    relocationOwnedPointer(
      peHeaderFuseImage(0x8664, OBSIDIAN_FUSE_BYTES).bytes,
    ),
  );
  const service = new ElectronFuseService(new ElectronFuseProvider());
  try {
    expect((await service.inspect({ path })).ok).toBe(false);
  } finally {
    await service.close();
  }
});

it("does not emit desktop PE facts from relocation-owned DOS bytes", async () => {
  const root = await createTestTempDirectory("rea-desktop-dos-relocations-");
  const path = join(root, "selected.exe");
  const bytes = relocationOwnedPointer(buildManagedPeFixture());
  await writeFile(path, bytes);
  const file = await open(path, "r");
  const row: DesktopFile = {
    file_id: `dsf_${"a".repeat(64)}`,
    path: "selected.exe",
    local_path: path,
    kind: "file",
    bytes: bytes.length,
    identity: null,
    read_status: "examined",
    ranges: [],
    facts: [],
    issues: [],
  };
  try {
    await inspectDesktopFile(file, row, {
      bytes: 0,
      maximum: 1024 * 1024,
      retainedBytes: 0,
      maximumRetainedBytes: 1024 * 1024,
    });
  } finally {
    await file.close();
  }
  expect(
    row.facts.filter(
      (fact) =>
        fact.kind === "native-image-header" || fact.kind === "pe-cli-directory",
    ),
  ).toEqual([]);
});

const shortDosHeader = (bytes: Buffer): Buffer => {
  bytes.writeUInt16LE(bytes.length % 512, 2);
  bytes.writeUInt16LE(Math.ceil(bytes.length / 512), 4);
  bytes.writeUInt16LE(0, 6);
  bytes.writeUInt16LE(2, 8);
  bytes.writeUInt16LE(28, 24);
  expect(observeMzWindowsHeader(bytes)).toMatchObject({
    state: "declared",
    signature: "PE",
  });
  return bytes;
};

it("preserves recognized PE records after short DOS headers in complete-byte readers", () => {
  expect(() =>
    readManagedPeLayout(shortDosHeader(buildManagedPeFixture())),
  ).not.toThrow();
  expect(() =>
    readPeHeaders(shortDosHeader(peResourceFixture().bytes)),
  ).not.toThrow();
  const bytes = shortDosHeader(nativeAotPeFixture());
  expect(
    parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      NATIVE_AOT_MAX_REPORT_BYTES,
    ).summary.status,
  ).toBe("complete");
  expect(createWindowsNativeManifest("fixture", bytes)).toMatchObject({
    ok: true,
  });
});

it("preserves fuse inspection after a short DOS header with a confirmed PE signature", async () => {
  const root = await createTestTempDirectory("rea-fuse-short-dos-");
  const path = join(root, "selected.exe");
  await writeFile(
    path,
    shortDosHeader(peHeaderFuseImage(0x8664, OBSIDIAN_FUSE_BYTES).bytes),
  );
  const service = new ElectronFuseService(new ElectronFuseProvider());
  try {
    const inspected = await service.inspect({ path });
    expect(inspected).toMatchObject({
      ok: true,
      value: { subject: { architecture: "x86_64" } },
    });
  } finally {
    await service.close();
  }
});

it("preserves desktop PE observations after a short DOS header", async () => {
  const root = await createTestTempDirectory("rea-desktop-short-dos-");
  const path = join(root, "selected.exe");
  const bytes = shortDosHeader(buildManagedPeFixture());
  await writeFile(path, bytes);
  const file = await open(path, "r");
  const row: DesktopFile = {
    file_id: `dsf_${"a".repeat(64)}`,
    path: "selected.exe",
    local_path: path,
    kind: "file",
    bytes: bytes.length,
    identity: null,
    read_status: "examined",
    ranges: [],
    facts: [],
    issues: [],
  };
  try {
    await inspectDesktopFile(file, row, {
      bytes: 0,
      maximum: 1024 * 1024,
      retainedBytes: 0,
      maximumRetainedBytes: 1024 * 1024,
    });
  } finally {
    await file.close();
  }
  expect(row.facts.map((fact) => fact.kind)).toEqual(
    expect.arrayContaining(["native-image-header", "pe-cli-directory"]),
  );
});

it("keeps a PE signature outside an inspected prefix unresolved until its required range is read", () => {
  const bytes = peResourceFixture().bytes;
  const prefix = bytes.subarray(0, 64);
  expect(observeMzWindowsHeader(prefix, bytes.length)).toMatchObject({
    state: "signature-needed",
    offset: 128,
  });
  expect(() => readPeHeaders(bytes)).not.toThrow();
  expect(() => readPeHeaders(prefix, bytes.length)).toThrow(
    "PE range 128 + 24 leaves the artifact.",
  );
});

it("does not inventory PE GPU sections from relocation-owned DOS bytes", async () => {
  const bytes = relocationOwnedPointer(peResourceFixture().bytes);
  const buffer = new GpuBufferSource(bytes, null);
  const reads: { offset: number; size: number }[] = [];
  const source = {
    size: buffer.size,
    containerId: buffer.containerId,
    read: (offset: number, size: number) => {
      reads.push({ offset, size });
      return buffer.read(offset, size);
    },
  };
  const inventory = new GpuInventory({
    path: "/fixture",
    analysis: "inventory",
  });
  await expect(inventory.inspect(source)).rejects.toThrow(/PE/u);
  expect(reads).toEqual([
    { offset: 0, size: 32 },
    { offset: 0, size: 64 },
  ]);
});

it("preserves PE GPU section inventory after a short DOS header with a confirmed signature", async () => {
  const bytes = shortDosHeader(peResourceFixture().bytes);
  const inventory = new GpuInventory({
    path: "/fixture",
    analysis: "inventory",
  });
  await expect(
    inventory.inspect(new GpuBufferSource(bytes, null)),
  ).resolves.toBe("pe");
});
