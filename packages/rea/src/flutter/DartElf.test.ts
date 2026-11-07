import { describe, expect, it } from "vitest";

import { readElfSymbols, readSnapshotHeader } from "./DartElf.js";
import {
  REFERENCE_HASH,
  buildElf32Image,
  buildElf64Image,
  buildStrippedElf64Image,
  snapshotSection,
  appendElfRanges,
} from "./FlutterBuild.fixture.js";

const readElfSymbol = async (bytes: Buffer, name: string) => {
  const result = await readElfSymbols(bytes, [name]);
  return result.symbols[0] === undefined
    ? { failure: result.failures[0]! }
    : { symbol: result.symbols[0] };
};

/**
 * Build a synthetic ELF64 little-endian image with one PT_LOAD segment
 * and a dynamic symbol table naming the Dart snapshot sections. This keeps
 * the golden tests self-contained instead of reading the author's disk.
 */
const GALLERY_HASH = REFERENCE_HASH;

const imageWithSections = (): Buffer => {
  const elf = buildElf64Image([
    { name: "_kDartVmSnapshotData", value: 0x400, size: 52 },
    { name: "_kDartIsolateSnapshotData", value: 0x800, size: 52 },
  ]);
  const section = snapshotSection(GALLERY_HASH);
  return Buffer.concat([
    elf,
    Buffer.alloc(0x400 - elf.length),
    section,
    Buffer.alloc(0x800 - 0x400 - section.length),
    section,
  ]);
};

/** The same layout without section headers: symbols live in PT_DYNAMIC. */
const strippedImageWithSections = (
  extraDynamicEntries: ReadonlyArray<readonly [number, bigint]> = [],
): Buffer => {
  const elf = buildStrippedElf64Image(
    [
      { name: "_kDartVmSnapshotData", value: 0x400, size: 52 },
      { name: "_kDartIsolateSnapshotData", value: 0x800, size: 52 },
    ],
    extraDynamicEntries,
  );
  const section = snapshotSection(GALLERY_HASH);
  return Buffer.concat([
    elf,
    Buffer.alloc(0x400 - elf.length),
    section,
    Buffer.alloc(0x800 - 0x400 - section.length),
    section,
  ]);
};

