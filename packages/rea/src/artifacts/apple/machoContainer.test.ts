import { describe, expect, it } from "vitest";

import {
  CPU,
  arArchive,
  fatImage,
  machoImage,
  readerOf,
} from "./MachoImage.fixture.js";
import { readMachoImage } from "./MachoLoadCommandReader.js";
import { javaClassFile } from "../../../tests/fixtures/javaClassFile.js";
import { classifyArtifactBytes } from "../inventory/ArtifactGraphConstruction.js";
import { createArtifactClassificationProbe } from "../ArtifactClassificationProbe.js";
import { parseExecutableHeader } from "../../domain/binaryTarget.js";
import { isJvmClassFile } from "../../domain/apple/jvmClassFile.js";
import {
  classifyFatContainerIdentity,
  classifyFatContainerEvidence,
  findOverlappingFatSlices,
  readFatContainerHeader,
  readFatSliceDeclarations,
  readMachoHeaderPrefixFacts,
} from "../../domain/apple/machoContainer.js";

const classify = (bytes: Uint8Array) => {
  const header = readFatContainerHeader(bytes, bytes.byteLength);
  if (header.state !== "parsed") return header;
  return classifyFatContainerIdentity(header, (offset) => {
    if (offset + 4 > bytes.byteLength) return undefined;
    return new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(offset, false);
  });
};

describe("FAT declaration facts", () => {
  it.each([
    { wide: false, littleEndian: false },
    { wide: false, littleEndian: true },
    { wide: true, littleEndian: false },
    { wide: true, littleEndian: true },
  ])(
    "retains raw fields and reserved-field absence for wide=$wide littleEndian=$littleEndian",
    async ({ wide, littleEndian }) => {
      const arm64e = machoImage({ cpu: CPU.arm64e });
      const x86 = machoImage({ cpu: CPU.x86_64 });
      const bytes = fatImage(
        [
          { cpu: CPU.arm64e, bytes: arm64e },
          { cpu: CPU.x86_64, bytes: x86 },
        ],
        wide,
        littleEndian,
      );
      if (wide)
        new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ).setUint32(8 + 32 + 28, 0x89abcdef, littleEndian);
      const declarations = readFatSliceDeclarations(
        bytes.subarray(8, 8 + 2 * (wide ? 32 : 20)),
        { count: 2, wide, littleEndian },
      );
      expect(declarations).toEqual({
        status: "parsed",
        slices: [
          {
            index: 0,
            offset: 4096,
            size: arm64e.byteLength,
            alignmentExponent: 12,
            cpuType: CPU.arm64e.type,
            cpuSubtype: CPU.arm64e.subtype,
            reserved: wide ? 0 : null,
          },
          {
            index: 1,
            offset: 8192,
            size: x86.byteLength,
            alignmentExponent: 12,
            cpuType: CPU.x86_64.type,
            cpuSubtype: CPU.x86_64.subtype,
            reserved: wide ? 0x89abcdef : null,
          },
        ],
      });
      // Physical facts do not impose Hopper's reserved-field admission policy.
      expect(classify(bytes)).toEqual({ state: "mach-o" });
      expect(
        await readMachoImage(readerOf(bytes), bytes.byteLength),
      ).toMatchObject({
        status: "parsed",
      });
    },
  );

  it("finds overlap in physical order while retaining declarations in table order", () => {
    const bytes = fatImage([
      { cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) },
      { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
    ]);
    const header = readFatContainerHeader(bytes, bytes.byteLength);
    if (header.state !== "parsed") throw new Error("expected parsed FAT table");
    const first = { ...header.slices[0]!, offset: 128, size: 64 };
    const second = { ...header.slices[1]!, offset: 96, size: 64 };
    const tableOrder = [first, second];
    const overlap = findOverlappingFatSlices(tableOrder);
    expect(overlap).toEqual([second, first]);
    expect(overlap?.[0]).toBe(second);
    expect(overlap?.[1]).toBe(first);
    expect(tableOrder).toEqual([first, second]);
    expect(
      findOverlappingFatSlices([first, { ...second, size: 32 }]),
    ).toBeNull();
    expect(
      findOverlappingFatSlices([first, { ...second, size: 16 }]),
    ).toBeNull();
    expect(findOverlappingFatSlices([first])).toBeNull();
    expect(findOverlappingFatSlices([])).toBeNull();
  });
});

