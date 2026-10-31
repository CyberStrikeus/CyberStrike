import { nodeCodecResult } from "../compression/NodeCodecResult.js";
import { constants, inflate, zstdDecompress } from "node:zlib";
import { promisify } from "node:util";
import { assertArtifactReadActive } from "../artifacts/ArtifactFileOperation.js";
import { decodeLz4Block } from "./Lz4Block.js";
import { rejectGpu } from "./GpuSource.js";
const unzip = promisify(inflate);
const unzstd = promisify(zstdDecompress);
/** Completed codec bytes and their encoded extent share one completion owner. */
export const decodeGpuPayloadStream = async (
  bytes: Buffer,
  compression: "zlib" | "zstd",
  maximumDecodedSize: number,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; consumedBytes: number }> => {
  assertArtifactReadActive(signal);
  let result: unknown;
  try {
    const maxOutputLength = Math.max(1, maximumDecodedSize);
    result = await (compression === "zstd"
      ? unzstd(bytes, {
          maxOutputLength,
          info: true,
          params: { [constants.ZSTD_d_windowLogMax]: 27 },
        })
      : unzip(bytes, { maxOutputLength, info: true }));
  } catch {
    assertArtifactReadActive(signal);
    return rejectGpu(
      "GPU payload decompression failed or exceeded its declared length",
    );
  }
  assertArtifactReadActive(signal);
  const { buffer: decoded, consumedBytes: consumed } = nodeCodecResult(result);
  if (
    !Number.isSafeInteger(consumed) ||
    consumed <= 0 ||
    consumed > bytes.length
  )
    rejectGpu("GPU decoder returned an invalid complete codec extent");
  return { buffer: decoded, consumedBytes: consumed };
};
export const decodeGpuPayload = async (
  bytes: Buffer,
  compression: "zlib" | "zstd" | "lz4",
  expected: number,
  signal?: AbortSignal,
): Promise<Buffer> => {
  assertArtifactReadActive(signal);
  if (compression === "lz4") return decodeLz4Block(bytes, expected, signal);
  const decoded = await decodeGpuPayloadStream(
    bytes,
    compression,
    expected,
    signal,
  );
  if (decoded.consumedBytes !== bytes.length)
    rejectGpu(
      "GPU compressed payload contains bytes outside its complete codec stream",
    );
  if (decoded.buffer.length !== expected)
    rejectGpu("GPU decompressed length disagrees with its declaration");
  return decoded.buffer;
};
