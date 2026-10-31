import { describe, expect, it } from "vitest";
import { attestGhidraDosComLoadImage } from "./GhidraLoadImageValues.js";
import { fixtureDosComLoadImage } from "./GhidraLoadImage.fixture.js";
import {
  nativeLoadImageObservationSchema,
  nativeLoadImageSchema,
  type NativeLoadImageObservation,
} from "../domain/native/nativeLoadImage.js";

const mutations: ReadonlyArray<
  readonly [string, (o: NativeLoadImageObservation) => void]
> = [
  [
    "memory bytes",
    (o) => {
      if (o.mappings[0]) o.mappings[0].sha256 = "f".repeat(64);
    },
  ],
  [
    "file mapping",
    (o) => {
      if (o.mappings[0]) o.mappings[0].file_offset = 1;
    },
  ],
  [
    "missing mapping",
    (o) => {
      o.mappings = [];
    },
  ],
  [
    "duplicate mapping",
    (o) => {
      if (o.mappings[0]) o.mappings.push(structuredClone(o.mappings[0]));
    },
  ],
  [
    "entry",
    (o) => {
      o.entry_points = ["0x10000"];
    },
  ],
  [
    "missing context",
    (o) => {
      o.entry_context = [];
    },
  ],
  [
    "wrong context",
    (o) => {
      if (o.entry_context[0]?.registers[0])
        o.entry_context[0].registers[0].value_hex = "0x0";
    },
  ],
  [
    "language",
    (o) => {
      o.language_id = "x86:LE:32:default";
    },
  ],
  [
    "source identity",
    (o) => {
      if (o.source_files[0]) o.source_files[0].original_sha256 = "f".repeat(64);
    },
  ],
  [
    "modified source",
    (o) => {
      if (o.source_files[0]) o.source_files[0].modified_sha256 = "f".repeat(64);
    },
  ],
  [
    "unexpected fixup",
    (o) => {
      o.relocations.push({
        address: "0x10100",
        segment: 0x1000,
        offset: 0x100,
        status: "APPLIED",
        type: 0,
        values: [],
        original_bytes_hex: null,
        memory_bytes_hex: null,
      });
    },
  ],
];
describe("COM independent load-image checks", () => {
  it("verifies all bytes and the imposed entry context without a PSP claim", () => {
    const f = fixtureDosComLoadImage();
    const result = attestGhidraDosComLoadImage(
      f.bytes,
      f.sha256,
      f.observation,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "verified",
        format: "dos-com",
        header_bytes: 0,
        module_bytes: 4,
        overlay_bytes: 0,
        entry: {
          relative_segment: 0,
          offset: 0x100,
          linear_address: "0x10100",
        },
      },
    });
  });
  it.each(mutations)("retains mismatch evidence for %s", (_name, damage) => {
    const f = fixtureDosComLoadImage();
    damage(f.observation);
    const result = attestGhidraDosComLoadImage(
      f.bytes,
      f.sha256,
      f.observation,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { status: "mismatch", observations: f.observation },
    });
  });
  it("accepts an older observation without measured permissions", () => {
    const f = fixtureDosComLoadImage();
    for (const mapping of f.observation.mappings) {
      delete mapping.readable;
      delete mapping.writable;
      delete mapping.executable;
    }
    expect(
      nativeLoadImageObservationSchema.safeParse(f.observation).success,
    ).toBe(true);
    const result = attestGhidraDosComLoadImage(
      f.bytes,
      f.sha256,
      f.observation,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { status: "verified", format: "dos-com" },
    });
    if (!result.ok) throw new Error(result.error);
    expect(nativeLoadImageSchema.safeParse(result.value).success).toBe(true);
  });

  it("rejects stale snapshot identity", () => {
    const f = fixtureDosComLoadImage();
    expect(
      attestGhidraDosComLoadImage(f.bytes, "f".repeat(64), f.observation).ok,
    ).toBe(false);
  });
});
