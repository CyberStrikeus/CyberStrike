import { parseMzHeaderEvidence } from "../domain/dosMz.js";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  compareDosFixture,
  fixtureDosLoadImage,
} from "./GhidraLoadImage.fixture.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import {
  nativeLoadImageObservationSchema,
  nativeLoadImageSchema,
} from "../domain/native/nativeLoadImage.js";
import type { NativeLoadImageObservation } from "../domain/native/nativeLoadImage.js";
import { parseGhidraInventoryResult } from "./GhidraInventoryValues.js";
import { prepareGhidraDosLoadImage } from "./GhidraLoadImageValues.js";

it("accepts DOS header padding after a complete relocation table", () => {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt16LE(128, 2);
  bytes.writeUInt16LE(1, 4);
  bytes.writeUInt16LE(2, 6);
  bytes.writeUInt16LE(4, 8);
  bytes.writeUInt16LE(28, 24);
  bytes.write("ABCD", 60, "ascii");
  expect(
    prepareGhidraDosLoadImage(bytes, parseMzHeaderEvidence(bytes)),
  ).toMatchObject({
    ok: true,
    value: {
      header: {
        headerBytes: 64,
        imageBytes: 128,
        moduleBytes: 64,
        overlayBytes: 0,
        relocationCount: 2,
        relocationTableOffset: 28,
      },
      loadSegment: 0x1000,
    },
  });
});

it.each([0, 1])(
  "prioritizes an unresolved Windows-header candidate over DOS page validity (pages=%s)",
  (pages) => {
    const bytes = Buffer.alloc(128);
    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt16LE(128, 2);
    bytes.writeUInt16LE(pages, 4);
    bytes.writeUInt16LE(0, 6);
    bytes.writeUInt16LE(4, 8);
    bytes.writeUInt16LE(28, 24);
    bytes.write("ABCD", 60, "ascii");
    expect(
      prepareGhidraDosLoadImage(bytes, parseMzHeaderEvidence(bytes)),
    ).toEqual({
      ok: false,
      error: "MZ Windows new-header candidate is unresolved",
    });
  },
);

const damage: ReadonlyArray<
  readonly [string, (observation: NativeLoadImageObservation) => void]
