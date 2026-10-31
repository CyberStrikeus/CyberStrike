import { expect, it } from "vitest";
import { fat } from "../../../src/domain/binaryTarget.fixture.js";
import {
  createRustImage,
  createRustImageWithGoSection,
  createRustHashOverflowImage,
  compressRustElfSectionNames,
  rustElfSectionNameFixture,
  RUSTC_HASH,
  rustDependencyPayload,
} from "../../fixtures/rust/image.js";
import { readRustBinaryImage } from "../../../src/rust/RustBinaryImage.js";
import { readBinaryContainer } from "../../../src/native/metadata/readBinaryContainer.js";
import { readGoBinaryImage } from "../../../src/go/GoBinaryImage.js";
import { RustAuditableFormatFailure } from "../../../src/rust/RustAuditableReader.js";

const packages = [
  {
    name: "itoa",
    version: "1.0.18",
    source: "crates.io",
    kind: null,
    dependencies: [],
    features: null,
    root: false,
  },
  {
    name: "sample",
    version: "0.1.0",
    source: "local",
    kind: null,
    dependencies: [0],
    features: null,
    root: true,
  },
];

it.each([
  ["named", ".rodata"],
  ["empty", ""],
  ["unavailable", null],
] as const)(
  "retains read-only ELF section bytes with a %s name",
  (name, expectedName) => {
    const bytes = rustElfSectionNameFixture(name);
    const container = readBinaryContainer(bytes);
    expect(container.load_regions?.every(({ write }) => write)).toBe(true);
    expect(container.sections).toContainEqual(
      expect.objectContaining({
        format: "elf",
        name: expectedName,
        offset: 2048,
        read_only: true,
        file_backed: true,
      }),
    );
    expect(readRustBinaryImage(bytes).rustc_commit?.hashes).toEqual([
      { hash: RUSTC_HASH, file_offset: 2048 },
    ]);
  },
);

it.each([
  ["writable", 1, 3n],
  ["executable", 1, 6n],
  ["unallocated", 1, 0n],
  ["NOBITS", 8, 2n],
  ["NULL", 0, 2n],
] as const)(
  "does not scan unnamed ELF %s sections for compiler paths",
  (_kind, type, flags) => {
    const bytes = rustElfSectionNameFixture("empty");
    bytes.writeUInt32LE(type, 384 + 4);
    bytes.writeBigUInt64LE(flags, 384 + 8);
    expect(readBinaryContainer(bytes).sections).not.toContainEqual(
      expect.objectContaining({ offset: 2048, read_only: true }),
    );
    expect(readRustBinaryImage(bytes).rustc_commit).toBeNull();
  },
);

it("does not scan an unnamed ELF section whose declared range leaves the file", () => {
  const bytes = rustElfSectionNameFixture("empty");
  // The compiler path still exists at 2048, but its declared section no longer fits.
  bytes.writeBigUInt64LE(BigInt(bytes.length), 384 + 32);
  expect(readBinaryContainer(bytes).sections).not.toContainEqual(
    expect.objectContaining({ read_only: true }),
  );
  expect(readRustBinaryImage(bytes).rustc_commit).toBeNull();
});

it.each(["elf", "pe"] as const)(
  "reads a .dep-v0 section and an inferred rustc hash from %s",
  (format) => {
    const image = readRustBinaryImage(createRustImage({ format }));
    expect(image.format).toBe(format);
    expect(image.auditable_metadata).toMatchObject({
      section_name: ".dep-v0",
      file_offset: 1024,
      section_bytes: rustDependencyPayload().length,
      format_version: 1,
      root_package_index: 1,
      packages,
      dependency_edges: [{ from_index: 1, to_index: 0 }],
    });
    expect(image.rustc_commit).toEqual({
      evidence_kind: "inferred",
      hashes: [{ hash: RUSTC_HASH, file_offset: 2048 }],
    });
  },
);

it("reads a Mach-O __DATA,.dep-v0 section", () => {
  const image = readRustBinaryImage(createRustImage({ format: "macho" }));
  expect(image).toMatchObject({
    format: "macho",
    architecture: "arm64",
    auditable_metadata: {
      section_name: "__DATA,.dep-v0",
      file_offset: 1024,
      root_package_index: 1,
      packages,
    },
    rustc_commit: {
      evidence_kind: "inferred",
      hashes: [{ hash: RUSTC_HASH, file_offset: 2048 }],
    },
  });
});

it("preserves the arm64_32 Mach-O CPU family when dependency metadata is absent", () => {
  const bytes = createRustImage({
    format: "macho",
    omitSection: true,
    includeRustc: false,
  });
  bytes.writeUInt32LE(0x0200000c, 4);

  expect(readRustBinaryImage(bytes)).toMatchObject({
    format: "macho",
    architecture: "arm64_32",
    bits: 64,
    auditable_metadata: null,
    rustc_commit: null,
  });
});