describe("readElfSymbol", () => {
  it("locates snapshot symbols in a synthetic ELF64 image", async () => {
    const image = imageWithSections();
    const isolateData = await readElfSymbol(image, "_kDartIsolateSnapshotData");
    if ("failure" in isolateData) throw new Error(isolateData.failure.reason);
    expect(isolateData.symbol.offset).toBe(0x800);
    expect(isolateData.symbol.size).toBe(52);
    const header = readSnapshotHeader(image, isolateData.symbol.offset);
    expect(header.magicValid).toBe(true);
    expect(header.kind).toBe(3);
  });

  it("refuses a non-ELF image instead of guessing", async () => {
    const result = await readElfSymbol(Buffer.from("not an elf at all"), "x");
    expect("failure" in result && result.failure.reason).toBe(
      "not an ELF image",
    );
  });

  it("refuses an unknown symbol", async () => {
    const result = await readElfSymbol(buildElf64Image([]), "_kDartAbsent");
    expect("failure" in result).toBe(true);
  });

  it("locates snapshot symbols in a section-stripped ET_DYN image", async () => {
    const image = strippedImageWithSections();
    const isolateData = await readElfSymbol(image, "_kDartIsolateSnapshotData");
    if ("failure" in isolateData) throw new Error(isolateData.failure.reason);
    expect(isolateData.symbol.offset).toBe(0x800);
    expect(isolateData.symbol.size).toBe(52);
    const header = readSnapshotHeader(image, isolateData.symbol.offset);
    expect(header.magicValid).toBe(true);
    expect(header.kind).toBe(3);
  });

  it.each([
    [16, "DT_SYMBOLIC"],
    [22, "DT_TEXTREL"],
    [24, "DT_BIND_NOW"],
  ] as const)(
    "ignores the payload of %s (%s) without losing symbols",
    async (tag, _name) => {
      const names = ["_kDartVmSnapshotData", "_kDartIsolateSnapshotData"];
      const control = await readElfSymbols(
        strippedImageWithSections([[tag, 0n]]),
        names,
      );
      expect(control.failures).toEqual([]);
      expect(control.symbols).toHaveLength(2);
      const image = strippedImageWithSections([[tag, 0xffffffffffffffffn]]);
      const original = Buffer.from(image);
      expect(await readElfSymbols(image, names)).toEqual(control);
      expect(Buffer.compare(image, original)).toBe(0);
    },
  );

  it.each([4, 5, 6, 10, 11, 0x6ffffef5])(
    "keeps representability checks for consumed dynamic tag %s",
    async (tag) => {
      const image = strippedImageWithSections([[tag, 0xffffffffffffffffn]]);
      expect(await readElfSymbols(image, ["_kDartVmSnapshotData"])).toEqual({
        symbols: [],
        failures: [{ reason: "Dynamic entry is not representable" }],
      });
    },
  );

  it("refuses a stripped image whose PT_DYNAMIC carries no symbols", async () => {
    // Drop the PT_DYNAMIC program header by leaving only PT_LOAD.
    const image = strippedImageWithSections();
    image.writeUInt16LE(1, 0x38); // e_phnum
    const result = await readElfSymbol(image, "_kDartVmSnapshotData");
    expect("failure" in result && result.failure.reason).toBe(
      "symbol _kDartVmSnapshotData is not in the dynamic symbol table",
    );
  });

  it("keeps refusing a stripped image that is not ET_DYN", async () => {
    const image = buildStrippedElf64Image([]);
    image.writeUInt16LE(1, 0x10); // ET_REL: the dynamic fallback must not apply
    const result = await readElfSymbol(image, "_kDartVmSnapshotData");
    expect("failure" in result && result.failure.reason).toBe(
      "ELF section header table is missing or out of bounds",
    );
  });

  it.each([false, true])(
    "ignores undefined entries with loadable values (stripped: %s)",
    async (stripped) => {
      const image = stripped
        ? strippedImageWithSections()
        : imageWithSections();
      const table = stripped
        ? Number(
            image.readBigUInt64LE(
              Number(image.readBigUInt64LE(64 + 56 + 8)) + 8,
            ),
          )
        : Number(
            image.readBigUInt64LE(
              Number(image.readBigUInt64LE(0x28)) + 64 + 0x18,
            ),
          );
      for (const sectionIndex of [
        0,
        0xfff2,
        0xffff,
        ...(stripped ? [] : [0x1234]),
      ]) {
        image.writeUInt16LE(sectionIndex, table + 6);
        expect(
          await readElfSymbol(image, "_kDartVmSnapshotData"),
        ).toHaveProperty("failure");
        expect(
          await readElfSymbol(image, "_kDartIsolateSnapshotData"),
        ).toMatchObject({ symbol: { offset: 0x800, size: 52 } });
      }
    },
  );
});

describe("dynamic symbols without a SHT_DYNSYM section", () => {
  it.each([false, true])(
    "uses PT_DYNAMIC with a retained directory (data sections: %s)",
    async (retainDataSections) => {
      const original = strippedImageWithSections();
      const image = appendElfRanges(
        original,
        "section",
        retainDataSections
          ? [
              { type: 1, offset: 0x400, size: 52 },
              { type: 1, offset: 0x800, size: 52 },
            ]
          : [],
      );
      const names = ["_kDartVmSnapshotData", "_kDartIsolateSnapshotData"];
      const control = await readElfSymbols(original, names);
      expect(control.failures).toEqual([]);
      expect(control.symbols).toHaveLength(2);
      const before = Buffer.from(image);
      expect(await readElfSymbols(image, names)).toEqual(control);
      expect(Buffer.compare(image, before)).toBe(0);
    },
  );

  it("keeps malformed present dynsym sections as failures despite usable PT_DYNAMIC", async () => {
    const image = appendElfRanges(strippedImageWithSections(), "section", [
      { type: 11, offset: 0, size: 0 },
    ]);
    expect(await readElfSymbols(image, ["_kDartVmSnapshotData"])).toEqual({
      symbols: [],
      failures: [{ reason: "Dynamic symbol table is malformed" }],
    });
  });

  it("keeps bounded dynamic metadata requirements with a retained directory", async () => {
    const image = appendElfRanges(strippedImageWithSections(), "section", []);
    // The first entry is DT_SYMTAB, whose address must remain representable.
    const dynamic = Number(image.readBigUInt64LE(64 + 56 + 8));
    image.writeBigUInt64LE(0xffffffffffffffffn, dynamic + 8);
    expect(await readElfSymbols(image, ["_kDartVmSnapshotData"])).toEqual({
      symbols: [],
      failures: [{ reason: "Dynamic entry is not representable" }],
    });
  });
});

