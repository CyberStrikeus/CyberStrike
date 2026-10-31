import { constants as zlibConstants, crc32, inflateSync } from "node:zlib";

import type {
  CompareWebScreenshotsInput,
  WebScreenshotArtifact,
  WebScreenshotDiff,
} from "../domain/webScreenshot.js";
import {
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import { decodeCanonicalBase64 } from "../domain/webScreenshot.js";
import { hasPngSignature, readPngIhdrFacts } from "../domain/pngHeader.js";

interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly rgba: Buffer;
}

interface ParsedPng {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly compressed: readonly Buffer[];
  readonly transparentColor: readonly number[] | undefined;
  readonly expectedRawBytes: bigint;
  readonly unfilteredBytes: bigint;
  readonly rgbaBytes: bigint;
}

/** Conservative allowance for the simultaneously live PNG comparison buffers. */
const PNG_COMPARISON_WORKING_MEMORY_BYTES = 256 * 1024 * 1024;
const PNG_INFLATE_CHUNK_BYTES = zlibConstants.Z_DEFAULT_CHUNK;

/** Compare two validated screenshots using deterministic RGBA metrics. */
export const comparePngScreenshots = (
  input: CompareWebScreenshotsInput,
): WebScreenshotDiff => {
  admitEncodedInputPair(input.before, input.after);
  const beforePlan = parsePng(input.before, "before");
  const afterPlan = parsePng(input.after, "after");
  admitPngPair(beforePlan, afterPlan);
  const before = decodePng(beforePlan);
  const after = decodePng(afterPlan);
  if (before.width !== after.width || before.height !== after.height)
    return {
      status: "dimension_mismatch",
      before: dimensions(before),
      after: dimensions(after),
      channel_threshold: input.channel_threshold,
      compared_pixels: 0,
      changed_pixels: null,
      changed_ratio: null,
      maximum_channel_delta: null,
      mean_absolute_channel_delta: null,
      limitations: limitations(),
    };
  let changedPixels = 0;
  let maximumDelta = 0;
  let totalDelta = 0;
  for (let offset = 0; offset < before.rgba.length; offset += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(
        (before.rgba[offset + channel] ?? 0) -
          (after.rgba[offset + channel] ?? 0),
      );
      totalDelta += delta;
      maximumDelta = Math.max(maximumDelta, delta);
      if (delta > input.channel_threshold) changed = true;
    }
    if (changed) changedPixels += 1;
  }
  const pixels = before.width * before.height;
  const context = {
    before: dimensions(before),
    after: dimensions(after),
    channel_threshold: input.channel_threshold,
    compared_pixels: pixels,
    maximum_channel_delta: maximumDelta,
    mean_absolute_channel_delta: totalDelta / (pixels * 4),
    limitations: limitations(),
  };
  if (changedPixels === 0)
    return {
      ...context,
      status: "identical",
      changed_pixels: 0,
      changed_ratio: 0,
    };
  return {
    ...context,
    status: "different",
    changed_pixels: changedPixels,
    changed_ratio: changedPixels / pixels,
  };
};