it("uses the shared ELF classifier for Rust image architecture", () => {
  const bytes = createRustImage({
    format: "elf",
    omitSection: true,
    includeRustc: true,
  });
  bytes.writeUInt16LE(164, 18); // ELF EM_HEXAGON.
  expect(readRustBinaryImage(bytes)).toMatchObject({
    format: "elf",
    architecture: "hexagon",
    auditable_metadata: null,
  });
});

it("ignores PE file-alignment padding after the dependency content", () => {
  const bytes = createRustImage({ format: "pe", includeRustc: false });
  const payloadBytes = rustDependencyPayload().length;
  const entry = 264;
  expect(bytes.readUInt32LE(entry + 8)).toBe(payloadBytes);
  bytes.writeUInt32LE(512, entry + 16);
  const image = readRustBinaryImage(bytes);
  expect(image.auditable_metadata).toMatchObject({
    section_name: ".dep-v0",
    section_bytes: payloadBytes,
    packages,
  });
});

it("recognizes zero-virtual-size PE raw padding without accepting payload junk", () => {
  const payloadBytes = rustDependencyPayload().length;
  const entry = 264;
  const bytes = createRustImage({ format: "pe", includeRustc: false });
  bytes.writeUInt32LE(0, entry + 8);
  bytes.writeUInt32LE(512, entry + 16);
  bytes.writeUInt32LE(512, 188); // Optional-header FileAlignment.
  expect(readRustBinaryImage(bytes).auditable_metadata).toMatchObject({
    section_bytes: 512,
    compressed_bytes: payloadBytes,
    packages,
  });

  const payloadOffset = bytes.readUInt32LE(entry + 20);
  const nonzeroSuffix = Buffer.from(bytes);
  nonzeroSuffix[payloadOffset + payloadBytes] = 1;
  expect(() => readRustBinaryImage(nonzeroSuffix)).toThrow(
    /bytes after the zlib stream/u,
  );

  const truncated = Buffer.from(bytes);
  truncated[payloadOffset + payloadBytes - 1] =
    truncated[payloadOffset + payloadBytes - 1]! ^ 0xff;
  expect(() => readRustBinaryImage(truncated)).toThrow(/complete zlib stream/u);

  const nonzeroVirtualSize = Buffer.from(bytes);
  nonzeroVirtualSize.writeUInt32LE(payloadBytes + 1, entry + 8);
  expect(() => readRustBinaryImage(nonzeroVirtualSize)).toThrow(
    /bytes after the zlib stream/u,
  );

  const unknownAlignment = Buffer.from(bytes);
  unknownAlignment.writeUInt32LE(0, 188);
  expect(() => readRustBinaryImage(unknownAlignment)).toThrow(
    /bytes after the zlib stream/u,
  );
});

it("returns null metadata when the dependency section is absent", () => {
  const image = readRustBinaryImage(
    createRustImage({ format: "elf", omitSection: true }),
  );
  expect(image.auditable_metadata).toBeNull();
  expect(image.rustc_commit?.hashes).toEqual([
    { hash: RUSTC_HASH, file_offset: 2048 },
  ]);
});

it.each([1, 2])(
  "reads dependency metadata through ELF section-name compression %i",
  (compressionType) => {
    const image = readRustBinaryImage(
      compressRustElfSectionNames(
        createRustImage({ format: "elf" }),
        compressionType,
      ),
    );
    expect(image.auditable_metadata).toMatchObject({
      section_name: ".dep-v0",
      file_offset: 1024,
      packages,
      dependency_edges: [{ from_index: 1, to_index: 0 }],
    });
  },
);

it("keeps dependency presence unknown for unsupported ELF name compression", () => {
  const image = readRustBinaryImage(
    compressRustElfSectionNames(createRustImage({ format: "elf" }), 3),
  );
  expect(image.auditable_metadata).toBeNull();
  expect(image.section_names_limitation).toMatch(
    /compression type 3 is unsupported/u,
  );
  expect(image.rustc_commit?.hashes).toEqual([
    { hash: RUSTC_HASH, file_offset: 2048 },
  ]);
});

it("keeps dependency presence unknown when its ELF name offset is unreadable", () => {
  const bytes = createRustImage({ format: "elf" });
  bytes.writeUInt32LE(0xffff, 384);

  const image = readRustBinaryImage(bytes);
  expect(image.auditable_metadata).toBeNull();
  expect(image.section_names_limitation).toMatch(/outside its string table/u);
  expect(image.rustc_commit?.hashes).toEqual([
    { hash: RUSTC_HASH, file_offset: 2048 },
  ]);
});