describe("ELF symbol-table ownership", () => {
  it.each([
    { address: 0x400, offset: 0x700, size: 52 },
    { address: 0x410, offset: 0x710, size: 4 },
    { address: 0x3f0, offset: 0x6f0, size: 20 },
  ])(
    "rejects conflicting interpretations of any symbol byte: %j",
    async (range) => {
      const image = appendElfRanges(imageWithSections(), "program", [
        { type: 1, ...range },
      ]);
      const names = ["_kDartVmSnapshotData", "_kDartIsolateSnapshotData"];
      const result = await readElfSymbols(image, names);
      expect(result.symbols).toEqual([
        { name: names[1], offset: 0x800, size: 52 },
      ]);
      expect(result.failures).toContainEqual({
        reason: expect.stringContaining("conflicting PT_LOAD"),
      });
      const phoff = Number(image.readBigUInt64LE(0x20));
      const first = Buffer.from(image.subarray(phoff, phoff + 56));
      image.copy(image, phoff, phoff + 56, phoff + 112);
      first.copy(image, phoff + 56);
      expect(await readElfSymbols(image, names)).toEqual(result);
    },
  );

  it("accepts equivalent overlaps and excludes adjacent unrelated mappings", async () => {
    const image = appendElfRanges(imageWithSections(), "program", [
      { type: 1, address: 0x410, offset: 0x410, size: 4 },
      { type: 1, address: 0x400 + 52, offset: 0x700, size: 4 },
    ]);
    expect(await readElfSymbols(image, ["_kDartVmSnapshotData"])).toEqual({
      symbols: [{ name: "_kDartVmSnapshotData", offset: 0x400, size: 52 }],
      failures: [],
    });
  });

  it("does not publish an earlier definition when another definition has unresolved mapping", async () => {
    const image = imageWithSections();
    const shoff = Number(image.readBigUInt64LE(0x28));
    const symbols = Number(image.readBigUInt64LE(shoff + 64 + 0x18));
    image.writeUInt32LE(image.readUInt32LE(symbols), symbols + 24);
    const conflict = appendElfRanges(image, "program", [
      { type: 1, address: 0x810, offset: 0x710, size: 4 },
    ]);
    const result = await readElfSymbols(conflict, ["_kDartVmSnapshotData"]);
    expect(result.symbols).toEqual([]);
    expect(result.failures).toEqual([
      {
        reason: "Symbol _kDartVmSnapshotData has conflicting PT_LOAD mappings",
      },
    ]);
  });

  it("handles zero-width symbols at a unique segment end without choosing a conflicting shared endpoint", async () => {
    const image = imageWithSections();
    const shoff = Number(image.readBigUInt64LE(0x28));
    const symbols = Number(image.readBigUInt64LE(shoff + 64 + 0x18));
    const at = Number(image.readBigUInt64LE(64 + 0x20));
    image.writeBigUInt64LE(BigInt(at), symbols + 8);
    image.writeBigUInt64LE(0n, symbols + 16);
    expect(
      (await readElfSymbols(image, ["_kDartVmSnapshotData"])).symbols,
    ).toEqual([{ name: "_kDartVmSnapshotData", offset: at, size: 0 }]);
    const ambiguous = appendElfRanges(image, "program", [
      { type: 1, address: at, offset: 0x700, size: 4 },
    ]);
    expect(
      (await readElfSymbols(ambiguous, ["_kDartVmSnapshotData"])).symbols,
    ).toEqual([]);
  });

  it.each(["hash", "symbols", "strings"] as const)(
    "rejects partially conflicting dynamic %s mappings",
    async (table) => {
      const image = strippedImageWithSections();
      const dynamic = Number(image.readBigUInt64LE(64 + 56 + 8));
      const tagIndex = table === "hash" ? 4 : table === "symbols" ? 0 : 1;
      const at = Number(image.readBigUInt64LE(dynamic + tagIndex * 16 + 8));
      const conflict = appendElfRanges(image, "program", [
        { type: 1, address: at + 1, offset: 0x700, size: 1 },
      ]);
      const result = await readElfSymbols(conflict, ["_kDartVmSnapshotData"]);
      expect(result.symbols).toEqual([]);
      expect(result.failures).toContainEqual({
        reason: expect.stringContaining("conflicting PT_LOAD"),
      });
    },
  );

  it.each([false, true])(
    "keeps a symbol terminator inside dynstr (stripped: %s)",
    async (stripped) => {
      const image = stripped
        ? strippedImageWithSections()
        : imageWithSections();
      const name = "_kDartVmSnapshotData";
      if (stripped) {
        const dynamic = Number(image.readBigUInt64LE(64 + 56 + 8));
        image.writeBigUInt64LE(BigInt(name.length + 1), dynamic + 2 * 16 + 8); // DT_STRSZ, leading NUL included.
      } else {
        const shoff = Number(image.readBigUInt64LE(0x28));
        image.writeBigUInt64LE(BigInt(name.length + 1), shoff + 2 * 64 + 0x20);
      }
      expect((await readElfSymbols(image, [name])).symbols).toEqual([]);
    },
  );

  it("uses DT_HASH's count when strings precede symbols instead of reading following payload", async () => {
    const image = strippedImageWithSections();
    const dynamic = Number(image.readBigUInt64LE(64 + 56 + 8));
    const symbols = Number(image.readBigUInt64LE(dynamic + 8));
    image.copy(image, 0x300, symbols, symbols + 48);
    image.writeBigUInt64LE(0x300n, dynamic + 8);
    const hash = Number(image.readBigUInt64LE(dynamic + 4 * 16 + 8));
    image.writeUInt32LE(1, hash + 4); // Only the VM entry belongs to dynsym.
    const result = await readElfSymbols(image, [
      "_kDartVmSnapshotData",
      "_kDartIsolateSnapshotData",
    ]);
    expect(result.symbols).toEqual([
      { name: "_kDartVmSnapshotData", offset: 0x400, size: 52 },
    ]);
    expect(result.failures).toContainEqual({
      reason:
        "symbol _kDartIsolateSnapshotData is not in the dynamic symbol table",
    });
    image.writeBigUInt64LE(0x60000001n, dynamic + 4 * 16); // No recognized count table.
    expect(
      (await readElfSymbols(image, ["_kDartVmSnapshotData"])).failures,
    ).toContainEqual({
      reason: "Stripped ELF has no DT_HASH or DT_GNU_HASH symbol count",
    });
  });

  it("bounds GNU hash chains and resolves both requested symbols in one inventory", async () => {
    const image = strippedImageWithSections();
    const dynamic = Number(image.readBigUInt64LE(64 + 56 + 8));
    const hash = Number(image.readBigUInt64LE(dynamic + 4 * 16 + 8));
    image.writeBigUInt64LE(0x6ffffef5n, dynamic + 4 * 16);
    image.fill(0, hash, hash + 32);
    image.writeUInt32LE(1, hash); // nbuckets
    image.writeUInt32LE(1, hash + 4); // symoffset
    image.writeUInt32LE(1, hash + 8); // bloom words
    image.writeUInt32LE(1, hash + 24); // bucket: last chain begins at symbol 1
    image.writeUInt32LE(1, hash + 28); // chain terminator; count is 2
    const names = ["_kDartVmSnapshotData", "_kDartIsolateSnapshotData"];
    expect(
      (await readElfSymbols(image, names)).symbols.map((symbol) => symbol.name),
    ).toEqual(names);
    image.writeUInt32LE(0xffffffff, hash + 24);
    expect((await readElfSymbols(image, names)).symbols).toEqual([]);
  });
});