> = [
  [
    "memory byte",
    (x) => {
      if (x.mappings[1]) x.mappings[1].sha256 = "f".repeat(64);
    },
  ],
  [
    "header byte",
    (x) => {
      if (x.mappings[0]) x.mappings[0].sha256 = "f".repeat(64);
    },
  ],
  [
    "modified source",
    (x) => {
      x.source_files[0] && (x.source_files[0].modified_sha256 = "f".repeat(64));
    },
  ],
  [
    "original source",
    (x) => {
      x.source_files[0] && (x.source_files[0].original_sha256 = "f".repeat(64));
    },
  ],
  [
    "source length",
    (x) => {
      if (x.source_files[0]) x.source_files[0].size--;
    },
  ],
  [
    "source identity",
    (x) => {
      if (x.mappings[1]) x.mappings[1].source_file_index = 1;
    },
  ],
  [
    "missing mapping",
    (x) => {
      x.mappings.splice(1, 1);
    },
  ],
  [
    "duplicate mapping",
    (x) => {
      if (x.mappings[1]) x.mappings.push(structuredClone(x.mappings[1]));
    },
  ],
  [
    "gap",
    (x) => {
      if (x.mappings[1]) x.mappings[1].file_offset = 33;
    },
  ],
  [
    "overlap",
    (x) => {
      if (x.mappings[1]) x.mappings[1].file_offset = 31;
    },
  ],
  [
    "alias address",
    (x) => {
      if (x.mappings[1]) x.mappings[1].start = "0x10001";
    },
  ],
  [
    "end address",
    (x) => {
      if (x.mappings[1]) x.mappings[1].end = "0x10080";
    },
  ],
  [
    "wrong address space",
    (x) => {
      x.default_address_space = "wrong";
    },
  ],
  [
    "header loaded",
    (x) => {
      if (x.mappings[0]) x.mappings[0].loaded = true;
    },
  ],
  [
    "module overlay",
    (x) => {
      if (x.mappings[1]) x.mappings[1].overlay = true;
    },
  ],
  [
    "uninitialized module",
    (x) => {
      if (x.mappings[1]) x.mappings[1].initialized = false;
    },
  ],
  [
    "complex source mapping",
    (x) => {
      if (x.mappings[1]) x.mappings[1].file_offset = null;
    },
  ],
  [
    "missing relocation",
    (x) => {
      x.relocations = [];
    },
  ],
  [
    "duplicate relocation",
    (x) => {
      if (x.relocations[0])
        x.relocations.push(structuredClone(x.relocations[0]));
    },
  ],
  [
    "relocation word",
    (x) => {
      if (x.relocations[0]) x.relocations[0].memory_bytes_hex = "0400";
    },
  ],
  [
    "relocation metadata",
    (x) => {
      if (x.relocations[0]) x.relocations[0].values = [0, 9, 4];
    },
  ],
  [
    "relocation status",
    (x) => {
      if (x.relocations[0]) x.relocations[0].status = "FAILURE";
    },
  ],
  [
    "relocation segment",
    (x) => {
      if (x.relocations[0]) x.relocations[0].segment = 0;
    },
  ],
  [
    "entry",
    (x) => {
      x.entry_points = ["0x10001"];
    },
  ],
  [
    "extra entry",
    (x) => {
      x.entry_points.push("0x10010");
    },
  ],
  [
    "loader",
    (x) => {
      x.executable_format = "Raw Binary";
    },
  ],
  [
    "language",
    (x) => {
      x.language_id = "x86:LE:32:default";
    },
  ],
  [
    "compiler",
    (x) => {
      x.compiler_spec_id = "windows";
    },
  ],
  [
    "image base",
    (x) => {
      x.image_base = "0x10000";
    },
  ],
  [
    "extra source file",
    (x) => {
      if (x.source_files[0])
        x.source_files.push(structuredClone(x.source_files[0]));
    },
  ],
  [
    "initialized unbacked alias",
    (x) => {
      if (x.mappings[2]) x.mappings[2].initialized = true;
    },
  ],
  [
    "overlay source mapping",
    (x) => {
      const row = x.mappings[1];
      if (row)
        x.mappings.push({
          ...row,
          file_offset: 160,
          length: 23,
          start: "0x10080",
          end: "0x10096",
        });
    },
  ],
];

const malformedCoordinates: ReadonlyArray<
  readonly [string, (observation: NativeLoadImageObservation) => void]
> = [
  ["image base", (value) => (value.image_base = "not-an-address")],
  [
    "mapping start",
    (value) => {
      const mapping = value.mappings[0];
      if (mapping) mapping.start = "not-an-address";
    },
  ],
  [
    "mapping end",
    (value) => {
      const mapping = value.mappings[0];
      if (mapping) mapping.end = "not-an-address";
    },
  ],
  [
    "relocation address",
    (value) => {
      const relocation = value.relocations[0];
      if (relocation) relocation.address = "not-an-address";
    },
  ],
  ["entry point", (value) => (value.entry_points[0] = "not-an-address")],
  [
    "entry context address",
    (value) => {
      value.entry_context.push({ address: "not-an-address", registers: [] });
    },
  ],
];

it.each(malformedCoordinates)(
  "rejects a malformed nonempty %s at both native load-image boundaries",
  (_name, mutate) => {
    const observation = structuredClone(fixtureDosLoadImage().observation);
    mutate(observation);
    expect({
      shared: nativeLoadImageObservationSchema.safeParse(observation).success,
      provider: parseGhidraInventoryResult(
        "inspect_native_load_image",
        jsonValueSchema.parse(observation),
      ).ok,
    }).toEqual({ shared: false, provider: false });
  },
);