it("finds rustc paths in read-only ELF load data without section headers", () => {
  const bytes = createRustImage({
    format: "elf",
    omitSection: true,
    includeRustc: true,
  });
  bytes.writeBigUInt64LE(0n, 40);
  bytes.writeUInt16LE(0, 60);
  bytes.writeUInt16LE(0, 62);
  bytes.writeUInt32LE(4, 132); // PF_R, no write or execute permission.

  expect(readRustBinaryImage(bytes)).toMatchObject({
    auditable_metadata: null,
    rustc_commit: {
      evidence_kind: "inferred",
      hashes: [{ hash: RUSTC_HASH, file_offset: 2048 }],
    },
  });

  bytes.writeUInt32LE(6, 132); // PF_R | PF_W is not read-only data.
  expect(readRustBinaryImage(bytes).rustc_commit).toBeNull();
});

it("refuses a universal Mach-O container", () => {
  expect(() => readRustBinaryImage(fat([0x0100000c]))).toThrow(
    RustAuditableFormatFailure,
  );
  expect(() => readRustBinaryImage(fat([0x0100000c]))).toThrow(/thin slice/);
});

it("does not read SHT_NOBITS dependency sections as stored bytes", () => {
  const bytes = createRustImage({ format: "elf" });
  // The fixture writes the .dep-v0 section header at byte 384.
  bytes.writeUInt32LE(8, 384 + 4);
  let metadata: unknown;
  try {
    metadata = readRustBinaryImage(bytes).auditable_metadata;
  } catch (cause: unknown) {
    expect(cause).toBeInstanceOf(RustAuditableFormatFailure);
    return;
  }
  expect(metadata).toBeNull();
});

it("reads a rustc path from a read-only ELF section whose name exceeds 64 bytes", () => {
  const bytes = createRustImage({ format: "elf", omitSection: true });
  // omitSection places the rustc section header at 384 and shstrtab at 320.
  const nameOffset = bytes.readUInt32LE(384);
  const tableOffset = Number(bytes.readBigUInt64LE(320 + 24));
  const longName = Buffer.concat([Buffer.alloc(65, 0x61), Buffer.from([0])]);
  longName.copy(bytes, tableOffset + nameOffset);
  bytes.writeBigUInt64LE(BigInt(nameOffset + longName.length), 320 + 32);
  const image = readRustBinaryImage(bytes);
  expect(image.auditable_metadata).toBeNull();
  expect(image.rustc_commit).toEqual({
    evidence_kind: "inferred",
    hashes: [{ hash: RUSTC_HASH, file_offset: 2048 }],
  });
});

it("refuses read-only data with more distinct rustc paths than it retains", () => {
  const bytes = createRustHashOverflowImage();
  expect(() => readRustBinaryImage(bytes)).toThrow(
    expect.objectContaining({
      constraint: {
        resource: "capacity",
        reported_limits: { maximum_rustc_hashes: 64 },
      },
    }),
  );
});

it.each([
  ["elf", "compressed"],
  ["elf", "unmapped"],
  ["elf", "zero-fill"],
  ["elf", "duplicate"],
  ["elf", "out-of-file"],
  ["elf", "zero-address"],
  ["macho", "unmapped"],
  ["macho", "zero-fill"],
  ["macho", "duplicate"],
  ["macho", "out-of-file"],
] as const)(
  "retains Rust evidence beside an unrelated %s %s Go section",
  (format, fault) => {
    const bytes = createRustImageWithGoSection(format, fault);
    const control = Buffer.from(bytes);
    const sectionOffset = format === "elf" ? 768 + 11 : 408;
    const sectionName = Buffer.from(
      (format === "elf" ? ".other\0" : "__other\0").padEnd(
        format === "elf" ? 13 : 16,
        "\0",
      ),
      "ascii",
    );
    if (format === "elf") {
      const nameOffset = Number(bytes.readBigUInt64LE(320 + 32));
      sectionName.copy(control, 768 + nameOffset);
    } else {
      sectionName.copy(control, sectionOffset);
    }
    expect(readBinaryContainer(bytes).load_regions).toEqual(
      readBinaryContainer(control).load_regions,
    );
    expect(() => readGoBinaryImage(bytes)).toThrow(/build-info|mapped/i);
    expect(readRustBinaryImage(bytes)).toMatchObject({
      format,
      auditable_metadata: { file_offset: 1024, packages },
      rustc_commit: {
        evidence_kind: "inferred",
        hashes: [{ hash: RUSTC_HASH, file_offset: 2048 }],
      },
    });
  },
);
