import { expect, it } from "vitest";
import { javaClassFile } from "../../fixtures/javaClassFile.js";
import {
  CPU,
  fatImage,
  machoImage,
} from "../../../src/artifacts/apple/MachoImage.fixture.js";
import { readGoBinaryImage } from "../../../src/go/GoBinaryImage.js";
import { goBuildInfoSearch } from "../../../src/go/GoBuildInfoSearch.js";
import { BinaryResourceFailure } from "../../../src/native/metadata/BinaryContainer.js";
import { readMachoImage } from "../../../src/native/metadata/MachoImage.js";
import { readBinaryContainer } from "../../../src/native/metadata/readBinaryContainer.js";
import {
  createGoBinaryFixture,
  createGoBinaryByteStringFixture,
  createGoPeHeaderPointerFixture,
  createGoSplitElfFixture,
  createGoOverlappingElfFixture,
  GO_MODULE_TEXT,
} from "../../fixtures/go/image.js";

it("uses the shared ELF classifier for Go image architecture", () => {
  const fixture = createGoBinaryFixture({ omitBuildInfo: true });
  fixture.bytes.writeUInt16LE(164, 18); // ELF EM_HEXAGON.
  expect(readGoBinaryImage(fixture.bytes)).toMatchObject({
    format: "elf",
    architecture: "hexagon",
    build_info: null,
  });
});

it("preserves exact Mach-O protection masks for Go fallback selection", () => {
  const { bytes } = createGoBinaryFixture({
    format: "macho",
    sectionless: true,
  });
  const firstSegment = 32;
  const secondSegment = 104;
  bytes.writeUInt32LE(2, 16);
  bytes.writeUInt32LE(144, 20);
  bytes.writeUInt32LE(11, firstSegment + 56);
  bytes.writeUInt32LE(11, firstSegment + 60);
  bytes.writeUInt32LE(0x19, secondSegment);
  bytes.writeUInt32LE(72, secondSegment + 4);
  bytes.write("__DATA2", secondSegment + 8, "ascii");
  bytes.writeBigUInt64LE(0x20000n, secondSegment + 24);
  bytes.writeBigUInt64LE(BigInt(bytes.length), secondSegment + 32);
  bytes.writeBigUInt64LE(0n, secondSegment + 40);
  bytes.writeBigUInt64LE(BigInt(bytes.length), secondSegment + 48);
  bytes.writeUInt32LE(3, secondSegment + 56);
  bytes.writeUInt32LE(3, secondSegment + 60);

  const container = readBinaryContainer(bytes);
  expect(
    container.load_regions?.map((region) => region.protection_masks),
  ).toEqual([
    { current: 11, maximum: 11 },
    { current: 3, maximum: 3 },
  ]);
  expect(goBuildInfoSearch(bytes, container)).toMatchObject([
    { address: 0x20000n, offset: 0, size: bytes.length },
  ]);
  expect(readGoBinaryImage(bytes).build_info?.go_version).toBe("go1.26.0");
});

it("bounds cumulative header searches across overlapping ELF file spans", () => {
  const bytes = createGoOverlappingElfFixture();
  expect(() => readGoBinaryImage(bytes)).toThrow(BinaryResourceFailure);
  expect(() => readGoBinaryImage(bytes)).toThrow(/256 MiB.*search/);
});

it("does not charge duplicate ELF search spans repeatedly", () => {
  expect(
    readGoBinaryImage(createGoOverlappingElfFixture(true)).build_info,
  ).toBeNull();
});

it("accepts a search exactly at the cumulative byte limit", () => {
  const bytes = createGoOverlappingElfFixture();
  bytes.writeUInt16LE(256, 56);
  expect(readGoBinaryImage(bytes).build_info).toBeNull();
});

it("keeps different virtual alignments distinct when file spans match", () => {
  const fixture = createGoBinaryFixture({ sectionless: true });
  fixture.bytes.copy(fixture.bytes, 184, 128, 184);
  fixture.bytes.writeUInt16LE(2, 56);
  fixture.bytes.writeBigUInt64LE(0x200001n, 128 + 16);
  expect(readGoBinaryImage(fixture.bytes).build_info?.header_offset).toBe(
    fixture.headerOffset,
  );
});