it("preserves explicit unknown slice evidence instead of falling back to retained bytes", () => {
  const bytes = Buffer.from(
    fatImage([{ cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) }]),
  );
  const header = readFatContainerHeader(bytes, bytes.length);
  if (header.state !== "parsed") throw new Error("Expected FAT header");
  const offset = header.slices[0]!.offset;
  const unknown = new Map([
    [offset, readMachoHeaderPrefixFacts(Buffer.alloc(0))],
  ]);
  expect(classifyFatContainerEvidence(header, bytes, new Map())).toEqual({
    state: "mach-o",
  });
  expect(classifyFatContainerEvidence(header, bytes, unknown)).toEqual({
    state: "needs-slice-header",
    offsets: [offset],
  });
  const probe = createArtifactClassificationProbe();
  probe.write(bytes);
  const evidence = probe.finish(bytes.length);
  expect(
    classifyArtifactBytes(
      {
        ...evidence,
        fatSliceHeaders: { header, sliceHeadersByOffset: new Map() },
      },
      bytes.length,
    ),
  ).toBe("mach-o-universal");
  expect(
    classifyArtifactBytes(
      {
        ...evidence,
        fatSliceHeaders: { header, sliceHeadersByOffset: unknown },
      },
      bytes.length,
    ),
  ).toBe("unknown");
  const native = parseExecutableHeader(
    bytes,
    "arm64",
    bytes.length,
    undefined,
    {
      header,
      sliceHeadersByOffset: unknown,
    },
  );
  expect(native).toEqual({
    ok: false,
    error: "FAT slice identity is outside the bounded prefix",
  });
  expect(
    classifyFatContainerEvidence(header, bytes.subarray(0, offset + 3)),
  ).toEqual({
    state: "needs-slice-header",
    offsets: [offset],
  });
});

