import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { inspectElfNotesInputSchema } from "../../domain/native/elfNotes.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { decodeElfSectionNameTable } from "../metadata/ElfSectionNameTable.js";
import { readElfDirectoryFromBuffer } from "../metadata/NativeSectionDirectory.js";
import {
  compressedElfNoteFixture,
  compressedElfNoteSectionFixture,
  elfNote,
  elfNoteFixture,
  elfNoteTablePastEnd,
  elfExtendedSectionCountFixture,
  gnuAbiTagNote,
  gnuBuildIdNote,
  gnuPropertyNote,
} from "./ElfNotes.fixture.js";
import {
  ElfNoteSectionNameBudgetFailure,
  parseElfNotes,
} from "./ElfNoteParser.js";

const defaults = inspectElfNotesInputSchema.parse({
  path: "/artifacts/app",
});

const parse = (bytes: Buffer, input: typeof defaults = defaults) =>
  parseElfNotes(
    bytes,
    {
      path: input.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
    input,
  );

const elf64 = (
  fields: {
    readonly phoff?: number;
    readonly shoff?: number;
    readonly phnum?: number;
    readonly shnum?: number;
    readonly phentsize?: number;
    readonly shentsize?: number;
  },
  tail?: Buffer,
): Buffer => {
  const header = Buffer.alloc(64);
  header.write("\x7fELF", 0, "latin1");
  header[4] = 2;
  header[5] = 1;
  header[6] = 1;
  header.writeUInt16LE(2, 16);
  header.writeUInt16LE(62, 18);
  header.writeUInt32LE(1, 20);
  header.writeBigUInt64LE(BigInt(fields.phoff ?? 0), 32);
  header.writeBigUInt64LE(BigInt(fields.shoff ?? 0), 40);
  header.writeUInt16LE(64, 52);
  header.writeUInt16LE(fields.phentsize ?? 56, 54);
  header.writeUInt16LE(fields.phnum ?? 0, 56);
  header.writeUInt16LE(fields.shentsize ?? 64, 58);
  header.writeUInt16LE(fields.shnum ?? 0, 60);
  return tail === undefined ? header : Buffer.concat([header, tail]);
};

it("reads GNU build-id and ABI-tag notes from ELF32 and ELF64", () => {
  for (const bits of [32, 64] as const) {
    const bytes = elfNoteFixture({ bits, ownership: "program" });
    const report = parse(bytes);
    expect(report.format).toBe(bits === 64 ? "elf64" : "elf32");
    expect(report.byte_order).toBe("little");
    expect(report.tables).toHaveLength(1);
    expect(report.tables[0]?.kind).toBe("program");
    const buildId = report.entries.find(
      (entry) => entry.type_name === "gnu_build_id",
    );
    const abi = report.entries.find(
      (entry) => entry.type_name === "gnu_abi_tag",
    );
    expect(buildId?.gnu?.build_id_hex).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(abi?.gnu?.abi_tag).toMatchObject({
      os: 0,
      os_name: "linux",
      major: 3,
      minor: 2,
      subminor: 0,
    });
  }
});

it("reads the same notes from an SHT_NOTE section including its name", () => {
  const report = parse(elfNoteFixture({ ownership: "section" }));
  expect(report.tables).toEqual([
    expect.objectContaining({
      kind: "section",
      name: ".note.gnu.build-id",
    }),
  ]);
  expect(
    report.entries.some((entry) => entry.type_name === "gnu_build_id"),
  ).toBe(true);
});

it.each([
  [32, true],
  [32, false],
  [64, true],
  [64, false],
] as const)(
  "refuses compressed ELF%i %s-endian note storage without parsing its compression header",
  (bits, little) => {
    expect(() => parse(compressedElfNoteSectionFixture(bits, little))).toThrow(
      expect.objectContaining({
        kind: "unsupported",
        message: expect.stringContaining(
          "Compressed ELF note sections are unsupported",
        ),
      }),
    );
  },
);

it("does not allocate the declared decoded note size, but still validates stored ranges", () => {
  const bytes = compressedElfNoteSectionFixture();
  const noteSection = 64 + 64;
  const storedOffset = Number(bytes.readBigUInt64LE(noteSection + 24));
  bytes.writeBigUInt64LE(0xffffffffffffffffn, storedOffset + 8);
  expect(() => parse(bytes)).toThrow(
    expect.objectContaining({ kind: "unsupported" }),
  );
  bytes.writeBigUInt64LE(0n, noteSection + 32);
  expect(() => parse(bytes)).toThrow(
    expect.objectContaining({ kind: "unsupported" }),
  );
  bytes.writeBigUInt64LE(BigInt(bytes.length), noteSection + 32);
  expect(() => parse(bytes)).toThrow(ArtifactReaderFailure);
});

it("preserves unknown ELF64 section flag bits without treating them as file sizes", () => {
  const bytes = elfNoteFixture({ ownership: "section" });
  bytes.writeBigUInt64LE(0x8000000000000000n, 64 + 64 + 8);
  bytes.writeBigUInt64LE(0x8000000000000000n, 64 + 2 * 64 + 8);
  expect(parse(bytes).entries[0]?.gnu?.build_id_hex).toBe(
    "0123456789abcdef0123456789abcdef01234567",
  );
});

it.each([
  [32, true, 1],
  [32, false, 1],
  [64, true, 1],
  [64, false, 1],
  [32, true, 2],
  [32, false, 2],
  [64, true, 2],
  [64, false, 2],
] as const)(
  "decompresses an ELF%i little-endian=%s section-name table using algorithm %i",
  (bits, little, compressionType) => {
    const report = parse(
      compressedElfNoteFixture(bits, little, compressionType),
    );
    expect(report.tables).toEqual([
      expect.objectContaining({ kind: "section", name: ".note.gnu.build-id" }),
    ]);
    expect(report.entries[0]?.gnu?.build_id_hex).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
  },
);

it.each([1, 2])(
  "admits a decoded section name larger than algorithm %i storage",
  (compressionType) => {
    const name = "n".repeat(512);
    const bytes = compressedElfNoteFixture(64, true, compressionType, name);
    expect(bytes.length).toBeLessThan(name.length);
    const report = parse(bytes);
    expect(report.tables[0]?.name).toBe(name);
  },
);

it.each([1, 2])(
  "rejects malformed algorithm %i section-name storage",
  (compressionType) => {
    for (const damage of ["corrupt", "truncated", "too-large", "too-small"]) {
      const bytes = compressedElfNoteFixture(64, true, compressionType);
      const sectionOffset = Number(bytes.readBigUInt64LE(40));
      const nameHeader = sectionOffset + bytes.readUInt16LE(62) * 64;
      const namesOffset = Number(bytes.readBigUInt64LE(nameHeader + 24));
      if (damage === "corrupt") bytes[namesOffset + 24] = 0;
      else if (damage === "truncated")
        bytes.writeBigUInt64LE(
          bytes.readBigUInt64LE(nameHeader + 32) - 1n,
          nameHeader + 32,
        );
      else
        bytes.writeBigUInt64LE(
          bytes.readBigUInt64LE(namesOffset + 8) +
            (damage === "too-large" ? 1n : -1n),
          namesOffset + 8,
        );
      expect(() => parse(bytes), damage).toThrow(
        /compressed section-name table/u,
      );
    }
  },
);

it("refuses a Zstandard frame requiring more than the decoder window allowance", () => {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(2, 0);
  header.writeBigUInt64LE(1n, 16);
  // An empty last raw block with Window_Descriptor 0x90: a 2^28-byte window.
  const frame = Buffer.from("28b52ffd0090010000", "hex");
  expect(
    decodeElfSectionNameTable(
      Buffer.concat([header, frame]),
      0x800n,
      64,
      true,
      0,
    ),
  ).toMatchObject({
    state: "malformed",
    message: expect.stringMatching(/memory/iu),
  });
});

it("keeps note facts but marks section names unavailable for unknown compression", () => {
  const report = parse(compressedElfNoteFixture(64, true, 3));
  expect(report.tables[0]?.name).toBeNull();
  expect(report.entries[0]?.gnu?.build_id_hex).toBe(
    "0123456789abcdef0123456789abcdef01234567",
  );
  expect(report.limitations).toContain(
    "ELF section names are unavailable because compression type 3 is unsupported.",
  );
});

it.each([1, 2])(
  "admits algorithm %i section names when max_file_bytes includes expansion",
  (compressionType) => {
    const bytes = compressedElfNoteFixture(64, true, compressionType);
    const sectionOffset = Number(bytes.readBigUInt64LE(40));
    const nameHeader = sectionOffset + bytes.readUInt16LE(62) * 64;
    const namesOffset = Number(bytes.readBigUInt64LE(nameHeader + 24));
    const decodedNamesBytes = Number(bytes.readBigUInt64LE(namesOffset + 8));
    const minimumMaxFileBytes = bytes.length + decodedNamesBytes;
    const input = inspectElfNotesInputSchema.parse({
      path: defaults.path,
      max_file_bytes: bytes.length + 1,
    });
    let failure: unknown;
    try {
      parse(bytes, input);
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(ElfNoteSectionNameBudgetFailure);
    expect(failure).toMatchObject({
      minimumMaxFileBytes: BigInt(minimumMaxFileBytes),
      selectedMaxFileBytes: bytes.length + 1,
    });

    const admitted = parse(
      bytes,
      inspectElfNotesInputSchema.parse({
        path: defaults.path,
        max_file_bytes: minimumMaxFileBytes,
      }),
    );
    expect(admitted.tables[0]?.name).toBe(".note.gnu.build-id");
  },
);

it("reports independent PT_NOTE and SHT_NOTE declarations of the same bytes", () => {
  const report = parse(elfNoteFixture({ ownership: "both" }));
  expect(report.tables.map((table) => table.kind).sort()).toEqual([
    "program",
    "section",
  ]);
  expect(
    report.entries.filter((entry) => entry.type_name === "gnu_build_id"),
  ).toHaveLength(2);
});

it("reports missing note tables without claiming notes never existed", () => {
  const report = parse(elfNoteFixture({ ownership: "none" }));
  expect(report.tables).toEqual([]);
  expect(report.entries).toEqual([]);
  expect(report.limitations[0]).toMatch(/No PT_NOTE/u);
});

it("fails a truncated note payload without partial success", () => {
  const notes = gnuBuildIdNote();
  notes.writeUInt32LE(64, 0);
  const bytes = elfNoteFixture({ ownership: "program", notes });
  expect(() => parse(bytes)).toThrow(ArtifactReaderFailure);
});

it("keeps non-GNU owners as unknown types with descriptor hashes", () => {
  const payload = Buffer.from("hello");
  const notes = elfNote("CORE", 1, payload);
  const report = parse(elfNoteFixture({ ownership: "program", notes }));
  expect(report.entries[0]).toMatchObject({
    owner: "CORE",
    type_name: "unknown",
    gnu: null,
  });
  expect(report.entries[0]?.descriptor.sha256).toBe(
    createHash("sha256").update(payload).digest("hex"),
  );
});

it("reads a big-endian ELF32 GNU build-id", () => {
  const notes = gnuBuildIdNote(undefined, false);
  const report = parse(
    elfNoteFixture({
      bits: 32,
      little: false,
      machine: 20,
      ownership: "program",
      notes,
    }),
  );
  expect(report.byte_order).toBe("big");
  expect(report.machine).toBe(20);
  expect(report.entries[0]?.gnu?.build_id_hex).toBe(
    "0123456789abcdef0123456789abcdef01234567",
  );
});

it("reads an 8-aligned GNU property note from a PT_NOTE program header", () => {
  const notes = gnuPropertyNote();
  expect(notes.length).toBe(48);
  const report = parse(
    elfNoteFixture({ ownership: "program", notes, alignment: 8 }),
  );
  expect(report.tables).toEqual([
    expect.objectContaining({ kind: "program", alignment: 8 }),
  ]);
  expect(report.entries).toHaveLength(1);
  expect(report.entries[0]).toMatchObject({
    owner: "GNU",
    type: 5,
    type_name: "gnu_property",
    namesz: 4,
    descsz: 32,
  });
  expect(report.entries[0]?.descriptor.location.offset).toBe(
    (report.entries[0]?.location.offset ?? 0) + 16,
  );
});

it("reads an 8-aligned GNU property note from an SHT_NOTE section", () => {
  const report = parse(
    elfNoteFixture({
      ownership: "section",
      notes: gnuPropertyNote(),
      alignment: 8,
      sectionName: ".note.gnu.property",
    }),
  );
  expect(report.tables).toEqual([
    expect.objectContaining({
      kind: "section",
      name: ".note.gnu.property",
      alignment: 8,
    }),
  ]);
  expect(report.entries[0]?.type_name).toBe("gnu_property");
  expect(report.entries[0]?.descriptor.bytes).toBe(32);
});

it.each([0, 1] as const)(
  "treats declared note alignment %i as 4-byte padding",
  (alignment) => {
    const report = parse(elfNoteFixture({ ownership: "program", alignment }));
    expect(report.tables[0]?.alignment).toBe(4);
    expect(
      report.entries.some((entry) => entry.type_name === "gnu_build_id"),
    ).toBe(true);
    expect(
      report.entries.some((entry) => entry.type_name === "gnu_abi_tag"),
    ).toBe(true);
  },
);

const hostElf = [
  "/bin/ls",
  "/usr/bin/ls",
  "/usr/bin/env",
].reduce<Buffer | null>((found, path) => {
  if (found) return found;
  try {
    const bytes = readFileSync(path);
    if (
      bytes.length > 64 &&
      bytes[0] === 0x7f &&
      bytes[1] === 0x45 &&
      bytes[2] === 0x4c &&
      bytes[3] === 0x46
    )
      return bytes;
  } catch {
    return found;
  }
  return found;
}, null);

it.skipIf(hostElf === null)(
  "parses a host ELF without requiring it to contain notes",
  () => {
    const report = parse(hostElf!);
    expect(report.coverage.status).toBe("complete");
    const buildId = report.entries.find(
      (entry) => entry.type_name === "gnu_build_id",
    );
    const abi = report.entries.find(
      (entry) => entry.type_name === "gnu_abi_tag",
    );
    if (buildId !== undefined)
      expect(buildId.gnu?.build_id_hex).toMatch(/^[0-9a-f]+$/u);
    if (abi !== undefined)
      expect(abi.gnu?.abi_tag).toMatchObject({
        os: expect.any(Number),
        major: expect.any(Number),
        minor: expect.any(Number),
        subminor: expect.any(Number),
      });
  },
);

const unterminatedNoteSections = (
  sections: number,
  nameBytes: number,
): Buffer => {
  const shnum = sections + 2;
  const tableOffset = 64 + shnum * 64;
  const shdr = (type: number, offset = 0, size = 0): Buffer => {
    const header = Buffer.alloc(64);
    header.writeUInt32LE(type, 4);
    header.writeBigUInt64LE(BigInt(offset), 24);
    header.writeBigUInt64LE(BigInt(size), 32);
    return header;
  };
  const image = Buffer.concat([
    elf64({ shoff: 64, shnum }),
    shdr(0),
    shdr(3, tableOffset, nameBytes),
    ...Array.from({ length: sections }, () => shdr(7, tableOffset)),
    Buffer.alloc(nameBytes, 0x41),
  ]);
  image.writeUInt16LE(1, 62);
  return image;
};

it.each([
  { offset: 2, name: "é", state: "known" },
  { offset: 3, name: "", state: "known" },
  { offset: 4, name: null, state: "unavailable" },
])(
  "retains ELF section-name offset $offset consistently across consumers",
  ({ offset, name, state }) => {
    const bytes = unterminatedNoteSections(1, 4);
    bytes.set([0x41, 0x42, 0xe9, 0], bytes.length - 4);
    bytes.writeUInt32LE(offset, 64 + 2 * 64);
    const notes = parse(bytes);
    const directory = readElfDirectoryFromBuffer(bytes);
    expect(notes.tables[0]?.name).toBe(name);
    expect(directory.sections[2]).toMatchObject({ name, name_state: state });
    if (name === null) {
      expect(notes.coverage.status).toBe("complete");
      expect(notes.limitations).toContain(
        "ELF section names are incomplete because a name offset is outside its string table.",
      );
      expect(directory.section_names_limitation).toBe(
        "ELF section names are incomplete because a name offset is outside its string table",
      );
    }
  },
);

it.each([65535, 65536])(
  "preserves consumer-specific section-name windows for NUL at byte %i",
  (terminatorOffset) => {
    const bytes = unterminatedNoteSections(1, terminatorOffset + 1);
    bytes[bytes.length - 1] = 0;
    const name = "A".repeat(terminatorOffset);
    const notes = parse(bytes);
    const directory = readElfDirectoryFromBuffer(bytes);
    expect(notes.tables[0]?.name).toBe(name);
    expect(notes.coverage.status).toBe("complete");
    expect(directory.sections[2]).toMatchObject(
      terminatorOffset === 65535
        ? { name, name_state: "known" }
        : { name: null, name_state: "truncated" },
    );
    if (terminatorOffset === 65536)
      expect(directory.section_names_limitation).toBe(
        "ELF section names are unavailable because a name is not NUL-terminated",
      );
  },
);

it("bounds repeated scans of an unterminated section name", () => {
  const report = parse(unterminatedNoteSections(2, 64));
  expect(report.tables.map(({ name }) => name)).toEqual([null, null]);
  expect(report.coverage.status).toBe("complete");
  expect(
    report.limitations.filter((value) => value.includes("not NUL-terminated")),
  ).toEqual([
    "ELF section names are incomplete because a name is not NUL-terminated.",
  ]);
  let failure: unknown;
  try {
    parse(unterminatedNoteSections(3, 400));
  } catch (cause) {
    failure = cause;
  }
  expect(failure).toBeInstanceOf(ArtifactReaderFailure);
  expect(failure).toMatchObject({ reason: "limit", boundary: "memory" });
  expect(failure).toHaveProperty(
    "message",
    expect.stringMatching(/byte budget/u),
  );
});

it("rejects note text that repeats beyond the shared byte budget", () => {
  const notes = elfNote("A".repeat(40), 1, Buffer.alloc(0));
  const once = elfNoteFixture({ ownership: "program", notes });
  const twice = elfNoteFixture({ ownership: "both", notes });
  const input = inspectElfNotesInputSchema.parse({
    path: defaults.path,
    max_file_bytes: 200,
  });
  expect(parse(once, input).entries).toHaveLength(1);
  expect(() => parse(twice, input)).toThrow(ArtifactReaderFailure);
  expect(() => parse(twice, input)).toThrow(/byte budget/u);
});

it("rejects program and section header tables that do not fit", () => {
  expect(() =>
    parse(elf64({ phoff: 64, phnum: 1 }, Buffer.from([1, 0, 0, 0]))),
  ).toThrow(/leaves the artifact/u);
  expect(() =>
    parse(
      elf64({ shoff: 64, shnum: 1, shentsize: 64 }, Buffer.from([0, 0, 0, 0])),
    ),
  ).toThrow(/leaves the artifact/u);
});

it("rejects an extended section count stored in section zero", () => {
  expect(() => parse(elf64({ shoff: 64, shnum: 0 }))).toThrow(
    /extended numbering/u,
  );
});

const repeatedNotes = (count: number, notes: Buffer): Buffer => {
  const headers = Buffer.alloc(56 * count);
  const offset = 64 + headers.length;
  for (let index = 0; index < count; index += 1) {
    const at = index * 56;
    headers.writeUInt32LE(4, at);
    headers.writeBigUInt64LE(BigInt(offset), at + 8);
    headers.writeBigUInt64LE(BigInt(notes.length), at + 32);
    headers.writeBigUInt64LE(4n, at + 48);
  }
  return Buffer.concat([elf64({ phoff: 64, phnum: count }), headers, notes]);
};

it("reuses one descriptor hash and GNU NUL scan across note headers", () => {
  const payload = Buffer.alloc(400);
  const hashed = parse(repeatedNotes(6, elfNote("X", 1, payload)));
  expect(hashed.entries).toHaveLength(6);
  expect(
    new Set(hashed.entries.map((entry) => entry.descriptor.sha256)).size,
  ).toBe(1);
  const gold = parse(repeatedNotes(6, elfNote("GNU", 4, payload)));
  expect(gold.entries).toHaveLength(6);
  expect(gold.entries.every((entry) => entry.gnu?.gold_version === "")).toBe(
    true,
  );
  const distinct = Buffer.concat([
    elfNote("X", 1, payload),
    elfNote("X", 1, Buffer.alloc(400, 1)),
  ]);
  expect(() =>
    parse(
      elfNoteFixture({ ownership: "program", notes: distinct }),
      inspectElfNotesInputSchema.parse({
        path: defaults.path,
        max_file_bytes: payload.length + 160,
      }),
    ),
  ).toThrow(/byte budget/u);
});

it("decodes a GNU gold version by scanning trailing NULs", () => {
  const trailing = elfNote("GNU", 4, Buffer.from("gold\0\0x\0", "latin1"));
  expect(
    parse(elfNoteFixture({ ownership: "program", notes: trailing })).entries[0]
      ?.gnu?.gold_version,
  ).toBe("gold\0\0x");
  const descriptor = Buffer.concat([Buffer.alloc(131_072), Buffer.from("x")]);
  const started = Date.now();
  const report = parse(
    elfNoteFixture({
      ownership: "program",
      notes: elfNote("GNU", 4, descriptor),
    }),
  );
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(report.entries[0]?.gnu?.gold_version).toBe(`${"\0".repeat(131_072)}x`);
});

it("rejects a declared note table that extends past the file", () => {
  const truncated = elfNoteTablePastEnd();
  expect(truncated.length).toBe(137);
  expect(() => parse(truncated)).toThrow(ArtifactReaderFailure);
  expect(() => parse(truncated)).toThrow(/leaves the artifact/u);
  const present = Buffer.concat([truncated, Buffer.alloc(3)]);
  expect(parse(present).entries).toHaveLength(1);
  expect(parse(present).tables[0]?.location).toEqual({
    offset: 120,
    bytes: 20,
  });
});

it("fails when the entry budget is exhausted", () => {
  const notes = Buffer.concat([
    gnuBuildIdNote(),
    gnuAbiTagNote(),
    elfNote("GNU", 4, Buffer.from("gold")),
  ]);
  const bytes = elfNoteFixture({ ownership: "program", notes });
  expect(() =>
    parseElfNotes(
      bytes,
      {
        path: defaults.path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      },
      inspectElfNotesInputSchema.parse({ path: defaults.path, max_entries: 1 }),
    ),
  ).toThrow(ArtifactReaderFailure);
});

it("keeps unsafe table offsets ahead of unsupported extended numbering", () => {
  const bytes = elfExtendedSectionCountFixture();
  bytes.writeBigUInt64LE(0xffffffffffffffffn, 32);
  expect(() => parse(bytes)).toThrow(
    "ELF offset or size exceeds a safe integer.",
  );
});

it("does not apply note precision admission to unrelated program records", () => {
  const bytes = elf64({ phoff: 64, phnum: 1 }, Buffer.alloc(56));
  bytes.writeUInt32LE(0x70000001, 64);
  for (const relative of [8, 16, 24, 32, 40, 48])
    bytes.writeBigUInt64LE(0xffffffffffffffffn, 64 + relative);
  expect(parse(bytes).tables).toEqual([]);
  bytes.writeUInt32LE(4, 64);
  expect(() => parse(bytes)).toThrow(
    "ELF offset or size exceeds a safe integer.",
  );
});

it("keeps compressed-note refusal ahead of alignment precision admission", () => {
  const bytes = compressedElfNoteSectionFixture();
  const sectionTable = Number(bytes.readBigUInt64LE(40));
  bytes.writeBigUInt64LE(0xffffffffffffffffn, sectionTable + 64 + 48);
  expect(() => parse(bytes)).toThrow(
    "Compressed ELF note sections are unsupported",
  );
});

it.each([
  { bits: 32, little: true },
  { bits: 32, little: false },
  { bits: 64, little: true },
  { bits: 64, little: false },
] as const)(
  "rejects dangling section names with and without notes (ELF$bits $little)",
  ({ bits, little }) => {
    for (const ownership of ["program", "none"] as const) {
      const bytes = elfNoteFixture({ bits, little, ownership });
      const before = parse(bytes);
      const nameOffset = bits === 64 ? 62 : 50;
      if (little) bytes.writeUInt16LE(5, nameOffset);
      else bytes.writeUInt16BE(5, nameOffset);
      expect(() => parse(bytes)).toThrow("ELF section table is missing");
      if (little) bytes.writeUInt16LE(0, nameOffset);
      else bytes.writeUInt16BE(0, nameOffset);
      expect(parse(bytes)).toEqual(before);
    }
  },
);