it.each([
  [32, "little", "inline"],
  [32, "little", "pointer"],
  [32, "big", "inline"],
  [32, "big", "pointer"],
  [64, "little", "inline"],
  [64, "little", "pointer"],
  [64, "big", "inline"],
  [64, "big", "pointer"],
] as const)(
  "retains later-load ELF metadata without sections (%d %s %s)",
  (bits, byteOrder, encoding) => {
    const original = createGoSplitElfFixture({ bits, byteOrder, encoding });
    const sectionless = createGoSplitElfFixture({
      bits,
      byteOrder,
      encoding,
      sectionless: true,
    });
    const expected = readGoBinaryImage(original.bytes).build_info;
    expect(expected).not.toBeNull();
    expect(readGoBinaryImage(sectionless.bytes).build_info).toEqual(expected);
  },
);

it("continues past an empty file-backed ELF data load", () => {
  const fixture = createGoSplitElfFixture({ sectionless: true });
  const expected = readGoBinaryImage(fixture.bytes).build_info;
  fixture.bytes.writeBigUInt64LE(0n, 128 + 32);
  expect(readGoBinaryImage(fixture.bytes).build_info).toEqual(expected);
});

it.each([4, 5, 7])(
  "does not search a later non-data ELF load with flags %d",
  (flags) => {
    const fixture = createGoSplitElfFixture({ sectionless: true });
    fixture.bytes.writeUInt32LE(flags, 184 + 4);
    expect(readGoBinaryImage(fixture.bytes).build_info).toBeNull();
  },
);

it("prefers the named ELF section to an earlier writable-load marker", () => {
  const fixture = createGoSplitElfFixture();
  const expected = readGoBinaryImage(fixture.bytes).build_info;
  fixture.bytes.copy(
    fixture.bytes,
    512,
    fixture.headerOffset,
    fixture.headerOffset + 32,
  );
  expect(readGoBinaryImage(fixture.bytes).build_info).toEqual(expected);
});

it("does not skip malformed earlier metadata to report a later valid record", () => {
  const fixture = createGoSplitElfFixture({ sectionless: true });
  fixture.bytes.copy(
    fixture.bytes,
    512,
    fixture.headerOffset,
    fixture.headerOffset + 32,
  );
  fixture.bytes[512 + 15] = 0xff;
  expect(() => readGoBinaryImage(fixture.bytes)).toThrow(
    /unsupported format bit/,
  );
});

it.each([
  ["elf", 32, "little"],
  ["elf", 32, "big"],
  ["elf", 64, "little"],
  ["elf", 64, "big"],
  ["pe", 32, "little"],
  ["pe", 64, "little"],
  ["macho", 32, "little"],
  ["macho", 32, "big"],
  ["macho", 64, "little"],
  ["macho", 64, "big"],
] as const)(
  "reads %s %d-bit %s inline build metadata",
  (format, bits, byteOrder) => {
    const fixture = createGoBinaryFixture({ format, bits, byteOrder });
    expect(readGoBinaryImage(fixture.bytes)).toMatchObject({
      format,
      bits,
      byte_order: byteOrder,
      build_info: {
        header_offset: fixture.headerOffset,
        encoding: "inline",
        go_version: "go1.26.0",
        module_text: GO_MODULE_TEXT,
        module_bytes_base64: fixture.moduleBytes.toString("base64"),
        version_location: { offset: fixture.versionOffset, bytes: 8 },
        module_location: {
          offset: fixture.moduleOffset,
          bytes: fixture.moduleBytes.length,
        },
        module: {
          path: "example.com/tool/cmd/tool",
          main: { path: "example.com/tool", version: "(devel)", sum: "" },
          dependencies: [
            {
              path: "example.com/dependency",
              version: "v1.2.3",
              replacement: { path: "../dependency", version: "", sum: "" },
            },
          ],
          complete: true,
        },
      },
    });
  },
);

it("reads inline build strings past the ELF build-info discovery section", () => {
  const fixture = createGoBinaryFixture();
  const buildInfoSection = 256 + 64 * 2;
  fixture.bytes.writeBigUInt64LE(32n, buildInfoSection + 32);

  expect(readGoBinaryImage(fixture.bytes).build_info).toMatchObject({
    header_offset: fixture.headerOffset,
    encoding: "inline",
    go_version: "go1.26.0",
    module_text: GO_MODULE_TEXT,
    version_location: { offset: fixture.versionOffset, bytes: 8 },
    module_location: {
      offset: fixture.moduleOffset,
      bytes: fixture.moduleBytes.length,
    },
  });
});

it.each(["elf", "pe", "macho"] as const)(
  "follows mapped pointers in legacy %s metadata",
  (format) => {
    const fixture = createGoBinaryFixture({
      format,
      encoding: "pointer",
      goVersion: "go1.17",
    });
    expect(readGoBinaryImage(fixture.bytes).build_info).toMatchObject({
      encoding: "pointer",
      go_version: "go1.17",
      module_text: GO_MODULE_TEXT,
      version_location: { offset: fixture.versionOffset, bytes: 6 },
    });
  },
);

