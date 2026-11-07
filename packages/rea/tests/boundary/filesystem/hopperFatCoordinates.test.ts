import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, onTestFinished } from "vitest";

import {
  CPU,
  fatImage,
  machoImage,
} from "../../../src/artifacts/apple/MachoImage.fixture.js";
import type { BinaryTarget } from "../../../src/domain/binaryTargetTypes.js";
import { mapHopperFileOffset } from "../../../src/hopper/HopperFileOffset.js";
import { resolveHopperMachOImage } from "../../../src/hopper/HopperMachOImage.js";
import { createInspectionResources } from "../../fixtures/inspectionResources.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const sourceTarget = async (bytes: Uint8Array, sliceSize: number) => {
  const directory = await createTestTempDirectory(
    "rea-hopper-fat-coordinates-",
  );
  const path = join(directory, "source.fat");
  await writeFile(path, bytes);
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    kind: "executable",
    format: "mach-o-universal",
    architecture: "arm64",
    availableArchitectures: ["arm64"],
    universalSlice: { offset: 4096, size: sliceSize },
  } satisfies BinaryTarget;
};

const resolveImage = (
  target: BinaryTarget & { readonly kind: "executable" },
) => {
  const resources = createInspectionResources();
  onTestFinished(() => resources.close());
  return resolveHopperMachOImage(target, { resourceScope: resources.owner });
};

const loadedObservation = (header: Uint8Array) => ({
  address: "0x1000",
  provider_file_offset: 8,
  provider_source_path: null,
  provider_image_header_hex: Buffer.from(header)
    .subarray(0, 12)
    .toString("hex"),
});

it.each([
  { wide: false, littleEndian: false },
  { wide: false, littleEndian: true },
  { wide: true, littleEndian: false },
  { wide: true, littleEndian: true },
])(
  "keeps launch selection separate from loaded-image coordinates (wide=$wide littleEndian=$littleEndian)",
  async ({ wide, littleEndian }) => {
    const plain = machoImage({ cpu: CPU.arm64 });
    const arm64e = machoImage({ cpu: CPU.arm64e });
    const bytes = fatImage(
      [
        { cpu: CPU.arm64, bytes: plain },
        { cpu: CPU.arm64e, bytes: arm64e },
      ],
      wide,
      littleEndian,
    );
    const target = await sourceTarget(bytes, plain.byteLength);
    const selected = await resolveImage(target);
    expect(selected).toEqual({
      ok: true,
      value: {
        method: wide ? "fat64_thin_slice" : "fat32_thin_slice",
        architecture_count: 2,
        container_table_sha256: createHash("sha256")
          .update(bytes.subarray(0, 8 + 2 * (wide ? 32 : 20)))
          .digest("hex"),
        source_offset: 4096,
        byte_length: plain.byteLength,
        cpu_type: CPU.arm64.type,
        cpu_subtype: CPU.arm64.subtype,
      },
    });
    const mapped = await mapHopperFileOffset(target, loadedObservation(arm64e));
    expect(mapped).toEqual({
      ok: true,
      value: {
        address: "0x1000",
        file_offset: 8192 + 8,
        provider_file_offset: 8,
        image_base_file_offset: 8192,
        source_path: target.path,
      },
    });
  },
);

it.each([false, true])(
  "refuses a nonzero FAT64 reserved field in both consumers (littleEndian=%s)",
  async (littleEndian) => {
    const thin = machoImage({ cpu: CPU.arm64 });
    const bytes = fatImage(
      [{ cpu: CPU.arm64, bytes: thin }],
      true,
      littleEndian,
    );
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
      8 + 28,
      0x89abcdef,
      littleEndian,
    );
    const target = await sourceTarget(bytes, thin.byteLength);
    const reason = "FAT64 architecture 0 has a nonzero reserved field";
    expect(await resolveImage(target)).toMatchObject({
      ok: false,
      error: { _tag: "BinaryTargetError", reason },
    });
    expect(
      await mapHopperFileOffset(target, loadedObservation(thin)),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCapabilityUnavailableError",
        reason,
        partialObservation: {
          ...loadedObservation(thin),
          original_file_offset: { available: false, reason },
        },
      },
    });
  },
);

it.each([
  { wide: false, littleEndian: false },
  { wide: false, littleEndian: true },
  { wide: true, littleEndian: false },
  { wide: true, littleEndian: true },
])(
  "refuses overlapping valid slice headers in both consumers (wide=$wide littleEndian=$littleEndian)",
  async ({ wide, littleEndian }) => {
    const plain = machoImage({ cpu: CPU.arm64 });
    const arm64e = machoImage({ cpu: CPU.arm64e });
    const bytes = fatImage(
      [
        { cpu: CPU.arm64, bytes: plain },
        { cpu: CPU.arm64e, bytes: arm64e },
      ],
      wide,
      littleEndian,
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Both headers and ranges remain valid; the first range contains the second.
    if (wide)
      view.setBigUint64(
        8 + 16,
        4096n + BigInt(arm64e.byteLength),
        littleEndian,
      );
    else view.setUint32(8 + 12, 4096 + arm64e.byteLength, littleEndian);
    const target = await sourceTarget(bytes, 4096 + arm64e.byteLength);
    expect(await resolveImage(target)).toMatchObject({
      ok: false,
      error: { _tag: "BinaryTargetError", reason: "FAT slices overlap" },
    });
    expect(
      await mapHopperFileOffset(target, loadedObservation(arm64e)),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCapabilityUnavailableError",
        reason: "Original FAT slices overlap",
      },
    });
  },
);

it("requires a unique exact raw CPU identity for loaded-image attribution", async () => {
  const arm64e = machoImage({ cpu: CPU.arm64e });
  const bytes = fatImage([
    { cpu: CPU.arm64e, bytes: arm64e },
    { cpu: CPU.arm64e, bytes: arm64e },
  ]);
  const target = await sourceTarget(bytes, arm64e.byteLength);
  expect(
    await mapHopperFileOffset(target, loadedObservation(arm64e)),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCapabilityUnavailableError",
      reason: "Original FAT slice matching Hopper's loaded header is ambiguous",
    },
  });
  const withoutCapabilities = Buffer.from(arm64e);
  withoutCapabilities.writeUInt32LE(2, 8);
  expect(
    await mapHopperFileOffset(target, loadedObservation(withoutCapabilities)),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCapabilityUnavailableError",
      reason: "Original FAT slice matching Hopper's loaded header is missing",
    },
  });
});

it("checks all 12 loaded-header bytes after matching its CPU identity", async () => {
  const thin = machoImage({ cpu: CPU.arm64 });
  const target = await sourceTarget(
    fatImage([{ cpu: CPU.arm64, bytes: thin }]),
    thin.byteLength,
  );
  const loadedHeader = Buffer.alloc(12);
  // A big-endian header claims the same CPU identity but is not the source header.
  loadedHeader.writeUInt32BE(0xfeedfacf, 0);
  loadedHeader.writeUInt32BE(CPU.arm64.type, 4);
  loadedHeader.writeUInt32BE(CPU.arm64.subtype, 8);
  expect(
    await mapHopperFileOffset(target, loadedObservation(loadedHeader)),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCapabilityUnavailableError",
      reason: "Original FAT slice header disagrees with Hopper's loaded header",
    },
  });
});