it("preserves zero-padded, qualified, and large observation addresses", () => {
  const observation = structuredClone(fixtureDosLoadImage().observation);
  observation.image_base = "0x0000";
  const mapping = observation.mappings[0];
  const relocation = observation.relocations[0];
  if (!mapping || !relocation) throw new Error("Incomplete load-image fixture");
  mapping.start = "ram%2Fbank:0x0000000000000001";
  mapping.end = "ram%2Fbank:0x10000000000000001";
  relocation.address = "0x10000000000000009";
  observation.entry_points[0] = "ram:0x10000000000000001";
  const parsed = parseGhidraInventoryResult(
    "inspect_native_load_image",
    jsonValueSchema.parse(observation),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw parsed.error;
  expect(parsed.value.value).toEqual(observation);
});

it("rejects malformed coordinates in completed load-image checks and entries", () => {
  const fixture = fixtureDosLoadImage();
  const compared = compareDosFixture(
    fixture.bytes,
    fixture.sha256,
    fixture.observation,
  );
  if (!compared.ok || compared.value.status === "unsupported")
    throw new Error("Expected a completed DOS load-image result");
  const malformedResults = [
    {
      ...compared.value,
      entry: { ...compared.value.entry, linear_address: "not-an-address" },
    },
    {
      ...compared.value,
      checks: compared.value.checks.map((check, index) =>
        index === 0 ? { ...check, address: "not-an-address" } : check,
      ),
    },
  ];
  expect(
    malformedResults.map(
      (result) => nativeLoadImageSchema.safeParse(result).success,
    ),
  ).toEqual([false, false]);
});

describe("independent DOS MZ import verification", () => {
  it("verifies every initialized source byte while retaining overlay and BSS scope", () => {
    const fixture = fixtureDosLoadImage();
    const result = compareDosFixture(
      fixture.bytes,
      fixture.sha256,
      fixture.observation,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "verified",
        module_bytes: 128,
        header_bytes: 32,
        overlay_bytes: 23,
        entry: { linear_address: "0x10000" },
      },
    });
    if (!result.ok || result.value.status === "unsupported")
      throw new Error("Expected measured MZ checks");
    expect(result.value.checks.every((check) => check.matched)).toBe(true);
    expect(result.value.observations).toEqual(fixture.observation);
    expect(result.value.limitations.join(" ")).toMatch(
      /runtime behavior.*not verified/u,
    );
  });

  it.each(damage)(
    "rejects a %s despite a matching executable digest",
    (_name, mutate) => {
      const fixture = fixtureDosLoadImage();
      mutate(fixture.observation);
      const result = compareDosFixture(
        fixture.bytes,
        fixture.sha256,
        fixture.observation,
      );
      expect(result).toMatchObject({
        ok: true,
        value: { status: "mismatch", observations: fixture.observation },
      });
      if (!result.ok || result.value.status === "unsupported")
        throw new Error("Expected MZ verification checks");
      expect(result.value.checks.some((check) => !check.matched)).toBe(true);
    },
  );

  it("retains source range coordinates when memory evidence disagrees", () => {
    const fixture = fixtureDosLoadImage();
    const mapping = fixture.observation.mappings[1];
    if (mapping === undefined) throw new Error("Missing module mapping");
    mapping.sha256 = "f".repeat(64);
    const result = compareDosFixture(
      fixture.bytes,
      fixture.sha256,
      fixture.observation,
    );
    if (!result.ok || result.value.status === "unsupported")
      throw new Error("Expected MZ verification checks");
    expect(result.value.checks.filter((check) => !check.matched)).toEqual([
      expect.objectContaining({
        name: "mapping[1].memory_sha256",
        file_offset: 32,
        address: "0x10000",
        observed: "f".repeat(64),
      }),
    ]);
  });

  it("is independent of mapping iteration order", () => {
    const fixture = fixtureDosLoadImage();
    fixture.observation.mappings.reverse();
    expect(
      compareDosFixture(fixture.bytes, fixture.sha256, fixture.observation),
    ).toMatchObject({ ok: true, value: { status: "verified" } });
  });

  it("accepts a different segment alias while preserving the observed coordinates and raw table values", () => {
    const fixture = fixtureDosLoadImage();
    const relocation = fixture.observation.relocations[0];
    if (relocation === undefined)
      throw new Error("Missing source-owned relocation");
    relocation.segment = 0x0fff;
    relocation.offset = 25;
    expect(
      compareDosFixture(fixture.bytes, fixture.sha256, fixture.observation),
    ).toMatchObject({
      ok: true,
      value: {
        status: "verified",
        observations: {
          relocations: [
            { segment: 0x0fff, offset: 25, values: [0, 9, 0x1004] },
          ],
        },
      },
    });
  });

  it("rejects a changed snapshot and malformed MZ rather than trusting provider hashes", () => {
    const fixture = fixtureDosLoadImage();
    fixture.bytes[0] = 0;
    expect(
      compareDosFixture(fixture.bytes, fixture.sha256, fixture.observation),
    ).toMatchObject({ ok: false, error: expect.stringContaining("digest") });
    const digest = createHash("sha256").update(fixture.bytes).digest("hex");
    expect(
      compareDosFixture(fixture.bytes, digest, fixture.observation),
    ).toMatchObject({ ok: false, error: expect.stringContaining("MZ header") });
  });

  it("rejects malformed producer digests and unsafe source coordinates", () => {
    const fixture = fixtureDosLoadImage();
    expect(
      nativeLoadImageObservationSchema.safeParse({
        ...fixture.observation,
        source_files: [
          { ...fixture.observation.source_files[0], original_sha256: "bad" },
        ],
      }).success,
    ).toBe(false);
    const mapping = fixture.observation.mappings[0];
    expect(
      nativeLoadImageObservationSchema.safeParse({
        ...fixture.observation,
        mappings: [{ ...mapping, file_offset: Number.MAX_SAFE_INTEGER + 1 }],
      }).success,
    ).toBe(false);
  });
});