it.each(["elf", "macho"] as const)(
  "finds sectionless %s metadata in its writable data mapping",
  (format) => {
    const fixture = createGoBinaryFixture({ format, sectionless: true });
    expect(readGoBinaryImage(fixture.bytes).build_info?.go_version).toBe(
      "go1.26.0",
    );
  },
);

it("does not treat a code/overlay decoy or unaligned marker as Go metadata", () => {
  const absent = createGoBinaryFixture({ omitBuildInfo: true });
  const decoy = createGoBinaryFixture();
  decoy.bytes
    .subarray(decoy.headerOffset, decoy.headerOffset + 512)
    .copy(absent.bytes, 3072);
  expect(readGoBinaryImage(absent.bytes).build_info).toBeNull();
  const unaligned = createGoBinaryFixture({
    sectionless: true,
    omitBuildInfo: true,
  });
  decoy.bytes
    .subarray(decoy.headerOffset, decoy.headerOffset + 512)
    .copy(unaligned.bytes, 1025);
  expect(readGoBinaryImage(unaligned.bytes).build_info).toBeNull();
});

it("refuses mapped pointer lengths outside the file instead of rounding 64-bit addresses", () => {
  const fixture = createGoBinaryFixture({ encoding: "pointer" });
  fixture.bytes.writeBigUInt64LE(0x20000000000001n, 1536);
  expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(
    /mapped|address/i,
  );
  const length = createGoBinaryFixture({ encoding: "pointer" });
  length.bytes.writeBigUInt64LE(0xffffffffffffffffn, 1544);
  expect(() => readGoBinaryImage(length.bytes)).toThrowError(/limit|length/i);
});

it.each(["file bytes", "zero-fill"])(
  "refuses a header-backed PE module descriptor contradicted by %s",
  (alias) => {
    const { bytes } = createGoPeHeaderPointerFixture(64, "descriptors");
    const section = 152 + bytes.readUInt16LE(148) + 40;
    bytes.writeUInt16LE(2, 134);
    bytes.write(".alias", section, "ascii");
    bytes.writeUInt32LE(16, section + 8);
    bytes.writeUInt32LE(528, section + 12);
    if (alias === "file bytes") {
      bytes.writeUInt32LE(16, section + 16);
      bytes.writeUInt32LE(1536, section + 20);
    }
    expect(() => readGoBinaryImage(bytes)).toThrowError(/ambiguous/i);
  },
);

it("refuses overlong or truncated varints before decoding or allocating strings", () => {
  const fixture = createGoBinaryFixture();
  fixture.bytes.fill(
    0xff,
    fixture.headerOffset + 32,
    fixture.headerOffset + 42,
  );
  expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(/varint/i);
  const truncated = createGoBinaryFixture();
  truncated.bytes.writeBigUInt64LE(33n, 256 + 64 * 2 + 32);
  truncated.bytes[truncated.headerOffset + 32] = 0x80;
  expect(() => readGoBinaryImage(truncated.bytes)).toThrowError(
    /truncated|range|varint/i,
  );
});

it("refuses invalid module framing and preserves BOMs without replacement decoding", () => {
  const fixture = createGoBinaryFixture();
  fixture.bytes[fixture.moduleOffset] = 0;
  expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(/framing/i);
  const bom = createGoBinaryFixture({
    goVersion: "\ufeffgo1.26.0",
    moduleText: "\ufeffpath\tx\n",
  });
  expect(readGoBinaryImage(bom.bytes).build_info).toMatchObject({
    go_version: "\ufeffgo1.26.0",
    module_text: "\ufeffpath\tx\n",
    module: {
      path: null,
      unparsed_lines: ["\ufeffpath\tx"],
      unparsed_line_bytes_base64: [],
      complete: false,
    },
  });
});

it("rejects future encodings and invalid pointer widths explicitly", () => {
  const flags = createGoBinaryFixture();
  flags.bytes[flags.headerOffset + 15] = 0x82;
  expect(() => readGoBinaryImage(flags.bytes)).toThrowError(/flags/i);
  const width = createGoBinaryFixture({ encoding: "pointer" });
  width.bytes[width.headerOffset + 14] = 16;
  expect(() => readGoBinaryImage(width.bytes)).toThrowError(/pointer/i);
});