/** Section-header field positions for each ELF class. */
const ELF_CLASSES = {
  elf64: {
    build: buildElf64Image,
    word: {
      read: (image: Buffer, at: number) => Number(image.readBigUInt64LE(at)),
      write: (image: Buffer, value: number, at: number) =>
        image.writeBigUInt64LE(BigInt(value), at),
    },
    shoff: 0x28,
    shent: 64,
    flags: 8,
    address: 0x10,
    offset: 0x18,
  },
  elf32: {
    build: buildElf32Image,
    word: {
      read: (image: Buffer, at: number) => image.readUInt32LE(at),
      write: (image: Buffer, value: number, at: number) =>
        image.writeUInt32LE(value, at),
    },
    shoff: 0x20,
    shent: 40,
    flags: 8,
    address: 0x0c,
    offset: 0x10,
  },
} as const;

describe.each(Object.entries(ELF_CLASSES))(
  "allocated %s symbol tables",
  (_, layout) => {
    const { word } = layout;
    /** Snapshot sections, with dynamic tables allocated at their offsets. */
    const allocatedTables = (): {
      image: Buffer;
      headers: number[];
      tables: number[];
    } => {
      const elf = layout.build([
        { name: "_kDartVmSnapshotData", value: 0x400, size: 52 },
      ]);
      const section = snapshotSection(GALLERY_HASH);
      const image = Buffer.concat([
        elf,
        Buffer.alloc(0x400 - elf.length),
        section,
      ]);
      const shoff = word.read(image, layout.shoff);
      const headers = [shoff + layout.shent, shoff + 2 * layout.shent];
      const tables = headers.map((header) => {
        const offset = word.read(image, header + layout.offset);
        word.write(image, 2, header + layout.flags);
        word.write(image, offset, header + layout.address);
        return offset;
      });
      return { image, headers, tables };
    };

    it("accepts tables whose mapping matches their sections", async () => {
      const { image } = allocatedTables();
      expect(await readElfSymbols(image, ["_kDartVmSnapshotData"])).toEqual({
        symbols: [{ name: "_kDartVmSnapshotData", offset: 0x400, size: 52 }],
        failures: [],
      });
    });

    it.each([
      [0, "Dynamic symbol table has conflicting PT_LOAD mappings"],
      [1, "Dynamic symbol string table has conflicting PT_LOAD mappings"],
    ])(
      "refuses table %i under a conflicting PT_LOAD interpretation",
      async (table, reason) => {
        const { image, tables } = allocatedTables();
        const conflict = appendElfRanges(image, "program", [
          { type: 1, address: tables[table]!, offset: 0x300, size: 4 },
        ]);
        expect(
          await readElfSymbols(conflict, ["_kDartVmSnapshotData"]),
        ).toEqual({ symbols: [], failures: [{ reason }] });
      },
    );

    it("refuses a table whose section offset disagrees with its mapping", async () => {
      const { image, headers } = allocatedTables();
      word.write(image, 0x300, headers[0]! + layout.address);
      expect(await readElfSymbols(image, ["_kDartVmSnapshotData"])).toEqual({
        symbols: [],
        failures: [
          {
            reason:
              "Dynamic symbol table section offset disagrees with its PT_LOAD mapping",
          },
        ],
      });
    });
  },
);

