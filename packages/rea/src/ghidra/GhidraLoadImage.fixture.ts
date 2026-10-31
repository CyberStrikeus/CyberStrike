import { parseMzHeaderEvidence } from "../domain/dosMz.js";
import { createHash } from "node:crypto";
import { dosMz } from "../domain/binaryTarget.fixture.js";
import type { NativeLoadImageObservation } from "../domain/native/nativeLoadImage.js";
import {
  attestGhidraDosLoadImage,
  prepareGhidraDosLoadImage,
} from "./GhidraLoadImageValues.js";
import { err } from "../domain/result.js";
import { GhidraSessionError } from "./GhidraSessionError.js";

const hash = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Buffered tiny-fixture input for comparison tests; production streams the descriptor. */
export const compareDosFixture = (
  bytes: Buffer,
  sha256: string,
  observations: NativeLoadImageObservation,
) => {
  if (hash(bytes) !== sha256)
    return err(
      "Ghidra load-image snapshot digest does not match the admitted target",
    );
  const image = prepareGhidraDosLoadImage(bytes, parseMzHeaderEvidence(bytes));
  if (!image.ok) return image;
  return attestGhidraDosLoadImage(
    {
      sha256,
      fileBytes: bytes.length,
      modifiedSha256: createHash("sha256")
        .update(image.value.modified)
        .update(bytes.subarray(image.value.header.imageBytes))
        .digest("hex"),
      image: image.value,
    },
    sha256,
    observations,
  );
};

export const compareDosClientFixture = (
  ...input: Parameters<typeof compareDosFixture>
) => {
  const compared = compareDosFixture(...input);
  return compared.ok
    ? compared
    : err(
        new GhidraSessionError("protocol", compared.error, {
          reason: compared.error,
        }),
      );
};

/** Source-owned MZ with one relocated word, overlay and uninitialized allocation. */
export const fixtureDosLoadImage = (
  overlay = Buffer.from("private-overlay-fixture"),
): {
  bytes: Buffer;
  sha256: string;
  observation: NativeLoadImageObservation;
} => {
  const original = dosMz();
  original.writeUInt16LE(1, 6);
  original.writeUInt16LE(9, 28);
  original.writeUInt16LE(0, 30);
  original.writeUInt16LE(4, 41);
  const bytes = Buffer.concat([original, overlay]);
  const modified = Buffer.from(bytes);
  modified.writeUInt16LE(0x1004, 41);
  return {
    bytes,
    sha256: hash(bytes),
    observation: {
      executable_format: "Old-style DOS Executable (MZ)",
      language_id: "x86:LE:16:Real Mode",
      compiler_spec_id: "default",
      image_base: "0x0",
      default_address_space: "ram",
      source_files: [
        {
          name: "fixture.exe",
          size: bytes.length,
          original_sha256: hash(bytes),
          modified_sha256: hash(modified),
        },
      ],
      mappings: [
        {
          block: "HEADER",
          start: "HEADER:0x0",
          end: "HEADER:0x1f",
          address_space: "HEADER",
          initialized: true,
          loaded: false,
          overlay: true,
          readable: true,
          writable: false,
          executable: false,
          length: 32,
          source_file_index: 0,
          file_offset: 0,
          sha256: hash(bytes.subarray(0, 32)),
        },
        {
          block: "CODE_0",
          start: "0x10000",
          end: "0x1007f",
          address_space: "ram",
          initialized: true,
          loaded: true,
          overlay: false,
          readable: true,
          writable: false,
          executable: true,
          length: 128,
          source_file_index: 0,
          file_offset: 32,
          sha256: hash(modified.subarray(32, 160)),
        },
        {
          block: "DATA",
          start: "0x10080",
          end: "0x1008f",
          address_space: "ram",
          initialized: false,
          loaded: true,
          overlay: false,
          readable: true,
          writable: true,
          executable: false,
          length: 16,
          source_file_index: null,
          file_offset: null,
          sha256: null,
        },
      ],
      relocations: [
        {
          address: "0x10009",
          segment: 0x1000,
          offset: 9,
          status: "APPLIED",
          type: 0,
          values: [0, 9, 0x1004],
          original_bytes_hex: "0400",
          memory_bytes_hex: "0410",
        },
      ],
      entry_context: [],
      entry_points: ["0x10000"],
    },
  };
};