it("preserves non-UTF8 compiler and module bytes without rejecting other observed metadata", () => {
  const version = createGoBinaryFixture();
  version.bytes[version.versionOffset] = 0xff;
  expect(readGoBinaryImage(version.bytes).build_info).toMatchObject({
    go_version: null,
    go_version_bytes_base64: version.bytes
      .subarray(version.versionOffset, version.versionOffset + 8)
      .toString("base64"),
    module_text: GO_MODULE_TEXT,
  });
  const module = createGoBinaryFixture({ moduleText: "build\t-tags=x\n" });
  module.bytes[module.moduleOffset + 16 + Buffer.byteLength("build\t-tags=")] =
    0xff;
  expect(readGoBinaryImage(module.bytes).build_info).toMatchObject({
    go_version: "go1.26.0",
    module_text: null,
    module_bytes_base64: module.bytes
      .subarray(
        module.moduleOffset,
        module.moduleOffset + module.moduleBytes.length,
      )
      .toString("base64"),
  });
});

it("retains parsed neighboring module records and exact invalid UTF-8 lines at the image boundary", () => {
  const fixture = createGoBinaryByteStringFixture();
  expect(readGoBinaryImage(fixture.bytes).build_info).toEqual(
    fixture.expectedBuildInfo,
  );
});

it.each([0, 4, 16])("ignores unused inline pointer width %s", (width) => {
  const fixture = createGoBinaryFixture();
  fixture.bytes[fixture.headerOffset + 14] = width;
  expect(readGoBinaryImage(fixture.bytes).build_info?.go_version).toBe(
    "go1.26.0",
  );
});

it.each(["pe", "macho"] as const)(
  "refuses ambiguous inline %s header mappings",
  (format) => {
    const fixture = createGoBinaryFixture({ format });
    if (format === "pe") {
      fixture.bytes.writeUInt16LE(2, 134);
      fixture.bytes.copy(fixture.bytes, 304, 264, 304);
      fixture.bytes.writeUInt32LE(512, 324);
    } else {
      fixture.bytes.writeUInt32LE(2, 16);
      fixture.bytes.writeUInt32LE(224, 20);
      fixture.bytes.writeUInt32LE(0x19, 184);
      fixture.bytes.writeUInt32LE(72, 188);
      fixture.bytes.write("__ALIAS", 192);
      fixture.bytes.writeBigUInt64LE(0x10000n, 208);
      fixture.bytes.writeBigUInt64LE(4096n, 216);
      fixture.bytes.writeBigUInt64LE(16n, 224);
      fixture.bytes.writeBigUInt64LE(4080n, 232);
    }
    expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(/ambiguous/i);
  },
);

it("refuses a contradictory mapping that overlaps only inline string bytes", () => {
  const fixture = createGoBinaryFixture({ format: "pe" });
  fixture.bytes.writeUInt16LE(2, 134);
  fixture.bytes.copy(fixture.bytes, 304, 264, 304);
  fixture.bytes.writeUInt32LE(16, 312);
  fixture.bytes.writeUInt32LE(fixture.moduleOffset + 32, 316);
  fixture.bytes.writeUInt32LE(16, 320);
  fixture.bytes.writeUInt32LE(512, 324);
  expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(/ambiguous/i);
});

it("ignores the endian flag for pointer-free strings in a big-endian image", () => {
  const fixture = createGoBinaryFixture({ byteOrder: "big" });
  fixture.bytes[fixture.headerOffset + 15] = 2;
  expect(readGoBinaryImage(fixture.bytes).build_info?.go_version).toBe(
    "go1.26.0",
  );
});

it("distinguishes unsupported containers from malformed recognized images", () => {
  expect(() =>
    readGoBinaryImage(Buffer.from([0xca, 0xfe, 0xba, 0xbe])),
  ).toThrowError(/universal|fat/i);
  expect(() => readGoBinaryImage(Buffer.from("\x7fELF"))).toThrowError(
    /truncated/i,
  );
  const pe = createGoBinaryFixture({ format: "pe" });
  expect(() => readGoBinaryImage(pe.bytes.subarray(0, 144))).toThrowError(
    /range|truncated/i,
  );
  pe.bytes.writeUInt32LE(0xfffffff0, 60);
  expect(() => readGoBinaryImage(pe.bytes)).toThrowError(
    /MZ Windows new-header candidate is unresolved/i,
  );
});

