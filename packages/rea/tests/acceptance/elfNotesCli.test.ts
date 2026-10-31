import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import {
  compressedElfNoteFixture,
  compressedElfNoteSectionFixture,
  elfExtendedSectionCountFixture,
  elfNoteFixture,
  elfNoteWithUnreadableSectionNameFixture,
} from "../../src/native/elf/ElfNotes.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest("reports a GNU build-id through the public CLI", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-elf-notes-cli-");
  const path = join(root, "program");
  await writeFile(path, elfNoteFixture({ ownership: "program" }));
  const result = await cli.run({
    arguments: ["inspect-elf-notes", path, "--json"],
  });
  expect(result.exitCode, result.stderr).toBe(0);
  const evidence = toolContract("inspect_elf_notes").outputSchema.parse(
    result.json,
  );
  expect(
    evidence.normalized_result.entries.find(
      (entry) => entry.type_name === "gnu_build_id",
    )?.gnu?.build_id_hex,
  ).toBe("0123456789abcdef0123456789abcdef01234567");
});

cliTest(
  "resolves section note names from zlib and Zstandard string tables through the CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-elf-notes-compressed-cli-");
    for (const compressionType of [1, 2]) {
      const path = join(root, `program-${String(compressionType)}`);
      const bytes = compressedElfNoteFixture(64, true, compressionType);
      await writeFile(path, bytes);
      const result = await cli.run({
        arguments: ["inspect-elf-notes", path, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const evidence = toolContract("inspect_elf_notes").outputSchema.parse(
        result.json,
      );
      expect(evidence.normalized_result.tables[0]?.name).toBe(
        ".note.gnu.build-id",
      );
      expect(evidence.normalized_result.entries[0]?.gnu?.build_id_hex).toBe(
        "0123456789abcdef0123456789abcdef01234567",
      );
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    }
  },
);

cliTest(
  "keeps GNU notes when a section-name offset is outside its string table",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-elf-notes-name-cli-");
    const path = join(root, "program");
    const bytes = elfNoteWithUnreadableSectionNameFixture("outside");
    await writeFile(path, bytes);
    const result = await cli.run({
      arguments: ["inspect-elf-notes", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_elf_notes").outputSchema.parse(
      result.json,
    );
    expect(evidence.normalized_result.tables[0]?.name).toBeNull();
    expect(evidence.normalized_result.limitations).toContain(
      "ELF section names are incomplete because a name offset is outside its string table.",
    );
    expect(evidence.normalized_result.entries[0]?.gnu?.build_id_hex).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(evidence.normalized_result.coverage).toMatchObject({
      status: "complete",
      examined_tables: 1,
      examined_entries: 1,
    });
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  },
);

cliTest(
  "resolves a relative ELF path against the working directory",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-elf-notes-cli-rel-");
    await writeFile(
      join(root, "unsigned"),
      elfNoteFixture({ ownership: "none" }),
    );
    const result = await cli.run({
      arguments: ["inspect-elf-notes", "unsigned", "--json"],
      cwd: root,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_elf_notes").outputSchema.parse(
      result.json,
    );
    expect(evidence.normalized_result.tables).toEqual([]);
    expect(evidence.subject?.local_path).toBe(join(root, "unsigned"));
  },
);

cliTest("reports a truncated ELF as invalid input", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-elf-notes-cli-bad-");
  const path = join(root, "broken");
  await writeFile(path, Buffer.from("\x7fELF"));
  const result = await cli.run({
    arguments: ["inspect-elf-notes", path, "--json"],
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "invalid_request",
    details: { operation: "inspect_elf_notes" },
  });
});

cliTest(
  "reports compressed note storage as unsupported without mutation",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-elf-notes-storage-cli-");
    const path = join(root, "debug-notes.o");
    const bytes = compressedElfNoteSectionFixture();
    await writeFile(path, bytes);
    const result = await cli.run({
      arguments: ["inspect-elf-notes", path, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "unsupported_target",
      message: expect.stringContaining(
        "Compressed ELF note sections are unsupported",
      ),
    });
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  },
);

cliTest(
  "reports valid extended numbering as unsupported without mutation",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-elf-notes-extended-cli-");
    const path = join(root, "extended-count.elf");
    await writeFile(path, elfExtendedSectionCountFixture());
    const before = await readFile(path);
    const result = await cli.run({
      arguments: ["inspect-elf-notes", path, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "unsupported_target",
      message: expect.stringContaining("ELF extended numbering is unsupported"),
    });
    expect((await readFile(path)).equals(before)).toBe(true);
  },
);

cliTest(
  "rejects dangling section-name references and preserves sectionless notes",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-elf-notes-presence-cli-");
    const path = join(root, "program");
    for (const ownership of ["program", "none"] as const) {
      const bytes = elfNoteFixture({ ownership });
      bytes.writeUInt16LE(5, 62);
      await writeFile(path, bytes);
      const result = await cli.run({
        arguments: ["inspect-elf-notes", path, "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        details: {
          operation: "inspect_elf_notes",
          issues: [
            expect.objectContaining({
              path: ["path"],
              reason: "invalid_format",
              message: "ELF section table is missing",
            }),
          ],
        },
      });
      expect((await readFile(path)).equals(bytes)).toBe(true);
      bytes.writeUInt16LE(0, 62);
      await writeFile(path, bytes);
      const accepted = await cli.run({
        arguments: ["inspect-elf-notes", path, "--json"],
      });
      expect(accepted.exitCode, accepted.stderr).toBe(0);
      const evidence = toolContract("inspect_elf_notes").outputSchema.parse(
        accepted.json,
      );
      expect(evidence.normalized_result.coverage.status).toBe("complete");
      expect(evidence.normalized_result.tables).toHaveLength(
        ownership === "none" ? 0 : 1,
      );
    }
  },
);
