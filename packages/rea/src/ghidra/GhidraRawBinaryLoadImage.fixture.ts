import { createHash } from "node:crypto";

import type { NativeLoadImageObservation } from "../domain/native/nativeLoadImage.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";

const hash = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

export const fixtureRawBinaryLoadImage = (): {
  snapshot: { sha256: string; bytes: number };
  target: Extract<BinaryTarget, { format: "raw-binary" }>;
  observation: NativeLoadImageObservation;
} => {
  const bytes = Buffer.from("1eff2fe1", "hex");
  const digest = hash(bytes);
  return {
    snapshot: { sha256: digest, bytes: bytes.length },
    target: {
      path: "/tmp/ecu.bin",
      sha256: digest,
      kind: "executable",
      format: "raw-binary",
      architecture: "arm",
      availableArchitectures: ["arm"],
      entryPoint: "0x8000000",
      entryPointSource: "0x08000000",
    },
    observation: {
      executable_format: "Raw Binary",
      language_id: "ARM:LE:32:v7",
      compiler_spec_id: "default",
      image_base: "0x0",
      default_address_space: "ram",
      source_files: [
        {
          name: "ecu.bin",
          size: bytes.length,
          original_sha256: digest,
          modified_sha256: digest,
        },
      ],
      mappings: [
        {
          block: "ram",
          start: "0x8000000",
          end: "0x8000003",
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
      entry_points: ["0x8000000"],
      entry_context: [],
    },
  };
};