it("reports JVM class files as unsupported images instead of fat Mach-O containers", () => {
  expect(() => readGoBinaryImage(javaClassFile())).toThrowError(
    /Only ELF, PE, and thin Mach-O native images are supported/,
  );
  expect(() => readGoBinaryImage(javaClassFile(4000))).toThrowError(
    /Only ELF, PE, and thin Mach-O native images are supported/,
  );
  expect(() => readGoBinaryImage(javaClassFile(4000, true))).toThrowError(
    /Only ELF, PE, and thin Mach-O native images are supported/,
  );
});

it("keeps the thin-slice failure for confirmed universal Mach-O containers", () => {
  const slices = [
    { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
    { cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) },
  ];
  for (const universal of [
    fatImage(slices),
    fatImage(slices, true),
    fatImage(slices, false, true),
    fatImage(slices, true, true),
  ]) {
    expect(() => readGoBinaryImage(Buffer.from(universal))).toThrowError(
      /fat Mach-O containers require selecting a thin slice/,
    );
  }
});

it("rejects ELF header tables overlapping the native header", () => {
  const fixture = createGoBinaryFixture({ sectionless: true });
  fixture.bytes.writeBigUInt64LE(0n, 32);
  expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(
    /header|overlap/i,
  );
});

it("rejects contradictory aliases when a metadata address maps to different file bytes", () => {
  const fixture = createGoBinaryFixture();
  fixture.bytes.writeUInt16LE(2, 56);
  fixture.bytes.writeUInt32LE(1, 184);
  fixture.bytes.writeUInt32LE(6, 188);
  fixture.bytes.writeBigUInt64LE(16n, 192);
  fixture.bytes.writeBigUInt64LE(0x10000n, 200);
  fixture.bytes.writeBigUInt64LE(4080n, 216);
  fixture.bytes.writeBigUInt64LE(4080n, 224);
  expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(/ambiguous/i);
});

it.each(["pe", "elf"] as const)(
  "ignores a marker extending past the selected %s data boundary",
  (format) => {
    const fixture = createGoBinaryFixture({ format, omitBuildInfo: true });
    if (format === "pe") fixture.bytes.writeUInt32LE(2040, 264 + 8);
    else fixture.bytes.writeBigUInt64LE(2040n, 256 + 64 * 2 + 32);
    Buffer.from("ff20476f206275696c64696e663a", "hex").copy(
      fixture.bytes,
      3056,
    );
    expect(readGoBinaryImage(fixture.bytes).build_info).toBeNull();
  },
);

it.each([0n, 3n])(
  "rejects reserved extended ELF section counts containing %s",
  (count) => {
    const fixture = createGoBinaryFixture();
    fixture.bytes.writeUInt16LE(0, 60);
    fixture.bytes.writeBigUInt64LE(count, 256 + 32);
    expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(
      /extended|section count/i,
    );
  },
);

it.each(["names", "programs"] as const)(
  "rejects extended ELF %s values below their reserved ranges",
  (field) => {
    const fixture = createGoBinaryFixture();
    fixture.bytes.writeUInt16LE(0xffff, field === "names" ? 62 : 56);
    fixture.bytes.writeUInt32LE(1, 256 + (field === "names" ? 40 : 44));
    expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(/extended/i);
  },
);

it("requires SHT_NULL for the initial section carrying extended ELF numbering", () => {
  const bytes = extendedElfFixture();
  bytes.writeUInt32LE(1, 4096 + 4);
  expect(() => readGoBinaryImage(bytes)).toThrowError(
    /initial|section zero|SHT_NULL/i,
  );
});

it("reads a valid 65,536-entry ELF section table with an extended name-table index", () => {
  const bytes = extendedElfFixture();
  expect(readGoBinaryImage(bytes).build_info).toMatchObject({
    go_version: "go1.26.0",
    module_text: GO_MODULE_TEXT,
  });
});

const extendedElfFixture = (): Buffer => {
  const fixture = createGoBinaryFixture();
  const tableOffset = 4096;
  const count = 65536;
  const bytes = Buffer.alloc(tableOffset + count * 64);
  fixture.bytes.copy(bytes);
  bytes.writeBigUInt64LE(BigInt(tableOffset), 40);
  bytes.writeUInt16LE(0, 60);
  bytes.writeUInt16LE(0xffff, 62);
  bytes.writeBigUInt64LE(BigInt(count), tableOffset + 32);
  bytes.writeUInt32LE(count - 1, tableOffset + 40);
  fixture.bytes.subarray(384, 448).copy(bytes, tableOffset + 64);
  fixture.bytes.subarray(320, 384).copy(bytes, tableOffset + (count - 1) * 64);
  return bytes;
};

