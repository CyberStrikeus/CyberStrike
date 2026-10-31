import type { GpuObject } from "../domain/gpu/gpuCodeObjects.js";
import { assertArtifactReadActive } from "../artifacts/ArtifactFileOperation.js";
import {
  gpuCount,
  nextGpuContainerOffset,
  rejectGpu,
  type GpuSource,
} from "./GpuSource.js";
import { gpuObject } from "./GpuObject.js";
export async function* readCudaFatbinary(
  source: GpuSource,
  signal?: AbortSignal,
): AsyncGenerator<GpuObject> {
  let base = 0;
  while (base < source.size) {
    const header = await source.read(base, 16);
    if (header.readUInt32LE(0) !== 0xba55ed50)
      rejectGpu("Unexpected bytes between CUDA fatbinary records");
    if (header.readUInt16LE(4) !== 1 || header.readUInt16LE(6) < 16)
      rejectGpu("Unsupported CUDA fatbinary header");
    const start = base + header.readUInt16LE(6),
      length = gpuCount(header.readBigUInt64LE(8));
    if (start > source.size || length > source.size - start)
      rejectGpu("CUDA fatbinary extent is truncated");
    const end = start + length;
    for (let position = start; position < end;) {
      assertArtifactReadActive(signal);
      if (end - position < 64) rejectGpu("CUDA entry header is truncated");
      const h = await source.read(position, 64);
      const kind = h.readUInt16LE(0),
        version = h.readUInt16LE(2),
        width = h.readUInt32LE(4);
      const padded = gpuCount(h.readBigUInt64LE(8)),
        encoded = h.readUInt32LE(16),
        flags = h.readBigUInt64LE(40);
      if (
        width < 64 ||
        width > end - position ||
        padded > end - position - width ||
        encoded > padded
      )
        rejectGpu("CUDA entry extent is invalid");
      const compressed = (flags & 0xb000n) !== 0n;
      const row = gpuObject(source, {
        offset: position + width,
        size: compressed ? encoded : padded,
        kind: kind === 1 ? "ptx" : kind === 2 ? "cubin" : "unknown",
        metadata: { offset: position, size: width },
      });
      const architectureSuffix =
        (flags & 0x100000n) !== 0n
          ? "a"
          : (flags & 0x200000n) !== 0n
            ? "f"
            : "";
      row.target = `sm_${h.readUInt32LE(28)}${architectureSuffix}`;
      row.raw_flags = `0x${flags.toString(16)}`;
      row.compression =
        (flags & 0x8000n) !== 0n && (flags & 0x2000n) === 0n
          ? "zstd"
          : (flags & 0x2000n) !== 0n && (flags & 0x8000n) === 0n
            ? "lz4"
            : compressed
              ? "unsupported"
              : "none";
      row.compression_id = compressed ? `cuda-flags:${row.raw_flags}` : null;
      row.decoded_size = compressed ? gpuCount(h.readBigUInt64LE(56)) : padded;
      if (compressed && (encoded === 0 || row.decoded_size === 0))
        rejectGpu("Compressed CUDA entry has an empty declared extent");
      if (version !== 0x101) {
        row.compression = "unsupported";
        row.target = null;
        row.decoded_size = null;
        row.limitations.push(
          `CUDA entry version 0x${version.toString(16)} is not decoded`,
        );
      }
      if (row.compression === "unsupported")
        row.limitations.push(
          "This CUDA compression/version is not supported; original encoded bytes and target declarations remain located",
        );
      yield row;
      position += width + padded;
    }
    base = await nextGpuContainerOffset(source, end);
  }
}