describe("FAT Mach-O identity", () => {
  it("does not treat known CPU declarations as proof when slices are ar archives", async () => {
    const archive = arArchive();
    const bytes = fatImage([
      { cpu: CPU.x86_64, bytes: archive },
      { cpu: CPU.arm64, bytes: archive },
    ]);

    expect(classify(bytes)).toEqual({ state: "not-mach-o" });
    expect(await readMachoImage(readerOf(bytes), bytes.byteLength)).toEqual({
      status: "not-mach-o",
    });
    expect(parseExecutableHeader(Buffer.from(bytes), "arm64")).toEqual({
      ok: false,
      error: "unsupported binary format",
    });
  });

  it("rejects a mixed FAT container instead of selecting an ar slice as Mach-O", async () => {
    const bytes = fatImage([
      {
        cpu: CPU.x86_64,
        bytes: machoImage({ cpu: CPU.x86_64 }),
      },
      { cpu: CPU.arm64, bytes: arArchive() },
    ]);

    expect(classify(bytes)).toEqual({ state: "not-mach-o" });
    expect(await readMachoImage(readerOf(bytes), bytes.byteLength)).toEqual({
      status: "not-mach-o",
    });
    expect(parseExecutableHeader(Buffer.from(bytes), "arm64")).toEqual({
      ok: false,
      error: "unsupported binary format",
    });
  });

  it("confirms universal and thin Mach-O controls from their image headers", async () => {
    const slice = machoImage({ cpu: CPU.arm64 });
    const universal = fatImage([{ cpu: CPU.arm64, bytes: slice }]);
    expect(classify(universal)).toMatchObject({ state: "mach-o" });
    expect(
      await readMachoImage(readerOf(universal), universal.byteLength),
    ).toMatchObject({
      status: "parsed",
    });
    expect(
      parseExecutableHeader(Buffer.from(universal), "arm64"),
    ).toMatchObject({
      ok: true,
      value: { format: "mach-o-universal", architecture: "arm64" },
    });

    expect(
      await readMachoImage(readerOf(slice), slice.byteLength),
    ).toMatchObject({
      status: "parsed",
    });
    expect(parseExecutableHeader(Buffer.from(slice), "arm64")).toMatchObject({
      ok: true,
      value: { format: "mach-o", architecture: "arm64" },
    });

    const undeclaredCpu = { type: 0x12345678, subtype: 0 };
    const unlistedCpuImage = fatImage([
      { cpu: undeclaredCpu, bytes: machoImage({ cpu: undeclaredCpu }) },
    ]);
    expect(classify(unlistedCpuImage)).toMatchObject({ state: "mach-o" });
  });

  it("parses CPU identity from the actual thin-header byte order", () => {
    const littleEndian = machoImage({ cpu: CPU.arm64 });
    const bigEndian = Buffer.alloc(12);
    bigEndian.writeUInt32BE(0xfeedfacf, 0);
    bigEndian.writeUInt32BE(CPU.x86_64.type, 4);
    bigEndian.writeUInt32BE(CPU.x86_64.subtype, 8);
    expect(readMachoHeaderPrefixFacts(littleEndian.subarray(0, 12))).toEqual({
      magic: 0xcffaedfe,
      format: { wide: true, littleEndian: true, headerSize: 32 },
      identity: {
        cpuType: CPU.arm64.type,
        cpuSubtype: CPU.arm64.subtype,
      },
    });
    expect(readMachoHeaderPrefixFacts(bigEndian)).toEqual({
      magic: 0xfeedfacf,
      format: { wide: true, littleEndian: false, headerSize: 32 },
      identity: {
        cpuType: CPU.x86_64.type,
        cpuSubtype: CPU.x86_64.subtype,
      },
    });
    expect(readMachoHeaderPrefixFacts(littleEndian.subarray(0, 11))).toEqual({
      magic: 0xcffaedfe,
      format: { wide: true, littleEndian: true, headerSize: 32 },
      identity: null,
    });
    expect(readMachoHeaderPrefixFacts(littleEndian.subarray(0, 3))).toEqual({
      magic: null,
      format: null,
      identity: null,
    });
  });

  it.each([
    { wrongIndex: 0, label: "selected host slice" },
    { wrongIndex: 1, label: "non-host slice" },
  ])(
    "rejects table CPU claims that disagree with the $label header",
    ({ wrongIndex }) => {
      const bytes = fatImage([
        { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
        { cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) },
      ]);
      const entry = 8 + wrongIndex * 20;
      // Change only the FAT claim; both embedded thin headers remain intact.
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
        entry,
        wrongIndex === 0 ? CPU.arm64.type : CPU.x86_64.type,
        false,
      );
      const result = parseExecutableHeader(Buffer.from(bytes), "arm64");
      expect(result).toEqual({
        ok: false,
        error: `FAT architecture ${wrongIndex} CPU type/subtype disagrees with its Mach-O header`,
      });
    },
  );
});