const legacyLayouts = [
  ["elf", 32, "little"],
  ["elf", 32, "big"],
  ["elf", 64, "little"],
  ["elf", 64, "big"],
  ["pe", 32, "little"],
  ["pe", 64, "little"],
  ["macho", 32, "little"],
  ["macho", 32, "big"],
  ["macho", 64, "little"],
  ["macho", 64, "big"],
] as const;

it.each(legacyLayouts)(
  "reads moduleless legacy %s %d-bit %s metadata with a zero-filled module header",
  (format, bits, byteOrder) => {
    const fixture = zeroFilledModuleFixture(format, bits, byteOrder);
    expect(readGoBinaryImage(fixture.bytes).build_info).toMatchObject({
      encoding: "pointer",
      go_version: "go1.17",
      module_text: "",
      module_bytes_base64: "",
      module_location: { offset: fixture.moduleField, bytes: 0 },
      module: {
        path: null,
        main: null,
        dependencies: [],
        settings: [],
        unparsed_lines: [],
        unparsed_line_bytes_base64: [],
        complete: true,
      },
    });
  },
);

it.each(["elf", "pe", "macho"] as const)(
  "recognizes a module header in a %s segment containing only zero-filled memory",
  (format) => {
    const fixture = zeroFilledModuleFixture(format, 64, "little", true);
    expect(readGoBinaryImage(fixture.bytes).build_info).toMatchObject({
      go_version: "go1.17",
      module_text: "",
      module_location: { offset: fixture.moduleField, bytes: 0 },
    });
  },
);

it.each(["elf", "pe", "macho"] as const)(
  "keeps unmapped and partial zero-filled %s module headers invalid",
  (format) => {
    const fixture = zeroFilledModuleFixture(format, 64, "little");
    fixture.bytes.writeBigUInt64LE(
      fixture.moduleAddress + 8n,
      fixture.moduleField,
    );
    expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(
      /mapped|range/i,
    );
    fixture.bytes.writeBigUInt64LE(0x30000n, fixture.moduleField);
    expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(
      /mapped|range/i,
    );
  },
);

it.each(["elf", "pe", "macho"] as const)(
  "keeps compiler headers in zero-filled %s memory invalid",
  (format) => {
    const fixture = zeroFilledModuleFixture(format, 64, "little");
    fixture.bytes.writeBigUInt64LE(
      fixture.moduleAddress,
      fixture.headerOffset + 16,
    );
    expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(
      /mapped|range/i,
    );
  },
);

it.each(["elf", "pe", "macho"] as const)(
  "keeps nonempty string contents in zero-filled %s memory invalid",
  (format) => {
    const version = zeroFilledModuleFixture(format, 64, "little");
    version.bytes.writeBigUInt64LE(version.moduleAddress, 1536);
    expect(() => readGoBinaryImage(version.bytes)).toThrowError(
      /mapped|range/i,
    );
    const module = zeroFilledModuleFixture(format, 64, "little");
    module.bytes.writeBigUInt64LE(0x10000n + 1552n, module.moduleField);
    module.bytes.writeBigUInt64LE(module.moduleAddress, 1552);
    expect(() => readGoBinaryImage(module.bytes)).toThrowError(/mapped|range/i);
  },
);

it.each(["elf", "pe", "macho"] as const)(
  "rejects zero-filled %s extents overflowing the image address width",
  (format) => {
    const fixture = zeroFilledModuleFixture(format, 64, "little", true);
    if (format === "elf")
      fixture.bytes.writeBigUInt64LE(0xfffffffffffffff8n, 184 + 16);
    else if (format === "pe")
      fixture.bytes.writeBigUInt64LE(0xfffffffffffeffffn, 152 + 24);
    else fixture.bytes.writeBigUInt64LE(0xfffffffffffffff8n, 184 + 24);
    expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(
      /overflow|addresses/i,
    );
  },
);

it.each(["elf", "pe", "macho"] as const)(
  "ignores unused file offsets for %s memory with no file bytes",
  (format) => {
    const fixture = zeroFilledModuleFixture(format, 64, "little", true);
    if (format === "elf")
      fixture.bytes.writeBigUInt64LE(0xffffffffffffffffn, 184 + 8);
    else if (format === "pe") fixture.bytes.writeUInt32LE(0xffffffff, 304 + 20);
    else fixture.bytes.writeBigUInt64LE(0xffffffffffffffffn, 184 + 40);
    expect(readGoBinaryImage(fixture.bytes).build_info?.go_version).toBe(
      "go1.17",
    );
  },
);

