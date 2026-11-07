import { expect, it } from "vitest";
import { readGoBinaryImage } from "../../go/GoBinaryImage.js";
import { readPeImage } from "./PeImage.js";
import { pe } from "../../domain/binaryTarget.fixture.js";
import { parseMzHeaderEvidence } from "../../domain/dosMz.js";
import { BinaryFormatFailure } from "./BinaryContainer.js";
import { readBinaryContainer } from "./readBinaryContainer.js";
import {
  createGoBinaryFixture,
  setGoPeVirtualSize,
} from "../../../tests/fixtures/go/image.js";

for (const bits of [32, 64] as const) {
  it.each([
    ["ZZ", Buffer.from("ZZ")],
    ["high-bit MZ", Buffer.from([0xcd, 0xda])],
  ] as const)(
    `rejects %s before reading PE${String(bits)} facts`,
    (_, prefix) => {
      const { bytes } = createGoBinaryFixture({ format: "pe", bits });
      prefix.copy(bytes);
      const declarations = parseMzHeaderEvidence(bytes).declarations;
      if (declarations.ok) throw new Error("Expected invalid MZ declarations");
      expect(() => readPeImage(bytes)).toThrow(
        expect.objectContaining({
          kind: "malformed",
          message: declarations.error,
        }),
      );
    },
  );

  it(`reads PE${String(bits)} without requiring a valid DOS load module`, () => {
    const { bytes } = createGoBinaryFixture({ format: "pe", bits });
    bytes.writeUInt16LE(0, 4);
    expect(parseMzHeaderEvidence(bytes).dos.ok).toBe(false);
    expect(readPeImage(bytes)).toMatchObject({ format: "pe", bits });
  });
}

it("classifies a confirmed overlapping PE as an unsupported layout", () => {
  try {
    readPeImage(pe(0x014c, 4));
    throw new Error("Expected an unsupported PE layout");
  } catch (cause) {
    expect(cause).toBeInstanceOf(BinaryFormatFailure);
    expect(cause).toMatchObject({ kind: "unsupported" });
    expect((cause as Error).message).toContain("overlapping PE header");
  }
});

it("reports complete DOS MZ images as outside the PE reader", () => {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt16LE(128, 2);
  bytes.writeUInt16LE(1, 4);
  bytes.writeUInt16LE(2, 6);
  bytes.writeUInt16LE(4, 8);
  bytes.writeUInt16LE(28, 24);
  bytes.write("ABCD", 60, "ascii");
  expect(() => readPeImage(bytes)).toThrow(
    "DOS MZ images are outside the supported ELF, PE and thin Mach-O formats",
  );
});

it.each(["NE", "LE", "LX"])(
  "recognizes %s without requiring a PE COFF header",
  (signature) => {
    const bytes = pe(0x014c).subarray(0, 66);
    bytes.write(signature, 64, "ascii");
    expect(() => readBinaryContainer(bytes)).toThrow(
      expect.objectContaining({
        kind: "unsupported",
        message: `${signature} images are outside the supported ELF, PE and thin Mach-O formats`,
      }),
    );
  },
);

it.each([32, 64] as const)(
  "uses raw-size fallback for PE%d Go build-info and keeps RVA mappings intact",
  (bits) => {
    for (const encoding of ["inline", "pointer"] as const) {
      const fixture = createGoBinaryFixture({ format: "pe", bits, encoding });
      const expected = readGoBinaryImage(fixture.bytes).build_info;
      expect(expected).not.toBeNull();
      setGoPeVirtualSize(fixture.bytes, 0);

      const container = readPeImage(fixture.bytes);
      expect(container.sections[0]).toMatchObject({
        name: ".data",
        offset: 1024,
        size: 2048,
        file_backed: true,
      });
      expect(container.mappings[0]).toMatchObject({
        address: 0x10400n,
        offset: 1024,
        size: 2048,
      });
      expect(container.sections[0]).toMatchObject({
        virtual_address: 0x400,
        virtual_size: 0,
        raw_size: 2048,
        characteristics: 0xc0000040,
      });
      expect(container).not.toHaveProperty("data_ranges");
      expect(container.image_base).toBe(0x10000n);
      expect(container.executable_mappings).toEqual([]);
      expect(readGoBinaryImage(fixture.bytes).build_info).toEqual(expected);
    }
  },
);