describe("readSnapshotHeader", () => {
  it("reads a synthesized data header", async () => {
    const header = readSnapshotHeader(snapshotSection(GALLERY_HASH), 0);
    expect(header.magicValid).toBe(true);
    expect(header.kind).toBe(3);
  });

  it("reports nulls for sections without the data magic", async () => {
    const header = readSnapshotHeader(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]), 0);
    expect(header).toEqual({
      magicValid: false,
      kind: null,
      headerLength: null,
      hash: null,
      complete: false,
    });
  });
});

it("keeps section admission ahead of program admission for unrepresentable raw offsets", async () => {
  const bytes = buildStrippedElf64Image([]);
  bytes.writeBigUInt64LE(0xffffffffffffffffn, 0x28);
  bytes.writeBigUInt64LE(0xffffffffffffffffn, 0x20);
  expect(await readElfSymbols(bytes, ["_kDartVmSnapshotData"])).toEqual({
    symbols: [],
    failures: [
      { reason: "ELF section header table is missing or out of bounds" },
    ],
  });
  bytes.writeBigUInt64LE(0n, 0x28);
  expect(await readElfSymbols(bytes, ["_kDartVmSnapshotData"])).toEqual({
    symbols: [],
    failures: [
      { reason: "ELF program header table is missing or out of bounds" },
    ],
  });
});

it.each([256, 257])(
  "preserves Dart's narrower symbol-name window for a %i-byte name",
  async (length) => {
    const name = "n".repeat(length);
    const original = buildElf64Image([{ name: "seed", value: 64, size: 4 }]);
    const sectionTable = Number(original.readBigUInt64LE(0x28));
    const stringHeader = sectionTable + 2 * 64;
    const stringOffset = Number(original.readBigUInt64LE(stringHeader + 0x18));
    const bytes = Buffer.concat([original, Buffer.alloc(length + 2)]);
    bytes.write(name, stringOffset + 1, "latin1");
    bytes[stringOffset + 1 + length] = 0;
    bytes.writeBigUInt64LE(BigInt(length + 2), stringHeader + 0x20);
    bytes.writeBigUInt64LE(BigInt(bytes.length), 64 + 0x20);
    expect(await readElfSymbols(bytes, [name])).toEqual(
      length === 256
        ? { symbols: [{ name, offset: 64, size: 4 }], failures: [] }
        : {
            symbols: [],
            failures: [
              { reason: `symbol ${name} is not in the dynamic symbol table` },
            ],
          },
    );
  },
);