it("does not treat Mach-O __PAGEZERO as a module string header", () => {
  const fixture = zeroFilledModuleFixture("macho", 64, "little", true);
  fixture.bytes.fill(0, 184 + 8, 184 + 24);
  fixture.bytes.write("__PAGEZERO", 184 + 8);
  expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(/mapped|range/i);
});

it("rejects out-of-file bytes in an unmapped Mach-O segment", () => {
  const fixture = createGoBinaryFixture({ format: "macho" });
  addLegacyMapping(fixture.bytes, "macho", {
    address: 0x20000n,
    fileOffset: 3072,
    fileSize: 1025,
    memorySize: 0,
    protection: 0,
  });
  expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(
    /outside the file/i,
  );
});

it("rejects oversized Mach-O file contents when initial protection is set", () => {
  const fixture = createGoBinaryFixture({ format: "macho" });
  addLegacyMapping(fixture.bytes, "macho", {
    address: 0x20000n,
    fileOffset: 3072,
    fileSize: 512,
    memorySize: 0,
    protection: 3,
  });
  expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(
    /addresses or sizes are invalid/i,
  );
});

it("rejects build-info declared inside an unmapped Mach-O segment", () => {
  const fixture = createGoBinaryFixture({ format: "macho" });
  const command = 32 + 72 + 80;
  const size = 72;
  fixture.bytes.writeUInt32LE(2, 16);
  fixture.bytes.writeUInt32LE(304, 20);
  fixture.bytes.writeUInt32LE(0x19, command);
  fixture.bytes.writeUInt32LE(size + 80, command + 4);
  fixture.bytes.write("__DWARF", command + 8);
  fixture.bytes.writeBigUInt64LE(0x10000n, command + 24);
  fixture.bytes.writeBigUInt64LE(0n, command + 32);
  fixture.bytes.writeBigUInt64LE(3072n, command + 40);
  fixture.bytes.writeBigUInt64LE(512n, command + 48);
  fixture.bytes.writeUInt32LE(3, command + 56);
  fixture.bytes.writeUInt32LE(0, command + 60);
  fixture.bytes.writeUInt32LE(1, command + 64);
  const section = command + size;
  fixture.bytes.write("__go_buildinfo", section);
  fixture.bytes.write("__DWARF", section + 16);
  fixture.bytes.writeBigUInt64LE(0x10000n, section + 32);
  fixture.bytes.writeBigUInt64LE(0n, section + 40);
  fixture.bytes.writeUInt32LE(3072, section + 48);
  expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(/unmapped/i);
});

it("does not mark Mach-O section bytes outside their owning segment as read-only", () => {
  const fixture = createGoBinaryFixture({ format: "macho" });
  const command = 32;
  const section = command + 72;
  fixture.bytes.write("__TEXT", command + 8, "ascii");
  fixture.bytes.writeBigUInt64LE(1024n, command + 48);
  fixture.bytes.writeUInt32LE(1, command + 56);
  fixture.bytes.writeUInt32LE(1, command + 60);
  fixture.bytes.write("__debug_info", section, "ascii");
  fixture.bytes.write("__TEXT", section + 16, "ascii");
  fixture.bytes.writeBigUInt64LE(0x10c00n, section + 32);
  fixture.bytes.writeBigUInt64LE(128n, section + 40);
  fixture.bytes.writeUInt32LE(3072, section + 48);
  const image = readMachoImage(fixture.bytes);
  expect(image.sections[0]).toMatchObject({
    file_backed: false,
    read_only: false,
  });
});

it.each(["elf", "pe", "macho"] as const)(
  "refuses file aliases overlapping only part of a zero-filled %s module header",
  (format) => {
    const fixture = zeroFilledModuleFixture(format, 64, "little");
    addLegacyMapping(fixture.bytes, format, {
      address: fixture.moduleAddress + 8n,
      fileOffset: 512,
      fileSize: 8,
      memorySize: 8,
    });
    expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(/ambiguous/i);
  },
);

it.each(["elf", "pe", "macho"] as const)(
  "refuses a file alias covering a zero-filled %s module header even when file bytes are zero",
  (format) => {
    const fixture = zeroFilledModuleFixture(format, 64, "little");
    addLegacyMapping(fixture.bytes, format, {
      address: fixture.moduleAddress,
      fileOffset: 512,
      fileSize: 16,
      memorySize: 16,
    });
    expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(/ambiguous/i);
  },
);

it("does not infer PE zero-fill from raw padding beyond a smaller virtual size", () => {
  const fixture = createGoBinaryFixture({ format: "pe", encoding: "pointer" });
  fixture.bytes.writeUInt32LE(1024, 264 + 8);
  expect(readGoBinaryImage(fixture.bytes).build_info?.go_version).toBe(
    "go1.26.0",
  );
});