it.each([32, 64] as const)(
  "retains PE%d declared image base and alignments in native image facts",
  (bits) => {
    const { bytes } = createGoBinaryFixture({ format: "pe", bits });
    const optional = bytes.readUInt32LE(0x3c) + 24;
    const imageBase = bits === 64 ? 0xfedcba9876540000n : 0x87650000n;
    if (bits === 64) bytes.writeBigUInt64LE(imageBase, optional + 24);
    else bytes.writeUInt32LE(Number(imageBase), optional + 28);
    // These remain declarations; alignment policy belongs to image consumers.
    bytes.writeUInt32LE(0, optional + 32);
    bytes.writeUInt32LE(0xffffffff, optional + 36);
    const container = readPeImage(bytes);
    expect(container.image_base).toBe(imageBase);
    expect(container.pe_header_mapping.address).toBe(imageBase);
    expect(container.mappings[0]?.address).toBe(imageBase + 0x400n);
    expect(container.pe_section_alignment).toBe(0);
    expect(container.pe_file_alignment).toBe(0xffffffff);
    expect(container.sections[0]?.file_alignment).toBe(0xffffffff);
  },
);

it("keeps Go fallback candidates when a PE section has no printable name", () => {
  const fixture = createGoBinaryFixture({ format: "pe", bits: 64 });
  const expected = readGoBinaryImage(fixture.bytes).build_info;
  const pe = fixture.bytes.readUInt32LE(0x3c);
  const section = pe + 24 + fixture.bytes.readUInt16LE(pe + 20);
  fixture.bytes.fill(0, section, section + 8);

  const container = readPeImage(fixture.bytes);
  expect(container.sections[0]).toMatchObject({
    name: "",
    characteristics: 0xc0000040,
  });
  expect(readGoBinaryImage(fixture.bytes).build_info).toEqual(expected);
});

it.each(["inline", "pointer"] as const)(
  "does not search PE raw alignment padding beyond a nonzero VirtualSize (%s)",
  (encoding) => {
    const fixture = createGoBinaryFixture({ format: "pe", bits: 64, encoding });
    // Put an otherwise valid, aligned record in the raw-only tail.
    fixture.bytes.copy(
      fixture.bytes,
      fixture.headerOffset + 512,
      fixture.headerOffset,
      fixture.headerOffset + 512,
    );
    fixture.bytes.fill(0, fixture.headerOffset, fixture.headerOffset + 512);
    setGoPeVirtualSize(fixture.bytes, 512);

    const container = readPeImage(fixture.bytes);
    expect(container.sections[0]).toMatchObject({
      size: 512,
      file_backed: true,
    });
    expect(container.mappings[0]).toMatchObject({ size: 2048, offset: 1024 });
    expect(container.sections[0]).toMatchObject({
      size: 512,
      offset: 1024,
      virtual_size: 512,
      raw_size: 2048,
    });
    expect(container).not.toHaveProperty("data_ranges");
    expect(readGoBinaryImage(fixture.bytes).build_info).toBeNull();
  },
);

it.each([
  [0x014c, 0x7b79, "386", 32],
  [0x8664, 0x7b79, "amd64", 64],
  [0x01c0, 0x4644, "arm", 32],
  [0xaa64, 0x4644, "arm64", 64],
] as const)(
  "shares managed PE machine identity for %s with override %s",
  (machine, override, architecture, bits) => {
    const bytes = pe(machine, 64, 0x2002, true);
    bytes.writeUInt16LE(machine ^ override, 68);
    expect(readPeImage(bytes)).toMatchObject({
      pe_machine: machine ^ override,
      architecture,
      bits,
    });
  },
);

it.each([0x014c, 0x8664] as const)(
  "rejects a contradictory optional-header width for COFF machine %s",
  (machine) => {
    const bytes = pe(machine);
    bytes.writeUInt16LE(machine === 0x014c ? 0x20b : 0x10b, 88);
    expect(() => readPeImage(bytes)).toThrow(
      "PE optional-header magic does not match its architecture",
    );
  },
);

it.each([0xffff, 0x8664 ^ 0x7b79])(
  "retains raw unknown machine %s without managed override proof",
  (machine) => {
    const bytes = pe(0x8664);
    bytes.writeUInt16LE(machine, 68);
    expect(readPeImage(bytes)).toMatchObject({
      pe_machine: machine,
      architecture: `pe-machine-${machine}`,
      bits: 64,
    });
  },
);
