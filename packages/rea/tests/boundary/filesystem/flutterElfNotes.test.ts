import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { readElfBuildIds } from "../../../src/flutter/ElfBuildId.js";
import {
  elfNote,
  elfNoteFixture,
  compressedElfNoteSectionFixture,
} from "../../../src/native/elf/ElfNotes.fixture.js";
import {
  appendElfRanges,
  engineFixtureImage,
} from "../../../src/flutter/FlutterBuild.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const note = Buffer.from(
  "040000000800000003000000474e55000123456789abcdef",
  "hex",
);

it.each([32, 64] as const)(
  "reads aligned consecutive notes in ELF%d",
  async (bits) => {
    for (const alignment of [4, 8]) {
      for (const table of ["program", "section", "both"] as const) {
        const ids = ["11".repeat(20), "22".repeat(20)];
        const image = elfNoteFixture({
          bits,
          alignment,
          ownership: table === "program" ? "program" : "both",
          notes: Buffer.concat([
            elfNote("Example", 1, Buffer.from([1]), true, alignment),
            ...ids.map((id) =>
              elfNote("GNU", 3, Buffer.from(id, "hex"), true, alignment),
            ),
          ]),
        });
        if (table === "section") image.writeUInt32LE(1, bits === 64 ? 64 : 52);
        const root = await createTestTempDirectory("rea-flutter-alignment-");
        const path = join(root, "engine.so");
        await writeFile(path, image);
        const file = await open(path, "r");
        try {
          expect(
            await readElfBuildIds(file, image.length, undefined),
            `${bits}/${table}/${alignment}`,
          ).toEqual({ candidates: ids, failures: [] });
        } finally {
          await file.close();
        }
      }
    }
  },
);

it.each(
  ([32, 64] as const).flatMap((bits) => [
    { bits, empty: false },
    { bits, empty: true },
  ]),
)(
  "retains other ELF$bits note IDs with compressed storage (empty: $empty)",
  async ({ bits, empty }) => {
    const encoded = compressedElfNoteSectionFixture(bits);
    const noteSection = (bits === 64 ? 64 : 52) + (bits === 64 ? 64 : 40);
    if (empty) {
      if (bits === 64) encoded.writeBigUInt64LE(0n, noteSection + 32);
      else encoded.writeUInt32LE(0, noteSection + 20);
    }
    // Engine metadata parsing also requires a program directory.
    const compressed = appendElfRanges(encoded, "program", [
      { type: 1, offset: 0, size: 0 },
    ]);
    const bytes = appendElfRanges(
      Buffer.concat([compressed, note]),
      "section",
      [{ type: 7, offset: compressed.length, size: note.length }],
    );
    const root = await createTestTempDirectory("rea-flutter-compressed-notes-");
    const path = join(root, "engine.so");
    await writeFile(path, bytes);
    const file = await open(path, "r");
    const read = vi.spyOn(file, "read");
    try {
      expect(await readElfBuildIds(file, bytes.length, undefined)).toEqual({
        candidates: ["0123456789abcdef"],
        failures: [{ reason: "Compressed ELF note sections are unsupported" }],
      });
      const storedOffset =
        bits === 64
          ? Number(compressed.readBigUInt64LE(noteSection + 24))
          : compressed.readUInt32LE(noteSection + 16);
      expect(read).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        storedOffset,
      );
    } finally {
      await file.close();
    }
  },
);

it.each(
  ([32, 64] as const).flatMap((bits) => [
    { bits, program: 8, section: 4, reads: 5 },
    { bits, program: 1, section: 4, reads: 4 },
  ]),
)(
  "keys shared $bits-bit note ranges by effective alignment (p_align $program, sh_addralign $section)",
  async ({ bits, program, section, reads }) => {
    // 24-byte IDs pad identically at four and eight bytes, so only the range
    // key decides whether the second declaration is read.
    const ids = ["11".repeat(24), "22".repeat(24)];
    const image = elfNoteFixture({
      bits,
      alignment: 4,
      ownership: "both",
      notes: Buffer.concat(
        ids.map((id) => elfNote("GNU", 3, Buffer.from(id, "hex"))),
      ),
    });
    const header = bits === 64 ? 64 : 52;
    const noteSection =
      header + (bits === 64 ? 56 : 32) + (bits === 64 ? 64 : 40);
    const writeAlignment = (offset: number, value: number) => {
      if (bits === 64) image.writeBigUInt64LE(BigInt(value), offset);
      else image.writeUInt32LE(value, offset);
    };
    writeAlignment(header + (bits === 64 ? 48 : 28), program);
    writeAlignment(noteSection + (bits === 64 ? 48 : 32), section);
    const root = await createTestTempDirectory("rea-flutter-alignment-");
    const path = join(root, "engine.so");
    await writeFile(path, image);
    const file = await open(path, "r");
    const read = vi.spyOn(file, "read");
    try {
      expect(await readElfBuildIds(file, image.length, undefined)).toEqual({
        candidates: ids,
        failures: [],
      });
      // Header prefix, both tables, then one read per distinct note range.
      expect(read.mock.calls.length).toBe(reads);
    } finally {
      await file.close();
    }
  },
);

it.each([
  { bits: 32, table: "program" },
  { bits: 64, table: "section" },
] as const)(
  "bounds dense $bits-bit $table note ranges while retaining examined IDs",
  async ({ bits, table }) => {
    const count = 30_000;
    const image = appendElfRanges(
      engineFixtureImage({
        bits,
        notes: Buffer.concat([note, Buffer.alloc(count)]),
        ownership: "both",
      }),
      table,
      Array.from({ length: count }, (_, index) => ({
        type: table === "program" ? 4 : 7,
        offset: 0x400 + note.length + index,
        size: 1,
      })),
    );
    const root = await createTestTempDirectory("rea-flutter-notes-");
    const path = join(root, "engine.so");
    await writeFile(path, image);
    const file = await open(path, "r");
    const read = vi.spyOn(file, "read");
    try {
      const result = await readElfBuildIds(file, image.length, undefined);
      expect(result.candidates).toEqual(["0123456789abcdef"]);
      expect(result.failures).toContainEqual({
        reason: expect.stringContaining("note-range"),
      });
      expect(read.mock.calls.length).toBeLessThanOrEqual(1027);
    } finally {
      await file.close();
    }
  },
);

it("deduplicates shared program/section notes and skips empty ranges before charging inventory", async () => {
  const ranges = Array.from({ length: 2000 }, (_, index) => ({
    type: 7,
    offset: index % 2 === 0 ? 0x400 : index,
    size: index % 2 === 0 ? note.length : 0,
  }));
  const image = appendElfRanges(
    engineFixtureImage({ notes: note, ownership: "both" }),
    "section",
    ranges,
  );
  const root = await createTestTempDirectory("rea-flutter-notes-");
  const path = join(root, "engine.so");
  await writeFile(path, image);
  const file = await open(path, "r");
  const read = vi.spyOn(file, "read");
  try {
    expect(await readElfBuildIds(file, image.length, undefined)).toEqual({
      candidates: ["0123456789abcdef"],
      failures: [],
    });
    expect(read.mock.calls.length).toBe(4);
  } finally {
    await file.close();
  }
});