it("checks raw symbol precision only after definition and requested-name selection", async () => {
  const bytes = buildElf64Image([
    { name: "unselected", value: 64, size: 4 },
    { name: "selected", value: 64, size: 4 },
  ]);
  const expected = await readElfSymbols(bytes, ["selected"]);
  const sectionTable = Number(bytes.readBigUInt64LE(0x28));
  const symbols = Number(bytes.readBigUInt64LE(sectionTable + 64 + 0x18));
  bytes.writeBigUInt64LE(0xffffffffffffffffn, symbols + 8);
  bytes.writeBigUInt64LE(0xffffffffffffffffn, symbols + 16);
  expect(await readElfSymbols(bytes, ["selected"])).toEqual(expected);
  expect(await readElfSymbols(bytes, ["unselected"])).toEqual({
    symbols: [],
    failures: [{ reason: "Symbol unselected has unrepresentable bounds" }],
  });
  bytes.writeUInt16LE(0, symbols + 6);
  expect(await readElfSymbols(bytes, ["unselected"])).toEqual({
    symbols: [],
    failures: [
      { reason: "symbol unselected is not in the dynamic symbol table" },
    ],
  });
});

it("keeps precision admission limited to consumed ELF program fields and types", async () => {
  const original = buildElf64Image([{ name: "selected", value: 64, size: 4 }]);
  const expected = await readElfSymbols(original, ["selected"]);
  const bytes = appendElfRanges(original, "program", [
    { type: 0x70000001, offset: 0, size: 0 },
  ]);
  const table = Number(bytes.readBigUInt64LE(32));
  const width = bytes.readUInt16LE(54);
  for (const relative of [8, 16, 24, 32, 40, 48])
    bytes.writeBigUInt64LE(0xffffffffffffffffn, table + width + relative);
  // The load mapping does not consume physical address, memory size or alignment.
  for (const relative of [24, 40, 48])
    bytes.writeBigUInt64LE(0xffffffffffffffffn, table + relative);
  expect(await readElfSymbols(bytes, ["selected"])).toEqual(expected);
  bytes.writeBigUInt64LE(0xffffffffffffffffn, table + 32);
  expect(await readElfSymbols(bytes, ["selected"])).toEqual({
    symbols: [],
    failures: [{ reason: "ELF segment 0 is not file-backed" }],
  });
});

it("keeps section precision checks on consumed declarations and mapping fields", async () => {
  const bytes = buildElf64Image([{ name: "selected", value: 64, size: 4 }]);
  const expected = await readElfSymbols(bytes, ["selected"]);
  const table = Number(bytes.readBigUInt64LE(40));
  // An unrelated null record may carry uninterpreted declaration words.
  for (const relative of [8, 16, 24, 32, 48, 56])
    bytes.writeBigUInt64LE(0xffffffffffffffffn, table + relative);
  // Alignment is not consumed for this symbol-table mapping.
  bytes.writeBigUInt64LE(0xffffffffffffffffn, table + 64 + 48);
  expect(await readElfSymbols(bytes, ["selected"])).toEqual(expected);
  bytes.writeBigUInt64LE(0xffffffffffffffffn, table + 64 + 8);
  expect(await readElfSymbols(bytes, ["selected"])).toEqual({
    symbols: [],
    failures: [
      { reason: "Dynamic symbol table has an unrepresentable section header" },
    ],
  });
});

it("keeps ignored DT_NULL payloads separate from unsigned tag precision admission", async () => {
  const names = ["_kDartVmSnapshotData"];
  const control = await readElfSymbols(strippedImageWithSections(), names);
  expect(control.failures).toEqual([]);
  expect(
    await readElfSymbols(
      strippedImageWithSections([[0, 0xffffffffffffffffn]]),
      names,
    ),
  ).toEqual(control);
  const bytes = strippedImageWithSections([[16, 0n]]);
  const table = Number(bytes.readBigUInt64LE(64 + 56 + 8));
  bytes.writeBigInt64LE(-1n, table + 5 * 16);
  expect(await readElfSymbols(bytes, names)).toEqual({
    symbols: [],
    failures: [{ reason: "Dynamic entry is not representable" }],
  });
});