describe("FAT slice header identity and bounds", () => {
  const classWithInterface = (reference: number): Buffer => {
    // Retain enough bytes for the coincident FAT table claim to be readable;
    // otherwise rejecting JVM identity would still yield not-fat on truncation.
    const source = javaClassFile(2048, true);
    const interfaceCountOffset = source.length - 8;
    const bytes = Buffer.concat([
      source.subarray(0, interfaceCountOffset + 2),
      Buffer.alloc(2),
      source.subarray(interfaceCountOffset + 2),
    ]);
    bytes.writeUInt16BE(1, interfaceCountOffset);
    bytes.writeUInt16BE(reference, interfaceCountOffset + 2);
    return bytes;
  };

  it("preserves JVM identity for class-tagged interface references", () => {
    const bytes = classWithInterface(3);
    expect(isJvmClassFile(bytes)).toBe(true);
    expect(readFatContainerHeader(bytes, bytes.length)).toEqual({
      state: "not-fat",
    });
  });

  it.each([0, 2, 8, 65535])(
    "does not suppress FAT examination for invalid JVM interface index %i",
    (reference) => {
      // Zero, a UTF-8 entry, and out-of-pool indices are not class references.
      const bytes = classWithInterface(reference);
      expect(isJvmClassFile(bytes)).toBe(false);
      expect(readFatContainerHeader(bytes, bytes.length).state).toBe("parsed");
    },
  );

  it("keeps Java CAFEBABE class files outside FAT and Mach-O identity", async () => {
    const bytes = javaClassFile();
    expect(readFatContainerHeader(bytes, bytes.byteLength)).toEqual({
      state: "not-fat",
    });
    expect(await readMachoImage(readerOf(bytes), bytes.byteLength)).toEqual({
      status: "not-mach-o",
    });
    expect(parseExecutableHeader(Buffer.from(bytes), "arm64")).toEqual({
      ok: false,
      error: "unsupported binary format",
    });
  });

  it("uses the shared exact subtype identity rule, including capability bits", () => {
    const bytes = fatImage([
      { cpu: CPU.arm64e, bytes: machoImage({ cpu: CPU.arm64e }) },
    ]);
    // The FAT table drops the subtype capability bits while the thin header
    // retains them. Admission follows validateFatSliceIdentity's exact rule.
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
      12,
      CPU.arm64e.subtype & 0x00ffffff,
      false,
    );
    expect(parseExecutableHeader(Buffer.from(bytes), "arm64")).toEqual({
      ok: false,
      error:
        "FAT architecture 0 CPU type/subtype disagrees with its Mach-O header",
    });
  });

  it("keeps unresolved headers unknown and preserves declared-range failures", () => {
    const bytes = Buffer.alloc(28);
    bytes.writeUInt32BE(0xcafebabe, 0);
    bytes.writeUInt32BE(1, 4);
    bytes.writeUInt32BE(CPU.arm64.type, 8);
    bytes.writeUInt32BE(4096, 16);
    bytes.writeUInt32BE(32, 20);
    bytes.writeUInt32BE(12, 24);
    const header = readFatContainerHeader(bytes, 4128);
    if (header.state !== "parsed") throw new Error("expected parsed FAT table");
    expect(classifyFatContainerIdentity(header, () => undefined)).toEqual({
      state: "needs-slice-header",
      offsets: [4096],
    });

    const badRange = {
      ...header,
      rangeIssues: [
        { category: "malformed" as const, reason: "bad test range" },
      ],
    };
    expect(classifyFatContainerIdentity(badRange, () => null)).toEqual({
      state: "malformed",
      category: "malformed",
      reason: "bad test range",
    });
  });

  it("classifies a valid but too-short slice without inventing header bytes", () => {
    const bytes = Buffer.alloc(31);
    bytes.writeUInt32BE(0xcafebabe, 0);
    bytes.writeUInt32BE(1, 4);
    bytes.writeUInt32BE(CPU.arm64.type, 8);
    bytes.writeUInt32BE(28, 16);
    bytes.writeUInt32BE(3, 20);
    bytes.set([0xcf, 0xfa, 0xed], 28);
    const header = readFatContainerHeader(bytes, bytes.length);
    if (header.state !== "parsed") throw new Error("expected parsed FAT table");
    expect(
      classifyFatContainerIdentity(header, () => {
        throw new Error("a three-byte slice cannot provide a four-byte magic");
      }),
    ).toEqual({ state: "not-mach-o" });
  });
});