const parsePng = (
  artifact: WebScreenshotArtifact,
  field: "before" | "after",
): ParsedPng => {
  const bytes = decodeCanonicalBase64(artifact.data_base64);
  if (bytes === undefined || !hasPngSignature(bytes))
    throw new TypeError("Invalid PNG signature");
  let offset = 8;
  let header: ReturnType<typeof parseHeader> | undefined;
  const compressed: Buffer[] = [];
  let sawEnd = false;
  let sawPalette = false;
  let imageDataEnded = false;
  let paletteEntries = 0;
  let transparentColor: readonly number[] | undefined;
  let sawTransparency = false;
  let unsupportedReason: string | undefined;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new TypeError("Truncated PNG chunk");
    const length = bytes.readUInt32BE(offset);
    if (length > 0x7fffffff) throw new TypeError("Invalid PNG chunk length");
    const type = bytes.subarray(offset + 4, offset + 8).toString("latin1");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new TypeError("Truncated PNG data");
    const data = bytes.subarray(dataStart, dataEnd);
    if (
      crc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)
    )
      throw new TypeError("Invalid PNG chunk checksum");
    if (!/^[A-Za-z]{4}$/u.test(type) || type[2] !== type[2]?.toUpperCase())
      throw new TypeError("Invalid PNG chunk type");
    if (type !== "IDAT" && compressed.length > 0) imageDataEnded = true;
    if (type === "IHDR") {
      if (offset !== 8 || header !== undefined)
        throw new TypeError("Invalid PNG header order");
      header = parseHeader(data);
    } else if (header === undefined)
      throw new TypeError("Invalid PNG header order");
    else if (type === "tRNS") {
      if (sawTransparency || compressed.length > 0)
        throw new TypeError("Invalid PNG transparency order");
      sawTransparency = true;
      if (header.colorType === 2 && data.length === 6) {
        transparentColor = [
          data.readUInt16BE(0),
          data.readUInt16BE(2),
          data.readUInt16BE(4),
        ];
      } else if (
        (header.colorType === 0 && data.length === 2) ||
        (header.colorType === 3 &&
          sawPalette &&
          data.length > 0 &&
          data.length <= paletteEntries)
      ) {
        unsupportedReason ??=
          "PNG transparency for this color type is not supported.";
      } else {
        throw new TypeError("Unsupported PNG transparency");
      }
    } else if (type === "PLTE") {
      if (
        sawPalette ||
        sawTransparency ||
        compressed.length > 0 ||
        length === 0 ||
        length > 768 ||
        length % 3 !== 0 ||
        (header.colorType === 3 && length / 3 > 2 ** header.bitDepth) ||
        (header.colorType !== 2 &&
          header.colorType !== 3 &&
          header.colorType !== 6)
      )
        throw new TypeError("Invalid PNG palette");
      sawPalette = true;
      paletteEntries = length / 3;
    } else if (type === "IDAT") {
      if (imageDataEnded) throw new TypeError("Nonconsecutive PNG image data");
      compressed.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || dataEnd + 4 !== bytes.length)
        throw new TypeError("Invalid PNG end chunk");
      sawEnd = true;
      break;
    } else if (/^[A-Z]/u.test(type)) {
      unsupportedReason ??= `Unsupported critical PNG chunk ${type}.`;
    }
    offset = dataEnd + 4;
  }
  if (header === undefined || !sawEnd || compressed.length === 0)
    throw new TypeError("Incomplete PNG");
  if (header.colorType === 3 && !sawPalette)
    throw new TypeError("Missing PNG palette");
  if (unsupportedReason !== undefined)
    throw new AnalysisUnsupportedTargetError(
      "compare_web_screenshots",
      field,
      unsupportedReason,
    );
  if (!header.supported)
    throw new AnalysisUnsupportedTargetError(
      "compare_web_screenshots",
      field,
      "PNG encoding is not supported for pixel comparison.",
    );
  const pixels = BigInt(header.width) * BigInt(header.height);
  const expectedRawBytes =
    (BigInt(header.width) * BigInt(header.channels) + 1n) *
    BigInt(header.height);
  return {
    bytes,
    width: header.width,
    height: header.height,
    channels: header.channels,
    compressed,
    transparentColor,
    expectedRawBytes,
    unfilteredBytes: pixels * BigInt(header.channels),
    rgbaBytes: pixels * 4n,
  };
};

const decodePng = (plan: ParsedPng): DecodedPng => {
  const expected = Number(plan.expectedRawBytes);
  const raw = inflatePng(Buffer.concat(plan.compressed), expected + 1);
  if (raw.byteLength !== expected) throw new TypeError("Unexpected PNG size");
  return {
    width: plan.width,
    height: plan.height,
    rgba: expandRgba(
      unfilter(raw, plan.width, plan.height, plan.channels),
      plan.channels,
      plan.transparentColor,
    ),
  };
};

const admitEncodedInputPair = (
  before: WebScreenshotArtifact,
  after: WebScreenshotArtifact,
): void => {
  const sourceBytes = BigInt(before.bytes) + BigInt(after.bytes);
  if (sourceBytes > BigInt(PNG_COMPARISON_WORKING_MEMORY_BYTES))
    throw pngWorkingMemoryError(sourceBytes, null, null);
};