/** Authored overlapping-word control adapted from #4156; no engine is run here. */
export const fixtureDosOverlapLoadImage = () => {
  const fixture = fixtureDosLoadImage();
  const bytes = Buffer.concat([
    fixture.bytes.subarray(0, 32),
    Buffer.alloc(16),
    fixture.bytes.subarray(32),
  ]);
  bytes.writeUInt16LE(176, 2);
  bytes.writeUInt16LE(2, 6);
  bytes.writeUInt16LE(3, 8);
  bytes.writeUInt32LE(9, 28);
  bytes.writeUInt32LE(8, 32);
  const modified = Buffer.from(bytes);
  // Independent final-byte oracle: source 00 04 00 becomes 00 14 10.
  modified.write("001410", 56, "hex");
  const observation = fixture.observation;
  const source = observation.source_files[0];
  const headerMapping = observation.mappings[0];
  const moduleMapping = observation.mappings[1];
  if (
    source === undefined ||
    headerMapping === undefined ||
    moduleMapping === undefined
  )
    throw new Error("Missing base MZ fixture source mappings");
  Object.assign(source, {
    size: bytes.length,
    original_sha256: hash(bytes),
    modified_sha256: hash(modified),
  });
  Object.assign(headerMapping, {
    end: "HEADER:0x2f",
    length: 48,
    sha256: hash(bytes.subarray(0, 48)),
  });
  Object.assign(moduleMapping, {
    file_offset: 48,
    sha256: hash(modified.subarray(48, 176)),
  });
  observation.relocations = [
    {
      address: "0x10009",
      segment: 0x1000,
      offset: 9,
      status: "APPLIED",
      type: 0,
      values: [0, 9, 0x1004],
      original_bytes_hex: "0400",
      memory_bytes_hex: "1410",
    },
    {
      address: "0x10008",
      segment: 0x1000,
      offset: 8,
      status: "APPLIED",
      type: 0,
      values: [0, 8, 0x1400],
      original_bytes_hex: "0004",
      memory_bytes_hex: "0014",
    },
  ];
  return { bytes, sha256: hash(bytes), observation };
};

/** Source-owned headerless COM image and measured real-mode import facts. */
export const fixtureDosComLoadImage = (): {
  bytes: Buffer;
  sha256: string;
  observation: NativeLoadImageObservation;
} => {
  const bytes = Buffer.from("b83412c3", "hex");
  const digest = hash(bytes);
  return {
    bytes,
    sha256: digest,
    observation: {
      executable_format: "Raw Binary",
      language_id: "x86:LE:16:Real Mode",
      compiler_spec_id: "default",
      image_base: "0x0",
      default_address_space: "ram",
      source_files: [
        {
          name: "fixture.com",
          size: bytes.length,
          original_sha256: digest,
          modified_sha256: digest,
        },
      ],
      mappings: [
        {
          block: "ram",
          start: "0x10100",
          end: "0x10103",
          address_space: "ram",
          initialized: true,
          loaded: true,
          overlay: false,
          readable: true,
          writable: false,
          executable: true,
          length: bytes.length,
          source_file_index: 0,
          file_offset: 0,
          sha256: digest,
        },
      ],
      relocations: [],
      entry_points: ["0x10100"],
      entry_context: [
        {
          address: "0x10100",
          registers: ["CS", "DS", "ES", "SS"].map((name) => ({
            name,
            value_hex: "0x1000",
          })),
        },
      ],
    },
  };
};
