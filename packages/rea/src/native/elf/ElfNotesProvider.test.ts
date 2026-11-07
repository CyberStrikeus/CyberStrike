import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ElfNotesService } from "../../application/binaryDiagnostics/ElfNotesService.js";
import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { elfNotesSchema } from "../../domain/native/elfNotes.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import {
  compressedElfNoteFixture,
  elfNote,
  elfNoteFixture,
  elfNoteTablePastEnd,
  elfExtendedSectionCountFixture,
} from "./ElfNotes.fixture.js";
import { ElfNotesProvider } from "./ElfNotesProvider.js";

const inspect = async (
  path: string,
  input: { readonly max_file_bytes?: number } = {},
) => {
  const service = new ElfNotesService(new ElfNotesProvider());
  try {
    return await service.inspect({ path, ...input });
  } finally {
    await service.close();
  }
};

describe("ELF note provider failures", () => {
  it("projects compressed note sections as unsupported rather than malformed input", async () => {
    const root = await createTestTempDirectory("rea-compressed-notes-");
    const path = join(root, "compressed.o");
    const bytes = elfNoteFixture({ ownership: "section" });
    const section = Number(bytes.readBigUInt64LE(40)) + 64;
    bytes.writeBigUInt64LE(0x800n, section + 8);
    await writeFile(path, bytes);
    const result = await inspect(path);
    if (result.ok)
      throw new Error("Expected compressed notes to be unsupported");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unsupported_target",
      message: expect.stringContaining("Compressed ELF note sections"),
    });
  });
  it("reports a note table past the end of the file as invalid input", async () => {
    const root = await createTestTempDirectory("rea-elf-note-past-end-");
    const path = join(root, "program");
    await writeFile(path, elfNoteTablePastEnd());
    const result = await inspect(path);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invalid input");
    expect(result.error).toBeInstanceOf(AnalysisInputError);
    expect(result.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["path"],
          reason: "invalid_format",
          message: expect.stringContaining("leaves the artifact"),
        },
      ],
    });
  });

  it("reports valid extended section numbering as an unsupported target", async () => {
    const root = await createTestTempDirectory(
      "rea-elf-note-extended-numbering-",
    );
    const path = join(root, "extended-count.elf");
    await writeFile(path, elfExtendedSectionCountFixture());
    const result = await inspect(path);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an unsupported target");
    expect(result.error).toBeInstanceOf(AnalysisUnsupportedTargetError);
    expect(result.error.message).toContain(
      "ELF extended numbering is unsupported",
    );
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unsupported_target",
      message: expect.stringContaining("ELF extended numbering is unsupported"),
    });
  });

  it("names the note text budget instead of host memory", async () => {
    const root = await createTestTempDirectory("rea-elf-note-text-budget-");
    const path = join(root, "program");
    await writeFile(
      path,
      elfNoteFixture({
        ownership: "program",
        notes: elfNote("GNU", 3, Buffer.alloc(4096, 1)),
      }),
    );
    const result = await inspect(path);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a text budget refusal");
    const error = result.error as AnalysisResourceConstraintError;
    expect(error.resource).toBe("memory");
    expect(error.message).toMatch(/byte budget/u);
    const projected = projectAnalysisError(error);
    expect(projected.retryable).toBe(false);
    expect(projected.remediation.action).toContain(
      "ELF note text, hash, and scan budget",
    );
    expect(projected.remediation.action).toMatch(/admitted image length/u);
    expect(projected.remediation.action).toMatch(/do not raise it/u);
    expect(projected.remediation.action).not.toMatch(/available host memory/u);
  });

  it("keeps a caller file-size budget distinct from host memory", async () => {
    const root = await createTestTempDirectory("rea-elf-note-file-budget-");
    const path = join(root, "program");
    await writeFile(path, elfNoteFixture({ ownership: "program" }));
    const result = await inspect(path, { max_file_bytes: 64 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a file-size refusal");
    const error = result.error as AnalysisResourceConstraintError;
    expect(error.resource).toBe("file-size");
    const projected = projectAnalysisError(error);
    expect(projected.retryable).toBe(false);
    expect(projected.remediation.action).toContain("max_file_bytes");
    expect(projected.remediation.action).not.toMatch(/available host memory/u);
  });

  it("reports and admits compressed names through max_file_bytes", async () => {
    const bytes = compressedElfNoteFixture();
    const sectionOffset = Number(bytes.readBigUInt64LE(40));
    const nameHeader = sectionOffset + bytes.readUInt16LE(62) * 64;
    const namesOffset = Number(bytes.readBigUInt64LE(nameHeader + 24));
    const decodedNamesBytes = Number(bytes.readBigUInt64LE(namesOffset + 8));
    const minimumMaxFileBytes = bytes.length + decodedNamesBytes;
    const root = await createTestTempDirectory("rea-elf-note-name-budget-");
    const path = join(root, "compressed-names.elf");
    await writeFile(path, bytes);

    const refused = await inspect(path, { max_file_bytes: bytes.length + 1 });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("Expected section-name admission refusal");
    expect(refused.error).toBeInstanceOf(AnalysisResourceConstraintError);
    if (!(refused.error instanceof AnalysisResourceConstraintError))
      throw refused.error;
    expect(refused.error).toMatchObject({
      resource: "memory",
      reportedLimits: {
        max_file_bytes: bytes.length + 1,
        minimum_required_bytes: String(minimumMaxFileBytes),
      },
      retryable: false,
    });
    expect(projectAnalysisError(refused.error).remediation.action).toContain(
      "max_file_bytes",
    );

    const admitted = await inspect(path, {
      max_file_bytes: minimumMaxFileBytes,
    });
    if (!admitted.ok) throw admitted.error;
    const report = elfNotesSchema.parse(admitted.value.normalized_result);
    expect(report.tables[0]?.name).toBe(".note.gnu.build-id");
  });
});