const admitPngPair = (before: ParsedPng, after: ParsedPng): void => {
  // Input buffers remain live for both plans. For each decode, count the
  // concatenated IDAT, rounded zlib output chunks, any concatenated output and
  // unfiltered rows, plus RGB-to-RGBA output. The first completed RGBA image
  // remains live while the second is decoded.
  const inputBytes = BigInt(before.bytes.byteLength + after.bytes.byteLength);
  const estimate = (current: ParsedPng, retained: ParsedPng | undefined) => {
    const compressedBytes = current.compressed.reduce(
      (total, chunk) => total + BigInt(chunk.byteLength),
      0n,
    );
    const rgbaExpansion = current.channels === 3 ? current.rgbaBytes : 0n;
    return (
      inputBytes +
      (retained?.rgbaBytes ?? 0n) +
      compressedBytes +
      inflateBufferAllowance(current.expectedRawBytes) +
      current.unfilteredBytes +
      rgbaExpansion
    );
  };
  const estimateBytes = [
    estimate(before, undefined),
    estimate(after, before),
  ].reduce((maximum, value) => (value > maximum ? value : maximum), 0n);
  if (estimateBytes > BigInt(PNG_COMPARISON_WORKING_MEMORY_BYTES))
    throw pngWorkingMemoryError(estimateBytes, before, after);
};

const inflateBufferAllowance = (expectedRawBytes: bigint): bigint => {
  const chunkBytes = BigInt(PNG_INFLATE_CHUNK_BYTES);
  const maximumOutputBytes = expectedRawBytes + 1n;
  const roundUpToChunk = (bytes: bigint): bigint =>
    ((bytes + chunkBytes - 1n) / chunkBytes) * chunkBytes;

  // Node checks maxOutputLength after writing a chunk, so a rejected stream can
  // retain one chunk's worth of output past the limit before it throws.
  const rejectedOutputChunks = roundUpToChunk(
    maximumOutputBytes + chunkBytes - 1n,
  );

  // Sync zlib retains each output chunk while Buffer.concat creates the final
  // result. A full final chunk also allocates the next scratch chunk first.
  const returnedOutputChunks = roundUpToChunk(maximumOutputBytes);
  const scratchChunk =
    expectedRawBytes % chunkBytes === 0n ||
    maximumOutputBytes % chunkBytes === 0n
      ? chunkBytes
      : 0n;
  const concatenatedOutput =
    maximumOutputBytes > chunkBytes ? maximumOutputBytes : 0n;
  const returnedOutput =
    returnedOutputChunks + scratchChunk + concatenatedOutput;

  return rejectedOutputChunks > returnedOutput
    ? rejectedOutputChunks
    : returnedOutput;
};

const pngWorkingMemoryError = (
  estimateBytes: bigint,
  before: Pick<ParsedPng, "width" | "height"> | null,
  after: Pick<ParsedPng, "width" | "height"> | null,
) =>
  new AnalysisResourceConstraintError(
    "compare_web_screenshots",
    "memory",
    "Screenshot comparison exceeds REA's 256 MiB estimated working-memory budget.",
    {
      boundary: "png-screenshot-comparison",
      estimated_working_memory_bytes: estimateBytes.toString(),
      maximum_working_memory_bytes: PNG_COMPARISON_WORKING_MEMORY_BYTES,
      before_dimensions:
        before === null ? null : { width: before.width, height: before.height },
      after_dimensions:
        after === null ? null : { width: after.width, height: after.height },
    },
    {
      remediationAction:
        "Compare smaller screenshots or reduce their viewport dimensions before capture.",
    },
  );

const inflatePng = (compressed: Buffer, maxOutputLength: number): Buffer => {
  try {
    return inflateSync(compressed, {
      maxOutputLength,
      chunkSize: PNG_INFLATE_CHUNK_BYTES,
    });
  } catch (cause: unknown) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause.code === "Z_DATA_ERROR" ||
        cause.code === "Z_BUF_ERROR" ||
        cause.code === "ERR_BUFFER_TOO_LARGE")
    )
      throw new TypeError("Invalid PNG image data", { cause });
    throw cause;
  }
};