it.each(["inline", "pointer"] as const)(
  "refuses zero-filled aliases overlapping only %s string bytes",
  (encoding) => {
    const fixture = createGoBinaryFixture({ format: "pe", encoding });
    addLegacyMapping(fixture.bytes, "pe", {
      address: 0x10000n + BigInt(fixture.moduleOffset + 32),
      fileOffset: 0,
      fileSize: 0,
      memorySize: 8,
    });
    expect(() => readGoBinaryImage(fixture.bytes)).toThrowError(/ambiguous/i);
  },
);

const zeroFilledModuleFixture = (
  format: "elf" | "pe" | "macho",
  bits: 32 | 64,
  byteOrder: "little" | "big",
  separateSegment = false,
) => {
  const fixture = createGoBinaryFixture({
    format,
    bits,
    byteOrder,
    encoding: "pointer",
    goVersion: "go1.17",
  });
  const view = new DataView(
    fixture.bytes.buffer,
    fixture.bytes.byteOffset,
    fixture.bytes.byteLength,
  );
  const little = byteOrder === "little";
  const moduleAddress = separateSegment
    ? 0x20000n
    : format === "pe"
      ? 0x10c00n
      : 0x11000n;
  const moduleField = fixture.headerOffset + 16 + bits / 8;
  if (bits === 64) view.setBigUint64(moduleField, moduleAddress, little);
  else view.setUint32(moduleField, Number(moduleAddress), little);
  if (separateSegment) {
    addLegacyMapping(
      fixture.bytes,
      format,
      { address: moduleAddress, fileOffset: 0, fileSize: 0, memorySize: 16 },
      { bits, little },
    );
  } else if (format === "elf") {
    if (bits === 64) view.setBigUint64(168, 4112n, little);
    else view.setUint32(148, 4112, little);
  } else if (format === "pe") {
    view.setUint32(152 + (bits === 64 ? 112 : 96) + 8, 2064, little);
  } else if (bits === 64) {
    view.setBigUint64(32 + 32, 4112n, little);
  } else {
    view.setUint32(28 + 28, 4112, little);
  }
  return { ...fixture, moduleAddress, moduleField };
};

const addLegacyMapping = (
  bytes: Buffer,
  format: "elf" | "pe" | "macho",
  {
    address,
    fileOffset,
    fileSize,
    memorySize,
    protection = 3,
  }: {
    address: bigint;
    fileOffset: number;
    fileSize: number;
    memorySize: number;
    protection?: number;
  },
  { bits, little }: { bits: 32 | 64; little: boolean } = {
    bits: 64,
    little: true,
  },
): void => {
  const wide = bits === 64;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number, value: number) =>
    view.setUint32(offset, value, little);
  const word = (offset: number, value: bigint) => {
    if (wide) view.setBigUint64(offset, value, little);
    else u32(offset, Number(value));
  };
  if (format === "elf") {
    view.setUint16(wide ? 56 : 44, 2, little);
    const entry = 128 + (wide ? 56 : 32);
    u32(entry, 1);
    u32(entry + (wide ? 4 : 24), 6);
    word(entry + (wide ? 8 : 4), BigInt(fileOffset));
    word(entry + (wide ? 16 : 8), address);
    word(entry + (wide ? 32 : 16), BigInt(fileSize));
    word(entry + (wide ? 40 : 20), BigInt(memorySize));
  } else if (format === "pe") {
    view.setUint16(134, 2, little);
    const entry = 152 + (wide ? 112 : 96) + 40;
    u32(entry + 8, memorySize);
    u32(entry + 12, Number(address - 0x10000n));
    u32(entry + 16, fileSize);
    u32(entry + 20, fileOffset);
    u32(entry + 36, 0xc0000040);
  } else {
    const entry = wide ? 32 + 72 + 80 : 28 + 56 + 68;
    const size = wide ? 72 : 56;
    u32(16, 2);
    u32(20, entry + size - (wide ? 32 : 28));
    u32(entry, wide ? 0x19 : 1);
    u32(entry + 4, size);
    bytes.write("__EXTRA", entry + 8);
    word(entry + 24, address);
    word(entry + (wide ? 32 : 28), BigInt(memorySize));
    word(entry + (wide ? 40 : 32), BigInt(fileOffset));
    word(entry + (wide ? 48 : 36), BigInt(fileSize));
    u32(entry + (wide ? 56 : 40), protection);
    u32(entry + (wide ? 60 : 44), protection);
  }
};
