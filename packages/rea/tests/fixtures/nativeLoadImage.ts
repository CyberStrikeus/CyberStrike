import type {
  NativeLoadImage,
  NativeLoadImageObservation,
} from "../../src/domain/native/nativeLoadImage.js";

/** Authored domain observations; these projection fixtures run no provider. */
export const nativeLoadImageObservationFixture =
  (): NativeLoadImageObservation => ({
    executable_format: "Old-style DOS Executable (MZ)",
    language_id: "x86:LE:16:Real Mode",
    compiler_spec_id: "default",
    image_base: "0x0",
    default_address_space: "ram",
    source_files: [
      {
        name: "fixture.exe",
        size: 64,
        original_sha256: "a".repeat(64),
        modified_sha256: "a".repeat(64),
      },
    ],
    mappings: [
      {
        block: "module",
        start: "ram:0x0010",
        end: "ram:0x001f",
        address_space: "ram",
        initialized: true,
        loaded: true,
        overlay: false,
        length: 16,
        source_file_index: 0,
        file_offset: 32,
        sha256: "b".repeat(64),
      },
    ],
    relocations: [],
    entry_points: ["ram:0x0010"],
    entry_context: [],
  });

/** A recorded producer verification claim, not a runtime attestation by this fixture. */
export const nativeDosLoadImageFixture = (): Extract<
  NativeLoadImage,
  { format: "dos-mz" | "dos-com" }
> => ({
  status: "verified",
  format: "dos-mz",
  target_sha256: "a".repeat(64),
  load_segment: 0,
  header_bytes: 32,
  module_bytes: 32,
  overlay_bytes: 0,
  entry: { relative_segment: 0, offset: 16, linear_address: "ram:0x0010" },
  observations: nativeLoadImageObservationFixture(),
  checks: [
    {
      name: "original_file_sha256",
      matched: true,
      expected: "a".repeat(64),
      observed: "a".repeat(64),
      file_offset: null,
      address: null,
    },
  ],
  limitations: [],
});

export const nativeRawLoadImageFixture = (): Extract<
  NativeLoadImage,
  { format: "raw-binary" }
> => ({
  status: "verified",
  format: "raw-binary",
  target_sha256: "c".repeat(64),
  architecture: "x86_64",
  language_id: "x86:LE:64:default",
  compiler_spec_id: "gcc",
  base_address: "ram:0x00400000",
  file_bytes: 32,
  entry: { address: "ram:0x00400000", file_offset: 0 },
  observations: {
    ...nativeLoadImageObservationFixture(),
    executable_format: "Raw Binary",
    language_id: "x86:LE:64:default",
    compiler_spec_id: "gcc",
    image_base: "ram:0x00400000",
    entry_points: ["ram:0x00400000"],
  },
  checks: [],
  limitations: [],
});

export const nativeDolLoadImageFixture = (): Extract<
  NativeLoadImage,
  { format: "gamecube-dol" }
> => ({
  status: "mismatch",
  format: "gamecube-dol",
  target_sha256: "d".repeat(64),
  architecture: "powerpc",
  language_id: "PowerPC:BE:32:default",
  compiler_spec_id: "default",
  file_bytes: 288,
  entry: { address: "ram:0x80003100" },
  sections: [
    {
      kind: "text",
      index: 0,
      file_offset: "0x100",
      address: "ram:0x80003100",
      size: "0x10",
    },
    {
      kind: "data",
      index: 0,
      file_offset: "0x110",
      address: "ram:0x80004000",
      size: "0x10",
    },
  ],
  bss: { address: "ram:0x80005000", size: "0x20" },
  observations: {
    ...nativeLoadImageObservationFixture(),
    executable_format: "Nintendo GameCube DOL",
    language_id: "PowerPC:BE:32:default",
    image_base: "ram:0x80003100",
    entry_points: ["ram:0x80003100"],
  },
  checks: [
    {
      name: "bss",
      matched: false,
      expected: "0x20",
      observed: "0x10",
      file_offset: null,
      address: "ram:0x80005000",
    },
  ],
  limitations: [
    "Fixture records a BSS mismatch; this is not runtime coverage.",
  ],
});