const parseHeader = (data: Buffer) => {
  const parsed = readPngIhdrFacts(data);
  if (!parsed.ok) throw new TypeError(parsed.error);
  const {
    width,
    height,
    bitDepth,
    colorType,
    compressionMethod,
    filterMethod,
    interlaceMethod,
  } = parsed.value;
  const validDepth =
    (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
    (colorType === 2 && [8, 16].includes(bitDepth)) ||
    (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
    (colorType === 4 && [8, 16].includes(bitDepth)) ||
    (colorType === 6 && [8, 16].includes(bitDepth));
  if (
    !validDepth ||
    compressionMethod !== 0 ||
    filterMethod !== 0 ||
    (interlaceMethod !== 0 && interlaceMethod !== 1)
  )
    throw new TypeError("Invalid PNG header");
  return {
    width,
    height,
    colorType,
    bitDepth,
    interlace: interlaceMethod,
    channels: colorType === 6 ? 4 : 3,
    supported:
      bitDepth === 8 &&
      (colorType === 2 || colorType === 6) &&
      interlaceMethod === 0,
  };
};

const unfilter = (
  raw: Buffer,
  width: number,
  height: number,
  channels: number,
): Buffer => {
  const rowBytes = width * channels;
  const decoded = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (rowBytes + 1);
    const outputOffset = row * rowBytes;
    const filter = raw[rawOffset];
    if (filter === undefined || filter > 4)
      throw new TypeError("Unsupported PNG filter");
    for (let column = 0; column < rowBytes; column += 1) {
      const source = raw[rawOffset + 1 + column] ?? 0;
      const left =
        column >= channels
          ? (decoded[outputOffset + column - channels] ?? 0)
          : 0;
      const above =
        row > 0 ? (decoded[outputOffset + column - rowBytes] ?? 0) : 0;
      const upperLeft =
        row > 0 && column >= channels
          ? (decoded[outputOffset + column - rowBytes - channels] ?? 0)
          : 0;
      decoded[outputOffset + column] = applyFilter({
        filter,
        source,
        left,
        above,
        upperLeft,
      });
    }
  }
  return decoded;
};

const expandRgba = (
  decoded: Buffer,
  channels: number,
  transparentColor: readonly number[] | undefined,
): Buffer => {
  if (channels === 4) return decoded;
  const rgba = Buffer.alloc((decoded.length / channels) * 4);
  for (
    let source = 0, target = 0;
    source < decoded.length;
    source += 3, target += 4
  ) {
    rgba[target] = decoded[source] ?? 0;
    rgba[target + 1] = decoded[source + 1] ?? 0;
    rgba[target + 2] = decoded[source + 2] ?? 0;
    // PNG tRNS keys are 16-bit values; values above 255 cannot match 8-bit samples.
    rgba[target + 3] =
      transparentColor !== undefined &&
      transparentColor.every(
        (value, channel) => decoded[source + channel] === value,
      )
        ? 0
        : 255;
  }
  return rgba;
};

interface ApplyFilterOptions {
  readonly filter: number;
  readonly source: number;
  readonly left: number;
  readonly above: number;
  readonly upperLeft: number;
}

const applyFilter = (options: ApplyFilterOptions): number => {
  const { filter, source, left, above, upperLeft } = options;
  switch (filter) {
    case 0:
      return source;
    case 1:
      return (source + left) & 0xff;
    case 2:
      return (source + above) & 0xff;
    case 3:
      return (source + Math.floor((left + above) / 2)) & 0xff;
    case 4:
      return (source + paeth(left, above, upperLeft)) & 0xff;
    default:
      throw new TypeError("Unsupported PNG filter");
  }
};

const paeth = (left: number, above: number, upperLeft: number): number => {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance
      ? above
      : upperLeft;
};

const dimensions = ({ width, height }: DecodedPng) => ({ width, height });

const limitations = (): string[] => [
  "Pixel comparison does not perform OCR, semantic layout analysis, or perceptual color correction.",
  "Only non-interlaced 8-bit RGB and RGBA PNG screenshots are accepted.",
  "PNG tRNS transparency is accepted only as a six-byte RGB color key; tRNS on RGBA or with another length is rejected.",
];