it("applies duplicate aliases and overlapping DOS fixups in declared order with original/final byte evidence", () => {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ");
  bytes.writeUInt16LE(128, 2);
  bytes.writeUInt16LE(1, 4);
  bytes.writeUInt16LE(4, 6);
  bytes.writeUInt16LE(4, 8);
  bytes.writeUInt16LE(28, 24);
  bytes.writeUInt16LE(0, 28);
  bytes.writeUInt16LE(1, 30);
  bytes.writeUInt16LE(16, 32);
  bytes.writeUInt16LE(0, 34);
  bytes.writeUInt16LE(16, 36);
  bytes.writeUInt16LE(0, 38);
  bytes.writeUInt16LE(17, 40);
  bytes.writeUInt16LE(0, 42);
  bytes.set([1, 0, 2], 80);
  const before = Buffer.from(bytes);
  const prepared = prepareGhidraDosLoadImage(
    bytes,
    parseMzHeaderEvidence(bytes),
  );
  if (!prepared.ok) throw new Error(prepared.error);
  expect(bytes.equals(before)).toBe(true);
  expect(
    prepared.value.modified
      .subarray(80, 83)
      .equals(Buffer.from([1, 0x30, 0x12])),
  ).toBe(true);
  expect(prepared.value.expectedRelocations).toEqual([
    {
      address: "0x10010",
      segment: 0x1001,
      offset: 0,
      status: "APPLIED",
      type: 0,
      values: [1, 0, 0x1001],
      original_bytes_hex: "0100",
      memory_bytes_hex: "0130",
    },
    {
      address: "0x10010",
      segment: 0x1000,
      offset: 16,
      status: "APPLIED",
      type: 0,
      values: [0, 16, 0x2001],
      original_bytes_hex: "0110",
      memory_bytes_hex: "0130",
    },
    {
      address: "0x10010",
      segment: 0x1000,
      offset: 16,
      status: "APPLIED",
      type: 0,
      values: [0, 16, 0x3001],
      original_bytes_hex: "0120",
      memory_bytes_hex: "0130",
    },
    {
      address: "0x10011",
      segment: 0x1000,
      offset: 17,
      status: "APPLIED",
      type: 0,
      values: [0, 17, 0x1230],
      original_bytes_hex: "3002",
      memory_bytes_hex: "3012",
    },
  ]);
});
