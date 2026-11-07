import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElfNotesService } from "../../../src/composition/binaryDiagnostics.js";
import { elfNoteFixture } from "../../../src/native/elf/ElfNotes.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("ELF note stable filesystem boundary", () => {
  it("reports non-file and malformed ELF selections as caller input errors", async () => {
    const root = await createTestTempDirectory("rea-elf-notes-files-");
    const path = join(root, "program");
    const alias = join(root, "alias");
    const malformed = join(root, "malformed");
    await writeFile(path, elfNoteFixture());
    await writeFile(malformed, Buffer.from("not an elf"));
    await symlink(path, alias);
    const service = createElfNotesService();
    for (const [candidate, reason] of [
      [root, "invalid_format"],
      [alias, "invalid_format"],
      [malformed, "invalid_format"],
      [join(root, "missing"), "invalid_value"],
      [join(path, "child"), "invalid_value"],
    ] as const) {
      const result = await service.inspect({ path: candidate });
      if (result.ok) throw new Error("Expected file acquisition failure");
      expect(result.error).toMatchObject({
        _tag: "AnalysisInputError",
        operation: "inspect_elf_notes",
        issues: [
          {
            path: ["path"],
            reason,
            message: expect.any(String),
          },
        ],
      });
    }
  });

  it("returns typed resource and cancellation failures", async () => {
    const root = await createTestTempDirectory("rea-elf-notes-budget-");
    const path = join(root, "program");
    await writeFile(path, elfNoteFixture());
    const service = createElfNotesService();
    const tooSmall = await service.inspect({ path, max_file_bytes: 64 });
    if (tooSmall.ok) throw new Error("Expected resource budget failure");
    expect(tooSmall.error._tag).toBe("AnalysisResourceConstraintError");
    const cancelled = await service.inspect(
      { path },
      { signal: AbortSignal.abort() },
    );
    if (cancelled.ok) throw new Error("Expected cancellation");
    expect(cancelled.error._tag).toBe("AnalysisCancelledError");
  });
});
